import { NextResponse } from 'next/server';
import { requireBudgetApiAccess } from '@/lib/budgets/authz';
import { budgetImportFingerprint } from '@/lib/budgets/import-fingerprint';
import {
  BUDGET_IMPORT_SAMPLE_EMPLOYEE_ID,
  budgetDuplicateKey,
  isBudgetImportSampleRow,
  normalizePersonName,
  type BudgetImportPreviewRow,
  type BudgetImportRecord,
} from '@/lib/budget-import';
import { BUDGET_CURRENCIES } from '@/lib/budgets/types';
import { parseImportDate } from '@/lib/employee-dates';

type ImportBody = {
  orgId: string;
  records: BudgetImportRecord[];
  preview?: boolean;
  allowPotentialDuplicates?: boolean;
  /** Client-generated UUID for idempotent confirm/retry. Required when preview is false. */
  importId?: string;
};

function isRecordArray(value: unknown): value is BudgetImportRecord[] {
  return Array.isArray(value);
}

function isUuid(value: string) {
  return /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(
    value
  );
}

function totalsByCurrency(records: Array<{ amount: number; currency: string }>) {
  const totals: Record<string, number> = { AFN: 0, USD: 0, EUR: 0 };
  for (const row of records) {
    const currency = String(row.currency).toUpperCase();
    if (!(currency in totals)) totals[currency] = 0;
    totals[currency] += Number(row.amount);
  }
  return totals;
}

/** Optional calendar date: blank is allowed; non-blank must be YYYY-MM-DD / Excel date. */
function validateOptionalCalendarDate(
  value: unknown,
  rowNumber: number
): { error: string | null; iso: string } {
  const parsed = parseImportDate(value);
  if (parsed.ok) return { error: null, iso: parsed.iso };
  if (parsed.blank) return { error: null, iso: '' };
  return {
    error: `Row ${rowNumber}: Invalid Planned Course Start Date. ${parsed.message}`,
    iso: '',
  };
}

async function buildPreview(
  access: Extract<Awaited<ReturnType<typeof requireBudgetApiAccess>>, { ok: true }>,
  orgId: string,
  cleaned: BudgetImportRecord[]
): Promise<
  | { ok: true; rows: BudgetImportPreviewRow[]; errors: string[] }
  | { ok: false; errors: string[] }
> {
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
      return { ok: false, errors: [error.message] };
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

  // Case-insensitive fallback for IDs not returned by exact .in() match.
  for (const idNumber of idNumbers) {
    if (employeeByIdNumber.has(idNumber.toLowerCase())) continue;
    const { data } = await access.sessionClient
      .from('employees')
      .select('id,id_number,full_name,employment_status,deleted_at')
      .eq('org_id', orgId)
      .ilike('id_number', idNumber)
      .is('deleted_at', null)
      .limit(1)
      .maybeSingle();
    if (data) {
      const emp = data as {
        id: string;
        id_number: string;
        full_name: string;
        employment_status: string | null;
        deleted_at: string | null;
      };
      employeeByIdNumber.set(idNumber.toLowerCase(), emp);
      employeeByIdNumber.set(String(emp.id_number).toLowerCase(), emp);
    }
  }

  const employeeUuids = [
    ...new Set(
      [...employeeByIdNumber.values()].filter((e) => !e.deleted_at).map((e) => e.id)
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
      return { ok: false, errors: [error.message] };
    }
    for (const row of data ?? []) {
      const r = row as {
        employee_id: string;
        planned_course: string;
        planned_course_start_date: string | null;
      };
      const emp = [...employeeByIdNumber.values()].find((e) => e.id === r.employee_id);
      if (!emp) continue;
      existingKeys.add(
        budgetDuplicateKey({
          employeeIdNumber: emp.id_number,
          plannedCourse: r.planned_course,
          plannedCourseStartDate: r.planned_course_start_date
            ? String(r.planned_course_start_date).slice(0, 10)
            : '',
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
  const resolved: BudgetImportPreviewRow[] = [];

  for (const row of cleaned) {
    if (isBudgetImportSampleRow(row)) {
      validationErrors.push(`Row ${row.rowNumber}: Sample template row cannot be imported.`);
      continue;
    }

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
      rowNumber: row.rowNumber,
      employeeIdNumber: emp.id_number,
      fullName: emp.full_name,
      employmentStatus: status === 'active' ? 'Active' : 'Inactive',
      plannedCourse: row.plannedCourse,
      amount: row.amount,
      currency: row.currency,
      plannedCourseStartDate: row.plannedCourseStartDate,
      isPotentialDuplicate: duplicateReasons.length > 0,
      duplicateReasons,
    });
  }

  return { ok: true, rows: resolved, errors: validationErrors };
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
    const amount = Number(raw.amount);
    const dateResult = validateOptionalCalendarDate(raw.plannedCourseStartDate, rowNumber);

    if (employeeIdNumber.toLowerCase() === BUDGET_IMPORT_SAMPLE_EMPLOYEE_ID.toLowerCase()) {
      hardErrors.push(`Row ${rowNumber}: Sample template row cannot be imported.`);
      continue;
    }
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
    if (dateResult.error) {
      hardErrors.push(dateResult.error);
      continue;
    }

    cleaned.push({
      employeeIdNumber,
      fullName,
      plannedCourse,
      amount,
      currency: currency as BudgetImportRecord['currency'],
      plannedCourseStartDate: dateResult.iso,
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
        potentialDuplicates: 0,
        totalsByCurrency: { AFN: 0, USD: 0, EUR: 0 },
        previewRows: [],
      },
      { status: 400 }
    );
  }

  const preview = await buildPreview(access, orgId, cleaned);
  if (!preview.ok) {
    return NextResponse.json({ error: preview.errors[0] }, { status: 400 });
  }

  if (preview.errors.length > 0) {
    return NextResponse.json(
      {
        error: preview.errors[0],
        errors: preview.errors.slice(0, 100),
        total: cleaned.length,
        valid: preview.rows.length,
        invalid: preview.errors.length,
        potentialDuplicates: preview.rows.filter((r) => r.isPotentialDuplicate).length,
        totalsByCurrency: totalsByCurrency(preview.rows),
        previewRows: preview.rows,
      },
      { status: 400 }
    );
  }

  const potentialDuplicates = preview.rows.filter((r) => r.isPotentialDuplicate).length;

  if (body!.preview) {
    return NextResponse.json({
      ok: true,
      total: preview.rows.length,
      valid: preview.rows.length,
      invalid: 0,
      potentialDuplicates,
      totalsByCurrency: totalsByCurrency(preview.rows),
      previewRows: preview.rows,
    });
  }

  const importId = String(body!.importId ?? '').trim();
  if (!isUuid(importId)) {
    return NextResponse.json(
      { error: 'importId (UUID) is required to confirm an import.' },
      { status: 400 }
    );
  }

  const fingerprint = budgetImportFingerprint(cleaned);
  const { data, error } = await access.sessionClient.rpc('import_employee_budgets', {
    p_org_id: orgId,
    p_import_id: importId,
    p_fingerprint: fingerprint,
    p_allow_duplicates: Boolean(body!.allowPotentialDuplicates),
    p_rows: cleaned,
  });

  if (error) {
    // RPC runs in one transaction: a returned error means the attempt was rolled back.
    return NextResponse.json(
      {
        error: 'Import failed. No allocations were saved.',
        detail: error.message,
        outcome: 'rolled_back' as const,
        imported: 0,
        importId,
      },
      { status: 400 }
    );
  }

  const result = data as {
    ok?: boolean;
    needsDuplicateConfirmation?: boolean;
    imported?: number;
    total?: number;
    potentialDuplicates?: number;
    totalsByCurrency?: Record<string, number>;
    previewRows?: BudgetImportPreviewRow[];
    created?: Array<{
      rowNumber: number;
      budgetId: string;
      budgetCode: string;
      employeeIdNumber?: string;
    }>;
    errors?: string[];
  };

  if (result?.needsDuplicateConfirmation) {
    return NextResponse.json(
      {
        error:
          'Potential duplicate allocations were found. Review the preview and confirm to import them anyway.',
        outcome: 'rolled_back' as const,
        needsDuplicateConfirmation: true,
        potentialDuplicates: result.potentialDuplicates ?? potentialDuplicates,
        totalsByCurrency: result.totalsByCurrency ?? totalsByCurrency(preview.rows),
        previewRows: result.previewRows ?? preview.rows,
        errors: result.errors ?? [],
        imported: 0,
        importId,
      },
      { status: 409 }
    );
  }

  const created = (result?.created ?? []).map((row) => ({
    rowNumber: row.rowNumber,
    budgetId: row.budgetId,
    budgetCode: row.budgetCode,
    employeeIdNumber:
      row.employeeIdNumber ??
      preview.rows.find((p) => p.rowNumber === row.rowNumber)?.employeeIdNumber ??
      '',
  }));

  return NextResponse.json({
    ok: true,
    outcome: 'completed' as const,
    imported: result?.imported ?? created.length,
    total: result?.total ?? cleaned.length,
    potentialDuplicates: result?.potentialDuplicates ?? 0,
    totalsByCurrency: result?.totalsByCurrency ?? totalsByCurrency(preview.rows),
    created,
    previewRows: result?.previewRows ?? preview.rows,
    importId,
  });
}
