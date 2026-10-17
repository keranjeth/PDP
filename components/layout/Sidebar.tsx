'use client';

import Image from 'next/image';
import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { startTransition, useEffect, useEffectEvent, useRef, useState } from 'react';
import { useAppAuth } from '@/components/providers/AppProviders';
import { can } from '@/lib/user-management/permissions';
import type { OrgMemberRole } from '@/lib/user-management/types';

type NavItem = { name: string; href: string; icon: string };

/** Stroke paths matching the existing sidebar icon style (Heroicons-compatible). */
const ICONS = {
  overview:
    'M3 12l2-2m0 0l7-7 7 7M5 10v10a1 1 0 001 1h3m10-11l2 2m-2-2v10a1 1 0 01-1 1h-3m-6 0a1 1 0 001-1v-4a1 1 0 011-1h2a1 1 0 011 1v4a1 1 0 001 1m-6 0h6',
  employees:
    'M12 4.354a4 4 0 110 5.292M15 21H3v-1a6 6 0 0112 0v1zm0 0h6v-1a6 6 0 00-9-5.197M13 7a4 4 0 11-8 0 4 4 0 018 0z',
  budgets:
    'M3 10h18M7 15h1m4 0h1m-7 4h12a3 3 0 003-3V8a3 3 0 00-3-3H6a3 3 0 00-3 3v8a3 3 0 003 3z',
  training:
    'M12 6.253v13m0-13C10.832 5.477 9.246 5 7.5 5S4.168 5.477 3 6.253v13C4.168 18.477 5.754 18 7.5 18s3.332.477 4.5 1.253m0-13C13.168 5.477 14.754 5 16.5 5c1.747 0 3.332.477 4.5 1.253v13C19.832 18.477 18.247 18 16.5 18c-1.746 0-3.332.477-4.5 1.253',
  expenses:
    'M9 14l6-6m-5.5.5h.01m4.99 5h.01M19 21V5a2 2 0 00-2-2H7a2 2 0 00-2 2v16l3.5-2 3.5 2 3.5-2 3.5 2z',
  reports:
    'M9 17v-2m3 2v-4m3 4v-6m2 10H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z',
  settings:
    'M12 6V4m0 2a2 2 0 1 0 0 4m0-4a2 2 0 1 1 0 4m-6 8H4m2 0a2 2 0 1 0 0 4m0-4a2 2 0 1 1 0 4m16-8h-2m2 0a2 2 0 1 0 0-4m0 4a2 2 0 1 1 0-4M12 18v2m0-2a2 2 0 1 0 0-4m0 4a2 2 0 1 1 0-4',
  profile:
    'M5.121 17.804A13.937 13.937 0 0112 16c2.5 0 4.847.655 6.879 1.804M15 10a3 3 0 11-6 0 3 3 0 016 0z',
} as const;

function buildNavigation(role: string | null): NavItem[] {
  if (role === 'employee') {
    return [{ name: 'Overview', href: '/dashboard', icon: ICONS.overview }];
  }

  return [
    { name: 'Overview', href: '/dashboard', icon: ICONS.overview },
    { name: 'Employees', href: '/employees', icon: ICONS.employees },
    { name: 'Budgets', href: '/budgets', icon: ICONS.budgets },
    { name: 'Training Records', href: '/training-records', icon: ICONS.training },
    { name: 'Expenses', href: '/expenses', icon: ICONS.expenses },
    { name: 'Reports', href: '/reports', icon: ICONS.reports },
  ];
}

function ChevronLeftIcon({ className }: { className: string }) {
  return (
    <svg className={className} fill="none" stroke="currentColor" viewBox="0 0 24 24" aria-hidden>
      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 19l-7-7 7-7" />
    </svg>
  );
}

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

export function Sidebar({
  collapsed,
  setCollapsed,
  mobileOpen,
  setMobileOpen,
}: {
  collapsed: boolean;
  setCollapsed: (next: boolean) => void;
  mobileOpen: boolean;
  setMobileOpen: (next: boolean) => void;
}) {
  const pathname = usePathname();
  const {
    user,
    displayName,
    membershipRole,
    hasSupabase,
    isReady,
    signOut,
  } = useAppAuth();
  const navigation = buildNavigation(membershipRole ?? null);
  const currentRole = (membershipRole ?? null) as OrgMemberRole | null;
  const canManageSettings = can(currentRole, 'settings', 'read');
  const canReadUsers = can(currentRole, 'users', 'read');
  const showAccount = hasSupabase && isReady && !!user;
  const display = displayName.trim();
  const profileLabel = display || 'Account';
  const showExpandedLabels = mobileOpen || !collapsed;

  const [menuOpen, setMenuOpen] = useState(false);
  const menuRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    if (!menuOpen) return;
    const onDocMouseDown = (event: MouseEvent) => {
      const node = menuRef.current;
      if (node && !node.contains(event.target as Node)) {
        setMenuOpen(false);
      }
    };
    document.addEventListener('mousedown', onDocMouseDown);
    return () => document.removeEventListener('mousedown', onDocMouseDown);
  }, [menuOpen]);

  const closeTransientMenus = useEffectEvent(() => {
    startTransition(() => {
      setMenuOpen(false);
      setMobileOpen(false);
    });
  });

  useEffect(() => {
    closeTransientMenus();
  }, [pathname]);

  return (
    <>
      {mobileOpen ? (
        <button
          type="button"
          onClick={() => setMobileOpen(false)}
          className="fixed inset-0 z-30 bg-slate-900/35 md:hidden"
          aria-label="Close navigation menu"
        />
      ) : null}

      <aside
        className={`fixed top-0 left-0 z-40 flex h-[100dvh] max-h-[100dvh] min-h-0 w-72 max-w-[85vw] flex-col border-r border-gray-200 bg-white/95 shadow-lg backdrop-blur-sm transition-transform duration-300 md:max-w-none ${
          mobileOpen ? 'translate-x-0' : '-translate-x-full md:translate-x-0'
        } ${collapsed ? 'md:w-16' : 'md:w-48'}`}
      >
        <div className="flex h-14 items-center justify-between border-b border-gray-200 px-4 md:hidden">
          <Link
            href="/dashboard"
            className="flex items-center gap-2 text-sm font-semibold text-slate-800"
            onClick={() => setMobileOpen(false)}
          >
            <Image
              src="/logo.svg"
              alt="PD Plan logo"
              width={32}
              height={32}
              priority
              className="h-8 w-8 shrink-0 object-contain"
            />
            <span className="truncate">Menu</span>
          </Link>
          <button
            type="button"
            onClick={() => setMobileOpen(false)}
            className="inline-flex h-9 w-9 items-center justify-center rounded-lg border border-slate-200 text-slate-600 transition-colors hover:bg-slate-50 hover:text-slate-900"
            aria-label="Close navigation menu"
          >
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" className="h-5 w-5" aria-hidden>
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 6l12 12M18 6 6 18" />
            </svg>
          </button>
        </div>

        <button
          type="button"
          onClick={() => setCollapsed(!collapsed)}
          className="absolute -right-3 top-[5rem] z-50 hidden h-6 w-6 items-center justify-center rounded-md border border-gray-200 bg-white shadow-sm transition hover:bg-gray-50 md:flex"
          aria-label={collapsed ? 'Expand sidebar' : 'Collapse sidebar'}
        >
          <ChevronLeftIcon
            className={`h-5 w-5 text-[var(--primary)] transition-transform duration-300 ${
              collapsed ? 'rotate-180' : ''
            }`}
          />
        </button>

        <nav className="flex min-h-0 flex-1 flex-col overflow-y-auto px-2 pb-2 pt-2 md:pt-[4.5rem]">
          <div className="space-y-1">
            {navigation.map((item) => {
              const isDashboard = item.href === '/dashboard';
              const isActive =
                pathname === item.href ||
                pathname?.startsWith(item.href + '/') ||
                (isDashboard && pathname === '/');

              return (
                <Link
                  key={item.name}
                  href={item.href}
                  onClick={() => setMobileOpen(false)}
                  className={`relative flex items-center gap-3 rounded-lg px-3 py-2.5 text-sm font-medium transition-all duration-200 ${
                    isActive
                      ? 'bg-[var(--primary-light)] text-[var(--primary-strong)]'
                      : 'text-slate-700 hover:bg-slate-100/70 hover:text-slate-900'
                  } ${collapsed ? 'md:justify-center md:px-2' : ''}`}
                >
                  <svg
                    className={`h-5 w-5 ${
                      isActive ? 'text-[var(--primary)]' : 'text-slate-400'
                    }`}
                    fill="none"
                    stroke="currentColor"
                    viewBox="0 0 24 24"
                    aria-hidden
                  >
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d={item.icon} />
                  </svg>
                  {showExpandedLabels ? <span className="truncate">{item.name}</span> : null}
                </Link>
              );
            })}
          </div>
        </nav>

        <div className="shrink-0 border-t border-gray-200 bg-white/95 px-2 py-2">
          {showAccount ? (
            <div className="relative" ref={menuRef}>
              <button
                type="button"
                onClick={() => setMenuOpen((v) => !v)}
                className={`flex w-full items-center gap-3 rounded-lg px-3 py-2.5 text-sm font-medium text-slate-700 transition-colors hover:bg-slate-100/70 hover:text-slate-900 ${
                  collapsed ? 'md:justify-center md:px-2' : ''
                }`}
                aria-expanded={menuOpen}
                aria-haspopup="menu"
                aria-label="Settings menu"
              >
                <span className="flex h-7 w-7 shrink-0 items-center justify-center rounded-full bg-[var(--primary)] text-[10px] font-bold text-white">
                  {getInitials(profileLabel)}
                </span>
                {showExpandedLabels ? (
                  <span className="min-w-0 flex-1 text-left">
                    <span
                      className="block break-words pr-1 text-[12px] font-semibold leading-[1.15] text-slate-900"
                      title={profileLabel}
                    >
                      {profileLabel}
                    </span>
                  </span>
                ) : null}
                {showExpandedLabels ? (
                  <svg
                    className={`h-4 w-4 shrink-0 text-slate-400 transition-transform ${
                      menuOpen ? 'rotate-180' : ''
                    }`}
                    fill="none"
                    stroke="currentColor"
                    viewBox="0 0 24 24"
                    aria-hidden
                  >
                    <path
                      strokeLinecap="round"
                      strokeLinejoin="round"
                      strokeWidth={2}
                      d="m19 9-7 7-7-7"
                    />
                  </svg>
                ) : null}
              </button>

              {menuOpen ? (
                <div
                  className={`absolute bottom-[calc(100%+8px)] z-50 rounded-lg bg-white py-1 shadow-md ring-1 ring-black/5 ${
                    showExpandedLabels ? 'left-2 right-2' : 'left-2 right-2 md:right-auto md:w-56'
                  }`}
                  role="menu"
                >
                  <Link
                    href="/my/profile"
                    className="block rounded-md px-3 py-2 text-sm text-slate-700 hover:bg-slate-50"
                    onClick={() => {
                      setMenuOpen(false);
                      setMobileOpen(false);
                    }}
                  >
                    My Profile
                  </Link>
                  {canReadUsers ? (
                    <Link
                      href="/settings/users"
                      className="block rounded-md px-3 py-2 text-sm text-slate-700 hover:bg-slate-50"
                      onClick={() => {
                        setMenuOpen(false);
                        setMobileOpen(false);
                      }}
                    >
                      User Management
                    </Link>
                  ) : null}
                  {canManageSettings ? (
                    <Link
                      href="/settings"
                      className="block rounded-md px-3 py-2 text-sm text-slate-700 hover:bg-slate-50"
                      onClick={() => {
                        setMenuOpen(false);
                        setMobileOpen(false);
                      }}
                    >
                      Settings
                    </Link>
                  ) : null}
                  <div className="my-1 border-t border-slate-100" />
                  <button
                    type="button"
                    onClick={() => {
                      setMenuOpen(false);
                      setMobileOpen(false);
                      void signOut();
                    }}
                    className="block w-full rounded-md px-3 py-2 text-left text-sm text-slate-700 hover:bg-slate-50"
                    role="menuitem"
                  >
                    Sign out
                  </button>
                </div>
              ) : null}
            </div>
          ) : canManageSettings ? (
            <Link
              href="/settings"
              className={`flex items-center gap-3 rounded-lg px-3 py-2.5 text-sm font-medium transition-all duration-200 ${
                pathname === '/settings' || pathname?.startsWith('/settings/')
                  ? 'bg-[var(--primary-light)] text-[var(--primary-strong)]'
                  : 'text-slate-700 hover:bg-slate-100/70 hover:text-slate-900'
              } ${collapsed ? 'md:justify-center md:px-2' : ''}`}
              onClick={() => setMobileOpen(false)}
            >
              <svg
                className={`h-5 w-5 ${
                  pathname === '/settings' || pathname?.startsWith('/settings/')
                    ? 'text-[var(--primary)]'
                    : 'text-slate-400'
                }`}
                fill="none"
                stroke="currentColor"
                viewBox="0 0 24 24"
                aria-hidden
              >
                <path
                  strokeLinecap="round"
                  strokeLinejoin="round"
                  strokeWidth={2}
                  d={ICONS.settings}
                />
              </svg>
              {showExpandedLabels ? <span className="truncate">Settings</span> : null}
            </Link>
          ) : null}
        </div>
      </aside>
    </>
  );
}
