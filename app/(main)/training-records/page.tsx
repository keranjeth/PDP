'use client';

import { CompactDataTable } from '@/components/ui/compact-employee-table';

type TrainingRecordRow = { id: string };

const TRAINING_COLUMNS = [
  { key: 'employeeId', label: 'Employee ID' },
  { key: 'fullName', label: 'Full Name' },
  { key: 'course', label: 'Course' },
  { key: 'region', label: 'Region' },
  { key: 'date', label: 'Date' },
];

export default function TrainingRecordsPage() {
  const rows: TrainingRecordRow[] = [];

  return (
    <div className="mx-auto max-w-7xl">
      <CompactDataTable<TrainingRecordRow>
        title="Training Records"
        description="View and manage employee training records."
        rows={rows}
        emptyMessage="No training records available."
        columns={TRAINING_COLUMNS}
        renderCell={() => <span className="text-[13px] text-slate-900">—</span>}
      />
    </div>
  );
}
