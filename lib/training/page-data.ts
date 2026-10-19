import type { SupabaseClient } from "@supabase/supabase-js";
import { mapBudgetListItem } from "@/lib/budgets/map";
import { readAllPages } from "@/lib/supabase/read-all-pages";
import { listTrainings } from "./server";
import type { TrainingPageData, TrainingEmployee } from "./types";

export async function loadTrainingPage(
  client: SupabaseClient,
  orgId: string,
): Promise<TrainingPageData> {
  const [trainings, budgetRows, employeeRows] = await Promise.all([
    listTrainings(client, orgId),
    readAllPages((from, to) =>
      client
        .from("v_employee_budget_list")
        .select("*")
        .eq("org_id", orgId)
        .order("id")
        .range(from, to),
    ),
    readAllPages<Record<string, unknown>>((from, to) =>
      client
        .from("employees")
        .select(
          "id,id_number,full_name,gender,designation,department,unit,region,duty_station,job_location,employment_status",
        )
        .eq("org_id", orgId)
        .is("deleted_at", null)
        .order("id")
        .range(from, to),
    ),
  ]);
  const employees: TrainingEmployee[] = employeeRows.map((row) => ({
    id: String(row.id),
    idNumber: String(row.id_number ?? ""),
    fullName: String(row.full_name ?? ""),
    gender:
      row.gender === "male" ? "Male" : row.gender === "female" ? "Female" : "",
    positionTitle: String(row.designation ?? ""),
    department: String(row.department ?? ""),
    unit: String(row.unit ?? ""),
    region: String(row.region ?? ""),
    dutyStation: String(row.duty_station ?? ""),
    jobLocation: String(row.job_location ?? ""),
    employmentStatus:
      row.employment_status === "active"
        ? "Active"
        : row.employment_status === "inactive"
          ? "Inactive"
          : "",
  }));
  employees.sort((a, b) => a.fullName.localeCompare(b.fullName));
  return {
    trainings,
    employees,
    budgets: (
      budgetRows as unknown as Parameters<typeof mapBudgetListItem>[0][]
    ).map((r) => mapBudgetListItem(r)),
  };
}
