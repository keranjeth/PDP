import { NextResponse, type NextRequest } from 'next/server';
import { createServerClient } from '@supabase/ssr';
import { cookies } from 'next/headers';
import { getSupabaseAdminClient } from '@/lib/supabase/admin';
import {
  generateEmployeeEmail,
  generateEmployeeTempPassword,
  normalizeEmployeeId,
} from '@/lib/users/provisioning';
import { guardProtectedApiUser } from '@/lib/api/request-auth';

type CreateUserRequest = {
  orgId: string;
  email: string;
  password: string;
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

    const body = (await request.json()) as CreateUserRequest;
    const orgId = String(body.orgId ?? '').trim();
    const employeeId = body.employeeId ? normalizeEmployeeId(body.employeeId) : null;
    const email = employeeId
      ? generateEmployeeEmail(employeeId)
      : String(body.email ?? '').trim().toLowerCase();
    const password = employeeId
      ? generateEmployeeTempPassword(employeeId)
      : String(body.password ?? '').trim();
    const fullName = String(body.fullName ?? '').trim();
    // Employee-linked accounts always get standard employee role + pending activation.
    const role = employeeId ? 'employee' : body.role;
    const memberStatus = employeeId ? 'pending_activation' : 'active';
    const regions = (body.regions ?? []).map((r) => String(r).trim()).filter(Boolean);

    if (!orgId || !email || !password || !fullName || !role) {
      return NextResponse.json({ error: 'Missing required fields.' }, { status: 400 });
    }

    if (role === 'employee' && !employeeId) {
      return NextResponse.json(
        {
          error:
            'Standard Employee accounts must be linked to an employee record (Pending Activation).',
        },
        { status: 400 }
      );
    }

    const { data: mem, error: memErr } = await sessionSupabase
      .from('organization_members')
      .select('role,status')
      .eq('org_id', orgId)
      .eq('user_id', caller.id)
      .maybeSingle();

    if (memErr) {
      return NextResponse.json({ error: memErr.message }, { status: 400 });
    }
    if (!mem || mem.status !== 'active' || mem.role !== 'super_admin') {
      return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
    }

    const admin = getSupabaseAdminClient();

    // Create auth user (email/password) so default password works immediately.
    const { data: created, error: createErr } = await admin.auth.admin.createUser({
      email,
      password,
      email_confirm: true,
      user_metadata: {
        full_name: fullName,
      },
      app_metadata: employeeId
        ? { must_change_password: false, account_provisioned: true }
        : { must_change_password: true },
    });

    if (createErr) {
      if (employeeId && /already registered/i.test(createErr.message)) {
        return NextResponse.json(
          { error: `User already exists for employee ${employeeId}.` },
          { status: 400 }
        );
      }
      return NextResponse.json({ error: createErr.message }, { status: 400 });
    }

    const userId = created.user?.id;
    if (!userId) {
      return NextResponse.json({ error: 'Create failed: no user id returned.' }, { status: 500 });
    }

    // Profile row for UI display.
    const { error: profErr } = await admin.from('profiles').upsert(
      { user_id: userId, full_name: fullName, email },
      { onConflict: 'user_id' }
    );
    if (profErr) {
      return NextResponse.json({ error: profErr.message }, { status: 400 });
    }

    const { error: memUpsertErr } = await admin.from('organization_members').upsert(
      { org_id: orgId, user_id: userId, role, status: memberStatus },
      { onConflict: 'org_id,user_id' }
    );
    if (memUpsertErr) {
      return NextResponse.json({ error: memUpsertErr.message }, { status: 400 });
    }

    if (role === 'regional_hr') {
      if (regions.length === 0) {
        return NextResponse.json(
          { error: 'Regional HR requires at least one region assignment.' },
          { status: 400 }
        );
      }
      const { error } = await admin
        .from('organization_member_regions')
        .insert(regions.map((region) => ({ org_id: orgId, user_id: userId, region })));
      if (error) {
        return NextResponse.json({ error: error.message }, { status: 400 });
      }
    }

    if (employeeId) {
      const { error } = await admin.from('employee_user_links').insert({
        org_id: orgId,
        user_id: userId,
        employee_id: employeeId,
      });
      if (error) {
        return NextResponse.json({ error: error.message }, { status: 400 });
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

