-- Allow training budget allocations for Active and Inactive (separated) employees.
-- Historical budgets remain linked to the employee master; status is not changed.

CREATE OR REPLACE FUNCTION public.create_employee_budget(
  p_org_id uuid,
  p_employee_id uuid,
  p_planned_course text,
  p_initial_amount numeric,
  p_currency text,
  p_planned_course_start_date date
)
RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_uid uuid := auth.uid();
  v_code text;
  v_id uuid;
  v_amount numeric := COALESCE(p_initial_amount, 0);
BEGIN
  IF v_uid IS NULL THEN
    RAISE EXCEPTION 'not authenticated' USING ERRCODE = '28000';
  END IF;

  IF NOT public.can_manage_budgets(p_org_id) THEN
    RAISE EXCEPTION 'forbidden' USING ERRCODE = '42501';
  END IF;

  IF NOT public.can_access_employee(p_org_id, p_employee_id) THEN
    RAISE EXCEPTION 'forbidden' USING ERRCODE = '42501';
  END IF;

  IF NOT EXISTS (
    SELECT 1
    FROM public.employees e
    WHERE e.org_id = p_org_id
      AND e.id = p_employee_id
      AND e.deleted_at IS NULL
      AND e.employment_status IN (
        'active'::public.employment_status,
        'inactive'::public.employment_status
      )
  ) THEN
    RAISE EXCEPTION 'Employee must be an existing Active or Inactive employee record';
  END IF;

  IF NULLIF(btrim(p_planned_course), '') IS NULL THEN
    RAISE EXCEPTION 'Planned course is required';
  END IF;

  IF p_planned_course_start_date IS NULL THEN
    RAISE EXCEPTION 'Planned course start date is required';
  END IF;

  IF v_amount < 0 THEN
    RAISE EXCEPTION 'Initial budget cannot be negative';
  END IF;

  IF NULLIF(btrim(p_currency), '') IS NULL THEN
    RAISE EXCEPTION 'Currency is required';
  END IF;

  v_code := public.next_org_document_code(p_org_id, 'budget', 'BGT');

  INSERT INTO public.employee_budgets (
    org_id,
    budget_code,
    employee_id,
    planned_course,
    initial_amount,
    currency,
    planned_course_start_date,
    created_by,
    updated_by
  ) VALUES (
    p_org_id,
    v_code,
    p_employee_id,
    btrim(p_planned_course),
    v_amount,
    upper(btrim(p_currency)),
    p_planned_course_start_date,
    v_uid,
    v_uid
  )
  RETURNING id INTO v_id;

  RETURN v_id;
END;
$$;
