import type { SupabaseClient } from '@supabase/supabase-js';
import type { OrgMemberRole } from '@/lib/user-management/types';
import {
  hasResetPasswordPermission,
  RESET_PASSWORD_PERMISSION,
} from '@/lib/user-management/member-permissions';

export type ResetAuthzResult =
  | { ok: true; via: 'super_admin' | 'delegated' }
  | { ok: false; reason: string };

export class AuditStoreUnavailableError extends Error {
  constructor(
    message = 'Security audit store is not available. Apply the required database migrations before password or permission operations.'
  ) {
    super(message);
    this.name = 'AuditStoreUnavailableError';
  }
}

function isMissingRelation(error: { code?: string; message?: string } | null, name: string): boolean {
  if (!error) return false;
  return (
    error.code === 'PGRST205' ||
    new RegExp(name, 'i').test(String(error.message ?? '')) ||
    /schema cache/i.test(String(error.message ?? ''))
  );
}

/**
 * Verify audit (and optionally permissions) infrastructure before mutating Auth/DB.
 * Fail closed — do not proceed with sensitive ops if tracking is unavailable.
 */
export async function ensureAuditStoreReady(
  admin: SupabaseClient,
  options?: { requireMemberPermissions?: boolean }
): Promise<void> {
  const { error: auditErr } = await admin.from('admin_audit_logs').select('id').limit(1);
  if (auditErr && isMissingRelation(auditErr, 'admin_audit_logs')) {
    throw new AuditStoreUnavailableError();
  }
  if (auditErr) {
    throw new AuditStoreUnavailableError(
      'Unable to verify the security audit store. Try again or contact support.'
    );
  }

  if (options?.requireMemberPermissions) {
    const { error: permErr } = await admin.from('member_permissions').select('permission').limit(1);
    if (permErr && isMissingRelation(permErr, 'member_permissions')) {
      throw new AuditStoreUnavailableError(
        'Permission tables are not available. Apply the required database migrations before changing permissions.'
      );
    }
    if (permErr) {
      throw new AuditStoreUnavailableError(
        'Unable to verify permission storage. Try again or contact support.'
      );
    }
  }
}

export async function authorizePasswordReset(params: {
  admin: SupabaseClient;
  orgId: string;
  actorUserId: string;
  actorRole: OrgMemberRole;
  targetUserId: string;
}): Promise<ResetAuthzResult> {
  const { admin, orgId, actorUserId, actorRole, targetUserId } = params;

  if (actorUserId === targetUserId) {
    return { ok: false, reason: 'You cannot reset your own password with this tool.' };
  }

  const { data: targetMem, error: targetErr } = await admin
    .from('organization_members')
    .select('role,status')
    .eq('org_id', orgId)
    .eq('user_id', targetUserId)
    .maybeSingle();

  if (targetErr || !targetMem) {
    return { ok: false, reason: 'Target user is not a member of this organization.' };
  }

  if (String(targetMem.status) !== 'active') {
    return {
      ok: false,
      reason:
        String(targetMem.status) === 'pending_activation'
          ? 'Account is pending activation. Use Activate and Generate Password instead.'
          : 'Inactive accounts cannot be reset. Use Reactivate User instead.',
    };
  }

  if (actorRole === 'super_admin') {
    return { ok: true, via: 'super_admin' };
  }

  const delegated = await hasResetPasswordPermission(admin, orgId, actorUserId);
  if (!delegated) {
    return { ok: false, reason: 'Missing password reset permission.' };
  }

  if (String(targetMem.role) === 'super_admin') {
    return { ok: false, reason: 'Delegated users cannot reset Super Admin passwords.' };
  }

  if (actorRole === 'regional_hr') {
    const { data: actorRegions, error: regionErr } = await admin
      .from('organization_member_regions')
      .select('region')
      .eq('org_id', orgId)
      .eq('user_id', actorUserId);

    if (regionErr) {
      return { ok: false, reason: 'Unable to verify regional scope.' };
    }

    const allowed = new Set(
      ((actorRegions ?? []) as Array<{ region: string }>).map((r) => String(r.region).trim())
    );
    if (allowed.size === 0) {
      return { ok: false, reason: 'No regional scope assigned.' };
    }

    const { data: link, error: linkErr } = await admin
      .from('employee_user_links')
      .select('employee_id')
      .eq('org_id', orgId)
      .eq('user_id', targetUserId)
      .maybeSingle();

    if (linkErr || !link?.employee_id) {
      return {
        ok: false,
        reason: 'Cannot reset unlinked accounts outside regional authorization.',
      };
    }

    const { data: employee, error: empErr } = await admin
      .from('employees')
      .select('region')
      .eq('org_id', orgId)
      .eq('id', link.employee_id)
      .maybeSingle();

    if (empErr || !employee?.region || !allowed.has(String(employee.region).trim())) {
      return { ok: false, reason: 'Target account is outside your regional scope.' };
    }
  } else if (actorRole !== 'head_of_hr' && actorRole !== 'hr_national') {
    return { ok: false, reason: 'Role is not eligible for delegated password resets.' };
  }

  return { ok: true, via: 'delegated' };
}

export async function writeAdminAudit(
  admin: SupabaseClient,
  input: {
    orgId: string;
    actorUserId: string;
    targetUserId?: string | null;
    action: string;
    success: boolean;
    details?: Record<string, unknown>;
  }
): Promise<void> {
  const details = { ...(input.details ?? {}) };
  delete details.password;
  delete details.tempPassword;
  delete details.token;
  delete details.recoveryToken;

  const { error } = await admin.from('admin_audit_logs').insert({
    org_id: input.orgId,
    actor_user_id: input.actorUserId,
    target_user_id: input.targetUserId ?? null,
    action: input.action,
    success: input.success,
    details,
  });

  if (error) {
    if (isMissingRelation(error, 'admin_audit_logs')) {
      throw new AuditStoreUnavailableError();
    }
    throw error;
  }
}

export async function countRecentAdminActions(
  admin: SupabaseClient,
  orgId: string,
  actorUserId: string,
  sinceIso: string,
  actionPrefix?: string
): Promise<number> {
  let query = admin
    .from('admin_audit_logs')
    .select('id', { count: 'exact', head: true })
    .eq('org_id', orgId)
    .eq('actor_user_id', actorUserId)
    .gte('created_at', sinceIso);
  if (actionPrefix) {
    query = query.like('action', `${actionPrefix}%`);
  }
  const { count, error } = await query;
  if (error) {
    if (isMissingRelation(error, 'admin_audit_logs')) {
      throw new AuditStoreUnavailableError();
    }
    throw error;
  }
  return count ?? 0;
}

export function auditUnavailableResponse(err: unknown): Response | null {
  if (err instanceof AuditStoreUnavailableError) {
    return new Response(JSON.stringify({ error: err.message }), {
      status: 503,
      headers: { 'Content-Type': 'application/json' },
    });
  }
  return null;
}

export { RESET_PASSWORD_PERMISSION };
