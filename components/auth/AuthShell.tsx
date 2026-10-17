'use client';

import type { ReactNode } from 'react';
import Link from 'next/link';
import Image from 'next/image';

export function AuthBackground({ children }: { children: ReactNode }) {
  return (
    <div className="min-h-svh bg-[#F0FAF4] relative overflow-hidden">
      <div
        className="pointer-events-none absolute w-[180vw] h-[80vh] top-[-20vh] right-[-40vw] -rotate-12 z-0"
        style={{
          background:
            'linear-gradient(120deg, var(--primary-border) 0%, var(--primary-light) 60%, transparent 100%)',
          opacity: 0.55,
        }}
      />

      <div className="relative z-10 flex items-center justify-center min-h-svh p-4">
        {children}
      </div>
    </div>
  );
}

export function AuthFormCard({
  title,
  description,
  children,
  footer,
}: {
  title: string;
  description?: string;
  children: ReactNode;
  footer?: ReactNode;
}) {
  return (
    <div className="z-10 w-full max-w-md overflow-hidden rounded-2xl bg-white/85 shadow-2xl backdrop-blur-lg">
      <div className="space-y-5 p-5 sm:p-6">
        <div className="flex flex-col items-center justify-center gap-3 text-center">
          <div className="relative h-16 w-16">
            <Image
              src="/logo.svg"
              alt="PD Plan logo"
              fill
              priority
              className="object-contain"
            />
          </div>
          <div>
            <h1 className="text-xl font-semibold text-slate-900">{title}</h1>
            {description ? (
              <p className="mt-2 text-sm leading-6 text-slate-600">{description}</p>
            ) : null}
          </div>
        </div>

        <div>{children}</div>

        {footer ? <div className="border-t border-gray-200 pt-5">{footer}</div> : null}
      </div>
    </div>
  );
}

export function AuthActionPanel({
  eyebrow,
  title,
  description,
  href,
  ctaLabel,
}: {
  eyebrow: string;
  title: string;
  description: string;
  href: string;
  ctaLabel: string;
}) {
  return (
    <div className="rounded-2xl border border-[var(--primary-border)] bg-[var(--primary-light)] p-4 text-center">
      <p className="text-[11px] font-semibold uppercase tracking-[0.22em] text-[var(--primary-strong)]">
        {eyebrow}
      </p>
      <h2 className="mt-2 text-base font-semibold text-slate-900">{title}</h2>
      <p className="mt-2 text-sm leading-6 text-slate-600">{description}</p>
      <Link
        href={href}
        className="mt-4 inline-flex min-h-11 items-center justify-center rounded-lg border border-[var(--primary)] bg-white px-5 py-2.5 text-sm font-medium text-[var(--primary-strong)] shadow-sm transition-colors hover:bg-white/70"
      >
        {ctaLabel}
      </Link>
    </div>
  );
}

export const authInputClassName =
  'w-full rounded-lg border border-[var(--primary-border)] bg-white px-3 py-2 text-sm text-gray-900 shadow-sm outline-none transition focus:border-[var(--primary)] focus:ring-2 focus:ring-[var(--primary-light)]';
