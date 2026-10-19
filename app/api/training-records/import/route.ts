import { NextResponse } from "next/server";
import { requireBudgetApiAccess } from "@/lib/budgets/authz";
import { loadTrainingPage } from "@/lib/training/page-data";
import {
  resolveTrainingImport,
  type TrainingImportRow,
} from "@/lib/training/import";
import { trainingToRow } from "@/lib/training/validation";

export async function POST(request: Request) {
  try {
    const body = await request.json();
    const orgId = String(body.orgId ?? "");
    const access = await requireBudgetApiAccess(request, orgId, "create");
    if (!access.ok) return access.response;
    if (
      !Array.isArray(body.rows) ||
      !body.rows.length ||
      body.rows.length > 2000
    ) {
      throw new Error("Import between 1 and 2,000 rows at a time.");
    }
    if (
      body.rows.some(
        (r: unknown) => !r || typeof r !== "object" || Array.isArray(r),
      )
    ) {
      throw new Error("Each import row must contain training details.");
    }

    const source = await loadTrainingPage(access.sessionClient, orgId);
    const preview = resolveTrainingImport(
      body.rows as TrainingImportRow[],
      source.employees,
      source.budgets,
      source.trainings,
    );

    if (body.action === "preview") {
      return NextResponse.json({
        ...preview,
        budgetsToCreate: preview.validRows.filter((r) => r.createBudget).length,
      });
    }
    if (body.action !== "import") throw new Error("Choose preview or import.");

    if (!preview.validRows.length) {
      return NextResponse.json({
        imported: 0,
        skipped: 0,
        budgetsCreated: 0,
        issues: preview.issues,
      });
    }

    let budgetsCreated = 0;
    for (const row of preview.validRows) {
      if (!row.createBudget || !row.budgetSeed) continue;
      const { data: budgetId, error: budgetErr } =
        await access.sessionClient.rpc("create_employee_budget", {
          p_org_id: orgId,
          p_employee_id: row.training.employeeId,
          p_planned_course: row.budgetSeed.plannedCourse,
          p_initial_amount: row.budgetSeed.amount,
          p_currency: row.budgetSeed.currency,
          p_planned_course_start_date: row.budgetSeed.plannedCourseStartDate,
        });
      if (budgetErr) {
        throw new Error(
          `Row ${row.rowNumber}: Unable to create budget — ${budgetErr.message}`,
        );
      }
      row.training.budgetId = String(budgetId);
      budgetsCreated += 1;
    }

    const { data, error } = await access.sessionClient.rpc(
      "import_training_records",
      {
        p_org_id: orgId,
        p_rows: preview.validRows.map((r) => trainingToRow(r.training, orgId)),
      },
    );
    if (error) throw new Error(error.message);

    return NextResponse.json({
      ...data,
      budgetsCreated,
      issues: preview.issues,
    });
  } catch (error) {
    return NextResponse.json(
      {
        error:
          error instanceof Error
            ? error.message
            : "Unable to import training records.",
      },
      { status: 400 },
    );
  }
}
