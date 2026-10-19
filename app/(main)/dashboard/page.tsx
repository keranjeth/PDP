'use client';

import Link from 'next/link';
import { useEffect, useMemo, useState } from 'react';
import { StatCard } from '@/components/dashboard/stat-card';
import { useAppAuth } from '@/components/providers/AppProviders';
import {
  BUDGET_CURRENCIES,
  type BudgetCurrency,
  type BudgetListItem,
} from '@/lib/budgets/types';
import { formatCurrency } from '@/lib/format-currency';
import { employeeStore } from '@/lib/store';
import { can } from '@/lib/user-management/permissions';

async function fetchBudgets(orgId: string): Promise<BudgetListItem[]> {
  const response = await fetch(`/api/budgets?orgId=${encodeURIComponent(orgId)}`);
  if (!response.ok) return [];
  const data = (await response.json()) as { budgets?: BudgetListItem[] };
  return data.budgets ?? [];
}

function sumCurrency(budgets: BudgetListItem[], field: 'currentAmount' | 'remainingAmount') {
  const totals: Record<BudgetCurrency, number> = { AFN: 0, USD: 0, EUR: 0 };
  for (const row of budgets) {
    const currency = (BUDGET_CURRENCIES.includes(row.currency as BudgetCurrency)
      ? row.currency
      : 'AFN') as BudgetCurrency;
    totals[currency] += Number(row[field]) || 0;
  }
  return totals;
}

function primaryCurrency(totals: Record<BudgetCurrency, number>): BudgetCurrency {
  let best: BudgetCurrency = 'AFN';
  let bestAmount = -1;
  for (const currency of BUDGET_CURRENCIES) {
    if (totals[currency] > bestAmount) {
      best = currency;
      bestAmount = totals[currency];
    }
  }
  return best;
}

export default function DashboardPage() {
  const { orgId, membershipRole, isReady } = useAppAuth();
  const isEmployee = membershipRole === 'employee';
  const canReadBudgets = can(membershipRole, 'budgets', 'read');

  const [budgets, setBudgets] = useState<BudgetListItem[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    if (!isReady || !orgId || !canReadBudgets || isEmployee) {
      setLoading(false);
      return;
    }
    let cancelled = false;
    void (async () => {
      setLoading(true);
      try {
        const rows = await fetchBudgets(orgId);
        if (!cancelled) setBudgets(rows);
      } catch {
        if (!cancelled) setBudgets([]);
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [isReady, orgId, canReadBudgets, isEmployee]);

  const currentTotals = useMemo(() => sumCurrency(budgets, 'currentAmount'), [budgets]);
  const remainingTotals = useMemo(() => sumCurrency(budgets, 'remainingAmount'), [budgets]);
  const currency = useMemo(() => primaryCurrency(currentTotals), [currentTotals]);

  const regionRows = useMemo(() => {
    const map = new Map<string, number>();
    for (const row of budgets) {
      const name = row.region.trim() || 'Unspecified';
      map.set(name, (map.get(name) ?? 0) + 1);
    }
    return [...map.entries()]
      .map(([name, count]) => ({ name, count }))
      .sort((a, b) => b.count - a.count)
      .slice(0, 6);
  }, [budgets]);

  if (isEmployee) {
    const self = employeeStore.getEmployees()[0] ?? null;

    return (
      <div className="mx-auto max-w-7xl space-y-4">
        <div className="rounded-[18px] border border-slate-200/90 bg-white p-4 shadow-sm sm:p-6">
          <h3 className="text-lg font-semibold text-slate-900">Welcome back</h3>
          <p className="mt-1 text-sm text-slate-500">
            {self
              ? `Signed in as ${self.fullName}. Use My Profile to review your employee record.`
              : 'Use My Profile to review your employee record when it is linked to your account.'}
          </p>
        </div>
      </div>
    );
  }

  const totalBudgetDisplay = loading
    ? '…'
    : formatCurrency(currentTotals[currency], currency);
  const remainingDisplay = loading
    ? '…'
    : formatCurrency(remainingTotals[currency], currency);

  return (
    <div className="mx-auto max-w-7xl space-y-4">
      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 md:grid-cols-4">
        <StatCard
          title="Total Budget"
          currentValue={currentTotals[currency]}
          previousValue={currentTotals[currency]}
          currency={currency}
          bottomLabel={`${budgets.length} allocations · ${currency}`}
          icon="wallet"
          displayValue={totalBudgetDisplay}
          placeholder={loading || budgets.length === 0}
        />
        <StatCard
          title="Actual Training Cost"
          currentValue={0}
          previousValue={0}
          currency={currency}
          bottomLabel="Available when training records exist"
          icon="pulse"
          displayValue="—"
          placeholder
        />
        <StatCard
          title="Remaining Budget"
          currentValue={remainingTotals[currency]}
          previousValue={remainingTotals[currency]}
          currency={currency}
          bottomLabel="After transfers and costs"
          icon="tax"
          displayValue={remainingDisplay}
          placeholder={loading || budgets.length === 0}
        />
        <StatCard
          title="Budget Allocations"
          currentValue={budgets.length}
          previousValue={budgets.length}
          currency=""
          bottomLabel="Imported and created budgets"
          icon="piggy"
          displayValue={loading ? '…' : String(budgets.length)}
          placeholder={loading || budgets.length === 0}
        />
      </div>

      <div className="grid grid-cols-1 gap-4 lg:grid-cols-[minmax(0,13fr)_minmax(320px,7fr)]">
        <div className="rounded-[18px] border border-slate-200/90 bg-white p-4 shadow-sm sm:p-6">
          <div className="mb-4 flex flex-col gap-3 sm:mb-6 sm:flex-row sm:items-start sm:justify-between">
            <div>
              <h3 className="text-lg font-semibold text-slate-900">Budget vs. Actual Cost</h3>
              <p className="text-sm text-slate-500">
                Approved budgets compared with actual training costs over time
              </p>
            </div>
            <Link
              href="/reports"
              className="text-sm font-medium text-[var(--primary)] hover:underline"
            >
              View reports
            </Link>
          </div>
          <div className="flex h-60 flex-col items-center justify-center gap-2 text-center text-sm text-slate-500 sm:h-64">
            <p>
              Current allocated budget ({currency}):{' '}
              <span className="font-semibold text-slate-800">
                {loading ? '…' : formatCurrency(currentTotals[currency], currency)}
              </span>
            </p>
            <p>Actual training cost will chart here when Training Records are added.</p>
          </div>
        </div>

        <div className="rounded-[18px] border border-slate-200/90 bg-white px-4 py-5 shadow-sm sm:px-6 sm:py-6">
          <div className="mb-4 sm:mb-6">
            <h3 className="text-lg font-semibold text-slate-900">Budgets by Region</h3>
            <p className="text-sm text-slate-500">Allocation count by organizational region</p>
          </div>
          {loading ? (
            <p className="flex h-[220px] items-center justify-center text-sm text-slate-500">
              Loading…
            </p>
          ) : regionRows.length === 0 ? (
            <p className="flex h-[220px] items-center justify-center text-sm text-slate-500">
              Import budgets to see regional activity.
            </p>
          ) : (
            <ul className="space-y-3">
              {regionRows.map((row) => {
                const max = regionRows[0]?.count ?? 1;
                return (
                  <li key={row.name}>
                    <div className="flex items-baseline justify-between gap-2 text-sm">
                      <span className="truncate font-medium text-slate-800">{row.name}</span>
                      <span className="tabular-nums text-slate-600">{row.count}</span>
                    </div>
                    <div className="mt-1.5 h-2 overflow-hidden rounded-full bg-slate-100">
                      <div
                        className="h-full rounded-full bg-[var(--primary)]"
                        style={{ width: `${Math.max(6, (row.count / max) * 100)}%` }}
                      />
                    </div>
                  </li>
                );
              })}
            </ul>
          )}
        </div>
      </div>
    </div>
  );
}
