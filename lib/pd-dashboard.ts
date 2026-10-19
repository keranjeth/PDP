import type { BudgetCurrency, BudgetListItem } from "@/lib/budgets/types";

import type { TrainingRecord } from "@/lib/training/types";

export type DashboardTraining = {
  details?: TrainingRecord;
  id: string;
  trainingCode: string;
  employeeIdNumber: string;
  fullName: string;
  courseTitle: string;
  trainingDate: string;
  actualCost: number;
  budgetBalance: number | null;
  currency: BudgetCurrency;
};

export type PdDashboardData = {
  budgets: BudgetListItem[];
  totalEmployees: number;
  // False only when the training data source is unavailable.
  actualCostsAvailable: boolean;
  trainings: DashboardTraining[];
};

export const MONTHS = [
  "Jan",
  "Feb",
  "Mar",
  "Apr",
  "May",
  "Jun",
  "Jul",
  "Aug",
  "Sep",
  "Oct",
  "Nov",
  "Dec",
];

export function buildPdOverview(
  data: PdDashboardData,
  currency: BudgetCurrency,
  year: number,
) {
  const budgets = data.budgets.filter((row) => row.currency === currency);
  const trainings = data.trainings.filter((row) => row.currency === currency);
  const months = MONTHS.map((monthShort) => ({
    monthShort,
    budget: 0,
    actual: 0,
  }));
  let undatedBudget = 0;

  for (const row of budgets) {
    const match = /^(\d{4})-(\d{2})-\d{2}$/.exec(row.plannedCourseStartDate);
    const monthIndex = match ? Number(match[2]) - 1 : -1;
    if (!match || monthIndex < 0 || monthIndex > 11) {
      undatedBudget += row.currentAmount;
    } else if (Number(match[1]) === year) {
      months[monthIndex].budget += row.currentAmount;
    }
  }

  for (const row of trainings) {
    const match = /^(\d{4})-(\d{2})-\d{2}$/.exec(row.trainingDate);
    if (match && Number(match[1]) === year) {
      const monthIndex = Number(match[2]) - 1;
      if (monthIndex >= 0 && monthIndex < 12)
        months[monthIndex].actual += row.actualCost;
    }
  }

  return {
    months,
    undatedBudget,
    // These are current allocation balances, not inferred financial-year totals.
    totalBudget: budgets.reduce((sum, row) => sum + row.currentAmount, 0),
    remainingBudget: budgets.reduce((sum, row) => sum + row.remainingAmount, 0),
    allocatedActualCost: data.actualCostsAvailable
      ? budgets.reduce(
          (sum, row) => sum + row.currentAmount - row.remainingAmount,
          0,
        )
      : null,
    actualCost: data.actualCostsAvailable
      ? trainings.reduce((sum, row) => sum + row.actualCost, 0)
      : null,
    recentTrainings: [...trainings]
      .sort(
        (a, b) =>
          b.trainingDate.localeCompare(a.trainingDate) ||
          a.id.localeCompare(b.id),
      )
      .slice(0, 5),
  };
}
