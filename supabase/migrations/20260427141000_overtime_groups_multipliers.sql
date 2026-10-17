-- Add multiplier fields for overtime pay by day type (working day / weekend / holiday).

ALTER TABLE public.overtime_groups
  ADD COLUMN IF NOT EXISTS working_day_multiplier numeric NOT NULL DEFAULT 1.5,
  ADD COLUMN IF NOT EXISTS weekend_multiplier numeric NOT NULL DEFAULT 2,
  ADD COLUMN IF NOT EXISTS holiday_multiplier numeric NOT NULL DEFAULT 2;

ALTER TABLE public.overtime_groups
  DROP CONSTRAINT IF EXISTS overtime_groups_working_day_multiplier_chk;
ALTER TABLE public.overtime_groups
  ADD CONSTRAINT overtime_groups_working_day_multiplier_chk CHECK (working_day_multiplier > 0);

ALTER TABLE public.overtime_groups
  DROP CONSTRAINT IF EXISTS overtime_groups_weekend_multiplier_chk;
ALTER TABLE public.overtime_groups
  ADD CONSTRAINT overtime_groups_weekend_multiplier_chk CHECK (weekend_multiplier > 0);

ALTER TABLE public.overtime_groups
  DROP CONSTRAINT IF EXISTS overtime_groups_holiday_multiplier_chk;
ALTER TABLE public.overtime_groups
  ADD CONSTRAINT overtime_groups_holiday_multiplier_chk CHECK (holiday_multiplier > 0);

COMMENT ON COLUMN public.overtime_groups.working_day_multiplier IS
  'Overtime multiplier applied to working-day overtime hours.';
COMMENT ON COLUMN public.overtime_groups.weekend_multiplier IS
  'Overtime multiplier applied to weekend overtime hours.';
COMMENT ON COLUMN public.overtime_groups.holiday_multiplier IS
  'Overtime multiplier applied to holiday overtime hours.';

