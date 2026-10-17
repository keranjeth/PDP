import type { SupabaseClient } from '@supabase/supabase-js';

export async function ensureDefaultWorkspace(
  supabase: SupabaseClient,
  userId: string,
  fullName: string,
  email?: string
): Promise<{ orgId: string }> {
  const normalizedEmail = email?.trim().toLowerCase() ?? '';

  const { data: active, error: activeErr } = await supabase
    .from('organization_members')
    .select('org_id')
    .eq('user_id', userId)
    .eq('status', 'active')
    .limit(1)
    .maybeSingle();

  if (activeErr) {
    throw activeErr;
  }

  if (active?.org_id) {
    return { orgId: active.org_id as string };
  }

  // Any non-active membership (pending/inactive) must not create a private org.
  const { data: anyMembership, error: anyErr } = await supabase
    .from('organization_members')
    .select('org_id,status')
    .eq('user_id', userId)
    .limit(1)
    .maybeSingle();

  if (anyErr) {
    throw anyErr;
  }

  if (anyMembership) {
    const status = String(anyMembership.status);
    if (status === 'pending_activation') {
      throw new Error('Account is pending activation. Contact your administrator.');
    }
    throw new Error('Account is inactive. Contact your administrator.');
  }

  // Employee synthetic accounts must never bootstrap a new organization.
  if (normalizedEmail.endsWith('@workforce.local')) {
    throw new Error('Account is not activated. Contact your administrator.');
  }

  // Use SECURITY DEFINER helper so RLS cannot hide an existing org and
  // incorrectly allow a second bootstrap attempt.
  const { data: orgsEmpty, error: emptyErr } = await supabase.rpc(
    'organizations_is_empty'
  );
  if (emptyErr) {
    throw emptyErr;
  }
  if (orgsEmpty !== true) {
    throw new Error('No active organization membership. Contact your administrator.');
  }

  const { error: profileError } = await supabase.from('profiles').upsert(
    { user_id: userId, full_name: fullName, email: normalizedEmail || null },
    { onConflict: 'user_id' }
  );
  if (profileError) {
    throw profileError;
  }

  // Advisory-locked RPC: creates org + first Super Admin as the authenticated creator only.
  const { data: orgId, error: bootErr } = await supabase.rpc('bootstrap_primary_organization', {
    p_name: 'Primary Organization',
  });
  if (bootErr || !orgId) {
    throw bootErr ?? new Error('Unable to bootstrap organization.');
  }

  return { orgId: orgId as string };
}

export async function fetchProfileFullName(
  supabase: SupabaseClient,
  userId: string
): Promise<string | null> {
  const { data, error } = await supabase
    .from('profiles')
    .select('full_name')
    .eq('user_id', userId)
    .maybeSingle();

  if (error) {
    throw error;
  }

  const name = data?.full_name?.trim();
  return name || null;
}

export async function fetchMembershipRole(
  supabase: SupabaseClient,
  userId: string,
  orgId: string
): Promise<string | null> {
  const { data, error } = await supabase
    .from('organization_members')
    .select('role')
    .eq('user_id', userId)
    .eq('org_id', orgId)
    .eq('status', 'active')
    .maybeSingle();

  if (error) {
    throw error;
  }

  return (data?.role as string | undefined) ?? null;
}

export function formatOrgRoleLabel(role: string | null): string {
  if (role === 'super_admin') return 'Super Admin';
  if (role === 'head_of_hr') return 'Head of HR';
  if (role === 'hr_national') return 'HR National';
  if (role === 'regional_hr') return 'Regional HR';
  if (role === 'employee') return 'Employee';
  return role ? role.replace(/_/g, ' ') : 'Member';
}
