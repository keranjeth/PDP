-- Fix hard delete on hosted Supabase: session_replication_role is often denied.
-- Soft-fail that setting; related rows are still removed explicitly first.

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
  v_recovery_table text;
  v_deleted jsonb;
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

  SELECT COALESCE(
    jsonb_agg(
      jsonb_build_object(
        'employeeId', e.id,
        'idNumber', e.id_number,
        'fullName', e.full_name,
        'linkedUserId', eul.user_id
      )
    ),
    '[]'::jsonb
  )
  INTO v_deleted
  FROM public.employees e
  LEFT JOIN public.employee_user_links eul
    ON eul.org_id = e.org_id
   AND eul.employee_id = e.id
  WHERE e.org_id = p_org_id
    AND e.id = ANY (v_ids);

  IF jsonb_array_length(v_deleted) = 0 THEN
    RETURN jsonb_build_object(
      'deleted', '[]'::jsonb,
      'deletedCount', 0,
      'deletedBy', p_deleted_by
    );
  END IF;

  v_ids := ARRAY(
    SELECT DISTINCT (row_item->>'employeeId')::uuid
    FROM jsonb_array_elements(v_deleted) AS row_item
  );

  BEGIN
    PERFORM set_config('session_replication_role', 'replica', true);
  EXCEPTION
    WHEN insufficient_privilege THEN
      NULL;
    WHEN OTHERS THEN
      NULL;
  END;

  IF to_regclass('public.separation_cases') IS NOT NULL THEN
    DELETE FROM public.separation_cases
    WHERE org_id = p_org_id
      AND employee_id = ANY (v_ids);
  END IF;

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
         AND rp.employee_id = ANY ($2)',
      v_recovery_table
    )
    USING p_org_id, v_ids;
  END IF;

  IF to_regclass('public.salary_advances') IS NOT NULL THEN
    UPDATE public.salary_advances
    SET recovery_plan_id = NULL
    WHERE org_id = p_org_id
      AND employee_id = ANY (v_ids);
  END IF;

  IF to_regclass('public.recovery_plans') IS NOT NULL THEN
    DELETE FROM public.recovery_plans
    WHERE org_id = p_org_id
      AND employee_id = ANY (v_ids);
  END IF;

  IF to_regclass('public.salary_advances') IS NOT NULL THEN
    DELETE FROM public.salary_advances
    WHERE org_id = p_org_id
      AND employee_id = ANY (v_ids);
  END IF;

  IF to_regclass('public.payroll_adjustments') IS NOT NULL THEN
    UPDATE public.payroll_adjustments
    SET applied_run_employee_id = NULL
    WHERE org_id = p_org_id
      AND employee_id = ANY (v_ids);
  END IF;

  IF to_regclass('public.overtime_entries') IS NOT NULL THEN
    UPDATE public.overtime_entries
    SET applied_run_employee_id = NULL
    WHERE org_id = p_org_id
      AND employee_id = ANY (v_ids);
  END IF;

  IF v_recovery_table IS NOT NULL THEN
    EXECUTE format(
      'UPDATE public.%I
       SET payroll_run_employee_id = NULL
       WHERE org_id = $1
         AND payroll_run_employee_id IN (
           SELECT id FROM public.payroll_run_employees
           WHERE org_id = $1 AND employee_id = ANY ($2)
         )',
      v_recovery_table
    )
    USING p_org_id, v_ids;
  END IF;

  IF to_regclass('public.payroll_run_employees') IS NOT NULL THEN
    DELETE FROM public.payroll_run_employees
    WHERE org_id = p_org_id
      AND employee_id = ANY (v_ids);
  END IF;

  IF to_regclass('public.payroll_adjustments') IS NOT NULL THEN
    DELETE FROM public.payroll_adjustments
    WHERE org_id = p_org_id
      AND employee_id = ANY (v_ids);
  END IF;

  IF to_regclass('public.overtime_entries') IS NOT NULL THEN
    DELETE FROM public.overtime_entries
    WHERE org_id = p_org_id
      AND employee_id = ANY (v_ids);
  END IF;

  IF to_regclass('public.payroll_import_rows') IS NOT NULL THEN
    UPDATE public.payroll_import_rows
    SET employee_id = NULL
    WHERE org_id = p_org_id
      AND employee_id = ANY (v_ids);
  END IF;

  IF to_regclass('public.leaver_compensation_records') IS NOT NULL THEN
    DELETE FROM public.leaver_compensation_records
    WHERE org_id = p_org_id
      AND employee_id = ANY (v_ids);
  END IF;

  IF to_regclass('public.leaver_payroll_record_links') IS NOT NULL THEN
    DELETE FROM public.leaver_payroll_record_links
    WHERE org_id = p_org_id
      AND employee_id = ANY (v_ids);
  END IF;

  IF to_regclass('public.leavers') IS NOT NULL THEN
    DELETE FROM public.leavers
    WHERE org_id = p_org_id
      AND employee_id = ANY (v_ids);
  END IF;

  IF to_regclass('public.payroll_records') IS NOT NULL THEN
    DELETE FROM public.payroll_records
    WHERE org_id = p_org_id
      AND employee_id = ANY (v_ids);
  END IF;

  IF to_regclass('public.compensation_records') IS NOT NULL THEN
    DELETE FROM public.compensation_records
    WHERE org_id = p_org_id
      AND employee_id = ANY (v_ids);
  END IF;

  IF to_regclass('public.payroll_policy_scopes') IS NOT NULL THEN
    DELETE FROM public.payroll_policy_scopes
    WHERE org_id = p_org_id
      AND scope_type = 'employee'
      AND scope_value IN (SELECT id::text FROM unnest(v_ids) AS id);
  END IF;

  IF to_regclass('public.employee_user_links') IS NOT NULL THEN
    DELETE FROM public.employee_user_links
    WHERE org_id = p_org_id
      AND employee_id = ANY (v_ids);
  END IF;

  IF to_regclass('public.organization_member_regions') IS NOT NULL THEN
    DELETE FROM public.organization_member_regions
    WHERE org_id = p_org_id
      AND user_id IN (
        SELECT DISTINCT (row_item->>'linkedUserId')::uuid
        FROM jsonb_array_elements(v_deleted) AS row_item
        WHERE row_item->>'linkedUserId' IS NOT NULL
      );
  END IF;

  IF to_regclass('public.organization_members') IS NOT NULL THEN
    UPDATE public.organization_members
    SET status = 'inactive'
    WHERE org_id = p_org_id
      AND user_id IN (
        SELECT DISTINCT (row_item->>'linkedUserId')::uuid
        FROM jsonb_array_elements(v_deleted) AS row_item
        WHERE row_item->>'linkedUserId' IS NOT NULL
      );
  END IF;

  DELETE FROM public.employees
  WHERE org_id = p_org_id
    AND id = ANY (v_ids);

  RETURN jsonb_build_object(
    'deleted', v_deleted,
    'deletedCount', jsonb_array_length(v_deleted),
    'deletedBy', p_deleted_by
  );
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
  v_result jsonb;
BEGIN
  v_result := public.hard_delete_employees(p_org_id, ARRAY[p_employee_id], p_deleted_by);
  IF COALESCE((v_result->>'deletedCount')::int, 0) = 0 THEN
    RAISE EXCEPTION 'Employee not found (org_id %, employee_id %)', p_org_id, p_employee_id
      USING ERRCODE = 'P0002';
  END IF;
  RETURN COALESCE(v_result->'deleted'->0, '{}'::jsonb) || jsonb_build_object('deletedBy', p_deleted_by);
END
$function$;

REVOKE ALL ON FUNCTION public.hard_delete_employees(uuid, uuid[], uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.hard_delete_employees(uuid, uuid[], uuid) TO service_role;
REVOKE ALL ON FUNCTION public.hard_delete_employee(uuid, uuid, uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.hard_delete_employee(uuid, uuid, uuid) TO service_role;
