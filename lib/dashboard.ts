import type { Employee } from './types';
import { employeeStore } from './store';

type DashboardCard = {
  title: string;
  currentValue: number;
  previousValue: number;
  currency: string;
  valueStyle?: 'compact' | 'exact';
  bottomLabel: string;
  icon: 'wallet' | 'tax' | 'piggy' | 'pulse';
};

type HeadcountChartDatum = {
  month: string;
  activeCount: number;
  totalCount: number;
};

type DepartmentChartDatum = {
  name: string;
  value: number;
  count: number;
};

export type DashboardEmployeeRow = {
  id: string;
  idNumber: string;
  fullName: string;
  designation: string;
  department: string;
  region: string;
  currency: string;
  createdAt: Date;
};

export type DashboardAnalytics = {
  cards: DashboardCard[];
  headcountData: HeadcountChartDatum[];
  departmentData: DepartmentChartDatum[];
  employeeRows: DashboardEmployeeRow[];
  chartRangeLabel: string;
};

const MONTH_LABELS = Array.from({ length: 12 }, (_, index) =>
  new Date(2026, index, 1).toLocaleString('en-US', { month: 'long' })
);

function endOfMonth(date: Date) {
  return new Date(date.getFullYear(), date.getMonth() + 1, 0, 23, 59, 59, 999);
}

function getPreviousMonthEnd(date: Date) {
  return new Date(date.getFullYear(), date.getMonth(), 0, 23, 59, 59, 999);
}

function uniqueNonEmpty(values: string[]) {
  return new Set(values.map((v) => String(v ?? '').trim()).filter(Boolean));
}

function getCards(employees: Employee[]): DashboardCard[] {
  const now = new Date();
  const currentPeriodEnd = endOfMonth(now);
  const previousPeriodEnd = getPreviousMonthEnd(now);

  const employeesAsOf = (cutoff: Date) =>
    employees.filter((e) => e.createdAt && e.createdAt <= cutoff);

  const currentEmployees = employeesAsOf(currentPeriodEnd);
  const previousEmployees = employeesAsOf(previousPeriodEnd);

  const activeAsOf = (rows: Employee[]) =>
    rows.filter((e) => e.employmentStatus === 'Active');

  const currentActive = activeAsOf(currentEmployees);
  const previousActive = activeAsOf(previousEmployees);

  const currentRegions = uniqueNonEmpty(currentEmployees.map((e) => e.region ?? ''));
  const previousRegions = uniqueNonEmpty(previousEmployees.map((e) => e.region ?? ''));

  const currentDepartments = uniqueNonEmpty(currentEmployees.map((e) => e.department));
  const previousDepartments = uniqueNonEmpty(previousEmployees.map((e) => e.department));

  return [
    {
      title: 'Total Employees',
      currentValue: currentEmployees.length,
      previousValue: previousEmployees.length,
      currency: '',
      valueStyle: 'exact',
      bottomLabel: 'All employees',
      icon: 'wallet',
    },
    {
      title: 'Active Employees',
      currentValue: currentActive.length,
      previousValue: previousActive.length,
      currency: '',
      valueStyle: 'exact',
      bottomLabel: 'Currently active',
      icon: 'pulse',
    },
    {
      title: 'Regions',
      currentValue: currentRegions.size,
      previousValue: previousRegions.size,
      currency: '',
      valueStyle: 'exact',
      bottomLabel: 'Coverage footprint',
      icon: 'tax',
    },
    {
      title: 'Departments',
      currentValue: currentDepartments.size,
      previousValue: previousDepartments.size,
      currency: '',
      valueStyle: 'exact',
      bottomLabel: 'Org structure',
      icon: 'piggy',
    },
  ];
}

function countEmployeesAsOf(employees: Employee[], year: number, monthIndex: number) {
  const cutoff = endOfMonth(new Date(year, monthIndex, 1));
  const asOf = employees.filter((e) => e.createdAt && e.createdAt <= cutoff);
  const active = asOf.filter((e) => e.employmentStatus === 'Active');
  return { total: asOf.length, active: active.length };
}

function getMonthlyHeadcountData(employees: Employee[], year: number): HeadcountChartDatum[] {
  return MONTH_LABELS.map((label, index) => {
    const counts = countEmployeesAsOf(employees, year, index);
    return {
      month: label,
      activeCount: counts.active,
      totalCount: counts.total,
    };
  });
}

function getDepartmentBreakdown(employees: Employee[]): DepartmentChartDatum[] {
  const active = employees.filter((e) => e.employmentStatus === 'Active');
  const byDept = new Map<string, number>();
  for (const e of active) {
    const dept = (e.department ?? '').trim() || 'Unassigned';
    byDept.set(dept, (byDept.get(dept) ?? 0) + 1);
  }

  const breakdown = [...byDept.entries()]
    .map(([name, count]) => ({ name, count, amount: count }))
    .sort((a, b) => b.count - a.count);

  const highest = Math.max(...breakdown.map((item) => item.count), 0);

  return breakdown.map((item) => ({
    name: item.name,
    count: item.count,
    value:
      highest > 0 && item.count > 0
        ? Math.max(6, Math.round((item.count / highest) * 100))
        : 0,
  }));
}

export function buildEmployeeRows(employees: Employee[]): DashboardEmployeeRow[] {
  return employees.map((employee) => ({
    id: employee.id,
    idNumber: employee.idNumber,
    fullName: employee.fullName,
    designation: employee.designation,
    department: employee.department,
    region: employee.region ?? '',
    currency: employee.currency,
    createdAt: employee.createdAt,
  }));
}

function buildDashboardAnalytics(): DashboardAnalytics {
  const employees = employeeStore.getEmployees();
  const year = new Date().getFullYear();

  return {
    cards: getCards(employees),
    headcountData: getMonthlyHeadcountData(employees, year),
    departmentData: getDepartmentBreakdown(employees),
    employeeRows: buildEmployeeRows(employees),
    chartRangeLabel: `January - December ${year}`,
  };
}

export async function fetchDashboardAnalytics(): Promise<DashboardAnalytics> {
  return Promise.resolve(buildDashboardAnalytics());
}
