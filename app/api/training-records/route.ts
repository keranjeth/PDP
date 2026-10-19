import { NextResponse } from "next/server";
import { requireBudgetApiAccess } from "@/lib/budgets/authz";
import { listTrainings } from "@/lib/training/server";
import { loadTrainingPage } from "@/lib/training/page-data";
import {
  isUuid,
  parseTrainingInput,
  trainingToRow,
} from "@/lib/training/validation";

export async function GET(request: Request) {
  const orgId = new URL(request.url).searchParams.get("orgId")?.trim() ?? "";
  const access = await requireBudgetApiAccess(request, orgId, "read");
  if (!access.ok) return access.response;
  try {
    const data =
      new URL(request.url).searchParams.get("recordsOnly") === "true"
        ? { trainings: await listTrainings(access.sessionClient, orgId) }
        : await loadTrainingPage(access.sessionClient, orgId);
    return NextResponse.json(data, {
      headers: { "Cache-Control": "private, no-store" },
    });
  } catch (error) {
    return NextResponse.json(
      {
        error:
          error instanceof Error
            ? error.message
            : "Unable to load training records.",
      },
      { status: 500 },
    );
  }
}
export async function POST(request: Request) {
  try {
    const body = await request.json();
    const orgId = String(body.orgId ?? "");
    const access = await requireBudgetApiAccess(request, orgId, "create");
    if (!access.ok) return access.response;
    const input = parseTrainingInput(body.training);
    const id = body.requestId;
    if (!isUuid(id)) throw new Error("A valid request ID is required.");
    const { data, error } = await access.sessionClient
      .from("training_records")
      .insert({ id, ...trainingToRow(input, orgId) })
      .select("id,training_code")
      .single();
    if (error) {
      if (error.code === "23505") {
        // A retried request returns its own previous success, without adding the cost twice.
        const previous = await access.sessionClient
          .from("training_records")
          .select("*")
          .eq("org_id", orgId)
          .eq("id", id)
          .eq("created_by", access.user.id)
          .is("deleted_at", null)
          .maybeSingle();
        if (!previous.error && previous.data) {
          const expected = trainingToRow(input, orgId);
          const same = Object.entries(expected).every(
            ([key, value]) =>
              JSON.stringify(previous.data[key]) === JSON.stringify(value),
          );
          if (!same)
            return NextResponse.json(
              {
                error:
                  "This request was already saved with different details. Reload the training before editing it.",
              },
              { status: 409 },
            );
          return NextResponse.json({
            id: previous.data.id,
            training_code: previous.data.training_code,
          });
        }
        return NextResponse.json(
          {
            error:
              "This employee already has this course for these training dates. Open the existing training to update its costs.",
          },
          { status: 409 },
        );
      }
      throw new Error(error.message);
    }
    return NextResponse.json(data, { status: 201 });
  } catch (error) {
    return NextResponse.json(
      {
        error:
          error instanceof Error ? error.message : "Unable to save training.",
      },
      { status: 400 },
    );
  }
}
