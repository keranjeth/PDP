import type { SupabaseClient } from "@supabase/supabase-js";
import { readAllPages } from "@/lib/supabase/read-all-pages";
import type { TrainingRecord, TrainingInput, FundingSource } from "./types";

type TrainingViewRow = Record<string, unknown>;
const text = (value: unknown) => String(value ?? "");
const nullableMoney = (value: unknown) =>
  value == null ? null : Number(value);
export function mapTraining(row: TrainingViewRow): TrainingRecord {
  const status = text(row.employment_status);
  return {
    id: text(row.id),
    trainingCode: text(row.training_code),
    employeeId: text(row.employee_id),
    budgetId: row.budget_id ? text(row.budget_id) : null,
    employeeIdNumber: text(row.employee_id_number),
    fullName: text(row.full_name),
    gender:
      text(row.gender) === "male"
        ? "Male"
        : text(row.gender) === "female"
          ? "Female"
          : text(row.gender),
    positionTitle: text(row.designation),
    department: text(row.department),
    unit: text(row.unit),
    region: text(row.region),
    dutyStation: text(row.duty_station),
    jobLocation: text(row.job_location),
    employmentStatus:
      status === "active" ? "Active" : status === "inactive" ? "Inactive" : "",
    courseTitle: text(row.course_title),
    deliveryMethod: text(
      row.delivery_method,
    ) as TrainingInput["deliveryMethod"],
    trainingStartDate: text(row.training_start_date).slice(0, 10),
    trainingEndDate: text(row.training_end_date).slice(0, 10),
    trainingCost: Number(row.training_cost),
    additionalCost: Number(row.additional_cost),
    additionalCostNote: text(row.additional_cost_note),
    totalActualCost: Number(row.total_actual_cost),
    currency: text(row.currency) as TrainingInput["currency"],
    fundingSources: (row.funding_sources ?? []) as FundingSource[],
    budgetCode: text(row.budget_code),
    initialBudget: nullableMoney(row.initial_budget),
    budgetAdjustment: nullableMoney(row.budget_adjustment),
    transfersIn: nullableMoney(row.transfers_in),
    transfersOut: nullableMoney(row.transfers_out),
    currentBudget: nullableMoney(row.current_budget),
    budgetBalance: nullableMoney(row.budget_balance),
    updatedAt: text(row.updated_at),
  };
}
export async function listTrainings(
  client: SupabaseClient,
  orgId: string,
): Promise<TrainingRecord[]> {
  const rows = await readAllPages<TrainingViewRow>((from, to) =>
    client
      .from("v_training_record_list")
      .select("*")
      .eq("org_id", orgId)
      .order("id")
      .range(from, to),
  );
  return rows.map(mapTraining);
}
