-- Phase 3: payroll policy framework.
-- Adds effective-dated payroll policy tables and wires payroll runs / run employees
-- to resolved policy versions without changing the current payroll calculation formulas.

CREATE TABLE IF NOT EXISTS public.payroll_policy_sets (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id uuid NOT NULL REFERENCES public.organizations(id),
  policy_name text NOT NULL,
  policy_type text NOT NULL,
  description text NULL,
  status text NOT NULL DEFAULT 'draft',
  created_at timestamptz NOT NULL DEFAULT now(),
  created_by uuid NULL,
  updated_at timestamptz NOT NULL DEFAULT now(),
  updated_by uuid NULL,
  CONSTRAINT payroll_policy_sets_org_id_id_key UNIQUE (org_id, id),
  CONSTRAINT payroll_policy_sets_org_name_type_key UNIQUE (org_id, policy_type, policy_name),
  CONSTRAINT payroll_policy_sets_policy_type_chk
    CHECK (policy_type IN (
      'regular_payroll',
      'offcycle_payroll',
      'final_payroll',
      'overtime',
      'deduction',
      'pension'
    )),
  CONSTRAINT payroll_policy_sets_status_chk
    CHECK (status IN ('draft', 'active', 'archived')),
  CONSTRAINT payroll_policy_sets_name_chk
    CHECK (btrim(policy_name) <> '')
);

CREATE INDEX IF NOT EXISTS payroll_policy_sets_org_type_status_idx
  ON public.payroll_policy_sets (org_id, policy_type, status, created_at DESC);

COMMENT ON TABLE public.payroll_policy_sets IS
  'Stable payroll policy identity. Parent record for effective-dated payroll policy versions.';

CREATE TABLE IF NOT EXISTS public.payroll_policy_versions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id uuid NOT NULL REFERENCES public.organizations(id),
  policy_set_id uuid NOT NULL,
  version_no integer NOT NULL,
  effective_from date NOT NULL,
  effective_to date NULL,
  status text NOT NULL DEFAULT 'draft',
  supersedes_version_id uuid NULL,
  notes text NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  created_by uuid NULL,
  updated_at timestamptz NOT NULL DEFAULT now(),
  updated_by uuid NULL,
  approved_at timestamptz NULL,
  approved_by uuid NULL,
  CONSTRAINT payroll_policy_versions_org_id_id_key UNIQUE (org_id, id),
  CONSTRAINT payroll_policy_versions_set_version_key UNIQUE (policy_set_id, version_no),
  CONSTRAINT payroll_policy_versions_status_chk
    CHECK (status IN ('draft', 'active', 'superseded', 'retired')),
  CONSTRAINT payroll_policy_versions_effective_range_chk
    CHECK (effective_to IS NULL OR effective_to >= effective_from),
  CONSTRAINT payroll_policy_versions_version_no_chk
    CHECK (version_no > 0)
);

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM pg_constraint
    WHERE conrelid = 'public.payroll_policy_versions'::regclass
      AND conname = 'payroll_policy_versions_policy_set_fk'
  ) THEN
    ALTER TABLE public.payroll_policy_versions
      ADD CONSTRAINT payroll_policy_versions_policy_set_fk
      FOREIGN KEY (org_id, policy_set_id)
      REFERENCES public.payroll_policy_sets (org_id, id)
      ON UPDATE RESTRICT
      ON DELETE CASCADE;
  END IF;

  IF NOT EXISTS (
    SELECT 1
    FROM pg_constraint
    WHERE conrelid = 'public.payroll_policy_versions'::regclass
      AND conname = 'payroll_policy_versions_supersedes_fk'
  ) THEN
    ALTER TABLE public.payroll_policy_versions
      ADD CONSTRAINT payroll_policy_versions_supersedes_fk
      FOREIGN KEY (org_id, supersedes_version_id)
      REFERENCES public.payroll_policy_versions (org_id, id)
      ON UPDATE RESTRICT
      ON DELETE SET NULL;
  END IF;
END $$;

CREATE INDEX IF NOT EXISTS payroll_policy_versions_org_status_effective_idx
  ON public.payroll_policy_versions (org_id, status, effective_from DESC, effective_to);

CREATE INDEX IF NOT EXISTS payroll_policy_versions_org_set_effective_idx
  ON public.payroll_policy_versions (org_id, policy_set_id, effective_from DESC);

COMMENT ON TABLE public.payroll_policy_versions IS
  'Effective-dated payroll policy versions. Assigned to payroll runs and payroll run employees.';

CREATE OR REPLACE FUNCTION public.prevent_payroll_policy_version_overlap()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  IF NEW.status = 'active' AND EXISTS (
    SELECT 1
    FROM public.payroll_policy_versions pv
    WHERE pv.org_id = NEW.org_id
      AND pv.policy_set_id = NEW.policy_set_id
      AND pv.id <> COALESCE(NEW.id, '00000000-0000-0000-0000-000000000000'::uuid)
      AND pv.status = 'active'
      AND daterange(
        pv.effective_from,
        COALESCE(pv.effective_to + 1, 'infinity'::date),
        '[)'
      ) && daterange(
        NEW.effective_from,
        COALESCE(NEW.effective_to + 1, 'infinity'::date),
        '[)'
      )
  ) THEN
    RAISE EXCEPTION 'Active payroll policy version effective ranges cannot overlap within the same policy set'
      USING ERRCODE = '23514';
  END IF;

  IF NEW.status = 'active' AND NEW.approved_at IS NULL THEN
    NEW.approved_at := now();
  END IF;

  NEW.updated_at := now();
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_prevent_payroll_policy_version_overlap
  ON public.payroll_policy_versions;

CREATE TRIGGER trg_prevent_payroll_policy_version_overlap
  BEFORE INSERT OR UPDATE
  ON public.payroll_policy_versions
  FOR EACH ROW
  EXECUTE FUNCTION public.prevent_payroll_policy_version_overlap();

CREATE TABLE IF NOT EXISTS public.payroll_policy_scopes (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id uuid NOT NULL REFERENCES public.organizations(id),
  policy_version_id uuid NOT NULL,
  scope_type text NOT NULL,
  scope_operator text NOT NULL DEFAULT 'eq',
  scope_value text NOT NULL,
  priority integer NOT NULL DEFAULT 100,
  created_at timestamptz NOT NULL DEFAULT now(),
  created_by uuid NULL,
  updated_at timestamptz NOT NULL DEFAULT now(),
  updated_by uuid NULL,
  CONSTRAINT payroll_policy_scopes_org_id_id_key UNIQUE (org_id, id),
  CONSTRAINT payroll_policy_scopes_scope_type_chk
    CHECK (scope_type IN (
      'org',
      'region',
      'department',
      'unit',
      'employee',
      'staffing_category',
      'contract_type'
    )),
  CONSTRAINT payroll_policy_scopes_scope_operator_chk
    CHECK (scope_operator IN ('eq', 'in')),
  CONSTRAINT payroll_policy_scopes_scope_value_chk
    CHECK (btrim(scope_value) <> ''),
  CONSTRAINT payroll_policy_scopes_priority_chk
    CHECK (priority >= 0)
);

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM pg_constraint
    WHERE conrelid = 'public.payroll_policy_scopes'::regclass
      AND conname = 'payroll_policy_scopes_version_fk'
  ) THEN
    ALTER TABLE public.payroll_policy_scopes
      ADD CONSTRAINT payroll_policy_scopes_version_fk
      FOREIGN KEY (org_id, policy_version_id)
      REFERENCES public.payroll_policy_versions (org_id, id)
      ON UPDATE RESTRICT
      ON DELETE CASCADE;
  END IF;
END $$;

CREATE INDEX IF NOT EXISTS payroll_policy_scopes_org_version_priority_idx
  ON public.payroll_policy_scopes (org_id, policy_version_id, priority DESC);

COMMENT ON TABLE public.payroll_policy_scopes IS
  'Policy version targeting rules by organization cohort or individual employee.';

CREATE TABLE IF NOT EXISTS public.payroll_policy_rules (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id uuid NOT NULL REFERENCES public.organizations(id),
  policy_version_id uuid NOT NULL,
  rule_type text NOT NULL,
  rule_code text NOT NULL,
  rule_config jsonb NOT NULL DEFAULT '{}'::jsonb,
  is_active boolean NOT NULL DEFAULT true,
  sort_order integer NOT NULL DEFAULT 0,
  created_at timestamptz NOT NULL DEFAULT now(),
  created_by uuid NULL,
  updated_at timestamptz NOT NULL DEFAULT now(),
  updated_by uuid NULL,
  CONSTRAINT payroll_policy_rules_org_id_id_key UNIQUE (org_id, id),
  CONSTRAINT payroll_policy_rules_version_code_key UNIQUE (policy_version_id, rule_code),
  CONSTRAINT payroll_policy_rules_rule_type_chk
    CHECK (rule_type IN (
      'component_config',
      'eligibility',
      'overtime',
      'deduction',
      'pension_display',
      'input_mapping',
      'reporting'
    )),
  CONSTRAINT payroll_policy_rules_rule_code_chk
    CHECK (rule_code ~ '^[a-z][a-z0-9_]*$'),
  CONSTRAINT payroll_policy_rules_sort_order_chk
    CHECK (sort_order >= 0)
);

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM pg_constraint
    WHERE conrelid = 'public.payroll_policy_rules'::regclass
      AND conname = 'payroll_policy_rules_version_fk'
  ) THEN
    ALTER TABLE public.payroll_policy_rules
      ADD CONSTRAINT payroll_policy_rules_version_fk
      FOREIGN KEY (org_id, policy_version_id)
      REFERENCES public.payroll_policy_versions (org_id, id)
      ON UPDATE RESTRICT
      ON DELETE CASCADE;
  END IF;
END $$;

CREATE INDEX IF NOT EXISTS payroll_policy_rules_org_version_active_idx
  ON public.payroll_policy_rules (org_id, policy_version_id, is_active, sort_order);

COMMENT ON TABLE public.payroll_policy_rules IS
  'Generic payroll policy rule registry. The current payroll formulas remain in application code; this table stores future policy configuration metadata.';

CREATE OR REPLACE FUNCTION public.policy_scope_matches(
  p_scope_type text,
  p_scope_operator text,
  p_scope_value text,
  p_org_id uuid,
  p_employee_id uuid,
  p_region text,
  p_department text,
  p_unit text,
  p_staffing_category text,
  p_contract_type text
)
RETURNS boolean
LANGUAGE plpgsql
IMMUTABLE
AS $$
DECLARE
  subject_value text;
  normalized_scope text;
  normalized_subject text;
  value_list text[];
BEGIN
  normalized_scope := lower(trim(COALESCE(p_scope_value, '')));
  subject_value := CASE p_scope_type
    WHEN 'org' THEN lower(p_org_id::text)
    WHEN 'employee' THEN lower(COALESCE(p_employee_id::text, ''))
    WHEN 'region' THEN lower(trim(COALESCE(p_region, '')))
    WHEN 'department' THEN lower(trim(COALESCE(p_department, '')))
    WHEN 'unit' THEN lower(trim(COALESCE(p_unit, '')))
    WHEN 'staffing_category' THEN lower(trim(COALESCE(p_staffing_category, '')))
    WHEN 'contract_type' THEN lower(trim(COALESCE(p_contract_type, '')))
    ELSE ''
  END;

  normalized_subject := lower(trim(COALESCE(subject_value, '')));

  IF p_scope_type = 'org' AND normalized_scope = '*' THEN
    RETURN true;
  END IF;

  IF p_scope_operator = 'eq' THEN
    RETURN normalized_subject <> '' AND normalized_subject = normalized_scope;
  END IF;

  value_list := regexp_split_to_array(normalized_scope, '\s*,\s*');
  RETURN normalized_subject <> '' AND normalized_subject = ANY (value_list);
END;
$$;

CREATE OR REPLACE FUNCTION public.resolve_payroll_policy_version(
  p_org_id uuid,
  p_policy_type text,
  p_effective_on date,
  p_employee_id uuid DEFAULT NULL
)
RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  e_region text;
  e_department text;
  e_unit text;
  e_staffing_category text;
  e_contract_type text;
  resolved_id uuid;
BEGIN
  IF p_employee_id IS NOT NULL THEN
    SELECT
      region,
      department,
      unit,
      staffing_category,
      contract_type
    INTO
      e_region,
      e_department,
      e_unit,
      e_staffing_category,
      e_contract_type
    FROM public.employees
    WHERE id = p_employee_id
      AND org_id = p_org_id;
  END IF;

  WITH candidates AS (
    SELECT
      pv.id,
      pv.effective_from,
      pv.version_no,
      COALESCE(psc.priority, 0) AS scope_priority,
      CASE psc.scope_type
        WHEN 'employee' THEN 60
        WHEN 'department' THEN 50
        WHEN 'unit' THEN 40
        WHEN 'region' THEN 30
        WHEN 'staffing_category' THEN 20
        WHEN 'contract_type' THEN 15
        WHEN 'org' THEN 10
        ELSE 0
      END AS specificity
    FROM public.payroll_policy_versions pv
    JOIN public.payroll_policy_sets ps
      ON ps.id = pv.policy_set_id
     AND ps.org_id = pv.org_id
    LEFT JOIN public.payroll_policy_scopes psc
      ON psc.policy_version_id = pv.id
     AND psc.org_id = pv.org_id
    WHERE pv.org_id = p_org_id
      AND ps.policy_type = p_policy_type
      AND ps.status = 'active'
      AND pv.status = 'active'
      AND p_effective_on >= pv.effective_from
      AND (pv.effective_to IS NULL OR p_effective_on <= pv.effective_to)
      AND (
        psc.id IS NULL
        OR public.policy_scope_matches(
          psc.scope_type,
          psc.scope_operator,
          psc.scope_value,
          p_org_id,
          p_employee_id,
          e_region,
          e_department,
          e_unit,
          e_staffing_category,
          e_contract_type
        )
      )
  ),
  ranked AS (
    SELECT
      id,
      max(scope_priority) AS scope_priority,
      max(specificity) AS specificity,
      max(effective_from) AS effective_from,
      max(version_no) AS version_no
    FROM candidates
    GROUP BY id
  )
  SELECT id
  INTO resolved_id
  FROM ranked
  ORDER BY scope_priority DESC, specificity DESC, effective_from DESC, version_no DESC
  LIMIT 1;

  RETURN resolved_id;
END;
$$;

CREATE OR REPLACE FUNCTION public.payroll_policy_type_for_run(run_type text)
RETURNS text
LANGUAGE sql
IMMUTABLE
AS $$
  SELECT CASE run_type
    WHEN 'regular' THEN 'regular_payroll'
    WHEN 'offcycle' THEN 'offcycle_payroll'
    WHEN 'corrective' THEN 'offcycle_payroll'
    WHEN 'final' THEN 'final_payroll'
    ELSE 'regular_payroll'
  END;
$$;

CREATE OR REPLACE FUNCTION public.set_payroll_run_default_policy_version()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  period_start_date date;
  resolved_id uuid;
BEGIN
  IF NEW.default_policy_version_id IS NOT NULL THEN
    RETURN NEW;
  END IF;

  SELECT period_start
  INTO period_start_date
  FROM public.payroll_periods
  WHERE id = NEW.payroll_period_id
    AND org_id = NEW.org_id;

  IF period_start_date IS NULL THEN
    RETURN NEW;
  END IF;

  resolved_id := public.resolve_payroll_policy_version(
    NEW.org_id,
    public.payroll_policy_type_for_run(NEW.run_type),
    period_start_date,
    NULL
  );

  NEW.default_policy_version_id := resolved_id;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_set_payroll_run_default_policy_version
  ON public.payroll_runs;

CREATE TRIGGER trg_set_payroll_run_default_policy_version
  BEFORE INSERT OR UPDATE OF org_id, payroll_period_id, run_type, default_policy_version_id
  ON public.payroll_runs
  FOR EACH ROW
  EXECUTE FUNCTION public.set_payroll_run_default_policy_version();

CREATE OR REPLACE FUNCTION public.set_payroll_run_employee_policy_version()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  run_row public.payroll_runs%ROWTYPE;
  period_start_date date;
  resolved_id uuid;
BEGIN
  IF NEW.applied_policy_version_id IS NOT NULL THEN
    RETURN NEW;
  END IF;

  SELECT *
  INTO run_row
  FROM public.payroll_runs
  WHERE id = NEW.payroll_run_id
    AND org_id = NEW.org_id;

  IF NOT FOUND THEN
    RETURN NEW;
  END IF;

  IF run_row.default_policy_version_id IS NOT NULL THEN
    NEW.applied_policy_version_id := run_row.default_policy_version_id;
    RETURN NEW;
  END IF;

  SELECT period_start
  INTO period_start_date
  FROM public.payroll_periods
  WHERE id = run_row.payroll_period_id
    AND org_id = run_row.org_id;

  IF period_start_date IS NULL THEN
    RETURN NEW;
  END IF;

  resolved_id := public.resolve_payroll_policy_version(
    NEW.org_id,
    public.payroll_policy_type_for_run(run_row.run_type),
    period_start_date,
    NEW.employee_id
  );

  NEW.applied_policy_version_id := resolved_id;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_set_payroll_run_employee_policy_version
  ON public.payroll_run_employees;

CREATE TRIGGER trg_set_payroll_run_employee_policy_version
  BEFORE INSERT OR UPDATE OF payroll_run_id, employee_id, applied_policy_version_id
  ON public.payroll_run_employees
  FOR EACH ROW
  EXECUTE FUNCTION public.set_payroll_run_employee_policy_version();

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM pg_constraint
    WHERE conrelid = 'public.payroll_runs'::regclass
      AND conname = 'payroll_runs_default_policy_version_fk'
  ) THEN
    ALTER TABLE public.payroll_runs
      ADD CONSTRAINT payroll_runs_default_policy_version_fk
      FOREIGN KEY (org_id, default_policy_version_id)
      REFERENCES public.payroll_policy_versions (org_id, id)
      ON UPDATE RESTRICT
      ON DELETE SET NULL;
  END IF;

  IF NOT EXISTS (
    SELECT 1
    FROM pg_constraint
    WHERE conrelid = 'public.payroll_run_employees'::regclass
      AND conname = 'payroll_run_employees_applied_policy_version_fk'
  ) THEN
    ALTER TABLE public.payroll_run_employees
      ADD CONSTRAINT payroll_run_employees_applied_policy_version_fk
      FOREIGN KEY (org_id, applied_policy_version_id)
      REFERENCES public.payroll_policy_versions (org_id, id)
      ON UPDATE RESTRICT
      ON DELETE SET NULL;
  END IF;
END $$;

ALTER TABLE public.payroll_policy_sets ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.payroll_policy_versions ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.payroll_policy_scopes ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.payroll_policy_rules ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS payroll_policy_sets_select_scoped ON public.payroll_policy_sets;
CREATE POLICY payroll_policy_sets_select_scoped
  ON public.payroll_policy_sets
  FOR SELECT
  TO public
  USING (auth.uid() IS NOT NULL AND org_role(org_id) IS NOT NULL);

DROP POLICY IF EXISTS payroll_policy_sets_insert_privileged ON public.payroll_policy_sets;
CREATE POLICY payroll_policy_sets_insert_privileged
  ON public.payroll_policy_sets
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

DROP POLICY IF EXISTS payroll_policy_sets_update_privileged ON public.payroll_policy_sets;
CREATE POLICY payroll_policy_sets_update_privileged
  ON public.payroll_policy_sets
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

DROP POLICY IF EXISTS payroll_policy_sets_delete_privileged ON public.payroll_policy_sets;
CREATE POLICY payroll_policy_sets_delete_privileged
  ON public.payroll_policy_sets
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

DROP POLICY IF EXISTS payroll_policy_versions_select_scoped ON public.payroll_policy_versions;
CREATE POLICY payroll_policy_versions_select_scoped
  ON public.payroll_policy_versions
  FOR SELECT
  TO public
  USING (auth.uid() IS NOT NULL AND org_role(org_id) IS NOT NULL);

DROP POLICY IF EXISTS payroll_policy_versions_insert_privileged ON public.payroll_policy_versions;
CREATE POLICY payroll_policy_versions_insert_privileged
  ON public.payroll_policy_versions
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

DROP POLICY IF EXISTS payroll_policy_versions_update_privileged ON public.payroll_policy_versions;
CREATE POLICY payroll_policy_versions_update_privileged
  ON public.payroll_policy_versions
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

DROP POLICY IF EXISTS payroll_policy_versions_delete_privileged ON public.payroll_policy_versions;
CREATE POLICY payroll_policy_versions_delete_privileged
  ON public.payroll_policy_versions
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

DROP POLICY IF EXISTS payroll_policy_scopes_select_scoped ON public.payroll_policy_scopes;
CREATE POLICY payroll_policy_scopes_select_scoped
  ON public.payroll_policy_scopes
  FOR SELECT
  TO public
  USING (auth.uid() IS NOT NULL AND org_role(org_id) IS NOT NULL);

DROP POLICY IF EXISTS payroll_policy_scopes_insert_privileged ON public.payroll_policy_scopes;
CREATE POLICY payroll_policy_scopes_insert_privileged
  ON public.payroll_policy_scopes
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

DROP POLICY IF EXISTS payroll_policy_scopes_update_privileged ON public.payroll_policy_scopes;
CREATE POLICY payroll_policy_scopes_update_privileged
  ON public.payroll_policy_scopes
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

DROP POLICY IF EXISTS payroll_policy_scopes_delete_privileged ON public.payroll_policy_scopes;
CREATE POLICY payroll_policy_scopes_delete_privileged
  ON public.payroll_policy_scopes
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

DROP POLICY IF EXISTS payroll_policy_rules_select_scoped ON public.payroll_policy_rules;
CREATE POLICY payroll_policy_rules_select_scoped
  ON public.payroll_policy_rules
  FOR SELECT
  TO public
  USING (auth.uid() IS NOT NULL AND org_role(org_id) IS NOT NULL);

DROP POLICY IF EXISTS payroll_policy_rules_insert_privileged ON public.payroll_policy_rules;
CREATE POLICY payroll_policy_rules_insert_privileged
  ON public.payroll_policy_rules
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

DROP POLICY IF EXISTS payroll_policy_rules_update_privileged ON public.payroll_policy_rules;
CREATE POLICY payroll_policy_rules_update_privileged
  ON public.payroll_policy_rules
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

DROP POLICY IF EXISTS payroll_policy_rules_delete_privileged ON public.payroll_policy_rules;
CREATE POLICY payroll_policy_rules_delete_privileged
  ON public.payroll_policy_rules
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
