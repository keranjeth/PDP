import { NextResponse } from "next/server";
import { requireBudgetApiAccess } from "@/lib/budgets/authz";
import {
  isUuid,
  parseTrainingInput,
  trainingToRow,
} from "@/lib/training/validation";

export async function PATCH(
  request: Request,
  context: { params: Promise<{ id: string }> },
) {
  try {
    const { id } = await context.params;
    const body = await request.json();
    const orgId = String(body.orgId ?? "");
    const access = await requireBudgetApiAccess(request, orgId, "update");
    if (!access.ok) return access.response;
    if (!isUuid(id)) throw new Error("Invalid Training ID.");
    const input = parseTrainingInput(body.training);
    if (typeof body.updatedAt !== "string" || !body.updatedAt)
      throw new Error("Reload the training before editing it.");
    const { data, error } = await access.sessionClient
      .from("training_records")
      .update(trainingToRow(input, orgId))
      .eq("org_id", orgId)
      .eq("id", id)
      .eq("updated_at", body.updatedAt)
      .is("deleted_at", null)
      .select("id")
      .maybeSingle();
    if (error)
      throw new Error(
        error.code === "23505"
          ? "Another training already exists for this employee, course, and dates."
          : error.message,
      );
    if (!data)
      return NextResponse.json(
        {
          error:
            "This training changed or is no longer available. Reload it before saving.",
        },
        { status: 409 },
      );
    return NextResponse.json({ id });
  } catch (error) {
    return NextResponse.json(
      {
        error:
          error instanceof Error ? error.message : "Unable to update training.",
      },
      { status: 400 },
    );
  }
}
