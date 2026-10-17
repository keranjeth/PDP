-- Phase 6 queue view for separation cases awaiting or progressing through settlement.

CREATE OR REPLACE VIEW public.v_separation_case_queue AS
SELECT
  sc.id AS separation_case_id,
  sc.org_id,
  sc.employee_id,
  sc.leaver_id,
  sc.exit_type,
  sc.reason_code,
  sc.last_working_date,
  sc.notice_required_days,
  sc.notice_served_days,
  sc.notice_action,
  sc.eligible_for_leave_encashment,
  sc.eligible_for_termination_benefit,
  sc.status,
  sc.settlement_summary,
  COALESCE((sc.settlement_summary->>'netSettlement')::numeric, 0) AS net_settlement_amount,
  COALESCE((sc.settlement_summary->>'lineCount')::integer, 0) AS line_count,
  sc.created_at,
  sc.updated_at,
  sc.approved_at,
  sc.settled_at
FROM public.separation_cases sc
WHERE sc.status IN ('pending_approval', 'approved', 'ready_for_payroll');

COMMENT ON VIEW public.v_separation_case_queue IS
  'Active separation cases that still require approval or final-payroll settlement.';

ALTER VIEW public.v_separation_case_queue SET (security_invoker = true);
