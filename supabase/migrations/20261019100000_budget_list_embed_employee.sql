-- Embed employee fields in the budget list view so the API does not need a
-- second .in(id, …) query (which breaks with HTTP 400 once ~hundreds of UUIDs
-- exceed PostgREST URL length limits after a large import).

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
  public.employee_budget_has_transactions(b.id) AS has_transactions,
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
WHERE b.deleted_at IS NULL;

GRANT SELECT ON TABLE public.v_employee_budget_list TO authenticated, service_role;
