'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import {
  AuthFormCard,
  authInputClassName,
} from '@/components/auth/AuthShell';
import { ensureWorkspaceAccess } from '@/lib/auth/ensure-workspace-access';
import { getSupabaseBrowserClient } from '@/lib/supabase/client';
import { Button } from '@/components/ui/Button';
import Link from 'next/link';

function GoogleIcon({ className }: { className?: string }) {
  return (
    <svg viewBox="0 0 48 48" aria-hidden className={className ?? 'h-5 w-5'}>
      <path
        fill="#EA4335"
        d="M24 9.5c3.54 0 6.28 1.53 7.72 2.81l5.63-5.63C33.76 3.44 29.35 1.5 24 1.5 14.73 1.5 6.79 6.81 2.97 14.53l6.78 5.25C11.46 13.9 17.23 9.5 24 9.5Z"
      />
      <path
        fill="#34A853"
        d="M46.5 24.5c0-1.64-.15-2.85-.47-4.1H24v7.77h12.8c-.26 2-1.66 5.02-4.77 7.04l7.34 5.69c4.39-4.06 7.13-10.05 7.13-16.4Z"
      />
      <path
        fill="#4A90E2"
        d="M31.56 35.2c-2.02 1.41-4.71 2.3-7.56 2.3-6.75 0-12.49-4.4-14.55-10.46l-6.87 5.3C6.43 40.19 14.54 46.5 24 46.5c5.35 0 9.86-1.76 13.15-4.8l-5.59-6.5Z"
      />
      <path
        fill="#FBBC05"
        d="M9.45 27.04A15.27 15.27 0 0 1 8.6 24c0-1.06.17-2.09.45-3.04l-6.78-5.25A23.08 23.08 0 0 0 1.5 24c0 3.73.9 7.26 2.49 10.38l5.46-7.34Z"
      />
    </svg>
  );
}

export default function SignupPage() {
  const router = useRouter();
  const supabase = getSupabaseBrowserClient();

  const [fullName, setFullName] = useState('');
  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [message, setMessage] = useState<string | null>(null);

  const handleGoogle = async () => {
    setLoading(true);
    setError(null);
    setMessage(null);

    if (!supabase) {
      setError(
        'Supabase is not configured. Add NEXT_PUBLIC_SUPABASE_URL and NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY to .env.local.'
      );
      setLoading(false);
      return;
    }

    const origin = typeof window !== 'undefined' ? window.location.origin : '';
    const redirectTo = origin ? `${origin}/auth/confirm?next=${encodeURIComponent('/dashboard')}` : undefined;

    const { error: oauthError } = await supabase.auth.signInWithOAuth({
      provider: 'google',
      options: redirectTo ? { redirectTo } : undefined,
    });

    setLoading(false);
    if (oauthError) {
      setError(oauthError.message);
    }
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setLoading(true);
    setError(null);
    setMessage(null);

    if (!supabase) {
      setError(
        'Supabase is not configured. Add NEXT_PUBLIC_SUPABASE_URL and NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY to .env.local.'
      );
      setLoading(false);
      return;
    }

    const { data, error: signError } = await supabase.auth.signUp({
      // Interpreting "username" as the account identifier (typically email in Supabase).
      email: username.trim(),
      password,
      options: {
        data: { full_name: fullName.trim() },
      },
    });

    setLoading(false);

    if (signError) {
      setError(signError.message);
      return;
    }

    if (data.session) {
      const {
        data: { user },
      } = await supabase.auth.getUser();
      if (user) {
        const access = await ensureWorkspaceAccess(supabase, user);
        if (!access.ok) {
          await supabase.auth.signOut().catch(() => null);
          setError(
            access.reason === 'error'
              ? access.message
              : 'This account is pending activation or inactive. Contact your administrator.'
          );
          return;
        }
      }
      router.push('/dashboard');
      router.refresh();
      return;
    }

    setMessage(
      'Account created. If email confirmation is enabled in Supabase, check your inbox before signing in.'
    );
  };

  return (
    <AuthFormCard
      title="Create account"
      description="Create your PD Plan account with your organization email."
      footer={
        <p className="text-center text-sm text-slate-600">
          Already have an account?{' '}
          <Link href="/login" className="font-medium text-[var(--primary-strong)] hover:underline">
            Sign in
          </Link>
        </p>
      }
    >
      {error ? (
        <div className="mb-4 rounded-lg border-l-4 border-red-500 bg-red-50 px-4 py-3 text-red-700">
          {error}
        </div>
      ) : null}

      {message ? (
        <div className="mb-4 rounded-lg border-l-4 border-[var(--primary)] bg-[var(--primary-light)] px-4 py-3 text-[var(--primary-strong)]">
          {message}
        </div>
      ) : null}

      <div className="space-y-4">
        <Button
          type="button"
          onClick={handleGoogle}
          disabled={loading}
          variant="secondary"
          size="md"
          className="w-full rounded-lg border border-[var(--primary-border)] bg-white text-slate-800 hover:bg-[var(--primary-light)]"
        >
          <span className="inline-flex items-center justify-center gap-2">
            <GoogleIcon className="h-5 w-5" />
            Continue with Google
          </span>
        </Button>

        <div className="flex items-center gap-3">
          <div className="h-px flex-1 bg-gray-200" />
          <span className="text-xs text-gray-500">or</span>
          <div className="h-px flex-1 bg-gray-200" />
        </div>

        <form onSubmit={handleSubmit} className="space-y-3">
          <div className="space-y-2">
            <label className="block text-sm font-medium text-gray-700" htmlFor="fullName">
              Full name
            </label>
            <input
              id="fullName"
              type="text"
              value={fullName}
              onChange={(e) => setFullName(e.target.value)}
              required
              placeholder="Enter your full name"
              className={authInputClassName}
            />
          </div>

          <div className="space-y-2">
            <label className="block text-sm font-medium text-gray-700" htmlFor="username">
              Username
            </label>
            <input
              id="username"
              type="text"
              value={username}
              onChange={(e) => setUsername(e.target.value)}
              required
              placeholder="Enter your username"
              className={authInputClassName}
            />
          </div>

          <div className="space-y-2">
            <label className="block text-sm font-medium text-gray-700" htmlFor="password">
              Password
            </label>
            <input
              id="password"
              type="password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              required
              minLength={6}
              placeholder="Create a password"
              className={authInputClassName}
            />
          </div>

          <Button
            type="submit"
            disabled={loading}
            size="md"
            className="w-full rounded-lg shadow-sm transition-shadow hover:shadow"
          >
            {loading ? 'Creating account...' : 'Continue'}
          </Button>
        </form>
      </div>
    </AuthFormCard>
  );
}
