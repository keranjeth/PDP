-- Rename recovery_schedule → recovery_schedules; repoint triggers, function body, and due queue view.

DO $$
BEGIN
  IF to_regclass('public.recovery_schedule') IS NOT NULL
     AND to_regclass('public.recovery_schedules') IS NULL THEN
    ALTER TABLE public.recovery_schedule RENAME TO recovery_schedules;
  END IF;
END $$;

COMMENT ON TABLE public.recovery_schedules IS
  'Installment ledger for recovery plans. Renamed from recovery_schedule.';

CREATE OR REPLACE FUNCTION public.refresh_recovery_plan_outstanding()
RETURNS trigger
LANGUAGE plpgsql
AS $$
DECLARE
  target_plan_id uuid;
  target_org_id uuid;
BEGIN
  target_plan_id := COALESCE(NEW.recovery_plan_id, OLD.recovery_plan_id);
  target_org_id := COALESCE(NEW.org_id, OLD.org_id);

  UPDATE public.recovery_plans rp
  SET
    outstanding_amount = GREATEST(
      rp.original_amount - COALESCE(stats.total_applied, 0),
      0
    ),
    status = CASE
      WHEN rp.status = 'cancelled' THEN rp.status
      WHEN GREATEST(rp.original_amount - COALESCE(stats.total_applied, 0), 0) = 0 THEN 'completed'
      WHEN rp.status = 'draft' THEN rp.status
      WHEN rp.status = 'pending_approval' THEN rp.status
      ELSE 'active'
    END,
    updated_at = now()
  FROM (
    SELECT COALESCE(SUM(applied_amount), 0) AS total_applied
    FROM public.recovery_schedules
    WHERE recovery_plan_id = target_plan_id
      AND org_id = target_org_id
  ) AS stats
  WHERE rp.id = target_plan_id
    AND rp.org_id = target_org_id;

  RETURN COALESCE(NEW, OLD);
END;
$$;

DROP TRIGGER IF EXISTS trg_refresh_recovery_plan_outstanding ON public.recovery_schedules;
DROP TRIGGER IF EXISTS trg_refresh_recovery_plan_outstanding ON public.recovery_schedule;

CREATE TRIGGER trg_refresh_recovery_plan_outstanding
  AFTER INSERT OR UPDATE OR DELETE
  ON public.recovery_schedules
  FOR EACH ROW
  EXECUTE FUNCTION public.refresh_recovery_plan_outstanding();

DROP TRIGGER IF EXISTS trg_stamp_recovery_schedule_status ON public.recovery_schedules;
DROP TRIGGER IF EXISTS trg_stamp_recovery_schedule_status ON public.recovery_schedule;

CREATE TRIGGER trg_stamp_recovery_schedule_status
  BEFORE INSERT OR UPDATE
  ON public.recovery_schedules
  FOR EACH ROW
  EXECUTE FUNCTION public.stamp_recovery_schedule_status();

DROP TRIGGER IF EXISTS trg_prevent_finalized_recovery_schedule_mutation ON public.recovery_schedules;
DROP TRIGGER IF EXISTS trg_prevent_finalized_recovery_schedule_mutation ON public.recovery_schedule;

CREATE TRIGGER trg_prevent_finalized_recovery_schedule_mutation
  BEFORE UPDATE OR DELETE
  ON public.recovery_schedules
  FOR EACH ROW
  EXECUTE FUNCTION public.prevent_finalized_recovery_mutation();

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
FROM public.recovery_schedules rs
JOIN public.recovery_plans rp
  ON rp.id = rs.recovery_plan_id
 AND rp.org_id = rs.org_id
WHERE rp.status IN ('active', 'completed')
  AND rs.status IN ('scheduled', 'partially_applied')
  AND GREATEST(rs.scheduled_amount - rs.applied_amount, 0) > 0;

COMMENT ON VIEW public.v_recovery_schedule_due IS
  'Recovery schedule items with remaining collectible amounts, ready for future payroll run consumption.';

ALTER VIEW public.v_recovery_schedule_due SET (security_invoker = true);
