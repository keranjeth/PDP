-- Bridge compensation_records to the new catalog.
-- Exact-match mappings are backfilled now. Legacy generic "Allowance" rows remain
-- intentionally unmapped until they are decomposed into clean named components.

ALTER TABLE public.compensation_records
  ADD COLUMN IF NOT EXISTS component_catalog_id uuid;

COMMENT ON COLUMN public.compensation_records.component_catalog_id IS
  'Nullable FK to pay_component_catalog. Exact-match recurring compensation labels are backfilled; unresolved legacy labels remain NULL until normalized.';

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM pg_constraint
    WHERE conrelid = 'public.compensation_records'::regclass
      AND conname = 'compensation_records_component_catalog_fk'
  ) THEN
    ALTER TABLE public.compensation_records
      ADD CONSTRAINT compensation_records_component_catalog_fk
      FOREIGN KEY (org_id, component_catalog_id)
      REFERENCES public.pay_component_catalog (org_id, id)
      ON UPDATE RESTRICT
      ON DELETE RESTRICT;
  END IF;
END $$;

CREATE INDEX IF NOT EXISTS compensation_records_org_component_catalog_idx
  ON public.compensation_records (org_id, component_catalog_id)
  WHERE component_catalog_id IS NOT NULL;

CREATE INDEX IF NOT EXISTS compensation_records_org_emp_catalog_start_idx
  ON public.compensation_records (org_id, employee_id, component_catalog_id, start_date DESC)
  WHERE deleted_at IS NULL AND component_catalog_id IS NOT NULL;

CREATE OR REPLACE FUNCTION public.set_compensation_component_catalog_id()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  resolved_id uuid;
BEGIN
  IF NEW.component_catalog_id IS NOT NULL THEN
    RETURN NEW;
  END IF;

  IF NEW.component_type IS NULL OR btrim(NEW.component_type) = '' THEN
    RETURN NEW;
  END IF;

  SELECT pcc.id
  INTO resolved_id
  FROM public.pay_component_catalog pcc
  WHERE pcc.org_id = NEW.org_id
    AND pcc.source_mode = 'compensation_record'
    AND (
      lower(pcc.display_name) = lower(trim(NEW.component_type))
      OR lower(COALESCE(pcc.legacy_component_type, '')) = lower(trim(NEW.component_type))
    )
  ORDER BY pcc.sort_order, pcc.created_at
  LIMIT 1;

  NEW.component_catalog_id := resolved_id;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_compensation_component_catalog_id
  ON public.compensation_records;

CREATE TRIGGER trg_compensation_component_catalog_id
  BEFORE INSERT OR UPDATE OF org_id, component_type, component_catalog_id
  ON public.compensation_records
  FOR EACH ROW
  EXECUTE FUNCTION public.set_compensation_component_catalog_id();

UPDATE public.compensation_records cr
SET component_catalog_id = pcc.id
FROM public.pay_component_catalog pcc
WHERE cr.component_catalog_id IS NULL
  AND cr.deleted_at IS NULL
  AND pcc.org_id = cr.org_id
  AND pcc.source_mode = 'compensation_record'
  AND (
    lower(trim(pcc.display_name)) = lower(trim(cr.component_type))
    OR lower(trim(COALESCE(pcc.legacy_component_type, ''))) = lower(trim(cr.component_type))
  );

CREATE OR REPLACE VIEW public.v_compensation_component_catalog_audit AS
SELECT
  cr.org_id,
  cr.component_type,
  COUNT(*) AS active_row_count,
  COUNT(*) FILTER (WHERE cr.component_catalog_id IS NULL) AS unmapped_row_count
FROM public.compensation_records cr
WHERE cr.deleted_at IS NULL
GROUP BY cr.org_id, cr.component_type
ORDER BY cr.org_id, cr.component_type;

COMMENT ON VIEW public.v_compensation_component_catalog_audit IS
  'Active compensation label audit showing which component_type values are still unmapped to pay_component_catalog. Legacy generic labels such as Allowance are expected to remain until normalized.';

ALTER VIEW public.v_compensation_component_catalog_audit SET (security_invoker = true);
