import { NextResponse } from 'next/server';
import { requireBudgetApiAccess } from '@/lib/budgets/authz';
import type { ReallocateBudgetRequest } from '@/lib/budgets/types';

export async function POST(request: Request) {
  let body: ReallocateBudgetRequest | null = null;
  try {
    body = (await request.json()) as ReallocateBudgetRequest;
  } catch {
    return NextResponse.json({ error: 'Invalid JSON body.' }, { status: 400 });
  }

  const orgId = String(body?.orgId ?? '').trim();
  const access = await requireBudgetApiAccess(request, orgId, 'update');
  if (!access.ok) return access.response;

  const sourceBudgetId = String(body?.sourceBudgetId ?? '').trim();
  const destinationBudgetId = String(body?.destinationBudgetId ?? '').trim();
  const amount = Number(body?.amount);
  const note = body?.note != null ? String(body.note) : null;

  if (!sourceBudgetId || !destinationBudgetId) {
    return NextResponse.json(
      { error: 'sourceBudgetId and destinationBudgetId are required.' },
      { status: 400 }
    );
  }
  if (sourceBudgetId === destinationBudgetId) {
    return NextResponse.json(
      { error: 'Cannot reallocate a budget to itself.' },
      { status: 400 }
    );
  }
  if (!Number.isFinite(amount) || amount <= 0) {
    return NextResponse.json(
      { error: 'amount must be greater than zero.' },
      { status: 400 }
    );
  }

  const { data, error } = await access.sessionClient.rpc('reallocate_employee_budget', {
    p_org_id: orgId,
    p_source_budget_id: sourceBudgetId,
    p_destination_budget_id: destinationBudgetId,
    p_amount: amount,
    p_reason: note,
    p_reallocation_date: null,
  });

  if (error) {
    return NextResponse.json({ error: error.message }, { status: 400 });
  }

  return NextResponse.json({ ok: true, id: data as string });
}
