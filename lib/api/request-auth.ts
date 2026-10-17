import { cookies } from 'next/headers';
import { NextResponse } from 'next/server';
import { createServerClient } from '@supabase/ssr';
import type { SupabaseClient, User } from '@supabase/supabase-js';
import type { OrgMemberRole, OrgMemberStatus } from '@/lib/user-management/types';
import { getSupabaseAdminClient } from '@/lib/supabase/admin';

export type ActiveMembership = {
  role: OrgMemberRole;
  status: OrgMemberStatus;
};

export async function getRequestUser(request: Request): Promise<{
  user: User | null;
  sessionClient: ReturnType<typeof createServerClient> | null;
  error?: string;
}> {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const publishableKey = process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY;
  if (!url || !publishableKey) {
    return { user: null, sessionClient: null, error: 'Supabase is not configured.' };
  }

  const cookieStore = await cookies();
  const sessionClient = createServerClient(url, publishableKey, {
    cookies: {
      getAll() {
        return cookieStore.getAll();
      },
      setAll(cookiesToSet) {
        cookiesToSet.forEach(({ name, value, options }) => {
          cookieStore.set(name, value, options);
        });
      },
    },
  });

  const authHeader = request.headers.get('authorization') ?? '';
  const bearer = authHeader.toLowerCase().startsWith('bearer ')
    ? authHeader.slice('bearer '.length).trim()
    : null;

  const {
    data: { user },
    error,
  } = bearer ? await sessionClient.auth.getUser(bearer) : await sessionClient.auth.getUser();

  if (error || !user) {
    return { user: null, sessionClient, error: 'Unauthorized' };
  }

  return { user, sessionClient };
}

export async function getActiveMembership(
  orgId: string,
  userId: string
): Promise<ActiveMembership | null> {
  const admin = getSupabaseAdminClient();
  const { data, error } = await admin
    .from('organization_members')
    .select('role,status')
    .eq('org_id', orgId)
    .eq('user_id', userId)
    .maybeSingle();

  if (error || !data) return null;
  if (String(data.status) !== 'active') return null;
  return {
    role: data.role as OrgMemberRole,
    status: data.status as OrgMemberStatus,
  };
}

export function passwordChangeRequiredResponse(): NextResponse {
  return NextResponse.json(
    { error: 'Password change required before accessing this resource.' },
    { status: 403 }
  );
}

export function inactiveAccountResponse(): NextResponse {
  return NextResponse.json({ error: 'Account is not active.' }, { status: 403 });
}

async function userHasAnyActiveMembershipWithClient(
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

export async function userHasAnyActiveMembership(userId: string): Promise<boolean> {
  try {
    const admin = getSupabaseAdminClient();
    return userHasAnyActiveMembershipWithClient(admin, userId);
  } catch {
    return false;
  }
}

/** Mirrors former edge middleware checks for protected API handlers. */
export async function guardProtectedApiUser(
  user: User,
  sessionClient?: SupabaseClient | null
): Promise<NextResponse | null> {
  if (userMustChangePassword(user)) {
    return passwordChangeRequiredResponse();
  }
  const active = sessionClient
    ? await userHasAnyActiveMembershipWithClient(sessionClient, user.id)
    : await userHasAnyActiveMembership(user.id);
  if (!active) {
    return inactiveAccountResponse();
  }
  return null;
}

export async function getProtectedRequestUser(request: Request): Promise<{
  user: User | null;
  sessionClient: ReturnType<typeof createServerClient> | null;
  errorResponse?: NextResponse;
}> {
  const auth = await getRequestUser(request);
  if (!auth.user) {
    return {
      user: null,
      sessionClient: auth.sessionClient,
      errorResponse: NextResponse.json(
        { error: auth.error ?? 'Unauthorized' },
        { status: 401 }
      ),
    };
  }

  const blocked = await guardProtectedApiUser(auth.user, auth.sessionClient);
  if (blocked) {
    return { user: null, sessionClient: auth.sessionClient, errorResponse: blocked };
  }

  return { user: auth.user, sessionClient: auth.sessionClient };
}

export function userMustChangePassword(user: User): boolean {
  const appFlag = Boolean(
    (user.app_metadata as { must_change_password?: boolean } | undefined)?.must_change_password
  );
  // Temporary compatibility with legacy provisioning that used user_metadata.
  const userFlag = Boolean(
    (user.user_metadata as { must_change_password?: boolean } | undefined)?.must_change_password
  );
  return appFlag || userFlag;
}

export function getSiteOrigin(request: Request): string {
  const env = process.env.NEXT_PUBLIC_SITE_URL?.replace(/\/$/, '');
  if (env) return env;
  const origin = request.headers.get('origin');
  if (origin) return origin.replace(/\/$/, '');
  const host = request.headers.get('x-forwarded-host') ?? request.headers.get('host');
  const proto = request.headers.get('x-forwarded-proto') ?? 'http';
  if (host) return `${proto}://${host}`.replace(/\/$/, '');
  return 'http://localhost:3000';
}

export function isAllowlistedRedirect(origin: string): boolean {
  const allowed = new Set<string>();
  const site = process.env.NEXT_PUBLIC_SITE_URL?.replace(/\/$/, '');
  if (site) allowed.add(site);
  allowed.add('http://localhost:3000');
  allowed.add('http://127.0.0.1:3000');
  return allowed.has(origin.replace(/\/$/, ''));
}
