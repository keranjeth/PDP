import type { BudgetCurrency, BudgetListItem } from "@/lib/budgets/types";

export const DELIVERY_METHODS = ["In Person", "Online", "Hybrid"] as const;
export type DeliveryMethod = (typeof DELIVERY_METHODS)[number];
export type FundingSource = { name: string; amount: number };

export type TrainingInput = {
  employeeId: string;
  budgetId: string | null;
  courseTitle: string;
  deliveryMethod: DeliveryMethod;
  trainingStartDate: string;
  trainingEndDate: string;
  trainingCost: number;
  additionalCost: number;
  additionalCostNote: string;
  currency: BudgetCurrency;
  fundingSources: FundingSource[];
};

export type TrainingRecord = TrainingInput & {
  id: string;
  trainingCode: string;
  employeeIdNumber: string;
  fullName: string;
  gender: string;
  positionTitle: string;
  department: string;
  unit: string;
  region: string;
  dutyStation: string;
  jobLocation: string;
  employmentStatus: "Active" | "Inactive" | "";
  totalActualCost: number;
  budgetCode: string;
  initialBudget: number | null;
  budgetAdjustment: number | null;
  transfersIn: number | null;
  transfersOut: number | null;
  currentBudget: number | null;
  budgetBalance: number | null;
  updatedAt: string;
};

export type TrainingEmployee = {
  id: string;
  idNumber: string;
  fullName: string;
  gender: string;
  positionTitle: string;
  department: string;
  unit: string;
  region: string;
  dutyStation: string;
  jobLocation: string;
  employmentStatus: "Active" | "Inactive" | "";
};
export type TrainingPageData = {
  trainings: TrainingRecord[];
  employees: TrainingEmployee[];
  budgets: BudgetListItem[];
};
