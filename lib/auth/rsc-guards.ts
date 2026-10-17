import { headers } from 'next/headers';
import { redirect } from 'next/navigation';
import type { SupabaseClient } from '@supabase/supabase-js';
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

async function userHasActiveMembership(
  supabase: SupabaseClient,
  userId: string
): Promise<boolean> {
  const { data, error } = await supabase
    .from('organization_members')
    .select('status')
    .eq('user_id', userId)
    .eq('status', 'active')
    .limit(1)
    .maybeSingle();

  if (error) {
    return false;
  }
  return Boolean(data);
}

/**
 * (main) layout: require session, active membership, and completed password change.
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

  const active = await userHasActiveMembership(supabase, user.id);
  if (!active) {
    redirect('/login?error=inactive');
  }
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

  const active = await userHasActiveMembership(supabase, user.id);
  if (!active) {
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
