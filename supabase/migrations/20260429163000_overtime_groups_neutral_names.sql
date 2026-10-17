-- Normalize overtime group names to the finalized neutral vocabulary.
-- Support Staff: 8 Hours / 10 Hours / 12 Hours
-- Non-support: Standard (8 Hours)

-- 1) Rename legacy role-based groups (only when the neutral target doesn't already exist).
UPDATE public.overtime_groups og
SET
  name = '8 Hours',
  daily_hours = 8
WHERE lower(btrim(og.name)) = 'ancillary'
  AND NOT EXISTS (
    SELECT 1
    FROM public.overtime_groups og2
    WHERE og2.org_id = og.org_id
      AND og2.policy_version_id = og.policy_version_id
      AND lower(btrim(og2.name)) = lower(btrim('8 Hours'))
  );

UPDATE public.overtime_groups og
SET
  name = '10 Hours',
  daily_hours = 10
WHERE lower(btrim(og.name)) = 'driver'
  AND NOT EXISTS (
    SELECT 1
    FROM public.overtime_groups og2
    WHERE og2.org_id = og.org_id
      AND og2.policy_version_id = og.policy_version_id
      AND lower(btrim(og2.name)) = lower(btrim('10 Hours'))
  );

UPDATE public.overtime_groups og
SET
  name = '12 Hours',
  daily_hours = 12
WHERE lower(btrim(og.name)) = 'watchperson'
  AND NOT EXISTS (
    SELECT 1
    FROM public.overtime_groups og2
    WHERE og2.org_id = og.org_id
      AND og2.policy_version_id = og.policy_version_id
      AND lower(btrim(og2.name)) = lower(btrim('12 Hours'))
  );

UPDATE public.overtime_groups og
SET
  name = 'Standard',
  daily_hours = 8
WHERE lower(btrim(og.name)) = 'professional staff'
  AND NOT EXISTS (
    SELECT 1
    FROM public.overtime_groups og2
    WHERE og2.org_id = og.org_id
      AND og2.policy_version_id = og.policy_version_id
      AND lower(btrim(og2.name)) = lower(btrim('Standard'))
  );

-- 2) Seed missing neutral groups for each regular payroll policy version.
INSERT INTO public.overtime_groups (org_id, policy_version_id, name, daily_hours, is_active)
SELECT
  pv.org_id,
  pv.id,
  g.name,
  g.daily_hours,
  true
FROM public.payroll_policy_versions pv
JOIN public.payroll_policy_sets ps
  ON ps.org_id = pv.org_id
  AND ps.id = pv.policy_set_id
CROSS JOIN (
  VALUES
    ('8 Hours'::text, 8::numeric),
    ('10 Hours'::text, 10::numeric),
    ('12 Hours'::text, 12::numeric),
    ('Standard'::text, 8::numeric)
) AS g(name, daily_hours)
WHERE ps.policy_type = 'regular_payroll'
  AND NOT EXISTS (
    SELECT 1
    FROM public.overtime_groups og
    WHERE og.org_id = pv.org_id
      AND og.policy_version_id = pv.id
      AND lower(btrim(og.name)) = lower(btrim(g.name))
  );

-- 3) Deactivate any remaining legacy role-based names (if they still exist).
UPDATE public.overtime_groups
SET is_active = false
WHERE lower(btrim(name)) IN ('ancillary', 'driver', 'watchperson', 'professional staff');

