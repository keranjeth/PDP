-- 1) Budget codes must never collide with existing rows (resync counters).
-- 2) Import skips exact duplicates (Employee ID + course + start date).
--    Different courses for the same person are always allowed.

CREATE OR REPLACE FUNCTION public.next_org_document_code(
  p_org_id uuid,
  p_doc_kind text,
  p_prefix text
)
RETURNS text
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_year integer := EXTRACT(YEAR FROM (timezone('utc', now())))::integer;
  v_next integer;
  v_max_existing integer := 0;
  v_pattern text;
BEGIN
  IF p_org_id IS NULL OR p_doc_kind IS NULL OR NULLIF(btrim(p_prefix), '') IS NULL THEN
    RAISE EXCEPTION 'invalid document code arguments';
  END IF;

  IF p_doc_kind NOT IN ('budget', 'adjustment', 'reallocation') THEN
    RAISE EXCEPTION 'unsupported document kind %', p_doc_kind;
  END IF;

  -- Seed from the highest existing code for this org/kind/year so a missing or
  -- rolled-back counter cannot reissue BGT-YYYY-001 after data already exists.
  IF p_doc_kind = 'budget' THEN
    v_pattern := '^' || upper(btrim(p_prefix)) || '-' || v_year::text || '-([0-9]+)$';
    SELECT COALESCE(
      MAX((regexp_match(b.budget_code, v_pattern))[1]::integer),
      0
    )
    INTO v_max_existing
    FROM public.employee_budgets b
    WHERE b.org_id = p_org_id
      AND b.budget_code ~ v_pattern;
  ELSIF p_doc_kind = 'adjustment' THEN
    v_pattern := '^' || upper(btrim(p_prefix)) || '-' || v_year::text || '-([0-9]+)$';
    SELECT COALESCE(
      MAX((regexp_match(t.adjustment_code, v_pattern))[1]::integer),
      0
    )
    INTO v_max_existing
    FROM public.budget_adjustments t
    WHERE t.org_id = p_org_id
      AND t.adjustment_code ~ v_pattern;
  ELSIF p_doc_kind = 'reallocation' THEN
    v_pattern := '^' || upper(btrim(p_prefix)) || '-' || v_year::text || '-([0-9]+)$';
    SELECT COALESCE(
      MAX((regexp_match(t.reallocation_code, v_pattern))[1]::integer),
      0
    )
    INTO v_max_existing
    FROM public.budget_reallocations t
    WHERE t.org_id = p_org_id
      AND t.reallocation_code ~ v_pattern;
  END IF;

  INSERT INTO public.org_document_counters (org_id, doc_kind, year, last_value)
  VALUES (p_org_id, p_doc_kind, v_year, GREATEST(1, v_max_existing + 1))
  ON CONFLICT (org_id, doc_kind, year)
  DO UPDATE SET last_value = GREATEST(
    public.org_document_counters.last_value + 1,
    EXCLUDED.last_value
  )
  RETURNING last_value INTO v_next;

  RETURN upper(btrim(p_prefix)) || '-' || v_year::text || '-' || lpad(v_next::text, 3, '0');
END;
$$;

REVOKE ALL ON FUNCTION public.next_org_document_code(uuid, text, text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.next_org_document_code(uuid, text, text) TO service_role;

-- Heal counters from existing budget codes (all orgs / years present in data).
INSERT INTO public.org_document_counters (org_id, doc_kind, year, last_value)
SELECT
  b.org_id,
  'budget',
  (regexp_match(b.budget_code, '^BGT-([0-9]{4})-([0-9]+)$'))[1]::integer AS year,
  MAX((regexp_match(b.budget_code, '^BGT-([0-9]{4})-([0-9]+)$'))[2]::integer) AS last_value
FROM public.employee_budgets b
WHERE b.budget_code ~ '^BGT-[0-9]{4}-[0-9]+$'
GROUP BY b.org_id, (regexp_match(b.budget_code, '^BGT-([0-9]{4})-([0-9]+)$'))[1]::integer
ON CONFLICT (org_id, doc_kind, year)
DO UPDATE SET last_value = GREATEST(
  public.org_document_counters.last_value,
  EXCLUDED.last_value
);

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
  v_budget_id uuid;
  v_budget_code text;
  v_created jsonb := '[]'::jsonb;
  v_preview jsonb := '[]'::jsonb;
  v_skipped jsonb := '[]'::jsonb;
  v_seen_keys text[] := ARRAY[]::text[];
  v_totals jsonb := '{"AFN":0,"USD":0,"EUR":0}'::jsonb;
  v_skipped_existing integer := 0;
  v_skipped_workbook integer := 0;
  v_result jsonb;
  v_is_existing boolean;
BEGIN
  -- p_allow_duplicates kept for API compatibility; exact duplicates are skipped.
  PERFORM COALESCE(p_allow_duplicates, false);

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

    -- Exact duplicate key: Employee ID + course + start date (null-safe).
    -- Same person with a different course or date is NOT a duplicate.
    v_key := v_id_number || '|' || lower(regexp_replace(v_planned_course, '\s+', ' ', 'g')) || '|' || COALESCE(v_start::text, '');

    IF v_key = ANY (v_seen_keys) THEN
      v_skipped_workbook := v_skipped_workbook + 1;
      v_skipped := v_skipped || jsonb_build_array(
        jsonb_build_object(
          'rowNumber', v_row_number,
          'employeeIdNumber', v_employee.id_number,
          'fullName', v_employee.full_name,
          'plannedCourse', v_planned_course,
          'amount', v_amount,
          'currency', v_currency,
          'plannedCourseStartDate', CASE WHEN v_start IS NULL THEN '' ELSE v_start::text END,
          'reason', 'Duplicate of another row in this workbook (same Employee ID, course, and start date).'
        )
      );
      CONTINUE;
    END IF;

    SELECT EXISTS (
      SELECT 1
      FROM public.employee_budgets b
      WHERE b.org_id = p_org_id
        AND b.employee_id = v_employee.id
        AND b.deleted_at IS NULL
        AND lower(regexp_replace(btrim(b.planned_course), '\s+', ' ', 'g'))
            = lower(regexp_replace(v_planned_course, '\s+', ' ', 'g'))
        AND b.planned_course_start_date IS NOT DISTINCT FROM v_start
    ) INTO v_is_existing;

    IF v_is_existing THEN
      v_skipped_existing := v_skipped_existing + 1;
      v_skipped := v_skipped || jsonb_build_array(
        jsonb_build_object(
          'rowNumber', v_row_number,
          'employeeIdNumber', v_employee.id_number,
          'fullName', v_employee.full_name,
          'plannedCourse', v_planned_course,
          'amount', v_amount,
          'currency', v_currency,
          'plannedCourseStartDate', CASE WHEN v_start IS NULL THEN '' ELSE v_start::text END,
          'reason', 'Already exists (same Employee ID, course, and start date).'
        )
      );
      CONTINUE;
    END IF;

    v_seen_keys := array_append(v_seen_keys, v_key);

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
        'isPotentialDuplicate', false,
        'duplicateReasons', '[]'::jsonb
      )
    );

    v_totals := jsonb_set(
      v_totals,
      ARRAY[v_currency],
      to_jsonb(COALESCE((v_totals->>v_currency)::numeric, 0) + v_amount),
      true
    );
  END LOOP;

  IF jsonb_array_length(v_preview) = 0 THEN
    v_result := jsonb_build_object(
      'ok', true,
      'imported', 0,
      'total', jsonb_array_length(p_rows),
      'skippedExisting', v_skipped_existing,
      'skippedWorkbookDuplicates', v_skipped_workbook,
      'potentialDuplicates', 0,
      'totalsByCurrency', v_totals,
      'created', '[]'::jsonb,
      'previewRows', '[]'::jsonb,
      'skippedRows', v_skipped,
      'message', 'All rows already exist or are workbook duplicates. Nothing new to import.'
    );

    INSERT INTO public.budget_import_attempts (
      org_id, import_id, user_id, fingerprint, allow_duplicates, status, result, error_message
    ) VALUES (
      p_org_id, p_import_id, v_uid, p_fingerprint, COALESCE(p_allow_duplicates, false),
      'completed', v_result, NULL
    );

    RETURN v_result;
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
    'skippedExisting', v_skipped_existing,
    'skippedWorkbookDuplicates', v_skipped_workbook,
    'potentialDuplicates', 0,
    'totalsByCurrency', v_totals,
    'created', v_created,
    'previewRows', v_preview,
    'skippedRows', v_skipped
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
