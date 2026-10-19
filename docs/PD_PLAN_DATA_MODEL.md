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

## Budgets (implemented)

Authoritative source for approved employee training allocations.

Local migration: `supabase/migrations/20261017140000_employee_training_budgets.sql`

Tables: `employee_budgets` (employee FK only; no duplicated org attributes), `budget_adjustments`, `budget_reallocations`, `org_document_counters`.

IDs: `BGT-YYYY-NNN`, `ADJ-YYYY-NNN`, `TRF-YYYY-NNN` (creation year; never rewritten when course date changes).

Calculations (derived): Current = Initial + Increases − Decreases + Transfers In − Transfers Out; Remaining = Current − Actual Training Cost via `employee_budget_actual_training_cost` (sums active linked Training Records).

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

## Training Records (implemented)

Authoritative source for actual training and costs.

| Field | Source |
|---|---|
| Training ID | Generated stable ID |
| Employee Reference | FK → `employees.id` |
| Related Budget ID | Optional FK → budget |
| Course Title | Entered; initially populated from selected budget |
| Delivery Method | In Person, Online, Hybrid, Internal, External |
| Training Start / End Date | Entered |
| Actual Training Cost | Entered |
| Additional Cost | Entered; optional; default 0 |
| Additional Cost Note | Entered when additional cost applies (e.g. Mahram, travel) |
| Currency | Inherited from selected budget; otherwise AFN, USD, or EUR |
| Funding Sources | Optional source names and amounts; sum must equal Total Actual Cost when supplied |

**Referenced via employee (not stored on training):** organizational and identity display fields listed above.

**Derived (do not store):** `Total Actual Cost = Actual Training Cost + Additional Cost`.

Do not add a separate Mahram Cost column. Do not introduce Events, Attendance, or Completion entities in this phase.

---

## Relationships

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
| Budgets table / UI | **Implemented** |
| Training Records table / UI | **Implemented**, including import/export, details, edits, and soft deletion |
| Expenses ledger | **Not planned** as a duplicate store; future consolidated view |
| Report fact tables | **Not planned**; derive from source tables |

## Training implementation

- `training_records` stores employee participation and actual costs. Repeated attendance on different dates produces separate records. An exact employee/course/start/end duplicate is rejected; imports skip it.
- Human-readable Training IDs use `TRN-YYYY-NNN`; technical UUIDs remain internal. Code generation and employee/budget/currency validation run in a private trigger.
- The table and both list views use existing organization/employee/region access. Employees can read their own records; management follows budget permissions. Only Head of HR and Super Admin can soft-delete records.
- Soft-deleted history retains the same employee/region read restrictions. List views and cost totals exclude it. No authenticated role has hard-delete permission.
- Budget remaining amount is current allocation minus every active linked training's Total Actual Cost. Updating a cost recalculates the balance; it does not deduct the old cost again. Transfers and budget decreases cannot use amounts already consumed by training.
- Training with no budget is supported. Its Budget Balance is blank; its costs appear in overall training totals, but not the budget-utilization donut.
- Budget figures shown alongside multiple trainings are references to the same budget. Training report summaries total training costs only, never repeated budget allocations.
- Reports/export include all agreed employee, training, budget, cost, funding, and currency fields. Date filters use actual Training Start Date.
- Regional/department fields reference the current employee master; point-in-time organizational snapshots remain a future decision.
- Cross-currency budget deductions are rejected until a conversion policy is defined.

Validation: `node --test tests/dashboard.test.mjs tests/training.test.mjs`; database transaction checks in `tests/training-records.sql` roll back every test record.
