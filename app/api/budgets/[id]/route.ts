import { NextResponse } from 'next/server';
import { requireBudgetApiAccess } from '@/lib/budgets/authz';
import type { UpdateBudgetRequest } from '@/lib/budgets/types';

function isIsoDateOnly(value: string) {
  return /^\d{4}-\d{2}-\d{2}$/.test(value);
}

export async function PATCH(
  request: Request,
  context: { params: Promise<{ id: string }> }
) {
  const { id: budgetId } = await context.params;
  let body: UpdateBudgetRequest | null = null;
  try {
    body = (await request.json()) as UpdateBudgetRequest;
  } catch {
    return NextResponse.json({ error: 'Invalid JSON body.' }, { status: 400 });
  }

  const orgId = String(body?.orgId ?? '').trim();
  const access = await requireBudgetApiAccess(request, orgId, 'update');
  if (!access.ok) return access.response;

  if (!budgetId) {
    return NextResponse.json({ error: 'Budget id is required.' }, { status: 400 });
  }

  const plannedCourse =
    body?.plannedCourse !== undefined ? String(body.plannedCourse).trim() : null;
  const plannedCourseStartDate =
    body?.plannedCourseStartDate !== undefined
      ? String(body.plannedCourseStartDate).trim()
      : null;
  const currency =
    body?.currency !== undefined ? String(body.currency).trim().toUpperCase() : null;

  let initialAmount: number | null = null;
  if (body?.initialAmount !== undefined) {
    initialAmount = Number(body.initialAmount);
    if (!Number.isFinite(initialAmount) || initialAmount < 0) {
      return NextResponse.json(
        { error: 'initialAmount must be a non-negative number.' },
        { status: 400 }
      );
    }
  }

  if (plannedCourseStartDate && !isIsoDateOnly(plannedCourseStartDate)) {
    return NextResponse.json(
      { error: 'plannedCourseStartDate must be YYYY-MM-DD.' },
      { status: 400 }
    );
  }

  const { error } = await access.sessionClient.rpc('update_employee_budget_details', {
    p_org_id: orgId,
    p_budget_id: budgetId,
    p_planned_course: plannedCourse,
    p_planned_course_start_date: plannedCourseStartDate,
    p_initial_amount: initialAmount,
    p_currency: currency,
  });

  if (error) {
    return NextResponse.json({ error: error.message }, { status: 400 });
  }

  return NextResponse.json({ ok: true, id: budgetId });
}
