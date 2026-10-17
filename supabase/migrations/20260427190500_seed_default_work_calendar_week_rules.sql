-- Seed a sensible default week pattern (Mon–Fri working, Sat–Sun weekend) for regular payroll versions.

INSERT INTO public.work_calendar_week_rules (
  org_id,
  policy_version_id,
  day_of_week,
  is_weekend,
  is_half_day,
  work_start_time,
  work_end_time,
  is_active
)
SELECT
  pv.org_id,
  pv.id,
  d.day_of_week,
  d.is_weekend,
  false,
  CASE WHEN d.is_weekend THEN NULL ELSE time '08:00' END,
  CASE WHEN d.is_weekend THEN NULL ELSE time '16:00' END,
  true
FROM public.payroll_policy_versions pv
JOIN public.payroll_policy_sets ps
  ON ps.org_id = pv.org_id
 AND ps.id = pv.policy_set_id
JOIN (
  VALUES
    (0::smallint, true::boolean),
    (1::smallint, false::boolean),
    (2::smallint, false::boolean),
    (3::smallint, false::boolean),
    (4::smallint, false::boolean),
    (5::smallint, false::boolean),
    (6::smallint, true::boolean)
) AS d(day_of_week, is_weekend) ON true
WHERE ps.policy_type = 'regular_payroll'
  AND NOT EXISTS (
    SELECT 1
    FROM public.work_calendar_week_rules wr
    WHERE wr.org_id = pv.org_id
      AND wr.policy_version_id = pv.id
  );
