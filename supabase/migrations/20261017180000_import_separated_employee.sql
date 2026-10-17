-- Historical inactive-employee import: upsert inactive employee + leaver snapshot atomically.
-- Does not call offboard_employee (which rejects already-inactive rows and expects a live offboarder).
-- Does not fabricate offboarded_by; eligible_for_rehire defaults to true for historical imports.
-- Permission checks use p_imported_by so the function works when invoked via the service role.

CREATE OR REPLACE FUNCTION public.import_separated_employee(
  p_org_id uuid,
  p_imported_by uuid,
  p_id_number text,
  p_full_name text,
  p_gender public.gender,
  p_date_of_birth date,
  p_position_number text,
  p_reports_to_position_number text,
  p_designation text,
  p_staffing_category text,
  p_department text,
  p_unit text,
  p_region text,
  p_duty_station text,
  p_job_location text,
  p_contract_type public.contract_type,
  p_job_status public.job_status,
  p_joining_date date,
  p_contract_start_date date,
  p_contract_end_date date,
  p_last_working_date date,
  p_exit_type text,
  p_leaving_reason text
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_role public.org_role;
  v_existing public.employees%ROWTYPE;
  v_employee_id uuid;
  v_leaver_id uuid;
  v_exit text := lower(btrim(COALESCE(p_exit_type, '')));
  v_regions text[];
BEGIN
  IF p_imported_by IS NULL THEN
    RAISE EXCEPTION 'not authenticated' USING ERRCODE = '28000';
  END IF;

  SELECT m.role
  INTO v_role
  FROM public.organization_members m
  WHERE m.org_id = p_org_id
    AND m.user_id = p_imported_by
    AND m.status = 'active'::public.member_status
  LIMIT 1;

  IF v_role IS NULL OR v_role = 'employee'::public.org_role THEN
    RAISE EXCEPTION 'forbidden' USING ERRCODE = '42501';
  END IF;

  IF NULLIF(btrim(p_id_number), '') IS NULL
     OR NULLIF(btrim(p_full_name), '') IS NULL
     OR NULLIF(btrim(p_designation), '') IS NULL
     OR NULLIF(btrim(p_department), '') IS NULL
     OR p_joining_date IS NULL
     OR p_last_working_date IS NULL
     OR NULLIF(btrim(p_leaving_reason), '') IS NULL THEN
    RAISE EXCEPTION 'Required employee or separation fields are missing';
  END IF;

  IF v_exit NOT IN (
    'resignation',
    'end_of_contract',
    'termination',
    'retirement',
    'redundancy',
    'death'
  ) THEN
    RAISE EXCEPTION 'Unsupported Separation Type';
  END IF;

  IF p_last_working_date < p_joining_date THEN
    RAISE EXCEPTION 'Joining Date must not be later than Last Working Date';
  END IF;

  IF v_role = 'hr_national'::public.org_role
     AND COALESCE(p_staffing_category, '') = 'Senior Management' THEN
    RAISE EXCEPTION 'forbidden' USING ERRCODE = '42501';
  END IF;

  IF v_role = 'regional_hr'::public.org_role THEN
    SELECT COALESCE(array_agg(r.region ORDER BY r.region), ARRAY[]::text[])
    INTO v_regions
    FROM public.organization_member_regions r
    WHERE r.org_id = p_org_id
      AND r.user_id = p_imported_by;

    IF COALESCE(p_region, '') = ''
       OR NOT (p_region = ANY (v_regions)) THEN
      RAISE EXCEPTION 'forbidden' USING ERRCODE = '42501';
    END IF;
  END IF;

  SELECT * INTO v_existing
  FROM public.employees e
  WHERE e.org_id = p_org_id
    AND lower(e.id_number) = lower(btrim(p_id_number))
  LIMIT 1
  FOR UPDATE;

  IF FOUND THEN
    IF v_existing.employment_status = 'active'::public.employment_status THEN
      RAISE EXCEPTION
        'Employee ID already exists with Active status. Review before changing status.';
    END IF;

    v_employee_id := v_existing.id;

    UPDATE public.employees
    SET
      full_name = btrim(p_full_name),
      gender = p_gender,
      date_of_birth = p_date_of_birth,
      position_number = NULLIF(btrim(COALESCE(p_position_number, '')), ''),
      reports_to_position_number = NULLIF(btrim(COALESCE(p_reports_to_position_number, '')), ''),
      designation = btrim(p_designation),
      staffing_category = NULLIF(btrim(COALESCE(p_staffing_category, '')), ''),
      department = btrim(p_department),
      unit = NULLIF(btrim(COALESCE(p_unit, '')), ''),
      region = NULLIF(btrim(COALESCE(p_region, '')), ''),
      duty_station = NULLIF(btrim(COALESCE(p_duty_station, '')), ''),
      job_location = NULLIF(btrim(COALESCE(p_job_location, '')), ''),
      contract_type = p_contract_type,
      job_status = p_job_status,
      employment_status = 'inactive'::public.employment_status,
      joining_date = p_joining_date,
      contract_start_date = p_contract_start_date,
      contract_end_date = COALESCE(p_contract_end_date, p_last_working_date),
      deleted_at = NULL,
      updated_by = p_imported_by
    WHERE org_id = p_org_id
      AND id = v_employee_id;

    SELECT l.leaver_id INTO v_leaver_id
    FROM public.leavers l
    WHERE l.org_id = p_org_id
      AND l.employee_id = v_employee_id
    ORDER BY l.offboarded_at DESC
    LIMIT 1;

    IF v_leaver_id IS NULL THEN
      INSERT INTO public.leavers (
        org_id,
        employee_id,
        id_number,
        full_name,
        gender,
        date_of_birth,
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
        created_at,
        updated_at,
        created_by,
        updated_by,
        last_working_date,
        exit_type,
        leaving_reason,
        offboarded_by_user_id,
        eligible_for_rehire,
        rehire_note
      )
      SELECT
        e.org_id,
        e.id,
        e.id_number,
        e.full_name,
        e.gender,
        e.date_of_birth,
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
        e.created_at,
        e.updated_at,
        e.created_by,
        e.updated_by,
        p_last_working_date,
        v_exit,
        btrim(p_leaving_reason),
        NULL,
        true,
        NULL
      FROM public.employees e
      WHERE e.org_id = p_org_id
        AND e.id = v_employee_id
      RETURNING leaver_id INTO v_leaver_id;
    END IF;
  ELSE
    INSERT INTO public.employees (
      org_id,
      id_number,
      full_name,
      gender,
      date_of_birth,
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
      created_by,
      updated_by,
      deleted_at
    ) VALUES (
      p_org_id,
      btrim(p_id_number),
      btrim(p_full_name),
      p_gender,
      p_date_of_birth,
      NULLIF(btrim(COALESCE(p_position_number, '')), ''),
      NULLIF(btrim(COALESCE(p_reports_to_position_number, '')), ''),
      btrim(p_designation),
      NULLIF(btrim(COALESCE(p_staffing_category, '')), ''),
      btrim(p_department),
      NULLIF(btrim(COALESCE(p_unit, '')), ''),
      NULLIF(btrim(COALESCE(p_region, '')), ''),
      NULLIF(btrim(COALESCE(p_duty_station, '')), ''),
      NULLIF(btrim(COALESCE(p_job_location, '')), ''),
      p_contract_type,
      p_job_status,
      'inactive'::public.employment_status,
      p_joining_date,
      p_contract_start_date,
      COALESCE(p_contract_end_date, p_last_working_date),
      p_imported_by,
      p_imported_by,
      NULL
    )
    RETURNING id INTO v_employee_id;

    INSERT INTO public.leavers (
      org_id,
      employee_id,
      id_number,
      full_name,
      gender,
      date_of_birth,
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
      created_at,
      updated_at,
      created_by,
      updated_by,
      last_working_date,
      exit_type,
      leaving_reason,
      offboarded_by_user_id,
      eligible_for_rehire,
      rehire_note
    )
    SELECT
      e.org_id,
      e.id,
      e.id_number,
      e.full_name,
      e.gender,
      e.date_of_birth,
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
      e.created_at,
      e.updated_at,
      e.created_by,
      e.updated_by,
      p_last_working_date,
      v_exit,
      btrim(p_leaving_reason),
      NULL,
      true,
      NULL
    FROM public.employees e
    WHERE e.org_id = p_org_id
      AND e.id = v_employee_id
    RETURNING leaver_id INTO v_leaver_id;
  END IF;

  RETURN jsonb_build_object(
    'employeeId', v_employee_id,
    'leaverId', v_leaver_id,
    'idNumber', btrim(p_id_number)
  );
END;
$$;

REVOKE ALL ON FUNCTION public.import_separated_employee(
  uuid, uuid, text, text, public.gender, date, text, text, text, text, text, text, text, text, text,
  public.contract_type, public.job_status, date, date, date, date, text, text
) FROM PUBLIC;

GRANT EXECUTE ON FUNCTION public.import_separated_employee(
  uuid, uuid, text, text, public.gender, date, text, text, text, text, text, text, text, text, text,
  public.contract_type, public.job_status, date, date, date, date, text, text
) TO authenticated, service_role;
