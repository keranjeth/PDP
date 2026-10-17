-- Phase 6: final / leaver payroll workflow.
-- Adds operational separation case tables in front of the existing archival leavers model.

CREATE TABLE IF NOT EXISTS public.separation_cases (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id uuid NOT NULL REFERENCES public.organizations(id),
  employee_id uuid NOT NULL,
  leaver_id uuid NULL,
  exit_type text NOT NULL,
  reason_code text NULL,
  last_working_date date NOT NULL,
  notice_required_days integer NOT NULL DEFAULT 0,
  notice_served_days integer NOT NULL DEFAULT 0,
  notice_action text NOT NULL DEFAULT 'none',
  eligible_for_leave_encashment boolean NOT NULL DEFAULT false,
  eligible_for_termination_benefit boolean NOT NULL DEFAULT false,
  status text NOT NULL DEFAULT 'draft',
  settlement_summary jsonb NOT NULL DEFAULT '{}'::jsonb,
  notes text NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  created_by uuid NULL,
  updated_at timestamptz NOT NULL DEFAULT now(),
  updated_by uuid NULL,
  approved_at timestamptz NULL,
  approved_by uuid NULL,
  settled_at timestamptz NULL,
  settled_by uuid NULL,
  CONSTRAINT separation_cases_org_id_id_key UNIQUE (org_id, id),
  CONSTRAINT separation_cases_exit_type_chk
    CHECK (exit_type IN ('resignation', 'termination', 'retirement', 'end_of_contract', 'death', 'redundancy', 'other')),
  CONSTRAINT separation_cases_notice_action_chk
    CHECK (notice_action IN ('none', 'pay_in_lieu', 'deduct_unserved')),
  CONSTRAINT separation_cases_status_chk
    CHECK (status IN ('draft', 'pending_approval', 'approved', 'ready_for_payroll', 'settled', 'archived', 'cancelled')),
  CONSTRAINT separation_cases_notice_required_days_chk
    CHECK (notice_required_days >= 0),
  CONSTRAINT separation_cases_notice_served_days_chk
    CHECK (notice_served_days >= 0)
);

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM pg_constraint
    WHERE conrelid = 'public.separation_cases'::regclass
      AND conname = 'separation_cases_employee_fk'
  ) THEN
    ALTER TABLE public.separation_cases
      ADD CONSTRAINT separation_cases_employee_fk
      FOREIGN KEY (org_id, employee_id)
      REFERENCES public.employees (org_id, id)
      ON UPDATE RESTRICT
      ON DELETE RESTRICT;
  END IF;

  IF NOT EXISTS (
    SELECT 1
    FROM pg_constraint
    WHERE conrelid = 'public.separation_cases'::regclass
      AND conname = 'separation_cases_leaver_fk'
  ) THEN
    ALTER TABLE public.separation_cases
      ADD CONSTRAINT separation_cases_leaver_fk
      FOREIGN KEY (leaver_id)
      REFERENCES public.leavers (leaver_id)
      ON UPDATE RESTRICT
      ON DELETE SET NULL;
  END IF;
END $$;

CREATE INDEX IF NOT EXISTS separation_cases_org_status_last_working_idx
  ON public.separation_cases (org_id, status, last_working_date DESC);

CREATE INDEX IF NOT EXISTS separation_cases_org_employee_last_working_idx
  ON public.separation_cases (org_id, employee_id, last_working_date DESC);

CREATE UNIQUE INDEX IF NOT EXISTS separation_cases_one_active_case_per_employee_idx
  ON public.separation_cases (org_id, employee_id)
  WHERE status IN ('draft', 'pending_approval', 'approved', 'ready_for_payroll');

COMMENT ON TABLE public.separation_cases IS
  'Operational final-pay workflow before archival offboarding. Linked optionally to leavers once offboarding is completed.';

CREATE TABLE IF NOT EXISTS public.separation_case_lines (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id uuid NOT NULL REFERENCES public.organizations(id),
  separation_case_id uuid NOT NULL,
  component_catalog_id uuid NULL,
  line_code text NOT NULL,
  description text NOT NULL,
  amount numeric NOT NULL,
  basis_jsonb NOT NULL DEFAULT '{}'::jsonb,
  policy_version_id uuid NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  created_by uuid NULL,
  updated_at timestamptz NOT NULL DEFAULT now(),
  updated_by uuid NULL,
  CONSTRAINT separation_case_lines_org_id_id_key UNIQUE (org_id, id),
  CONSTRAINT separation_case_lines_line_code_chk
    CHECK (line_code IN (
      'leave_encashment',
      'notice_payment',
      'notice_deduction',
      'termination_benefit',
      'salary_advance_repayment',
      'recovery',
      'payroll_arrears',
      'adjustment',
      'other'
    )),
  CONSTRAINT separation_case_lines_description_chk
    CHECK (btrim(description) <> '')
);

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM pg_constraint
    WHERE conrelid = 'public.separation_case_lines'::regclass
      AND conname = 'separation_case_lines_case_fk'
  ) THEN
    ALTER TABLE public.separation_case_lines
      ADD CONSTRAINT separation_case_lines_case_fk
      FOREIGN KEY (org_id, separation_case_id)
      REFERENCES public.separation_cases (org_id, id)
      ON UPDATE RESTRICT
      ON DELETE CASCADE;
  END IF;

  IF NOT EXISTS (
    SELECT 1
    FROM pg_constraint
    WHERE conrelid = 'public.separation_case_lines'::regclass
      AND conname = 'separation_case_lines_component_catalog_fk'
  ) THEN
    ALTER TABLE public.separation_case_lines
      ADD CONSTRAINT separation_case_lines_component_catalog_fk
      FOREIGN KEY (org_id, component_catalog_id)
      REFERENCES public.pay_component_catalog (org_id, id)
      ON UPDATE RESTRICT
      ON DELETE RESTRICT;
  END IF;

  IF NOT EXISTS (
    SELECT 1
    FROM pg_constraint
    WHERE conrelid = 'public.separation_case_lines'::regclass
      AND conname = 'separation_case_lines_policy_version_fk'
  ) THEN
    ALTER TABLE public.separation_case_lines
      ADD CONSTRAINT separation_case_lines_policy_version_fk
      FOREIGN KEY (org_id, policy_version_id)
      REFERENCES public.payroll_policy_versions (org_id, id)
      ON UPDATE RESTRICT
      ON DELETE SET NULL;
  END IF;
END $$;

CREATE INDEX IF NOT EXISTS separation_case_lines_org_case_created_idx
  ON public.separation_case_lines (org_id, separation_case_id, created_at);

COMMENT ON TABLE public.separation_case_lines IS
  'Typed settlement lines for final/leaver payroll before they are posted into final payroll runs.';

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM pg_constraint
    WHERE conrelid = 'public.payroll_run_employees'::regclass
      AND conname = 'payroll_run_employees_separation_case_fk'
  ) THEN
    ALTER TABLE public.payroll_run_employees
      ADD CONSTRAINT payroll_run_employees_separation_case_fk
      FOREIGN KEY (org_id, separation_case_id)
      REFERENCES public.separation_cases (org_id, id)
      ON UPDATE RESTRICT
      ON DELETE SET NULL;
  END IF;
END $$;

CREATE OR REPLACE FUNCTION public.refresh_separation_case_summary()
RETURNS trigger
LANGUAGE plpgsql
AS $$
DECLARE
  target_case_id uuid;
  target_org_id uuid;
BEGIN
  target_case_id := COALESCE(NEW.separation_case_id, OLD.separation_case_id);
  target_org_id := COALESCE(NEW.org_id, OLD.org_id);

  UPDATE public.separation_cases sc
  SET
    settlement_summary = jsonb_build_object(
      'lineCount', COALESCE(stats.line_count, 0),
      'grossSettlement', COALESCE(stats.gross_amount, 0),
      'netSettlement', COALESCE(stats.net_amount, 0),
      'lineCodes', COALESCE(stats.line_codes, '[]'::jsonb)
    ),
    updated_at = now()
  FROM (
    SELECT
      COUNT(*)::integer AS line_count,
      COALESCE(SUM(CASE WHEN amount > 0 THEN amount ELSE 0 END), 0) AS gross_amount,
      COALESCE(SUM(amount), 0) AS net_amount,
      COALESCE(jsonb_agg(line_code ORDER BY created_at), '[]'::jsonb) AS line_codes
    FROM public.separation_case_lines
    WHERE separation_case_id = target_case_id
      AND org_id = target_org_id
  ) AS stats
  WHERE sc.id = target_case_id
    AND sc.org_id = target_org_id;

  RETURN COALESCE(NEW, OLD);
END;
$$;

DROP TRIGGER IF EXISTS trg_refresh_separation_case_summary
  ON public.separation_case_lines;

CREATE TRIGGER trg_refresh_separation_case_summary
  AFTER INSERT OR UPDATE OR DELETE
  ON public.separation_case_lines
  FOR EACH ROW
  EXECUTE FUNCTION public.refresh_separation_case_summary();

CREATE OR REPLACE FUNCTION public.stamp_separation_case_status()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  IF NEW.status IN ('approved', 'ready_for_payroll', 'settled', 'archived')
     AND COALESCE(NEW.approved_at, OLD.approved_at) IS NULL THEN
    NEW.approved_at := now();
  END IF;

  IF NEW.status IN ('settled', 'archived')
     AND COALESCE(NEW.settled_at, OLD.settled_at) IS NULL THEN
    NEW.settled_at := now();
  END IF;

  NEW.updated_at := now();
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_stamp_separation_case_status
  ON public.separation_cases;

CREATE TRIGGER trg_stamp_separation_case_status
  BEFORE UPDATE
  ON public.separation_cases
  FOR EACH ROW
  EXECUTE FUNCTION public.stamp_separation_case_status();

CREATE OR REPLACE FUNCTION public.prevent_finalized_separation_mutation()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  IF OLD.status IN ('settled', 'archived', 'cancelled') THEN
    RAISE EXCEPTION 'Finalized separation record is immutable' USING ERRCODE = '23514';
  END IF;
  RETURN COALESCE(NEW, OLD);
END;
$$;

CREATE OR REPLACE FUNCTION public.prevent_finalized_separation_case_line_mutation()
RETURNS trigger
LANGUAGE plpgsql
AS $$
DECLARE
  case_status text;
  case_id uuid;
  org_scope uuid;
BEGIN
  case_id := COALESCE(NEW.separation_case_id, OLD.separation_case_id);
  org_scope := COALESCE(NEW.org_id, OLD.org_id);

  SELECT status
  INTO case_status
  FROM public.separation_cases
  WHERE id = case_id
    AND org_id = org_scope;

  IF case_status IN ('settled', 'archived', 'cancelled') THEN
    RAISE EXCEPTION 'Finalized separation record is immutable' USING ERRCODE = '23514';
  END IF;

  RETURN COALESCE(NEW, OLD);
END;
$$;

DROP TRIGGER IF EXISTS trg_prevent_finalized_separation_case_mutation
  ON public.separation_cases;

CREATE TRIGGER trg_prevent_finalized_separation_case_mutation
  BEFORE UPDATE OR DELETE
  ON public.separation_cases
  FOR EACH ROW
  EXECUTE FUNCTION public.prevent_finalized_separation_mutation();

DROP TRIGGER IF EXISTS trg_prevent_finalized_separation_case_line_mutation
  ON public.separation_case_lines;

CREATE TRIGGER trg_prevent_finalized_separation_case_line_mutation
  BEFORE INSERT OR UPDATE OR DELETE
  ON public.separation_case_lines
  FOR EACH ROW
  EXECUTE FUNCTION public.prevent_finalized_separation_case_line_mutation();

ALTER TABLE public.separation_cases ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.separation_case_lines ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS separation_cases_select_scoped ON public.separation_cases;
CREATE POLICY separation_cases_select_scoped
  ON public.separation_cases
  FOR SELECT
  TO public
  USING (auth.uid() IS NOT NULL AND org_role(org_id) IS NOT NULL);

DROP POLICY IF EXISTS separation_cases_insert_privileged ON public.separation_cases;
CREATE POLICY separation_cases_insert_privileged
  ON public.separation_cases
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

DROP POLICY IF EXISTS separation_cases_update_privileged ON public.separation_cases;
CREATE POLICY separation_cases_update_privileged
  ON public.separation_cases
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

DROP POLICY IF EXISTS separation_cases_delete_privileged ON public.separation_cases;
CREATE POLICY separation_cases_delete_privileged
  ON public.separation_cases
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

DROP POLICY IF EXISTS separation_case_lines_select_scoped ON public.separation_case_lines;
CREATE POLICY separation_case_lines_select_scoped
  ON public.separation_case_lines
  FOR SELECT
  TO public
  USING (auth.uid() IS NOT NULL AND org_role(org_id) IS NOT NULL);

DROP POLICY IF EXISTS separation_case_lines_insert_privileged ON public.separation_case_lines;
CREATE POLICY separation_case_lines_insert_privileged
  ON public.separation_case_lines
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

DROP POLICY IF EXISTS separation_case_lines_update_privileged ON public.separation_case_lines;
CREATE POLICY separation_case_lines_update_privileged
  ON public.separation_case_lines
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

DROP POLICY IF EXISTS separation_case_lines_delete_privileged ON public.separation_case_lines;
CREATE POLICY separation_case_lines_delete_privileged
  ON public.separation_case_lines
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
