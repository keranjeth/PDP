import { NextResponse } from 'next/server';
import { requireBudgetApiAccess } from '@/lib/budgets/authz';
import {
  budgetDuplicateKey,
  normalizePersonName,
  type BudgetImportRecord,
} from '@/lib/budget-import';
import { BUDGET_CURRENCIES } from '@/lib/budgets/types';

type ImportBody = {
  orgId: string;
  records: BudgetImportRecord[];
  preview?: boolean;
  allowPotentialDuplicates?: boolean;
};

type ResolvedRecord = BudgetImportRecord & {
  employeeUuid: string;
  employmentStatus: 'Active' | 'Inactive';
  officialFullName: string;
  isPotentialDuplicate: boolean;
  duplicateReasons: string[];
};

function isRecordArray(value: unknown): value is BudgetImportRecord[] {
  return Array.isArray(value);
}

function totalsByCurrency(records: Array<{ amount: number; currency: string }>) {
  const totals: Record<string, number> = {};
  for (const row of records) {
    const currency = String(row.currency).toUpperCase();
    totals[currency] = (totals[currency] ?? 0) + Number(row.amount);
  }
  return totals;
}

export async function POST(request: Request) {
  let body: ImportBody | null = null;
  try {
    body = (await request.json()) as ImportBody;
  } catch {
    return NextResponse.json({ error: 'Invalid JSON body.' }, { status: 400 });
  }

  const orgId = String(body?.orgId ?? '').trim();
  const access = await requireBudgetApiAccess(request, orgId, 'create');
  if (!access.ok) return access.response;

  if (!isRecordArray(body?.records) || body!.records.length === 0) {
    return NextResponse.json(
      { error: 'records must be a non-empty array.' },
      { status: 400 }
    );
  }

  const currencySet = new Set(BUDGET_CURRENCIES);
  const hardErrors: string[] = [];
  const cleaned: BudgetImportRecord[] = [];

  for (const raw of body!.records) {
    const rowNumber = Number(raw.rowNumber) || cleaned.length + 2;
    const employeeIdNumber = String(raw.employeeIdNumber ?? '').trim();
    const fullName = String(raw.fullName ?? '').trim();
    const plannedCourse = String(raw.plannedCourse ?? '').trim();
    const currency = String(raw.currency ?? '').trim().toUpperCase();
    const plannedCourseStartDate = String(raw.plannedCourseStartDate ?? '').trim().slice(0, 10);
    const amount = Number(raw.amount);

    if (!employeeIdNumber) {
      hardErrors.push(`Row ${rowNumber}: Employee ID is required.`);
      continue;
    }
    if (!fullName) {
      hardErrors.push(`Row ${rowNumber}: Full Name is required.`);
      continue;
    }
    if (!plannedCourse) {
      hardErrors.push(`Row ${rowNumber}: Planned Course is required.`);
      continue;
    }
    if (!Number.isFinite(amount) || amount < 0) {
      hardErrors.push(`Row ${rowNumber}: Budget must be a valid non-negative amount.`);
      continue;
    }
    if (!currencySet.has(currency as (typeof BUDGET_CURRENCIES)[number])) {
      hardErrors.push(`Row ${rowNumber}: Currency must be AFN, USD, or EUR.`);
      continue;
    }
    if (!/^\d{4}-\d{2}-\d{2}$/.test(plannedCourseStartDate)) {
      hardErrors.push(`Row ${rowNumber}: Invalid Planned Course Start Date.`);
      continue;
    }

    cleaned.push({
      employeeIdNumber,
      fullName,
      plannedCourse,
      amount,
      currency: currency as BudgetImportRecord['currency'],
      plannedCourseStartDate,
      rowNumber,
    });
  }

  if (hardErrors.length > 0) {
    return NextResponse.json(
      {
        error: hardErrors[0],
        errors: hardErrors.slice(0, 100),
        total: body!.records.length,
        valid: 0,
        invalid: hardErrors.length,
      },
      { status: 400 }
    );
  }

  const idNumbers = [...new Set(cleaned.map((r) => r.employeeIdNumber))];
  const employeeByIdNumber = new Map<
    string,
    {
      id: string;
      id_number: string;
      full_name: string;
      employment_status: string | null;
      deleted_at: string | null;
    }
  >();

  for (let i = 0; i < idNumbers.length; i += 200) {
    const chunk = idNumbers.slice(i, i + 200);
    const { data, error } = await access.sessionClient
      .from('employees')
      .select('id,id_number,full_name,employment_status,deleted_at')
      .eq('org_id', orgId)
      .in('id_number', chunk);
    if (error) {
      return NextResponse.json({ error: error.message }, { status: 400 });
    }
    for (const row of data ?? []) {
      const emp = row as {
        id: string;
        id_number: string;
        full_name: string;
        employment_status: string | null;
        deleted_at: string | null;
      };
      employeeByIdNumber.set(String(emp.id_number).toLowerCase(), emp);
    }
  }

  // Existing budgets for duplicate detection (by employee + course + start date).
  const employeeUuids = [
    ...new Set(
      [...employeeByIdNumber.values()]
        .filter((e) => !e.deleted_at)
        .map((e) => e.id)
    ),
  ];
  const existingKeys = new Set<string>();
  for (let i = 0; i < employeeUuids.length; i += 100) {
    const chunk = employeeUuids.slice(i, i + 100);
    const { data, error } = await access.sessionClient
      .from('employee_budgets')
      .select('employee_id,planned_course,planned_course_start_date')
      .eq('org_id', orgId)
      .is('deleted_at', null)
      .in('employee_id', chunk);
    if (error) {
      return NextResponse.json({ error: error.message }, { status: 400 });
    }
    for (const row of data ?? []) {
      const r = row as {
        employee_id: string;
        planned_course: string;
        planned_course_start_date: string;
      };
      const emp = [...employeeByIdNumber.values()].find((e) => e.id === r.employee_id);
      if (!emp) continue;
      existingKeys.add(
        budgetDuplicateKey({
          employeeIdNumber: emp.id_number,
          plannedCourse: r.planned_course,
          plannedCourseStartDate: String(r.planned_course_start_date).slice(0, 10),
        })
      );
    }
  }

  const workbookKeyCounts = new Map<string, number>();
  for (const row of cleaned) {
    const key = budgetDuplicateKey(row);
    workbookKeyCounts.set(key, (workbookKeyCounts.get(key) ?? 0) + 1);
  }

  const validationErrors: string[] = [];
  const resolved: ResolvedRecord[] = [];

  for (const row of cleaned) {
    const emp = employeeByIdNumber.get(row.employeeIdNumber.toLowerCase());
    if (!emp || emp.deleted_at) {
      validationErrors.push(`Row ${row.rowNumber}: Employee ID was not found.`);
      continue;
    }

    const status = String(emp.employment_status ?? '');
    if (status !== 'active' && status !== 'inactive') {
      validationErrors.push(
        `Row ${row.rowNumber}: Employee status must be Active or Inactive.`
      );
      continue;
    }

    if (normalizePersonName(emp.full_name) !== normalizePersonName(row.fullName)) {
      validationErrors.push(
        `Row ${row.rowNumber}: Full Name does not match the employee master.`
      );
      continue;
    }

    const key = budgetDuplicateKey(row);
    const duplicateReasons: string[] = [];
    if ((workbookKeyCounts.get(key) ?? 0) > 1) {
      duplicateReasons.push('Also appears elsewhere in this workbook');
    }
    if (existingKeys.has(key)) {
      duplicateReasons.push('Matches an existing budget allocation');
    }

    resolved.push({
      ...row,
      employeeUuid: emp.id,
      employmentStatus: status === 'active' ? 'Active' : 'Inactive',
      officialFullName: emp.full_name,
      isPotentialDuplicate: duplicateReasons.length > 0,
      duplicateReasons,
    });
  }

  if (validationErrors.length > 0) {
    return NextResponse.json(
      {
        error: validationErrors[0],
        errors: validationErrors.slice(0, 100),
        total: cleaned.length,
        valid: resolved.length,
        invalid: validationErrors.length,
        potentialDuplicates: resolved.filter((r) => r.isPotentialDuplicate).length,
        totalsByCurrency: totalsByCurrency(resolved),
        previewRows: resolved.slice(0, 50).map((r) => ({
          rowNumber: r.rowNumber,
          employeeIdNumber: r.employeeIdNumber,
          fullName: r.officialFullName,
          employmentStatus: r.employmentStatus,
          plannedCourse: r.plannedCourse,
          amount: r.amount,
          currency: r.currency,
          plannedCourseStartDate: r.plannedCourseStartDate,
          isPotentialDuplicate: r.isPotentialDuplicate,
        })),
      },
      { status: 400 }
    );
  }

  const potentialDuplicates = resolved.filter((r) => r.isPotentialDuplicate);

  if (body!.preview) {
    return NextResponse.json({
      ok: true,
      total: resolved.length,
      valid: resolved.length,
      invalid: 0,
      potentialDuplicates: potentialDuplicates.length,
      totalsByCurrency: totalsByCurrency(resolved),
      previewRows: resolved.map((r) => ({
        rowNumber: r.rowNumber,
        employeeIdNumber: r.employeeIdNumber,
        fullName: r.officialFullName,
        employmentStatus: r.employmentStatus,
        plannedCourse: r.plannedCourse,
        amount: r.amount,
        currency: r.currency,
        plannedCourseStartDate: r.plannedCourseStartDate,
        isPotentialDuplicate: r.isPotentialDuplicate,
        duplicateReasons: r.duplicateReasons,
      })),
    });
  }

  if (potentialDuplicates.length > 0 && !body!.allowPotentialDuplicates) {
    return NextResponse.json(
      {
        error:
          'Potential duplicate allocations were found. Review the preview and confirm to import them anyway.',
        potentialDuplicates: potentialDuplicates.length,
        totalsByCurrency: totalsByCurrency(resolved),
        errors: potentialDuplicates.slice(0, 50).map(
          (r) =>
            `Row ${r.rowNumber}: Potential duplicate allocation (${r.duplicateReasons.join('; ')}).`
        ),
      },
      { status: 409 }
    );
  }

  let imported = 0;
  const failures: Array<{ rowNumber: number; reason: string }> = [];

  for (const row of resolved) {
    const { data, error } = await access.sessionClient.rpc('create_employee_budget', {
      p_org_id: orgId,
      p_employee_id: row.employeeUuid,
      p_planned_course: row.plannedCourse,
      p_initial_amount: row.amount,
      p_currency: row.currency,
      p_planned_course_start_date: row.plannedCourseStartDate,
    });

    if (error) {
      failures.push({
        rowNumber: row.rowNumber,
        reason: error.message || 'Budget creation failed.',
      });
      // Stop on first failure to avoid partial silent imports leaving unclear state.
      return NextResponse.json(
        {
          error: `Row ${row.rowNumber}: ${error.message || 'Budget creation failed.'}`,
          imported,
          failures,
        },
        { status: 400 }
      );
    }

    if (data) imported += 1;
  }

  return NextResponse.json({
    ok: true,
    imported,
    total: resolved.length,
    failures,
    totalsByCurrency: totalsByCurrency(resolved),
  });
}
