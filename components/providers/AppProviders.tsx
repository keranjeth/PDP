'use client';

import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from 'react';
import type { Session, User } from '@supabase/supabase-js';
import {
  clearSupabaseBrowserAuthStorage,
  getSupabaseBrowserClient,
} from '@/lib/supabase/client';
import { formatSupabaseError } from '@/lib/supabase/error-format';
import {
  ensureDefaultWorkspace,
  fetchMembershipRole,
  fetchProfileFullName,
  formatOrgRoleLabel,
} from '@/lib/workspace';
import { usePathname, useRouter } from 'next/navigation';

export type AppAuthContextValue = {
  user: User | null;
  session: Session | null;
  displayName: string;
  email: string;
  orgId: string | null;
  membershipRole: string | null;
  roleLabel: string | null;
  memberRegions: string[];
  isReady: boolean;
  hasSupabase: boolean;
  signOut: () => Promise<void>;
};

const AppAuthContext = createContext<AppAuthContextValue | undefined>(undefined);

export function useAppAuth(): AppAuthContextValue {
  const ctx = useContext(AppAuthContext);
  if (!ctx) {
    throw new Error('useAppAuth must be used within AppProviders');
  }
  return ctx;
}

export function AppProviders({ children }: { children: ReactNode }) {
  const router = useRouter();
  const pathname = usePathname();
  const pathnameRef = useRef(pathname);
  const supabase = useMemo(() => getSupabaseBrowserClient(), []);
  const hasSupabase = Boolean(supabase);

  const [user, setUser] = useState<User | null>(null);
  const [session, setSession] = useState<Session | null>(null);
  const [displayName, setDisplayName] = useState('');
  const [email, setEmail] = useState('');
  const [orgId, setOrgId] = useState<string | null>(null);
  const [membershipRole, setMembershipRole] = useState<string | null>(null);
  const [roleLabel, setRoleLabel] = useState<string | null>(null);
  const [memberRegions, setMemberRegions] = useState<string[]>([]);
  const [isReady, setIsReady] = useState(() => !hasSupabase);

  const appliedAccessTokenRef = useRef<string | null>(null);

  useEffect(() => {
    pathnameRef.current = pathname;
  }, [pathname]);

  useEffect(() => {
    if (!supabase) {
      return;
    }

    let cancelled = false;

    const clearAuthState = async (): Promise<void> => {
      appliedAccessTokenRef.current = null;
      setSession(null);
      setUser(null);
      setOrgId(null);
      setDisplayName('');
      setEmail('');
      setMembershipRole(null);
      setRoleLabel(null);
      setMemberRegions([]);
      setIsReady(true);
      const [remote, storeMod] = await Promise.all([
        import('@/lib/employee-remote-sync'),
        import('@/lib/store'),
      ]);
      remote.configureEmployeeRemoteSync(null, null);
      storeMod.employeeStore.clearLocalState();
    };

    const isInvalidRefreshTokenError = (error: unknown): boolean => {
      const message = String(error instanceof Error ? error.message : error).toLowerCase();
      return message.includes('invalid refresh token') || message.includes('refresh token not found');
    };

    const handleAuth = async (
      event: string,
      nextSession: Session | null
    ): Promise<void> => {
      if (cancelled) {
        return;
      }

      if (event === 'TOKEN_REFRESHED') {
        setSession(nextSession);
        setUser(nextSession?.user ?? null);
        appliedAccessTokenRef.current = nextSession?.access_token ?? null;
        setIsReady(true);
        return;
      }

      const nextUser = nextSession?.user ?? null;
      const nextToken = nextSession?.access_token ?? null;

      setSession(nextSession);
      setUser(nextUser);

      if (!nextUser) {
        void clearAuthState();
        return;
      }

      if (event === 'USER_UPDATED') {
        appliedAccessTokenRef.current = null;
      }

      if (
        nextToken &&
        nextToken === appliedAccessTokenRef.current &&
        event !== 'SIGNED_IN'
      ) {
        setIsReady(true);
        return;
      }
      appliedAccessTokenRef.current = nextToken;

      const mustChangePassword = Boolean(
        (nextUser.app_metadata as { must_change_password?: boolean } | undefined)
          ?.must_change_password ||
          (nextUser.user_metadata as { must_change_password?: boolean } | undefined)
            ?.must_change_password
      );
      const pathNow = pathnameRef.current;
      if (
        mustChangePassword &&
        pathNow !== '/change-password' &&
        !pathNow?.startsWith('/login') &&
        !pathNow?.startsWith('/signup')
      ) {
        setIsReady(true);
        router.replace('/change-password');
        router.refresh();
        return;
      }

      setEmail(nextUser.email ?? '');

      const nameForWorkspace =
        (nextUser.user_metadata?.full_name as string | undefined)?.trim() ||
        nextUser.email ||
        '';

      const pathForHydration = pathnameRef.current;
      const deferWorkspaceForWelcome = pathForHydration === '/';

      const runWorkspaceHydration = async (): Promise<void> => {
        const { configureEmployeeRemoteSync, hydrateEmployeesFromSupabase } =
          await import('@/lib/employee-remote-sync');
        try {
          const { orgId: oid } = await ensureDefaultWorkspace(
            supabase,
            nextUser.id,
            nameForWorkspace,
            nextUser.email ?? undefined
          );
          setOrgId(oid);

          configureEmployeeRemoteSync(supabase, oid);

          let profileName: string | null = null;
          try {
            profileName = await fetchProfileFullName(supabase, nextUser.id);
          } catch (profileErr) {
            console.error('Profile name load failed:', formatSupabaseError(profileErr));
          }

          const resolvedDisplay =
            profileName?.trim() ||
            (nextUser.user_metadata?.full_name as string | undefined)?.trim() ||
            nextUser.email ||
            'User';
          setDisplayName(resolvedDisplay);

          const role = await fetchMembershipRole(supabase, nextUser.id, oid);
          setMembershipRole(role);
          setRoleLabel(formatOrgRoleLabel(role));
          try {
            const { data, error } = await supabase
              .from('organization_member_regions')
              .select('region')
              .eq('org_id', oid)
              .eq('user_id', nextUser.id);
            if (error) {
              throw error;
            }
            setMemberRegions((data ?? []).map((r) => String((r as { region: unknown }).region)));
          } catch (regionErr) {
            console.error('Member regions load failed:', formatSupabaseError(regionErr));
            setMemberRegions([]);
          }

          void hydrateEmployeesFromSupabase(supabase, oid).catch((hydrateErr) =>
            console.error(
              'Employee hydrate failed:',
              formatSupabaseError(hydrateErr),
              hydrateErr
            )
          );
        } catch (err) {
          console.error('Workspace hydration failed:', formatSupabaseError(err), err);
          const message = String(err instanceof Error ? err.message : err).toLowerCase();
          const inactiveAccount =
            message.includes('pending activation') ||
            message.includes('inactive') ||
            message.includes('not activated') ||
            message.includes('no active organization membership');
          if (inactiveAccount && !cancelled) {
            clearSupabaseBrowserAuthStorage();
            await supabase.auth.signOut().catch(() => null);
            void clearAuthState();
            router.replace('/login?error=inactive');
          }
        }
      };

      if (deferWorkspaceForWelcome) {
        setIsReady(true);
        void runWorkspaceHydration();
        return;
      }

      try {
        await runWorkspaceHydration();
      } finally {
        setIsReady(true);
      }
    };

    void supabase.auth
      .getSession()
      .then(({ data: { session: initial } }) => {
        if (cancelled) {
          return;
        }
        void handleAuth('INITIAL_SESSION', initial);
      })
      .catch((error: unknown) => {
        if (cancelled) {
          return;
        }
        if (isInvalidRefreshTokenError(error)) {
          clearSupabaseBrowserAuthStorage();
          void clearAuthState();
          if (!pathnameRef.current?.startsWith('/login')) {
            router.replace('/login');
          }
          return;
        }
        console.error('Supabase session load failed:', formatSupabaseError(error), error);
        void clearAuthState();
      });

    const { data: subscriptionHolder } = supabase.auth.onAuthStateChange(
      (event, nextSession) => {
        if (cancelled) {
          return;
        }
        if (event === 'INITIAL_SESSION') {
          return;
        }
        void handleAuth(event, nextSession);
      }
    );

    return () => {
      cancelled = true;
      subscriptionHolder.subscription.unsubscribe();
    };
  }, [supabase, router]);

  const signOut = useCallback(async () => {
    if (supabase) {
      const { error } = await supabase.auth.signOut();
      if (error) {
        clearSupabaseBrowserAuthStorage();
      }
    }
    appliedAccessTokenRef.current = null;
    const [{ configureEmployeeRemoteSync }, { employeeStore }] = await Promise.all([
      import('@/lib/employee-remote-sync'),
      import('@/lib/store'),
    ]);
    configureEmployeeRemoteSync(null, null);
    employeeStore.clearLocalState();
    setOrgId(null);
    setDisplayName('');
    setEmail('');
    setMembershipRole(null);
    setRoleLabel(null);
    setMemberRegions([]);
    setUser(null);
    setSession(null);
  }, [supabase]);

  const value = useMemo<AppAuthContextValue>(
    () => ({
      user,
      session,
      displayName,
      email,
      orgId,
      membershipRole,
      roleLabel,
      memberRegions,
      isReady,
      hasSupabase,
      signOut,
    }),
    [
      user,
      session,
      displayName,
      email,
      orgId,
      membershipRole,
      roleLabel,
      memberRegions,
      isReady,
      hasSupabase,
      signOut,
    ]
  );

  return (
    <AppAuthContext.Provider value={value}>{children}</AppAuthContext.Provider>
  );
}
