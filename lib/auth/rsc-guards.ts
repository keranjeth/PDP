import { headers } from 'next/headers';
import { redirect } from 'next/navigation';
import type { User } from '@supabase/supabase-js';
import { ensureWorkspaceAccess } from '@/lib/auth/ensure-workspace-access';
import { userMustChangePassword } from '@/lib/api/request-auth';
import { createServerSupabaseClient } from '@/lib/supabase/server';

const DEFAULT_NEXT_AFTER_LOGIN = '/dashboard';

export async function getPathnameForLoginNextParam(): Promise<string> {
  const h = await headers();
  const nextUrl = h.get('next-url');
  if (nextUrl) {
    try {
      const pathname = new URL(nextUrl).pathname;
      return pathname || DEFAULT_NEXT_AFTER_LOGIN;
    } catch {
      return DEFAULT_NEXT_AFTER_LOGIN;
    }
  }
  return DEFAULT_NEXT_AFTER_LOGIN;
}

async function requireActiveWorkspaceOrRedirect(
  supabase: NonNullable<Awaited<ReturnType<typeof createServerSupabaseClient>>>,
  user: User
): Promise<void> {
  const access = await ensureWorkspaceAccess(supabase, user);
  if (access.ok) {
    return;
  }

  if (access.reason === 'error') {
    console.error('Workspace access failed:', access.message);
  }

  redirect('/login?error=inactive');
}

/**
 * (main) layout: require session, workspace access (bootstrap first org when empty),
 * and completed password change.
 * If Supabase env is missing, allow through (local / unconfigured builds).
 */
export async function requireUserForMainLayout(): Promise<void> {
  const supabase = await createServerSupabaseClient();
  if (!supabase) {
    return;
  }
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) {
    const nextPath = await getPathnameForLoginNextParam();
    redirect(`/login?next=${encodeURIComponent(nextPath)}`);
  }

  if (userMustChangePassword(user)) {
    redirect('/change-password');
  }

  await requireActiveWorkspaceOrRedirect(supabase, user);
}

/**
 * Login / signup: redirect authenticated users away from auth screens.
 */
export async function redirectToDashboardIfAuthed(): Promise<void> {
  const supabase = await createServerSupabaseClient();
  if (!supabase) {
    return;
  }
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) {
    return;
  }

  if (userMustChangePassword(user)) {
    redirect('/change-password');
  }

  const access = await ensureWorkspaceAccess(supabase, user);
  if (!access.ok) {
    redirect('/login?error=inactive');
  }

  redirect('/dashboard');
}

/**
 * change-password: require session or redirect to login.
 */
export async function requireUserForChangePasswordPage(): Promise<void> {
  const supabase = await createServerSupabaseClient();
  if (!supabase) {
    return;
  }
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (user) {
    return;
  }
  redirect('/login?next=/change-password');
}
