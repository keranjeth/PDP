import type { BudgetListItem } from '@/lib/budgets/types';

type BudgetListRow = {
  id: string;
  budget_code: string;
  employee_id: string;
  planned_course: string;
  initial_amount: number | string;
  currency: string;
  planned_course_start_date: string;
  current_amount: number | string;
  remaining_amount: number | string;
  has_transactions: boolean;
};

type EmployeeLite = {
  id: string;
  id_number: string;
  full_name: string;
  region: string | null;
  duty_station: string | null;
  job_location: string | null;
  department: string;
  unit: string | null;
  designation: string;
};

function toNumber(value: number | string | null | undefined) {
  const n = typeof value === 'number' ? value : Number(value);
  return Number.isFinite(n) ? n : 0;
}

export function mapBudgetListItem(
  row: BudgetListRow,
  employee: EmployeeLite | undefined
): BudgetListItem {
  return {
    id: row.id,
    budgetCode: row.budget_code,
    employeeId: row.employee_id,
    employeeIdNumber: employee?.id_number ?? '',
    fullName: employee?.full_name ?? '',
    region: employee?.region ?? '',
    dutyStation: employee?.duty_station ?? '',
    jobLocation: employee?.job_location ?? '',
    department: employee?.department ?? '',
    unit: employee?.unit ?? '',
    positionTitle: employee?.designation ?? '',
    plannedCourse: row.planned_course,
    initialAmount: toNumber(row.initial_amount),
    currency: row.currency,
    plannedCourseStartDate: String(row.planned_course_start_date).slice(0, 10),
    currentAmount: toNumber(row.current_amount),
    remainingAmount: toNumber(row.remaining_amount),
    hasTransactions: Boolean(row.has_transactions),
  };
}
