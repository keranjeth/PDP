'use client';

import React from 'react';
import { StatCard } from '@/components/dashboard/stat-card';
import { useAppAuth } from '@/components/providers/AppProviders';
import { employeeStore } from '@/lib/store';

const PLACEHOLDER_CARDS = [
  {
    title: 'Total Budget',
    bottomLabel: 'Approved training allocations',
    icon: 'wallet',
  },
  {
    title: 'Actual Training Cost',
    bottomLabel: 'Recorded training costs',
    icon: 'pulse',
  },
  {
    title: 'Remaining Budget',
    bottomLabel: 'After transfers and costs',
    icon: 'tax',
  },
  {
    title: 'Training Records',
    bottomLabel: 'Recorded trainings',
    icon: 'piggy',
  },
] as const;

export default function DashboardPage() {
  const { membershipRole } = useAppAuth();
  const isEmployee = membershipRole === 'employee';

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
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
          {PLACEHOLDER_CARDS.slice(0, 2).map((card) => (
            <StatCard
              key={card.title}
              title={card.title}
              currentValue={0}
              previousValue={0}
              currency=""
              bottomLabel={card.bottomLabel}
              icon={card.icon}
              displayValue="—"
              placeholder
            />
          ))}
        </div>
      </div>
    );
  }

  return (
    <div className="mx-auto max-w-7xl space-y-4">
      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 md:grid-cols-4">
        {PLACEHOLDER_CARDS.map((card) => (
          <StatCard
            key={card.title}
            title={card.title}
            currentValue={0}
            previousValue={0}
            currency=""
            bottomLabel={card.bottomLabel}
            icon={card.icon}
            displayValue="—"
            placeholder
          />
        ))}
      </div>

      <div className="grid grid-cols-1 gap-4 lg:grid-cols-[minmax(0,13fr)_minmax(320px,7fr)]">
        <BudgetVsActualChart />
        <TrainingByRegionChart />
      </div>
    </div>
  );
}

function BudgetVsActualChart() {
  return (
    <div className="rounded-[18px] border border-slate-200/90 bg-white p-4 shadow-sm sm:p-6">
      <div className="mb-4 flex flex-col gap-3 sm:mb-6 sm:flex-row sm:items-start sm:justify-between">
        <div>
          <h3 className="text-lg font-semibold text-slate-900">Budget vs. Actual Cost</h3>
          <p className="text-sm text-slate-500">
            Approved budgets compared with actual training costs over time
          </p>
        </div>
        <div className="flex flex-wrap items-center gap-4 text-sm sm:gap-6">
          <LegendDot color="var(--analytics-budget)" label="Budget" />
          <LegendDot color="var(--analytics-actual)" label="Actual" />
        </div>
      </div>

      <div className="flex h-60 items-center justify-center text-sm text-slate-500 sm:h-64">
        Chart data will appear when budget and expense records are available.
      </div>
    </div>
  );
}

function TrainingByRegionChart() {
  return (
    <div className="rounded-[18px] border border-slate-200/90 bg-white px-4 py-5 shadow-sm sm:px-6 sm:py-6">
      <div className="mb-4 sm:mb-6">
        <h3 className="text-lg font-semibold text-slate-900">Training by Region</h3>
        <p className="text-sm text-slate-500">Training activity by organizational region</p>
      </div>

      <div className="flex h-[220px] items-center justify-center text-sm text-slate-500">
        Regional training activity will appear when training records are available.
      </div>
    </div>
  );
}

function LegendDot({ color, label }: { color: string; label: string }) {
  return (
    <div className="flex items-center gap-2.5 text-sm text-slate-600">
      <span className="h-3 w-3 rounded-full" style={{ backgroundColor: color }} />
      <span className="ml-0.5">{label}</span>
    </div>
  );
}
