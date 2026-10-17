-- Normalize compensation history structure on existing public.compensation_records.
-- This preserves all existing rows (history) and adds integrity + audit support.

-- 1) Effective-date integrity
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conrelid = 'public.compensation_records'::regclass
      AND conname = 'compensation_records_date_order_chk'
  ) THEN
    ALTER TABLE public.compensation_records
      ADD CONSTRAINT compensation_records_date_order_chk
      CHECK (end_date IS NULL OR end_date >= start_date);
  END IF;
END $$;

-- 2) Amount integrity
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conrelid = 'public.compensation_records'::regclass
      AND conname = 'compensation_records_amount_nonneg_chk'
  ) THEN
    ALTER TABLE public.compensation_records
      ADD CONSTRAINT compensation_records_amount_nonneg_chk
      CHECK (amount >= 0);
  END IF;
END $$;

-- 3) Audit trigger (timestamps / auth uid)
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM pg_trigger
    WHERE tgrelid = 'public.compensation_records'::regclass
      AND tgname = 'trg_compensation_records_audit'
  ) THEN
    CREATE TRIGGER trg_compensation_records_audit
      BEFORE INSERT OR UPDATE ON public.compensation_records
      FOR EACH ROW
      EXECUTE FUNCTION set_audit_fields();
  END IF;
END $$;

-- 4) Helpful index for effective-dated lookups (active + history)
CREATE INDEX IF NOT EXISTS compensation_records_org_emp_component_start_idx
  ON public.compensation_records (org_id, employee_id, lower(component_type), start_date DESC)
  WHERE deleted_at IS NULL;

-- 5) Convenience view exposing computed active status
CREATE OR REPLACE VIEW public.v_compensation_records_history AS
SELECT
  cr.*,
  (
    cr.deleted_at IS NULL
    AND cr.start_date <= CURRENT_DATE
    AND (cr.end_date IS NULL OR cr.end_date >= CURRENT_DATE)
  ) AS is_active
FROM public.compensation_records cr;

COMMENT ON VIEW public.v_compensation_records_history IS
  'Compensation history with effective dates; is_active computed at query time (CURRENT_DATE).';

