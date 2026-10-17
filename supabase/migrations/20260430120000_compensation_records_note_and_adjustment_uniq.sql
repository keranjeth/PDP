-- Audit notes for adjustment import; prevent duplicate effective rows per catalog component.
ALTER TABLE public.compensation_records
  ADD COLUMN IF NOT EXISTS note text;

CREATE UNIQUE INDEX IF NOT EXISTS compensation_records_org_emp_catalog_start_uniq
  ON public.compensation_records (org_id, employee_id, component_catalog_id, start_date)
  WHERE deleted_at IS NULL AND component_catalog_id IS NOT NULL;
