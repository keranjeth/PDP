'use client';

import { CompactDataTable } from '@/components/ui/compact-employee-table';

type ExpenseRow = { id: string };

const EXPENSE_COLUMNS = [
  { key: 'employeeId', label: 'Employee ID' },
  { key: 'fullName', label: 'Full Name' },
  { key: 'course', label: 'Course' },
  { key: 'actualCost', label: 'Actual Cost', align: 'right' as const },
  { key: 'date', label: 'Date' },
];

export default function ExpensesPage() {
  const rows: ExpenseRow[] = [];

  return (
    <div className="mx-auto max-w-7xl">
      <CompactDataTable<ExpenseRow>
        title="Expenses"
        description="Record and review actual training costs."
        rows={rows}
        emptyMessage="No training expenses available."
        columns={EXPENSE_COLUMNS}
        renderCell={() => <span className="text-[13px] text-slate-900">—</span>}
      />
    </div>
  );
}
