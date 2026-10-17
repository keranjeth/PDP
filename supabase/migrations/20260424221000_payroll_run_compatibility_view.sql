-- Phase 2 compatibility reporting bridge.
-- Projects both actual payroll runs and legacy payroll_records into a unified
-- run-employee-style reporting surface during transition.

CREATE OR REPLACE VIEW public.v_payroll_run_employee_compatibility AS
SELECT
  'payroll_run'::text AS source_model,
  pr.org_id,
  pp.id AS payroll_period_id,
  pp.period_code,
  pp.period_type,
  pp.legacy_payroll_month_id,
  pr.id AS payroll_run_id,
  pr.run_code,
  pr.run_type,
  pr.status AS run_status,
  pre.id AS payroll_run_employee_id,
  NULL::uuid AS legacy_payroll_record_id,
  pre.employee_id,
  pre.status AS settlement_status,
  pre.employee_snapshot,
  pre.compensation_snapshot,
  pre.input_summary,
  pre.calc_summary,
  pre.exception_summary,
  COALESCE(pr.started_at, pr.created_at) AS processed_at,
  pr.closed_at,
  pre.created_at,
  pre.updated_at
FROM public.payroll_run_employees pre
JOIN public.payroll_runs pr
  ON pr.id = pre.payroll_run_id
 AND pr.org_id = pre.org_id
JOIN public.payroll_periods pp
  ON pp.id = pr.payroll_period_id
 AND pp.org_id = pr.org_id

UNION ALL

SELECT
  'legacy_payroll_record'::text AS source_model,
  pm.org_id,
  pp.id AS payroll_period_id,
  pp.period_code,
  pp.period_type,
  pm.id AS legacy_payroll_month_id,
  NULL::uuid AS payroll_run_id,
  'legacy-' || pm.month_key AS run_code,
  'regular'::text AS run_type,
  CASE
    WHEN pm.status = 'open' THEN 'review'
    ELSE 'closed'
  END AS run_status,
  NULL::uuid AS payroll_run_employee_id,
  pr.id AS legacy_payroll_record_id,
  pr.employee_id,
  CASE
    WHEN pr.closed_at IS NULL THEN 'calculated'
    ELSE 'closed'
  END AS settlement_status,
  COALESCE(pr.employee_snapshot, '{}'::jsonb) AS employee_snapshot,
  '{}'::jsonb AS compensation_snapshot,
  COALESCE(pr.inputs, '{}'::jsonb) AS input_summary,
  COALESCE(pr.calculations, '{}'::jsonb) AS calc_summary,
  NULL::jsonb AS exception_summary,
  pr.processed_at,
  pr.closed_at,
  pr.created_at,
  pr.updated_at
FROM public.payroll_records pr
JOIN public.payroll_months pm
  ON pm.id = pr.payroll_month_id
 AND pm.org_id = pr.org_id
LEFT JOIN public.payroll_periods pp
  ON pp.org_id = pm.org_id
 AND pp.legacy_payroll_month_id = pm.id;

COMMENT ON VIEW public.v_payroll_run_employee_compatibility IS
  'Compatibility reporting bridge that projects both Phase 2 payroll_run_employees and legacy payroll_records into one run-style settlement surface.';

ALTER VIEW public.v_payroll_run_employee_compatibility SET (security_invoker = true);
