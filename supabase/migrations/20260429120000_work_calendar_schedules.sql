-- Multiple named working schedules per policy version (only one may be active).
-- Public holidays use inclusive date ranges.

-- Replace per-day week_rules with schedule-based model.
DROP TABLE IF EXISTS public.work_calendar_week_rules CASCADE;

CREATE TABLE IF NOT EXISTS public.work_calendar_schedules (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id uuid NOT NULL REFERENCES public.organizations (id) ON DELETE CASCADE,
  policy_version_id uuid NOT NULL,
  name text NOT NULL,
  working_days smallint[] NOT NULL,
  work_start_time time without time zone NOT NULL,
  work_end_time time without time zone NOT NULL,
  is_active boolean NOT NULL DEFAULT false,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT work_calendar_schedules_org_version_fk FOREIGN KEY (org_id, policy_version_id)
    REFERENCES public.payroll_policy_versions (org_id, id) ON DELETE CASCADE,
  CONSTRAINT work_calendar_schedules_name_chk CHECK (btrim(name) <> ''),
  CONSTRAINT work_calendar_schedules_working_days_chk CHECK (
    working_days IS NOT NULL
    AND array_length(working_days, 1) IS NOT NULL
    AND array_length(working_days, 1) > 0
    AND working_days <@ ARRAY[0, 1, 2, 3, 4, 5, 6]::smallint[]
  ),
  CONSTRAINT work_calendar_schedules_time_chk CHECK (work_end_time > work_start_time)
);

CREATE UNIQUE INDEX IF NOT EXISTS work_calendar_schedules_org_version_name_key
  ON public.work_calendar_schedules (org_id, policy_version_id, (lower(trim(name))));

CREATE UNIQUE INDEX IF NOT EXISTS work_calendar_schedules_one_active_per_version
  ON public.work_calendar_schedules (org_id, policy_version_id)
  WHERE is_active = true;

CREATE INDEX IF NOT EXISTS work_calendar_schedules_org_version_idx
  ON public.work_calendar_schedules (org_id, policy_version_id, is_active, name);

COMMENT ON TABLE public.work_calendar_schedules IS
  'Named working schedules (e.g. Summer/Winter). Exactly one may be active per policy version; drives working vs weekend classification.';

CREATE OR REPLACE FUNCTION public.touch_work_calendar_schedules_updated_at()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  NEW.updated_at := now();
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_touch_work_calendar_schedules ON public.work_calendar_schedules;
CREATE TRIGGER trg_touch_work_calendar_schedules
  BEFORE UPDATE ON public.work_calendar_schedules
  FOR EACH ROW
  EXECUTE FUNCTION public.touch_work_calendar_schedules_updated_at();

ALTER TABLE public.work_calendar_schedules ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS work_calendar_schedules_select_scoped ON public.work_calendar_schedules;
CREATE POLICY work_calendar_schedules_select_scoped
  ON public.work_calendar_schedules
  FOR SELECT
  TO public
  USING (auth.uid() IS NOT NULL AND org_role(org_id) IS NOT NULL);

DROP POLICY IF EXISTS work_calendar_schedules_insert_privileged ON public.work_calendar_schedules;
CREATE POLICY work_calendar_schedules_insert_privileged
  ON public.work_calendar_schedules
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

DROP POLICY IF EXISTS work_calendar_schedules_update_privileged ON public.work_calendar_schedules;
CREATE POLICY work_calendar_schedules_update_privileged
  ON public.work_calendar_schedules
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

DROP POLICY IF EXISTS work_calendar_schedules_delete_privileged ON public.work_calendar_schedules;
CREATE POLICY work_calendar_schedules_delete_privileged
  ON public.work_calendar_schedules
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

-- Public holidays: single date → inclusive range
ALTER TABLE public.work_calendar_public_holidays
  ADD COLUMN IF NOT EXISTS holiday_date_from date,
  ADD COLUMN IF NOT EXISTS holiday_date_to date;

UPDATE public.work_calendar_public_holidays
SET
  holiday_date_from = holiday_date,
  holiday_date_to = holiday_date
WHERE holiday_date IS NOT NULL;

ALTER TABLE public.work_calendar_public_holidays
  ALTER COLUMN holiday_date_from SET NOT NULL,
  ALTER COLUMN holiday_date_to SET NOT NULL;

ALTER TABLE public.work_calendar_public_holidays
  DROP CONSTRAINT IF EXISTS work_calendar_holidays_org_version_date_key;

ALTER TABLE public.work_calendar_public_holidays
  DROP COLUMN IF EXISTS holiday_date;

ALTER TABLE public.work_calendar_public_holidays
  DROP CONSTRAINT IF EXISTS work_calendar_holidays_range_chk;

ALTER TABLE public.work_calendar_public_holidays
  ADD CONSTRAINT work_calendar_holidays_range_chk CHECK (holiday_date_to >= holiday_date_from);

DROP INDEX IF EXISTS work_calendar_holidays_org_version_date_idx;

CREATE INDEX IF NOT EXISTS work_calendar_holidays_org_version_from_idx
  ON public.work_calendar_public_holidays (org_id, policy_version_id, holiday_date_from);

-- Seed default schedule for regular payroll versions (Sun–Thu working, Fri–Sat weekend by exclusion).
INSERT INTO public.work_calendar_schedules (
  org_id,
  policy_version_id,
  name,
  working_days,
  work_start_time,
  work_end_time,
  is_active
)
SELECT
  pv.org_id,
  pv.id,
  'Standard',
  ARRAY[0, 1, 2, 3, 4]::smallint[],
  time '08:00',
  time '17:00',
  true
FROM public.payroll_policy_versions pv
JOIN public.payroll_policy_sets ps
  ON ps.org_id = pv.org_id
 AND ps.id = pv.policy_set_id
WHERE ps.policy_type = 'regular_payroll'
  AND NOT EXISTS (
    SELECT 1
    FROM public.work_calendar_schedules s
    WHERE s.org_id = pv.org_id
      AND s.policy_version_id = pv.id
  );
