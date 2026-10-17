-- PD Plan: employee training budget allocations and transactions
-- Depends on: 20261017120000_pd_plan_baseline.sql
-- Local preparation only — do not apply until explicitly approved.

-- ---------------------------------------------------------------------------
-- Document counters (BGT-/ADJ-/TRF-YYYY-NNN)
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.org_document_counters (
  org_id uuid NOT NULL REFERENCES public.organizations (id) ON DELETE CASCADE,
  doc_kind text NOT NULL,
  year integer NOT NULL,
  last_value integer NOT NULL DEFAULT 0,
  PRIMARY KEY (org_id, doc_kind, year),
  CONSTRAINT org_document_counters_kind_chk
    CHECK (doc_kind IN ('budget', 'adjustment', 'reallocation')),
  CONSTRAINT org_document_counters_year_chk CHECK (year >= 2000 AND year <= 2100),
  CONSTRAINT org_document_counters_last_value_chk CHECK (last_value >= 0)
);

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
BEGIN
  IF p_org_id IS NULL OR p_doc_kind IS NULL OR NULLIF(btrim(p_prefix), '') IS NULL THEN
    RAISE EXCEPTION 'invalid document code arguments';
  END IF;

  IF p_doc_kind NOT IN ('budget', 'adjustment', 'reallocation') THEN
    RAISE EXCEPTION 'unsupported document kind %', p_doc_kind;
  END IF;

  INSERT INTO public.org_document_counters (org_id, doc_kind, year, last_value)
  VALUES (p_org_id, p_doc_kind, v_year, 1)
  ON CONFLICT (org_id, doc_kind, year)
  DO UPDATE SET last_value = public.org_document_counters.last_value + 1
  RETURNING last_value INTO v_next;

  RETURN p_prefix || '-' || v_year::text || '-' || lpad(v_next::text, 3, '0');
END;
$$;

REVOKE ALL ON FUNCTION public.next_org_document_code(uuid, text, text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.next_org_document_code(uuid, text, text) TO service_role;

-- ---------------------------------------------------------------------------
-- Budget allocations (employee-centered; no duplicated employee attributes)
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.employee_budgets (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id uuid NOT NULL REFERENCES public.organizations (id) ON DELETE CASCADE,
  budget_code text NOT NULL,
  employee_id uuid NOT NULL,
  planned_course text NOT NULL,
  initial_amount numeric(14, 2) NOT NULL DEFAULT 0,
  currency text NOT NULL,
  planned_course_start_date date NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  created_by uuid REFERENCES auth.users (id) ON DELETE SET NULL,
  updated_by uuid REFERENCES auth.users (id) ON DELETE SET NULL,
  deleted_at timestamptz,
  CONSTRAINT employee_budgets_org_id_id_key UNIQUE (org_id, id),
  CONSTRAINT employee_budgets_org_code_key UNIQUE (org_id, budget_code),
  CONSTRAINT employee_budgets_org_employee_fk
    FOREIGN KEY (org_id, employee_id)
    REFERENCES public.employees (org_id, id)
    ON DELETE RESTRICT,
  CONSTRAINT employee_budgets_course_chk CHECK (btrim(planned_course) <> ''),
  CONSTRAINT employee_budgets_currency_chk CHECK (btrim(currency) <> ''),
  CONSTRAINT employee_budgets_initial_amount_chk CHECK (initial_amount >= 0),
  CONSTRAINT employee_budgets_code_format_chk
    CHECK (budget_code ~ '^BGT-[0-9]{4}-[0-9]{3,}$')
);

CREATE INDEX IF NOT EXISTS employee_budgets_org_employee_idx
  ON public.employee_budgets (org_id, employee_id)
  WHERE deleted_at IS NULL;

CREATE INDEX IF NOT EXISTS employee_budgets_org_course_date_idx
  ON public.employee_budgets (org_id, planned_course_start_date)
  WHERE deleted_at IS NULL;

DROP TRIGGER IF EXISTS employee_budgets_set_updated_at ON public.employee_budgets;
CREATE TRIGGER employee_budgets_set_updated_at
  BEFORE UPDATE ON public.employee_budgets
  FOR EACH ROW EXECUTE PROCEDURE public.set_updated_at();

-- ---------------------------------------------------------------------------
-- Adjustments (transaction history; never overwrite initial_amount)
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.budget_adjustments (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id uuid NOT NULL REFERENCES public.organizations (id) ON DELETE CASCADE,
  budget_id uuid NOT NULL,
  adjustment_code text NOT NULL,
  direction text NOT NULL,
  amount numeric(14, 2) NOT NULL,
  adjustment_date date NOT NULL DEFAULT (CURRENT_DATE),
  reason text,
  created_at timestamptz NOT NULL DEFAULT now(),
  created_by uuid REFERENCES auth.users (id) ON DELETE SET NULL,
  CONSTRAINT budget_adjustments_org_budget_fk
    FOREIGN KEY (org_id, budget_id)
    REFERENCES public.employee_budgets (org_id, id)
    ON DELETE RESTRICT,
  CONSTRAINT budget_adjustments_org_code_key UNIQUE (org_id, adjustment_code),
  CONSTRAINT budget_adjustments_direction_chk
    CHECK (direction IN ('increase', 'decrease')),
  CONSTRAINT budget_adjustments_amount_chk CHECK (amount > 0),
  CONSTRAINT budget_adjustments_code_format_chk
    CHECK (adjustment_code ~ '^ADJ-[0-9]{4}-[0-9]{3,}$')
);

CREATE INDEX IF NOT EXISTS budget_adjustments_budget_idx
  ON public.budget_adjustments (org_id, budget_id, created_at DESC);

-- ---------------------------------------------------------------------------
-- Reallocations (atomic transfer history between two employee budgets)
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.budget_reallocations (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id uuid NOT NULL REFERENCES public.organizations (id) ON DELETE CASCADE,
  reallocation_code text NOT NULL,
  source_budget_id uuid NOT NULL,
  destination_budget_id uuid NOT NULL,
  amount numeric(14, 2) NOT NULL,
  currency text NOT NULL,
  reallocation_date date NOT NULL DEFAULT (CURRENT_DATE),
  reason text,
  created_at timestamptz NOT NULL DEFAULT now(),
  created_by uuid REFERENCES auth.users (id) ON DELETE SET NULL,
  CONSTRAINT budget_reallocations_org_code_key UNIQUE (org_id, reallocation_code),
  CONSTRAINT budget_reallocations_source_fk
    FOREIGN KEY (org_id, source_budget_id)
    REFERENCES public.employee_budgets (org_id, id)
    ON DELETE RESTRICT,
  CONSTRAINT budget_reallocations_destination_fk
    FOREIGN KEY (org_id, destination_budget_id)
    REFERENCES public.employee_budgets (org_id, id)
    ON DELETE RESTRICT,
  CONSTRAINT budget_reallocations_distinct_chk
    CHECK (source_budget_id <> destination_budget_id),
  CONSTRAINT budget_reallocations_amount_chk CHECK (amount > 0),
  CONSTRAINT budget_reallocations_currency_chk CHECK (btrim(currency) <> ''),
  CONSTRAINT budget_reallocations_code_format_chk
    CHECK (reallocation_code ~ '^TRF-[0-9]{4}-[0-9]{3,}$')
);

CREATE INDEX IF NOT EXISTS budget_reallocations_source_idx
  ON public.budget_reallocations (org_id, source_budget_id, created_at DESC);

CREATE INDEX IF NOT EXISTS budget_reallocations_destination_idx
  ON public.budget_reallocations (org_id, destination_budget_id, created_at DESC);

-- ---------------------------------------------------------------------------
-- Calculation helpers
-- Actual training cost is 0 until Training Records exist.
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.employee_budget_current_amount(p_budget_id uuid)
RETURNS numeric
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT COALESCE(
    (
      SELECT b.initial_amount
        + COALESCE((
            SELECT SUM(
              CASE
                WHEN a.direction = 'increase' THEN a.amount
                ELSE -a.amount
              END
            )
            FROM public.budget_adjustments a
            WHERE a.budget_id = b.id
          ), 0)
        + COALESCE((
            SELECT SUM(r.amount)
            FROM public.budget_reallocations r
            WHERE r.destination_budget_id = b.id
          ), 0)
        - COALESCE((
            SELECT SUM(r.amount)
            FROM public.budget_reallocations r
            WHERE r.source_budget_id = b.id
          ), 0)
      FROM public.employee_budgets b
      WHERE b.id = p_budget_id
        AND b.deleted_at IS NULL
    ),
    0
  );
$$;

CREATE OR REPLACE FUNCTION public.employee_budget_actual_training_cost(p_budget_id uuid)
RETURNS numeric
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  -- Placeholder until Training Records link costs to budgets.
  SELECT 0::numeric;
$$;

CREATE OR REPLACE FUNCTION public.employee_budget_remaining_amount(p_budget_id uuid)
RETURNS numeric
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT public.employee_budget_current_amount(p_budget_id)
       - public.employee_budget_actual_training_cost(p_budget_id);
$$;

CREATE OR REPLACE FUNCTION public.employee_budget_has_transactions(p_budget_id uuid)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT EXISTS (
    SELECT 1 FROM public.budget_adjustments a WHERE a.budget_id = p_budget_id
  )
  OR EXISTS (
    SELECT 1 FROM public.budget_reallocations r
    WHERE r.source_budget_id = p_budget_id
       OR r.destination_budget_id = p_budget_id
  );
$$;

CREATE OR REPLACE FUNCTION public.can_manage_budgets(p_org_id uuid)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT public.org_role(p_org_id) = ANY (
    ARRAY[
      'super_admin'::public.org_role,
      'head_of_hr'::public.org_role,
      'hr_national'::public.org_role,
      'regional_hr'::public.org_role
    ]
  );
$$;

-- ---------------------------------------------------------------------------
-- RPCs
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.create_employee_budget(
  p_org_id uuid,
  p_employee_id uuid,
  p_planned_course text,
  p_initial_amount numeric,
  p_currency text,
  p_planned_course_start_date date
)
RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_uid uuid := auth.uid();
  v_code text;
  v_id uuid;
  v_amount numeric := COALESCE(p_initial_amount, 0);
BEGIN
  IF v_uid IS NULL THEN
    RAISE EXCEPTION 'not authenticated' USING ERRCODE = '28000';
  END IF;

  IF NOT public.can_manage_budgets(p_org_id) THEN
    RAISE EXCEPTION 'forbidden' USING ERRCODE = '42501';
  END IF;

  IF NOT public.can_access_employee(p_org_id, p_employee_id) THEN
    RAISE EXCEPTION 'forbidden' USING ERRCODE = '42501';
  END IF;

  IF NOT EXISTS (
    SELECT 1
    FROM public.employees e
    WHERE e.org_id = p_org_id
      AND e.id = p_employee_id
      AND e.deleted_at IS NULL
      AND e.employment_status = 'active'::public.employment_status
  ) THEN
    RAISE EXCEPTION 'Employee must be an active employee record';
  END IF;

  IF NULLIF(btrim(p_planned_course), '') IS NULL THEN
    RAISE EXCEPTION 'Planned course is required';
  END IF;

  IF p_planned_course_start_date IS NULL THEN
    RAISE EXCEPTION 'Planned course start date is required';
  END IF;

  IF v_amount < 0 THEN
    RAISE EXCEPTION 'Initial budget cannot be negative';
  END IF;

  IF NULLIF(btrim(p_currency), '') IS NULL THEN
    RAISE EXCEPTION 'Currency is required';
  END IF;

  v_code := public.next_org_document_code(p_org_id, 'budget', 'BGT');

  INSERT INTO public.employee_budgets (
    org_id,
    budget_code,
    employee_id,
    planned_course,
    initial_amount,
    currency,
    planned_course_start_date,
    created_by,
    updated_by
  ) VALUES (
    p_org_id,
    v_code,
    p_employee_id,
    btrim(p_planned_course),
    v_amount,
    upper(btrim(p_currency)),
    p_planned_course_start_date,
    v_uid,
    v_uid
  )
  RETURNING id INTO v_id;

  RETURN v_id;
END;
$$;

CREATE OR REPLACE FUNCTION public.update_employee_budget_details(
  p_org_id uuid,
  p_budget_id uuid,
  p_planned_course text DEFAULT NULL,
  p_planned_course_start_date date DEFAULT NULL,
  p_initial_amount numeric DEFAULT NULL,
  p_currency text DEFAULT NULL
)
RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_uid uuid := auth.uid();
  b public.employee_budgets%ROWTYPE;
  v_has_tx boolean;
BEGIN
  IF v_uid IS NULL THEN
    RAISE EXCEPTION 'not authenticated' USING ERRCODE = '28000';
  END IF;

  IF NOT public.can_manage_budgets(p_org_id) THEN
    RAISE EXCEPTION 'forbidden' USING ERRCODE = '42501';
  END IF;

  SELECT * INTO b
  FROM public.employee_budgets
  WHERE org_id = p_org_id
    AND id = p_budget_id
    AND deleted_at IS NULL
  FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Budget not found' USING ERRCODE = 'P0002';
  END IF;

  IF NOT public.can_access_employee(p_org_id, b.employee_id) THEN
    RAISE EXCEPTION 'forbidden' USING ERRCODE = '42501';
  END IF;

  v_has_tx := public.employee_budget_has_transactions(p_budget_id);

  IF p_initial_amount IS NOT NULL OR p_currency IS NOT NULL THEN
    IF v_has_tx THEN
      RAISE EXCEPTION 'Initial amount and currency can only change before financial transactions exist';
    END IF;
  END IF;

  IF p_initial_amount IS NOT NULL AND p_initial_amount < 0 THEN
    RAISE EXCEPTION 'Initial budget cannot be negative';
  END IF;

  UPDATE public.employee_budgets
  SET
    planned_course = COALESCE(NULLIF(btrim(p_planned_course), ''), planned_course),
    planned_course_start_date = COALESCE(p_planned_course_start_date, planned_course_start_date),
    initial_amount = COALESCE(p_initial_amount, initial_amount),
    currency = COALESCE(NULLIF(upper(btrim(p_currency)), ''), currency),
    updated_by = v_uid
  WHERE org_id = p_org_id
    AND id = p_budget_id;

  RETURN p_budget_id;
END;
$$;

CREATE OR REPLACE FUNCTION public.adjust_employee_budget(
  p_org_id uuid,
  p_budget_id uuid,
  p_direction text,
  p_amount numeric,
  p_reason text DEFAULT NULL,
  p_adjustment_date date DEFAULT NULL
)
RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_uid uuid := auth.uid();
  b public.employee_budgets%ROWTYPE;
  v_code text;
  v_id uuid;
  v_current numeric;
  v_dir text := lower(btrim(COALESCE(p_direction, '')));
BEGIN
  IF v_uid IS NULL THEN
    RAISE EXCEPTION 'not authenticated' USING ERRCODE = '28000';
  END IF;

  IF NOT public.can_manage_budgets(p_org_id) THEN
    RAISE EXCEPTION 'forbidden' USING ERRCODE = '42501';
  END IF;

  IF v_dir NOT IN ('increase', 'decrease') THEN
    RAISE EXCEPTION 'Direction must be increase or decrease';
  END IF;

  IF p_amount IS NULL OR p_amount <= 0 THEN
    RAISE EXCEPTION 'Adjustment amount must be greater than zero';
  END IF;

  SELECT * INTO b
  FROM public.employee_budgets
  WHERE org_id = p_org_id
    AND id = p_budget_id
    AND deleted_at IS NULL
  FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Budget not found' USING ERRCODE = 'P0002';
  END IF;

  IF NOT public.can_access_employee(p_org_id, b.employee_id) THEN
    RAISE EXCEPTION 'forbidden' USING ERRCODE = '42501';
  END IF;

  v_current := public.employee_budget_current_amount(p_budget_id);

  IF v_dir = 'decrease' AND p_amount > v_current THEN
    RAISE EXCEPTION 'Decrease would make available budget negative';
  END IF;

  v_code := public.next_org_document_code(p_org_id, 'adjustment', 'ADJ');

  INSERT INTO public.budget_adjustments (
    org_id,
    budget_id,
    adjustment_code,
    direction,
    amount,
    adjustment_date,
    reason,
    created_by
  ) VALUES (
    p_org_id,
    p_budget_id,
    v_code,
    v_dir,
    p_amount,
    COALESCE(p_adjustment_date, CURRENT_DATE),
    NULLIF(btrim(COALESCE(p_reason, '')), ''),
    v_uid
  )
  RETURNING id INTO v_id;

  UPDATE public.employee_budgets
  SET updated_by = v_uid
  WHERE id = p_budget_id;

  RETURN v_id;
END;
$$;

CREATE OR REPLACE FUNCTION public.reallocate_employee_budget(
  p_org_id uuid,
  p_source_budget_id uuid,
  p_destination_budget_id uuid,
  p_amount numeric,
  p_reason text DEFAULT NULL,
  p_reallocation_date date DEFAULT NULL
)
RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_uid uuid := auth.uid();
  src public.employee_budgets%ROWTYPE;
  dst public.employee_budgets%ROWTYPE;
  v_code text;
  v_id uuid;
  v_available numeric;
BEGIN
  IF v_uid IS NULL THEN
    RAISE EXCEPTION 'not authenticated' USING ERRCODE = '28000';
  END IF;

  IF NOT public.can_manage_budgets(p_org_id) THEN
    RAISE EXCEPTION 'forbidden' USING ERRCODE = '42501';
  END IF;

  IF p_source_budget_id IS NULL OR p_destination_budget_id IS NULL THEN
    RAISE EXCEPTION 'Source and destination budgets are required';
  END IF;

  IF p_source_budget_id = p_destination_budget_id THEN
    RAISE EXCEPTION 'Cannot reallocate a budget to itself';
  END IF;

  IF p_amount IS NULL OR p_amount <= 0 THEN
    RAISE EXCEPTION 'Reallocation amount must be greater than zero';
  END IF;

  SELECT * INTO src
  FROM public.employee_budgets
  WHERE org_id = p_org_id
    AND id = p_source_budget_id
    AND deleted_at IS NULL
  FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Source budget not found' USING ERRCODE = 'P0002';
  END IF;

  SELECT * INTO dst
  FROM public.employee_budgets
  WHERE org_id = p_org_id
    AND id = p_destination_budget_id
    AND deleted_at IS NULL
  FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Destination budget not found' USING ERRCODE = 'P0002';
  END IF;

  IF NOT public.can_access_employee(p_org_id, src.employee_id)
     OR NOT public.can_access_employee(p_org_id, dst.employee_id) THEN
    RAISE EXCEPTION 'forbidden' USING ERRCODE = '42501';
  END IF;

  IF upper(src.currency) <> upper(dst.currency) THEN
    RAISE EXCEPTION 'Source and destination currencies must match';
  END IF;

  v_available := public.employee_budget_remaining_amount(p_source_budget_id);
  IF p_amount > v_available THEN
    RAISE EXCEPTION 'Reallocation exceeds available source budget';
  END IF;

  v_code := public.next_org_document_code(p_org_id, 'reallocation', 'TRF');

  INSERT INTO public.budget_reallocations (
    org_id,
    reallocation_code,
    source_budget_id,
    destination_budget_id,
    amount,
    currency,
    reallocation_date,
    reason,
    created_by
  ) VALUES (
    p_org_id,
    v_code,
    p_source_budget_id,
    p_destination_budget_id,
    p_amount,
    upper(src.currency),
    COALESCE(p_reallocation_date, CURRENT_DATE),
    NULLIF(btrim(COALESCE(p_reason, '')), ''),
    v_uid
  )
  RETURNING id INTO v_id;

  UPDATE public.employee_budgets
  SET updated_by = v_uid
  WHERE id IN (p_source_budget_id, p_destination_budget_id);

  RETURN v_id;
END;
$$;

REVOKE ALL ON FUNCTION public.employee_budget_current_amount(uuid) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.employee_budget_actual_training_cost(uuid) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.employee_budget_remaining_amount(uuid) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.employee_budget_has_transactions(uuid) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.can_manage_budgets(uuid) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.create_employee_budget(uuid, uuid, text, numeric, text, date) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.update_employee_budget_details(uuid, uuid, text, date, numeric, text) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.adjust_employee_budget(uuid, uuid, text, numeric, text, date) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.reallocate_employee_budget(uuid, uuid, uuid, numeric, text, date) FROM PUBLIC;

GRANT EXECUTE ON FUNCTION public.employee_budget_current_amount(uuid) TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.employee_budget_actual_training_cost(uuid) TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.employee_budget_remaining_amount(uuid) TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.employee_budget_has_transactions(uuid) TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.can_manage_budgets(uuid) TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.create_employee_budget(uuid, uuid, text, numeric, text, date) TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.update_employee_budget_details(uuid, uuid, text, date, numeric, text) TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.adjust_employee_budget(uuid, uuid, text, numeric, text, date) TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.reallocate_employee_budget(uuid, uuid, uuid, numeric, text, date) TO authenticated, service_role;

GRANT SELECT, INSERT, UPDATE ON TABLE public.employee_budgets TO authenticated, service_role;
GRANT SELECT, INSERT ON TABLE public.budget_adjustments TO authenticated, service_role;
GRANT SELECT, INSERT ON TABLE public.budget_reallocations TO authenticated, service_role;
GRANT SELECT ON TABLE public.org_document_counters TO authenticated, service_role;
GRANT ALL ON TABLE public.org_document_counters TO service_role;

REVOKE UPDATE, DELETE ON TABLE public.budget_adjustments FROM authenticated;
REVOKE UPDATE, DELETE ON TABLE public.budget_reallocations FROM authenticated;
REVOKE INSERT, UPDATE, DELETE ON TABLE public.org_document_counters FROM authenticated;

-- ---------------------------------------------------------------------------
-- RLS
-- ---------------------------------------------------------------------------
ALTER TABLE public.org_document_counters ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.employee_budgets ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.budget_adjustments ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.budget_reallocations ENABLE ROW LEVEL SECURITY;

CREATE POLICY org_document_counters_select_hr
  ON public.org_document_counters FOR SELECT TO authenticated
  USING (public.can_manage_budgets(org_id));

CREATE POLICY employee_budgets_select_scoped
  ON public.employee_budgets FOR SELECT TO authenticated
  USING (
    deleted_at IS NULL
    AND public.can_access_employee(org_id, employee_id)
  );

CREATE POLICY employee_budgets_insert_hr
  ON public.employee_budgets FOR INSERT TO authenticated
  WITH CHECK (
    public.can_manage_budgets(org_id)
    AND public.can_access_employee(org_id, employee_id)
  );

CREATE POLICY employee_budgets_update_hr
  ON public.employee_budgets FOR UPDATE TO authenticated
  USING (
    deleted_at IS NULL
    AND public.can_manage_budgets(org_id)
    AND public.can_access_employee(org_id, employee_id)
  )
  WITH CHECK (
    public.can_manage_budgets(org_id)
    AND public.can_access_employee(org_id, employee_id)
  );

CREATE POLICY budget_adjustments_select_scoped
  ON public.budget_adjustments FOR SELECT TO authenticated
  USING (
    EXISTS (
      SELECT 1
      FROM public.employee_budgets b
      WHERE b.org_id = budget_adjustments.org_id
        AND b.id = budget_adjustments.budget_id
        AND b.deleted_at IS NULL
        AND public.can_access_employee(b.org_id, b.employee_id)
    )
  );

CREATE POLICY budget_adjustments_insert_hr
  ON public.budget_adjustments FOR INSERT TO authenticated
  WITH CHECK (public.can_manage_budgets(org_id));

CREATE POLICY budget_reallocations_select_scoped
  ON public.budget_reallocations FOR SELECT TO authenticated
  USING (
    EXISTS (
      SELECT 1
      FROM public.employee_budgets b
      WHERE b.org_id = budget_reallocations.org_id
        AND b.deleted_at IS NULL
        AND b.id IN (
          budget_reallocations.source_budget_id,
          budget_reallocations.destination_budget_id
        )
        AND public.can_access_employee(b.org_id, b.employee_id)
    )
  );

CREATE POLICY budget_reallocations_insert_hr
  ON public.budget_reallocations FOR INSERT TO authenticated
  WITH CHECK (public.can_manage_budgets(org_id));

-- List helper (security invoker respects underlying RLS)
CREATE OR REPLACE VIEW public.v_employee_budget_list
WITH (security_invoker = true)
AS
SELECT
  b.id,
  b.org_id,
  b.budget_code,
  b.employee_id,
  b.planned_course,
  b.initial_amount,
  b.currency,
  b.planned_course_start_date,
  b.created_at,
  b.updated_at,
  public.employee_budget_current_amount(b.id) AS current_amount,
  public.employee_budget_remaining_amount(b.id) AS remaining_amount,
  public.employee_budget_has_transactions(b.id) AS has_transactions
FROM public.employee_budgets b
WHERE b.deleted_at IS NULL;

GRANT SELECT ON TABLE public.v_employee_budget_list TO authenticated, service_role;
