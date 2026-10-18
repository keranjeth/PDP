-- Budget import: match employees by Employee ID only.
-- Full Name in the workbook is optional reference text and is never compared or written back.

CREATE OR REPLACE FUNCTION public.import_employee_budgets(
  p_org_id uuid,
  p_import_id uuid,
  p_fingerprint text,
  p_allow_duplicates boolean,
  p_rows jsonb
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_uid uuid := auth.uid();
  v_existing public.budget_import_attempts%ROWTYPE;
  v_row jsonb;
  v_row_number integer;
  v_id_number text;
  v_planned_course text;
  v_amount numeric;
  v_currency text;
  v_start date;
  v_start_text text;
  v_employee public.employees%ROWTYPE;
  v_key text;
  v_workbook_counts jsonb := '{}'::jsonb;
  v_dup_reasons text[];
  v_budget_id uuid;
  v_budget_code text;
  v_created jsonb := '[]'::jsonb;
  v_preview jsonb := '[]'::jsonb;
  v_totals jsonb := '{"AFN":0,"USD":0,"EUR":0}'::jsonb;
  v_potential_duplicates integer := 0;
  v_result jsonb;
BEGIN
  IF v_uid IS NULL THEN
    RAISE EXCEPTION 'not authenticated' USING ERRCODE = '28000';
  END IF;

  IF p_import_id IS NULL OR NULLIF(btrim(COALESCE(p_fingerprint, '')), '') IS NULL THEN
    RAISE EXCEPTION 'importId and fingerprint are required';
  END IF;

  IF p_rows IS NULL OR jsonb_typeof(p_rows) <> 'array' OR jsonb_array_length(p_rows) = 0 THEN
    RAISE EXCEPTION 'rows must be a non-empty array';
  END IF;

  IF NOT public.can_manage_budgets(p_org_id) THEN
    RAISE EXCEPTION 'forbidden' USING ERRCODE = '42501';
  END IF;

  PERFORM pg_advisory_xact_lock(
    hashtext(p_org_id::text),
    hashtext(p_import_id::text)
  );

  SELECT * INTO v_existing
  FROM public.budget_import_attempts a
  WHERE a.org_id = p_org_id
    AND a.import_id = p_import_id
  FOR UPDATE;

  IF FOUND THEN
    IF v_existing.user_id <> v_uid THEN
      RAISE EXCEPTION 'Import ID belongs to another user' USING ERRCODE = '42501';
    END IF;
    IF v_existing.fingerprint <> p_fingerprint THEN
      RAISE EXCEPTION 'Import ID already used with different allocation data';
    END IF;
    IF v_existing.status = 'completed' AND v_existing.result IS NOT NULL THEN
      RETURN v_existing.result;
    END IF;
    DELETE FROM public.budget_import_attempts
    WHERE org_id = p_org_id
      AND import_id = p_import_id;
  END IF;

  FOR v_row IN SELECT value FROM jsonb_array_elements(p_rows)
  LOOP
    -- Exact trimmed Employee ID (text). No numeric coercion.
    v_id_number := btrim(COALESCE(v_row->>'employeeIdNumber', ''));
    v_planned_course := lower(regexp_replace(btrim(COALESCE(v_row->>'plannedCourse', '')), '\s+', ' ', 'g'));
    v_start_text := btrim(COALESCE(v_row->>'plannedCourseStartDate', ''));
    BEGIN
      v_start := NULLIF(v_start_text, '')::date;
    EXCEPTION WHEN others THEN
      v_start := NULL;
      v_start_text := '';
    END;
    v_key := v_id_number || '|' || v_planned_course || '|' || COALESCE(v_start::text, '');
    v_workbook_counts := jsonb_set(
      v_workbook_counts,
      ARRAY[v_key],
      to_jsonb(COALESCE((v_workbook_counts->>v_key)::integer, 0) + 1),
      true
    );
  END LOOP;

  FOR v_row IN SELECT value FROM jsonb_array_elements(p_rows)
  LOOP
    v_row_number := COALESCE(NULLIF(v_row->>'rowNumber', '')::integer, 0);
    v_id_number := btrim(COALESCE(v_row->>'employeeIdNumber', ''));
    v_planned_course := btrim(COALESCE(v_row->>'plannedCourse', ''));
    v_currency := upper(btrim(COALESCE(v_row->>'currency', '')));
    v_start_text := btrim(COALESCE(v_row->>'plannedCourseStartDate', ''));
    BEGIN
      v_amount := (v_row->'amount')::text::numeric;
    EXCEPTION WHEN others THEN
      RAISE EXCEPTION 'Row %: Budget must be a valid non-negative amount.', v_row_number;
    END;
    BEGIN
      v_start := NULLIF(v_start_text, '')::date;
    EXCEPTION WHEN others THEN
      RAISE EXCEPTION 'Row %: Invalid Planned Course Start Date. Use YYYY-MM-DD.', v_row_number;
    END;

    IF lower(v_id_number) = '__pdp_sample__' THEN
      RAISE EXCEPTION 'Row %: Sample template row cannot be imported.', v_row_number;
    END IF;
    IF v_id_number = '' THEN
      RAISE EXCEPTION 'Row %: Employee ID is required.', v_row_number;
    END IF;
    IF v_planned_course = '' THEN
      RAISE EXCEPTION 'Row %: Planned Course is required.', v_row_number;
    END IF;
    IF v_amount IS NULL OR v_amount < 0 THEN
      RAISE EXCEPTION 'Row %: Budget must be a valid non-negative amount.', v_row_number;
    END IF;
    IF v_currency NOT IN ('AFN', 'USD', 'EUR') THEN
      RAISE EXCEPTION 'Row %: Currency must be AFN, USD, or EUR.', v_row_number;
    END IF;
    IF v_start_text <> '' AND v_start_text !~ '^\d{4}-\d{2}-\d{2}$' THEN
      RAISE EXCEPTION 'Row %: Invalid Planned Course Start Date. Use YYYY-MM-DD.', v_row_number;
    END IF;

    -- Match by exact Employee ID text within the organization (preserves leading zeros).
    SELECT * INTO v_employee
    FROM public.employees e
    WHERE e.org_id = p_org_id
      AND e.id_number = v_id_number
      AND e.deleted_at IS NULL
    LIMIT 1;

    IF NOT FOUND THEN
      RAISE EXCEPTION 'Row %: Employee ID was not found.', v_row_number;
    END IF;

    IF v_employee.employment_status NOT IN (
      'active'::public.employment_status,
      'inactive'::public.employment_status
    ) THEN
      RAISE EXCEPTION 'Row %: Employee status must be Active or Inactive.', v_row_number;
    END IF;

    IF NOT public.can_access_employee(p_org_id, v_employee.id) THEN
      RAISE EXCEPTION 'Row %: You do not have access to this employee.', v_row_number;
    END IF;

    v_key := v_id_number || '|' || lower(regexp_replace(v_planned_course, '\s+', ' ', 'g')) || '|' || COALESCE(v_start::text, '');
    v_dup_reasons := ARRAY[]::text[];

    IF COALESCE((v_workbook_counts->>v_key)::integer, 0) > 1 THEN
      v_dup_reasons := array_append(v_dup_reasons, 'Also appears elsewhere in this workbook');
    END IF;

    IF EXISTS (
      SELECT 1
      FROM public.employee_budgets b
      WHERE b.org_id = p_org_id
        AND b.employee_id = v_employee.id
        AND b.deleted_at IS NULL
        AND lower(regexp_replace(btrim(b.planned_course), '\s+', ' ', 'g'))
            = lower(regexp_replace(v_planned_course, '\s+', ' ', 'g'))
        AND b.planned_course_start_date IS NOT DISTINCT FROM v_start
    ) THEN
      v_dup_reasons := array_append(v_dup_reasons, 'Matches an existing budget allocation');
    END IF;

    IF coalesce(array_length(v_dup_reasons, 1), 0) > 0 THEN
      v_potential_duplicates := v_potential_duplicates + 1;
    END IF;

    v_preview := v_preview || jsonb_build_array(
      jsonb_build_object(
        'rowNumber', v_row_number,
        'employeeIdNumber', v_employee.id_number,
        'fullName', v_employee.full_name,
        'employmentStatus', CASE
          WHEN v_employee.employment_status = 'active'::public.employment_status THEN 'Active'
          ELSE 'Inactive'
        END,
        'employeeUuid', v_employee.id,
        'plannedCourse', v_planned_course,
        'amount', v_amount,
        'currency', v_currency,
        'plannedCourseStartDate', CASE WHEN v_start IS NULL THEN '' ELSE v_start::text END,
        'isPotentialDuplicate', coalesce(array_length(v_dup_reasons, 1), 0) > 0,
        'duplicateReasons', to_jsonb(v_dup_reasons)
      )
    );

    v_totals := jsonb_set(
      v_totals,
      ARRAY[v_currency],
      to_jsonb(COALESCE((v_totals->>v_currency)::numeric, 0) + v_amount),
      true
    );
  END LOOP;

  IF v_potential_duplicates > 0 AND NOT COALESCE(p_allow_duplicates, false) THEN
    RETURN jsonb_build_object(
      'ok', false,
      'needsDuplicateConfirmation', true,
      'imported', 0,
      'total', jsonb_array_length(p_rows),
      'valid', jsonb_array_length(v_preview),
      'invalid', 0,
      'potentialDuplicates', v_potential_duplicates,
      'totalsByCurrency', v_totals,
      'previewRows', v_preview,
      'errors', (
        SELECT COALESCE(jsonb_agg(
          'Row ' || (r->>'rowNumber') || ': Potential duplicate allocation (' ||
          array_to_string(
            ARRAY(SELECT jsonb_array_elements_text(r->'duplicateReasons')),
            '; '
          ) || ').'
        ), '[]'::jsonb)
        FROM jsonb_array_elements(v_preview) r
        WHERE (r->>'isPotentialDuplicate')::boolean
      )
    );
  END IF;

  FOR v_row IN SELECT value FROM jsonb_array_elements(v_preview)
  LOOP
    v_row_number := (v_row->>'rowNumber')::integer;
    BEGIN
      v_budget_id := public.create_employee_budget(
        p_org_id,
        (v_row->>'employeeUuid')::uuid,
        v_row->>'plannedCourse',
        (v_row->>'amount')::numeric,
        v_row->>'currency',
        NULLIF(btrim(COALESCE(v_row->>'plannedCourseStartDate', '')), '')::date
      );
    EXCEPTION WHEN OTHERS THEN
      RAISE EXCEPTION 'Row %: %', v_row_number, SQLERRM;
    END;

    SELECT b.budget_code INTO v_budget_code
    FROM public.employee_budgets b
    WHERE b.id = v_budget_id;

    v_created := v_created || jsonb_build_array(
      jsonb_build_object(
        'rowNumber', v_row_number,
        'budgetId', v_budget_id,
        'budgetCode', v_budget_code,
        'employeeIdNumber', v_row->>'employeeIdNumber'
      )
    );
  END LOOP;

  v_result := jsonb_build_object(
    'ok', true,
    'imported', jsonb_array_length(v_created),
    'total', jsonb_array_length(p_rows),
    'potentialDuplicates', v_potential_duplicates,
    'totalsByCurrency', v_totals,
    'created', v_created,
    'previewRows', v_preview
  );

  INSERT INTO public.budget_import_attempts (
    org_id,
    import_id,
    user_id,
    fingerprint,
    allow_duplicates,
    status,
    result,
    error_message
  ) VALUES (
    p_org_id,
    p_import_id,
    v_uid,
    p_fingerprint,
    COALESCE(p_allow_duplicates, false),
    'completed',
    v_result,
    NULL
  );

  RETURN v_result;
END;
$$;
