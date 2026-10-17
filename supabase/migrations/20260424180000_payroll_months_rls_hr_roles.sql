-- Allow HR leadership roles to upsert payroll months (client sync after employee/comp work).
-- Previously only owner/admin/payroll_manager could INSERT/UPDATE payroll_months, which broke
-- schedulePayrollRemoteSync for hr_manager / super_admin / etc.

DROP POLICY IF EXISTS payroll_months_insert_payroll_manager ON public.payroll_months;
CREATE POLICY payroll_months_insert_payroll_manager
  ON public.payroll_months
  FOR INSERT
  TO public
  WITH CHECK (
    org_role(org_id) = ANY (ARRAY[
      'owner'::org_role,
      'admin'::org_role,
      'payroll_manager'::org_role,
      'hr_manager'::org_role,
      'super_admin'::org_role,
      'hr_national'::org_role,
      'head_of_hr'::org_role,
      'regional_hr'::org_role
    ])
  );

DROP POLICY IF EXISTS payroll_months_update_payroll_manager ON public.payroll_months;
CREATE POLICY payroll_months_update_payroll_manager
  ON public.payroll_months
  FOR UPDATE
  TO public
  USING (
    org_role(org_id) = ANY (ARRAY[
      'owner'::org_role,
      'admin'::org_role,
      'payroll_manager'::org_role,
      'hr_manager'::org_role,
      'super_admin'::org_role,
      'hr_national'::org_role,
      'head_of_hr'::org_role,
      'regional_hr'::org_role
    ])
  )
  WITH CHECK (
    org_role(org_id) = ANY (ARRAY[
      'owner'::org_role,
      'admin'::org_role,
      'payroll_manager'::org_role,
      'hr_manager'::org_role,
      'super_admin'::org_role,
      'hr_national'::org_role,
      'head_of_hr'::org_role,
      'regional_hr'::org_role
    ])
  );
