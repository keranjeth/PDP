import { NextResponse } from 'next/server';
import { createServerClient } from '@supabase/ssr';
import { cookies } from 'next/headers';
import type { SupabaseClient } from '@supabase/supabase-js';
import type { EmployeeImportRecord } from '@/lib/employee-import';
import { getSupabaseAdminClient } from '@/lib/supabase/admin';
import { normalizeEmployeeId } from '@/lib/users/provisioning';
import { provisionEmployeeAccountPending } from '@/lib/user-management/account-lifecycle';
import { dateToCalendarIso } from '@/lib/employee-dates';
import { guardProtectedApiUser } from '@/lib/api/request-auth';
import { normalizeSeparationExitType } from '@/lib/separation';

type ImportRequestBody = {
  orgId: string;
  records: EmployeeImportRecord[];
  /** Resumable account provisioning: process at most this many ids per request (default 75). */
  provisionBatchSize?: number;
  /** Skip this many imported ids before provisioning (for safe retries / large imports). */
  provisionOffset?: number;
  preview?: boolean;
};

const DEFAULT_PROVISION_BATCH = 75;
const MAX_PROVISION_BATCH = 150;

type EmployeeImportDbRow = {
  org_id: string;
  id_number: string;
  full_name: string;
  gender: 'male' | 'female' | null;
  date_of_birth: string | null;
  position_number: string | null;
  reports_to_position_number: string | null;
  designation: string;
  staffing_category: string | null;
  department: string;
  unit: string | null;
  region: string | null;
  duty_station: string | null;
  job_location: string | null;
  contract_type: 'regular' | 'non_regular' | null;
  job_status: 'full_time' | 'part_time' | null;
  employment_status: 'active' | 'inactive' | null;
  joining_date: string | null;
  contract_start_date: string | null;
  contract_end_date: string | null;
  deleted_at: null;
  separation_type: string | null;
  separation_reason: string | null;
  last_working_date: string | null;
};

function createConcurrencyLimiter(concurrency: number) {
  let active = 0;
  const queue: Array<() => void> = [];

  const next = () => {
    if (active >= concurrency) return;
    const fn = queue.shift();
    if (!fn) return;
    active += 1;
    fn();
  };

  return async function limit<T>(work: () => Promise<T>): Promise<T> {
    return await new Promise<T>((resolve, reject) => {
      queue.push(() => {
        void work()
          .then(resolve)
          .catch(reject)
          .finally(() => {
            active -= 1;
            next();
          });
      });
      next();
    });
  };
}

function stripMissingEmployeeColumns(
  row: Record<string, unknown>,
  message: string
): Record<string, unknown> {
  const match = /Could not find the '([^']+)' column of 'employees'/i.exec(message);
  if (!match?.[1]) return row;
  const missing = match[1];
  if (!(missing in row)) return row;
  const next = { ...row };
  delete next[missing];
  return next;
}

function employeeWriteRow(row: EmployeeImportDbRow): Record<string, unknown> {
  return {
    org_id: row.org_id,
    id_number: row.id_number,
    full_name: row.full_name,
    gender: row.gender,
    date_of_birth: row.date_of_birth,
    position_number: row.position_number,
    reports_to_position_number: row.reports_to_position_number,
    designation: row.designation,
    staffing_category: row.staffing_category,
    department: row.department,
    unit: row.unit,
    region: row.region,
    duty_station: row.duty_station,
    job_location: row.job_location,
    contract_type: row.contract_type,
    job_status: row.job_status,
    employment_status: row.employment_status,
    joining_date: row.joining_date,
    contract_start_date: row.contract_start_date,
    contract_end_date: row.contract_end_date,
    deleted_at: null,
  };
}

async function upsertIndividuallyWithConcurrency(
  supabase: SupabaseClient,
  rows: Array<Record<string, unknown>>,
  concurrency: number,
  rlsSkipped: Array<{ idNumber: string; reason: string }>
) {
  const limit = createConcurrencyLimiter(concurrency);
  const results = await Promise.all(
    rows.map((row) =>
      limit(async () => {
        let attempt = row as Record<string, unknown>;
        for (let i = 0; i < 3; i += 1) {
          const { error } = await supabase.from('employees').upsert([attempt], {
            onConflict: 'org_id,id_number',
          });
          if (!error) return true;
          if (error.code === 'PGRST204') {
            const stripped = stripMissingEmployeeColumns(attempt, String(error.message ?? ''));
            if (stripped !== attempt && Object.keys(stripped).length < Object.keys(attempt).length) {
              attempt = stripped;
              continue;
            }
          }
          rlsSkipped.push({ idNumber: String(row.id_number), reason: error.message });
          return false;
        }
        return false;
      })
    )
  );
  return results.filter(Boolean).length;
}

async function provisionEmployeeAccountsReliable(params: {
  orgId: string;
  idNumbers: string[];
}): Promise<{
  created: number;
  skipped: number;
  failed: number;
  failures: Array<{ idNumber: string; reason: string }>;
}> {
  const { orgId, idNumbers } = params;
  const summary = {
    created: 0,
    skipped: 0,
    failed: 0,
    failures: [] as Array<{ idNumber: string; reason: string }>,
  };
  if (!idNumbers.length) return summary;

  const admin = getSupabaseAdminClient();

  const uniqueIds = [...new Set(idNumbers.map((id) => normalizeEmployeeId(id)).filter(Boolean))];
  const byIdNumber = new Map<string, { id: string; id_number: string; full_name: string }>();
  for (let i = 0; i < uniqueIds.length; i += 200) {
    const chunk = uniqueIds.slice(i, i + 200);
    const { data: employeeRows } = await admin
      .from('employees')
      .select('id,id_number,full_name,org_id,employment_status')
      .eq('org_id', orgId)
      .eq('employment_status', 'active')
      .in('id_number', chunk);
    for (const r of employeeRows ?? []) {
      byIdNumber.set(String((r as { id_number: string }).id_number), {
        id: String((r as { id: string }).id),
        id_number: String((r as { id_number: string }).id_number),
        full_name: String((r as { full_name: string }).full_name),
      });
    }
  }

  const limit = createConcurrencyLimiter(8);
  await Promise.all(
    uniqueIds.map((employeeId) =>
      limit(async () => {
        const emp = byIdNumber.get(employeeId);
        if (!emp) {
          // Inactive / missing rows are skipped — never provision former employees.
          summary.skipped += 1;
          return;
        }
        try {
          const result = await provisionEmployeeAccountPending({
            admin,
            orgId,
            employeeUuid: emp.id,
            idNumber: emp.id_number,
            fullName: emp.full_name,
          });
          if (result.outcome === 'created') summary.created += 1;
          else if (result.outcome === 'skipped_existing') summary.skipped += 1;
          else {
            summary.failed += 1;
            summary.failures.push({ idNumber: employeeId, reason: result.reason });
          }
        } catch (err: unknown) {
          summary.failed += 1;
          summary.failures.push({
            idNumber: employeeId,
            reason: err instanceof Error ? err.message : 'provision_failed',
          });
        }
      })
    )
  );

  return summary;
}

function isRecordArray(value: unknown): value is EmployeeImportRecord[] {
  return Array.isArray(value);
}

function toDateOnly(value: unknown): string | null {
  if (!value) return null;
  if (value instanceof Date) return dateToCalendarIso(value);
  const text = String(value).trim();
  if (/^\d{4}-\d{2}-\d{2}/.test(text)) return text.slice(0, 10);
  return null;
}

function importRecordToDbRow(orgId: string, r: EmployeeImportRecord): EmployeeImportDbRow {
  const blankText = (value: unknown) => {
    const text = String(value ?? '').trim();
    return text ? text : null;
  };

  const exitType = normalizeSeparationExitType(String(r.separationType ?? ''));

  return {
    org_id: orgId,
    id_number: String(r.idNumber ?? '').trim(),
    full_name: String(r.fullName ?? '').trim(),
    gender: r.gender === 'Male' ? 'male' : r.gender === 'Female' ? 'female' : null,
    date_of_birth: toDateOnly(r.dateOfBirth),
    position_number: blankText(r.positionNumber),
    reports_to_position_number: blankText(r.reportsToPositionNumber),
    designation: String(r.designation ?? '').trim(),
    staffing_category: blankText(r.staffingCategory),
    department: String(r.department ?? '').trim(),
    unit: blankText(r.unit),
    region: blankText(r.region),
    duty_station: blankText(r.dutyStation),
    job_location: blankText(r.jobLocation),
    contract_type:
      r.contractType === 'Regular'
        ? 'regular'
        : r.contractType === 'Non-Regular'
          ? 'non_regular'
          : null,
    job_status:
      r.jobStatus === 'Full-Time'
        ? 'full_time'
        : r.jobStatus === 'Part-Time'
          ? 'part_time'
          : null,
    employment_status:
      r.employmentStatus === 'Active'
        ? 'active'
        : r.employmentStatus === 'Inactive'
          ? 'inactive'
          : null,
    joining_date: toDateOnly(r.joiningDate),
    contract_start_date: toDateOnly(r.contractStartDate),
    contract_end_date: toDateOnly(r.contractEndDate),
    deleted_at: null,
    separation_type: exitType,
    separation_reason: blankText(r.separationReason),
    last_working_date: toDateOnly(r.lastWorkingDate),
  };
}

const PRESERVE_WHEN_BLANK = [
  'date_of_birth',
  'position_number',
  'reports_to_position_number',
  'staffing_category',
  'unit',
  'region',
  'duty_station',
  'job_location',
  'contract_type',
  'job_status',
  'contract_start_date',
  'contract_end_date',
] as const;

function validateImportRows(rows: EmployeeImportDbRow[]): string[] {
  const errors: string[] = [];
  const seen = new Set<string>();

  rows.forEach((row, index) => {
    const label = `Employee ID ${row.id_number || `(row ${index + 1})`}`;

    if (
      !row.id_number ||
      !row.full_name ||
      !row.gender ||
      !row.designation ||
      !row.department ||
      !row.joining_date ||
      !row.employment_status
    ) {
      errors.push(`${label}: one or more required employee fields are missing.`);
      return;
    }

    const key = row.id_number.toLowerCase();
    if (seen.has(key)) {
      errors.push(`${label}: Duplicate Employee ID within the uploaded file.`);
    } else {
      seen.add(key);
    }

    if (
      row.contract_start_date &&
      row.contract_end_date &&
      row.contract_start_date > row.contract_end_date
    ) {
      errors.push(`${label}: Contract Start Date must not be later than Contract End Date.`);
    }

    if (row.employment_status === 'active') {
      if (row.separation_type || row.separation_reason || row.last_working_date) {
        errors.push(`${label}: Separation fields must be blank for an Active employee.`);
      }
      return;
    }

    if (!row.separation_type) {
      errors.push(`${label}: Separation Type is required for an inactive employee.`);
    }
    if (!row.separation_reason) {
      errors.push(`${label}: Separation Reason is required for an inactive employee.`);
    }
    if (!row.last_working_date) {
      errors.push(`${label}: Last Working Date is required for an inactive employee.`);
    } else if (row.joining_date && row.joining_date > row.last_working_date) {
      errors.push(`${label}: Joining Date must not be later than Last Working Date.`);
    }
  });

  return errors;
}

export async function POST(request: Request) {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY;
  const secretKey = process.env.SUPABASE_SECRET_KEY;

  if (!url || !key) {
    return NextResponse.json(
      { error: 'Supabase is not configured.' },
      { status: 500 }
    );
  }

  const cookieStore = await cookies();
  const supabase = createServerClient(url, key, {
    cookies: {
      getAll() {
        return cookieStore.getAll();
      },
      setAll(cookiesToSet) {
        cookiesToSet.forEach(({ name, value, options }) => {
          cookieStore.set(name, value, options);
        });
      },
    },
  });

  const {
    data: { user },
    error: userErr,
  } = await supabase.auth.getUser();

  if (userErr || !user) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  const blocked = await guardProtectedApiUser(user, supabase);
  if (blocked) {
    return blocked;
  }

  let body: ImportRequestBody | null = null;
  try {
    body = (await request.json()) as ImportRequestBody;
  } catch {
    return NextResponse.json({ error: 'Invalid JSON body.' }, { status: 400 });
  }

  if (!body?.orgId || typeof body.orgId !== 'string') {
    return NextResponse.json({ error: 'orgId is required.' }, { status: 400 });
  }

  if (!isRecordArray(body.records) || body.records.length === 0) {
    return NextResponse.json(
      { error: 'records must be a non-empty array.' },
      { status: 400 }
    );
  }

  const rows = body.records.map((r) => importRecordToDbRow(body!.orgId, r));
  const validationErrors = validateImportRows(rows);
  if (validationErrors.length > 0) {
    return NextResponse.json(
      { error: validationErrors[0], errors: validationErrors.slice(0, 50) },
      { status: 400 }
    );
  }

  const { data: membership, error: memErr } = await supabase
    .from('organization_members')
    .select('role,status')
    .eq('org_id', body.orgId)
    .eq('user_id', user.id)
    .maybeSingle();

  if (memErr) {
    return NextResponse.json({ error: memErr.message }, { status: 400 });
  }

  const role = String(membership?.role ?? '');
  const status = String(membership?.status ?? '');
  if (status !== 'active') {
    return NextResponse.json({ error: 'Inactive user.' }, { status: 403 });
  }

  let allowedRows = rows;
  let skipped = 0;

  if (role === 'employee') {
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
  }

  if (role === 'hr_national') {
    const next = rows.filter((r) => r.staffing_category !== 'Senior Management');
    skipped = rows.length - next.length;
    allowedRows = next;
  } else if (role === 'regional_hr') {
    const { data: regionRows, error: regionErr } = await supabase
      .from('organization_member_regions')
      .select('region')
      .eq('org_id', body.orgId)
      .eq('user_id', user.id);

    if (regionErr) {
      return NextResponse.json({ error: regionErr.message }, { status: 400 });
    }

    const allowedRegions = new Set(
      (regionRows ?? [])
        .map((r) => String((r as { region: string }).region ?? '').trim())
        .filter(Boolean)
    );

    const next = rows.filter((r) => allowedRegions.has(String(r.region ?? '').trim()));
    skipped = rows.length - next.length;
    allowedRows = next;
  }

  if (allowedRows.length === 0) {
    return NextResponse.json({
      ok: true,
      imported: 0,
      skipped,
      message:
        role === 'hr_national'
          ? 'All rows were skipped (Senior Management is restricted).'
          : role === 'regional_hr'
            ? 'All rows were skipped (outside assigned regions).'
            : 'No rows to import.',
    });
  }

  if (!secretKey) {
    return NextResponse.json(
      {
        error:
          'Server is missing SUPABASE_SECRET_KEY. Employee import cannot run safely.',
      },
      { status: 500 }
    );
  }

  const adminDb = getSupabaseAdminClient();

  const existingByIdNumber = new Map<
    string,
    Record<string, unknown> & { employment_status?: string | null }
  >();
  const idNumbers = allowedRows.map((row) => row.id_number);
  for (let i = 0; i < idNumbers.length; i += 200) {
    const chunk = idNumbers.slice(i, i + 200);
    const { data: existingRows, error: existingErr } = await adminDb
      .from('employees')
      .select(['id_number', 'employment_status', ...PRESERVE_WHEN_BLANK].join(','))
      .eq('org_id', body.orgId)
      .in('id_number', chunk);
    if (existingErr) {
      return NextResponse.json(
        { error: 'Unable to read existing employees before import.' },
        { status: 400 }
      );
    }
    for (const existing of (existingRows ?? []) as unknown as Array<
      Record<string, unknown> & { employment_status?: string | null }
    >) {
      existingByIdNumber.set(String(existing.id_number).toLowerCase(), existing);
    }
  }

  const conflictErrors: string[] = [];
  for (const row of allowedRows) {
    const existing = existingByIdNumber.get(row.id_number.toLowerCase());
    if (!existing) continue;
    const existingStatus = String(existing.employment_status ?? '');
    if (existingStatus === 'active' && row.employment_status === 'inactive') {
      conflictErrors.push(
        `Employee ID ${row.id_number} already exists with Active status. Review before changing status.`
      );
    } else if (existingStatus === 'inactive' && row.employment_status === 'active') {
      conflictErrors.push(
        `Employee ID ${row.id_number} already exists with Inactive status. Review before changing status.`
      );
    }
  }

  if (conflictErrors.length > 0) {
    return NextResponse.json(
      { error: conflictErrors[0], errors: conflictErrors.slice(0, 50) },
      { status: 400 }
    );
  }

  let updatedExisting = 0;
  for (const row of allowedRows) {
    const existing = existingByIdNumber.get(row.id_number.toLowerCase());
    if (!existing) continue;
    updatedExisting += 1;
    if (row.employment_status === 'active') {
      for (const key of PRESERVE_WHEN_BLANK) {
        if (row[key] == null || row[key] === '') {
          (row as Record<string, unknown>)[key] = existing[key] ?? null;
        }
      }
    }
  }

  if (body.preview) {
    return NextResponse.json({
      ok: true,
      total: allowedRows.length,
      newRecords: allowedRows.length - updatedExisting,
      existingRecords: updatedExisting,
      activeRecords: allowedRows.filter((r) => r.employment_status === 'active').length,
      inactiveRecords: allowedRows.filter((r) => r.employment_status === 'inactive').length,
    });
  }

  const activeRows = allowedRows.filter((r) => r.employment_status === 'active');
  const inactiveRows = allowedRows.filter((r) => r.employment_status === 'inactive');

  const rlsSkipped: Array<{ idNumber: string; reason: string }> = [];
  let imported = 0;

  // Active employees: standard upsert (no Leavers records).
  if (activeRows.length > 0) {
    let rowsForUpsert: Array<Record<string, unknown>> = activeRows.map(employeeWriteRow);
    let { data: bulkData, error: bulkErr } = await adminDb
      .from('employees')
      .upsert(rowsForUpsert, {
        onConflict: 'org_id,id_number',
      })
      .select('id_number');

    if (bulkErr && bulkErr.code === 'PGRST204') {
      const missingColumnMessage = String(bulkErr.message ?? '');
      const stripped = rowsForUpsert.map((row) =>
        stripMissingEmployeeColumns(row, missingColumnMessage)
      );
      const changed = stripped.some(
        (row, i) => Object.keys(row).length < Object.keys(rowsForUpsert[i]).length
      );
      if (changed) {
        rowsForUpsert = stripped;
        ({ data: bulkData, error: bulkErr } = await adminDb
          .from('employees')
          .upsert(rowsForUpsert, { onConflict: 'org_id,id_number' })
          .select('id_number'));
      }
    }

    imported = Array.isArray(bulkData) ? bulkData.length : 0;

    if (bulkErr || imported === 0) {
      imported = await upsertIndividuallyWithConcurrency(
        adminDb,
        rowsForUpsert,
        16,
        rlsSkipped
      );
    }
  }

  // Inactive employees: atomic employee + leaver via historical-import RPC.
  // Fail the request if any inactive row cannot be saved cleanly.
  for (const row of inactiveRows) {
    const { error: rpcErr } = await adminDb.rpc('import_separated_employee', {
      p_org_id: body.orgId,
      p_imported_by: user.id,
      p_id_number: row.id_number,
      p_full_name: row.full_name,
      p_gender: row.gender,
      p_date_of_birth: row.date_of_birth,
      p_position_number: row.position_number,
      p_reports_to_position_number: row.reports_to_position_number,
      p_designation: row.designation,
      p_staffing_category: row.staffing_category,
      p_department: row.department,
      p_unit: row.unit,
      p_region: row.region,
      p_duty_station: row.duty_station,
      p_job_location: row.job_location,
      p_contract_type: row.contract_type,
      p_job_status: row.job_status,
      p_joining_date: row.joining_date,
      p_contract_start_date: row.contract_start_date,
      p_contract_end_date: row.contract_end_date,
      p_last_working_date: row.last_working_date,
      p_exit_type: row.separation_type,
      p_leaving_reason: row.separation_reason,
    });

    if (rpcErr) {
      return NextResponse.json(
        {
          error: `Employee ID ${row.id_number}: ${rpcErr.message || 'Inactive employee import failed.'}`,
          imported,
          skipped: skipped + rlsSkipped.length,
          rlsSkipped,
        },
        { status: 400 }
      );
    }
    imported += 1;
  }

  const isSuperAdmin = status === 'active' && role === 'super_admin';

  if (!isSuperAdmin) {
    return NextResponse.json({
      ok: true,
      imported,
      skipped: skipped + rlsSkipped.length,
      rlsSkipped,
      usersCreated: 0,
      usersSkipped: 0,
      usersFailed: 0,
      userProvisioning: 'not_authorized',
    });
  }

  // Provision login accounts only for Active imports — never for former employees.
  const importedActiveIdNumbers = activeRows
    .filter((r) => !rlsSkipped.find((s) => s.idNumber === r.id_number))
    .map((r) => r.id_number);

  const batchSize = Math.min(
    MAX_PROVISION_BATCH,
    Math.max(1, Number(body!.provisionBatchSize) || DEFAULT_PROVISION_BATCH)
  );
  const offset = Math.max(0, Number(body!.provisionOffset) || 0);
  const batchIds = importedActiveIdNumbers.slice(offset, offset + batchSize);
  const nextOffset = offset + batchIds.length;
  const hasMore = nextOffset < importedActiveIdNumbers.length;

  const provision = await provisionEmployeeAccountsReliable({
    orgId: body!.orgId,
    idNumbers: batchIds,
  });

  return NextResponse.json({
    ok: true,
    imported,
    skipped: skipped + rlsSkipped.length,
    rlsSkipped,
    usersCreated: provision.created,
    usersSkipped: provision.skipped,
    usersFailed: provision.failed,
    userFailures: provision.failures.slice(0, 50),
    userProvisioning: hasMore ? 'partial' : 'completed',
    provisionTotal: importedActiveIdNumbers.length,
    provisionOffset: offset,
    provisionNextOffset: nextOffset,
    provisionHasMore: hasMore,
    provisionBatchSize: batchSize,
  });
}
