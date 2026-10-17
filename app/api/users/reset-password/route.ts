import { NextResponse } from 'next/server';
import { getSupabaseAdminClient } from '@/lib/supabase/admin';
import {
  getActiveMembership,
  getProtectedRequestUser,
  getSiteOrigin,
  isAllowlistedRedirect,
} from '@/lib/api/request-auth';
import {
  AuditStoreUnavailableError,
  authorizePasswordReset,
  auditUnavailableResponse,
  countRecentAdminActions,
  ensureAuditStoreReady,
  writeAdminAudit,
} from '@/lib/user-management/password-reset-authz';
import {
  generateSecureTempPassword,
  isDeliverableEmail,
  validatePasswordStrength,
} from '@/lib/users/password-policy';

type Body = {
  orgId?: string;
  targetUserId?: string;
  method?: 'email_link' | 'temporary_password';
};

const RATE_WINDOW_MS = 15 * 60 * 1000;
const RATE_LIMIT = 10;

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
  const method = body.method;
  if (!orgId || !targetUserId || (method !== 'email_link' && method !== 'temporary_password')) {
    return NextResponse.json({ error: 'Invalid request.' }, { status: 400 });
  }

  const membership = await getActiveMembership(orgId, user.id);
  if (!membership) {
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
  }

  const admin = getSupabaseAdminClient();

  try {
  await ensureAuditStoreReady(admin);

  // Rate limit fails closed if audit store is unavailable.
  const since = new Date(Date.now() - RATE_WINDOW_MS).toISOString();
  const count = await countRecentAdminActions(
    admin,
    orgId,
    user.id,
    since,
    'password_reset'
  );

  if (count >= RATE_LIMIT) {
    await writeAdminAudit(admin, {
      orgId,
      actorUserId: user.id,
      targetUserId,
      action: 'password_reset_rate_limited',
      success: false,
      details: { method },
    });
    return NextResponse.json(
      { error: 'Too many password reset attempts. Please try again later.' },
      { status: 429 }
    );
  }

  const authz = await authorizePasswordReset({
    admin,
    orgId,
    actorUserId: user.id,
    actorRole: membership.role,
    targetUserId,
  });

  if (!authz.ok) {
    await writeAdminAudit(admin, {
      orgId,
      actorUserId: user.id,
      targetUserId,
      action: 'password_reset_denied',
      success: false,
      details: { method, reason: authz.reason },
    });
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
  }

  const { data: targetUserData, error: targetUserErr } =
    await admin.auth.admin.getUserById(targetUserId);
  if (targetUserErr || !targetUserData?.user) {
    return NextResponse.json({ error: 'User not found.' }, { status: 404 });
  }

  const target = targetUserData.user;
  const identities = target.identities ?? [];
  const hasPasswordIdentity =
    identities.length === 0 ||
    identities.some((i) => i.provider === 'email' || i.provider === 'phone');
  const oauthOnly =
    identities.length > 0 &&
    identities.every((i) => i.provider !== 'email' && i.provider !== 'phone');

  if (oauthOnly) {
    await writeAdminAudit(admin, {
      orgId,
      actorUserId: user.id,
      targetUserId,
      action: 'password_reset_denied',
      success: false,
      details: { method, reason: 'oauth_only' },
    });
    return NextResponse.json(
      {
        error:
          'This account signs in with an external provider and does not support password reset.',
      },
      { status: 400 }
    );
  }

  const email = target.email?.trim().toLowerCase() ?? null;

  if (method === 'email_link') {
    if (!isDeliverableEmail(email) || !hasPasswordIdentity) {
      await writeAdminAudit(admin, {
        orgId,
        actorUserId: user.id,
        targetUserId,
        action: 'password_reset_link_requested',
        success: false,
        details: { reason: 'email_not_eligible' },
      });
      return NextResponse.json(
        {
          error:
            'This account does not have a deliverable email for recovery. Use a temporary password instead.',
        },
        { status: 400 }
      );
    }

    const origin = getSiteOrigin(request);
    if (!isAllowlistedRedirect(origin)) {
      return NextResponse.json({ error: 'Invalid redirect origin.' }, { status: 400 });
    }

    const redirectTo = `${origin}/change-password`;

    // Triggers Supabase Auth email delivery when SMTP/Auth email is configured.
    // We only report that the reset request was accepted — not that email was delivered.
    const { error: resetErr } = await admin.auth.resetPasswordForEmail(email!, {
      redirectTo,
    });

    if (resetErr) {
      await writeAdminAudit(admin, {
        orgId,
        actorUserId: user.id,
        targetUserId,
        action: 'password_reset_link_requested',
        success: false,
        details: { reason: 'provider_error' },
      });
      return NextResponse.json(
        { error: 'Unable to request a password recovery email right now.' },
        { status: 400 }
      );
    }

    // Force password change flag after they complete recovery (belt-and-suspenders).
    await admin.auth.admin.updateUserById(targetUserId, {
      app_metadata: {
        ...(target.app_metadata ?? {}),
        must_change_password: true,
      },
    });

    await writeAdminAudit(admin, {
      orgId,
      actorUserId: user.id,
      targetUserId,
      action: 'password_reset_link_requested',
      success: true,
      details: { via: authz.via, redirectTo },
    });

    return NextResponse.json({
      ok: true,
      method: 'email_link',
      message:
        'Password recovery email request accepted. Delivery depends on Supabase Auth email/SMTP configuration.',
    });
  }

  // temporary_password
  const tempPassword = generateSecureTempPassword(16);
  const strength = validatePasswordStrength(tempPassword);
  if (!strength.ok) {
    return NextResponse.json({ error: 'Failed to generate a valid temporary password.' }, { status: 500 });
  }

  const { error: updateErr } = await admin.auth.admin.updateUserById(targetUserId, {
    password: tempPassword,
    app_metadata: {
      ...(target.app_metadata ?? {}),
      must_change_password: true,
    },
    user_metadata: {
      ...(target.user_metadata ?? {}),
      // Clear legacy flag inconsistency; app_metadata is authoritative.
      must_change_password: true,
    },
  });

  if (updateErr) {
    await writeAdminAudit(admin, {
      orgId,
      actorUserId: user.id,
      targetUserId,
      action: 'password_reset_temp_generated',
      success: false,
      details: { via: authz.via },
    });
    return NextResponse.json({ error: 'Unable to set temporary password.' }, { status: 400 });
  }

  // Best-effort session revocation after admin password set.
  try {
    const adminAuth = admin.auth.admin as typeof admin.auth.admin & {
      signOut?: (uid: string, scope?: 'global' | 'local' | 'others') => Promise<unknown>;
    };
    if (typeof adminAuth.signOut === 'function') {
      await adminAuth.signOut(targetUserId, 'global');
    }
  } catch {
    // Password update already succeeded.
  }

  let auditRecorded = true;
  try {
    await writeAdminAudit(admin, {
      orgId,
      actorUserId: user.id,
      targetUserId,
      action: 'password_reset_temp_generated',
      success: true,
      details: { via: authz.via },
    });
  } catch (auditErr) {
    // Password already changed — do not report a false failure; still return the one-time password.
    console.error('Audit write failed after password reset:', auditErr);
    auditRecorded = false;
  }

  return NextResponse.json({
    ok: true,
    method: 'temporary_password',
    temporaryPassword: tempPassword,
    auditRecorded,
    message: auditRecorded
      ? 'Temporary password generated. Share it only after verifying the account holder’s identity. They must set a new password at next login.'
      : 'Temporary password generated, but the audit log could not be written. Copy the password now and notify support. The password was already applied.',
  });
  } catch (err: unknown) {
    const unavailable = auditUnavailableResponse(err);
    if (unavailable) return unavailable;
    if (err instanceof AuditStoreUnavailableError) {
      return NextResponse.json({ error: err.message }, { status: 503 });
    }
    const message = err instanceof Error ? err.message : 'Password reset failed.';
    return NextResponse.json({ error: message }, { status: 400 });
  }
}
