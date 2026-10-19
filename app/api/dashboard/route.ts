import { NextResponse } from "next/server";
import { requireBudgetApiAccess } from "@/lib/budgets/authz";
import { mapBudgetListItem } from "@/lib/budgets/map";
import type { PdDashboardData } from "@/lib/pd-dashboard";
import { readAllPages } from "@/lib/supabase/read-all-pages";

export async function GET(request: Request) {
  const orgId = new URL(request.url).searchParams.get("orgId")?.trim() ?? "";
  const access = await requireBudgetApiAccess(request, orgId, "read");
  if (!access.ok) return access.response;

  try {
    // Every query uses the caller's session and existing organization/region RLS.
    const client = access.sessionClient;
    const [budgetRows, employees, leavers] = await Promise.all([
      readAllPages((from, to) =>
        client
          .from("v_employee_budget_list")
          .select(
            "id,budget_code,employee_id,planned_course,initial_amount,currency,planned_course_start_date,current_amount,remaining_amount,has_transactions,employee_id_number,full_name,employment_status,region,duty_station,job_location,department,unit,designation",
          )
          .eq("org_id", orgId)
          .order("id")
          .range(from, to),
      ),
      readAllPages<{ id: string }>((from, to) =>
        client
          .from("employees")
          .select("id")
          .eq("org_id", orgId)
          .is("deleted_at", null)
          .order("id")
          .range(from, to),
      ),
      readAllPages<{ employee_id: string; leaver_id: string }>((from, to) =>
        client
          .from("leavers")
          .select("employee_id,leaver_id")
          .eq("org_id", orgId)
          .is("deleted_at", null)
          .order("leaver_id")
          .range(from, to),
      ),
    ]);
    const employeeIds = new Set([
      ...employees.map((row) => String(row.id)),
      ...leavers.map((row) => String(row.employee_id)),
    ]);
    const result: PdDashboardData = {
      budgets: (
        budgetRows as unknown as Array<Parameters<typeof mapBudgetListItem>[0]>
      ).map((row) => mapBudgetListItem(row)),
      totalEmployees: employeeIds.size,
      actualCostsAvailable: false,
      trainings: [],
    };
    return NextResponse.json(result, {
      headers: { "Cache-Control": "private, no-store" },
    });
  } catch (error) {
    return NextResponse.json(
      {
        error:
          error instanceof Error
            ? error.message
            : "Unable to load the overview.",
      },
      { status: 500 },
    );
  }
}
