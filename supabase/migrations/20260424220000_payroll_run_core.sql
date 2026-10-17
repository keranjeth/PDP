-- Phase 2: payroll run core.
-- Introduces run-based payroll domain tables while keeping payroll_months/payroll_records
-- as the active compatibility layer during transition.

CREATE OR REPLACE FUNCTION public.set_row_updated_at()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  NEW.updated_at := now();
  RETURN NEW;
END;
$$;

CREATE TABLE IF NOT EXISTS public.payroll_periods (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id uuid NOT NULL REFERENCES public.organizations(id),
  period_code text NOT NULL,
  period_type text NOT NULL DEFAULT 'regular_monthly',
  period_start date NOT NULL,
  period_end date NOT NULL,
  payment_date date NULL,
  cutoff_date date NULL,
  status text NOT NULL DEFAULT 'planned',
  legacy_payroll_month_id uuid NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  created_by uuid NULL,
  updated_at timestamptz NOT NULL DEFAULT now(),
  updated_by uuid NULL,
  CONSTRAINT payroll_periods_org_id_id_key UNIQUE (org_id, id),
  CONSTRAINT payroll_periods_org_code_key UNIQUE (org_id, period_code),
  CONSTRAINT payroll_periods_org_legacy_month_key UNIQUE (org_id, legacy_payroll_month_id),
  CONSTRAINT payroll_periods_period_type_chk
    CHECK (period_type IN ('regular_monthly', 'offcycle', 'final')),
  CONSTRAINT payroll_periods_status_chk
    CHECK (status IN ('planned', 'open', 'closed', 'archived')),
  CONSTRAINT payroll_periods_date_range_chk
    CHECK (period_end >= period_start),
  CONSTRAINT payroll_periods_code_chk
    CHECK (period_code ~ '^[a-zA-Z0-9][a-zA-Z0-9_-]*$')
);

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM pg_constraint
    WHERE conrelid = 'public.payroll_periods'::regclass
      AND conname = 'payroll_periods_legacy_month_fk'
  ) THEN
    ALTER TABLE public.payroll_periods
      ADD CONSTRAINT payroll_periods_legacy_month_fk
      FOREIGN KEY (org_id, legacy_payroll_month_id)
      REFERENCES public.payroll_months (org_id, id)
      ON UPDATE RESTRICT
      ON DELETE SET NULL;
  END IF;
END $$;

CREATE INDEX IF NOT EXISTS payroll_periods_org_status_start_idx
  ON public.payroll_periods (org_id, status, period_start DESC);

CREATE INDEX IF NOT EXISTS payroll_periods_org_type_start_idx
  ON public.payroll_periods (org_id, period_type, period_start DESC);

COMMENT ON TABLE public.payroll_periods IS
  'Run-based payroll period registry. During transition, monthly payroll_months rows are mirrored here via legacy_payroll_month_id.';

COMMENT ON COLUMN public.payroll_periods.legacy_payroll_month_id IS
  'Compatibility bridge to legacy payroll_months while the current month-based app flow remains active.';

DROP TRIGGER IF EXISTS trg_payroll_periods_set_updated_at
  ON public.payroll_periods;

CREATE TRIGGER trg_payroll_periods_set_updated_at
  BEFORE UPDATE
  ON public.payroll_periods
  FOR EACH ROW
  EXECUTE FUNCTION public.set_row_updated_at();

CREATE OR REPLACE FUNCTION public.sync_payroll_month_to_period()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  start_date date;
  end_date date;
  next_status text;
BEGIN
  start_date := to_date(NEW.month_key || '-01', 'YYYY-MM-DD');
  end_date := (start_date + INTERVAL '1 month' - INTERVAL '1 day')::date;
  next_status := CASE
    WHEN NEW.status = 'open' THEN 'open'
    ELSE 'closed'
  END;

  INSERT INTO public.payroll_periods (
    org_id,
    period_code,
    period_type,
    period_start,
    period_end,
    payment_date,
    cutoff_date,
    status,
    legacy_payroll_month_id,
    created_at,
    updated_at
  )
  VALUES (
    NEW.org_id,
    NEW.month_key,
    'regular_monthly',
    start_date,
    end_date,
    NULL,
    NULL,
    next_status,
    NEW.id,
    COALESCE(NEW.opened_at, now()),
    now()
  )
  ON CONFLICT (org_id, period_code) DO UPDATE
  SET
    period_type = EXCLUDED.period_type,
    period_start = EXCLUDED.period_start,
    period_end = EXCLUDED.period_end,
    status = EXCLUDED.status,
    legacy_payroll_month_id = EXCLUDED.legacy_payroll_month_id,
    updated_at = now();

  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_sync_payroll_month_to_period
  ON public.payroll_months;

CREATE TRIGGER trg_sync_payroll_month_to_period
  AFTER INSERT OR UPDATE OF month_key, status, opened_at, closed_at
  ON public.payroll_months
  FOR EACH ROW
  EXECUTE FUNCTION public.sync_payroll_month_to_period();

INSERT INTO public.payroll_periods (
  org_id,
  period_code,
  period_type,
  period_start,
  period_end,
  payment_date,
  cutoff_date,
  status,
  legacy_payroll_month_id,
  created_at,
  updated_at
)
SELECT
  pm.org_id,
  pm.month_key,
  'regular_monthly',
  to_date(pm.month_key || '-01', 'YYYY-MM-DD'),
  (to_date(pm.month_key || '-01', 'YYYY-MM-DD') + INTERVAL '1 month' - INTERVAL '1 day')::date,
  NULL,
  NULL,
  CASE WHEN pm.status = 'open' THEN 'open' ELSE 'closed' END,
  pm.id,
  COALESCE(pm.opened_at, now()),
  now()
FROM public.payroll_months pm
ON CONFLICT (org_id, period_code) DO UPDATE
SET
  status = EXCLUDED.status,
  legacy_payroll_month_id = EXCLUDED.legacy_payroll_month_id,
  updated_at = now();

CREATE TABLE IF NOT EXISTS public.payroll_runs (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id uuid NOT NULL REFERENCES public.organizations(id),
  payroll_period_id uuid NOT NULL,
  run_code text NOT NULL,
  run_type text NOT NULL,
  status text NOT NULL DEFAULT 'draft',
  default_policy_version_id uuid NULL,
  calculation_snapshot jsonb NOT NULL DEFAULT '{}'::jsonb,
  started_at timestamptz NULL,
  approved_at timestamptz NULL,
  posted_at timestamptz NULL,
  closed_at timestamptz NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  created_by uuid NULL,
  updated_at timestamptz NOT NULL DEFAULT now(),
  updated_by uuid NULL,
  approved_by uuid NULL,
  closed_by uuid NULL,
  CONSTRAINT payroll_runs_org_id_id_key UNIQUE (org_id, id),
  CONSTRAINT payroll_runs_org_code_key UNIQUE (org_id, run_code),
  CONSTRAINT payroll_runs_run_type_chk
    CHECK (run_type IN ('regular', 'offcycle', 'final', 'corrective')),
  CONSTRAINT payroll_runs_status_chk
    CHECK (status IN ('draft', 'calculating', 'review', 'approved', 'posted', 'closed', 'void')),
  CONSTRAINT payroll_runs_code_chk
    CHECK (run_code ~ '^[a-zA-Z0-9][a-zA-Z0-9_-]*$')
);

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM pg_constraint
    WHERE conrelid = 'public.payroll_runs'::regclass
      AND conname = 'payroll_runs_payroll_period_fk'
  ) THEN
    ALTER TABLE public.payroll_runs
      ADD CONSTRAINT payroll_runs_payroll_period_fk
      FOREIGN KEY (org_id, payroll_period_id)
      REFERENCES public.payroll_periods (org_id, id)
      ON UPDATE RESTRICT
      ON DELETE RESTRICT;
  END IF;
END $$;

CREATE INDEX IF NOT EXISTS payroll_runs_org_status_created_idx
  ON public.payroll_runs (org_id, status, created_at DESC);

CREATE INDEX IF NOT EXISTS payroll_runs_org_period_idx
  ON public.payroll_runs (org_id, payroll_period_id, created_at DESC);

COMMENT ON TABLE public.payroll_runs IS
  'Payroll run header. New payroll execution domain; legacy payroll_records remains untouched during transition.';

COMMENT ON COLUMN public.payroll_runs.default_policy_version_id IS
  'Phase 3 placeholder. Will become a FK to payroll_policy_versions when the policy framework is introduced.';

CREATE OR REPLACE FUNCTION public.payroll_run_status_can_transition(from_status text, to_status text)
RETURNS boolean
LANGUAGE sql
IMMUTABLE
AS $$
  SELECT CASE
    WHEN from_status IS NULL THEN to_status = 'draft'
    WHEN from_status = to_status THEN true
    WHEN from_status = 'draft' AND to_status IN ('calculating', 'review', 'void') THEN true
    WHEN from_status = 'calculating' AND to_status IN ('review', 'void') THEN true
    WHEN from_status = 'review' AND to_status IN ('calculating', 'approved', 'void') THEN true
    WHEN from_status = 'approved' AND to_status IN ('posted', 'closed', 'void') THEN true
    WHEN from_status = 'posted' AND to_status = 'closed' THEN true
    ELSE false
  END;
$$;

CREATE OR REPLACE FUNCTION public.enforce_payroll_run_lifecycle()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  IF TG_OP = 'INSERT' THEN
    IF NEW.status IS NULL THEN
      NEW.status := 'draft';
    END IF;
    IF NEW.status <> 'draft' AND NEW.started_at IS NULL THEN
      NEW.started_at := now();
    END IF;
    IF NEW.status = 'approved' AND NEW.approved_at IS NULL THEN
      NEW.approved_at := now();
    END IF;
    IF NEW.status = 'posted' AND NEW.posted_at IS NULL THEN
      NEW.posted_at := now();
    END IF;
    IF NEW.status = 'closed' AND NEW.closed_at IS NULL THEN
      NEW.closed_at := now();
    END IF;
    RETURN NEW;
  END IF;

  IF OLD.status IN ('closed', 'void') THEN
    RAISE EXCEPTION 'Finalized payroll run is immutable' USING ERRCODE = '23514';
  END IF;

  IF NOT public.payroll_run_status_can_transition(OLD.status, NEW.status) THEN
    RAISE EXCEPTION 'Invalid payroll run status transition: % -> %', OLD.status, NEW.status
      USING ERRCODE = '23514';
  END IF;

  IF OLD.status <> 'draft' AND (
    NEW.org_id IS DISTINCT FROM OLD.org_id
    OR NEW.payroll_period_id IS DISTINCT FROM OLD.payroll_period_id
    OR NEW.run_code IS DISTINCT FROM OLD.run_code
    OR NEW.run_type IS DISTINCT FROM OLD.run_type
  ) THEN
    RAISE EXCEPTION 'Run identity fields are immutable once the run leaves draft'
      USING ERRCODE = '23514';
  END IF;

  IF NEW.status IN ('calculating', 'review', 'approved', 'posted', 'closed')
     AND COALESCE(NEW.started_at, OLD.started_at) IS NULL THEN
    NEW.started_at := now();
  END IF;

  IF NEW.status = 'approved' AND COALESCE(NEW.approved_at, OLD.approved_at) IS NULL THEN
    NEW.approved_at := now();
  END IF;

  IF NEW.status = 'posted' AND COALESCE(NEW.posted_at, OLD.posted_at) IS NULL THEN
    NEW.posted_at := now();
  END IF;

  IF NEW.status = 'closed' AND COALESCE(NEW.closed_at, OLD.closed_at) IS NULL THEN
    NEW.closed_at := now();
  END IF;

  NEW.updated_at := now();
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_enforce_payroll_run_lifecycle
  ON public.payroll_runs;

CREATE TRIGGER trg_enforce_payroll_run_lifecycle
  BEFORE INSERT OR UPDATE
  ON public.payroll_runs
  FOR EACH ROW
  EXECUTE FUNCTION public.enforce_payroll_run_lifecycle();

CREATE TABLE IF NOT EXISTS public.payroll_run_employees (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id uuid NOT NULL REFERENCES public.organizations(id),
  payroll_run_id uuid NOT NULL,
  employee_id uuid NOT NULL,
  separation_case_id uuid NULL,
  applied_policy_version_id uuid NULL,
  status text NOT NULL DEFAULT 'draft',
  employee_snapshot jsonb NOT NULL DEFAULT '{}'::jsonb,
  compensation_snapshot jsonb NOT NULL DEFAULT '{}'::jsonb,
  input_summary jsonb NOT NULL DEFAULT '{}'::jsonb,
  calc_summary jsonb NOT NULL DEFAULT '{}'::jsonb,
  exception_summary jsonb NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT payroll_run_employees_org_id_id_key UNIQUE (org_id, id),
  CONSTRAINT payroll_run_employees_run_employee_key UNIQUE (payroll_run_id, employee_id),
  CONSTRAINT payroll_run_employees_status_chk
    CHECK (status IN ('draft', 'calculated', 'approved', 'posted', 'closed', 'excluded', 'error'))
);

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM pg_constraint
    WHERE conrelid = 'public.payroll_run_employees'::regclass
      AND conname = 'payroll_run_employees_run_fk'
  ) THEN
    ALTER TABLE public.payroll_run_employees
      ADD CONSTRAINT payroll_run_employees_run_fk
      FOREIGN KEY (org_id, payroll_run_id)
      REFERENCES public.payroll_runs (org_id, id)
      ON UPDATE RESTRICT
      ON DELETE CASCADE;
  END IF;

  IF NOT EXISTS (
    SELECT 1
    FROM pg_constraint
    WHERE conrelid = 'public.payroll_run_employees'::regclass
      AND conname = 'payroll_run_employees_employee_fk'
  ) THEN
    ALTER TABLE public.payroll_run_employees
      ADD CONSTRAINT payroll_run_employees_employee_fk
      FOREIGN KEY (org_id, employee_id)
      REFERENCES public.employees (org_id, id)
      ON UPDATE RESTRICT
      ON DELETE RESTRICT;
  END IF;
END $$;

CREATE INDEX IF NOT EXISTS payroll_run_employees_org_run_status_idx
  ON public.payroll_run_employees (org_id, payroll_run_id, status, created_at DESC);

CREATE INDEX IF NOT EXISTS payroll_run_employees_org_employee_idx
  ON public.payroll_run_employees (org_id, employee_id, created_at DESC);

COMMENT ON TABLE public.payroll_run_employees IS
  'One settlement row per employee per payroll run. Carries frozen employee and compensation snapshots plus summarized inputs/calculations.';

COMMENT ON COLUMN public.payroll_run_employees.applied_policy_version_id IS
  'Phase 3 placeholder. Will become a FK to payroll_policy_versions when policy tables exist.';

COMMENT ON COLUMN public.payroll_run_employees.separation_case_id IS
  'Phase 6 placeholder. Will become a FK to separation_cases when final payroll support is introduced.';

CREATE OR REPLACE FUNCTION public.set_payroll_run_employee_snapshot()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  e public.employees%ROWTYPE;
BEGIN
  IF TG_OP = 'UPDATE'
     AND NEW.employee_snapshot <> '{}'::jsonb
     AND NEW.employee_id = OLD.employee_id THEN
    RETURN NEW;
  END IF;

  SELECT *
  INTO e
  FROM public.employees
  WHERE id = NEW.employee_id
    AND org_id = NEW.org_id;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Employee not found for payroll run snapshot (org_id %, employee_id %)', NEW.org_id, NEW.employee_id
      USING ERRCODE = '23503';
  END IF;

  NEW.employee_snapshot = jsonb_build_object(
    'idNumber', e.id_number,
    'fullName', e.full_name,
    'gender', e.gender,
    'positionNumber', e.position_number,
    'designation', e.designation,
    'staffingCategory', e.staffing_category,
    'department', e.department,
    'unit', e.unit,
    'region', e.region,
    'dutyStation', e.duty_station,
    'jobLocation', e.job_location,
    'contractType', e.contract_type,
    'jobStatus', e.job_status,
    'employmentStatus', e.employment_status,
    'joiningDate', e.joining_date,
    'contractStartDate', e.contract_start_date,
    'contractEndDate', e.contract_end_date,
    'currency', e.currency
  );

  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_payroll_run_employee_snapshot
  ON public.payroll_run_employees;

CREATE TRIGGER trg_payroll_run_employee_snapshot
  BEFORE INSERT OR UPDATE OF employee_id, employee_snapshot
  ON public.payroll_run_employees
  FOR EACH ROW
  EXECUTE FUNCTION public.set_payroll_run_employee_snapshot();

CREATE OR REPLACE FUNCTION public.assert_payroll_run_mutable(target_run_id uuid)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  run_status text;
BEGIN
  SELECT status
  INTO run_status
  FROM public.payroll_runs
  WHERE id = target_run_id;

  IF run_status IS NULL THEN
    RAISE EXCEPTION 'Payroll run not found for mutation guard (run_id %)', target_run_id
      USING ERRCODE = '23503';
  END IF;

  IF run_status IN ('posted', 'closed', 'void') THEN
    RAISE EXCEPTION 'Finalized payroll run is immutable' USING ERRCODE = '23514';
  END IF;
END;
$$;

CREATE OR REPLACE FUNCTION public.guard_payroll_run_employee_mutation()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  IF TG_OP = 'DELETE' THEN
    PERFORM public.assert_payroll_run_mutable(OLD.payroll_run_id);
    RETURN OLD;
  END IF;

  PERFORM public.assert_payroll_run_mutable(NEW.payroll_run_id);
  IF TG_OP = 'UPDATE' THEN
    NEW.updated_at := now();
    RETURN NEW;
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_guard_payroll_run_employee_mutation
  ON public.payroll_run_employees;

CREATE TRIGGER trg_guard_payroll_run_employee_mutation
  BEFORE INSERT OR UPDATE OR DELETE
  ON public.payroll_run_employees
  FOR EACH ROW
  EXECUTE FUNCTION public.guard_payroll_run_employee_mutation();

CREATE TABLE IF NOT EXISTS public.payroll_run_lines (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id uuid NOT NULL REFERENCES public.organizations(id),
  payroll_run_employee_id uuid NOT NULL,
  component_catalog_id uuid NULL,
  line_type text NOT NULL,
  source_type text NOT NULL,
  source_id uuid NULL,
  line_code text NOT NULL,
  description text NOT NULL,
  quantity numeric NULL,
  rate numeric NULL,
  amount numeric NOT NULL DEFAULT 0,
  taxable_amount numeric NOT NULL DEFAULT 0,
  pensionable_amount numeric NOT NULL DEFAULT 0,
  display_sequence integer NOT NULL DEFAULT 0,
  metadata jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT payroll_run_lines_org_id_id_key UNIQUE (org_id, id),
  CONSTRAINT payroll_run_lines_line_type_chk
    CHECK (line_type IN ('earning', 'deduction', 'employer_contribution', 'accrual')),
  CONSTRAINT payroll_run_lines_source_type_chk
    CHECK (source_type IN (
      'compensation_record',
      'payroll_input',
      'manual_adjustment',
      'overtime_entry',
      'policy_rule',
      'calculation_output',
      'legacy_payroll_record',
      'manual_entry',
      'derived_line'
    )),
  CONSTRAINT payroll_run_lines_code_chk
    CHECK (line_code ~ '^[a-zA-Z0-9][a-zA-Z0-9_-]*$'),
  CONSTRAINT payroll_run_lines_description_chk
    CHECK (btrim(description) <> ''),
  CONSTRAINT payroll_run_lines_display_sequence_chk
    CHECK (display_sequence >= 0),
  CONSTRAINT payroll_run_lines_amount_chk
    CHECK (amount >= 0),
  CONSTRAINT payroll_run_lines_taxable_amount_chk
    CHECK (taxable_amount >= 0),
  CONSTRAINT payroll_run_lines_pensionable_amount_chk
    CHECK (pensionable_amount >= 0),
  CONSTRAINT payroll_run_lines_quantity_chk
    CHECK (quantity IS NULL OR quantity >= 0),
  CONSTRAINT payroll_run_lines_rate_chk
    CHECK (rate IS NULL OR rate >= 0)
);

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM pg_constraint
    WHERE conrelid = 'public.payroll_run_lines'::regclass
      AND conname = 'payroll_run_lines_run_employee_fk'
  ) THEN
    ALTER TABLE public.payroll_run_lines
      ADD CONSTRAINT payroll_run_lines_run_employee_fk
      FOREIGN KEY (org_id, payroll_run_employee_id)
      REFERENCES public.payroll_run_employees (org_id, id)
      ON UPDATE RESTRICT
      ON DELETE CASCADE;
  END IF;

  IF NOT EXISTS (
    SELECT 1
    FROM pg_constraint
    WHERE conrelid = 'public.payroll_run_lines'::regclass
      AND conname = 'payroll_run_lines_component_catalog_fk'
  ) THEN
    ALTER TABLE public.payroll_run_lines
      ADD CONSTRAINT payroll_run_lines_component_catalog_fk
      FOREIGN KEY (org_id, component_catalog_id)
      REFERENCES public.pay_component_catalog (org_id, id)
      ON UPDATE RESTRICT
      ON DELETE RESTRICT;
  END IF;
END $$;

CREATE INDEX IF NOT EXISTS payroll_run_lines_run_employee_type_sequence_idx
  ON public.payroll_run_lines (payroll_run_employee_id, line_type, display_sequence);

CREATE INDEX IF NOT EXISTS payroll_run_lines_org_component_idx
  ON public.payroll_run_lines (org_id, component_catalog_id)
  WHERE component_catalog_id IS NOT NULL;

COMMENT ON TABLE public.payroll_run_lines IS
  'Detailed payroll run line items. Phase 2 foundation for typed earnings, deductions, employer-side values, and accrual outputs.';

CREATE OR REPLACE FUNCTION public.guard_payroll_run_line_mutation()
RETURNS trigger
LANGUAGE plpgsql
AS $$
DECLARE
  target_run_id uuid;
BEGIN
  IF TG_OP = 'DELETE' THEN
    SELECT pre.payroll_run_id
    INTO target_run_id
    FROM public.payroll_run_employees pre
    WHERE pre.id = OLD.payroll_run_employee_id
      AND pre.org_id = OLD.org_id;

    PERFORM public.assert_payroll_run_mutable(target_run_id);
    RETURN OLD;
  END IF;

  SELECT pre.payroll_run_id
  INTO target_run_id
  FROM public.payroll_run_employees pre
  WHERE pre.id = NEW.payroll_run_employee_id
    AND pre.org_id = NEW.org_id;

  PERFORM public.assert_payroll_run_mutable(target_run_id);

  IF TG_OP = 'UPDATE' THEN
    NEW.updated_at := now();
    RETURN NEW;
  END IF;

  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_guard_payroll_run_line_mutation
  ON public.payroll_run_lines;

CREATE TRIGGER trg_guard_payroll_run_line_mutation
  BEFORE INSERT OR UPDATE OR DELETE
  ON public.payroll_run_lines
  FOR EACH ROW
  EXECUTE FUNCTION public.guard_payroll_run_line_mutation();

ALTER TABLE public.payroll_periods ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.payroll_runs ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.payroll_run_employees ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.payroll_run_lines ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS payroll_periods_select_scoped ON public.payroll_periods;
CREATE POLICY payroll_periods_select_scoped
  ON public.payroll_periods
  FOR SELECT
  TO public
  USING (auth.uid() IS NOT NULL AND org_role(org_id) IS NOT NULL);

DROP POLICY IF EXISTS payroll_periods_insert_privileged ON public.payroll_periods;
CREATE POLICY payroll_periods_insert_privileged
  ON public.payroll_periods
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

DROP POLICY IF EXISTS payroll_periods_update_privileged ON public.payroll_periods;
CREATE POLICY payroll_periods_update_privileged
  ON public.payroll_periods
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

DROP POLICY IF EXISTS payroll_periods_delete_privileged ON public.payroll_periods;
CREATE POLICY payroll_periods_delete_privileged
  ON public.payroll_periods
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

DROP POLICY IF EXISTS payroll_runs_select_scoped ON public.payroll_runs;
CREATE POLICY payroll_runs_select_scoped
  ON public.payroll_runs
  FOR SELECT
  TO public
  USING (auth.uid() IS NOT NULL AND org_role(org_id) IS NOT NULL);

DROP POLICY IF EXISTS payroll_runs_insert_privileged ON public.payroll_runs;
CREATE POLICY payroll_runs_insert_privileged
  ON public.payroll_runs
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

DROP POLICY IF EXISTS payroll_runs_update_privileged ON public.payroll_runs;
CREATE POLICY payroll_runs_update_privileged
  ON public.payroll_runs
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

DROP POLICY IF EXISTS payroll_runs_delete_privileged ON public.payroll_runs;
CREATE POLICY payroll_runs_delete_privileged
  ON public.payroll_runs
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

DROP POLICY IF EXISTS payroll_run_employees_select_scoped ON public.payroll_run_employees;
CREATE POLICY payroll_run_employees_select_scoped
  ON public.payroll_run_employees
  FOR SELECT
  TO public
  USING (auth.uid() IS NOT NULL AND org_role(org_id) IS NOT NULL);

DROP POLICY IF EXISTS payroll_run_employees_insert_privileged ON public.payroll_run_employees;
CREATE POLICY payroll_run_employees_insert_privileged
  ON public.payroll_run_employees
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

DROP POLICY IF EXISTS payroll_run_employees_update_privileged ON public.payroll_run_employees;
CREATE POLICY payroll_run_employees_update_privileged
  ON public.payroll_run_employees
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

DROP POLICY IF EXISTS payroll_run_employees_delete_privileged ON public.payroll_run_employees;
CREATE POLICY payroll_run_employees_delete_privileged
  ON public.payroll_run_employees
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

DROP POLICY IF EXISTS payroll_run_lines_select_scoped ON public.payroll_run_lines;
CREATE POLICY payroll_run_lines_select_scoped
  ON public.payroll_run_lines
  FOR SELECT
  TO public
  USING (auth.uid() IS NOT NULL AND org_role(org_id) IS NOT NULL);

DROP POLICY IF EXISTS payroll_run_lines_insert_privileged ON public.payroll_run_lines;
CREATE POLICY payroll_run_lines_insert_privileged
  ON public.payroll_run_lines
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

DROP POLICY IF EXISTS payroll_run_lines_update_privileged ON public.payroll_run_lines;
CREATE POLICY payroll_run_lines_update_privileged
  ON public.payroll_run_lines
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

DROP POLICY IF EXISTS payroll_run_lines_delete_privileged ON public.payroll_run_lines;
CREATE POLICY payroll_run_lines_delete_privileged
  ON public.payroll_run_lines
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
