-- Individual delegated permissions + immutable admin audit log for password resets.
-- Additive only. Does not alter existing roles, memberships, or auth.users passwords.
--
-- Security model:
-- - member_permissions: only Super Admin may grant/revoke via RLS.
-- - admin_audit_logs: append-only; authenticated clients cannot INSERT/UPDATE/DELETE.
--   Application writes audits exclusively through the service_role (admin API routes).

CREATE TABLE IF NOT EXISTS public.member_permissions (
  org_id uuid NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
  user_id uuid NOT NULL,
  permission text NOT NULL,
  granted_by uuid NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (org_id, user_id, permission),
  CONSTRAINT member_permissions_permission_chk
    CHECK (permission = 'users.reset_password')
);

CREATE INDEX IF NOT EXISTS member_permissions_org_permission_idx
  ON public.member_permissions (org_id, permission);

COMMENT ON TABLE public.member_permissions IS
  'Org-scoped individual permissions layered on top of role-based access. Only Super Admin may grant/revoke.';

CREATE TABLE IF NOT EXISTS public.admin_audit_logs (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id uuid NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
  actor_user_id uuid NOT NULL,
  target_user_id uuid NULL,
  action text NOT NULL,
  success boolean NOT NULL DEFAULT true,
  details jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT admin_audit_logs_action_chk
    CHECK (btrim(action) <> ''),
  CONSTRAINT admin_audit_logs_no_secrets_chk
    CHECK (
      details ? 'password' IS FALSE
      AND details ? 'tempPassword' IS FALSE
      AND details ? 'token' IS FALSE
      AND details ? 'recoveryToken' IS FALSE
    )
);

CREATE INDEX IF NOT EXISTS admin_audit_logs_org_created_idx
  ON public.admin_audit_logs (org_id, created_at DESC);

CREATE INDEX IF NOT EXISTS admin_audit_logs_org_actor_created_idx
  ON public.admin_audit_logs (org_id, actor_user_id, created_at DESC);

CREATE INDEX IF NOT EXISTS admin_audit_logs_org_target_created_idx
  ON public.admin_audit_logs (org_id, target_user_id, created_at DESC);

COMMENT ON TABLE public.admin_audit_logs IS
  'Append-only administrative audit events. Writes are service_role only; authenticated clients may SELECT (super_admin) but never INSERT/UPDATE/DELETE.';

ALTER TABLE public.member_permissions ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.admin_audit_logs ENABLE ROW LEVEL SECURITY;

-- Helper: active membership role for current auth user in an org.
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
    AND m.status = 'active'::public.member_status
  LIMIT 1;
$$;

REVOKE ALL ON FUNCTION public.current_org_member_role(uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.current_org_member_role(uuid) TO authenticated, service_role;

-- member_permissions RLS (Super Admin only for mutations)
DROP POLICY IF EXISTS member_permissions_select_scoped ON public.member_permissions;
CREATE POLICY member_permissions_select_scoped
  ON public.member_permissions
  FOR SELECT
  TO authenticated
  USING (
    auth.uid() IS NOT NULL
    AND (
      user_id = auth.uid()
      OR public.current_org_member_role(org_id) = 'super_admin'
    )
  );

DROP POLICY IF EXISTS member_permissions_insert_super_admin ON public.member_permissions;
CREATE POLICY member_permissions_insert_super_admin
  ON public.member_permissions
  FOR INSERT
  TO authenticated
  WITH CHECK (public.current_org_member_role(org_id) = 'super_admin');

DROP POLICY IF EXISTS member_permissions_update_super_admin ON public.member_permissions;
CREATE POLICY member_permissions_update_super_admin
  ON public.member_permissions
  FOR UPDATE
  TO authenticated
  USING (public.current_org_member_role(org_id) = 'super_admin')
  WITH CHECK (public.current_org_member_role(org_id) = 'super_admin');

DROP POLICY IF EXISTS member_permissions_delete_super_admin ON public.member_permissions;
CREATE POLICY member_permissions_delete_super_admin
  ON public.member_permissions
  FOR DELETE
  TO authenticated
  USING (public.current_org_member_role(org_id) = 'super_admin');

-- admin_audit_logs: Super Admin read-only; no authenticated INSERT/UPDATE/DELETE.
DROP POLICY IF EXISTS admin_audit_logs_select_scoped ON public.admin_audit_logs;
CREATE POLICY admin_audit_logs_select_scoped
  ON public.admin_audit_logs
  FOR SELECT
  TO authenticated
  USING (public.current_org_member_role(org_id) = 'super_admin');

DROP POLICY IF EXISTS admin_audit_logs_insert_super_admin ON public.admin_audit_logs;
DROP POLICY IF EXISTS admin_audit_logs_insert_delegated ON public.admin_audit_logs;

-- Table grants: authenticated may SELECT audit logs (RLS still applies); never write.
GRANT SELECT, INSERT, UPDATE, DELETE ON TABLE public.member_permissions TO authenticated, service_role;
GRANT SELECT ON TABLE public.admin_audit_logs TO authenticated;
GRANT ALL ON TABLE public.member_permissions TO service_role;
GRANT ALL ON TABLE public.admin_audit_logs TO service_role;

REVOKE INSERT, UPDATE, DELETE ON TABLE public.admin_audit_logs FROM authenticated, anon;
REVOKE ALL ON TABLE public.admin_audit_logs FROM PUBLIC;
