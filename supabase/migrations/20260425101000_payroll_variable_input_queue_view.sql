-- Phase 4 queue view for approved but not-yet-consumed payroll variable inputs.

CREATE OR REPLACE VIEW public.v_payroll_variable_input_queue AS
SELECT
  'payroll_adjustment'::text AS input_type,
  pa.id AS input_id,
  pa.org_id,
  pa.employee_id,
  pa.component_catalog_id,
  pa.import_batch_id,
  pa.import_row_id,
  pa.status,
  pa.effective_from AS applicable_from,
  pa.effective_to AS applicable_to,
  NULL::date AS work_date,
  pa.amount,
  pa.quantity,
  pa.rate,
  pa.description,
  pa.reason_code AS reference_code,
  pa.created_at,
  pa.updated_at,
  pa.approved_at,
  pa.consumed_at,
  pa.applied_run_employee_id
FROM public.payroll_adjustments pa
WHERE pa.status IN ('approved', 'partially_consumed')

UNION ALL

SELECT
  'overtime_entry'::text AS input_type,
  oe.id AS input_id,
  oe.org_id,
  oe.employee_id,
  oe.component_catalog_id,
  oe.import_batch_id,
  oe.import_row_id,
  oe.status,
  oe.work_date AS applicable_from,
  oe.work_date AS applicable_to,
  oe.work_date,
  COALESCE(oe.approved_hours, oe.hours) AS amount,
  COALESCE(oe.approved_hours, oe.hours) AS quantity,
  oe.rate_override AS rate,
  COALESCE(oe.notes, oe.overtime_code) AS description,
  oe.overtime_code AS reference_code,
  oe.created_at,
  oe.updated_at,
  oe.approved_at,
  oe.consumed_at,
  oe.applied_run_employee_id
FROM public.overtime_entries oe
WHERE oe.status IN ('approved', 'partially_consumed');

COMMENT ON VIEW public.v_payroll_variable_input_queue IS
  'Approved or partially consumed variable payroll inputs waiting to be applied into payroll runs.';

ALTER VIEW public.v_payroll_variable_input_queue SET (security_invoker = true);
