'use client';

import Link from 'next/link';
import { useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import { useAppAuth } from '@/components/providers/AppProviders';
import { HeaderDivider } from '@/components/ui/HeaderDivider';
import { getSupabaseBrowserClient } from '@/lib/supabase/client';
import { can } from '@/lib/user-management/permissions';

export default function MyProfilePage() {
  const router = useRouter();
  const { isReady, hasSupabase, orgId, user, membershipRole } = useAppAuth();
  const canReadUsers = can(membershipRole, 'users', 'read');
  const configError = isReady && !hasSupabase ? 'Supabase is not configured.' : null;
  const [status, setStatus] = useState<'loading' | 'linked' | 'not_linked' | 'error'>(
    'loading'
  );
  const [error, setError] = useState<string | null>(null);
  const displayStatus = configError ? 'error' : status;
  const displayError = configError ?? error;

  useEffect(() => {
    if (configError || !isReady || !hasSupabase || !orgId || !user?.id) return;
    const supabase = getSupabaseBrowserClient();
    if (!supabase) return;
    let cancelled = false;

    void (async () => {
      const { data, error } = await supabase
        .from('employee_user_links')
        .select('employee_id')
        .eq('org_id', orgId)
        .eq('user_id', user.id)
        .maybeSingle();

      if (cancelled) return;
      if (error) {
        setStatus('error');
        setError(error.message ?? 'Failed to load your profile.');
        return;
      }

      const employeeId = String((data as { employee_id?: string } | null)?.employee_id ?? '').trim();
      if (!employeeId) {
        setStatus('not_linked');
        return;
      }

      setStatus('linked');
      router.replace(`/employees/${employeeId}`);
      router.refresh();
    })();

    return () => {
      cancelled = true;
    };
  }, [configError, isReady, hasSupabase, orgId, user?.id, router]);

  return (
    <div className="mx-auto max-w-5xl">
      <div className="overflow-hidden rounded-[18px] border border-slate-200/90 bg-white shadow-sm">
        <div className="relative px-4 py-5 sm:px-6">
          <div className="absolute inset-x-0 top-0 h-[3px] bg-gradient-to-r from-[var(--primary)] via-[var(--primary-strong)] to-[var(--analytics-actual)]" />
          <h2 className="text-[15px] font-semibold text-slate-900">My Profile</h2>
          <p className="mt-1 text-sm text-slate-500">
            {displayStatus === 'not_linked'
              ? 'Your account is not linked to an employee record.'
              : displayStatus === 'error'
                ? 'We could not load your profile.'
                : 'Opening your employee profile…'}
          </p>
          <HeaderDivider className="mt-4" />
        </div>

        {displayStatus === 'loading' || displayStatus === 'linked' ? (
          <div className="px-4 py-6 sm:px-6">
            <div className="flex items-center gap-4">
              <div className="h-10 w-10 rounded-full bg-[var(--primary-light)]" />
              <div className="min-w-0 flex-1">
                <div className="h-4 w-48 rounded bg-slate-100 animate-pulse" />
                <div className="mt-2 h-3 w-72 rounded bg-slate-100 animate-pulse" />
              </div>
            </div>
            <div className="mt-6 grid grid-cols-1 gap-3 sm:grid-cols-2">
              <div className="h-20 rounded-2xl border border-slate-200/90 bg-slate-50/30 animate-pulse" />
              <div className="h-20 rounded-2xl border border-slate-200/90 bg-slate-50/30 animate-pulse" />
            </div>
            <p className="mt-4 text-xs text-slate-500">
              If this takes more than a few seconds, your account may not be linked yet.
            </p>
          </div>
        ) : displayStatus === 'not_linked' ? (
          <div className="px-4 py-6 sm:px-6">
            <div className="rounded-2xl border border-slate-200 bg-slate-50/40 p-5">
              <p className="text-sm font-medium text-slate-900">Not linked</p>
              <p className="mt-1 text-sm text-slate-600">
                Ask your HR/Super Admin to link your login to your employee record.
              </p>
              <div className="mt-4 flex flex-wrap gap-2">
                {canReadUsers ? (
                  <Link
                    href="/settings/users"
                    className="inline-flex h-9 items-center rounded-xl border border-[var(--primary)] px-3 text-sm font-medium text-[var(--primary)] transition-colors hover:bg-[var(--primary-light)]"
                  >
                    Go to User Management
                  </Link>
                ) : null}
                <Link
                  href="/dashboard"
                  className="inline-flex h-9 items-center rounded-xl border border-slate-200 bg-white px-3 text-sm font-medium text-slate-700 transition-colors hover:bg-slate-50"
                >
                  Back to Dashboard
                </Link>
              </div>
            </div>
          </div>
        ) : (
          <div className="px-4 py-6 sm:px-6">
            <div className="rounded-2xl border border-rose-200 bg-rose-50/60 p-5">
              <p className="text-sm font-medium text-rose-900">Could not load profile</p>
              <p className="mt-1 text-sm text-rose-800">{displayError ?? 'Unknown error.'}</p>
              <div className="mt-4">
                <Link
                  href="/dashboard"
                  className="inline-flex h-9 items-center rounded-xl border border-rose-300 bg-white px-3 text-sm font-medium text-rose-800 transition-colors hover:bg-rose-50"
                >
                  Back to Dashboard
                </Link>
              </div>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}

