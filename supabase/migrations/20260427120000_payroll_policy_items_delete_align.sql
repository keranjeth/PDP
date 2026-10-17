-- Align DELETE policy with UPDATE so roles that can edit tax rows can also remove them
-- (e.g. hr_manager, hr_national, regional_hr could update but not delete before).

DROP POLICY IF EXISTS payroll_policy_items_delete_privileged ON public.payroll_policy_items;

CREATE POLICY payroll_policy_items_delete_privileged
  ON public.payroll_policy_items
  FOR DELETE
  TO public
  USING (
    auth.uid() IS NOT NULL
    AND org_role(org_id) = ANY (ARRAY[
      'owner'::org_role,
      'admin'::org_role,
      'payroll_manager'::org_role,
      'super_admin'::org_role,
      'head_of_hr'::org_role,
      'hr_national'::org_role,
      'regional_hr'::org_role,
      'hr_manager'::org_role
    ])
  );
