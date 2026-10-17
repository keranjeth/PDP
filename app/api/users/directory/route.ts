import { NextResponse } from 'next/server';
import { getSupabaseAdminClient } from '@/lib/supabase/admin';
import { getActiveMembership, getProtectedRequestUser } from '@/lib/api/request-auth';
import {
  fetchOrgResetPasswordGrants,
  hasResetPasswordPermission,
} from '@/lib/user-management/member-permissions';
import { fetchOrgMemberViews } from '@/lib/user-management/org-members';

/**
 * Server-side user directory for Super Admin and delegated password-resetters.
 * Avoids broadening RLS profile/member SELECT to all authenticated users.
 */
export async function GET(request: Request) {
  const { user, errorResponse } = await getProtectedRequestUser(request);
  if (errorResponse) {
    return errorResponse;
  }
  if (!user) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  const orgId = new URL(request.url).searchParams.get('orgId')?.trim() ?? '';
  if (!orgId) {
    return NextResponse.json({ error: 'orgId is required.' }, { status: 400 });
  }

  const membership = await getActiveMembership(orgId, user.id);
  if (!membership) {
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
  }

  try {
    const admin = getSupabaseAdminClient();
    const isSuperAdmin = membership.role === 'super_admin';
    const delegated = isSuperAdmin
      ? true
      : await hasResetPasswordPermission(admin, orgId, user.id);

    if (!isSuperAdmin && !delegated) {
      return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
    }

    const members = await fetchOrgMemberViews(admin, orgId);
    const grants = isSuperAdmin
      ? Array.from(await fetchOrgResetPasswordGrants(admin, orgId))
      : [];

    // Delegated regional_hr: only linked employees in their regions
    let filtered = members;
    if (!isSuperAdmin && membership.role === 'regional_hr') {
      const { data: regions } = await admin
        .from('organization_member_regions')
        .select('region')
        .eq('org_id', orgId)
        .eq('user_id', user.id);
      const allowed = new Set(
        ((regions ?? []) as Array<{ region: string }>).map((r) => String(r.region).trim())
      );
      filtered = members.filter((m) => {
        if (m.role === 'super_admin') return false;
        const region = m.linkedEmployee?.region?.trim();
        return Boolean(region && allowed.has(region));
      });
    } else if (!isSuperAdmin) {
      filtered = members.filter((m) => m.role !== 'super_admin');
    }

    return NextResponse.json({
      ok: true,
      canResetPasswords: Boolean(isSuperAdmin || delegated),
      isSuperAdmin,
      resetGrants: grants,
      members: filtered,
    });
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : 'Failed to load users.';
    console.error('User directory failed:', err);
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
