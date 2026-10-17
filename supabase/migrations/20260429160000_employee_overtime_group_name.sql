-- Adds per-employee overtime group selection (daily hours + rate multipliers live on `overtime_groups`).
-- Eligibility is derived from `employees.staffing_category` in the overtime calculation logic.

ALTER TABLE public.employees
  ADD COLUMN IF NOT EXISTS overtime_group_name text NOT NULL DEFAULT 'Standard';

COMMENT ON COLUMN public.employees.overtime_group_name IS
  'Overtime group selection for the employee (e.g. 8 Hours / 10 Hours / 12 Hours / Standard).';

