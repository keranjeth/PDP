-- Work calendar policy per payroll policy version (week pattern + public holidays).

CREATE TABLE IF NOT EXISTS public.work_calendar_week_rules (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id uuid NOT NULL REFERENCES public.organizations (id) ON DELETE CASCADE,
  policy_version_id uuid NOT NULL,
  day_of_week smallint NOT NULL,
  is_weekend boolean NOT NULL DEFAULT false,
  is_half_day boolean NOT NULL DEFAULT false,
  work_start_time time without time zone NULL,
  work_end_time time without time zone NULL,
  is_active boolean NOT NULL DEFAULT true,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT work_calendar_week_rules_org_version_fk FOREIGN KEY (org_id, policy_version_id)
    REFERENCES public.payroll_policy_versions (org_id, id) ON DELETE CASCADE,
  CONSTRAINT work_calendar_week_rules_day_chk CHECK (day_of_week >= 0 AND day_of_week <= 6),
  CONSTRAINT work_calendar_week_rules_org_version_day_key UNIQUE (org_id, policy_version_id, day_of_week),
  CONSTRAINT work_calendar_week_rules_half_time_chk CHECK (
    (is_half_day = false)
    OR (work_start_time IS NOT NULL AND work_end_time IS NOT NULL AND work_end_time > work_start_time)
  )
);

CREATE INDEX IF NOT EXISTS work_calendar_week_rules_org_version_idx
  ON public.work_calendar_week_rules (org_id, policy_version_id, day_of_week);

COMMENT ON TABLE public.work_calendar_week_rules IS
  'Weekly pattern: weekend flags + optional half-day working window per weekday (0=Sun .. 6=Sat).';

CREATE TABLE IF NOT EXISTS public.work_calendar_public_holidays (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id uuid NOT NULL REFERENCES public.organizations (id) ON DELETE CASCADE,
  policy_version_id uuid NOT NULL,
  holiday_name text NOT NULL,
  holiday_date date NOT NULL,
  is_active boolean NOT NULL DEFAULT true,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT work_calendar_holidays_org_version_fk FOREIGN KEY (org_id, policy_version_id)
    REFERENCES public.payroll_policy_versions (org_id, id) ON DELETE CASCADE,
  CONSTRAINT work_calendar_holidays_name_chk CHECK (btrim(holiday_name) <> ''),
  CONSTRAINT work_calendar_holidays_org_version_date_key UNIQUE (org_id, policy_version_id, holiday_date)
);

CREATE INDEX IF NOT EXISTS work_calendar_holidays_org_version_date_idx
  ON public.work_calendar_public_holidays (org_id, policy_version_id, holiday_date);

COMMENT ON TABLE public.work_calendar_public_holidays IS
  'Org-scoped public holidays for a payroll policy version.';

CREATE OR REPLACE FUNCTION public.touch_work_calendar_updated_at()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  NEW.updated_at := now();
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_touch_work_calendar_week_rules ON public.work_calendar_week_rules;
CREATE TRIGGER trg_touch_work_calendar_week_rules
  BEFORE UPDATE ON public.work_calendar_week_rules
  FOR EACH ROW
  EXECUTE FUNCTION public.touch_work_calendar_updated_at();

DROP TRIGGER IF EXISTS trg_touch_work_calendar_public_holidays ON public.work_calendar_public_holidays;
CREATE TRIGGER trg_touch_work_calendar_public_holidays
  BEFORE UPDATE ON public.work_calendar_public_holidays
  FOR EACH ROW
  EXECUTE FUNCTION public.touch_work_calendar_updated_at();

ALTER TABLE public.work_calendar_week_rules ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.work_calendar_public_holidays ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS work_calendar_week_rules_select_scoped ON public.work_calendar_week_rules;
CREATE POLICY work_calendar_week_rules_select_scoped
  ON public.work_calendar_week_rules
  FOR SELECT
  TO public
  USING (auth.uid() IS NOT NULL AND org_role(org_id) IS NOT NULL);

DROP POLICY IF EXISTS work_calendar_week_rules_insert_privileged ON public.work_calendar_week_rules;
CREATE POLICY work_calendar_week_rules_insert_privileged
  ON public.work_calendar_week_rules
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

DROP POLICY IF EXISTS work_calendar_week_rules_update_privileged ON public.work_calendar_week_rules;
CREATE POLICY work_calendar_week_rules_update_privileged
  ON public.work_calendar_week_rules
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

DROP POLICY IF EXISTS work_calendar_week_rules_delete_privileged ON public.work_calendar_week_rules;
CREATE POLICY work_calendar_week_rules_delete_privileged
  ON public.work_calendar_week_rules
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

DROP POLICY IF EXISTS work_calendar_public_holidays_select_scoped ON public.work_calendar_public_holidays;
CREATE POLICY work_calendar_public_holidays_select_scoped
  ON public.work_calendar_public_holidays
  FOR SELECT
  TO public
  USING (auth.uid() IS NOT NULL AND org_role(org_id) IS NOT NULL);

DROP POLICY IF EXISTS work_calendar_public_holidays_insert_privileged ON public.work_calendar_public_holidays;
CREATE POLICY work_calendar_public_holidays_insert_privileged
  ON public.work_calendar_public_holidays
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

DROP POLICY IF EXISTS work_calendar_public_holidays_update_privileged ON public.work_calendar_public_holidays;
CREATE POLICY work_calendar_public_holidays_update_privileged
  ON public.work_calendar_public_holidays
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

DROP POLICY IF EXISTS work_calendar_public_holidays_delete_privileged ON public.work_calendar_public_holidays;
CREATE POLICY work_calendar_public_holidays_delete_privileged
  ON public.work_calendar_public_holidays
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
