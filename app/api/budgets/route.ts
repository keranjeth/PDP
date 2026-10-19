import { NextResponse } from 'next/server';
import { requireBudgetApiAccess } from '@/lib/budgets/authz';
import { mapBudgetListItem } from '@/lib/budgets/map';
import type { BudgetListItem, CreateBudgetRequest } from '@/lib/budgets/types';

function isIsoDateOnly(value: string) {
  return /^\d{4}-\d{2}-\d{2}$/.test(value);
}

export async function GET(request: Request) {
  const orgId = new URL(request.url).searchParams.get('orgId')?.trim() ?? '';
  const access = await requireBudgetApiAccess(request, orgId, 'read');
  if (!access.ok) return access.response;

  // Employee fields come from the view join — avoid a second .in(id, …) lookup
  // that exceeds PostgREST URL limits after large imports (~800+ UUIDs).
  const { data: budgetRows, error: budgetErr } = await access.sessionClient
    .from('v_employee_budget_list')
    .select(
      [
        'id',
        'budget_code',
        'employee_id',
        'planned_course',
        'initial_amount',
        'currency',
        'planned_course_start_date',
        'current_amount',
        'remaining_amount',
        'has_transactions',
        'employee_id_number',
        'full_name',
        'employment_status',
        'region',
        'duty_station',
        'job_location',
        'department',
        'unit',
        'designation',
      ].join(',')
    )
    .eq('org_id', orgId)
    .order('created_at', { ascending: false });

  if (budgetErr) {
    return NextResponse.json({ error: budgetErr.message }, { status: 400 });
  }

  const budgets: BudgetListItem[] = (
    (budgetRows ?? []) as Array<Parameters<typeof mapBudgetListItem>[0]>
  ).map((row) => mapBudgetListItem(row));

  return NextResponse.json({ budgets });
}

export async function POST(request: Request) {
  let body: CreateBudgetRequest | null = null;
  try {
    body = (await request.json()) as CreateBudgetRequest;
  } catch {
    return NextResponse.json({ error: 'Invalid JSON body.' }, { status: 400 });
  }

  const orgId = String(body?.orgId ?? '').trim();
  const access = await requireBudgetApiAccess(request, orgId, 'create');
  if (!access.ok) return access.response;

  const employeeId = String(body?.employeeId ?? '').trim();
  const plannedCourse = String(body?.plannedCourse ?? '').trim();
  const currency = String(body?.currency ?? '').trim().toUpperCase();
  const plannedCourseStartDate = String(body?.plannedCourseStartDate ?? '').trim();
  const initialAmount = Number(body?.initialAmount);

  if (!employeeId || !plannedCourse || !currency || !isIsoDateOnly(plannedCourseStartDate)) {
    return NextResponse.json(
      {
        error:
          'employeeId, plannedCourse, currency, and plannedCourseStartDate (YYYY-MM-DD) are required.',
      },
      { status: 400 }
    );
  }

  if (!Number.isFinite(initialAmount) || initialAmount < 0) {
    return NextResponse.json(
      { error: 'initialAmount must be a non-negative number.' },
      { status: 400 }
    );
  }

  const { data, error } = await access.sessionClient.rpc('create_employee_budget', {
    p_org_id: orgId,
    p_employee_id: employeeId,
    p_planned_course: plannedCourse,
    p_initial_amount: initialAmount,
    p_currency: currency,
    p_planned_course_start_date: plannedCourseStartDate,
  });

  if (error) {
    return NextResponse.json({ error: error.message }, { status: 400 });
  }

  return NextResponse.json({ ok: true, id: data as string });
}
