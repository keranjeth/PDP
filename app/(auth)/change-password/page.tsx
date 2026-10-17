'use client';

import { useMemo, useState } from 'react';
import { useRouter } from 'next/navigation';
import { AuthFormCard, authInputClassName } from '@/components/auth/AuthShell';
import { getSupabaseBrowserClient } from '@/lib/supabase/client';
import { Button } from '@/components/ui/Button';

function withTimeout<T>(promise: Promise<T>, timeoutMs: number, message: string) {
  let timer: ReturnType<typeof setTimeout> | null = null;
  const timeout = new Promise<never>((_, reject) => {
    timer = setTimeout(() => reject(new Error(message)), timeoutMs);
  });
  return Promise.race([promise, timeout]).finally(() => {
    if (timer) clearTimeout(timer);
  }) as Promise<T>;
}

export default function ChangePasswordPage() {
  const router = useRouter();
  const supabase = useMemo(() => getSupabaseBrowserClient(), []);

  const [newPassword, setNewPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);
    setSuccess(null);

    if (!supabase) {
      setError('Supabase is not configured.');
      return;
    }

    if (newPassword.length < 12) {
      setError('Password must be at least 12 characters long.');
      return;
    }
    if (!/[A-Z]/.test(newPassword) || !/[a-z]/.test(newPassword) || !/[0-9]/.test(newPassword)) {
      setError('Password must include upper, lower, and numeric characters.');
      return;
    }
    if (!/[!@#$%^&*\-_=+]/.test(newPassword)) {
      setError('Password must include a special character.');
      return;
    }
    if (newPassword !== confirmPassword) {
      setError('Passwords do not match.');
      return;
    }

    setLoading(true);
    try {
      const { data: sessionData } = await supabase.auth.getSession();
      const accessToken = sessionData.session?.access_token ?? null;

      const res = await withTimeout(
        fetch('/api/users/change-password', {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            ...(accessToken ? { Authorization: `Bearer ${accessToken}` } : {}),
          },
          body: JSON.stringify({ newPassword }),
        }),
        15000,
        'Password update timed out. Please try again.'
      );

      const payload = (await res.json().catch(() => null)) as
        | { ok?: boolean; error?: string }
        | null;

      if (!res.ok || !payload?.ok) {
        setError(payload?.error ?? 'Failed to change password. Please try again.');
        return;
      }

      try {
        await withTimeout(
          supabase.auth.refreshSession(),
          10000,
          'Session refresh timed out. Please reload the page.'
        );
      } catch {
        await supabase.auth.signOut();
        router.replace('/login');
        router.refresh();
        return;
      }

      setSuccess('Password changed successfully. Redirecting...');
      router.replace('/dashboard');
      router.refresh();
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : 'Failed to change password. Please try again.');
    } finally {
      setLoading(false);
    }
  };

  return (
    <AuthFormCard
      title="Set a New Password"
      description="Update your password before continuing so your PD Plan workspace stays secure."
    >
      {error ? (
        <div className="mb-4 rounded-lg border-l-4 border-red-500 bg-red-50 px-4 py-3 text-red-700">
          {error}
        </div>
      ) : null}

      {success ? (
        <div className="mb-4 rounded-lg border-l-4 border-[var(--primary)] bg-[var(--primary-light)] px-4 py-3 text-[var(--primary-strong)]">
          {success}
        </div>
      ) : null}

      <form onSubmit={submit} className="space-y-5">
        <div className="space-y-2">
          <label className="block text-sm font-medium text-gray-700" htmlFor="newPassword">
            New Password
          </label>
          <input
            id="newPassword"
            type="password"
            autoComplete="new-password"
            required
            minLength={12}
            value={newPassword}
            onChange={(e) => setNewPassword(e.target.value)}
            placeholder="Create a new password"
            className={authInputClassName}
          />
        </div>

        <div className="space-y-2">
          <label className="block text-sm font-medium text-gray-700" htmlFor="confirmPassword">
            Confirm Password
          </label>
          <input
            id="confirmPassword"
            type="password"
            autoComplete="new-password"
            required
            minLength={12}
            value={confirmPassword}
            onChange={(e) => setConfirmPassword(e.target.value)}
            placeholder="Confirm your new password"
            className={authInputClassName}
          />
        </div>

        <Button
          type="submit"
          disabled={loading}
          size="lg"
          className="w-full rounded-lg py-3 text-base shadow-lg transition-shadow hover:shadow-xl"
        >
          {loading ? 'Changing...' : 'Change Password'}
        </Button>
      </form>
    </AuthFormCard>
  );
}
