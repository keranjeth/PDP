-- Employee master: single canonical table public.employees (inspection confirms no duplicate employee tables).
-- Align core org/location text attributes with required business fields using NOT NULL + '' default.
-- RLS and composite FK targets (UNIQUE (org_id, id)) are unchanged.

UPDATE public.employees SET
  staffing_category = COALESCE(staffing_category, ''),
  unit = COALESCE(unit, ''),
  region = COALESCE(region, ''),
  duty_station = COALESCE(duty_station, ''),
  job_location = COALESCE(job_location, '')
WHERE staffing_category IS NULL
   OR unit IS NULL
   OR region IS NULL
   OR duty_station IS NULL
   OR job_location IS NULL;

ALTER TABLE public.employees
  ALTER COLUMN staffing_category SET DEFAULT '',
  ALTER COLUMN unit SET DEFAULT '',
  ALTER COLUMN region SET DEFAULT '',
  ALTER COLUMN duty_station SET DEFAULT '',
  ALTER COLUMN job_location SET DEFAULT '';

ALTER TABLE public.employees
  ALTER COLUMN staffing_category SET NOT NULL,
  ALTER COLUMN unit SET NOT NULL,
  ALTER COLUMN region SET NOT NULL,
  ALTER COLUMN duty_station SET NOT NULL,
  ALTER COLUMN job_location SET NOT NULL;

COMMENT ON TABLE public.employees IS
  'Employee master (source of truth): one row per person per organization. PK id (uuid). Business id id_number per org_id. Soft delete deleted_at. compensation_records and payroll_records reference (org_id, id).';

COMMENT ON COLUMN public.employees.id IS 'Surrogate primary key (uuid).';
COMMENT ON COLUMN public.employees.org_id IS 'Tenant; FK to organizations.id.';
COMMENT ON COLUMN public.employees.id_number IS 'Business employee identifier; UNIQUE (org_id, id_number) and case-insensitive unique on (org_id, lower(id_number)).';
COMMENT ON COLUMN public.employees.full_name IS 'Full legal / display name.';
COMMENT ON COLUMN public.employees.gender IS 'Enum gender: male | female.';
COMMENT ON COLUMN public.employees.position_number IS 'Position number (business).';
COMMENT ON COLUMN public.employees.designation IS 'Job title / designation.';
COMMENT ON COLUMN public.employees.staffing_category IS 'Staffing category (required; empty string if unknown).';
COMMENT ON COLUMN public.employees.department IS 'Department.';
COMMENT ON COLUMN public.employees.unit IS 'Unit (required; empty string if N/A).';
COMMENT ON COLUMN public.employees.region IS 'Region (required; empty string if N/A).';
COMMENT ON COLUMN public.employees.duty_station IS 'Duty station (required; empty string if N/A).';
COMMENT ON COLUMN public.employees.job_location IS 'Job location (required; empty string if N/A).';
COMMENT ON COLUMN public.employees.contract_type IS 'Enum contract_type: regular | non_regular.';
COMMENT ON COLUMN public.employees.job_status IS 'Enum job_status: full_time | part_time.';
COMMENT ON COLUMN public.employees.employment_status IS 'Enum employment_status: active | inactive.';
COMMENT ON COLUMN public.employees.joining_date IS 'Employment joining date.';
COMMENT ON COLUMN public.employees.contract_start_date IS 'Contract start; must be <= contract_end_date.';
COMMENT ON COLUMN public.employees.contract_end_date IS 'Contract end.';
COMMENT ON COLUMN public.employees.currency IS 'Default payroll display currency.';
COMMENT ON COLUMN public.employees.created_at IS 'Row creation time (timestamptz).';
COMMENT ON COLUMN public.employees.updated_at IS 'Last update time (timestamptz); audit trigger.';
COMMENT ON COLUMN public.employees.created_by IS 'auth.uid() at insert when set by trigger.';
COMMENT ON COLUMN public.employees.updated_by IS 'auth.uid() at update when set by trigger.';
COMMENT ON COLUMN public.employees.deleted_at IS 'Soft delete; NULL means active.';
COMMENT ON COLUMN public.employees.age_years IS 'Derived from date_of_birth (trigger).';
COMMENT ON COLUMN public.employees.length_of_service_days IS 'Derived from joining_date (trigger).';
