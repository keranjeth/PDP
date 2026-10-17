-- Denormalize employees.id_number onto compensation_records for Table Editor visibility
-- and reliable client reconciliation when employee UUIDs drift.

ALTER TABLE public.compensation_records
  ADD COLUMN IF NOT EXISTS employee_id_number text;

COMMENT ON COLUMN public.compensation_records.employee_id_number IS
  'Business Employee ID (employees.id_number), denormalized for imports and UI.';

UPDATE public.compensation_records cr
SET employee_id_number = e.id_number
FROM public.employees e
WHERE e.org_id = cr.org_id
  AND e.id = cr.employee_id
  AND e.deleted_at IS NULL
  AND (cr.employee_id_number IS DISTINCT FROM e.id_number);

CREATE OR REPLACE FUNCTION public.set_compensation_employee_id_number()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  IF NEW.employee_id IS NULL THEN
    NEW.employee_id_number := NULL;
    RETURN NEW;
  END IF;
  NEW.employee_id_number := (
    SELECT e.id_number
    FROM public.employees e
    WHERE e.org_id = NEW.org_id
      AND e.id = NEW.employee_id
      AND e.deleted_at IS NULL
  );
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_compensation_employee_id_number ON public.compensation_records;
CREATE TRIGGER trg_compensation_employee_id_number
  BEFORE INSERT OR UPDATE OF employee_id, org_id ON public.compensation_records
  FOR EACH ROW
  EXECUTE FUNCTION public.set_compensation_employee_id_number();

DROP VIEW IF EXISTS public.v_compensation_records_history;

CREATE VIEW public.v_compensation_records_history AS
SELECT
  cr.*,
  (
    cr.deleted_at IS NULL
    AND cr.start_date <= CURRENT_DATE
    AND (cr.end_date IS NULL OR cr.end_date >= CURRENT_DATE)
  ) AS is_active
FROM public.compensation_records cr;

COMMENT ON VIEW public.v_compensation_records_history IS
  'Compensation history with is_active; employee_id_number is on compensation_records.';

ALTER VIEW public.v_compensation_records_history SET (security_invoker = true);
