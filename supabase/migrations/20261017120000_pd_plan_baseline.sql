-- PD Plan clean baseline schema
-- Self-contained foundation for organizations, auth membership, employees,
-- leavers/offboarding, user permissions, and hard delete.
-- Employee master excludes overtime group, currency, blood group, and marital status.
-- Does NOT include payroll, compensation, pension, tax, overtime groups,
-- work calendars, recovery ledgers, separation payments, budgets, or training tables.
-- Apply to a NEW Supabase project only.

-- ---------------------------------------------------------------------------
-- Extensions
-- ---------------------------------------------------------------------------
CREATE EXTENSION IF NOT EXISTS pgcrypto;

-- ---------------------------------------------------------------------------
-- Enums
-- ---------------------------------------------------------------------------
DO $$ BEGIN
  CREATE TYPE public.org_role AS ENUM (
    'super_admin',
    'head_of_hr',
    'hr_national',
    'regional_hr',
    'employee'
  );
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

DO $$ BEGIN
  CREATE TYPE public.member_status AS ENUM (
    'active',
    'inactive',
    'pending_activation'
  );
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

DO $$ BEGIN
  CREATE TYPE public.gender AS ENUM ('male', 'female');
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

DO $$ BEGIN
  CREATE TYPE public.contract_type AS ENUM ('regular', 'non_regular');
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

DO $$ BEGIN
  CREATE TYPE public.job_status AS ENUM ('full_time', 'part_time');
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

DO $$ BEGIN
  CREATE TYPE public.employment_status AS ENUM ('active', 'inactive');
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

COMMENT ON TYPE public.member_status IS
  'Organization membership access status (separate from employee employment_status).';

-- ---------------------------------------------------------------------------
-- Core tables
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.organizations (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  name text NOT NULL,
  created_by uuid REFERENCES auth.users (id) ON DELETE SET NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS public.profiles (
  user_id uuid PRIMARY KEY REFERENCES auth.users (id) ON DELETE CASCADE,
  full_name text,
  email text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS public.organization_members (
  org_id uuid NOT NULL REFERENCES public.organizations (id) ON DELETE CASCADE,
  user_id uuid NOT NULL REFERENCES auth.users (id) ON DELETE CASCADE,
  role public.org_role NOT NULL,
  status public.member_status NOT NULL DEFAULT 'active',
  created_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (org_id, user_id)
);

CREATE INDEX IF NOT EXISTS organization_members_user_id_idx
  ON public.organization_members (user_id);

CREATE TABLE IF NOT EXISTS public.organization_member_regions (
  org_id uuid NOT NULL,
  user_id uuid NOT NULL,
  region text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (org_id, user_id, region),
  CONSTRAINT organization_member_regions_member_fk
    FOREIGN KEY (org_id, user_id)
    REFERENCES public.organization_members (org_id, user_id)
    ON DELETE CASCADE,
  CONSTRAINT organization_member_regions_region_chk
    CHECK (btrim(region) <> '')
);

CREATE TABLE IF NOT EXISTS public.employees (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id uuid NOT NULL REFERENCES public.organizations (id) ON DELETE CASCADE,
  id_number text NOT NULL,
  full_name text NOT NULL,
  gender public.gender NOT NULL,
  date_of_birth date,
  position_number text,
  reports_to_position_number text,
  designation text NOT NULL,
  staffing_category text,
  department text NOT NULL,
  unit text,
  region text,
  duty_station text,
  job_location text,
  contract_type public.contract_type,
  job_status public.job_status,
  employment_status public.employment_status,
  joining_date date NOT NULL,
  contract_start_date date,
  contract_end_date date,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  created_by uuid REFERENCES auth.users (id) ON DELETE SET NULL,
  updated_by uuid REFERENCES auth.users (id) ON DELETE SET NULL,
  deleted_at timestamptz,
  age_years integer,
  length_of_service_days integer,
  CONSTRAINT employees_org_id_id_key UNIQUE (org_id, id),
  CONSTRAINT employees_org_id_id_number_key UNIQUE (org_id, id_number),
  CONSTRAINT employees_contract_date_order_chk CHECK (
    contract_start_date IS NULL
    OR contract_end_date IS NULL
    OR contract_end_date >= contract_start_date
  )
);

CREATE UNIQUE INDEX IF NOT EXISTS employees_org_id_number_lower_uidx
  ON public.employees (org_id, lower(id_number));

CREATE INDEX IF NOT EXISTS employees_org_active_region_idx
  ON public.employees (org_id, region)
  WHERE deleted_at IS NULL AND length(trim(COALESCE(region, ''))) > 0;

CREATE INDEX IF NOT EXISTS employees_org_employment_status_idx
  ON public.employees (org_id, employment_status)
  WHERE deleted_at IS NULL;

CREATE TABLE IF NOT EXISTS public.employee_user_links (
  org_id uuid NOT NULL REFERENCES public.organizations (id) ON DELETE CASCADE,
  employee_id uuid NOT NULL,
  user_id uuid NOT NULL REFERENCES auth.users (id) ON DELETE CASCADE,
  created_at timestamptz NOT NULL DEFAULT now(),
  created_by uuid REFERENCES auth.users (id) ON DELETE SET NULL,
  PRIMARY KEY (org_id, employee_id),
  CONSTRAINT employee_user_links_org_employee_fk
    FOREIGN KEY (org_id, employee_id)
    REFERENCES public.employees (org_id, id)
    ON DELETE CASCADE,
  CONSTRAINT employee_user_links_org_user_unique UNIQUE (org_id, user_id)
);

CREATE INDEX IF NOT EXISTS employee_user_links_user_id_idx
  ON public.employee_user_links (user_id);

CREATE TABLE IF NOT EXISTS public.leavers (
  leaver_id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id uuid NOT NULL REFERENCES public.organizations (id) ON DELETE CASCADE,
  employee_id uuid NOT NULL,
  id_number text NOT NULL,
  full_name text NOT NULL,
  gender public.gender NOT NULL,
  date_of_birth date,
  position_number text,
  reports_to_position_number text,
  designation text NOT NULL,
  staffing_category text,
  department text NOT NULL,
  unit text,
  region text,
  duty_station text,
  job_location text,
  contract_type public.contract_type,
  job_status public.job_status,
  employment_status public.employment_status,
  joining_date date NOT NULL,
  contract_start_date date,
  contract_end_date date,
  created_at timestamptz,
  updated_at timestamptz,
  created_by uuid,
  updated_by uuid,
  deleted_at timestamptz,
  age_years integer,
  length_of_service_days integer,
  last_working_date date NOT NULL,
  exit_type text NOT NULL,
  leaving_reason text NOT NULL DEFAULT '',
  offboarded_by_user_id uuid REFERENCES auth.users (id) ON DELETE SET NULL,
  eligible_for_rehire boolean NOT NULL DEFAULT true,
  rehire_note text,
  offboarded_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS leavers_org_offboarded_idx
  ON public.leavers (org_id, offboarded_at DESC);

CREATE INDEX IF NOT EXISTS leavers_org_employee_idx
  ON public.leavers (org_id, employee_id);

CREATE TABLE IF NOT EXISTS public.member_permissions (
  org_id uuid NOT NULL REFERENCES public.organizations (id) ON DELETE CASCADE,
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

CREATE TABLE IF NOT EXISTS public.admin_audit_logs (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id uuid NOT NULL REFERENCES public.organizations (id) ON DELETE CASCADE,
  actor_user_id uuid NOT NULL,
  target_user_id uuid NULL,
  action text NOT NULL,
  success boolean NOT NULL DEFAULT true,
  details jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT admin_audit_logs_action_chk CHECK (btrim(action) <> ''),
  CONSTRAINT admin_audit_logs_no_secrets_chk CHECK (
    details ? 'password' IS FALSE
    AND details ? 'tempPassword' IS FALSE
    AND details ? 'token' IS FALSE
    AND details ? 'recoveryToken' IS FALSE
  )
);

CREATE INDEX IF NOT EXISTS admin_audit_logs_org_created_idx
  ON public.admin_audit_logs (org_id, created_at DESC);

-- ---------------------------------------------------------------------------
-- Helper functions
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.set_updated_at()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  NEW.updated_at := now();
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS organizations_set_updated_at ON public.organizations;
CREATE TRIGGER organizations_set_updated_at
  BEFORE UPDATE ON public.organizations
  FOR EACH ROW EXECUTE PROCEDURE public.set_updated_at();

DROP TRIGGER IF EXISTS profiles_set_updated_at ON public.profiles;
CREATE TRIGGER profiles_set_updated_at
  BEFORE UPDATE ON public.profiles
  FOR EACH ROW EXECUTE PROCEDURE public.set_updated_at();

DROP TRIGGER IF EXISTS employees_set_updated_at ON public.employees;
CREATE TRIGGER employees_set_updated_at
  BEFORE UPDATE ON public.employees
  FOR EACH ROW EXECUTE PROCEDURE public.set_updated_at();

CREATE OR REPLACE FUNCTION public.employee_derived_fields()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  IF NEW.date_of_birth IS NOT NULL THEN
    NEW.age_years := GREATEST(
      0,
      date_part('year', age(CURRENT_DATE, NEW.date_of_birth))::integer
    );
  ELSE
    NEW.age_years := NULL;
  END IF;

  IF NEW.joining_date IS NOT NULL THEN
    NEW.length_of_service_days := GREATEST(
      0,
      (CURRENT_DATE - NEW.joining_date)
    );
  ELSE
    NEW.length_of_service_days := NULL;
  END IF;

  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS employees_derived_fields ON public.employees;
CREATE TRIGGER employees_derived_fields
  BEFORE INSERT OR UPDATE OF date_of_birth, joining_date ON public.employees
  FOR EACH ROW EXECUTE PROCEDURE public.employee_derived_fields();

CREATE OR REPLACE FUNCTION public.org_role(p_org_id uuid)
RETURNS public.org_role
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT m.role
  FROM public.organization_members m
  WHERE m.org_id = p_org_id
    AND m.user_id = auth.uid()
    AND m.status = 'active'::public.member_status
  LIMIT 1;
$$;

CREATE OR REPLACE FUNCTION public.member_is_active(p_org_id uuid)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT EXISTS (
    SELECT 1
    FROM public.organization_members m
    WHERE m.org_id = p_org_id
      AND m.user_id = auth.uid()
      AND m.status = 'active'::public.member_status
  );
$$;

CREATE OR REPLACE FUNCTION public.member_regions(p_org_id uuid)
RETURNS text[]
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT COALESCE(array_agg(r.region ORDER BY r.region), ARRAY[]::text[])
  FROM public.organization_member_regions r
  WHERE r.org_id = p_org_id
    AND r.user_id = auth.uid();
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
    AND m.status = 'active'::public.member_status
  LIMIT 1;
$$;

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
      AND m.role = 'super_admin'::public.org_role
      AND m.status = 'active'::public.member_status
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

  IF NOT FOUND THEN
    RETURN false;
  END IF;

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

  IF r = ANY (ARRAY['super_admin'::public.org_role, 'head_of_hr'::public.org_role]) THEN
    RETURN true;
  END IF;

  IF r = 'hr_national'::public.org_role THEN
    RETURN COALESCE(emp_staffing, '') <> 'Senior Management';
  END IF;

  IF r = 'regional_hr'::public.org_role THEN
    regions := public.member_regions(p_org_id);
    RETURN COALESCE(emp_region, '') <> '' AND emp_region = ANY (regions);
  END IF;

  RETURN false;
END;
$function$;

CREATE OR REPLACE FUNCTION public.org_employee_regions(p_org_id uuid)
RETURNS TABLE(region text)
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF auth.uid() IS NULL THEN
    RAISE EXCEPTION 'not authenticated' USING ERRCODE = '28000';
  END IF;

  IF public.org_role(p_org_id) IS NULL THEN
    RAISE EXCEPTION 'forbidden' USING ERRCODE = '42501';
  END IF;

  RETURN QUERY
  SELECT DISTINCT trim(e.region)::text AS region
  FROM public.employees e
  WHERE e.org_id = p_org_id
    AND e.deleted_at IS NULL
    AND length(trim(COALESCE(e.region, ''))) > 0
  ORDER BY 1;
END;
$$;

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

-- Offboarding: archive employee snapshot into leavers; mark employee inactive.
CREATE OR REPLACE FUNCTION public.offboard_employee(
  p_org_id uuid,
  p_employee_id uuid,
  p_last_working_date date,
  p_exit_type text,
  p_leaving_reason text,
  p_offboarded_by uuid,
  p_eligible_for_rehire boolean,
  p_rehire_note text
)
RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $function$
DECLARE
  e public.employees%ROWTYPE;
  new_leaver_id uuid;
BEGIN
  SELECT * INTO e
  FROM public.employees
  WHERE org_id = p_org_id
    AND id = p_employee_id
    AND deleted_at IS NULL;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Employee not found (org_id %, employee_id %)', p_org_id, p_employee_id
      USING ERRCODE = 'P0002';
  END IF;

  IF e.employment_status = 'inactive'::public.employment_status THEN
    RAISE EXCEPTION 'Employee is already offboarded';
  END IF;

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
    deleted_at,
    age_years,
    length_of_service_days,
    last_working_date,
    exit_type,
    leaving_reason,
    offboarded_by_user_id,
    eligible_for_rehire,
    rehire_note
  ) VALUES (
    p_org_id,
    p_employee_id,
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
    e.deleted_at,
    e.age_years,
    e.length_of_service_days,
    p_last_working_date,
    p_exit_type,
    COALESCE(p_leaving_reason, ''),
    p_offboarded_by,
    p_eligible_for_rehire,
    CASE WHEN p_eligible_for_rehire THEN NULL ELSE NULLIF(trim(p_rehire_note), '') END
  ) RETURNING leaver_id INTO new_leaver_id;

  UPDATE public.employees
  SET employment_status = 'inactive'::public.employment_status,
      contract_end_date = p_last_working_date,
      updated_by = p_offboarded_by
  WHERE org_id = p_org_id
    AND id = p_employee_id;

  RETURN new_leaver_id;
END
$function$;

CREATE OR REPLACE FUNCTION public.hard_delete_employee(
  p_org_id uuid,
  p_employee_id uuid,
  p_deleted_by uuid DEFAULT NULL
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $function$
DECLARE
  v_linked_user_id uuid;
  v_id_number text;
  v_full_name text;
BEGIN
  SELECT e.id_number, e.full_name
  INTO v_id_number, v_full_name
  FROM public.employees e
  WHERE e.org_id = p_org_id
    AND e.id = p_employee_id;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Employee not found (org_id %, employee_id %)', p_org_id, p_employee_id
      USING ERRCODE = 'P0002';
  END IF;

  SELECT eul.user_id
  INTO v_linked_user_id
  FROM public.employee_user_links eul
  WHERE eul.org_id = p_org_id
    AND eul.employee_id = p_employee_id
  LIMIT 1;

  DELETE FROM public.leavers
  WHERE org_id = p_org_id
    AND employee_id = p_employee_id;

  DELETE FROM public.employee_user_links
  WHERE org_id = p_org_id
    AND employee_id = p_employee_id;

  IF v_linked_user_id IS NOT NULL THEN
    DELETE FROM public.organization_member_regions
    WHERE org_id = p_org_id
      AND user_id = v_linked_user_id;

    DELETE FROM public.member_permissions
    WHERE org_id = p_org_id
      AND user_id = v_linked_user_id;

    UPDATE public.organization_members
    SET status = 'inactive'::public.member_status
    WHERE org_id = p_org_id
      AND user_id = v_linked_user_id;
  END IF;

  DELETE FROM public.employees
  WHERE org_id = p_org_id
    AND id = p_employee_id;

  RETURN jsonb_build_object(
    'employeeId', p_employee_id,
    'idNumber', v_id_number,
    'fullName', v_full_name,
    'linkedUserId', v_linked_user_id,
    'deletedBy', p_deleted_by
  );
END
$function$;

CREATE OR REPLACE FUNCTION public.hard_delete_employees(
  p_org_id uuid,
  p_employee_ids uuid[],
  p_deleted_by uuid DEFAULT NULL
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $function$
DECLARE
  v_ids uuid[];
  v_deleted jsonb;
  v_id uuid;
  v_row jsonb;
  v_rows jsonb := '[]'::jsonb;
BEGIN
  IF p_org_id IS NULL THEN
    RAISE EXCEPTION 'org_id is required';
  END IF;

  v_ids := ARRAY(
    SELECT DISTINCT x
    FROM unnest(COALESCE(p_employee_ids, ARRAY[]::uuid[])) AS x
    WHERE x IS NOT NULL
  );

  IF COALESCE(array_length(v_ids, 1), 0) = 0 THEN
    RAISE EXCEPTION 'employee_ids is required';
  END IF;

  FOREACH v_id IN ARRAY v_ids LOOP
    BEGIN
      v_row := public.hard_delete_employee(p_org_id, v_id, p_deleted_by);
      v_rows := v_rows || jsonb_build_array(
        jsonb_build_object(
          'employeeId', v_row->>'employeeId',
          'idNumber', v_row->>'idNumber',
          'fullName', v_row->>'fullName',
          'linkedUserId', v_row->'linkedUserId'
        )
      );
    EXCEPTION
      WHEN SQLSTATE 'P0002' THEN
        NULL;
    END;
  END LOOP;

  v_deleted := v_rows;

  RETURN jsonb_build_object(
    'deleted', v_deleted,
    'deletedCount', jsonb_array_length(v_deleted),
    'deletedBy', p_deleted_by
  );
END
$function$;

-- ---------------------------------------------------------------------------
-- Grants
-- ---------------------------------------------------------------------------
REVOKE ALL ON FUNCTION public.org_role(uuid) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.member_is_active(uuid) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.member_regions(uuid) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.current_org_member_role(uuid) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.organizations_is_empty() FROM PUBLIC;
REVOKE ALL ON FUNCTION public.is_active_super_admin() FROM PUBLIC;
REVOKE ALL ON FUNCTION public.org_has_no_members(uuid) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.org_created_by_is_caller(uuid) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.can_access_employee(uuid, uuid) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.org_employee_regions(uuid) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.bootstrap_primary_organization(text) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.offboard_employee(uuid, uuid, date, text, text, uuid, boolean, text) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.hard_delete_employee(uuid, uuid, uuid) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.hard_delete_employees(uuid, uuid[], uuid) FROM PUBLIC;

GRANT EXECUTE ON FUNCTION public.org_role(uuid) TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.member_is_active(uuid) TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.member_regions(uuid) TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.current_org_member_role(uuid) TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.organizations_is_empty() TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.is_active_super_admin() TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.org_has_no_members(uuid) TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.org_created_by_is_caller(uuid) TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.can_access_employee(uuid, uuid) TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.org_employee_regions(uuid) TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.bootstrap_primary_organization(text) TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.offboard_employee(uuid, uuid, date, text, text, uuid, boolean, text) TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.hard_delete_employee(uuid, uuid, uuid) TO service_role;
GRANT EXECUTE ON FUNCTION public.hard_delete_employees(uuid, uuid[], uuid) TO service_role;

GRANT SELECT, INSERT, UPDATE, DELETE ON TABLE public.organizations TO authenticated, service_role;
GRANT SELECT, INSERT, UPDATE, DELETE ON TABLE public.profiles TO authenticated, service_role;
GRANT SELECT, INSERT, UPDATE, DELETE ON TABLE public.organization_members TO authenticated, service_role;
GRANT SELECT, INSERT, UPDATE, DELETE ON TABLE public.organization_member_regions TO authenticated, service_role;
GRANT SELECT, INSERT, UPDATE, DELETE ON TABLE public.employees TO authenticated, service_role;
GRANT SELECT, INSERT, UPDATE, DELETE ON TABLE public.employee_user_links TO authenticated, service_role;
GRANT SELECT, INSERT, UPDATE, DELETE ON TABLE public.leavers TO authenticated, service_role;
GRANT SELECT, INSERT, UPDATE, DELETE ON TABLE public.member_permissions TO authenticated, service_role;
GRANT SELECT ON TABLE public.admin_audit_logs TO authenticated;
GRANT ALL ON TABLE public.admin_audit_logs TO service_role;
REVOKE INSERT, UPDATE, DELETE ON TABLE public.admin_audit_logs FROM authenticated, anon;

-- ---------------------------------------------------------------------------
-- RLS
-- ---------------------------------------------------------------------------
ALTER TABLE public.organizations ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.profiles ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.organization_members ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.organization_member_regions ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.employees ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.employee_user_links ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.leavers ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.member_permissions ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.admin_audit_logs ENABLE ROW LEVEL SECURITY;

-- organizations
CREATE POLICY organizations_select_member
  ON public.organizations FOR SELECT TO authenticated
  USING (
    public.org_role(id) IS NOT NULL
    OR public.organizations_is_empty()
  );

CREATE POLICY organizations_insert_super_admin_only
  ON public.organizations FOR INSERT TO authenticated
  WITH CHECK (
    public.is_active_super_admin()
    AND created_by = auth.uid()
  );

CREATE POLICY organizations_update_super_admin
  ON public.organizations FOR UPDATE TO authenticated
  USING (public.org_role(id) = 'super_admin'::public.org_role)
  WITH CHECK (public.org_role(id) = 'super_admin'::public.org_role);

-- profiles
CREATE POLICY profiles_select_own_or_org
  ON public.profiles FOR SELECT TO authenticated
  USING (
    user_id = auth.uid()
    OR EXISTS (
      SELECT 1
      FROM public.organization_members me
      JOIN public.organization_members them
        ON them.org_id = me.org_id
      WHERE me.user_id = auth.uid()
        AND me.status = 'active'::public.member_status
        AND them.user_id = profiles.user_id
    )
  );

CREATE POLICY profiles_upsert_own
  ON public.profiles FOR INSERT TO authenticated
  WITH CHECK (user_id = auth.uid());

CREATE POLICY profiles_update_own
  ON public.profiles FOR UPDATE TO authenticated
  USING (user_id = auth.uid())
  WITH CHECK (user_id = auth.uid());

-- organization_members
CREATE POLICY organization_members_select_scoped
  ON public.organization_members FOR SELECT TO authenticated
  USING (
    user_id = auth.uid()
    OR public.org_role(org_id) IS NOT NULL
  );

CREATE POLICY organization_members_insert_authorized
  ON public.organization_members FOR INSERT TO authenticated
  WITH CHECK (
    public.current_org_member_role(org_id) = 'super_admin'
    OR (
      user_id = auth.uid()
      AND role = 'super_admin'::public.org_role
      AND public.org_has_no_members(org_id)
      AND public.org_created_by_is_caller(org_id)
    )
  );

CREATE POLICY organization_members_update_super_admin
  ON public.organization_members FOR UPDATE TO authenticated
  USING (public.current_org_member_role(org_id) = 'super_admin')
  WITH CHECK (public.current_org_member_role(org_id) = 'super_admin');

CREATE POLICY organization_members_delete_super_admin
  ON public.organization_members FOR DELETE TO authenticated
  USING (public.current_org_member_role(org_id) = 'super_admin');

-- organization_member_regions
CREATE POLICY organization_member_regions_select_scoped
  ON public.organization_member_regions FOR SELECT TO authenticated
  USING (
    user_id = auth.uid()
    OR public.org_role(org_id) = ANY (
      ARRAY[
        'super_admin'::public.org_role,
        'head_of_hr'::public.org_role,
        'hr_national'::public.org_role
      ]
    )
  );

CREATE POLICY organization_member_regions_insert_super_admin
  ON public.organization_member_regions FOR INSERT TO authenticated
  WITH CHECK (public.org_role(org_id) = 'super_admin'::public.org_role);

CREATE POLICY organization_member_regions_update_super_admin
  ON public.organization_member_regions FOR UPDATE TO authenticated
  USING (public.org_role(org_id) = 'super_admin'::public.org_role)
  WITH CHECK (public.org_role(org_id) = 'super_admin'::public.org_role);

CREATE POLICY organization_member_regions_delete_super_admin
  ON public.organization_member_regions FOR DELETE TO authenticated
  USING (public.org_role(org_id) = 'super_admin'::public.org_role);

-- employees
CREATE POLICY employees_select_scoped
  ON public.employees FOR SELECT TO authenticated
  USING (
    deleted_at IS NULL
    AND public.can_access_employee(org_id, id)
  );

CREATE POLICY employees_insert_hr
  ON public.employees FOR INSERT TO authenticated
  WITH CHECK (
    public.org_role(org_id) = ANY (
      ARRAY[
        'super_admin'::public.org_role,
        'head_of_hr'::public.org_role,
        'hr_national'::public.org_role,
        'regional_hr'::public.org_role
      ]
    )
  );

CREATE POLICY employees_update_hr
  ON public.employees FOR UPDATE TO authenticated
  USING (public.can_access_employee(org_id, id)
    AND public.org_role(org_id) = ANY (
      ARRAY[
        'super_admin'::public.org_role,
        'head_of_hr'::public.org_role,
        'hr_national'::public.org_role,
        'regional_hr'::public.org_role
      ]
    ))
  WITH CHECK (public.org_role(org_id) = ANY (
      ARRAY[
        'super_admin'::public.org_role,
        'head_of_hr'::public.org_role,
        'hr_national'::public.org_role,
        'regional_hr'::public.org_role
      ]
    ));

CREATE POLICY employees_delete_super_admin
  ON public.employees FOR DELETE TO authenticated
  USING (public.org_role(org_id) = 'super_admin'::public.org_role);

-- employee_user_links
CREATE POLICY employee_user_links_select_member
  ON public.employee_user_links FOR SELECT TO authenticated
  USING (public.org_role(org_id) IS NOT NULL);

CREATE POLICY employee_user_links_insert_privileged
  ON public.employee_user_links FOR INSERT TO authenticated
  WITH CHECK (
    public.org_role(org_id) = ANY (
      ARRAY[
        'super_admin'::public.org_role,
        'head_of_hr'::public.org_role
      ]
    )
  );

CREATE POLICY employee_user_links_delete_privileged
  ON public.employee_user_links FOR DELETE TO authenticated
  USING (
    public.org_role(org_id) = ANY (
      ARRAY[
        'super_admin'::public.org_role,
        'head_of_hr'::public.org_role
      ]
    )
  );

-- leavers (historical employee records / Leavers tab)
CREATE POLICY leavers_select_scoped
  ON public.leavers FOR SELECT TO authenticated
  USING (
    public.org_role(org_id) = ANY (
      ARRAY[
        'super_admin'::public.org_role,
        'head_of_hr'::public.org_role,
        'hr_national'::public.org_role,
        'regional_hr'::public.org_role
      ]
    )
  );

CREATE POLICY leavers_insert_hr
  ON public.leavers FOR INSERT TO authenticated
  WITH CHECK (
    public.org_role(org_id) = ANY (
      ARRAY[
        'super_admin'::public.org_role,
        'head_of_hr'::public.org_role,
        'hr_national'::public.org_role,
        'regional_hr'::public.org_role
      ]
    )
  );

-- member_permissions
CREATE POLICY member_permissions_select_scoped
  ON public.member_permissions FOR SELECT TO authenticated
  USING (
    user_id = auth.uid()
    OR public.current_org_member_role(org_id) = 'super_admin'
  );

CREATE POLICY member_permissions_insert_super_admin
  ON public.member_permissions FOR INSERT TO authenticated
  WITH CHECK (public.current_org_member_role(org_id) = 'super_admin');

CREATE POLICY member_permissions_update_super_admin
  ON public.member_permissions FOR UPDATE TO authenticated
  USING (public.current_org_member_role(org_id) = 'super_admin')
  WITH CHECK (public.current_org_member_role(org_id) = 'super_admin');

CREATE POLICY member_permissions_delete_super_admin
  ON public.member_permissions FOR DELETE TO authenticated
  USING (public.current_org_member_role(org_id) = 'super_admin');

-- admin_audit_logs (read-only for super_admin; writes via service_role)
CREATE POLICY admin_audit_logs_select_scoped
  ON public.admin_audit_logs FOR SELECT TO authenticated
  USING (public.current_org_member_role(org_id) = 'super_admin');

NOTIFY pgrst, 'reload schema';
