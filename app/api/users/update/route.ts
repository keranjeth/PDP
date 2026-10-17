import { NextResponse } from 'next/server';
import { getSupabaseAdminClient } from '@/lib/supabase/admin';
import { getActiveMembership, getProtectedRequestUser } from '@/lib/api/request-auth';
import {
  AuditStoreUnavailableError,
  auditUnavailableResponse,
  ensureAuditStoreReady,
  writeAdminAudit,
} from '@/lib/user-management/password-reset-authz';
import {
  RESET_PASSWORD_PERMISSION,
  hasResetPasswordPermission,
  setResetPasswordPermission,
} from '@/lib/user-management/member-permissions';
import { setMemberRegions } from '@/lib/user-management/org-members';
import type { OrgMemberRole } from '@/lib/user-management/types';

type Body = {
  orgId?: string;
  targetUserId?: string;
  role?: OrgMemberRole;
  regions?: string[];
  /** Only active → inactive is allowed here. Activation/reactivation use /api/users/activate. */
  deactivate?: boolean;
  allowPasswordReset?: boolean;
};

const ROLE_OPTIONS: OrgMemberRole[] = [
  'super_admin',
  'hr_national',
  'head_of_hr',
  'regional_hr',
  'employee',
];

type AdminClient = ReturnType<typeof getSupabaseAdminClient>;

/**
 * Server-authorized Edit User updates (role, regions, deactivate, reset permission).
 * Uses service role for writes after Super Admin checks.
 * Audit store is verified before mutations; audit failures are never ignored.
 */
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
  if (!orgId || !targetUserId) {
    return NextResponse.json({ error: 'Invalid request.' }, { status: 400 });
  }

  const membership = await getActiveMembership(orgId, user.id);
  if (!membership || membership.role !== 'super_admin') {
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
  }

  const admin = getSupabaseAdminClient();

  const { data: targetMem, error: targetErr } = await admin
    .from('organization_members')
    .select('role,status')
    .eq('org_id', orgId)
    .eq('user_id', targetUserId)
    .maybeSingle();

  if (targetErr || !targetMem) {
    return NextResponse.json({ error: 'User not found in organization.' }, { status: 404 });
  }

  const targetRole = String(targetMem.role) as OrgMemberRole;
  const targetStatus = String(targetMem.status);
  const applied: string[] = [];
  const failedSteps: string[] = [];

  const wantsRole = Boolean(body.role && body.role !== targetRole);
  const wantsDeactivate = body.deactivate === true;
  const wantsRegions = Array.isArray(body.regions);
  const wantsPermission =
    typeof body.allowPasswordReset === 'boolean' && targetRole !== 'super_admin';

  if (!wantsRole && !wantsDeactivate && !wantsRegions && !wantsPermission) {
    return NextResponse.json({ ok: true, applied, message: 'No changes requested.' });
  }

  try {
    await ensureAuditStoreReady(admin, {
      requireMemberPermissions: wantsPermission,
    });

    if (wantsRole) {
      const newRole = body.role as OrgMemberRole;
      if (!ROLE_OPTIONS.includes(newRole)) {
        return NextResponse.json({ error: 'Invalid role.' }, { status: 400 });
      }
      if (targetRole === 'super_admin' && newRole !== 'super_admin') {
        return NextResponse.json(
          { error: 'Super Admin role cannot be changed from Edit User.' },
          { status: 400 }
        );
      }
      if (newRole === 'regional_hr') {
        const regions = (body.regions ?? []).map((r) => String(r).trim()).filter(Boolean);
        if (regions.length === 0) {
          return NextResponse.json(
            { error: 'Regional HR requires at least one region.' },
            { status: 400 }
          );
        }
      }

      const { error } = await admin
        .from('organization_members')
        .update({ role: newRole })
        .eq('org_id', orgId)
        .eq('user_id', targetUserId);
      if (error) {
        return NextResponse.json(
          { error: 'Unable to update role.', applied, partial: applied.length > 0 },
          { status: 400 }
        );
      }

      try {
        await writeAdminAudit(admin, {
          orgId,
          actorUserId: user.id,
          targetUserId,
          action: 'user_role_updated',
          success: true,
          details: { from: targetRole, to: newRole },
        });
        applied.push('role');
      } catch (auditErr) {
        const { error: revertErr } = await admin
          .from('organization_members')
          .update({ role: targetRole })
          .eq('org_id', orgId)
          .eq('user_id', targetUserId);
        failedSteps.push('role_audit');
        if (revertErr) {
          return NextResponse.json(
            {
              ok: false,
              error:
                'Role was changed but the audit log failed and automatic rollback also failed. Contact support immediately.',
              applied,
              partial: true,
              failedSteps,
            },
            { status: 500 }
          );
        }
        throw auditErr;
      }
    }

    if (wantsDeactivate) {
      if (targetStatus !== 'active') {
        return NextResponse.json(
          {
            error: 'Only Active accounts can be deactivated from Edit User.',
            applied,
            partial: applied.length > 0,
          },
          { status: 400 }
        );
      }
      if (targetUserId === user.id) {
        return NextResponse.json(
          { error: 'You cannot deactivate your own account.', applied, partial: applied.length > 0 },
          { status: 400 }
        );
      }

      const { error } = await admin
        .from('organization_members')
        .update({ status: 'inactive' })
        .eq('org_id', orgId)
        .eq('user_id', targetUserId);
      if (error) {
        return NextResponse.json(
          { error: 'Unable to deactivate user.', applied, partial: applied.length > 0 },
          { status: 400 }
        );
      }

      try {
        await writeAdminAudit(admin, {
          orgId,
          actorUserId: user.id,
          targetUserId,
          action: 'user_deactivated',
          success: true,
          details: {},
        });
        applied.push('deactivate');
      } catch (auditErr) {
        const { error: revertErr } = await admin
          .from('organization_members')
          .update({ status: 'active' })
          .eq('org_id', orgId)
          .eq('user_id', targetUserId);
        failedSteps.push('deactivate_audit');
        if (revertErr) {
          return NextResponse.json(
            {
              ok: false,
              error:
                'Account was deactivated but the audit log failed and automatic rollback also failed. Contact support immediately.',
              applied,
              partial: true,
              failedSteps,
            },
            { status: 500 }
          );
        }
        throw auditErr;
      }
    }

    const effectiveRole = (body.role ?? targetRole) as OrgMemberRole;
    if (wantsRegions) {
      const previousRegions = await loadMemberRegions(admin, orgId, targetUserId);
      const nextRegions =
        effectiveRole !== 'regional_hr'
          ? []
          : body.regions!.map((r) => String(r).trim()).filter(Boolean);

      if (effectiveRole === 'regional_hr' && nextRegions.length === 0) {
        return NextResponse.json(
          {
            error: 'Regional HR requires at least one region.',
            applied,
            partial: applied.length > 0,
          },
          { status: 400 }
        );
      }

      try {
        await setMemberRegions(admin, orgId, targetUserId, nextRegions);
      } catch {
        return NextResponse.json(
          {
            error: 'Unable to update regional assignments.',
            applied,
            partial: applied.length > 0,
          },
          { status: 400 }
        );
      }

      try {
        await writeAdminAudit(admin, {
          orgId,
          actorUserId: user.id,
          targetUserId,
          action: 'user_regions_updated',
          success: true,
          details: { from: previousRegions, to: nextRegions },
        });
        applied.push(effectiveRole === 'regional_hr' ? 'regions' : 'regions_cleared');
      } catch (auditErr) {
        failedSteps.push('regions_audit');
        try {
          await setMemberRegions(admin, orgId, targetUserId, previousRegions);
        } catch {
          return NextResponse.json(
            {
              ok: false,
              error:
                'Regional assignments were changed but the audit log failed and automatic rollback also failed. Contact support immediately.',
              applied,
              partial: true,
              failedSteps,
            },
            { status: 500 }
          );
        }
        throw auditErr;
      }
    }

    if (wantsPermission) {
      const previousPermission = await hasResetPasswordPermission(admin, orgId, targetUserId);
      const nextPermission = Boolean(body.allowPasswordReset);

      if (previousPermission !== nextPermission) {
        await setResetPasswordPermission(
          admin,
          orgId,
          targetUserId,
          nextPermission,
          user.id
        );

        try {
          await writeAdminAudit(admin, {
            orgId,
            actorUserId: user.id,
            targetUserId,
            action: nextPermission ? 'permission_granted' : 'permission_revoked',
            success: true,
            details: { permission: RESET_PASSWORD_PERMISSION },
          });
          applied.push('allowPasswordReset');
        } catch (auditErr) {
          failedSteps.push('permission_audit');
          try {
            await setResetPasswordPermission(
              admin,
              orgId,
              targetUserId,
              previousPermission,
              user.id
            );
          } catch {
            return NextResponse.json(
              {
                ok: false,
                error:
                  'Password-reset permission was changed but the audit log failed and automatic rollback also failed. Contact support immediately.',
                applied,
                partial: true,
                failedSteps,
              },
              { status: 500 }
            );
          }
          throw auditErr;
        }
      }
    }

    return NextResponse.json({ ok: true, applied });
  } catch (err: unknown) {
    const unavailable = auditUnavailableResponse(err);
    if (unavailable) return unavailable;
    if (err instanceof AuditStoreUnavailableError) {
      return NextResponse.json({ error: err.message }, { status: 503 });
    }
    const message = err instanceof Error ? err.message : 'Unable to update user.';
    return NextResponse.json(
      {
        ok: false,
        error: message,
        applied,
        partial: applied.length > 0,
        failedSteps: failedSteps.length > 0 ? failedSteps : undefined,
      },
      { status: applied.length > 0 ? 500 : 400 }
    );
  }
}

async function loadMemberRegions(
  admin: AdminClient,
  orgId: string,
  userId: string
): Promise<string[]> {
  const { data, error } = await admin
    .from('organization_member_regions')
    .select('region')
    .eq('org_id', orgId)
    .eq('user_id', userId);
  if (error) throw error;
  return ((data ?? []) as Array<{ region: string }>).map((r) => String(r.region).trim()).filter(Boolean);
}
