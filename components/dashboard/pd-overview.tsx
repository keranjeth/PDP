"use client";

import React, { useRef, useState, useSyncExternalStore } from "react";
import Link from "next/link";
import { Cell, Pie, PieChart, ResponsiveContainer } from "recharts";
import { Eye } from "lucide-react";
import {
  DashboardTooltip,
  StatCard,
  formatAmountWithCurrency,
  getViewportTooltipAnchor,
} from "@/components/dashboard/stat-card";
import { CompactDataTable } from "@/components/ui/compact-employee-table";
import { TrainingDetails } from "@/components/training/TrainingDetails";
import { Modal } from "@/components/ui/Modal";
import { BUDGET_CURRENCIES, type BudgetCurrency } from "@/lib/budgets/types";
import { formatCurrency } from "@/lib/format-currency";
import {
  buildPdOverview,
  type DashboardTraining,
  type PdDashboardData,
} from "@/lib/pd-dashboard";

const PRIMARY = "var(--analytics-budget)";
const PRIMARY_SOFT = "var(--analytics-actual)";
const EMPTY_DATA: PdDashboardData = {
  budgets: [],
  totalEmployees: 0,
  actualCostsAvailable: false,
  trainings: [],
};
const noSubscription = () => () => {};
const TRAINING_COLUMNS = [
  { key: "employeeIdNumber", label: "Employee ID" },
  { key: "fullName", label: "Full Name" },
  { key: "courseTitle", label: "Course Title" },
  { key: "trainingDate", label: "Training Date" },
  { key: "actualCost", label: "Total Actual Cost", align: "right" as const },
  { key: "budgetBalance", label: "Budget Balance", align: "right" as const },
];

function compactAmount(value: number, currency: BudgetCurrency) {
  return formatAmountWithCurrency(value, currency === "AFN" ? "؋" : currency);
}
function formatMonthName(short: string) {
  return new Date(
    `2000-${String(["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"].indexOf(short) + 1).padStart(2, "0")}-01T12:00:00Z`,
  ).toLocaleDateString("en-US", { month: "long", timeZone: "UTC" });
}
function trainingDate(value: string) {
  const date = new Date(`${value}T12:00:00Z`);
  return Number.isNaN(date.getTime())
    ? "—"
    : date.toLocaleDateString("en-GB", {
        day: "2-digit",
        month: "short",
        year: "numeric",
        timeZone: "UTC",
      });
}

export function DashboardOverview({
  data = EMPTY_DATA,
  loading = false,
}: {
  data?: PdDashboardData;
  loading?: boolean;
}) {
  const [selectedCurrency, setSelectedCurrency] =
    useState<BudgetCurrency>("AFN");
  const [selectedYear, setSelectedYear] = useState(new Date().getFullYear());
  const [details, setDetails] = useState<DashboardTraining | null>(null);
  const isHydrated = useSyncExternalStore(
    noSubscription,
    () => true,
    () => false,
  );
  const currencies = BUDGET_CURRENCIES.filter(
    (currency) =>
      data.budgets.some((b) => b.currency === currency) ||
      data.trainings.some((t) => t.currency === currency),
  );
  const currency = currencies.includes(selectedCurrency)
    ? selectedCurrency
    : (currencies[0] ?? "AFN");
  const years = [
    ...new Set([
      new Date().getFullYear(),
      ...data.budgets
        .map((b) => Number(b.plannedCourseStartDate.slice(0, 4)))
        .filter((year) => year > 0),
    ]),
  ].sort((a, b) => b - a);
  const overview = buildPdOverview(data, currency, selectedYear);
  const actualUnavailable = overview.actualCost === null;

  return (
    <div className="mx-auto max-w-7xl space-y-4">
      {currencies.length > 1 || years.length > 1 ? (
        <div className="flex justify-end gap-3">
          {years.length > 1 ? (
            <label className="flex items-center gap-2 text-sm text-slate-500">
              Chart year
              <select
                aria-label="Chart year"
                className="rounded-xl border border-slate-200 bg-white px-3 py-2 text-slate-700"
                value={selectedYear}
                onChange={(e) => setSelectedYear(Number(e.target.value))}
              >
                {years.map((year) => (
                  <option key={year}>{year}</option>
                ))}
              </select>
            </label>
          ) : null}
          {currencies.length > 1 ? (
            <label className="flex items-center gap-2 text-sm text-slate-500">
              Currency
              <select
                aria-label="Currency"
                className="rounded-xl border border-slate-200 bg-white px-3 py-2 text-slate-700"
                value={currency}
                onChange={(e) =>
                  setSelectedCurrency(e.target.value as BudgetCurrency)
                }
              >
                {currencies.map((code) => (
                  <option key={code}>{code}</option>
                ))}
              </select>
            </label>
          ) : null}
        </div>
      ) : null}
      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 md:grid-cols-4">
        <StatCard
          title="Total Budget"
          currentValue={overview.totalBudget}
          previousValue={0}
          currency={currency === "AFN" ? "؋" : currency}
          bottomLabel="Current allocation"
          icon="wallet"
          displayValue={
            loading ? "…" : compactAmount(overview.totalBudget, currency)
          }
          showComparison={false}
        />
        <StatCard
          title="Actual Training Cost"
          currentValue={overview.actualCost ?? 0}
          previousValue={0}
          currency={currency === "AFN" ? "؋" : currency}
          bottomLabel={
            actualUnavailable
              ? "Actual costs unavailable"
              : "Total training costs"
          }
          icon="pulse"
          displayValue={
            loading
              ? "…"
              : actualUnavailable
                ? "—"
                : compactAmount(overview.actualCost ?? 0, currency)
          }
          showComparison={false}
        />
        <StatCard
          title="Remaining Budget"
          currentValue={overview.remainingBudget}
          previousValue={0}
          currency={currency === "AFN" ? "؋" : currency}
          bottomLabel="Current budget balance"
          icon="tax"
          displayValue={
            loading ? "…" : compactAmount(overview.remainingBudget, currency)
          }
          showComparison={false}
        />
        <StatCard
          title="Total Employees"
          currentValue={data.totalEmployees}
          previousValue={0}
          currency=""
          valueStyle="exact"
          bottomLabel="All employees"
          icon="piggy"
          displayValue={loading ? "…" : undefined}
          showComparison={false}
        />
      </div>
      <div className="grid grid-cols-1 gap-4 lg:grid-cols-[minmax(0,13fr)_minmax(320px,7fr)]">
        <MonthlyTrainingChart
          data={overview.months}
          year={selectedYear}
          undatedBudget={overview.undatedBudget}
          actualCostsAvailable={data.actualCostsAvailable}
          loading={loading}
          currency={currency}
        />
        <BudgetOverviewChart
          totalBudget={overview.totalBudget}
          actualCost={overview.allocatedActualCost}
          remainingBudget={overview.remainingBudget}
          isHydrated={isHydrated}
          loading={loading}
          currency={currency}
        />
      </div>
      <CompactDataTable<DashboardTraining>
        title="Recent Trainings"
        description="Latest employee training participation and costs"
        rows={overview.recentTrainings}
        columns={TRAINING_COLUMNS}
        emptyMessage="No training records available yet."
        isLoading={loading}
        showEmptyHeaders
        tableMinWidthClassName="min-w-[980px]"
        actions={
          <Link
            href="/training-records"
            className="inline-flex h-9 items-center justify-center rounded-xl border border-slate-200 bg-white px-3 text-sm font-medium text-slate-700 transition-colors hover:bg-slate-50"
          >
            View all
          </Link>
        }
        mobileSummary={{
          title: (row) => row.fullName,
          subtitle: (row) => row.employeeIdNumber,
          avatarChar: (row) => row.fullName.trim().charAt(0).toUpperCase(),
        }}
        mobileExcludeFromGrid={["employeeIdNumber", "fullName"]}
        columnWidthClass={(key) =>
          key === "courseTitle"
            ? "w-[23%]"
            : key === "fullName"
              ? "w-[19%]"
              : ""
        }
        renderCell={(row, key) => {
          if (key === "actualCost")
            return (
              <span className="whitespace-nowrap tabular-nums">
                {formatCurrency(row.actualCost, row.currency)}
              </span>
            );
          if (key === "budgetBalance")
            return (
              <span className="whitespace-nowrap tabular-nums">
                {row.budgetBalance === null
                  ? "—"
                  : formatCurrency(row.budgetBalance, row.currency)}
              </span>
            );
          if (key === "trainingDate")
            return (
              <span className="whitespace-nowrap">
                {trainingDate(row.trainingDate)}
              </span>
            );
          if (key === "fullName")
            return (
              <div className="flex min-w-0 items-center gap-2">
                <span className="flex h-6 w-6 shrink-0 items-center justify-center rounded-full bg-[var(--primary-light)] text-xs text-[var(--primary)]">
                  {row.fullName.trim().charAt(0).toUpperCase()}
                </span>
                <span className="truncate" title={row.fullName}>
                  {row.fullName}
                </span>
              </div>
            );
          return (
            <span
              className="block truncate"
              title={String(row[key as keyof DashboardTraining] ?? "")}
            >
              {String(row[key as keyof DashboardTraining] ?? "—")}
            </span>
          );
        }}
        renderDetailsCell={(row) => (
          <button
            type="button"
            onClick={() => setDetails(row)}
            aria-label={`View training details for ${row.fullName}`}
            className="inline-flex items-center justify-center rounded-md p-1 text-[var(--primary)] hover:bg-[var(--primary-light)] focus-visible:outline-2 focus-visible:outline-[var(--primary)]"
          >
            <Eye className="h-4 w-4" />
          </button>
        )}
      />
      {details?.details ? (
        <TrainingDetails
          record={details.details}
          canEdit={false}
          onEdit={() => {}}
          onClose={() => setDetails(null)}
        />
      ) : (
        <Modal
          isOpen={details !== null}
          onClose={() => setDetails(null)}
          title="Training Details"
        >
          {details ? (
            <dl className="grid grid-cols-1 gap-4 text-sm sm:grid-cols-2">
              {[
                ["Training ID", details.trainingCode],
                ["Employee ID", details.employeeIdNumber],
                ["Full Name", details.fullName],
                ["Course Title", details.courseTitle],
                ["Training Date", trainingDate(details.trainingDate)],
                [
                  "Actual Cost",
                  formatCurrency(details.actualCost, details.currency),
                ],
                [
                  "Budget Balance",
                  details.budgetBalance === null
                    ? "—"
                    : formatCurrency(details.budgetBalance, details.currency),
                ],
              ].map(([label, value]) => (
                <div key={label}>
                  <dt className="text-slate-500">{label}</dt>
                  <dd className="mt-1 font-medium text-slate-900">{value}</dd>
                </div>
              ))}
            </dl>
          ) : null}
        </Modal>
      )}
    </div>
  );
}

function MonthlyTrainingChart({
  data,
  year,
  undatedBudget,
  actualCostsAvailable,
  loading,
  currency,
}: {
  data: ReturnType<typeof buildPdOverview>["months"];
  year: number;
  undatedBudget: number;
  actualCostsAvailable: boolean;
  loading: boolean;
  currency: BudgetCurrency;
}) {
  const containerRef = useRef<HTMLDivElement | null>(null);
  const [hoveredMonth, setHoveredMonth] = useState<{
    viewportX: number;
    viewportY: number;
    placement: "top" | "bottom";
    monthShort: string;
    budget: number;
    actual: number;
  } | null>(null);

  const maxValue = Math.max(
    ...data.flatMap((entry) => [entry.budget, entry.actual]),
    0,
  );

  const getBarHeight = (value: number) => {
    if (maxValue <= 0 || value <= 0) {
      return 0;
    }

    return (value / maxValue) * 100;
  };

  const handleMonthHover = (
    event: React.MouseEvent<HTMLDivElement>,
    entry: (typeof data)[number],
  ) => {
    const monthRect = event.currentTarget.getBoundingClientRect();
    const anchor = getViewportTooltipAnchor(monthRect);

    setHoveredMonth({
      viewportX: anchor.viewportX,
      viewportY: anchor.viewportY,
      placement: anchor.placement,
      monthShort: entry.monthShort,
      budget: entry.budget,
      actual: entry.actual,
    });
  };

  return (
    <div className="rounded-[18px] border border-slate-200/90 bg-white p-4 shadow-sm sm:p-6">
      <div className="mb-4 flex flex-col gap-3 sm:mb-6 sm:flex-row sm:items-start sm:justify-between">
        <div>
          <h3 className="text-lg font-semibold text-slate-900">
            Monthly Training Budget
          </h3>
          <p className="text-sm text-slate-500">{`January - December ${year}`}</p>
        </div>

        <div className="flex flex-wrap items-center gap-4 text-sm sm:gap-6">
          <LegendDot color={PRIMARY} label="Budget" />
          <LegendDot color={PRIMARY_SOFT} label="Actual" />
        </div>
      </div>

      <div
        ref={containerRef}
        className="relative h-60 sm:h-64"
        aria-busy={loading}
        onMouseLeave={() => setHoveredMonth(null)}
      >
        {hoveredMonth ? (
          <DashboardTooltip
            viewportX={hoveredMonth.viewportX}
            viewportY={hoveredMonth.viewportY}
            placement={hoveredMonth.placement}
            title={formatMonthName(hoveredMonth.monthShort)}
            rows={[
              {
                color: PRIMARY,
                label: "Budget",
                value: formatCurrency(hoveredMonth.budget, currency),
              },
              {
                color: PRIMARY_SOFT,
                label: "Total Actual Cost",
                value: actualCostsAvailable
                  ? formatCurrency(hoveredMonth.actual, currency)
                  : "Unavailable",
              },
            ]}
          />
        ) : null}

        <div className="h-full w-full min-h-0">
          <div className="grid h-full min-h-[192px] w-full grid-cols-12 content-end gap-x-2">
            {data.map((entry) => (
              <div
                key={entry.monthShort}
                className="flex min-h-0 min-w-0 flex-col items-stretch justify-end gap-1"
                tabIndex={0}
                role="img"
                aria-label={`${formatMonthName(entry.monthShort)}: Budget ${formatCurrency(entry.budget, currency)}; Actual cost ${actualCostsAvailable ? formatCurrency(entry.actual, currency) : "unavailable"}`}
                onFocus={(event) => {
                  const anchor = getViewportTooltipAnchor(
                    event.currentTarget.getBoundingClientRect(),
                  );
                  setHoveredMonth({
                    ...anchor,
                    monthShort: entry.monthShort,
                    budget: entry.budget,
                    actual: entry.actual,
                  });
                }}
                onBlur={() => setHoveredMonth(null)}
                onMouseMove={(event) => handleMonthHover(event, entry)}
              >
                <div className="flex h-48 w-full items-end justify-center gap-1">
                  <div
                    className="min-h-0 min-w-[10px] max-w-[22px] flex-1 rounded-t-md bg-[var(--analytics-budget)] transition-colors hover:bg-[var(--analytics-budget-hover)]"
                    style={{
                      height: `${getBarHeight(entry.budget)}%`,
                      flexBasis: 0,
                    }}
                  />
                  <div
                    className="min-h-0 min-w-[10px] max-w-[22px] flex-1 rounded-t-md bg-[var(--analytics-actual)] transition-colors hover:bg-[var(--analytics-actual-hover)]"
                    style={{
                      height: `${getBarHeight(entry.actual)}%`,
                      flexBasis: 0,
                    }}
                  />
                </div>
                <span className="w-full truncate text-center text-[10px] font-medium leading-tight text-slate-500 sm:text-[11px]">
                  {entry.monthShort}
                </span>
              </div>
            ))}
          </div>
        </div>
      </div>

      <div className="mt-5 border-t border-slate-200 pt-3">
        <div className="flex items-center justify-between text-sm text-slate-500">
          <span>
            {undatedBudget > 0
              ? "Budget without planned dates"
              : "Actual training cost"}
          </span>
          <span>
            {loading
              ? "…"
              : undatedBudget > 0
                ? compactAmount(undatedBudget, currency)
                : actualCostsAvailable
                  ? "Available"
                  : "Unavailable"}
          </span>
        </div>
      </div>
    </div>
  );
}

function BudgetOverviewChart({
  totalBudget,
  actualCost,
  remainingBudget,
  isHydrated,
  loading,
  currency,
}: {
  totalBudget: number;
  actualCost: number | null;
  remainingBudget: number;
  isHydrated: boolean;
  loading: boolean;
  currency: BudgetCurrency;
}) {
  const chartRef = useRef<HTMLDivElement | null>(null);
  const [hoveredBudget, setHoveredBudget] = useState<{
    viewportX: number;
    viewportY: number;
    placement: "top" | "bottom";
  } | null>(null);

  const budgetAmount = totalBudget;
  const actualAmount = Math.max(0, Math.min(actualCost ?? 0, budgetAmount));
  const remainingAmount = remainingBudget;
  const overlayData = [
    { name: "Actual", amount: actualAmount },
    { name: "Remaining", amount: Math.max(0, budgetAmount - actualAmount) },
  ];
  const formatCurrencyShort = (value: number) =>
    loading ? "…" : compactAmount(value, currency);
  const actualDisplay =
    actualCost === null ? "—" : formatCurrencyShort(actualCost);

  return (
    <div className="rounded-[18px] border border-slate-200/90 bg-white px-4 py-5 shadow-sm sm:px-6 sm:py-6">
      <div className="mb-4 flex flex-col gap-3 sm:mb-6 sm:flex-row sm:items-start sm:justify-between">
        <div>
          <h3 className="text-lg font-semibold text-slate-900">
            Budget Overview
          </h3>
          <p className="text-sm text-slate-500">Current allocation</p>
        </div>
      </div>

      <div className="w-full">
        {isHydrated ? (
          <div className="flex flex-col">
            <div
              ref={chartRef}
              className="relative mx-auto h-[220px] w-full max-w-[320px]"
              onMouseLeave={() => setHoveredBudget(null)}
              onMouseMove={() => {
                const node = chartRef.current;
                if (!node) return;
                const rect = node.getBoundingClientRect();
                const anchor = getViewportTooltipAnchor(rect);
                setHoveredBudget({
                  viewportX: anchor.viewportX,
                  viewportY: anchor.viewportY,
                  placement: anchor.placement,
                });
              }}
            >
              {hoveredBudget ? (
                <DashboardTooltip
                  viewportX={hoveredBudget.viewportX}
                  viewportY={hoveredBudget.viewportY}
                  placement={hoveredBudget.placement}
                  title="Budget Overview"
                  rows={[
                    {
                      color: PRIMARY,
                      label: "Budget",
                      value: formatCurrency(budgetAmount, currency),
                    },
                    {
                      color: PRIMARY_SOFT,
                      label: "Actual",
                      value:
                        actualCost === null
                          ? "Unavailable"
                          : formatCurrency(actualCost, currency),
                    },
                    {
                      color: "rgba(148,163,184,0.75)",
                      label: "Remaining",
                      value: formatCurrency(remainingAmount, currency),
                    },
                  ]}
                />
              ) : null}
              <ResponsiveContainer width="100%" height="100%" minWidth={0}>
                <PieChart>
                  {/* Budget: continuous ring (no seams). */}
                  <Pie
                    isAnimationActive={false}
                    data={[
                      {
                        name: "Budget",
                        amount: budgetAmount > 0 ? budgetAmount : 1,
                      },
                    ]}
                    dataKey="amount"
                    innerRadius={72}
                    outerRadius={92}
                    startAngle={90}
                    endAngle={-270}
                    paddingAngle={0}
                    stroke="none"
                  >
                    <Cell
                      fill={
                        budgetAmount > 0
                          ? PRIMARY
                          : "var(--analytics-legend-muted)"
                      }
                    />
                  </Pie>

                  {/* Actual: overlay arc + transparent remainder (rounded caps, no visible seam). */}
                  <Pie
                    isAnimationActive={false}
                    data={overlayData}
                    dataKey="amount"
                    innerRadius={72}
                    outerRadius={92}
                    startAngle={90}
                    endAngle={-270}
                    paddingAngle={0}
                    stroke="none"
                    cornerRadius={12}
                  >
                    <Cell fill={PRIMARY_SOFT} />
                    <Cell fill="transparent" />
                  </Pie>
                </PieChart>
              </ResponsiveContainer>

              <div className="pointer-events-none absolute inset-0 flex items-center justify-center">
                <div className="text-center">
                  <div className="text-[22px] font-semibold text-slate-900 sm:text-[26px]">
                    {loading ? "…" : compactAmount(budgetAmount, currency)}
                  </div>
                  <div className="mt-0.5 text-sm text-slate-500">
                    Total Budget
                  </div>
                </div>
              </div>
            </div>

            <div className="mt-4 w-full space-y-2">
              <div className="flex items-center justify-between text-sm font-medium text-slate-600">
                <div className="flex items-center gap-2">
                  <span
                    className="h-3 w-3 rounded-full"
                    style={{ backgroundColor: PRIMARY }}
                  />
                  <span>Budget</span>
                </div>
                <span>{formatCurrencyShort(budgetAmount)}</span>
              </div>
              <div className="flex items-center justify-between text-sm font-medium text-slate-600">
                <div className="flex items-center gap-2">
                  <span
                    className="h-3 w-3 rounded-full"
                    style={{ backgroundColor: PRIMARY_SOFT }}
                  />
                  <span>Actual</span>
                </div>
                <span>{actualDisplay}</span>
              </div>
              <div className="flex items-center justify-between border-t border-slate-200 pt-2 text-sm font-medium text-slate-600">
                <span>Remaining</span>
                <span>{formatCurrencyShort(remainingAmount)}</span>
              </div>
            </div>
          </div>
        ) : null}
      </div>
    </div>
  );
}

function LegendDot({ color, label }: { color: string; label: string }) {
  return (
    <div className="flex items-center gap-2.5 text-sm text-slate-600">
      <span
        className="h-3 w-3 rounded-full"
        style={{ backgroundColor: color }}
      />
      <span className="ml-0.5">{label}</span>
    </div>
  );
}
