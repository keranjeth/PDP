-- Hosted DB was missing employees.reports_to_position_number while offboard_employee()
-- references e.reports_to_position_number (e := employees%ROWTYPE). Add column if needed
-- and refresh the function so PL/pgSQL row types match the table.

ALTER TABLE public.employees
  ADD COLUMN IF NOT EXISTS reports_to_position_number text;

COMMENT ON COLUMN public.employees.reports_to_position_number IS
  'Business position number of the manager role this employee reports to. Hierarchy is by position, not employee id, so turnover does not break structure.';

CREATE OR REPLACE FUNCTION public.offboard_employee(
  p_org_id uuid,
  p_employee_id uuid,
  p_last_working_date date,
  p_exit_type text,
  p_leaving_reason text,
  p_offboarded_by uuid,
  p_eligible_for_rehire boolean,
  p_rehire_note text
)
RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $function$
DECLARE
  e public.employees%ROWTYPE;
  new_leaver_id uuid;
BEGIN
  SELECT * INTO e
  FROM public.employees
  WHERE org_id = p_org_id
    AND id = p_employee_id;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Employee not found (org_id %, employee_id %)', p_org_id, p_employee_id
      USING ERRCODE = '23503';
  END IF;

  INSERT INTO public.leavers (
    org_id,
    employee_id,
    id_number,
    full_name,
    gender,
    date_of_birth,
    blood_group,
    marital_status,
    position_number,
    reports_to_position_number,
    designation,
    staffing_category,
    department,
    unit,
    region,
    duty_station,
    job_location,
    contract_type,
    job_status,
    employment_status,
    joining_date,
    contract_start_date,
    contract_end_date,
    currency,
    created_at,
    updated_at,
    created_by,
    updated_by,
    deleted_at,
    age_years,
    length_of_service_days,
    last_working_date,
    exit_type,
    leaving_reason,
    offboarded_by_user_id,
    eligible_for_rehire,
    rehire_note
  ) VALUES (
    p_org_id,
    p_employee_id,
    e.id_number,
    e.full_name,
    e.gender,
    e.date_of_birth,
    e.blood_group,
    e.marital_status,
    e.position_number,
    e.reports_to_position_number,
    e.designation,
    e.staffing_category,
    e.department,
    e.unit,
    e.region,
    e.duty_station,
    e.job_location,
    e.contract_type,
    e.job_status,
    e.employment_status,
    e.joining_date,
    e.contract_start_date,
    e.contract_end_date,
    e.currency,
    e.created_at,
    e.updated_at,
    e.created_by,
    e.updated_by,
    e.deleted_at,
    e.age_years,
    e.length_of_service_days,
    p_last_working_date,
    p_exit_type,
    COALESCE(p_leaving_reason, ''),
    p_offboarded_by,
    p_eligible_for_rehire,
    CASE WHEN p_eligible_for_rehire THEN NULL ELSE NULLIF(trim(p_rehire_note), '') END
  ) RETURNING leaver_id INTO new_leaver_id;

  INSERT INTO public.leaver_compensation_records (
    leaver_id,
    org_id,
    employee_id,
    compensation_record_id,
    component_type,
    amount,
    start_date,
    end_date,
    created_at,
    created_by,
    updated_at,
    updated_by,
    deleted_at
  )
  SELECT
    new_leaver_id,
    cr.org_id,
    cr.employee_id,
    cr.id,
    cr.component_type,
    cr.amount,
    cr.start_date,
    cr.end_date,
    cr.created_at,
    cr.created_by,
    cr.updated_at,
    cr.updated_by,
    cr.deleted_at
  FROM public.compensation_records cr
  WHERE cr.org_id = p_org_id
    AND cr.employee_id = p_employee_id;

  INSERT INTO public.leaver_payroll_record_links (
    leaver_id,
    org_id,
    employee_id,
    payroll_record_id,
    payroll_month_id,
    closed_at
  )
  SELECT
    new_leaver_id,
    pr.org_id,
    pr.employee_id,
    pr.id,
    pr.payroll_month_id,
    pr.closed_at
  FROM public.payroll_records pr
  WHERE pr.org_id = p_org_id
    AND pr.employee_id = p_employee_id;

  UPDATE public.employees
  SET employment_status = 'inactive'::employment_status,
      contract_end_date = p_last_working_date,
      updated_by = p_offboarded_by
  WHERE org_id = p_org_id
    AND id = p_employee_id;

  RETURN new_leaver_id;
END
$function$;
