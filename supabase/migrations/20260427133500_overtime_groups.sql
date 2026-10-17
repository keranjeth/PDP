-- Overtime groups per payroll policy version.
-- Afghanistan practice: daily hours differ by role (e.g. guard 12h). Overtime pay is policy-driven.

CREATE TABLE IF NOT EXISTS public.overtime_groups (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id uuid NOT NULL REFERENCES public.organizations (id) ON DELETE CASCADE,
  policy_version_id uuid NOT NULL,
  name text NOT NULL,
  daily_hours numeric NOT NULL,
  is_active boolean NOT NULL DEFAULT true,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT overtime_groups_org_version_fk FOREIGN KEY (org_id, policy_version_id)
    REFERENCES public.payroll_policy_versions (org_id, id) ON DELETE CASCADE,
  CONSTRAINT overtime_groups_name_chk CHECK (btrim(name) <> ''),
  CONSTRAINT overtime_groups_daily_hours_chk CHECK (daily_hours > 0),
  CONSTRAINT overtime_groups_org_version_id_key UNIQUE (org_id, policy_version_id, id)
);

-- Prevent duplicates by name (case-insensitive) within a policy version.
CREATE UNIQUE INDEX IF NOT EXISTS overtime_groups_org_version_lower_name_key
  ON public.overtime_groups (org_id, policy_version_id, lower(btrim(name)));

CREATE INDEX IF NOT EXISTS overtime_groups_org_version_active_idx
  ON public.overtime_groups (org_id, policy_version_id, is_active, name);

COMMENT ON TABLE public.overtime_groups IS
  'User-configurable overtime groups per payroll policy version. Used to compute overtime pay using daily hours.';

COMMENT ON COLUMN public.overtime_groups.daily_hours IS
  'Expected daily hours for this group (e.g. Ancillary 8, Driver 10, Guard 12).';

CREATE OR REPLACE FUNCTION public.touch_overtime_groups_updated_at()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  NEW.updated_at := now();
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_touch_overtime_groups ON public.overtime_groups;
CREATE TRIGGER trg_touch_overtime_groups
  BEFORE UPDATE ON public.overtime_groups
  FOR EACH ROW
  EXECUTE FUNCTION public.touch_overtime_groups_updated_at();

ALTER TABLE public.overtime_groups ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS overtime_groups_select_scoped ON public.overtime_groups;
CREATE POLICY overtime_groups_select_scoped
  ON public.overtime_groups
  FOR SELECT
  TO public
  USING (auth.uid() IS NOT NULL AND org_role(org_id) IS NOT NULL);

DROP POLICY IF EXISTS overtime_groups_insert_privileged ON public.overtime_groups;
CREATE POLICY overtime_groups_insert_privileged
  ON public.overtime_groups
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

DROP POLICY IF EXISTS overtime_groups_update_privileged ON public.overtime_groups;
CREATE POLICY overtime_groups_update_privileged
  ON public.overtime_groups
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

DROP POLICY IF EXISTS overtime_groups_delete_privileged ON public.overtime_groups;
CREATE POLICY overtime_groups_delete_privileged
  ON public.overtime_groups
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

-- Seed a default group for each existing regular payroll policy version.
INSERT INTO public.overtime_groups (org_id, policy_version_id, name, daily_hours, is_active)
SELECT
  pv.org_id,
  pv.id,
  'Ancillary',
  8,
  true
FROM public.payroll_policy_versions pv
JOIN public.payroll_policy_sets ps
  ON ps.org_id = pv.org_id
 AND ps.id = pv.policy_set_id
WHERE ps.policy_type = 'regular_payroll'
  AND NOT EXISTS (
    SELECT 1
    FROM public.overtime_groups og
    WHERE og.org_id = pv.org_id
      AND og.policy_version_id = pv.id
  );

