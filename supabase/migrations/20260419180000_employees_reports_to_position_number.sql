-- Reporting hierarchy: link each employee to their manager's position slot (not manager employee id).
-- Resolution at read time: find the current occupant of that position_number (prefer Active).

ALTER TABLE public.employees
  ADD COLUMN IF NOT EXISTS reports_to_position_number text;

COMMENT ON COLUMN public.employees.reports_to_position_number IS
  'Business position number of the manager role this employee reports to. Hierarchy is by position, not employee id, so turnover does not break structure.';
