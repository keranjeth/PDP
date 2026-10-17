-- Enable RLS for leaver linkage tables (derived from payroll/compensation).
-- These tables contain sensitive payroll/comp snapshot references and must not be unrestricted.
-- Policies align with employee visibility: if you can access the employee, you can read rows.

ALTER TABLE public.leaver_compensation_records ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.leaver_payroll_record_links ENABLE ROW LEVEL SECURITY;

-- Drop existing policies defensively (tables were previously unrestricted).
DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM pg_policy
    WHERE polrelid = 'public.leaver_compensation_records'::regclass
  ) THEN
    EXECUTE 'DROP POLICY IF EXISTS leaver_compensation_records_select_scoped ON public.leaver_compensation_records';
    EXECUTE 'DROP POLICY IF EXISTS leaver_compensation_records_insert_privileged ON public.leaver_compensation_records';
    EXECUTE 'DROP POLICY IF EXISTS leaver_compensation_records_update_privileged ON public.leaver_compensation_records';
    EXECUTE 'DROP POLICY IF EXISTS leaver_compensation_records_delete_privileged ON public.leaver_compensation_records';
  END IF;

  IF EXISTS (
    SELECT 1 FROM pg_policy
    WHERE polrelid = 'public.leaver_payroll_record_links'::regclass
  ) THEN
    EXECUTE 'DROP POLICY IF EXISTS leaver_payroll_record_links_select_scoped ON public.leaver_payroll_record_links';
    EXECUTE 'DROP POLICY IF EXISTS leaver_payroll_record_links_insert_privileged ON public.leaver_payroll_record_links';
    EXECUTE 'DROP POLICY IF EXISTS leaver_payroll_record_links_update_privileged ON public.leaver_payroll_record_links';
    EXECUTE 'DROP POLICY IF EXISTS leaver_payroll_record_links_delete_privileged ON public.leaver_payroll_record_links';
  END IF;
END $$;

-- SELECT: visible if caller can access the employee.
CREATE POLICY leaver_compensation_records_select_scoped
  ON public.leaver_compensation_records
  FOR SELECT
  TO public
  USING (auth.uid() IS NOT NULL AND can_access_employee(org_id, employee_id));

CREATE POLICY leaver_payroll_record_links_select_scoped
  ON public.leaver_payroll_record_links
  FOR SELECT
  TO public
  USING (auth.uid() IS NOT NULL AND can_access_employee(org_id, employee_id));

-- INSERT/UPDATE/DELETE: restrict to same privileged roles used for offboarding flows.
-- Note: `offboard_employee()` is SECURITY DEFINER; these policies are still needed to avoid
-- accidental unrestricted access and to support direct table usage if added later.
CREATE POLICY leaver_compensation_records_insert_privileged
  ON public.leaver_compensation_records
  FOR INSERT
  TO public
  WITH CHECK (
    auth.uid() IS NOT NULL
    AND org_role(org_id) = ANY (ARRAY[
      'super_admin'::org_role,
      'head_of_hr'::org_role,
      'hr_national'::org_role,
      'regional_hr'::org_role,
      'hr_manager'::org_role
    ])
    AND can_access_employee(org_id, employee_id)
  );

CREATE POLICY leaver_compensation_records_update_privileged
  ON public.leaver_compensation_records
  FOR UPDATE
  TO public
  USING (
    auth.uid() IS NOT NULL
    AND org_role(org_id) = ANY (ARRAY[
      'super_admin'::org_role,
      'head_of_hr'::org_role,
      'hr_national'::org_role,
      'regional_hr'::org_role,
      'hr_manager'::org_role
    ])
    AND can_access_employee(org_id, employee_id)
  )
  WITH CHECK (
    auth.uid() IS NOT NULL
    AND org_role(org_id) = ANY (ARRAY[
      'super_admin'::org_role,
      'head_of_hr'::org_role,
      'hr_national'::org_role,
      'regional_hr'::org_role,
      'hr_manager'::org_role
    ])
    AND can_access_employee(org_id, employee_id)
  );

CREATE POLICY leaver_compensation_records_delete_privileged
  ON public.leaver_compensation_records
  FOR DELETE
  TO public
  USING (
    auth.uid() IS NOT NULL
    AND org_role(org_id) = ANY (ARRAY[
      'super_admin'::org_role,
      'head_of_hr'::org_role
    ])
    AND can_access_employee(org_id, employee_id)
  );

CREATE POLICY leaver_payroll_record_links_insert_privileged
  ON public.leaver_payroll_record_links
  FOR INSERT
  TO public
  WITH CHECK (
    auth.uid() IS NOT NULL
    AND org_role(org_id) = ANY (ARRAY[
      'super_admin'::org_role,
      'head_of_hr'::org_role,
      'hr_national'::org_role,
      'regional_hr'::org_role,
      'hr_manager'::org_role
    ])
    AND can_access_employee(org_id, employee_id)
  );

CREATE POLICY leaver_payroll_record_links_update_privileged
  ON public.leaver_payroll_record_links
  FOR UPDATE
  TO public
  USING (
    auth.uid() IS NOT NULL
    AND org_role(org_id) = ANY (ARRAY[
      'super_admin'::org_role,
      'head_of_hr'::org_role,
      'hr_national'::org_role,
      'regional_hr'::org_role,
      'hr_manager'::org_role
    ])
    AND can_access_employee(org_id, employee_id)
  )
  WITH CHECK (
    auth.uid() IS NOT NULL
    AND org_role(org_id) = ANY (ARRAY[
      'super_admin'::org_role,
      'head_of_hr'::org_role,
      'hr_national'::org_role,
      'regional_hr'::org_role,
      'hr_manager'::org_role
    ])
    AND can_access_employee(org_id, employee_id)
  );

CREATE POLICY leaver_payroll_record_links_delete_privileged
  ON public.leaver_payroll_record_links
  FOR DELETE
  TO public
  USING (
    auth.uid() IS NOT NULL
    AND org_role(org_id) = ANY (ARRAY[
      'super_admin'::org_role,
      'head_of_hr'::org_role
    ])
    AND can_access_employee(org_id, employee_id)
  );

