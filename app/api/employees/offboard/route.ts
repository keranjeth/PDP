import { NextResponse } from 'next/server';
import { cookies } from 'next/headers';
import { createServerClient } from '@supabase/ssr';
import { getSupabaseAdminClient } from '@/lib/supabase/admin';
import { guardProtectedApiUser } from '@/lib/api/request-auth';

type OffboardRequestBody = {
  orgId: string;
  employeeId: string;
  lastWorkingDate: string; // YYYY-MM-DD
  exitType: string;
  leavingReason?: string;
  eligibleForRehire: boolean;
  rehireNote?: string | null;
};

type EmployeeStatusRow = {
  employment_status: 'active' | 'inactive' | null;
};

type SeparationExitType =
  | 'resignation'
  | 'termination'
  | 'retirement'
  | 'end_of_contract'
  | 'death'
  | 'redundancy'
  | 'other';

const SEPARATION_EXIT_TYPES = new Set<string>([
  'resignation',
  'termination',
  'retirement',
  'end_of_contract',
  'death',
  'redundancy',
  'other',
]);

function isIsoDateOnly(value: string) {
  return /^\d{4}-\d{2}-\d{2}$/.test(value);
}

function normalizeExitType(value: string): SeparationExitType | null {
  const normalized = value.trim().toLowerCase();
  return SEPARATION_EXIT_TYPES.has(normalized)
    ? (normalized as SeparationExitType)
    : null;
}

export async function POST(request: Request) {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY;
  if (!url || !key) {
    return NextResponse.json({ error: 'Supabase is not configured.' }, { status: 500 });
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

  let body: OffboardRequestBody | null = null;
  try {
    body = (await request.json()) as OffboardRequestBody;
  } catch {
    return NextResponse.json({ error: 'Invalid JSON body.' }, { status: 400 });
  }

  if (!body?.orgId || !body.employeeId) {
    return NextResponse.json({ error: 'orgId and employeeId are required.' }, { status: 400 });
  }
  if (!body.lastWorkingDate || !isIsoDateOnly(body.lastWorkingDate)) {
    return NextResponse.json({ error: 'lastWorkingDate must be YYYY-MM-DD.' }, { status: 400 });
  }
  if (!body.exitType || typeof body.exitType !== 'string') {
    return NextResponse.json({ error: 'exitType is required.' }, { status: 400 });
  }
  const exitType = normalizeExitType(body.exitType);
  if (!exitType) {
    return NextResponse.json({ error: 'Unsupported exitType.' }, { status: 400 });
  }
  if (body.eligibleForRehire === false) {
    const note = String(body.rehireNote ?? '').trim();
    if (!note) {
      return NextResponse.json(
        { error: 'rehireNote is required when eligibleForRehire is false.' },
        { status: 400 }
      );
    }
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

  const canOffboard =
    role === 'super_admin' ||
    role === 'head_of_hr' ||
    role === 'hr_national' ||
    role === 'regional_hr';

  if (!canOffboard) {
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
  }

  const admin = getSupabaseAdminClient();
  const { data: employeeRow, error: employeeErr } = await admin
    .from('employees')
    .select('employment_status')
    .eq('org_id', body.orgId)
    .eq('id', body.employeeId)
    .maybeSingle();

  if (employeeErr) {
    return NextResponse.json({ error: employeeErr.message }, { status: 400 });
  }

  const existingEmployee = employeeRow as EmployeeStatusRow | null;
  if (!existingEmployee) {
    return NextResponse.json({ error: 'Employee not found.' }, { status: 404 });
  }
  if (existingEmployee.employment_status === 'inactive') {
    return NextResponse.json({ error: 'Employee is already offboarded.' }, { status: 400 });
  }

  const leavingReason = String(body.leavingReason ?? '').trim();
  const rehireNote = body.eligibleForRehire ? '' : String(body.rehireNote ?? '').trim();

  const { data: leaverId, error: offboardErr } = await admin.rpc(
    'offboard_employee',
    {
      p_org_id: body.orgId,
      p_employee_id: body.employeeId,
      p_last_working_date: body.lastWorkingDate,
      p_exit_type: exitType,
      p_leaving_reason: leavingReason,
      p_offboarded_by: user.id,
      p_eligible_for_rehire: body.eligibleForRehire,
      p_rehire_note: rehireNote,
    }
  );

  if (offboardErr) {
    const msg = offboardErr.message || 'Offboarding failed.';
    const status = msg.toLowerCase().includes('not found') ? 404 : 400;
    return NextResponse.json({ error: msg }, { status });
  }

  const leaverIdValue =
    leaverId != null && String(leaverId).trim() !== ''
      ? String(leaverId).trim()
      : null;
  const approvedAt = new Date().toISOString();

  const separationPayload = {
    org_id: body.orgId,
    employee_id: body.employeeId,
    leaver_id: leaverIdValue,
    exit_type: exitType,
    reason_code: leavingReason || null,
    last_working_date: body.lastWorkingDate,
    notice_required_days: 0,
    notice_served_days: 0,
    notice_action: 'none',
    eligible_for_leave_encashment: false,
    eligible_for_termination_benefit: false,
    status: 'ready_for_payroll',
    notes: [
      leavingReason ? `Leaving reason: ${leavingReason}` : '',
      body.eligibleForRehire ? 'Eligible for rehire: yes' : 'Eligible for rehire: no',
      rehireNote ? `Rehire note: ${rehireNote}` : '',
    ]
      .filter(Boolean)
      .join('\n'),
    created_by: user.id,
    updated_by: user.id,
    approved_at: approvedAt,
    approved_by: user.id,
  };

  const { data: existingCase, error: existingCaseErr } = await admin
    .from('separation_cases')
    .select('id,status')
    .eq('org_id', body.orgId)
    .eq('employee_id', body.employeeId)
    .in('status', ['draft', 'pending_approval', 'approved', 'ready_for_payroll'])
    .maybeSingle();

  if (existingCaseErr) {
    return NextResponse.json({ error: existingCaseErr.message }, { status: 400 });
  }

  const separationCaseId = (existingCase as { id?: string } | null)?.id;
  const separationCaseResult = separationCaseId
    ? await admin
        .from('separation_cases')
        .update({
          org_id: separationPayload.org_id,
          employee_id: separationPayload.employee_id,
          leaver_id: separationPayload.leaver_id,
          exit_type: separationPayload.exit_type,
          reason_code: separationPayload.reason_code,
          last_working_date: separationPayload.last_working_date,
          notice_required_days: separationPayload.notice_required_days,
          notice_served_days: separationPayload.notice_served_days,
          notice_action: separationPayload.notice_action,
          eligible_for_leave_encashment:
            separationPayload.eligible_for_leave_encashment,
          eligible_for_termination_benefit:
            separationPayload.eligible_for_termination_benefit,
          status: separationPayload.status,
          notes: separationPayload.notes,
          updated_by: separationPayload.updated_by,
          approved_at: separationPayload.approved_at,
          approved_by: separationPayload.approved_by,
        })
        .eq('org_id', body.orgId)
        .eq('id', separationCaseId)
        .select('id')
        .single()
    : await admin
        .from('separation_cases')
        .insert(separationPayload)
        .select('id')
        .single();

  if (separationCaseResult.error) {
    return NextResponse.json(
      {
        error: separationCaseResult.error.message,
        offboarded: true,
        leaverId: leaverIdValue,
      },
      { status: 207 }
    );
  }

  return NextResponse.json({
    ok: true,
    leaverId: leaverIdValue,
    separationCaseId: String(
      (separationCaseResult.data as { id?: string } | null)?.id ?? ''
    ),
  });
}

