-- Expose employees.id_number on the compensation history view for readability / import checks.
-- compensation_records table and employee_id (UUID) FK are unchanged.
-- DROP + CREATE: CREATE OR REPLACE cannot add columns mid-projection when cr.* column set evolves.

DROP VIEW IF EXISTS public.v_compensation_records_history;

CREATE VIEW public.v_compensation_records_history AS
SELECT
  cr.*,
  e.id_number AS employee_id_number,
  (
    cr.deleted_at IS NULL
    AND cr.start_date <= CURRENT_DATE
    AND (cr.end_date IS NULL OR cr.end_date >= CURRENT_DATE)
  ) AS is_active
FROM public.compensation_records cr
LEFT JOIN public.employees e
  ON e.org_id = cr.org_id
  AND e.id = cr.employee_id
  AND e.deleted_at IS NULL;

COMMENT ON VIEW public.v_compensation_records_history IS
  'Compensation history with effective dates; is_active; employees.id_number as employee_id_number.';

ALTER VIEW public.v_compensation_records_history SET (security_invoker = true);
