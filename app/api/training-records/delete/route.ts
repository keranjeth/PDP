import { NextResponse } from "next/server";
import { requireBudgetApiAccess } from "@/lib/budgets/authz";
import { isUuid } from "@/lib/training/validation";

export async function POST(request: Request) {
  try {
    const body = await request.json();
    const orgId = String(body.orgId ?? "");
    const access = await requireBudgetApiAccess(request, orgId, "delete");
    if (!access.ok) return access.response;
    const ids = body.ids;
    if (
      !Array.isArray(ids) ||
      !ids.length ||
      ids.length > 500 ||
      !ids.every(isUuid)
    )
      throw new Error("Select between 1 and 500 training records.");
    const uniqueIds = [...new Set(ids)] as string[];
    // No hard deletion; the database retains the original record and author.
    const { error, count } = await access.sessionClient
      .from("training_records")
      .update({ deleted_at: new Date().toISOString() }, { count: "exact" })
      .eq("org_id", orgId)
      .in("id", uniqueIds)
      .is("deleted_at", null);
    if (error) throw new Error(error.message);
    return NextResponse.json({ deleted: count ?? 0 });
  } catch (error) {
    return NextResponse.json(
      {
        error:
          error instanceof Error ? error.message : "Unable to delete training.",
      },
      { status: 400 },
    );
  }
}
