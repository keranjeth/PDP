-- Link Supabase auth users to employees (per organization).
-- This project already uses organizations + org-scoped employees; this table adds a normalized bridge.
--
-- Notes:
-- - user_id references auth.users.id (Supabase Auth user id).
-- - employee_id is the Workforce Administration employees PK (uuid) and is tenant-scoped via (org_id, employee_id).
-- - RLS is enabled and uses existing org_role(org_id) helper (already referenced by other policies).
--
-- Assumed existing tables:
-- - public.organizations(id uuid)
-- - public.employees(id uuid, org_id uuid, ...)
-- - org_role(org_id) returns the caller's role in that org.
--
-- If org_role(org_id) is not present in your database, create it before applying these policies.

CREATE TABLE IF NOT EXISTS public.employee_user_links (
  org_id uuid NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
  employee_id uuid NOT NULL,
  user_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  created_at timestamptz NOT NULL DEFAULT now(),
  created_by uuid NULL REFERENCES auth.users(id) ON DELETE SET NULL,
  PRIMARY KEY (org_id, employee_id),
  CONSTRAINT employee_user_links_org_employee_fk
    FOREIGN KEY (org_id, employee_id)
    REFERENCES public.employees(org_id, id)
    ON DELETE CASCADE,
  CONSTRAINT employee_user_links_org_user_unique UNIQUE (org_id, user_id)
);

CREATE INDEX IF NOT EXISTS employee_user_links_org_id_idx
  ON public.employee_user_links(org_id);

CREATE INDEX IF NOT EXISTS employee_user_links_user_id_idx
  ON public.employee_user_links(user_id);

ALTER TABLE public.employee_user_links ENABLE ROW LEVEL SECURITY;

-- Members can view links within their org (useful for showing “linked employee” in UI).
DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM pg_policy
    WHERE polrelid = 'public.employee_user_links'::regclass
      AND polname = 'employee_user_links_select_member'
  ) THEN
    EXECUTE 'DROP POLICY employee_user_links_select_member ON public.employee_user_links';
  END IF;

  EXECUTE $p$
    CREATE POLICY employee_user_links_select_member
    ON public.employee_user_links
    FOR SELECT
    TO public
    USING (auth.uid() IS NOT NULL AND org_role(org_id) IS NOT NULL)
  $p$;
END $$;

-- Only privileged roles can create links.
DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM pg_policy
    WHERE polrelid = 'public.employee_user_links'::regclass
      AND polname = 'employee_user_links_insert_privileged'
  ) THEN
    EXECUTE 'DROP POLICY employee_user_links_insert_privileged ON public.employee_user_links';
  END IF;

  EXECUTE $p$
    CREATE POLICY employee_user_links_insert_privileged
    ON public.employee_user_links
    FOR INSERT
    TO public
    WITH CHECK (
      auth.uid() IS NOT NULL
      AND org_role(org_id) = ANY (ARRAY[
        'owner'::org_role,
        'admin'::org_role,
        'hr_manager'::org_role
      ])
    )
  $p$;
END $$;

-- Only privileged roles can delete links.
DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM pg_policy
    WHERE polrelid = 'public.employee_user_links'::regclass
      AND polname = 'employee_user_links_delete_privileged'
  ) THEN
    EXECUTE 'DROP POLICY employee_user_links_delete_privileged ON public.employee_user_links';
  END IF;

  EXECUTE $p$
    CREATE POLICY employee_user_links_delete_privileged
    ON public.employee_user_links
    FOR DELETE
    TO public
    USING (
      auth.uid() IS NOT NULL
      AND org_role(org_id) = ANY (ARRAY[
        'owner'::org_role,
        'admin'::org_role,
        'hr_manager'::org_role
      ])
    )
  $p$;
END $$;

