import {
  DELIVERY_METHODS,
  type TrainingInput,
  type FundingSource,
} from "./types";

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
export function isUuid(value: unknown): value is string {
  return typeof value === "string" && UUID.test(value);
}
export function validCalendarDate(value: unknown): value is string {
  if (typeof value !== "string" || !/^\d{4}-\d{2}-\d{2}$/.test(value))
    return false;
  const date = new Date(`${value}T12:00:00Z`);
  return (
    !Number.isNaN(date.getTime()) && date.toISOString().slice(0, 10) === value
  );
}
export function money(value: unknown, label: string): number {
  if (
    value === "" ||
    value === null ||
    value === undefined ||
    typeof value === "boolean"
  )
    throw new Error(`${label} is required.`);
  const amount = Number(value);
  if (
    !Number.isFinite(amount) ||
    amount < 0 ||
    amount > 999999999999.99 ||
    Math.abs(amount * 100 - Math.round(amount * 100)) > 0.0001
  )
    throw new Error(
      `${label} must be a non-negative amount with up to two decimal places.`,
    );
  return Math.round(amount * 100) / 100;
}
export function parseTrainingInput(value: unknown): TrainingInput {
  if (!value || typeof value !== "object" || Array.isArray(value))
    throw new Error("Training details are required.");
  const row = value as Record<string, unknown>;
  if (!isUuid(row.employeeId)) throw new Error("Choose an employee.");
  if (row.budgetId && !isUuid(row.budgetId))
    throw new Error("Choose a valid training budget.");
  const title = String(row.courseTitle ?? "").trim();
  if (!title || title.length > 500)
    throw new Error("Course Title is required (up to 500 characters).");
  if (
    !DELIVERY_METHODS.includes(
      row.deliveryMethod as TrainingInput["deliveryMethod"],
    )
  )
    throw new Error(
      "Choose In Person, Online, Hybrid, Internal, or External.",
    );
  if (
    !validCalendarDate(row.trainingStartDate) ||
    !validCalendarDate(row.trainingEndDate)
  )
    throw new Error("Valid training start and end dates are required.");
  if (row.trainingEndDate < row.trainingStartDate)
    throw new Error("Training End Date cannot be before Training Start Date.");
  const trainingCost = money(row.trainingCost, "Training Cost");
  const additionalCost = money(row.additionalCost ?? 0, "Additional Cost");
  money(trainingCost + additionalCost, "Total Actual Cost");
  const additionalCostNote = String(row.additionalCostNote ?? "").trim();
  if (additionalCost > 0 && !additionalCostNote)
    throw new Error("Add a short note for the additional cost.");
  if (additionalCostNote.length > 2000)
    throw new Error("Additional Cost Note must be 2,000 characters or fewer.");
  if (!["AFN", "USD", "EUR"].includes(String(row.currency)))
    throw new Error("Choose AFN, USD, or EUR.");
  if (row.fundingSources !== undefined && !Array.isArray(row.fundingSources))
    throw new Error("Funding Sources must be a list.");
  const fundingSources: FundingSource[] = (
    (row.fundingSources as unknown[]) ?? []
  ).map((source) => {
    if (!source || typeof source !== "object")
      throw new Error("Each funding source needs a name and amount.");
    const item = source as Record<string, unknown>;
    const name = String(item.name ?? "").trim();
    if (!name || name.length > 200)
      throw new Error(
        "Funding Source name is required (up to 200 characters).",
      );
    return { name, amount: money(item.amount, "Funding Amount") };
  });
  if (fundingSources.length > 20)
    throw new Error("Use up to 20 funding sources per training.");
  if (
    new Set(fundingSources.map((s) => s.name.toLowerCase())).size !==
    fundingSources.length
  )
    throw new Error("Use each funding source once.");
  if (
    fundingSources.length &&
    Math.round(fundingSources.reduce((sum, s) => sum + s.amount, 0) * 100) !==
      Math.round((trainingCost + additionalCost) * 100)
  )
    throw new Error("Funding amounts must equal Total Actual Cost.");
  return {
    employeeId: row.employeeId,
    budgetId: row.budgetId ? String(row.budgetId) : null,
    courseTitle: title,
    deliveryMethod: row.deliveryMethod as TrainingInput["deliveryMethod"],
    trainingStartDate: row.trainingStartDate,
    trainingEndDate: row.trainingEndDate,
    trainingCost,
    additionalCost,
    additionalCostNote,
    currency: row.currency as TrainingInput["currency"],
    fundingSources,
  };
}
export function trainingToRow(input: TrainingInput, orgId: string) {
  return {
    org_id: orgId,
    employee_id: input.employeeId,
    budget_id: input.budgetId,
    course_title: input.courseTitle,
    delivery_method: input.deliveryMethod,
    training_start_date: input.trainingStartDate,
    training_end_date: input.trainingEndDate,
    training_cost: input.trainingCost,
    additional_cost: input.additionalCost,
    additional_cost_note: input.additionalCostNote,
    currency: input.currency,
    funding_sources: input.fundingSources,
  };
}
export function trainingIdentity(
  row: Pick<
    TrainingInput,
    "employeeId" | "courseTitle" | "trainingStartDate" | "trainingEndDate"
  >,
) {
  return JSON.stringify([
    row.employeeId,
    row.courseTitle.trim().toLowerCase(),
    row.trainingStartDate,
    row.trainingEndDate,
  ]);
}
