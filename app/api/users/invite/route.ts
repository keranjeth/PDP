import { NextResponse, type NextRequest } from 'next/server';
import { createServerClient } from '@supabase/ssr';
import { cookies } from 'next/headers';
import { getSupabaseAdminClient } from '@/lib/supabase/admin';
import { generateEmployeeEmail, normalizeEmployeeId } from '@/lib/users/provisioning';
import { provisionEmployeeAccountPending } from '@/lib/user-management/account-lifecycle';
import { guardProtectedApiUser } from '@/lib/api/request-auth';

type InviteUserRequest = {
  orgId: string;
  email: string;
  fullName: string;
  role: 'super_admin' | 'hr_national' | 'head_of_hr' | 'regional_hr' | 'employee';
  regions?: string[];
  employeeId?: string | null;
};

export async function POST(request: NextRequest) {
  try {
    const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
    const publishableKey = process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY;
    if (!url || !publishableKey) {
      return NextResponse.json({ error: 'Supabase is not configured.' }, { status: 500 });
    }

    const cookieStore = await cookies();
    const sessionSupabase = createServerClient(url, publishableKey, {
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
      data: { user: caller },
    } = await sessionSupabase.auth.getUser();
    if (!caller) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    const blocked = await guardProtectedApiUser(caller, sessionSupabase);
    if (blocked) {
      return blocked;
    }

    const body = (await request.json()) as InviteUserRequest;

    const orgId = String(body.orgId ?? '').trim();
    const fullName = String(body.fullName ?? '').trim();
    const regions = (body.regions ?? []).map((r) => String(r).trim()).filter(Boolean);
    // employeeId may be employees.id (uuid) from profile invite, or id_number.
    const employeeRef = body.employeeId ? String(body.employeeId).trim() : null;

    if (!orgId || !fullName) {
      return NextResponse.json({ error: 'Missing required fields.' }, { status: 400 });
    }

    const { data: mem, error: memCheckErr } = await sessionSupabase
      .from('organization_members')
      .select('role,status')
      .eq('org_id', orgId)
      .eq('user_id', caller.id)
      .maybeSingle();

    if (memCheckErr) {
      return NextResponse.json({ error: memCheckErr.message }, { status: 400 });
    }
    if (!mem || mem.status !== 'active' || mem.role !== 'super_admin') {
      return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
    }

    const supabase = getSupabaseAdminClient();

    // Employee-linked invite → EmployeeID@workforce.local + pending_activation (no email invite).
    if (employeeRef) {
      const { data: empById } = await supabase
        .from('employees')
        .select('id,id_number,full_name')
        .eq('org_id', orgId)
        .eq('id', employeeRef)
        .maybeSingle();

      let emp = empById;
      if (!emp) {
        const idNumber = normalizeEmployeeId(employeeRef);
        const { data: empByNumber } = await supabase
          .from('employees')
          .select('id,id_number,full_name')
          .eq('org_id', orgId)
          .eq('id_number', idNumber)
          .maybeSingle();
        emp = empByNumber;
      }

      if (!emp) {
        return NextResponse.json({ error: 'Employee not found.' }, { status: 404 });
      }

      const result = await provisionEmployeeAccountPending({
        admin: supabase,
        orgId,
        employeeUuid: String(emp.id),
        idNumber: String(emp.id_number),
        fullName: String(emp.full_name || fullName),
      });

      if (result.outcome === 'failed') {
        return NextResponse.json({ error: result.reason }, { status: 400 });
      }

      return NextResponse.json({
        success: true,
        userId: result.userId,
        username: result.email || generateEmployeeEmail(emp.id_number),
        status: 'pending_activation',
        outcome: result.outcome,
      });
    }

    const email = String(body.email ?? '').trim().toLowerCase();
    const role = body.role;
    if (!email || !role) {
      return NextResponse.json({ error: 'Missing required fields.' }, { status: 400 });
    }

    // Standard Employee accounts require a linked employee record (Pending Activation path).
    if (role === 'employee') {
      return NextResponse.json(
        {
          error:
            'Standard Employee accounts must be linked to an employee record. Use employee provisioning or invite with an employee association.',
        },
        { status: 400 }
      );
    }

    // Staff / admin invite path (deliverable email) — not for employee synthetic accounts.
    if (email.endsWith('@workforce.local')) {
      return NextResponse.json(
        {
          error:
            'Employee accounts must be provisioned via an employee link (Pending Activation).',
        },
        { status: 400 }
      );
    }

    const { data: invited, error: inviteErr } = await supabase.auth.admin.inviteUserByEmail(
      email,
      {
        data: {
          full_name: fullName,
        },
      }
    );

    if (inviteErr) {
      return NextResponse.json({ error: inviteErr.message }, { status: 400 });
    }

    const userId = invited?.user?.id;
    if (!userId) {
      return NextResponse.json({ error: 'Invite failed: no user id returned.' }, { status: 500 });
    }

    const { error: metaErr } = await supabase.auth.admin.updateUserById(userId, {
      app_metadata: { must_change_password: true },
    });
    if (metaErr) {
      return NextResponse.json({ error: metaErr.message }, { status: 400 });
    }

    const { error: profErr } = await supabase.from('profiles').upsert(
      {
        user_id: userId,
        full_name: fullName,
        email,
      },
      { onConflict: 'user_id' }
    );
    if (profErr) {
      return NextResponse.json({ error: profErr.message }, { status: 400 });
    }

    const { error: membershipUpsertErr } = await supabase.from('organization_members').upsert(
      {
        org_id: orgId,
        user_id: userId,
        role,
        status: 'active',
      },
      { onConflict: 'org_id,user_id' }
    );
    if (membershipUpsertErr) {
      return NextResponse.json({ error: membershipUpsertErr.message }, { status: 400 });
    }

    if (role === 'regional_hr') {
      if (regions.length === 0) {
        return NextResponse.json(
          { error: 'Regional HR requires at least one region assignment.' },
          { status: 400 }
        );
      }
      const { error: regionErr } = await supabase
        .from('organization_member_regions')
        .insert(regions.map((region) => ({ org_id: orgId, user_id: userId, region })));
      if (regionErr) {
        return NextResponse.json({ error: regionErr.message }, { status: 400 });
      }
    }

    return NextResponse.json({ success: true, userId });
  } catch (err: unknown) {
    return NextResponse.json(
      { error: err instanceof Error ? err.message : 'Internal server error' },
      { status: 500 }
    );
  }
}

