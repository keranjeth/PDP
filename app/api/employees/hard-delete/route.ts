import { NextResponse } from 'next/server';
import { cookies } from 'next/headers';
import { createServerClient } from '@supabase/ssr';
import { getSupabaseAdminClient } from '@/lib/supabase/admin';
import { guardProtectedApiUser } from '@/lib/api/request-auth';

export const maxDuration = 300;

type HardDeleteRequestBody = {
  orgId: string;
  employeeIds: string[];
};

type HardDeleteResult = {
  employeeId: string;
  ok: boolean;
  error?: string;
  fullName?: string;
  idNumber?: string;
  linkedUserId?: string | null;
};

type DeletedRow = {
  employeeId?: string;
  fullName?: string;
  idNumber?: string;
  linkedUserId?: string | null;
};

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

  let body: HardDeleteRequestBody | null = null;
  try {
    body = (await request.json()) as HardDeleteRequestBody;
  } catch {
    return NextResponse.json({ error: 'Invalid JSON body.' }, { status: 400 });
  }

  const orgId = String(body?.orgId ?? '').trim();
  const employeeIds = Array.from(
    new Set(
      (Array.isArray(body?.employeeIds) ? body!.employeeIds : [])
        .map((id) => String(id ?? '').trim())
        .filter(Boolean)
    )
  );

  if (!orgId) {
    return NextResponse.json({ error: 'orgId is required.' }, { status: 400 });
  }
  if (employeeIds.length === 0) {
    return NextResponse.json({ error: 'employeeIds is required.' }, { status: 400 });
  }

  const { data: membership, error: memErr } = await supabase
    .from('organization_members')
    .select('role,status')
    .eq('org_id', orgId)
    .eq('user_id', user.id)
    .maybeSingle();

  if (memErr) {
    return NextResponse.json({ error: memErr.message }, { status: 400 });
  }

  if (
    !membership ||
    String(membership.status ?? '') !== 'active' ||
    String(membership.role ?? '') !== 'super_admin'
  ) {
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
  }

  const admin = getSupabaseAdminClient();

  // One set-based RPC — avoids N round-trips that made large deletes slow.
  const { data, error } = await admin.rpc('hard_delete_employees', {
    p_org_id: orgId,
    p_employee_ids: employeeIds,
    p_deleted_by: user.id,
  });

  if (error) {
    console.error('hard_delete_employees failed:', error);
    const missing =
      error.code === 'PGRST202' ||
      /hard_delete_employees|schema cache|could not find the function/i.test(
        String(error.message ?? '')
      );
    const detail = String(error.message ?? '').trim();
    return NextResponse.json(
      {
        error: missing
          ? 'Bulk delete is not available yet. Apply the PD Plan baseline migration, then retry.'
          : detail
            ? `Permanent delete failed: ${detail}`
            : 'Permanent delete failed.',
      },
      { status: missing ? 503 : 400 }
    );
  }

  const payload = (data ?? {}) as {
    deleted?: DeletedRow[];
    deletedCount?: number;
  };
  const deletedRows = Array.isArray(payload.deleted) ? payload.deleted : [];
  const deletedIdSet = new Set(
    deletedRows.map((r) => String(r.employeeId ?? '').trim()).filter(Boolean)
  );

  const results: HardDeleteResult[] = employeeIds.map((employeeId) => {
    if (!deletedIdSet.has(employeeId)) {
      return { employeeId, ok: false, error: 'Employee not found.' };
    }
    const row = deletedRows.find((r) => String(r.employeeId) === employeeId);
    return {
      employeeId,
      ok: true,
      fullName: row?.fullName,
      idNumber: row?.idNumber,
      linkedUserId: row?.linkedUserId ?? null,
    };
  });

  // Auth cleanup for linked logins that no longer have any active membership.
  const linkedUserIds = Array.from(
    new Set(
      deletedRows
        .map((r) => (r.linkedUserId ? String(r.linkedUserId) : ''))
        .filter(Boolean)
    )
  );

  if (linkedUserIds.length > 0) {
    const { data: stillActive, error: activeErr } = await admin
      .from('organization_members')
      .select('user_id')
      .in('user_id', linkedUserIds)
      .neq('status', 'inactive');

    const stillActiveSet = new Set(
      activeErr
        ? linkedUserIds
        : ((stillActive ?? []) as Array<{ user_id: string }>).map((r) => String(r.user_id))
    );

    const toRemove = linkedUserIds.filter((id) => !stillActiveSet.has(id));
    // Bounded parallel Auth deletes (Auth API has no bulk delete).
    const CONCURRENCY = 10;
    for (let i = 0; i < toRemove.length; i += CONCURRENCY) {
      const chunk = toRemove.slice(i, i + CONCURRENCY);
      await Promise.all(
        chunk.map(async (linkedUserId) => {
          const { error: authDelErr } = await admin.auth.admin.deleteUser(linkedUserId);
          if (!authDelErr) return;
          for (const r of results) {
            if (r.ok && r.linkedUserId === linkedUserId) {
              r.error = `Employee deleted; auth user cleanup failed: ${authDelErr.message}`;
            }
          }
        })
      );
    }
  }

  const failed = results.filter((r) => !r.ok);
  const succeeded = results.filter((r) => r.ok);

  return NextResponse.json({
    ok: failed.length === 0,
    deletedCount: succeeded.length,
    failedCount: failed.length,
    results,
  });
}
