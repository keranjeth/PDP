-- Ensure public reporting views run with invoker privileges (respect caller RLS + privileges).
ALTER VIEW public.v_compensation_records_history SET (security_invoker = true);
ALTER VIEW public.v_payroll_employee_snapshots SET (security_invoker = true);
ALTER VIEW public.v_payroll_records_reporting SET (security_invoker = true);

-- Align base-table access: HR National cannot access Senior Management employees.
-- (Payroll/comp already enforced via can_access_employee_sensitive; extend to employees table too.)
CREATE OR REPLACE FUNCTION public.can_access_employee(p_org_id uuid, p_employee_id uuid)
RETURNS boolean
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
AS $function$
DECLARE
  r public.org_role;
  emp_region text;
  emp_staffing text;
  is_linked boolean;
  regions text[];
BEGIN
  IF auth.uid() IS NULL THEN
    RETURN false;
  END IF;

  IF NOT public.member_is_active(p_org_id) THEN
    RETURN false;
  END IF;

  r := public.org_role(p_org_id);
  IF r IS NULL THEN
    RETURN false;
  END IF;

  SELECT e.region, e.staffing_category
    INTO emp_region, emp_staffing
  FROM public.employees e
  WHERE e.org_id = p_org_id
    AND e.id = p_employee_id
    AND e.deleted_at IS NULL
  LIMIT 1;

  IF emp_region IS NULL THEN
    RETURN false;
  END IF;

  -- Employee self access: must be linked to the employee.
  IF r = 'employee'::public.org_role THEN
    SELECT EXISTS (
      SELECT 1
      FROM public.employee_user_links l
      WHERE l.org_id = p_org_id
        AND l.user_id = auth.uid()
        AND l.employee_id = p_employee_id
    ) INTO is_linked;
    RETURN COALESCE(is_linked, false);
  END IF;

  -- Super Admin / Head of HR: full access.
  IF r = ANY (ARRAY['super_admin'::public.org_role, 'head_of_hr'::public.org_role]) THEN
    RETURN true;
  END IF;

  -- HR National: all except Senior Management.
  IF r = 'hr_national'::public.org_role THEN
    RETURN COALESCE(emp_staffing, '') <> 'Senior Management';
  END IF;

  -- Regional HR: by region.
  IF r = 'regional_hr'::public.org_role THEN
    regions := public.member_regions(p_org_id);
    RETURN emp_region = ANY (regions);
  END IF;

  RETURN false;
END;
$function$;

