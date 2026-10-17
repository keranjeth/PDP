import type { SupabaseClient, User } from '@supabase/supabase-js';
import { ensureDefaultWorkspace } from '@/lib/workspace';

export type WorkspaceAccessResult =
  | { ok: true; orgId: string }
  | {
      ok: false;
      reason: 'pending' | 'inactive' | 'no_membership' | 'error';
      message: string;
    };

function classifyWorkspaceError(err: unknown): WorkspaceAccessResult {
  const message = err instanceof Error ? err.message : String(err);
  const lower = message.toLowerCase();

  if (lower.includes('pending activation')) {
    return { ok: false, reason: 'pending', message };
  }
  if (
    lower.includes('inactive') ||
    lower.includes('not activated') ||
    lower.includes('@workforce.local')
  ) {
    return { ok: false, reason: 'inactive', message };
  }
  if (lower.includes('no active organization membership')) {
    return { ok: false, reason: 'no_membership', message };
  }
  if (lower.includes('organization already exists')) {
    return {
      ok: false,
      reason: 'no_membership',
      message: 'No active organization membership. Contact your administrator.',
    };
  }

  return { ok: false, reason: 'error', message };
}

/**
 * After authentication: reuse active membership or bootstrap the first org
 * (Super Admin) when the database has no organization yet.
 */
export async function ensureWorkspaceAccess(
  supabase: SupabaseClient,
  user: User
): Promise<WorkspaceAccessResult> {
  const fullName =
    (user.user_metadata?.full_name as string | undefined)?.trim() ||
    user.email ||
    '';

  try {
    const { orgId } = await ensureDefaultWorkspace(
      supabase,
      user.id,
      fullName,
      user.email ?? undefined
    );
    return { ok: true, orgId };
  } catch (err) {
    return classifyWorkspaceError(err);
  }
}
