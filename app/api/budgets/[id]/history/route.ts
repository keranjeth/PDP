import { NextResponse } from 'next/server';
import { requireBudgetApiAccess } from '@/lib/budgets/authz';
import type { BudgetHistoryEntry } from '@/lib/budgets/types';

export async function GET(
  request: Request,
  context: { params: Promise<{ id: string }> }
) {
  const { id: budgetId } = await context.params;
  const orgId = new URL(request.url).searchParams.get('orgId')?.trim() ?? '';
  const access = await requireBudgetApiAccess(request, orgId, 'read');
  if (!access.ok) return access.response;

  if (!budgetId) {
    return NextResponse.json({ error: 'Budget id is required.' }, { status: 400 });
  }

  const { data: budget, error: budgetErr } = await access.sessionClient
    .from('employee_budgets')
    .select('id,currency,budget_code')
    .eq('org_id', orgId)
    .eq('id', budgetId)
    .is('deleted_at', null)
    .maybeSingle();

  if (budgetErr) {
    return NextResponse.json({ error: budgetErr.message }, { status: 400 });
  }
  if (!budget) {
    return NextResponse.json({ error: 'Budget not found.' }, { status: 404 });
  }

  const currency = String((budget as { currency: string }).currency);

  const [{ data: adjustments, error: adjErr }, { data: reallocations, error: trfErr }] =
    await Promise.all([
      access.sessionClient
        .from('budget_adjustments')
        .select('id,adjustment_code,direction,amount,reason,created_at,created_by')
        .eq('org_id', orgId)
        .eq('budget_id', budgetId)
        .order('created_at', { ascending: false }),
      access.sessionClient
        .from('budget_reallocations')
        .select(
          'id,reallocation_code,source_budget_id,destination_budget_id,amount,reason,created_at,created_by,currency'
        )
        .eq('org_id', orgId)
        .or(`source_budget_id.eq.${budgetId},destination_budget_id.eq.${budgetId}`)
        .order('created_at', { ascending: false }),
    ]);

  if (adjErr) {
    return NextResponse.json({ error: adjErr.message }, { status: 400 });
  }
  if (trfErr) {
    return NextResponse.json({ error: trfErr.message }, { status: 400 });
  }

  const relatedBudgetIds = [
    ...new Set(
      ((reallocations ?? []) as Array<{
        source_budget_id: string;
        destination_budget_id: string;
      }>).flatMap((r) => [r.source_budget_id, r.destination_budget_id])
    ),
  ].filter((id) => id !== budgetId);

  const codeById = new Map<string, string>();
  codeById.set(budgetId, String((budget as { budget_code: string }).budget_code));

  if (relatedBudgetIds.length > 0) {
    const { data: related } = await access.sessionClient
      .from('employee_budgets')
      .select('id,budget_code')
      .eq('org_id', orgId)
      .in('id', relatedBudgetIds);
    for (const row of related ?? []) {
      codeById.set(
        String((row as { id: string }).id),
        String((row as { budget_code: string }).budget_code)
      );
    }
  }

  const actorIds = [
    ...new Set(
      [
        ...((adjustments ?? []) as Array<{ created_by: string | null }>).map((r) => r.created_by),
        ...((reallocations ?? []) as Array<{ created_by: string | null }>).map((r) => r.created_by),
      ].filter((id): id is string => Boolean(id))
    ),
  ];

  const nameByUser = new Map<string, string>();
  if (actorIds.length > 0) {
    const { data: profiles } = await access.sessionClient
      .from('profiles')
      .select('user_id,full_name')
      .in('user_id', actorIds);
    for (const p of profiles ?? []) {
      nameByUser.set(
        String((p as { user_id: string }).user_id),
        String((p as { full_name: string | null }).full_name ?? '').trim() || 'User'
      );
    }
  }

  const history: BudgetHistoryEntry[] = [];

  for (const adj of (adjustments ?? []) as Array<{
    id: string;
    direction: 'increase' | 'decrease';
    amount: number | string;
    reason: string | null;
    created_at: string;
    created_by: string | null;
  }>) {
    history.push({
      id: adj.id,
      type: 'adjustment',
      createdAt: adj.created_at,
      amount: Number(adj.amount),
      currency,
      direction: adj.direction,
      note: adj.reason,
      performedByName: adj.created_by ? nameByUser.get(adj.created_by) ?? null : null,
    });
  }

  for (const trf of (reallocations ?? []) as Array<{
    id: string;
    source_budget_id: string;
    destination_budget_id: string;
    amount: number | string;
    reason: string | null;
    created_at: string;
    created_by: string | null;
    currency: string;
  }>) {
    const isOut = trf.source_budget_id === budgetId;
    history.push({
      id: trf.id,
      type: isOut ? 'reallocation_out' : 'reallocation_in',
      createdAt: trf.created_at,
      amount: Number(trf.amount),
      currency: trf.currency,
      note: trf.reason,
      relatedBudgetCode: codeById.get(
        isOut ? trf.destination_budget_id : trf.source_budget_id
      ) ?? null,
      performedByName: trf.created_by ? nameByUser.get(trf.created_by) ?? null : null,
    });
  }

  history.sort((a, b) => b.createdAt.localeCompare(a.createdAt));

  return NextResponse.json({ history });
}
