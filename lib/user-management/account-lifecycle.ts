import type { SupabaseClient } from '@supabase/supabase-js';
import {
  generateEmployeeEmail,
  generateEmployeeTempPassword,
  normalizeEmployeeId,
} from '@/lib/users/provisioning';
import {
  generateSecureTempPassword,
  validatePasswordStrength,
} from '@/lib/users/password-policy';
import type { OrgMemberStatus } from '@/lib/user-management/types';

export type ProvisionEmployeeAccountResult =
  | { outcome: 'created'; userId: string; email: string }
  | { outcome: 'skipped_existing'; userId: string; email: string; reason: string }
  | { outcome: 'failed'; email: string; reason: string };

/**
 * Provision (or link) an employee auth account as Pending Activation.
 * Never returns or logs the generated password. Does not reset passwords on retry.
 */
export async function provisionEmployeeAccountPending(params: {
  admin: SupabaseClient;
  orgId: string;
  employeeUuid: string;
  idNumber: string;
  fullName: string;
}): Promise<ProvisionEmployeeAccountResult> {
  const empId = normalizeEmployeeId(params.idNumber);
  const email = generateEmployeeEmail(empId);

  // Already linked → preserve password and status (safe retry).
  const { data: existingLink } = await params.admin
    .from('employee_user_links')
    .select('user_id')
    .eq('org_id', params.orgId)
    .eq('employee_id', params.employeeUuid)
    .maybeSingle();

  if (existingLink?.user_id) {
    await ensureEmployeeMembershipPending({
      admin: params.admin,
      orgId: params.orgId,
      userId: String(existingLink.user_id),
      email,
      fullName: params.fullName,
      employeeUuid: params.employeeUuid,
      updateStatusIfInactiveOrMissing: false,
    });
    return {
      outcome: 'skipped_existing',
      userId: String(existingLink.user_id),
      email,
      reason: 'already_linked',
    };
  }

  // Profile email match → link without resetting password.
  const { data: profile } = await params.admin
    .from('profiles')
    .select('user_id')
    .eq('email', email)
    .maybeSingle();

  if (profile?.user_id) {
    await ensureEmployeeMembershipPending({
      admin: params.admin,
      orgId: params.orgId,
      userId: String(profile.user_id),
      email,
      fullName: params.fullName,
      employeeUuid: params.employeeUuid,
      updateStatusIfInactiveOrMissing: true,
    });
    return {
      outcome: 'skipped_existing',
      userId: String(profile.user_id),
      email,
      reason: 'existing_auth_user',
    };
  }

  const password = generateEmployeeTempPassword(empId);
  const strength = validatePasswordStrength(password);
  if (!strength.ok) {
    return { outcome: 'failed', email, reason: 'password_generation_failed' };
  }

  const created = await params.admin.auth.admin.createUser({
    email,
    password,
    email_confirm: true,
    user_metadata: { full_name: params.fullName },
    // Initial undisclosed credential — access blocked until admin activation.
    app_metadata: { must_change_password: false, account_provisioned: true },
  });

  if (created.error || !created.data.user?.id) {
    const msg = created.error?.message ?? 'create_user_failed';
    if (/already registered|already exists|duplicate/i.test(msg)) {
      // Race: look up again and link without password reset.
      const { data: again } = await params.admin
        .from('profiles')
        .select('user_id')
        .eq('email', email)
        .maybeSingle();
      if (again?.user_id) {
        await ensureEmployeeMembershipPending({
          admin: params.admin,
          orgId: params.orgId,
          userId: String(again.user_id),
          email,
          fullName: params.fullName,
          employeeUuid: params.employeeUuid,
          updateStatusIfInactiveOrMissing: true,
        });
        return {
          outcome: 'skipped_existing',
          userId: String(again.user_id),
          email,
          reason: 'race_existing_user',
        };
      }
    }
    return { outcome: 'failed', email, reason: msg };
  }

  const userId = created.data.user.id;
  await ensureEmployeeMembershipPending({
    admin: params.admin,
    orgId: params.orgId,
    userId,
    email,
    fullName: params.fullName,
    employeeUuid: params.employeeUuid,
    updateStatusIfInactiveOrMissing: true,
  });

  return { outcome: 'created', userId, email };
}

async function ensureEmployeeMembershipPending(params: {
  admin: SupabaseClient;
  orgId: string;
  userId: string;
  email: string;
  fullName: string;
  employeeUuid: string;
  /** When false, do not overwrite an existing active/inactive status. */
  updateStatusIfInactiveOrMissing: boolean;
}) {
  await params.admin.from('profiles').upsert(
    {
      user_id: params.userId,
      full_name: params.fullName,
      email: params.email,
    },
    { onConflict: 'user_id' }
  );

  const { data: mem } = await params.admin
    .from('organization_members')
    .select('role,status')
    .eq('org_id', params.orgId)
    .eq('user_id', params.userId)
    .maybeSingle();

  if (!mem) {
    if (!params.updateStatusIfInactiveOrMissing) {
      return;
    }
    await params.admin.from('organization_members').upsert(
      {
        org_id: params.orgId,
        user_id: params.userId,
        role: 'employee',
        status: 'pending_activation' satisfies OrgMemberStatus,
      },
      { onConflict: 'org_id,user_id' }
    );
  }
  // Existing memberships keep their status/role on retry (no password reset, no demotion).

  await params.admin.from('employee_user_links').upsert(
    {
      org_id: params.orgId,
      user_id: params.userId,
      employee_id: params.employeeUuid,
    },
    { onConflict: 'org_id,user_id' }
  );
}

export async function issueTemporaryPasswordAndFlag(params: {
  admin: SupabaseClient;
  targetUserId: string;
  existingAppMetadata?: Record<string, unknown>;
  existingUserMetadata?: Record<string, unknown>;
}): Promise<{ ok: true; temporaryPassword: string } | { ok: false; error: string }> {
  const temporaryPassword = generateSecureTempPassword(16);
  const strength = validatePasswordStrength(temporaryPassword);
  if (!strength.ok) {
    return { ok: false, error: 'Failed to generate a valid temporary password.' };
  }

  const { error } = await params.admin.auth.admin.updateUserById(params.targetUserId, {
    password: temporaryPassword,
    app_metadata: {
      ...(params.existingAppMetadata ?? {}),
      must_change_password: true,
    },
    user_metadata: {
      ...(params.existingUserMetadata ?? {}),
      must_change_password: true,
    },
  });

  if (error) {
    return { ok: false, error: 'Unable to set temporary password.' };
  }

  try {
    const adminAuth = params.admin.auth.admin as typeof params.admin.auth.admin & {
      signOut?: (uid: string, scope?: 'global' | 'local' | 'others') => Promise<unknown>;
    };
    if (typeof adminAuth.signOut === 'function') {
      await adminAuth.signOut(params.targetUserId, 'global');
    }
  } catch {
    // Password update already succeeded.
  }

  return { ok: true, temporaryPassword };
}
