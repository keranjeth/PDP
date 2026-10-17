-- Normalize payroll snapshot on existing public.payroll_records.
--
-- Existing structure already stores the true period values:
-- - one row per (payroll_month_id, employee_id) via UNIQUE constraint
-- - inputs (jsonb): recurring + non-recurring payroll inputs used for the period
-- - calculations (jsonb): computed results stored for historical accuracy
--
-- This migration adds an employee master snapshot so changes in public.employees do not
-- rewrite history for closed payroll periods.

-- 1) Add employee snapshot (freezes employee master fields per payroll period)
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM information_schema.columns
    WHERE table_schema='public'
      AND table_name='payroll_records'
      AND column_name='employee_snapshot'
  ) THEN
    ALTER TABLE public.payroll_records
      ADD COLUMN employee_snapshot jsonb NOT NULL DEFAULT '{}'::jsonb;
  END IF;
END $$;

-- 2) Populate snapshot from current employee row when inserting/updating
CREATE OR REPLACE FUNCTION public.set_payroll_record_employee_snapshot()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE
  e public.employees%ROWTYPE;
BEGIN
  -- Only refresh snapshot for open records (closed records must remain immutable).
  IF NEW.closed_at IS NOT NULL THEN
    RETURN NEW;
  END IF;

  -- Refresh if employee changes or snapshot is empty.
  IF TG_OP = 'INSERT'
     OR NEW.employee_id IS DISTINCT FROM COALESCE(OLD.employee_id, NEW.employee_id)
     OR NEW.employee_snapshot = '{}'::jsonb
  THEN
    SELECT * INTO e
    FROM public.employees
    WHERE id = NEW.employee_id
      AND org_id = NEW.org_id;

    IF NOT FOUND THEN
      RAISE EXCEPTION 'Employee not found for payroll snapshot (org_id %, employee_id %)', NEW.org_id, NEW.employee_id
        USING ERRCODE = '23503';
    END IF;

    NEW.employee_snapshot = jsonb_build_object(
      'idNumber', e.id_number,
      'fullName', e.full_name,
      'gender', e.gender,
      'positionNumber', e.position_number,
      'designation', e.designation,
      'staffingCategory', e.staffing_category,
      'department', e.department,
      'unit', e.unit,
      'region', e.region,
      'dutyStation', e.duty_station,
      'jobLocation', e.job_location,
      'contractType', e.contract_type,
      'jobStatus', e.job_status,
      'employmentStatus', e.employment_status,
      'joiningDate', e.joining_date,
      'contractStartDate', e.contract_start_date,
      'contractEndDate', e.contract_end_date,
      'currency', e.currency
    );
  END IF;

  RETURN NEW;
END $$;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_trigger
    WHERE tgrelid='public.payroll_records'::regclass
      AND tgname='trg_payroll_records_employee_snapshot'
  ) THEN
    CREATE TRIGGER trg_payroll_records_employee_snapshot
      BEFORE INSERT OR UPDATE OF employee_id, employee_snapshot ON public.payroll_records
      FOR EACH ROW
      EXECUTE FUNCTION public.set_payroll_record_employee_snapshot();
  END IF;
END $$;

-- 3) Prevent mutation of closed snapshots (defense-in-depth)
CREATE OR REPLACE FUNCTION public.prevent_closed_payroll_record_mutation()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  IF OLD.closed_at IS NOT NULL THEN
    IF NEW.inputs IS DISTINCT FROM OLD.inputs
      OR NEW.calculations IS DISTINCT FROM OLD.calculations
      OR NEW.employee_snapshot IS DISTINCT FROM OLD.employee_snapshot
      OR NEW.employee_id IS DISTINCT FROM OLD.employee_id
      OR NEW.payroll_month_id IS DISTINCT FROM OLD.payroll_month_id
    THEN
      RAISE EXCEPTION 'Closed payroll record is immutable' USING ERRCODE = '23514';
    END IF;
  END IF;
  RETURN NEW;
END $$;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_trigger
    WHERE tgrelid='public.payroll_records'::regclass
      AND tgname='trg_payroll_records_immutable_when_closed'
  ) THEN
    CREATE TRIGGER trg_payroll_records_immutable_when_closed
      BEFORE UPDATE ON public.payroll_records
      FOR EACH ROW
      EXECUTE FUNCTION public.prevent_closed_payroll_record_mutation();
  END IF;
END $$;

-- 4) Backfill snapshots for existing rows (if any)
UPDATE public.payroll_records pr
SET employee_snapshot = jsonb_build_object(
  'idNumber', e.id_number,
  'fullName', e.full_name,
  'gender', e.gender,
  'positionNumber', e.position_number,
  'designation', e.designation,
  'staffingCategory', e.staffing_category,
  'department', e.department,
  'unit', e.unit,
  'region', e.region,
  'dutyStation', e.duty_station,
  'jobLocation', e.job_location,
  'contractType', e.contract_type,
  'jobStatus', e.job_status,
  'employmentStatus', e.employment_status,
  'joiningDate', e.joining_date,
  'contractStartDate', e.contract_start_date,
  'contractEndDate', e.contract_end_date,
  'currency', e.currency
)
FROM public.employees e
WHERE pr.org_id = e.org_id
  AND pr.employee_id = e.id
  AND (pr.employee_snapshot = '{}'::jsonb);

-- 5) View: canonical payroll snapshot per employee per period (multi-year)
CREATE OR REPLACE VIEW public.v_payroll_employee_snapshots AS
SELECT
  pr.id AS payroll_record_id,
  pr.org_id,
  pm.month_key AS payroll_period,
  pm.status AS payroll_status,
  pr.employee_id,
  pr.employee_snapshot,
  pr.inputs,
  pr.calculations,
  pr.processed_at,
  pr.closed_at,
  pr.created_at,
  pr.updated_at
FROM public.payroll_records pr
JOIN public.payroll_months pm
  ON pm.id = pr.payroll_month_id
 AND pm.org_id = pr.org_id;

COMMENT ON VIEW public.v_payroll_employee_snapshots IS
  'One row = one employee + one payroll period. Period values are stored in inputs/calculations (jsonb). Employee master fields are frozen in employee_snapshot.';

