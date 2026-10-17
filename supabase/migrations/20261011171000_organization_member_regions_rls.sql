-- RLS for organization_member_regions.
-- Preserves existing read access for Super Admin, Head of HR, and HR National.
-- Regional HR (and any member) may read only their own assigned regions.
-- Only Super Admin may create, modify, or delete regional assignments.
-- Additive with respect to data: does not alter existing region rows.

ALTER TABLE public.organization_member_regions ENABLE ROW LEVEL SECURITY;

DO $$
DECLARE r record;
BEGIN
  FOR r IN
    SELECT policyname FROM pg_policies
    WHERE schemaname = 'public' AND tablename = 'organization_member_regions'
  LOOP
    EXECUTE format('DROP POLICY IF EXISTS %I ON public.organization_member_regions', r.policyname);
  END LOOP;
END $$;

-- SELECT: own rows, or org-wide for Super Admin / Head of HR / HR National.
-- Matches the pre-existing production policy shape (org_role).
CREATE POLICY organization_member_regions_select_scoped
  ON public.organization_member_regions
  FOR SELECT
  TO authenticated
  USING (
    auth.uid() IS NOT NULL
    AND (
      user_id = auth.uid()
      OR public.org_role(org_id) = ANY (
        ARRAY[
          'super_admin'::public.org_role,
          'head_of_hr'::public.org_role,
          'hr_national'::public.org_role
        ]
      )
    )
  );

-- Only Super Admin may insert/update/delete region assignments.
-- Users cannot expand their own regional access via these policies.
CREATE POLICY organization_member_regions_insert_super_admin
  ON public.organization_member_regions
  FOR INSERT
  TO authenticated
  WITH CHECK (
    auth.uid() IS NOT NULL
    AND public.org_role(org_id) = 'super_admin'::public.org_role
  );

CREATE POLICY organization_member_regions_update_super_admin
  ON public.organization_member_regions
  FOR UPDATE
  TO authenticated
  USING (
    auth.uid() IS NOT NULL
    AND public.org_role(org_id) = 'super_admin'::public.org_role
  )
  WITH CHECK (
    auth.uid() IS NOT NULL
    AND public.org_role(org_id) = 'super_admin'::public.org_role
  );

CREATE POLICY organization_member_regions_delete_super_admin
  ON public.organization_member_regions
  FOR DELETE
  TO authenticated
  USING (
    auth.uid() IS NOT NULL
    AND public.org_role(org_id) = 'super_admin'::public.org_role
  );

GRANT SELECT, INSERT, UPDATE, DELETE ON TABLE public.organization_member_regions TO authenticated, service_role;
