ALTER TABLE public.payroll_months
  DROP CONSTRAINT IF EXISTS payroll_months_month_key_format_chk;

ALTER TABLE public.payroll_months
  ADD CONSTRAINT payroll_months_month_key_format_chk
  CHECK (month_key ~ '^[0-9]{4}-[0-9]{2}$');

