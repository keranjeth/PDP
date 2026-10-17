# PD Plan database

## Migrations (local; apply only after explicit approval)

1. `migrations/20261017120000_pd_plan_baseline.sql` — employees, auth, leavers
2. `migrations/20261017140000_employee_training_budgets.sql` — employee budget allocations, adjustments, reallocations

Do **not** apply these to a cloud project until reviewed.

This is a self-contained schema for:

- Organizations, profiles, membership, roles, regional assignments
- Employees, employee–user links, import upserts
- Leavers / offboarding archive
- Member permissions and admin audit logs
- RLS helpers and hard-delete RPCs

It does **not** include payroll, compensation, pension, tax, overtime groups, work calendars, recovery ledgers, or separation payment tables.

## Safety

- Apply to a **new** Supabase project for PD Plan.
- Do not run against the original Workforce Administration database.
- Do not apply until explicitly approved for the target project.
