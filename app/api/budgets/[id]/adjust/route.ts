import { NextResponse } from 'next/server';
import { requireBudgetApiAccess } from '@/lib/budgets/authz';
import type { AdjustBudgetRequest } from '@/lib/budgets/types';

export async function POST(
  request: Request,
  context: { params: Promise<{ id: string }> }
) {
  const { id: budgetId } = await context.params;
  let body: AdjustBudgetRequest | null = null;
  try {
    body = (await request.json()) as AdjustBudgetRequest;
  } catch {
    return NextResponse.json({ error: 'Invalid JSON body.' }, { status: 400 });
  }

  const orgId = String(body?.orgId ?? '').trim();
  const access = await requireBudgetApiAccess(request, orgId, 'update');
  if (!access.ok) return access.response;

  const direction = String(body?.direction ?? '').trim().toLowerCase();
  const amount = Number(body?.amount);
  const note = body?.note != null ? String(body.note) : null;

  if (!budgetId) {
    return NextResponse.json({ error: 'Budget id is required.' }, { status: 400 });
  }
  if (direction !== 'increase' && direction !== 'decrease') {
    return NextResponse.json(
      { error: 'direction must be increase or decrease.' },
      { status: 400 }
    );
  }
  if (!Number.isFinite(amount) || amount <= 0) {
    return NextResponse.json(
      { error: 'amount must be greater than zero.' },
      { status: 400 }
    );
  }

  const { data, error } = await access.sessionClient.rpc('adjust_employee_budget', {
    p_org_id: orgId,
    p_budget_id: budgetId,
    p_direction: direction,
    p_amount: amount,
    p_reason: note,
    p_adjustment_date: null,
  });

  if (error) {
    return NextResponse.json({ error: error.message }, { status: 400 });
  }

  return NextResponse.json({ ok: true, id: data as string });
}
