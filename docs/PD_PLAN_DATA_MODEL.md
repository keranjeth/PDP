# PD Plan data model

Concise reference for the employee foundation and proposed Budgets / Training Records relationships.

**Rule:** Store each fact once in its authoritative source; other modules reference by ID.

## Implemented: Employees

Authoritative employee master (local baseline: `supabase/migrations/20261017120000_pd_plan_baseline.sql`).

Retained capabilities: organizations, profiles, membership, roles/permissions, employee CRUD/import, Active / Leavers, offboarding, hard delete, RLS.

### Employee master fields (entered in Employees)

| Area | Fields |
|---|---|
| Identity | Internal `id` (UUID), `id_number`, `full_name`, `gender`, optional `date_of_birth` |
| Job | `designation` (position title), `staffing_category`, `position_number`, `reports_to_position_number`, `department`, `unit`, `region`, `duty_station`, `job_location` |
| Contract | `contract_type`, `job_status`, `employment_status`, `joining_date`, optional contract dates |

Removed from employee master: Overtime Group, Currency, Blood Group, Marital Status.

Currency belongs on financial records (Budgets / Training), not on employees.

### Leavers / history (implemented, limited)

Offboarding copies a **snapshot** into `leavers` and marks the employee inactive. That preserves exit-time organizational attributes for the Leavers view without a full effective-dated history system.

### Historical organizational attributes (decision point — not implemented)

Current UI and future modules should join the live employee row for name, position, department, unit, region, duty station, and job location.

If a training or budget report must show those attributes **as of the training date**, choose later between:

1. A limited point-in-time snapshot on the training (or budget) row, or  
2. Effective-dated employee history.

Do **not** duplicate current employee details on every related table now.

---

## Budgets (implemented locally — pending Supabase deploy)

Authoritative source for approved employee training allocations.

Local migration: `supabase/migrations/20261017140000_employee_training_budgets.sql`

Tables: `employee_budgets` (employee FK only; no duplicated org attributes), `budget_adjustments`, `budget_reallocations`, `org_document_counters`.

IDs: `BGT-YYYY-NNN`, `ADJ-YYYY-NNN`, `TRF-YYYY-NNN` (creation year; never rewritten when course date changes).

Calculations (derived): Current = Initial + Increases − Decreases + Transfers In − Transfers Out; Remaining = Current − Actual Training Cost via `employee_budget_actual_training_cost` (**still returns 0** until Training Records tables exist and link costs to `employee_budgets.id`).

| Field | Source |
|---|---|
| Budget ID | Generated stable ID |
| Employee Reference | FK → `employees.id` |
| Planned Course | Entered |
| Budget (amount) | Entered |
| Currency | Entered on the budget record |
| Planned Course Start Date | Entered |

**Referenced via employee (not stored on budget):** Full Name, Gender, Position Title, Department, Unit, Region, Duty Station, Job Location, and other master attributes.

**Budget Year (unresolved):** Do not add a separate Budget Year field yet. Year can provisionally be derived from Planned Course Start Date for planning views. A separately assigned Budget Year may be required if the fiscal year differs from the calendar year of the course, or if allocations are carried forward/rescheduled. Changing a course date must **not** automatically rewrite an approved allocation’s financial year until that policy is decided.

Adjustments and reallocations are stored as append-only transactions; original `initial_amount` is never overwritten by those operations.

---

## Proposed: Training Records (not implemented)

Authoritative source for actual training and costs.

| Field | Source |
|---|---|
| Training ID | Generated stable ID |
| Employee Reference | FK → `employees.id` |
| Related Budget ID | Optional FK → budget |
| Training / Course Title | Entered |
| Training Start / End Date | Entered |
| Actual Training Cost | Entered |
| Additional Cost | Entered; optional; default 0 |
| Additional Cost Note | Entered when additional cost applies (e.g. Mahram, travel) |
| Currency | Entered on the training record |

**Referenced via employee (not stored on training):** organizational and identity display fields listed above.

**Derived (do not store):** `Total Actual Cost = Actual Training Cost + Additional Cost`.

Do not add a separate Mahram Cost column. Do not introduce Events, Attendance, or Completion entities in this phase.

---

## Proposed relationships

```
employees (1) ──< budgets
employees (1) ──< training_records
budgets (1) ──< training_records   (optional related budget)
```

Expenses and Reports should read Training Records (and Budgets / Employees) rather than duplicate costs or employee attributes.

---

## Currency conversion (unresolved — not implemented)

Budget currency and training currency may differ. Do not add or subtract across currencies without a defined exchange-rate policy.

---

## Status labels

| Area | Status |
|---|---|
| Employees + auth + leavers | **Implemented** (local baseline; not deployed in this task) |
| Budgets table / UI | **Implemented locally** (migration not deployed) |
| Training Records table / UI | **Proposed** |
| Expenses ledger | **Not planned** as a duplicate store; future consolidated view |
| Report fact tables | **Not planned**; derive from source tables |
