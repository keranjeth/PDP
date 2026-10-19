-- Actual employee training participation and costs. Employee/budget facts stay in their source tables.
CREATE SCHEMA IF NOT EXISTS private;
REVOKE ALL ON SCHEMA private FROM PUBLIC;

CREATE TABLE private.training_code_counters (
  org_id uuid NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
  year integer NOT NULL,
  last_value bigint NOT NULL DEFAULT 0,
  PRIMARY KEY (org_id, year)
);
ALTER TABLE private.training_code_counters ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON private.training_code_counters FROM PUBLIC, anon, authenticated;

CREATE TABLE public.training_records (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id uuid NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
  training_code text NOT NULL,
  employee_id uuid NOT NULL,
  budget_id uuid,
  course_title text NOT NULL CHECK (length(btrim(course_title)) BETWEEN 1 AND 500),
  delivery_method text NOT NULL CHECK (delivery_method IN ('In Person','Online','Hybrid')),
  training_start_date date NOT NULL,
  training_end_date date NOT NULL CHECK (training_end_date >= training_start_date),
  training_cost numeric(14,2) NOT NULL CHECK (training_cost >= 0),
  additional_cost numeric(14,2) NOT NULL DEFAULT 0 CHECK (additional_cost >= 0),
  total_actual_cost numeric(14,2) GENERATED ALWAYS AS (training_cost + additional_cost) STORED,
  additional_cost_note text NOT NULL DEFAULT '',
  currency text NOT NULL CHECK (currency IN ('AFN','USD','EUR')),
  funding_sources jsonb NOT NULL DEFAULT '[]'::jsonb CHECK (jsonb_typeof(funding_sources) = 'array'),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  created_by uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  updated_by uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  deleted_at timestamptz,
  UNIQUE (org_id, training_code),
  CONSTRAINT training_employee_fk FOREIGN KEY (org_id,employee_id) REFERENCES public.employees(org_id,id) ON DELETE RESTRICT,
  CONSTRAINT training_budget_fk FOREIGN KEY (org_id,budget_id) REFERENCES public.employee_budgets(org_id,id) ON DELETE RESTRICT,
  CHECK (additional_cost = 0 OR btrim(additional_cost_note) <> ''),
  CHECK (length(additional_cost_note) <= 2000),
  CHECK (training_code ~ '^TRN-[0-9]{4}-[0-9]{3,}$')
);
CREATE UNIQUE INDEX training_participation_unique ON public.training_records
  (org_id,employee_id,lower(btrim(course_title)),training_start_date,training_end_date)
  WHERE deleted_at IS NULL;
CREATE INDEX training_budget_idx ON public.training_records(budget_id) WHERE deleted_at IS NULL;
CREATE INDEX training_employee_idx ON public.training_records(employee_id);
CREATE INDEX training_org_date_idx ON public.training_records(org_id,training_start_date DESC,id) WHERE deleted_at IS NULL;
CREATE INDEX training_created_by_idx ON public.training_records(created_by);
CREATE INDEX training_updated_by_idx ON public.training_records(updated_by);
ALTER TABLE public.training_records ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.training_records FROM PUBLIC, anon, authenticated;
GRANT SELECT, INSERT, UPDATE ON public.training_records TO authenticated;
GRANT ALL ON public.training_records TO service_role;
CREATE POLICY training_read_scoped ON public.training_records FOR SELECT TO authenticated
  USING (deleted_at IS NULL AND public.can_access_employee(org_id,employee_id));
CREATE POLICY training_insert_scoped ON public.training_records FOR INSERT TO authenticated
  WITH CHECK (deleted_at IS NULL AND public.can_manage_budgets(org_id) AND public.can_access_employee(org_id,employee_id));
CREATE POLICY training_update_scoped ON public.training_records FOR UPDATE TO authenticated
  USING (deleted_at IS NULL AND public.can_manage_budgets(org_id) AND public.can_access_employee(org_id,employee_id))
  WITH CHECK (public.can_manage_budgets(org_id) AND public.can_access_employee(org_id,employee_id));

-- A private trigger owns code generation and cross-record validation. It is not an exposed RPC.
CREATE FUNCTION private.guard_training_record() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
DECLARE
  b public.employee_budgets%ROWTYPE;
  src jsonb;
  funding_total numeric := 0;
  source_names text[] := ARRAY[]::text[];
  v_year integer := extract(year from timezone('Asia/Kabul',now()));
  v_next bigint;
BEGIN
  IF auth.uid() IS NULL OR NOT public.can_manage_budgets(NEW.org_id)
     OR NOT public.can_access_employee(NEW.org_id,NEW.employee_id) THEN
    RAISE EXCEPTION 'You do not have access to this employee.' USING ERRCODE='42501';
  END IF;
  IF TG_OP='UPDATE' THEN
    IF NEW.id IS DISTINCT FROM OLD.id OR NEW.org_id IS DISTINCT FROM OLD.org_id
       OR NEW.training_code IS DISTINCT FROM OLD.training_code THEN
      RAISE EXCEPTION 'Training identity cannot be changed.' USING ERRCODE='22023';
    END IF;
    IF NOT public.can_access_employee(OLD.org_id,OLD.employee_id) THEN
      RAISE EXCEPTION 'Forbidden' USING ERRCODE='42501';
    END IF;
    NEW.created_at := OLD.created_at;
    NEW.created_by := OLD.created_by;
    IF NEW.deleted_at IS DISTINCT FROM OLD.deleted_at THEN
      IF public.org_role(NEW.org_id) NOT IN ('super_admin'::public.org_role,'head_of_hr'::public.org_role) THEN
        RAISE EXCEPTION 'You do not have permission to delete training records.' USING ERRCODE='42501';
      END IF;
      IF NEW.deleted_at IS NOT NULL THEN NEW.deleted_at := now(); END IF;
    END IF;
  ELSE
    IF NEW.deleted_at IS NOT NULL THEN RAISE EXCEPTION 'New training cannot be deleted.'; END IF;
    INSERT INTO private.training_code_counters AS c(org_id,year,last_value) VALUES(NEW.org_id,v_year,1)
      ON CONFLICT(org_id,year) DO UPDATE SET last_value=c.last_value+1 RETURNING last_value INTO v_next;
    NEW.training_code := 'TRN-'||v_year::text||'-'||lpad(v_next::text,greatest(3,length(v_next::text)),'0');
    NEW.created_at := now();
    NEW.created_by := auth.uid();
  END IF;
  -- Serialize costs with budget transfers/adjustments. Lock old/new budgets in UUID order.
  IF TG_OP='UPDATE' THEN
    PERFORM 1 FROM public.employee_budgets WHERE id IN (OLD.budget_id,NEW.budget_id) ORDER BY id FOR UPDATE;
  ELSIF NEW.budget_id IS NOT NULL THEN
    PERFORM 1 FROM public.employee_budgets WHERE id=NEW.budget_id FOR UPDATE;
  END IF;
  IF NEW.budget_id IS NOT NULL THEN
    SELECT * INTO b FROM public.employee_budgets WHERE id=NEW.budget_id AND org_id=NEW.org_id AND deleted_at IS NULL;
    IF NOT FOUND OR b.employee_id<>NEW.employee_id THEN
      RAISE EXCEPTION 'The budget must belong to the selected employee.' USING ERRCODE='22023';
    END IF;
    IF b.currency<>NEW.currency THEN
      RAISE EXCEPTION 'Training currency must match the selected budget.' USING ERRCODE='22023';
    END IF;
  END IF;
  NEW.course_title := btrim(NEW.course_title);
  NEW.additional_cost_note := btrim(NEW.additional_cost_note);
  IF jsonb_array_length(NEW.funding_sources)>20 THEN RAISE EXCEPTION 'Use up to 20 funding sources.'; END IF;
  FOR src IN SELECT value FROM jsonb_array_elements(NEW.funding_sources) LOOP
    IF jsonb_typeof(src)<>'object' OR jsonb_typeof(src->'name')<>'string'
       OR coalesce(length(btrim(src->>'name')),0) NOT BETWEEN 1 AND 200
       OR coalesce(jsonb_typeof(src->'amount'),'')<>'number' THEN
      RAISE EXCEPTION 'Each funding source needs a name and amount.' USING ERRCODE='22023';
    END IF;
    IF (src->>'amount')::numeric<0 OR (src->>'amount')::numeric<>round((src->>'amount')::numeric,2) THEN
      RAISE EXCEPTION 'Funding amounts must be non-negative with up to two decimal places.';
    END IF;
    IF lower(btrim(src->>'name'))=ANY(source_names) THEN RAISE EXCEPTION 'Use each funding source once.'; END IF;
    source_names := array_append(source_names,lower(btrim(src->>'name')));
    funding_total := funding_total+(src->>'amount')::numeric;
  END LOOP;
  IF jsonb_array_length(NEW.funding_sources)>0 AND funding_total<>NEW.training_cost+NEW.additional_cost THEN
    RAISE EXCEPTION 'Funding amounts must equal Total Actual Cost.' USING ERRCODE='22023';
  END IF;
  NEW.updated_at := now();
  NEW.updated_by := auth.uid();
  RETURN NEW;
END;
$$;
REVOKE ALL ON FUNCTION private.guard_training_record() FROM PUBLIC,anon,authenticated;
CREATE TRIGGER training_record_guard BEFORE INSERT OR UPDATE ON public.training_records
  FOR EACH ROW EXECUTE FUNCTION private.guard_training_record();

-- Atomic import. SQL trigger validates every row; any invalid row rolls back the entire batch.
CREATE FUNCTION public.import_training_records(p_org_id uuid,p_rows jsonb) RETURNS jsonb
LANGUAGE plpgsql SECURITY INVOKER SET search_path = '' AS $$
DECLARE r jsonb; v_id uuid; v_imported integer:=0; v_skipped integer:=0;
BEGIN
  IF auth.uid() IS NULL OR NOT coalesce(public.can_manage_budgets(p_org_id),false) THEN RAISE EXCEPTION 'Forbidden' USING ERRCODE='42501'; END IF;
  IF jsonb_typeof(p_rows)<>'array' OR jsonb_array_length(p_rows) NOT BETWEEN 1 AND 2000 THEN
    RAISE EXCEPTION 'Import between 1 and 2,000 training records at a time.';
  END IF;
  FOR r IN SELECT value FROM jsonb_array_elements(p_rows) LOOP
    v_id := NULL;
    INSERT INTO public.training_records(org_id,employee_id,budget_id,course_title,delivery_method,training_start_date,training_end_date,training_cost,additional_cost,additional_cost_note,currency,funding_sources)
    VALUES(p_org_id,(r->>'employee_id')::uuid,nullif(r->>'budget_id','')::uuid,r->>'course_title',r->>'delivery_method',(r->>'training_start_date')::date,(r->>'training_end_date')::date,(r->>'training_cost')::numeric,coalesce((r->>'additional_cost')::numeric,0),coalesce(r->>'additional_cost_note',''),r->>'currency',coalesce(r->'funding_sources','[]'::jsonb))
    ON CONFLICT(org_id,employee_id,lower(btrim(course_title)),training_start_date,training_end_date) WHERE deleted_at IS NULL DO NOTHING
    RETURNING id INTO v_id;
    IF v_id IS NULL THEN v_skipped:=v_skipped+1; ELSE v_imported:=v_imported+1; END IF;
  END LOOP;
  RETURN jsonb_build_object('imported',v_imported,'skipped',v_skipped);
END;
$$;
REVOKE ALL ON FUNCTION public.import_training_records(uuid,jsonb) FROM PUBLIC,anon;
GRANT EXECUTE ON FUNCTION public.import_training_records(uuid,jsonb) TO authenticated,service_role;

CREATE OR REPLACE FUNCTION public.employee_budget_actual_training_cost(p_budget_id uuid) RETURNS numeric
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public AS $$
BEGIN
  PERFORM public.employee_budget_assert_readable(p_budget_id);
  RETURN coalesce((SELECT sum(total_actual_cost) FROM public.training_records WHERE budget_id=p_budget_id AND deleted_at IS NULL),0);
END;
$$;
REVOKE ALL ON FUNCTION public.employee_budget_actual_training_cost(uuid) FROM PUBLIC,anon;
GRANT EXECUTE ON FUNCTION public.employee_budget_actual_training_cost(uuid) TO authenticated,service_role;

CREATE OR REPLACE FUNCTION public.employee_budget_remaining_amount(p_budget_id uuid)
RETURNS numeric
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  PERFORM public.employee_budget_assert_readable(p_budget_id);
  RETURN public.employee_budget_current_amount_unlocked(p_budget_id)
       - public.employee_budget_actual_training_cost(p_budget_id);
END;
$$;

CREATE OR REPLACE FUNCTION public.employee_budget_has_transactions(p_budget_id uuid)
RETURNS boolean
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  PERFORM public.employee_budget_assert_readable(p_budget_id);
  RETURN EXISTS (
    SELECT 1 FROM public.budget_adjustments a WHERE a.budget_id = p_budget_id
  )
  OR EXISTS (
    SELECT 1 FROM public.budget_reallocations r
    WHERE r.source_budget_id = p_budget_id
       OR r.destination_budget_id = p_budget_id
  )
  OR EXISTS (SELECT 1 FROM public.training_records t WHERE t.budget_id=p_budget_id AND t.deleted_at IS NULL);
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

  -- Row is locked; use unlocked math so concurrent sessions cannot overspend.
  v_current := public.employee_budget_current_amount_unlocked(p_budget_id)
             - public.employee_budget_actual_training_cost(p_budget_id);

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
  v_first public.employee_budgets%ROWTYPE;
  v_second public.employee_budgets%ROWTYPE;
  v_first_id uuid;
  v_second_id uuid;
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

  -- Lock both rows in UUID order to avoid deadlocks under concurrent transfers.
  IF p_source_budget_id < p_destination_budget_id THEN
    v_first_id := p_source_budget_id;
    v_second_id := p_destination_budget_id;
  ELSE
    v_first_id := p_destination_budget_id;
    v_second_id := p_source_budget_id;
  END IF;

  SELECT * INTO v_first
  FROM public.employee_budgets
  WHERE org_id = p_org_id
    AND id = v_first_id
    AND deleted_at IS NULL
  FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Budget not found' USING ERRCODE = 'P0002';
  END IF;

  SELECT * INTO v_second
  FROM public.employee_budgets
  WHERE org_id = p_org_id
    AND id = v_second_id
    AND deleted_at IS NULL
  FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Budget not found' USING ERRCODE = 'P0002';
  END IF;

  IF v_first.id = p_source_budget_id THEN
    src := v_first;
    dst := v_second;
  ELSE
    src := v_second;
    dst := v_first;
  END IF;

  IF NOT public.can_access_employee(p_org_id, src.employee_id)
     OR NOT public.can_access_employee(p_org_id, dst.employee_id) THEN
    RAISE EXCEPTION 'forbidden' USING ERRCODE = '42501';
  END IF;

  IF upper(src.currency) <> upper(dst.currency) THEN
    RAISE EXCEPTION 'Source and destination currencies must match';
  END IF;

  v_available := public.employee_budget_current_amount_unlocked(p_source_budget_id)
               - public.employee_budget_actual_training_cost(p_source_budget_id);
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

-- Speed up budget/dashboard list reads.
-- The previous view called employee_budget_current_amount() / remaining / has_transactions
-- per row; each call re-ran auth asserts and nested aggregates (~seconds for 800 rows).
-- Use set-based joins instead. RLS still applies via security_invoker on the base tables.

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
  (
    b.initial_amount
    + COALESCE(adj.net_amount, 0)
    + COALESCE(rin.in_amount, 0)
    - COALESCE(rout.out_amount, 0)
  ) AS current_amount,
  (
    b.initial_amount
    + COALESCE(adj.net_amount, 0)
    + COALESCE(rin.in_amount, 0)
    - COALESCE(rout.out_amount, 0)
    - COALESCE(costs.total_cost, 0)
  ) AS remaining_amount,
  (
    COALESCE(adj.txn_count, 0)
    + COALESCE(rin.txn_count, 0)
    + COALESCE(rout.txn_count, 0)
    + COALESCE(costs.txn_count, 0)
  ) > 0 AS has_transactions,
  e.id_number AS employee_id_number,
  e.full_name,
  e.employment_status,
  e.region,
  e.duty_station,
  e.job_location,
  e.department,
  e.unit,
  e.designation,
  COALESCE(adj.net_amount,0) AS budget_adjustment,
  COALESCE(rin.in_amount,0) AS transfers_in,
  COALESCE(rout.out_amount,0) AS transfers_out,
  COALESCE(costs.total_cost,0) AS actual_training_cost
FROM public.employee_budgets b
INNER JOIN public.employees e
  ON e.id = b.employee_id
LEFT JOIN LATERAL (
  SELECT
    COALESCE(
      SUM(
        CASE
          WHEN a.direction = 'increase' THEN a.amount
          ELSE -a.amount
        END
      ),
      0
    ) AS net_amount,
    COUNT(*)::integer AS txn_count
  FROM public.budget_adjustments a
  WHERE a.budget_id = b.id
) adj ON true
LEFT JOIN LATERAL (
  SELECT
    COALESCE(SUM(r.amount), 0) AS in_amount,
    COUNT(*)::integer AS txn_count
  FROM public.budget_reallocations r
  WHERE r.destination_budget_id = b.id
) rin ON true
LEFT JOIN LATERAL (
  SELECT
    COALESCE(SUM(r.amount), 0) AS out_amount,
    COUNT(*)::integer AS txn_count
  FROM public.budget_reallocations r
  WHERE r.source_budget_id = b.id
) rout ON true
LEFT JOIN LATERAL (
  SELECT COALESCE(SUM(t.total_actual_cost),0) AS total_cost, COUNT(*)::integer AS txn_count
  FROM public.training_records t WHERE t.budget_id=b.id AND t.deleted_at IS NULL
) costs ON true
WHERE b.deleted_at IS NULL;

GRANT SELECT ON TABLE public.v_employee_budget_list TO authenticated, service_role;

CREATE VIEW public.v_training_record_list WITH (security_invoker=true) AS
SELECT t.*, e.id_number AS employee_id_number,e.full_name,e.gender,e.designation,e.department,e.unit,e.region,e.duty_station,e.job_location,e.employment_status,
  b.budget_code,b.initial_amount AS initial_budget,b.budget_adjustment,b.transfers_in,b.transfers_out,b.current_amount AS current_budget,b.remaining_amount AS budget_balance
FROM public.training_records t
JOIN public.employees e ON e.id=t.employee_id AND e.org_id=t.org_id
LEFT JOIN public.v_employee_budget_list b ON b.id=t.budget_id AND b.org_id=t.org_id
WHERE t.deleted_at IS NULL;
GRANT SELECT ON public.v_training_record_list TO authenticated,service_role;
