'use client';

import { Suspense, useEffect, useMemo, useState } from 'react';
import { useRouter, useSearchParams } from 'next/navigation';
import { AuthBackground, AuthFormCard } from '@/components/auth/AuthShell';
import { ensureWorkspaceAccess } from '@/lib/auth/ensure-workspace-access';
import { getSupabaseBrowserClient } from '@/lib/supabase/client';

function AuthConfirmInner() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const supabase = getSupabaseBrowserClient();

  const next = useMemo(() => searchParams.get('next') || '/dashboard', [searchParams]);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;

    async function run() {
      if (!supabase) {
        if (!cancelled) {
          setError(
            'Supabase is not configured. Add NEXT_PUBLIC_SUPABASE_URL and NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY to .env.local.'
          );
        }
        return;
      }

      const code = searchParams.get('code');
      const codeError = searchParams.get('error_description') || searchParams.get('error');

      if (codeError) {
        if (!cancelled) setError(String(codeError));
        return;
      }

      if (!code) {
        if (!cancelled) setError('Missing authentication code.');
        return;
      }

      const { error: exchangeError } = await supabase.auth.exchangeCodeForSession(code);
      if (exchangeError) {
        if (!cancelled) setError(exchangeError.message);
        return;
      }

      const {
        data: { user },
      } = await supabase.auth.getUser();
      if (!user) {
        if (!cancelled) setError('Unable to verify the signed-in account.');
        return;
      }

      const access = await ensureWorkspaceAccess(supabase, user);
      if (!access.ok) {
        await supabase.auth.signOut().catch(() => null);
        if (!cancelled) {
          router.replace('/login?error=inactive');
        }
        return;
      }

      router.replace(next);
      router.refresh();
    }

    run();
    return () => {
      cancelled = true;
    };
  }, [next, router, searchParams, supabase]);

  return (
    <AuthBackground>
      <AuthFormCard title="Signing you in" description="Please wait a moment.">
        <div className="space-y-4">
          {error ? (
            <div className="rounded-lg border-l-4 border-red-500 bg-red-50 px-4 py-3 text-red-700">
              {error}
            </div>
          ) : (
            <div className="text-center text-sm text-slate-600">Completing authentication...</div>
          )}
        </div>
      </AuthFormCard>
    </AuthBackground>
  );
}

export default function AuthConfirmPage() {
  return (
    <Suspense
      fallback={
        <AuthBackground>
          <AuthFormCard title="Signing you in" description="Please wait a moment.">
            <div className="text-center text-sm text-slate-600">Loading...</div>
          </AuthFormCard>
        </AuthBackground>
      }
    >
      <AuthConfirmInner />
    </Suspense>
  );
}
