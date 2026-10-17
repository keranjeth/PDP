import type { SupabaseClient } from '@supabase/supabase-js';

export const RESET_PASSWORD_PERMISSION = 'users.reset_password' as const;

export type MemberPermission = typeof RESET_PASSWORD_PERMISSION;

function isMissingPermissionsTable(error: { code?: string; message?: string } | null): boolean {
  if (!error) return false;
  return (
    error.code === 'PGRST205' ||
    /member_permissions/i.test(String(error.message ?? '')) ||
    /schema cache/i.test(String(error.message ?? ''))
  );
}

export async function fetchMemberPermissions(
  supabase: SupabaseClient,
  orgId: string,
  userId: string
): Promise<MemberPermission[]> {
  const { data, error } = await supabase
    .from('member_permissions')
    .select('permission')
    .eq('org_id', orgId)
    .eq('user_id', userId);

  if (error) {
    if (isMissingPermissionsTable(error)) return [];
    throw error;
  }
  return ((data ?? []) as Array<{ permission: string }>)
    .map((r) => r.permission)
    .filter((p): p is MemberPermission => p === RESET_PASSWORD_PERMISSION);
}

export async function fetchOrgResetPasswordGrants(
  supabase: SupabaseClient,
  orgId: string
): Promise<Set<string>> {
  const { data, error } = await supabase
    .from('member_permissions')
    .select('user_id')
    .eq('org_id', orgId)
    .eq('permission', RESET_PASSWORD_PERMISSION);

  if (error) {
    if (isMissingPermissionsTable(error)) return new Set();
    throw error;
  }
  return new Set(((data ?? []) as Array<{ user_id: string }>).map((r) => r.user_id));
}

export async function setResetPasswordPermission(
  supabase: SupabaseClient,
  orgId: string,
  userId: string,
  enabled: boolean,
  grantedBy: string
): Promise<void> {
  if (enabled) {
    const { error } = await supabase.from('member_permissions').upsert(
      {
        org_id: orgId,
        user_id: userId,
        permission: RESET_PASSWORD_PERMISSION,
        granted_by: grantedBy,
      },
      { onConflict: 'org_id,user_id,permission' }
    );
    if (error) throw error;
    return;
  }

  const { error } = await supabase
    .from('member_permissions')
    .delete()
    .eq('org_id', orgId)
    .eq('user_id', userId)
    .eq('permission', RESET_PASSWORD_PERMISSION);
  if (error) throw error;
}

export async function hasResetPasswordPermission(
  supabase: SupabaseClient,
  orgId: string,
  userId: string
): Promise<boolean> {
  const { data, error } = await supabase
    .from('member_permissions')
    .select('permission')
    .eq('org_id', orgId)
    .eq('user_id', userId)
    .eq('permission', RESET_PASSWORD_PERMISSION)
    .maybeSingle();

  if (error) {
    if (isMissingPermissionsTable(error)) return false;
    throw error;
  }
  return Boolean(data);
}
