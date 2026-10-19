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

export type TrainingImportValidRow = {
  rowNumber: number;
  training: TrainingInput;
  fullName: string;
  /** When true, import API creates a budget allocation before saving the training. */
  createBudget: boolean;
  budgetSeed: {
    plannedCourse: string;
    amount: number;
    currency: string;
    plannedCourseStartDate: string;
  } | null;
};

function normalizeCourse(value: string) {
  return value.trim().toLowerCase().replace(/\s+/g, " ");
}

export function resolveTrainingImport(
  rows: TrainingImportRow[],
  employees: TrainingEmployee[],
  budgets: BudgetListItem[],
  existing: TrainingRecord[],
) {
  const employeeMap = new Map(employees.map((e) => [e.idNumber, e]));
  const budgetMap = new Map(budgets.map((b) => [b.budgetCode, b]));
  const seen = new Set(existing.map(trainingIdentity));
  const validRows: TrainingImportValidRow[] = [];
  const issues: TrainingImportIssue[] = [];

  for (const row of rows) {
    try {
      const employeeIdNumber = String(row.employeeIdNumber ?? "").trim();
      if (employeeIdNumber.toLowerCase() === "__pdp_sample__") continue;
      const employee = employeeMap.get(employeeIdNumber);
      if (!employee) {
        throw new Error("Employee ID was not found or is outside your access.");
      }

      const code = String(row.budgetCode ?? "").trim();
      let budget = code ? budgetMap.get(code) ?? null : null;
      let createBudget = false;

      if (code && !budget) {
        throw new Error(
          "Budget ID was not found or is outside your access.",
        );
      }
      if (budget && budget.employeeId !== employee.id) {
        throw new Error("Budget ID belongs to another employee.");
      }

      const courseTitle =
        String(row.courseTitle ?? "").trim() || budget?.plannedCourse || "";
      const currency =
        String(row.currency ?? "")
          .trim()
          .toUpperCase() ||
        budget?.currency ||
        "";

      // No Budget ID: reuse matching allocation or create one on import.
      if (!budget) {
        if (!courseTitle) {
          throw new Error(
            "Course Title is required when Budget ID is blank (a budget will be created).",
          );
        }
        if (!currency) {
          throw new Error(
            "Currency is required when Budget ID is blank (a budget will be created).",
          );
        }
        const start = String(row.trainingStartDate ?? "").trim();
        const match = budgets.find(
          (b) =>
            b.employeeId === employee.id &&
            normalizeCourse(b.plannedCourse) === normalizeCourse(courseTitle) &&
            (b.plannedCourseStartDate || "") === start,
        );
        if (match) {
          budget = match;
        } else {
          createBudget = true;
        }
      }

      const training = parseTrainingInput({
        employeeId: employee.id,
        budgetId: budget?.id ?? null,
        courseTitle,
        deliveryMethod: String(row.deliveryMethod ?? "").trim(),
        trainingStartDate: row.trainingStartDate,
        trainingEndDate: row.trainingEndDate,
        trainingCost: row.trainingCost,
        additionalCost: row.additionalCost === "" ? 0 : row.additionalCost,
        additionalCostNote: row.additionalCostNote,
        currency,
        fundingSources: row.fundingSources,
      });

      if (budget && training.currency !== budget.currency) {
        throw new Error("Currency must match the selected training budget.");
      }

      const key = trainingIdentity(training);
      if (seen.has(key)) {
        throw new Error(
          "Already exists or is repeated in this file. Update the existing training to change its costs.",
        );
      }
      seen.add(key);

      validRows.push({
        rowNumber: row.rowNumber,
        training,
        fullName: employee.fullName,
        createBudget,
        budgetSeed: createBudget
          ? {
              plannedCourse: training.courseTitle,
              amount: training.trainingCost,
              currency: training.currency,
              plannedCourseStartDate: training.trainingStartDate,
            }
          : null,
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
