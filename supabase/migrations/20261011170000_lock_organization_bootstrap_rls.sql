-- Lock down organization bootstrap at the database permission level.
-- First Super Admin membership requires organizations.created_by = auth.uid().
-- Unrelated users cannot claim an empty organization.
-- Concurrent first-org creation is serialized via advisory lock RPC.
-- Does not modify existing membership rows or employee statuses.

-- ---------------------------------------------------------------------------
-- Helpers
-- ---------------------------------------------------------------------------

CREATE OR REPLACE FUNCTION public.organizations_is_empty()
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT NOT EXISTS (SELECT 1 FROM public.organizations LIMIT 1);
$$;

CREATE OR REPLACE FUNCTION public.is_active_super_admin()
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT EXISTS (
    SELECT 1
    FROM public.organization_members m
    WHERE m.user_id = auth.uid()
      AND m.role::text = 'super_admin'
      AND m.status::text = 'active'
  );
$$;

CREATE OR REPLACE FUNCTION public.org_has_no_members(p_org_id uuid)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT NOT EXISTS (
    SELECT 1 FROM public.organization_members m WHERE m.org_id = p_org_id LIMIT 1
  );
$$;

CREATE OR REPLACE FUNCTION public.org_created_by_is_caller(p_org_id uuid)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT EXISTS (
    SELECT 1
    FROM public.organizations o
    WHERE o.id = p_org_id
      AND o.created_by IS NOT NULL
      AND o.created_by = auth.uid()
  );
$$;

CREATE OR REPLACE FUNCTION public.current_org_member_role(p_org_id uuid)
RETURNS text
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT m.role::text
  FROM public.organization_members m
  WHERE m.org_id = p_org_id
    AND m.user_id = auth.uid()
    AND m.status::text = 'active'
  LIMIT 1;
$$;

REVOKE ALL ON FUNCTION public.organizations_is_empty() FROM PUBLIC;
REVOKE ALL ON FUNCTION public.is_active_super_admin() FROM PUBLIC;
REVOKE ALL ON FUNCTION public.org_has_no_members(uuid) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.org_created_by_is_caller(uuid) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.current_org_member_role(uuid) FROM PUBLIC;

GRANT EXECUTE ON FUNCTION public.organizations_is_empty() TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.is_active_super_admin() TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.org_has_no_members(uuid) TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.org_created_by_is_caller(uuid) TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.current_org_member_role(uuid) TO authenticated, service_role;

-- Serialized first-organization bootstrap (prevents concurrent empty-DB races).
CREATE OR REPLACE FUNCTION public.bootstrap_primary_organization(p_name text DEFAULT 'Primary Organization')
RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_org_id uuid;
  v_uid uuid := auth.uid();
BEGIN
  IF v_uid IS NULL THEN
    RAISE EXCEPTION 'Not authenticated';
  END IF;

  -- Session-level advisory lock shared by all bootstrap attempts.
  PERFORM pg_advisory_xact_lock(872364011);

  IF EXISTS (SELECT 1 FROM public.organizations LIMIT 1) THEN
    RAISE EXCEPTION 'Organization already exists';
  END IF;

  INSERT INTO public.organizations (name, created_by)
  VALUES (COALESCE(NULLIF(btrim(p_name), ''), 'Primary Organization'), v_uid)
  RETURNING id INTO v_org_id;

  INSERT INTO public.organization_members (org_id, user_id, role, status)
  VALUES (v_org_id, v_uid, 'super_admin', 'active');

  RETURN v_org_id;
END;
$$;

REVOKE ALL ON FUNCTION public.bootstrap_primary_organization(text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.bootstrap_primary_organization(text) TO authenticated, service_role;

-- ---------------------------------------------------------------------------
-- organizations INSERT
-- ---------------------------------------------------------------------------

ALTER TABLE public.organizations ENABLE ROW LEVEL SECURITY;

DO $$
DECLARE r record;
BEGIN
  FOR r IN
    SELECT policyname FROM pg_policies
    WHERE schemaname = 'public' AND tablename = 'organizations' AND cmd = 'INSERT'
  LOOP
    EXECUTE format('DROP POLICY IF EXISTS %I ON public.organizations', r.policyname);
  END LOOP;
END $$;

-- Direct INSERT only for existing Super Admins creating additional orgs.
-- First install must use bootstrap_primary_organization() (advisory-locked).
CREATE POLICY organizations_insert_super_admin_only
  ON public.organizations
  FOR INSERT
  TO authenticated
  WITH CHECK (
    public.is_active_super_admin()
    AND created_by = auth.uid()
  );

COMMENT ON POLICY organizations_insert_super_admin_only ON public.organizations IS
  'Only active Super Admins may insert organizations directly. First install uses bootstrap_primary_organization().';

-- ---------------------------------------------------------------------------
-- organization_members INSERT
-- ---------------------------------------------------------------------------

ALTER TABLE public.organization_members ENABLE ROW LEVEL SECURITY;

DO $$
DECLARE r record;
BEGIN
  FOR r IN
    SELECT policyname FROM pg_policies
    WHERE schemaname = 'public' AND tablename = 'organization_members' AND cmd = 'INSERT'
  LOOP
    EXECUTE format('DROP POLICY IF EXISTS %I ON public.organization_members', r.policyname);
  END LOOP;
END $$;

CREATE POLICY organization_members_insert_authorized
  ON public.organization_members
  FOR INSERT
  TO authenticated
  WITH CHECK (
    -- Super Admin of this org may add members.
    public.current_org_member_role(org_id) = 'super_admin'
    OR (
      -- First Super Admin membership only for the verified org creator
      -- (organizations.created_by = auth.uid()). Prevents claiming empty orgs.
      user_id = auth.uid()
      AND role::text = 'super_admin'
      AND public.org_has_no_members(org_id)
      AND public.org_created_by_is_caller(org_id)
    )
  );

COMMENT ON POLICY organization_members_insert_authorized ON public.organization_members IS
  'First Super Admin must be organizations.created_by. Unrelated users cannot claim empty orgs.';
