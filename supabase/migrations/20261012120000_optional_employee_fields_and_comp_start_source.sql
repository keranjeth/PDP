-- Optional employee attributes may be unknown at import time.
-- Compensation opening balances record whether the effective start was supplied or derived.

alter table public.employees
  alter column position_number drop not null,
  alter column staffing_category drop not null,
  alter column staffing_category drop default,
  alter column overtime_group_name drop not null,
  alter column overtime_group_name drop default,
  alter column unit drop not null,
  alter column unit drop default,
  alter column region drop not null,
  alter column region drop default,
  alter column duty_station drop not null,
  alter column duty_station drop default,
  alter column job_location drop not null,
  alter column job_location drop default,
  alter column contract_type drop not null,
  alter column job_status drop not null,
  alter column employment_status drop not null,
  alter column contract_start_date drop not null,
  alter column contract_end_date drop not null;

alter table public.employees drop constraint if exists employees_contract_date_order_chk;
alter table public.employees
  add constraint employees_contract_date_order_chk
  check (
    contract_start_date is null
    or contract_end_date is null
    or contract_end_date >= contract_start_date
  );

alter table public.compensation_records
  add column if not exists start_date_source text;

alter table public.compensation_records drop constraint if exists compensation_records_start_date_source_chk;
alter table public.compensation_records
  add constraint compensation_records_start_date_source_chk
  check (start_date_source is null or start_date_source in ('supplied', 'derived'));

comment on column public.compensation_records.start_date_source is
  'supplied = date came from the import or form; derived = opening-balance rule MAX(joining date, payroll baseline).';

notify pgrst, 'reload schema';
