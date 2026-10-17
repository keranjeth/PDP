-- Phase 5: salary advances and recovery ledgers.
-- Adds first-class salary advance, recovery plan, and recovery schedule tables without
-- changing the existing payroll calculation formulas.

CREATE TABLE IF NOT EXISTS public.salary_advances (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id uuid NOT NULL REFERENCES public.organizations(id),
  employee_id uuid NOT NULL,
  request_date date NOT NULL,
  approved_date date NULL,
  disbursement_date date NULL,
  principal_amount numeric NOT NULL,
  status text NOT NULL DEFAULT 'draft',
  notes text NULL,
  recovery_plan_id uuid NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  created_by uuid NULL,
  updated_at timestamptz NOT NULL DEFAULT now(),
  updated_by uuid NULL,
  approved_by uuid NULL,
  CONSTRAINT salary_advances_org_id_id_key UNIQUE (org_id, id),
  CONSTRAINT salary_advances_status_chk
    CHECK (status IN ('draft', 'pending_approval', 'approved', 'disbursed', 'cancelled', 'rejected', 'closed')),
  CONSTRAINT salary_advances_principal_amount_chk CHECK (principal_amount >= 0)
);

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM pg_constraint
    WHERE conrelid = 'public.salary_advances'::regclass
      AND conname = 'salary_advances_employee_fk'
  ) THEN
    ALTER TABLE public.salary_advances
      ADD CONSTRAINT salary_advances_employee_fk
      FOREIGN KEY (org_id, employee_id)
      REFERENCES public.employees (org_id, id)
      ON UPDATE RESTRICT
      ON DELETE RESTRICT;
  END IF;
END $$;

CREATE INDEX IF NOT EXISTS salary_advances_org_status_request_idx
  ON public.salary_advances (org_id, status, request_date DESC);

CREATE INDEX IF NOT EXISTS salary_advances_org_employee_request_idx
  ON public.salary_advances (org_id, employee_id, request_date DESC);

COMMENT ON TABLE public.salary_advances IS
  'Salary advance requests, approvals, disbursements, and closure state.';

CREATE TABLE IF NOT EXISTS public.recovery_plans (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id uuid NOT NULL REFERENCES public.organizations(id),
  employee_id uuid NOT NULL,
  source_type text NOT NULL,
  source_id uuid NULL,
  recovery_type text NOT NULL,
  component_catalog_id uuid NULL,
  original_amount numeric NOT NULL,
  outstanding_amount numeric NOT NULL,
  deduction_method text NOT NULL DEFAULT 'scheduled_only',
  default_installment_amount numeric NULL,
  max_deduction_percent_of_net numeric NULL,
  start_period_code text NOT NULL,
  clear_in_final_pay boolean NOT NULL DEFAULT true,
  status text NOT NULL DEFAULT 'draft',
  notes text NULL,
  approved_at timestamptz NULL,
  approved_by uuid NULL,
  closed_at timestamptz NULL,
  closed_by uuid NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  created_by uuid NULL,
  updated_at timestamptz NOT NULL DEFAULT now(),
  updated_by uuid NULL,
  CONSTRAINT recovery_plans_org_id_id_key UNIQUE (org_id, id),
  CONSTRAINT recovery_plans_source_type_chk
    CHECK (source_type IN ('salary_advance', 'manual_recovery', 'payroll_adjustment', 'other')),
  CONSTRAINT recovery_plans_recovery_type_chk
    CHECK (recovery_type IN ('salary_advance_repayment', 'overpayment', 'asset_recovery', 'disciplinary_recovery', 'other')),
  CONSTRAINT recovery_plans_deduction_method_chk
    CHECK (deduction_method IN ('fixed_amount', 'percent_of_net', 'scheduled_only')),
  CONSTRAINT recovery_plans_status_chk
    CHECK (status IN ('draft', 'pending_approval', 'active', 'completed', 'cancelled', 'closed')),
  CONSTRAINT recovery_plans_original_amount_chk CHECK (original_amount >= 0),
  CONSTRAINT recovery_plans_outstanding_amount_chk CHECK (outstanding_amount >= 0),
  CONSTRAINT recovery_plans_default_installment_amount_chk
    CHECK (default_installment_amount IS NULL OR default_installment_amount >= 0),
  CONSTRAINT recovery_plans_max_deduction_percent_chk
    CHECK (max_deduction_percent_of_net IS NULL OR (max_deduction_percent_of_net >= 0 AND max_deduction_percent_of_net <= 100)),
  CONSTRAINT recovery_plans_start_period_code_chk
    CHECK (start_period_code ~ '^[0-9]{4}-[0-9]{2}$')
);

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM pg_constraint
    WHERE conrelid = 'public.recovery_plans'::regclass
      AND conname = 'recovery_plans_employee_fk'
  ) THEN
    ALTER TABLE public.recovery_plans
      ADD CONSTRAINT recovery_plans_employee_fk
      FOREIGN KEY (org_id, employee_id)
      REFERENCES public.employees (org_id, id)
      ON UPDATE RESTRICT
      ON DELETE RESTRICT;
  END IF;

  IF NOT EXISTS (
    SELECT 1
    FROM pg_constraint
    WHERE conrelid = 'public.recovery_plans'::regclass
      AND conname = 'recovery_plans_component_catalog_fk'
  ) THEN
    ALTER TABLE public.recovery_plans
      ADD CONSTRAINT recovery_plans_component_catalog_fk
      FOREIGN KEY (org_id, component_catalog_id)
      REFERENCES public.pay_component_catalog (org_id, id)
      ON UPDATE RESTRICT
      ON DELETE RESTRICT;
  END IF;
END $$;

CREATE INDEX IF NOT EXISTS recovery_plans_org_status_start_idx
  ON public.recovery_plans (org_id, status, start_period_code, created_at DESC);

CREATE INDEX IF NOT EXISTS recovery_plans_org_employee_status_idx
  ON public.recovery_plans (org_id, employee_id, status, created_at DESC);

COMMENT ON TABLE public.recovery_plans IS
  'Recovery plan header for salary advance repayment and other employee recoveries.';

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM pg_constraint
    WHERE conrelid = 'public.salary_advances'::regclass
      AND conname = 'salary_advances_recovery_plan_fk'
  ) THEN
    ALTER TABLE public.salary_advances
      ADD CONSTRAINT salary_advances_recovery_plan_fk
      FOREIGN KEY (org_id, recovery_plan_id)
      REFERENCES public.recovery_plans (org_id, id)
      ON UPDATE RESTRICT
      ON DELETE SET NULL;
  END IF;
END $$;

CREATE TABLE IF NOT EXISTS public.recovery_schedule (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id uuid NOT NULL REFERENCES public.organizations(id),
  recovery_plan_id uuid NOT NULL,
  due_period_code text NOT NULL,
  scheduled_amount numeric NOT NULL,
  applied_amount numeric NOT NULL DEFAULT 0,
  status text NOT NULL DEFAULT 'scheduled',
  payroll_run_employee_id uuid NULL,
  notes text NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT recovery_schedule_org_id_id_key UNIQUE (org_id, id),
  CONSTRAINT recovery_schedule_plan_period_key UNIQUE (recovery_plan_id, due_period_code),
  CONSTRAINT recovery_schedule_due_period_code_chk
    CHECK (due_period_code ~ '^[0-9]{4}-[0-9]{2}$'),
  CONSTRAINT recovery_schedule_scheduled_amount_chk CHECK (scheduled_amount >= 0),
  CONSTRAINT recovery_schedule_applied_amount_chk CHECK (applied_amount >= 0),
  CONSTRAINT recovery_schedule_status_chk
    CHECK (status IN ('scheduled', 'partially_applied', 'applied', 'skipped', 'cancelled')),
  CONSTRAINT recovery_schedule_applied_not_over_scheduled_chk
    CHECK (applied_amount <= scheduled_amount)
);

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM pg_constraint
    WHERE conrelid = 'public.recovery_schedule'::regclass
      AND conname = 'recovery_schedule_plan_fk'
  ) THEN
    ALTER TABLE public.recovery_schedule
      ADD CONSTRAINT recovery_schedule_plan_fk
      FOREIGN KEY (org_id, recovery_plan_id)
      REFERENCES public.recovery_plans (org_id, id)
      ON UPDATE RESTRICT
      ON DELETE CASCADE;
  END IF;

  IF NOT EXISTS (
    SELECT 1
    FROM pg_constraint
    WHERE conrelid = 'public.recovery_schedule'::regclass
      AND conname = 'recovery_schedule_run_employee_fk'
  ) THEN
    ALTER TABLE public.recovery_schedule
      ADD CONSTRAINT recovery_schedule_run_employee_fk
      FOREIGN KEY (org_id, payroll_run_employee_id)
      REFERENCES public.payroll_run_employees (org_id, id)
      ON UPDATE RESTRICT
      ON DELETE SET NULL;
  END IF;
END $$;

CREATE INDEX IF NOT EXISTS recovery_schedule_org_status_due_idx
  ON public.recovery_schedule (org_id, status, due_period_code, created_at);

CREATE INDEX IF NOT EXISTS recovery_schedule_org_plan_due_idx
  ON public.recovery_schedule (org_id, recovery_plan_id, due_period_code);

COMMENT ON TABLE public.recovery_schedule IS
  'Installment ledger for recovery plans. Each row tracks scheduled and applied amounts by period.';

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
    FROM public.recovery_schedule
    WHERE recovery_plan_id = target_plan_id
      AND org_id = target_org_id
  ) AS stats
  WHERE rp.id = target_plan_id
    AND rp.org_id = target_org_id;

  RETURN COALESCE(NEW, OLD);
END;
$$;

DROP TRIGGER IF EXISTS trg_refresh_recovery_plan_outstanding
  ON public.recovery_schedule;

CREATE TRIGGER trg_refresh_recovery_plan_outstanding
  AFTER INSERT OR UPDATE OR DELETE
  ON public.recovery_schedule
  FOR EACH ROW
  EXECUTE FUNCTION public.refresh_recovery_plan_outstanding();

CREATE OR REPLACE FUNCTION public.stamp_salary_advance_status()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  IF NEW.status IN ('approved', 'disbursed', 'closed')
     AND COALESCE(NEW.approved_date, OLD.approved_date) IS NULL THEN
    NEW.approved_date := CURRENT_DATE;
  END IF;

  IF NEW.status = 'disbursed'
     AND COALESCE(NEW.disbursement_date, OLD.disbursement_date) IS NULL THEN
    NEW.disbursement_date := CURRENT_DATE;
  END IF;

  NEW.updated_at := now();
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_stamp_salary_advance_status
  ON public.salary_advances;

CREATE TRIGGER trg_stamp_salary_advance_status
  BEFORE UPDATE
  ON public.salary_advances
  FOR EACH ROW
  EXECUTE FUNCTION public.stamp_salary_advance_status();

CREATE OR REPLACE FUNCTION public.stamp_recovery_plan_status()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  IF NEW.status IN ('active', 'completed', 'closed')
     AND COALESCE(NEW.approved_at, OLD.approved_at) IS NULL THEN
    NEW.approved_at := now();
  END IF;

  IF NEW.status IN ('completed', 'closed')
     AND COALESCE(NEW.closed_at, OLD.closed_at) IS NULL THEN
    NEW.closed_at := now();
  END IF;

  NEW.updated_at := now();
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_stamp_recovery_plan_status
  ON public.recovery_plans;

CREATE TRIGGER trg_stamp_recovery_plan_status
  BEFORE UPDATE
  ON public.recovery_plans
  FOR EACH ROW
  EXECUTE FUNCTION public.stamp_recovery_plan_status();

CREATE OR REPLACE FUNCTION public.stamp_recovery_schedule_status()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  IF NEW.applied_amount = 0 AND NEW.status NOT IN ('cancelled', 'skipped') THEN
    NEW.status := 'scheduled';
  ELSIF NEW.applied_amount >= NEW.scheduled_amount AND NEW.status <> 'cancelled' THEN
    NEW.status := 'applied';
  ELSIF NEW.applied_amount > 0 AND NEW.status <> 'cancelled' THEN
    NEW.status := 'partially_applied';
  END IF;

  NEW.updated_at := now();
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_stamp_recovery_schedule_status
  ON public.recovery_schedule;

CREATE TRIGGER trg_stamp_recovery_schedule_status
  BEFORE INSERT OR UPDATE
  ON public.recovery_schedule
  FOR EACH ROW
  EXECUTE FUNCTION public.stamp_recovery_schedule_status();

CREATE OR REPLACE FUNCTION public.prevent_finalized_recovery_mutation()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  IF OLD.status IN ('closed', 'cancelled', 'completed', 'applied') THEN
    RAISE EXCEPTION 'Finalized recovery record is immutable' USING ERRCODE = '23514';
  END IF;
  RETURN COALESCE(NEW, OLD);
END;
$$;

DROP TRIGGER IF EXISTS trg_prevent_finalized_salary_advance_mutation
  ON public.salary_advances;

CREATE TRIGGER trg_prevent_finalized_salary_advance_mutation
  BEFORE UPDATE OR DELETE
  ON public.salary_advances
  FOR EACH ROW
  EXECUTE FUNCTION public.prevent_finalized_recovery_mutation();

DROP TRIGGER IF EXISTS trg_prevent_finalized_recovery_plan_mutation
  ON public.recovery_plans;

CREATE TRIGGER trg_prevent_finalized_recovery_plan_mutation
  BEFORE UPDATE OR DELETE
  ON public.recovery_plans
  FOR EACH ROW
  EXECUTE FUNCTION public.prevent_finalized_recovery_mutation();

DROP TRIGGER IF EXISTS trg_prevent_finalized_recovery_schedule_mutation
  ON public.recovery_schedule;

CREATE TRIGGER trg_prevent_finalized_recovery_schedule_mutation
  BEFORE UPDATE OR DELETE
  ON public.recovery_schedule
  FOR EACH ROW
  EXECUTE FUNCTION public.prevent_finalized_recovery_mutation();

ALTER TABLE public.salary_advances ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.recovery_plans ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.recovery_schedule ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS salary_advances_select_scoped ON public.salary_advances;
CREATE POLICY salary_advances_select_scoped
  ON public.salary_advances
  FOR SELECT
  TO public
  USING (auth.uid() IS NOT NULL AND org_role(org_id) IS NOT NULL);

DROP POLICY IF EXISTS salary_advances_insert_privileged ON public.salary_advances;
CREATE POLICY salary_advances_insert_privileged
  ON public.salary_advances
  FOR INSERT
  TO public
  WITH CHECK (
    auth.uid() IS NOT NULL
    AND org_role(org_id) = ANY (ARRAY[
      'owner'::org_role,
      'admin'::org_role,
      'payroll_manager'::org_role,
      'super_admin'::org_role,
      'head_of_hr'::org_role,
      'hr_national'::org_role,
      'regional_hr'::org_role,
      'hr_manager'::org_role
    ])
  );

DROP POLICY IF EXISTS salary_advances_update_privileged ON public.salary_advances;
CREATE POLICY salary_advances_update_privileged
  ON public.salary_advances
  FOR UPDATE
  TO public
  USING (
    auth.uid() IS NOT NULL
    AND org_role(org_id) = ANY (ARRAY[
      'owner'::org_role,
      'admin'::org_role,
      'payroll_manager'::org_role,
      'super_admin'::org_role,
      'head_of_hr'::org_role,
      'hr_national'::org_role,
      'regional_hr'::org_role,
      'hr_manager'::org_role
    ])
  )
  WITH CHECK (
    auth.uid() IS NOT NULL
    AND org_role(org_id) = ANY (ARRAY[
      'owner'::org_role,
      'admin'::org_role,
      'payroll_manager'::org_role,
      'super_admin'::org_role,
      'head_of_hr'::org_role,
      'hr_national'::org_role,
      'regional_hr'::org_role,
      'hr_manager'::org_role
    ])
  );

DROP POLICY IF EXISTS salary_advances_delete_privileged ON public.salary_advances;
CREATE POLICY salary_advances_delete_privileged
  ON public.salary_advances
  FOR DELETE
  TO public
  USING (
    auth.uid() IS NOT NULL
    AND org_role(org_id) = ANY (ARRAY[
      'owner'::org_role,
      'admin'::org_role,
      'payroll_manager'::org_role,
      'super_admin'::org_role,
      'head_of_hr'::org_role
    ])
  );

DROP POLICY IF EXISTS recovery_plans_select_scoped ON public.recovery_plans;
CREATE POLICY recovery_plans_select_scoped
  ON public.recovery_plans
  FOR SELECT
  TO public
  USING (auth.uid() IS NOT NULL AND org_role(org_id) IS NOT NULL);

DROP POLICY IF EXISTS recovery_plans_insert_privileged ON public.recovery_plans;
CREATE POLICY recovery_plans_insert_privileged
  ON public.recovery_plans
  FOR INSERT
  TO public
  WITH CHECK (
    auth.uid() IS NOT NULL
    AND org_role(org_id) = ANY (ARRAY[
      'owner'::org_role,
      'admin'::org_role,
      'payroll_manager'::org_role,
      'super_admin'::org_role,
      'head_of_hr'::org_role,
      'hr_national'::org_role,
      'regional_hr'::org_role,
      'hr_manager'::org_role
    ])
  );

DROP POLICY IF EXISTS recovery_plans_update_privileged ON public.recovery_plans;
CREATE POLICY recovery_plans_update_privileged
  ON public.recovery_plans
  FOR UPDATE
  TO public
  USING (
    auth.uid() IS NOT NULL
    AND org_role(org_id) = ANY (ARRAY[
      'owner'::org_role,
      'admin'::org_role,
      'payroll_manager'::org_role,
      'super_admin'::org_role,
      'head_of_hr'::org_role,
      'hr_national'::org_role,
      'regional_hr'::org_role,
      'hr_manager'::org_role
    ])
  )
  WITH CHECK (
    auth.uid() IS NOT NULL
    AND org_role(org_id) = ANY (ARRAY[
      'owner'::org_role,
      'admin'::org_role,
      'payroll_manager'::org_role,
      'super_admin'::org_role,
      'head_of_hr'::org_role,
      'hr_national'::org_role,
      'regional_hr'::org_role,
      'hr_manager'::org_role
    ])
  );

DROP POLICY IF EXISTS recovery_plans_delete_privileged ON public.recovery_plans;
CREATE POLICY recovery_plans_delete_privileged
  ON public.recovery_plans
  FOR DELETE
  TO public
  USING (
    auth.uid() IS NOT NULL
    AND org_role(org_id) = ANY (ARRAY[
      'owner'::org_role,
      'admin'::org_role,
      'payroll_manager'::org_role,
      'super_admin'::org_role,
      'head_of_hr'::org_role
    ])
  );

DROP POLICY IF EXISTS recovery_schedule_select_scoped ON public.recovery_schedule;
CREATE POLICY recovery_schedule_select_scoped
  ON public.recovery_schedule
  FOR SELECT
  TO public
  USING (auth.uid() IS NOT NULL AND org_role(org_id) IS NOT NULL);

DROP POLICY IF EXISTS recovery_schedule_insert_privileged ON public.recovery_schedule;
CREATE POLICY recovery_schedule_insert_privileged
  ON public.recovery_schedule
  FOR INSERT
  TO public
  WITH CHECK (
    auth.uid() IS NOT NULL
    AND org_role(org_id) = ANY (ARRAY[
      'owner'::org_role,
      'admin'::org_role,
      'payroll_manager'::org_role,
      'super_admin'::org_role,
      'head_of_hr'::org_role,
      'hr_national'::org_role,
      'regional_hr'::org_role,
      'hr_manager'::org_role
    ])
  );

DROP POLICY IF EXISTS recovery_schedule_update_privileged ON public.recovery_schedule;
CREATE POLICY recovery_schedule_update_privileged
  ON public.recovery_schedule
  FOR UPDATE
  TO public
  USING (
    auth.uid() IS NOT NULL
    AND org_role(org_id) = ANY (ARRAY[
      'owner'::org_role,
      'admin'::org_role,
      'payroll_manager'::org_role,
      'super_admin'::org_role,
      'head_of_hr'::org_role,
      'hr_national'::org_role,
      'regional_hr'::org_role,
      'hr_manager'::org_role
    ])
  )
  WITH CHECK (
    auth.uid() IS NOT NULL
    AND org_role(org_id) = ANY (ARRAY[
      'owner'::org_role,
      'admin'::org_role,
      'payroll_manager'::org_role,
      'super_admin'::org_role,
      'head_of_hr'::org_role,
      'hr_national'::org_role,
      'regional_hr'::org_role,
      'hr_manager'::org_role
    ])
  );

DROP POLICY IF EXISTS recovery_schedule_delete_privileged ON public.recovery_schedule;
CREATE POLICY recovery_schedule_delete_privileged
  ON public.recovery_schedule
  FOR DELETE
  TO public
  USING (
    auth.uid() IS NOT NULL
    AND org_role(org_id) = ANY (ARRAY[
      'owner'::org_role,
      'admin'::org_role,
      'payroll_manager'::org_role,
      'super_admin'::org_role,
      'head_of_hr'::org_role
    ])
  );
