import { NextResponse } from 'next/server';
import { getSupabaseAdminClient } from '@/lib/supabase/admin';
import { getActiveMembership, getProtectedRequestUser } from '@/lib/api/request-auth';
import {
  RESET_PASSWORD_PERMISSION,
  hasResetPasswordPermission,
  setResetPasswordPermission,
} from '@/lib/user-management/member-permissions';
import {
  AuditStoreUnavailableError,
  auditUnavailableResponse,
  ensureAuditStoreReady,
  writeAdminAudit,
} from '@/lib/user-management/password-reset-authz';

type Body = {
  orgId?: string;
  targetUserId?: string;
  permission?: string;
  enabled?: boolean;
};

export async function POST(request: Request) {
  const { user, errorResponse } = await getProtectedRequestUser(request);
  if (errorResponse) {
    return errorResponse;
  }
  if (!user) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  let body: Body;
  try {
    body = (await request.json()) as Body;
  } catch {
    return NextResponse.json({ error: 'Invalid JSON body.' }, { status: 400 });
  }

  const orgId = String(body.orgId ?? '').trim();
  const targetUserId = String(body.targetUserId ?? '').trim();
  const permission = String(body.permission ?? '').trim();
  const enabled = Boolean(body.enabled);

  if (!orgId || !targetUserId || permission !== RESET_PASSWORD_PERMISSION) {
    return NextResponse.json({ error: 'Invalid request.' }, { status: 400 });
  }

  const membership = await getActiveMembership(orgId, user.id);
  if (!membership || membership.role !== 'super_admin') {
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
  }

  if (targetUserId === user.id) {
    return NextResponse.json(
      { error: 'Super Admin already has password reset authority.' },
      { status: 400 }
    );
  }

  const admin = getSupabaseAdminClient();

  try {
    await ensureAuditStoreReady(admin, { requireMemberPermissions: true });
  } catch (err: unknown) {
    const unavailable = auditUnavailableResponse(err);
    if (unavailable) return unavailable;
    if (err instanceof AuditStoreUnavailableError) {
      return NextResponse.json({ error: err.message }, { status: 503 });
    }
    throw err;
  }

  const { data: targetMem } = await admin
    .from('organization_members')
    .select('role,status')
    .eq('org_id', orgId)
    .eq('user_id', targetUserId)
    .maybeSingle();

  if (!targetMem) {
    return NextResponse.json({ error: 'Target user not found in organization.' }, { status: 404 });
  }

  if (String(targetMem.role) === 'super_admin') {
    return NextResponse.json(
      { error: 'Super Admin accounts do not need delegated reset permission.' },
      { status: 400 }
    );
  }

  try {
    const previousEnabled = await hasResetPasswordPermission(admin, orgId, targetUserId);
    if (previousEnabled === enabled) {
      return NextResponse.json({
        ok: true,
        permission: RESET_PASSWORD_PERMISSION,
        enabled,
        unchanged: true,
      });
    }

    await setResetPasswordPermission(admin, orgId, targetUserId, enabled, user.id);
    try {
      await writeAdminAudit(admin, {
        orgId,
        actorUserId: user.id,
        targetUserId,
        action: enabled ? 'permission_granted' : 'permission_revoked',
        success: true,
        details: { permission: RESET_PASSWORD_PERMISSION },
      });
    } catch (auditErr) {
      // Restore the actual previous permission state (not the inverse of the request).
      try {
        await setResetPasswordPermission(
          admin,
          orgId,
          targetUserId,
          previousEnabled,
          user.id
        );
      } catch {
        return NextResponse.json(
          {
            ok: false,
            error:
              'Permission was changed but the audit log failed and automatic rollback also failed. Contact support immediately.',
            partial: true,
          },
          { status: 500 }
        );
      }
      throw auditErr;
    }
  } catch (err: unknown) {
    const unavailable = auditUnavailableResponse(err);
    if (unavailable) return unavailable;
    if (err instanceof AuditStoreUnavailableError) {
      return NextResponse.json({ error: err.message }, { status: 503 });
    }
    return NextResponse.json({ error: 'Unable to update permission.' }, { status: 400 });
  }

  return NextResponse.json({ ok: true, permission: RESET_PASSWORD_PERMISSION, enabled });
}
