-- Phase 5 due queue for recovery schedules.

CREATE OR REPLACE VIEW public.v_recovery_schedule_due AS
SELECT
  rs.id AS recovery_schedule_id,
  rs.org_id,
  rs.recovery_plan_id,
  rp.employee_id,
  rp.source_type,
  rp.source_id,
  rp.recovery_type,
  rp.component_catalog_id,
  rp.deduction_method,
  rp.max_deduction_percent_of_net,
  rp.clear_in_final_pay,
  rs.due_period_code,
  rs.scheduled_amount,
  rs.applied_amount,
  GREATEST(rs.scheduled_amount - rs.applied_amount, 0) AS remaining_amount,
  rs.status AS schedule_status,
  rp.status AS plan_status,
  rs.payroll_run_employee_id,
  rs.created_at,
  rs.updated_at
FROM public.recovery_schedule rs
JOIN public.recovery_plans rp
  ON rp.id = rs.recovery_plan_id
 AND rp.org_id = rs.org_id
WHERE rp.status IN ('active', 'completed')
  AND rs.status IN ('scheduled', 'partially_applied')
  AND GREATEST(rs.scheduled_amount - rs.applied_amount, 0) > 0;

COMMENT ON VIEW public.v_recovery_schedule_due IS
  'Recovery schedule items with remaining collectible amounts, ready for future payroll run consumption.';

ALTER VIEW public.v_recovery_schedule_due SET (security_invoker = true);
