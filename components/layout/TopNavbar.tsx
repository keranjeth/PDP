'use client';

import Image from 'next/image';
import { useEffect, useRef, useState } from 'react';
import Link from 'next/link';
import { useAppAuth } from '@/components/providers/AppProviders';
import { can } from '@/lib/user-management/permissions';
import type { OrgMemberRole } from '@/lib/user-management/types';

function getInitials(name: string) {
  const parts = name.trim().split(/\s+/).filter(Boolean);
  if (parts.length === 0) {
    return '?';
  }
  if (parts.length === 1) {
    return parts[0].slice(0, 2).toUpperCase();
  }
  return `${parts[0][0] ?? ''}${parts[parts.length - 1][0] ?? ''}`.toUpperCase();
}

function MenuIcon() {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" aria-hidden className="h-5 w-5">
      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 7h16M4 12h16M4 17h16" />
    </svg>
  );
}

export function TopNavbar({ onOpenSidebar }: { onOpenSidebar: () => void }) {
  const {
    user,
    displayName,
    email,
    membershipRole,
    roleLabel,
    hasSupabase,
    isReady,
    signOut,
  } = useAppAuth();

  const [open, setOpen] = useState(false);
  const containerRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    if (!open) {
      return;
    }
    const onDocMouseDown = (event: MouseEvent) => {
      const node = containerRef.current;
      if (node && !node.contains(event.target as Node)) {
        setOpen(false);
      }
    };
    document.addEventListener('mousedown', onDocMouseDown);
    return () => document.removeEventListener('mousedown', onDocMouseDown);
  }, [open]);

  const showAccount = hasSupabase && !!user && isReady;
  const currentRole = (membershipRole ?? null) as OrgMemberRole | null;
  const canReadUsers = can(currentRole, 'users', 'read');
  const profileLabel = displayName.trim() || email || 'Account';

  return (
    <header className="fixed top-0 left-0 right-0 z-50 flex h-14 items-center border-b border-gray-200 bg-white/95 px-3 backdrop-blur supports-[backdrop-filter]:bg-white/70 sm:px-4">
      <div className="flex w-full items-center justify-between gap-3">
        <div className="flex min-w-0 items-center gap-2">
          <button
            type="button"
            onClick={onOpenSidebar}
            className="inline-flex h-9 w-9 shrink-0 items-center justify-center rounded-lg border border-slate-200 text-slate-600 transition-colors hover:bg-slate-50 hover:text-slate-900 md:hidden"
            aria-label="Open navigation menu"
          >
            <MenuIcon />
          </button>

          <Link href="/dashboard" className="flex min-w-0 items-center gap-2.5">
            <Image
              src="/logo.svg"
              alt="PD Plan logo"
              width={32}
              height={32}
              priority
              className="h-8 w-8 shrink-0 object-contain"
            />
            <span className="max-w-[12rem] truncate text-sm font-semibold tracking-[-0.01em] text-slate-800 sm:max-w-none sm:text-base">
              PD Plan
            </span>
          </Link>
        </div>

        <div className="flex items-center gap-2 sm:gap-4 md:mr-6 lg:mr-10">
          {showAccount ? (
            <div className="relative" ref={containerRef}>
              <button
                type="button"
                onClick={() => setOpen((v) => !v)}
                className="flex items-center gap-2 rounded-lg px-2 py-1 transition-colors hover:bg-gray-50"
                aria-expanded={open}
                aria-haspopup="menu"
                aria-label="Account menu"
              >
                <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-[var(--primary)] text-[11px] font-bold text-white">
                  {getInitials(profileLabel)}
                </span>
                <span className="hidden max-w-[160px] truncate text-sm font-medium text-gray-900 md:block">
                  {profileLabel}
                </span>
                <svg
                  className={`h-4 w-4 shrink-0 text-gray-500 transition-transform ${open ? 'rotate-180' : ''}`}
                  fill="none"
                  stroke="currentColor"
                  viewBox="0 0 24 24"
                  aria-hidden
                >
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="m19 9-7 7-7-7" />
                </svg>
              </button>

              {open ? (
                <div
                  className="absolute right-0 top-[calc(100%+6px)] z-50 w-[min(16rem,calc(100vw-1rem))] rounded-lg bg-white py-2 shadow-md ring-1 ring-black/5 sm:w-64"
                  role="menu"
                >
                  <div className="px-3 py-2">
                    <p className="text-sm font-semibold text-gray-900">{profileLabel}</p>
                    {email ? <p className="mt-0.5 truncate text-xs text-gray-500">{email}</p> : null}
                  </div>

                  <div className="px-3 py-2">
                    <p className="text-[11px] font-medium uppercase tracking-wide text-gray-500">Roles</p>
                    <div className="mt-1.5 flex flex-wrap gap-1">
                      {roleLabel ? (
                        <span className="rounded-md bg-slate-100 px-2 py-0.5 text-xs font-medium text-gray-800">
                          {roleLabel}
                        </span>
                      ) : null}
                      {membershipRole ? (
                        <span className="rounded-md bg-slate-50 px-2 py-0.5 text-xs text-gray-600">
                          {membershipRole}
                        </span>
                      ) : null}
                      {!roleLabel && !membershipRole ? (
                        <span className="text-xs text-gray-500">-</span>
                      ) : null}
                    </div>
                  </div>

                  <div className="mt-1 border-t border-gray-100 px-2 pt-1">
                    <Link
                      href="/my/profile"
                      className="block w-full rounded-md px-3 py-2 text-left text-sm text-gray-700 hover:bg-gray-50"
                      onClick={() => setOpen(false)}
                    >
                      My Profile
                    </Link>
                    {canReadUsers ? (
                      <Link
                        href="/settings/users"
                        className="block w-full rounded-md px-3 py-2 text-left text-sm text-gray-700 hover:bg-gray-50"
                        onClick={() => setOpen(false)}
                      >
                        User Management
                      </Link>
                    ) : null}
                    <Link
                      href="/settings"
                      className="block w-full rounded-md px-3 py-2 text-left text-sm text-gray-700 hover:bg-gray-50"
                      onClick={() => setOpen(false)}
                    >
                      Settings
                    </Link>
                    <button
                      type="button"
                      role="menuitem"
                      onClick={() => {
                        setOpen(false);
                        void signOut();
                      }}
                      className="w-full rounded-md px-3 py-2 text-left text-sm text-gray-700 hover:bg-gray-50"
                    >
                      Sign out
                    </button>
                  </div>
                </div>
              ) : null}
            </div>
          ) : !hasSupabase || !isReady ? (
            <span className="text-sm text-gray-500" />
          ) : (
            <Link
              href="/login"
              className="rounded-lg bg-[var(--primary)] px-3 py-2 text-sm font-semibold text-white sm:px-4"
            >
              Sign in
            </Link>
          )}
        </div>
      </div>
    </header>
  );
}
