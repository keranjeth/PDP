import type { BudgetListItem } from "@/lib/budgets/types";
import type { TrainingEmployee, TrainingInput, TrainingRecord } from "./types";
import { parseTrainingInput, trainingIdentity } from "./validation";

export type TrainingImportRow = {
  rowNumber: number;
  employeeIdNumber: string;
  budgetCode: string;
  courseTitle: string;
  deliveryMethod: string;
  trainingStartDate: string;
  trainingEndDate: string;
  trainingCost: unknown;
  additionalCost: unknown;
  additionalCostNote: string;
  currency: string;
  fundingSources: unknown;
};
export type TrainingImportIssue = {
  rowNumber: number;
  employeeIdNumber: string;
  courseTitle: string;
  reason: string;
};
export function resolveTrainingImport(
  rows: TrainingImportRow[],
  employees: TrainingEmployee[],
  budgets: BudgetListItem[],
  existing: TrainingRecord[],
) {
  const employeeMap = new Map(employees.map((e) => [e.idNumber, e]));
  const budgetMap = new Map(budgets.map((b) => [b.budgetCode, b]));
  const seen = new Set(existing.map(trainingIdentity));
  const validRows: Array<{
    rowNumber: number;
    training: TrainingInput;
    fullName: string;
  }> = [];
  const issues: TrainingImportIssue[] = [];
  for (const row of rows) {
    try {
      const employeeIdNumber = String(row.employeeIdNumber ?? "").trim();
      if (employeeIdNumber.toLowerCase() === "__pdp_sample__") continue;
      const employee = employeeMap.get(employeeIdNumber);
      if (!employee)
        throw new Error("Employee ID was not found or is outside your access.");
      const code = String(row.budgetCode ?? "").trim();
      const budget = code ? budgetMap.get(code) : null;
      if (code && !budget)
        throw new Error(
          "Training Budget was not found or is outside your access.",
        );
      if (budget && budget.employeeId !== employee.id)
        throw new Error("Training Budget belongs to another employee.");
      const training = parseTrainingInput({
        employeeId: employee.id,
        budgetId: budget?.id ?? null,
        courseTitle:
          String(row.courseTitle ?? "").trim() || budget?.plannedCourse || "",
        deliveryMethod: String(row.deliveryMethod ?? "").trim(),
        trainingStartDate: row.trainingStartDate,
        trainingEndDate: row.trainingEndDate,
        trainingCost: row.trainingCost,
        additionalCost: row.additionalCost === "" ? 0 : row.additionalCost,
        additionalCostNote: row.additionalCostNote,
        currency:
          String(row.currency ?? "")
            .trim()
            .toUpperCase() ||
          budget?.currency ||
          "",
        fundingSources: row.fundingSources,
      });
      if (budget && training.currency !== budget.currency)
        throw new Error("Currency must match the selected training budget.");
      const key = trainingIdentity(training);
      if (seen.has(key))
        throw new Error(
          "Already exists or is repeated in this file. Update the existing training to change its costs.",
        );
      seen.add(key);
      validRows.push({
        rowNumber: row.rowNumber,
        training,
        fullName: employee.fullName,
      });
    } catch (error) {
      issues.push({
        rowNumber: row.rowNumber,
        employeeIdNumber: String(row.employeeIdNumber ?? ""),
        courseTitle: String(row.courseTitle ?? ""),
        reason:
          error instanceof Error ? error.message : "Invalid training row.",
      });
    }
  }
  return { validRows, issues };
}
