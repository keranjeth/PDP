export type BudgetCurrency = 'AFN' | 'USD' | 'EUR';

export const BUDGET_CURRENCIES: BudgetCurrency[] = ['AFN', 'USD', 'EUR'];

export type BudgetListItem = {
  id: string;
  budgetCode: string;
  employeeId: string;
  employeeIdNumber: string;
  fullName: string;
  employmentStatus: 'Active' | 'Inactive' | '';
  region: string;
  dutyStation: string;
  jobLocation: string;
  department: string;
  unit: string;
  positionTitle: string;
  plannedCourse: string;
  initialAmount: number;
  currency: string;
  /** YYYY-MM-DD, or empty when not set. */
  plannedCourseStartDate: string;
  currentAmount: number;
  remainingAmount: number;
  hasTransactions: boolean;
};

export type BudgetAdjustDirection = 'increase' | 'decrease';

export type BudgetHistoryEntryType =
  | 'adjustment'
  | 'reallocation_in'
  | 'reallocation_out';

export type BudgetHistoryEntry = {
  id: string;
  type: BudgetHistoryEntryType;
  createdAt: string;
  amount: number;
  currency: string;
  direction?: BudgetAdjustDirection;
  note?: string | null;
  relatedBudgetCode?: string | null;
  performedByName?: string | null;
};

export type CreateBudgetRequest = {
  orgId: string;
  employeeId: string;
  plannedCourse: string;
  initialAmount: number;
  currency: BudgetCurrency;
  plannedCourseStartDate: string;
};

export type UpdateBudgetRequest = {
  orgId: string;
  plannedCourse?: string;
  initialAmount?: number;
  currency?: BudgetCurrency;
  plannedCourseStartDate?: string;
};

export type AdjustBudgetRequest = {
  orgId: string;
  direction: BudgetAdjustDirection;
  amount: number;
  note?: string;
};

export type ReallocateBudgetRequest = {
  orgId: string;
  sourceBudgetId: string;
  destinationBudgetId: string;
  amount: number;
  note?: string;
};

export type BudgetsListResponse = {
  budgets: BudgetListItem[];
};

export type BudgetHistoryResponse = {
  history: BudgetHistoryEntry[];
};
