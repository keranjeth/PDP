import { NextResponse } from 'next/server';
import { getSupabaseAdminClient } from '@/lib/supabase/admin';
import { getActiveMembership, getProtectedRequestUser } from '@/lib/api/request-auth';
import {
  AuditStoreUnavailableError,
  auditUnavailableResponse,
  countRecentAdminActions,
  ensureAuditStoreReady,
  writeAdminAudit,
} from '@/lib/user-management/password-reset-authz';
import { hasResetPasswordPermission } from '@/lib/user-management/member-permissions';
import { issueTemporaryPasswordAndFlag } from '@/lib/user-management/account-lifecycle';
import { generateEmployeeEmail } from '@/lib/users/provisioning';
import type { OrgMemberRole } from '@/lib/user-management/types';

type Body = {
  orgId?: string;
  targetUserId?: string;
  /**
   * activate / reactivate: issue temporary password then set Active.
   * finalize: complete status update only after password was already issued
   * (no new password; prevents duplicate credential issuance on retry).
   */
  mode?: 'activate' | 'reactivate' | 'finalize';
};

const RATE_WINDOW_MS = 15 * 60 * 1000;
const RATE_LIMIT = 10;

/**
 * Activate (or reactivate) an account: issue a one-time temporary password,
 * set must_change_password, then flip membership to active.
 * Reuses users.reset_password delegated permission (server-enforced).
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
  const mode =
    body.mode === 'reactivate' ? 'reactivate' : body.mode === 'finalize' ? 'finalize' : 'activate';
  if (!orgId || !targetUserId) {
    return NextResponse.json({ error: 'Invalid request.' }, { status: 400 });
  }

  const membership = await getActiveMembership(orgId, user.id);
  if (!membership) {
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
  }

  const admin = getSupabaseAdminClient();
  const actionBase =
    mode === 'reactivate'
      ? 'account_reactivate'
      : mode === 'finalize'
        ? 'account_activate_finalize'
        : 'account_activate';

  try {
  await ensureAuditStoreReady(admin);

  const since = new Date(Date.now() - RATE_WINDOW_MS).toISOString();
  const count = await countRecentAdminActions(admin, orgId, user.id, since);

  if (count >= RATE_LIMIT) {
    await writeAdminAudit(admin, {
      orgId,
      actorUserId: user.id,
      targetUserId,
      action: `${actionBase}_rate_limited`,
      success: false,
      details: { mode },
    });
    return NextResponse.json(
      { error: 'Too many activation attempts. Please try again later.' },
      { status: 429 }
    );
  }

  const { data: targetMem } = await admin
    .from('organization_members')
    .select('role,status')
    .eq('org_id', orgId)
    .eq('user_id', targetUserId)
    .maybeSingle();

  if (!targetMem) {
    return NextResponse.json({ error: 'User not found in organization.' }, { status: 404 });
  }

  const status = String(targetMem.status);
  if (mode === 'activate' && status !== 'pending_activation') {
    return NextResponse.json(
      { error: 'Only Pending Activation accounts can be activated this way.' },
      { status: 400 }
    );
  }
  if (mode === 'reactivate' && status !== 'inactive') {
    return NextResponse.json(
      { error: 'Only Inactive accounts can be reactivated this way.' },
      { status: 400 }
    );
  }
  if (mode === 'finalize' && status !== 'pending_activation' && status !== 'inactive') {
    return NextResponse.json(
      {
        error:
          status === 'active'
            ? 'Account is already Active.'
            : 'Only Pending Activation or Inactive accounts can be finalized.',
      },
      { status: 400 }
    );
  }

  const scopeOk = await authorizeActivationScope({
    admin,
    orgId,
    actorUserId: user.id,
    actorRole: membership.role,
    targetUserId,
    targetRole: String(targetMem.role) as OrgMemberRole,
  });

  if (!scopeOk.ok) {
    await writeAdminAudit(admin, {
      orgId,
      actorUserId: user.id,
      targetUserId,
      action: `${actionBase}_denied`,
      success: false,
      details: { mode, reason: scopeOk.reason },
    });
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
  }

  const { data: targetUserData, error: targetUserErr } =
    await admin.auth.admin.getUserById(targetUserId);
  if (targetUserErr || !targetUserData?.user) {
    return NextResponse.json({ error: 'User not found.' }, { status: 404 });
  }

  const target = targetUserData.user;
  const appMeta = (target.app_metadata as Record<string, unknown>) ?? {};
  const userMeta = (target.user_metadata as Record<string, unknown>) ?? {};

  // Finalize: status-only completion after a prior password issuance. Never re-issue.
  if (mode === 'finalize') {
    if (appMeta.must_change_password !== true) {
      return NextResponse.json(
        {
          error:
            'Cannot finalize activation: no temporary password has been issued for this account. Use Activate and Generate Password instead.',
        },
        { status: 400 }
      );
    }

    const { error: statusErr } = await admin
      .from('organization_members')
      .update({ status: 'active' })
      .eq('org_id', orgId)
      .eq('user_id', targetUserId);

    if (statusErr) {
      await writeAdminAudit(admin, {
        orgId,
        actorUserId: user.id,
        targetUserId,
        action: `${actionBase}_failed`,
        success: false,
        details: { mode, reason: 'status_update_failed' },
      }).catch(() => undefined);
      return NextResponse.json(
        {
          ok: false,
          passwordIssued: true,
          statusUpdated: false,
          canFinalizeStatus: true,
          error:
            'Account status could not be updated to Active. The temporary password previously issued remains valid. Try Complete Activation again.',
        },
        { status: 500 }
      );
    }

    const profile = await loadActivationProfile(admin, orgId, targetUserId, target.email);
    let auditRecorded = true;
    try {
      await writeAdminAudit(admin, {
        orgId,
        actorUserId: user.id,
        targetUserId,
        action: `${actionBase}_success`,
        success: true,
        details: { mode, via: scopeOk.via, username: profile.username },
      });
    } catch (auditErr) {
      console.error('Audit write failed after activation finalize:', auditErr);
      auditRecorded = false;
    }

    return NextResponse.json({
      ok: true,
      mode,
      passwordIssued: false,
      statusUpdated: true,
      username: profile.username,
      employeeIdNumber: profile.employeeIdNumber,
      employeeName: profile.employeeName,
      auditRecorded,
      message: auditRecorded
        ? 'Account status set to Active. The previously issued temporary password remains valid; the user must change it at first login.'
        : 'Account status set to Active, but the audit log could not be written. Notify support. The previously issued temporary password remains valid.',
    });
  }

  const issued = await issueTemporaryPasswordAndFlag({
    admin,
    targetUserId,
    existingAppMetadata: appMeta,
    existingUserMetadata: userMeta,
  });

  if (!issued.ok) {
    await writeAdminAudit(admin, {
      orgId,
      actorUserId: user.id,
      targetUserId,
      action: `${actionBase}_failed`,
      success: false,
      details: { mode, reason: issued.error },
    });
    return NextResponse.json({ error: issued.error }, { status: 400 });
  }

  const { error: statusErr } = await admin
    .from('organization_members')
    .update({ status: 'active' })
    .eq('org_id', orgId)
    .eq('user_id', targetUserId);

  const profile = await loadActivationProfile(admin, orgId, targetUserId, target.email);

  if (statusErr) {
    await writeAdminAudit(admin, {
      orgId,
      actorUserId: user.id,
      targetUserId,
      action: `${actionBase}_partial`,
      success: false,
      details: { mode, reason: 'status_update_failed', passwordIssued: true },
    }).catch(() => undefined);
    // Password already replaced — return it once; do not claim full activation.
    return NextResponse.json(
      {
        ok: false,
        partial: true,
        passwordIssued: true,
        statusUpdated: false,
        canFinalizeStatus: true,
        temporaryPassword: issued.temporaryPassword,
        username: profile.username,
        employeeIdNumber: profile.employeeIdNumber,
        employeeName: profile.employeeName,
        error:
          'Partial success: temporary password was set, but the account is still not Active. Copy the password now, then use Complete Activation (does not issue a new password).',
        message:
          'Partial success: temporary password was set, but the account is still not Active. Copy the password now, then use Complete Activation.',
      },
      { status: 409 }
    );
  }

  let auditRecorded = true;
  try {
    await writeAdminAudit(admin, {
      orgId,
      actorUserId: user.id,
      targetUserId,
      action: `${actionBase}_success`,
      success: true,
      details: { mode, via: scopeOk.via, username: profile.username },
    });
  } catch (auditErr) {
    console.error('Audit write failed after activation:', auditErr);
    auditRecorded = false;
  }

  return NextResponse.json({
    ok: true,
    mode,
    passwordIssued: true,
    statusUpdated: true,
    temporaryPassword: issued.temporaryPassword,
    username: profile.username,
    employeeIdNumber: profile.employeeIdNumber,
    employeeName: profile.employeeName,
    auditRecorded,
    message: auditRecorded
      ? 'Temporary password generated once. Verify the employee’s identity before sharing. They must change it at first login.'
      : 'Account activated and temporary password generated, but the audit log could not be written. Copy the password now and notify support.',
  });
  } catch (err: unknown) {
    const unavailable = auditUnavailableResponse(err);
    if (unavailable) return unavailable;
    if (err instanceof AuditStoreUnavailableError) {
      return NextResponse.json({ error: err.message }, { status: 503 });
    }
    const message = err instanceof Error ? err.message : 'Activation failed.';
    return NextResponse.json({ error: message }, { status: 400 });
  }
}

async function loadActivationProfile(
  admin: ReturnType<typeof getSupabaseAdminClient>,
  orgId: string,
  targetUserId: string,
  email: string | undefined
) {
  const { data: link } = await admin
    .from('employee_user_links')
    .select('employee_id')
    .eq('org_id', orgId)
    .eq('user_id', targetUserId)
    .maybeSingle();

  let employeeIdNumber: string | null = null;
  let employeeName: string | null = null;
  if (link?.employee_id) {
    const { data: emp } = await admin
      .from('employees')
      .select('id_number,full_name')
      .eq('org_id', orgId)
      .eq('id', link.employee_id)
      .maybeSingle();
    employeeIdNumber = emp?.id_number ? String(emp.id_number) : null;
    employeeName = emp?.full_name ? String(emp.full_name) : null;
  }

  const username =
    email?.trim().toLowerCase() ||
    (employeeIdNumber ? generateEmployeeEmail(employeeIdNumber) : null);

  return { username, employeeIdNumber, employeeName };
}

async function authorizeActivationScope(params: {
  admin: ReturnType<typeof getSupabaseAdminClient>;
  orgId: string;
  actorUserId: string;
  actorRole: OrgMemberRole;
  targetUserId: string;
  targetRole: OrgMemberRole;
}): Promise<{ ok: true; via: 'super_admin' | 'delegated' } | { ok: false; reason: string }> {
  const { admin, orgId, actorUserId, actorRole, targetUserId, targetRole } = params;

  if (actorUserId === targetUserId) {
    return { ok: false, reason: 'You cannot activate your own account with this tool.' };
  }

  if (actorRole === 'super_admin') {
    return { ok: true, via: 'super_admin' };
  }

  const delegated = await hasResetPasswordPermission(admin, orgId, actorUserId);
  if (!delegated) {
    return { ok: false, reason: 'Missing password reset / activation permission.' };
  }

  if (targetRole === 'super_admin') {
    return { ok: false, reason: 'Delegated users cannot activate Super Admin accounts.' };
  }

  if (actorRole === 'regional_hr') {
    const { data: actorRegions } = await admin
      .from('organization_member_regions')
      .select('region')
      .eq('org_id', orgId)
      .eq('user_id', actorUserId);
    const allowed = new Set(
      ((actorRegions ?? []) as Array<{ region: string }>).map((r) => String(r.region).trim())
    );
    if (allowed.size === 0) {
      return { ok: false, reason: 'No regional scope assigned.' };
    }
    const { data: link } = await admin
      .from('employee_user_links')
      .select('employee_id')
      .eq('org_id', orgId)
      .eq('user_id', targetUserId)
      .maybeSingle();
    if (!link?.employee_id) {
      return {
        ok: false,
        reason: 'Cannot activate unlinked accounts outside regional authorization.',
      };
    }
    const { data: employee } = await admin
      .from('employees')
      .select('region')
      .eq('org_id', orgId)
      .eq('id', link.employee_id)
      .maybeSingle();
    if (!employee?.region || !allowed.has(String(employee.region).trim())) {
      return { ok: false, reason: 'Target account is outside your regional scope.' };
    }
  } else if (actorRole !== 'head_of_hr' && actorRole !== 'hr_national') {
    return { ok: false, reason: 'Role is not eligible for delegated activation.' };
  }

  return { ok: true, via: 'delegated' };
}
