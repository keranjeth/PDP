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
  ) AS remaining_amount,
  (
    COALESCE(adj.txn_count, 0)
    + COALESCE(rin.txn_count, 0)
    + COALESCE(rout.txn_count, 0)
  ) > 0 AS has_transactions,
  e.id_number AS employee_id_number,
  e.full_name,
  e.employment_status,
  e.region,
  e.duty_station,
  e.job_location,
  e.department,
  e.unit,
  e.designation
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
WHERE b.deleted_at IS NULL;

GRANT SELECT ON TABLE public.v_employee_budget_list TO authenticated, service_role;
