-- Super-admin permanent purge of one employee and all connected operational data.
-- Bypasses finalized-row mutation guards via session_replication_role for this transaction only.

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
  v_exists boolean;
  v_linked_user_id uuid;
  v_id_number text;
  v_full_name text;
  v_recovery_table text;
BEGIN
  SELECT EXISTS (
    SELECT 1
    FROM public.employees e
    WHERE e.org_id = p_org_id
      AND e.id = p_employee_id
  )
  INTO v_exists;

  IF NOT v_exists THEN
    RAISE EXCEPTION 'Employee not found (org_id %, employee_id %)', p_org_id, p_employee_id
      USING ERRCODE = 'P0002';
  END IF;

  SELECT e.id_number, e.full_name
  INTO v_id_number, v_full_name
  FROM public.employees e
  WHERE e.org_id = p_org_id
    AND e.id = p_employee_id;

  SELECT eul.user_id
  INTO v_linked_user_id
  FROM public.employee_user_links eul
  WHERE eul.org_id = p_org_id
    AND eul.employee_id = p_employee_id
  LIMIT 1;

  -- Hosted Supabase often denies session_replication_role; child rows are deleted explicitly.
  BEGIN
    PERFORM set_config('session_replication_role', 'replica', true);
  EXCEPTION
    WHEN insufficient_privilege THEN
      NULL;
    WHEN OTHERS THEN
      NULL;
  END;

  -- Separation workflow
  IF to_regclass('public.separation_cases') IS NOT NULL THEN
    DELETE FROM public.separation_cases
    WHERE org_id = p_org_id
      AND employee_id = p_employee_id;
  END IF;

  -- Recovery ledger (table may be recovery_schedule or recovery_schedules)
  IF to_regclass('public.recovery_schedules') IS NOT NULL THEN
    v_recovery_table := 'recovery_schedules';
  ELSIF to_regclass('public.recovery_schedule') IS NOT NULL THEN
    v_recovery_table := 'recovery_schedule';
  ELSE
    v_recovery_table := NULL;
  END IF;

  IF v_recovery_table IS NOT NULL AND to_regclass('public.recovery_plans') IS NOT NULL THEN
    EXECUTE format(
      'DELETE FROM public.%I rs
       USING public.recovery_plans rp
       WHERE rs.org_id = $1
         AND rp.org_id = $1
         AND rs.recovery_plan_id = rp.id
         AND rp.employee_id = $2',
      v_recovery_table
    )
    USING p_org_id, p_employee_id;
  END IF;

  IF to_regclass('public.salary_advances') IS NOT NULL THEN
    UPDATE public.salary_advances
    SET recovery_plan_id = NULL
    WHERE org_id = p_org_id
      AND employee_id = p_employee_id;
  END IF;

  IF to_regclass('public.recovery_plans') IS NOT NULL THEN
    DELETE FROM public.recovery_plans
    WHERE org_id = p_org_id
      AND employee_id = p_employee_id;
  END IF;

  IF to_regclass('public.salary_advances') IS NOT NULL THEN
    DELETE FROM public.salary_advances
    WHERE org_id = p_org_id
      AND employee_id = p_employee_id;
  END IF;

  -- Clear FKs pointing at payroll_run_employees before removing run rows
  IF to_regclass('public.payroll_adjustments') IS NOT NULL THEN
    UPDATE public.payroll_adjustments
    SET applied_run_employee_id = NULL
    WHERE org_id = p_org_id
      AND employee_id = p_employee_id;
  END IF;

  IF to_regclass('public.overtime_entries') IS NOT NULL THEN
    UPDATE public.overtime_entries
    SET applied_run_employee_id = NULL
    WHERE org_id = p_org_id
      AND employee_id = p_employee_id;
  END IF;

  IF v_recovery_table IS NOT NULL THEN
    EXECUTE format(
      'UPDATE public.%I
       SET payroll_run_employee_id = NULL
       WHERE org_id = $1
         AND payroll_run_employee_id IN (
           SELECT id FROM public.payroll_run_employees
           WHERE org_id = $1 AND employee_id = $2
         )',
      v_recovery_table
    )
    USING p_org_id, p_employee_id;
  END IF;

  IF to_regclass('public.payroll_run_employees') IS NOT NULL THEN
    -- payroll_run_lines cascade from payroll_run_employees
    DELETE FROM public.payroll_run_employees
    WHERE org_id = p_org_id
      AND employee_id = p_employee_id;
  END IF;

  IF to_regclass('public.payroll_adjustments') IS NOT NULL THEN
    DELETE FROM public.payroll_adjustments
    WHERE org_id = p_org_id
      AND employee_id = p_employee_id;
  END IF;

  IF to_regclass('public.overtime_entries') IS NOT NULL THEN
    DELETE FROM public.overtime_entries
    WHERE org_id = p_org_id
      AND employee_id = p_employee_id;
  END IF;

  IF to_regclass('public.payroll_import_rows') IS NOT NULL THEN
    UPDATE public.payroll_import_rows
    SET employee_id = NULL
    WHERE org_id = p_org_id
      AND employee_id = p_employee_id;
  END IF;

  -- Leaver archive snapshots
  IF to_regclass('public.leaver_compensation_records') IS NOT NULL THEN
    DELETE FROM public.leaver_compensation_records
    WHERE org_id = p_org_id
      AND employee_id = p_employee_id;
  END IF;

  IF to_regclass('public.leaver_payroll_record_links') IS NOT NULL THEN
    DELETE FROM public.leaver_payroll_record_links
    WHERE org_id = p_org_id
      AND employee_id = p_employee_id;
  END IF;

  IF to_regclass('public.leavers') IS NOT NULL THEN
    DELETE FROM public.leavers
    WHERE org_id = p_org_id
      AND employee_id = p_employee_id;
  END IF;

  -- Legacy payroll / compensation
  IF to_regclass('public.payroll_records') IS NOT NULL THEN
    DELETE FROM public.payroll_records
    WHERE org_id = p_org_id
      AND employee_id = p_employee_id;
  END IF;

  IF to_regclass('public.compensation_records') IS NOT NULL THEN
    DELETE FROM public.compensation_records
    WHERE org_id = p_org_id
      AND employee_id = p_employee_id;
  END IF;

  -- Optional policy scopes keyed by employee uuid text
  IF to_regclass('public.payroll_policy_scopes') IS NOT NULL THEN
    DELETE FROM public.payroll_policy_scopes
    WHERE org_id = p_org_id
      AND scope_type = 'employee'
      AND scope_value = p_employee_id::text;
  END IF;

  -- Auth bridge + membership for this org
  IF to_regclass('public.employee_user_links') IS NOT NULL THEN
    DELETE FROM public.employee_user_links
    WHERE org_id = p_org_id
      AND employee_id = p_employee_id;
  END IF;

  IF v_linked_user_id IS NOT NULL THEN
    IF to_regclass('public.organization_member_regions') IS NOT NULL THEN
      DELETE FROM public.organization_member_regions
      WHERE org_id = p_org_id
        AND user_id = v_linked_user_id;
    END IF;

    IF to_regclass('public.organization_members') IS NOT NULL THEN
      UPDATE public.organization_members
      SET status = 'inactive'
      WHERE org_id = p_org_id
        AND user_id = v_linked_user_id;
    END IF;
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

COMMENT ON FUNCTION public.hard_delete_employee(uuid, uuid, uuid) IS
  'Permanently deletes an employee and connected payroll/compensation/leaver/recovery data. Intended for super_admin API only.';

REVOKE ALL ON FUNCTION public.hard_delete_employee(uuid, uuid, uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.hard_delete_employee(uuid, uuid, uuid) TO service_role;
