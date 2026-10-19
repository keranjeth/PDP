'use client';

import Link from 'next/link';
import { useEffect, useMemo, useState } from 'react';
import { useAppAuth } from '@/components/providers/AppProviders';
import { Button } from '@/components/ui/Button';
import { HeaderDivider } from '@/components/ui/HeaderDivider';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/Select';
import {
  BUDGET_CURRENCIES,
  type BudgetCurrency,
  type BudgetListItem,
} from '@/lib/budgets/types';
import {
  downloadEmployeeBudgetReportExport,
  type EmployeeBudgetReportExportRow,
  type EmployeeTableExportRow,
} from '@/lib/employee-import';
import { formatCurrency } from '@/lib/format-currency';
import { employeeFromLeaverSnapshot, fetchOrgLeavers } from '@/lib/leavers';
import { fetchEmployeesFromSupabase } from '@/lib/supabase/employee-db';
import { getSupabaseBrowserClient } from '@/lib/supabase/client';
import type { Employee } from '@/lib/types';
import { can } from '@/lib/user-management/permissions';

type EmployeeExportScope = 'active' | 'separated' | 'all';

type EmployeeExportBase = EmployeeTableExportRow & {
  employeeId: string;
};

type CurrencyTotals = {
  count: number;
  initial: number;
  current: number;
  remaining: number;
};

type NamedTotal = {
  name: string;
  count: number;
  amount: number;
};

async function fetchBudgets(orgId: string): Promise<BudgetListItem[]> {
  const response = await fetch(`/api/budgets?orgId=${encodeURIComponent(orgId)}`);
  if (!response.ok) {
    let message = `Request failed (${response.status})`;
    try {
      const body = (await response.json()) as { error?: string };
      if (body.error) message = body.error;
    } catch {
      // keep default
    }
    throw new Error(message);
  }
  const data = (await response.json()) as { budgets?: BudgetListItem[] };
  return data.budgets ?? [];
}

function emptyCurrencyTotals(): Record<BudgetCurrency, CurrencyTotals> {
  return {
    AFN: { count: 0, initial: 0, current: 0, remaining: 0 },
    USD: { count: 0, initial: 0, current: 0, remaining: 0 },
    EUR: { count: 0, initial: 0, current: 0, remaining: 0 },
  };
}

function sumByCurrency(budgets: BudgetListItem[]) {
  const totals = emptyCurrencyTotals();
  for (const row of budgets) {
    const currency = (BUDGET_CURRENCIES.includes(row.currency as BudgetCurrency)
      ? row.currency
      : 'AFN') as BudgetCurrency;
    totals[currency].count += 1;
    totals[currency].initial += Number(row.initialAmount) || 0;
    totals[currency].current += Number(row.currentAmount) || 0;
    totals[currency].remaining += Number(row.remainingAmount) || 0;
  }
  return totals;
}

function topGroups(
  budgets: BudgetListItem[],
  getName: (row: BudgetListItem) => string,
  limit = 8
): NamedTotal[] {
  const map = new Map<string, NamedTotal>();
  for (const row of budgets) {
    const name = getName(row).trim() || 'Unspecified';
    const current = map.get(name) ?? { name, count: 0, amount: 0 };
    current.count += 1;
    current.amount += Number(row.currentAmount) || 0;
    map.set(name, current);
  }
  return [...map.values()].sort((a, b) => b.amount - a.amount || b.count - a.count).slice(0, limit);
}

function primaryCurrency(totals: Record<BudgetCurrency, CurrencyTotals>): BudgetCurrency {
  let best: BudgetCurrency = 'AFN';
  let bestAmount = -1;
  for (const currency of BUDGET_CURRENCIES) {
    if (totals[currency].current > bestAmount) {
      best = currency;
      bestAmount = totals[currency].current;
    }
  }
  return best;
}

function toExportRow(employee: Employee, status: 'Active' | 'Inactive'): EmployeeExportBase {
  return {
    employeeId: employee.id,
    idNumber: employee.idNumber,
    fullName: employee.fullName,
    designation: employee.designation,
    department: employee.department,
    region: employee.region ?? '',
    employmentStatus: status,
  };
}

function sortExportRows(rows: EmployeeExportBase[]) {
  return [...rows].sort((a, b) => {
    const statusCmp = String(a.employmentStatus).localeCompare(String(b.employmentStatus));
    if (statusCmp !== 0) return statusCmp;
    return a.fullName.localeCompare(b.fullName) || a.idNumber.localeCompare(b.idNumber);
  });
}

async function loadEmployeeExportSets(orgId: string): Promise<{
  active: EmployeeExportBase[];
  separated: EmployeeExportBase[];
}> {
  const supabase = getSupabaseBrowserClient();
  if (!supabase) {
    throw new Error('Supabase is not configured.');
  }

  const [employees, leavers] = await Promise.all([
    fetchEmployeesFromSupabase(supabase, orgId),
    fetchOrgLeavers(supabase, orgId),
  ]);

  const active: EmployeeExportBase[] = [];
  const separatedById = new Map<string, EmployeeExportBase>();

  for (const employee of employees) {
    if (employee.employmentStatus === 'Inactive') {
      separatedById.set(employee.id, toExportRow(employee, 'Inactive'));
    } else {
      active.push(toExportRow(employee, 'Active'));
    }
  }

  for (const leaver of leavers) {
    const employee = employeeFromLeaverSnapshot(leaver);
    if (!separatedById.has(employee.id)) {
      separatedById.set(employee.id, toExportRow(employee, 'Inactive'));
    }
  }

  return {
    active: sortExportRows(active),
    separated: sortExportRows([...separatedById.values()]),
  };
}

function joinEmployeesWithBudgets(
  employees: EmployeeExportBase[],
  budgets: BudgetListItem[]
): EmployeeBudgetReportExportRow[] {
  const budgetsByEmployeeId = new Map<string, BudgetListItem[]>();
  for (const budget of budgets) {
    const list = budgetsByEmployeeId.get(budget.employeeId) ?? [];
    list.push(budget);
    budgetsByEmployeeId.set(budget.employeeId, list);
  }

  const rows: EmployeeBudgetReportExportRow[] = [];
  for (const employee of employees) {
    const allocations = budgetsByEmployeeId.get(employee.employeeId) ?? [];
    if (allocations.length === 0) {
      rows.push({
        idNumber: employee.idNumber,
        fullName: employee.fullName,
        designation: employee.designation,
        department: employee.department,
        region: employee.region,
        employmentStatus: employee.employmentStatus,
        plannedCourse: '',
        budgetAmount: '',
        currency: '',
        plannedCourseStartDate: '',
      });
      continue;
    }

    const sorted = [...allocations].sort((a, b) => {
      const dateCmp = (a.plannedCourseStartDate || '').localeCompare(
        b.plannedCourseStartDate || ''
      );
      if (dateCmp !== 0) return dateCmp;
      return a.plannedCourse.localeCompare(b.plannedCourse);
    });

    for (const budget of sorted) {
      rows.push({
        idNumber: employee.idNumber,
        fullName: employee.fullName,
        designation: employee.designation,
        department: employee.department,
        region: employee.region,
        employmentStatus: employee.employmentStatus,
        plannedCourse: budget.plannedCourse,
        budgetAmount: Number(budget.currentAmount) || Number(budget.initialAmount) || 0,
        currency: budget.currency,
        plannedCourseStartDate: budget.plannedCourseStartDate || '',
      });
    }
  }

  return rows;
}

function exportFileMeta(scope: EmployeeExportScope) {
  if (scope === 'active') {
    return {
      fileName: 'Employee-Budgets-Active.xlsx',
      sheetName: 'Active Employees',
    };
  }
  if (scope === 'separated') {
    return {
      fileName: 'Employee-Budgets-Separated.xlsx',
      sheetName: 'Separated Employees',
    };
  }
  return {
    fileName: 'Employee-Budgets-All.xlsx',
    sheetName: 'All Employees',
  };
}

function BreakdownList({
  title,
  subtitle,
  rows,
  currency,
}: {
  title: string;
  subtitle: string;
  rows: NamedTotal[];
  currency: BudgetCurrency;
}) {
  const maxAmount = Math.max(...rows.map((r) => r.amount), 1);

  return (
    <div className="rounded-[18px] border border-slate-200/90 bg-white p-4 shadow-sm sm:p-5">
      <h3 className="text-base font-semibold text-slate-900">{title}</h3>
      <p className="mt-1 text-sm text-slate-500">{subtitle}</p>
      {rows.length === 0 ? (
        <p className="mt-8 text-center text-sm text-slate-500">No data for this breakdown yet.</p>
      ) : (
        <ul className="mt-5 space-y-3">
          {rows.map((row) => (
            <li key={row.name}>
              <div className="flex items-baseline justify-between gap-3 text-sm">
                <span className="min-w-0 truncate font-medium text-slate-800" title={row.name}>
                  {row.name}
                </span>
                <span className="shrink-0 tabular-nums text-slate-600">
                  {formatCurrency(row.amount, currency)}
                  <span className="ml-2 text-slate-400">· {row.count}</span>
                </span>
              </div>
              <div className="mt-1.5 h-2 overflow-hidden rounded-full bg-slate-100">
                <div
                  className="h-full rounded-full bg-[var(--primary)]"
                  style={{ width: `${Math.max(4, (row.amount / maxAmount) * 100)}%` }}
                />
              </div>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

export default function ReportsPage() {
  const { orgId, membershipRole, isReady } = useAppAuth();
  const canReadBudgets = can(membershipRole, 'budgets', 'read');
  const canReadEmployees = can(membershipRole, 'employees', 'read');

  const [budgets, setBudgets] = useState<BudgetListItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const [exportScope, setExportScope] = useState<EmployeeExportScope>('all');
  const [exportCounts, setExportCounts] = useState<{
    active: number;
    separated: number;
  } | null>(null);
  const [isExporting, setIsExporting] = useState(false);
  const [exportError, setExportError] = useState<string | null>(null);

  useEffect(() => {
    if (!isReady || !orgId || !canReadBudgets) {
      setLoading(false);
      return;
    }
    let cancelled = false;
    void (async () => {
      setLoading(true);
      setError(null);
      try {
        const rows = await fetchBudgets(orgId);
        if (!cancelled) setBudgets(rows);
      } catch (err) {
        if (!cancelled) {
          setError(err instanceof Error ? err.message : 'Failed to load report data.');
          setBudgets([]);
        }
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [isReady, orgId, canReadBudgets]);

  useEffect(() => {
    if (!isReady || !orgId || !canReadEmployees) {
      setExportCounts(null);
      return;
    }
    let cancelled = false;
    void (async () => {
      try {
        const sets = await loadEmployeeExportSets(orgId);
        if (!cancelled) {
          setExportCounts({
            active: sets.active.length,
            separated: sets.separated.length,
          });
        }
      } catch {
        if (!cancelled) setExportCounts(null);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [isReady, orgId, canReadEmployees]);

  const exportScopeCount = useMemo(() => {
    if (!exportCounts) return null;
    if (exportScope === 'active') return exportCounts.active;
    if (exportScope === 'separated') return exportCounts.separated;
    return exportCounts.active + exportCounts.separated;
  }, [exportCounts, exportScope]);

  const handleExportEmployees = async () => {
    if (!orgId || !canReadEmployees || isExporting) return;
    setIsExporting(true);
    setExportError(null);
    try {
      const [sets, budgetRows] = await Promise.all([
        loadEmployeeExportSets(orgId),
        canReadBudgets ? fetchBudgets(orgId) : Promise.resolve([] as BudgetListItem[]),
      ]);
      const employees =
        exportScope === 'active'
          ? sets.active
          : exportScope === 'separated'
            ? sets.separated
            : sortExportRows([...sets.active, ...sets.separated]);

      if (employees.length === 0) {
        throw new Error('No employees found for the selected status.');
      }

      setExportCounts({
        active: sets.active.length,
        separated: sets.separated.length,
      });

      const rows = joinEmployeesWithBudgets(employees, budgetRows);
      const meta = exportFileMeta(exportScope);
      await downloadEmployeeBudgetReportExport(rows, meta);
    } catch (err) {
      setExportError(err instanceof Error ? err.message : 'Employee export failed.');
    } finally {
      setIsExporting(false);
    }
  };

  const currencyTotals = useMemo(() => sumByCurrency(budgets), [budgets]);
  const reportCurrency = useMemo(() => primaryCurrency(currencyTotals), [currencyTotals]);
  const byRegion = useMemo(
    () => topGroups(budgets, (row) => row.region),
    [budgets]
  );
  const byDepartment = useMemo(
    () => topGroups(budgets, (row) => row.department),
    [budgets]
  );
  const byCourse = useMemo(
    () => topGroups(budgets, (row) => row.plannedCourse),
    [budgets]
  );

  const activeEmployees = useMemo(() => {
    const ids = new Set(
      budgets.filter((b) => b.employmentStatus === 'Active').map((b) => b.employeeId)
    );
    return ids.size;
  }, [budgets]);

  if (isReady && !canReadBudgets && !canReadEmployees) {
    return (
      <div className="mx-auto max-w-7xl">
        <div className="rounded-[18px] border border-slate-200/90 bg-white p-4 shadow-sm sm:p-6">
          <h2 className="text-lg font-semibold text-slate-900">Reports</h2>
          <p className="mt-2 text-sm text-slate-600">
            You do not have permission to view reports.
          </p>
        </div>
      </div>
    );
  }

  return (
    <div className="mx-auto max-w-7xl space-y-4">
      <div className="rounded-[18px] border border-slate-200/90 bg-white p-4 shadow-sm sm:p-6">
        <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
          <div>
            <h3 className="text-[18px] font-semibold text-slate-950">Reports</h3>
            <p className="mt-1 text-sm text-slate-500">
              Budget allocation overview and employee exports for Active, Separated, or All staff.
            </p>
          </div>
          {canReadBudgets ? (
            <Link
              href="/budgets"
              className="inline-flex h-9 items-center justify-center rounded-xl border border-slate-200 bg-white px-3 text-sm font-medium text-slate-700 transition-colors hover:bg-slate-50"
            >
              Open Budgets
            </Link>
          ) : null}
        </div>
        <HeaderDivider className="my-4" />
        <p className="text-sm text-slate-600">
          Actual training cost reports will appear here when Training Records are recorded. Until
          then, remaining budget equals the current allocated amount.
        </p>
      </div>

      {canReadEmployees ? (
        <div className="rounded-[18px] border border-slate-200/90 bg-white p-4 shadow-sm sm:p-5">
          <div className="flex flex-col gap-4 lg:flex-row lg:items-end lg:justify-between">
            <div className="min-w-0 flex-1">
              <h3 className="text-base font-semibold text-slate-900">Export employees</h3>
              <p className="mt-1 text-sm text-slate-500">
                Download Excel for Active, Separated, or All employees, including Course title,
                Budget, and Planned date for each allocation.
              </p>
              {exportCounts ? (
                <p className="mt-2 text-sm text-slate-600">
                  Available: {exportCounts.active} active · {exportCounts.separated} separated ·{' '}
                  {exportCounts.active + exportCounts.separated} all
                </p>
              ) : null}
            </div>
            <div className="flex w-full flex-col gap-2 sm:flex-row sm:items-end lg:w-auto">
              <div className="w-full sm:w-56">
                <label className="mb-1.5 block text-sm font-medium text-slate-700" htmlFor="export-scope">
                  Status
                </label>
                <Select
                  value={exportScope}
                  onValueChange={(value) => setExportScope(value as EmployeeExportScope)}
                >
                  <SelectTrigger id="export-scope" className="w-full !rounded-xl">
                    <SelectValue placeholder="Choose status" />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="active">Active</SelectItem>
                    <SelectItem value="separated">Separated</SelectItem>
                    <SelectItem value="all">All</SelectItem>
                  </SelectContent>
                </Select>
              </div>
              <Button
                type="button"
                className="w-full !rounded-xl !bg-[var(--primary)] px-5 py-2.5 !text-sm font-semibold hover:!bg-[var(--primary-hover)] sm:w-auto"
                onClick={() => {
                  void handleExportEmployees();
                }}
                disabled={isExporting || exportScopeCount === 0}
              >
                {isExporting
                  ? 'Exporting…'
                  : exportScopeCount == null
                    ? 'Download Excel'
                    : `Download ${exportScopeCount} employee${exportScopeCount === 1 ? '' : 's'}`}
              </Button>
            </div>
          </div>
          {exportError ? (
            <p className="mt-3 text-sm text-red-700" role="alert">
              {exportError}
            </p>
          ) : null}
        </div>
      ) : null}

      {canReadBudgets ? (
        <>
          {error ? (
            <div className="rounded-[18px] border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-800">
              {error}
            </div>
          ) : null}

          {loading ? (
            <div className="rounded-[18px] border border-slate-200/90 bg-white px-4 py-16 text-center text-sm text-slate-500 shadow-sm">
              Loading report data…
            </div>
          ) : budgets.length === 0 ? (
            <div className="rounded-[18px] border border-slate-200/90 bg-white px-4 py-16 text-center shadow-sm">
              <p className="text-sm font-medium text-slate-800">No budget allocations yet</p>
              <p className="mx-auto mt-2 max-w-md text-sm text-slate-500">
                Import or create budgets to populate these reports.
              </p>
              <Link
                href="/budgets"
                className="mt-4 inline-flex h-9 items-center justify-center rounded-xl bg-[var(--primary)] px-4 text-sm font-semibold text-white hover:bg-[var(--primary-hover)]"
              >
                Go to Budgets
              </Link>
            </div>
          ) : (
            <>
              <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-4">
                <SummaryCard
                  label="Budget allocations"
                  value={String(budgets.length)}
                  hint={`${activeEmployees} active employees with budgets`}
                />
                <SummaryCard
                  label={`Total allocated (${reportCurrency})`}
                  value={formatCurrency(currencyTotals[reportCurrency].current, reportCurrency)}
                  hint="Current amount after adjustments"
                />
                <SummaryCard
                  label={`Remaining (${reportCurrency})`}
                  value={formatCurrency(
                    currencyTotals[reportCurrency].remaining,
                    reportCurrency
                  )}
                  hint="After costs when training is recorded"
                />
                <SummaryCard
                  label="Currencies in use"
                  value={
                    BUDGET_CURRENCIES.filter((c) => currencyTotals[c].count > 0).join(', ') || '—'
                  }
                  hint="AFN, USD, and EUR are supported"
                />
              </div>

              <div className="overflow-hidden rounded-[18px] border border-slate-200/90 bg-white shadow-sm">
                <div className="px-4 py-4 sm:px-5">
                  <h3 className="text-base font-semibold text-slate-900">Totals by currency</h3>
                  <p className="mt-1 text-sm text-slate-500">
                    Allocations are not converted between currencies.
                  </p>
                </div>
                <div className="overflow-x-auto border-t border-slate-200">
                  <table className="min-w-full text-left text-sm text-slate-800">
                    <thead className="bg-slate-50 text-[11px] uppercase tracking-wide text-slate-500">
                      <tr>
                        <th className="px-4 py-2.5 sm:px-5">Currency</th>
                        <th className="px-4 py-2.5 sm:px-5">Allocations</th>
                        <th className="px-4 py-2.5 sm:px-5">Initial</th>
                        <th className="px-4 py-2.5 sm:px-5">Current</th>
                        <th className="px-4 py-2.5 sm:px-5">Remaining</th>
                      </tr>
                    </thead>
                    <tbody>
                      {BUDGET_CURRENCIES.filter((c) => currencyTotals[c].count > 0).map(
                        (currency) => {
                          const row = currencyTotals[currency];
                          return (
                            <tr key={currency} className="border-t border-slate-100">
                              <td className="px-4 py-3 font-medium sm:px-5">{currency}</td>
                              <td className="px-4 py-3 tabular-nums sm:px-5">{row.count}</td>
                              <td className="px-4 py-3 tabular-nums sm:px-5">
                                {formatCurrency(row.initial, currency)}
                              </td>
                              <td className="px-4 py-3 tabular-nums sm:px-5">
                                {formatCurrency(row.current, currency)}
                              </td>
                              <td className="px-4 py-3 tabular-nums sm:px-5">
                                {formatCurrency(row.remaining, currency)}
                              </td>
                            </tr>
                          );
                        }
                      )}
                    </tbody>
                  </table>
                </div>
              </div>

              <div className="grid grid-cols-1 gap-4 lg:grid-cols-3">
                <BreakdownList
                  title="By region"
                  subtitle={`Top regions by current ${reportCurrency} allocation`}
                  rows={byRegion}
                  currency={reportCurrency}
                />
                <BreakdownList
                  title="By department"
                  subtitle={`Top departments by current ${reportCurrency} allocation`}
                  rows={byDepartment}
                  currency={reportCurrency}
                />
                <BreakdownList
                  title="By planned course"
                  subtitle={`Top courses by current ${reportCurrency} allocation`}
                  rows={byCourse}
                  currency={reportCurrency}
                />
              </div>
            </>
          )}
        </>
      ) : null}
    </div>
  );
}

function SummaryCard({
  label,
  value,
  hint,
}: {
  label: string;
  value: string;
  hint: string;
}) {
  return (
    <div className="rounded-[18px] border border-slate-200/90 bg-white p-4 shadow-sm sm:p-5">
      <p className="text-sm font-medium text-slate-500">{label}</p>
      <p className="mt-2 text-2xl font-semibold tracking-tight text-slate-950">{value}</p>
      <p className="mt-2 text-xs text-slate-500">{hint}</p>
    </div>
  );
}
