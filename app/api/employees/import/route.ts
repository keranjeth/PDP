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
  blood_group: string | null;
  marital_status: string | null;
  position_number: string | null;
  designation: string;
  staffing_category: string | null;
  overtime_group_name: string | null;
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
  currency: string;
  deleted_at: null;
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
  // PostgREST PGRST204: "Could not find the '<column>' column of 'employees' ..."
  const match = /Could not find the '([^']+)' column of 'employees'/i.exec(message);
  if (!match?.[1]) return row;
  const missing = match[1];
  if (!(missing in row)) return row;
  const next = { ...row };
  delete next[missing];
  return next;
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

  // Chunk id_number lookups (PostgREST .in() practical limits).
  const uniqueIds = [...new Set(idNumbers.map((id) => normalizeEmployeeId(id)).filter(Boolean))];
  const byIdNumber = new Map<string, { id: string; id_number: string; full_name: string }>();
  for (let i = 0; i < uniqueIds.length; i += 200) {
    const chunk = uniqueIds.slice(i, i + 200);
    const { data: employeeRows } = await admin
      .from('employees')
      .select('id,id_number,full_name,org_id')
      .eq('org_id', orgId)
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
          summary.failed += 1;
          summary.failures.push({ idNumber: employeeId, reason: 'employee_row_missing' });
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

  return {
    org_id: orgId,
    id_number: String(r.idNumber ?? '').trim(),
    full_name: String(r.fullName ?? '').trim(),
    gender: r.gender === 'Male' ? 'male' : r.gender === 'Female' ? 'female' : null,
    date_of_birth: toDateOnly(r.dateOfBirth),
    blood_group: blankText(r.bloodGroup),
    marital_status: blankText(r.maritalStatus),
    position_number: blankText(r.positionNumber),
    designation: String(r.designation ?? '').trim(),
    staffing_category: blankText(r.staffingCategory),
    overtime_group_name: blankText(r.overtimeGroupName),
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
    currency: String(r.currency ?? 'AFN'),
    deleted_at: null,
  };
}

const PRESERVE_WHEN_BLANK = [
  'date_of_birth',
  'blood_group',
  'marital_status',
  'position_number',
  'staffing_category',
  'overtime_group_name',
  'unit',
  'region',
  'duty_station',
  'job_location',
  'contract_type',
  'job_status',
  'employment_status',
  'contract_start_date',
  'contract_end_date',
] as const;

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

  // Minimal server-side validation + transform. RLS enforces org membership/role.
  const rows = body.records.map((r) => importRecordToDbRow(body!.orgId, r));

  const invalid = rows.find(
    (row) =>
      !row.id_number ||
      !row.full_name ||
      !row.gender ||
      !row.designation ||
      !row.department ||
      !row.joining_date
  );

  if (invalid) {
    return NextResponse.json(
      { error: 'One or more records are missing required fields.' },
      { status: 400 }
    );
  }

  // Determine caller role & scope to avoid whole-batch RLS failures.
  // RLS is still authoritative; this pre-filtering just improves UX and provides a clearer response.
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

  // Restrict by role:
  // - super_admin/head_of_hr: all
  // - hr_national: exclude Senior Management
  // - regional_hr: only assigned regions
  // - employee: no imports
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

  // IMPORTANT:
  // Employee upserts must run with consistent authentication context.
  // In some deployments the SSR client may not propagate JWT claims to PostgREST
  // during long-running imports, causing auth.uid() to be NULL and RLS to reject inserts.
  // We therefore perform the actual write using the service role, AFTER enforcing
  // the caller's role/scope in this API route.
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

  // Blank optional cells must not wipe values already stored for that employee.
  const existingByIdNumber = new Map<string, Record<string, unknown>>();
  const idNumbers = allowedRows.map((row) => row.id_number);
  for (let i = 0; i < idNumbers.length; i += 200) {
    const chunk = idNumbers.slice(i, i + 200);
    const { data: existingRows, error: existingErr } = await adminDb
      .from('employees')
      .select(['id_number', ...PRESERVE_WHEN_BLANK].join(','))
      .eq('org_id', body.orgId)
      .in('id_number', chunk);
    if (existingErr) {
      return NextResponse.json({ error: 'Unable to read existing employees before import.' }, { status: 400 });
    }
    for (const existing of (existingRows ?? []) as unknown as Array<Record<string, unknown>>) {
      existingByIdNumber.set(String(existing.id_number).toLowerCase(), existing);
    }
  }
  let updatedExisting = 0;
  for (const row of allowedRows) {
    const existing = existingByIdNumber.get(row.id_number.toLowerCase());
    if (!existing) continue;
    updatedExisting += 1;
    for (const key of PRESERVE_WHEN_BLANK) {
      if (row[key] == null || row[key] === '') {
        (row as Record<string, unknown>)[key] = existing[key] ?? null;
      }
    }
  }

  if (body.preview) {
    return NextResponse.json({
      ok: true,
      total: allowedRows.length,
      newRecords: allowedRows.length - updatedExisting,
      existingRecords: updatedExisting,
    });
  }

  // Try bulk upsert first (fast path). If it fails (e.g. missing column / one row),
  // fall back to per-row upserts so we can skip only the forbidden rows.
  let rowsForUpsert: Array<Record<string, unknown>> = allowedRows;
  let { data: bulkData, error: bulkErr } = await adminDb
    .from('employees')
    .upsert(rowsForUpsert, {
      onConflict: 'org_id,id_number',
    })
    // Request a representation so we can confirm rows were actually written.
    // Without this, a "successful" response can still hide the fact that 0 rows were affected.
    .select('id_number');

  if (bulkErr && bulkErr.code === 'PGRST204') {
    const missingColumnMessage = String(bulkErr.message ?? '');
    const stripped = rowsForUpsert.map((row) =>
      stripMissingEmployeeColumns(row, missingColumnMessage)
    );
    const changed = stripped.some((row, i) => Object.keys(row).length < Object.keys(rowsForUpsert[i]).length);
    if (changed) {
      rowsForUpsert = stripped;
      ({ data: bulkData, error: bulkErr } = await adminDb
        .from('employees')
        .upsert(rowsForUpsert, { onConflict: 'org_id,id_number' })
        .select('id_number'));
    }
  }

  let imported = Array.isArray(bulkData) ? bulkData.length : 0;
  const rlsSkipped: Array<{ idNumber: string; reason: string }> = [];

  if (bulkErr || imported === 0) {
    imported = await upsertIndividuallyWithConcurrency(
      adminDb,
      rowsForUpsert,
      16,
      rlsSkipped
    );
  }

  // Reliable Super Admin account provisioning: employee role + pending_activation.
  // Passwords are never returned or logged.
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

  const importedIdNumbers = allowedRows
    .filter((r) => !rlsSkipped.find((s) => s.idNumber === r.id_number))
    .map((r) => r.id_number);

  const batchSize = Math.min(
    MAX_PROVISION_BATCH,
    Math.max(1, Number(body!.provisionBatchSize) || DEFAULT_PROVISION_BATCH)
  );
  const offset = Math.max(0, Number(body!.provisionOffset) || 0);
  const batchIds = importedIdNumbers.slice(offset, offset + batchSize);
  const nextOffset = offset + batchIds.length;
  const hasMore = nextOffset < importedIdNumbers.length;

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
    provisionTotal: importedIdNumbers.length,
    provisionOffset: offset,
    provisionNextOffset: nextOffset,
    provisionHasMore: hasMore,
    provisionBatchSize: batchSize,
  });
}

