'use client';

import { CompactDataTable } from '@/components/ui/compact-employee-table';

type BudgetRow = { id: string };

const BUDGET_COLUMNS = [
  { key: 'budgetId', label: 'Budget ID' },
  { key: 'employeeId', label: 'Employee ID' },
  { key: 'fullName', label: 'Full Name' },
  { key: 'region', label: 'Region' },
  { key: 'dutyStation', label: 'Duty Station' },
  { key: 'jobLocation', label: 'Job Location' },
  { key: 'department', label: 'Department' },
  { key: 'unit', label: 'Unit' },
  { key: 'positionTitle', label: 'Position Title' },
  { key: 'plannedCourse', label: 'Planned Course' },
  { key: 'budget', label: 'Budget', align: 'right' as const },
  { key: 'expectedDate', label: 'Expected Date' },
];

export default function BudgetsPage() {
  const rows: BudgetRow[] = [];

  return (
    <div className="mx-auto max-w-7xl">
      <CompactDataTable<BudgetRow>
        title="Budgets"
        description="Manage employee training budget allocations and planned courses."
        rows={rows}
        emptyMessage="No budget records available."
        columns={BUDGET_COLUMNS}
        renderCell={() => <span className="text-[13px] text-slate-900">—</span>}
      />
    </div>
  );
}
