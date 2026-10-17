'use client';

import {
  useDeferredValue,
  useEffect,
  useMemo,
  useRef,
  useState,
  useSyncExternalStore,
  type ReactNode,
} from 'react';
import { createPortal } from 'react-dom';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useAppAuth } from '@/components/providers/AppProviders';
import { HeaderDivider } from '@/components/ui/HeaderDivider';
import { CompactEmployeeTable } from '@/components/ui/compact-employee-table';
import { getSupabaseBrowserClient } from '@/lib/supabase/client';
import type { OrgMemberRole, OrgMemberStatus, OrgMemberView } from '@/lib/user-management/types';
import { fetchOrgMemberViews, fetchOrgRegions } from '@/lib/user-management/org-members';
import { can } from '@/lib/user-management/permissions';
import { isDeliverableEmail } from '@/lib/users/password-policy';
import { PlusGlyph, TableSearchInput } from '@/components/ui/table-controls';

const ROLE_OPTIONS: OrgMemberRole[] = [
  'super_admin',
  'hr_national',
  'head_of_hr',
  'regional_hr',
  'employee',
];

const ROLE_LABEL: Record<OrgMemberRole, string> = {
  super_admin: 'Super Admin',
  hr_national: 'HR National',
  head_of_hr: 'Head of HR',
  regional_hr: 'Regional HR',
  employee: 'Employee',
};

const STATUS_LABEL: Record<OrgMemberStatus, string> = {
  active: 'Active',
  inactive: 'Inactive',
  pending_activation: 'Pending Activation',
};

function getAvatarInitial(name: string) {
  return name.trim().charAt(0).toUpperCase() || '?';
}

function useIsClientMounted() {
  return useSyncExternalStore(
    () => () => {},
    () => true,
    () => false
  );
}

/** Table-safe actions menu: portals to document.body so overflow/clipping cannot hide it. */
function RowActionsMenu({
  open,
  onOpenChange,
  ariaLabel,
  children,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  ariaLabel: string;
  children: ReactNode;
}) {
  const buttonRef = useRef<HTMLButtonElement | null>(null);
  const menuRef = useRef<HTMLDivElement | null>(null);
  const [coords, setCoords] = useState<{ top: number; left: number } | null>(null);
  const mounted = useIsClientMounted();

  const onOpenChangeRef = useRef(onOpenChange);

  useEffect(() => {
    onOpenChangeRef.current = onOpenChange;
  }, [onOpenChange]);

  useEffect(() => {
    if (!open) {
      return;
    }

    const place = () => {
      const rect = buttonRef.current?.getBoundingClientRect();
      // Hidden duplicate triggers (e.g. mobile card while desktop table is shown) report 0×0.
      // Skip portaling for those so we do not render a second menu at the top-left corner.
      if (!rect || rect.width < 1 || rect.height < 1) {
        return;
      }
      const menuWidth = 192;
      const left = Math.min(
        Math.max(8, rect.right - menuWidth),
        window.innerWidth - menuWidth - 8
      );
      setCoords({ top: rect.bottom + 4, left });
    };

    const placeTimer = window.requestAnimationFrame(() => {
      place();
    });

    const onPointerDown = (event: MouseEvent) => {
      const target = event.target as Node;
      if (buttonRef.current?.contains(target) || menuRef.current?.contains(target)) return;
      onOpenChangeRef.current(false);
    };
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') onOpenChangeRef.current(false);
    };
    const onReposition = () => place();

    // Defer so the opening click does not immediately dismiss the menu.
    const attachTimer = window.setTimeout(() => {
      document.addEventListener('mousedown', onPointerDown);
    }, 0);
    document.addEventListener('keydown', onKeyDown);
    window.addEventListener('resize', onReposition);
    window.addEventListener('scroll', onReposition, true);
    return () => {
      window.cancelAnimationFrame(placeTimer);
      window.clearTimeout(attachTimer);
      document.removeEventListener('mousedown', onPointerDown);
      document.removeEventListener('keydown', onKeyDown);
      window.removeEventListener('resize', onReposition);
      window.removeEventListener('scroll', onReposition, true);
    };
  }, [open]);

  return (
    <div className="relative inline-flex justify-end">
      <button
        ref={buttonRef}
        type="button"
        aria-label={ariaLabel}
        aria-haspopup="menu"
        aria-expanded={open}
        onClick={() => onOpenChange(!open)}
        className="inline-flex h-7 w-7 items-center justify-center rounded-full text-slate-600 transition-colors hover:bg-slate-100"
      >
        <svg viewBox="0 0 20 20" fill="currentColor" className="h-4 w-4" aria-hidden>
          <circle cx="10" cy="4" r="1.5" />
          <circle cx="10" cy="10" r="1.5" />
          <circle cx="10" cy="16" r="1.5" />
        </svg>
      </button>
      {mounted && open && coords
        ? createPortal(
            <div
              ref={menuRef}
              role="menu"
              className="fixed z-[10000] w-48 rounded-md border border-slate-200 bg-white p-1 shadow-lg"
              style={{ top: coords.top, left: coords.left }}
            >
              {children}
            </div>,
            document.body
          )
        : null}
    </div>
  );
}

function withTimeout<T>(promise: Promise<T>, timeoutMs: number) {
  return new Promise<T>((resolve, reject) => {
    const t = window.setTimeout(
      () => reject(new Error('Request timed out. Please try again.')),
      timeoutMs
    );
    promise
      .then((value) => resolve(value))
      .catch((err) => reject(err))
      .finally(() => window.clearTimeout(t));
  });
}

function MetricCardIcon({ icon }: { icon: 'users' | 'active' | 'admins' | 'linked' }) {
  const common = 'h-4 w-4 text-[var(--analytics-budget)]';

  if (icon === 'users') {
    return (
      <svg
        viewBox="0 0 24 24"
        fill="none"
        stroke="currentColor"
        strokeWidth="1.9"
        className={common}
        aria-hidden
      >
        <path d="M16 21v-2a4 4 0 0 0-4-4H8a4 4 0 0 0-4 4v2" />
        <circle cx="10" cy="7" r="4" />
        <path d="M22 21v-2a4 4 0 0 0-3-3.87" />
        <path d="M16 3.13a4 4 0 0 1 0 7.75" />
      </svg>
    );
  }
  if (icon === 'active') {
    return (
      <svg
        viewBox="0 0 24 24"
        fill="none"
        stroke="currentColor"
        strokeWidth="1.9"
        className={common}
        aria-hidden
      >
        <path d="M22 11.08V12a10 10 0 1 1-5.93-9.14" />
        <path d="M22 4 12 14.01l-3-3" />
      </svg>
    );
  }
  if (icon === 'admins') {
    return (
      <svg
        viewBox="0 0 24 24"
        fill="none"
        stroke="currentColor"
        strokeWidth="1.9"
        className={common}
        aria-hidden
      >
        <path d="M12 2l7 4v6c0 5-3 9-7 10-4-1-7-5-7-10V6l7-4z" />
        <path d="M9 12l2 2 4-5" />
      </svg>
    );
  }
  return (
    <svg
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.9"
      className={common}
      aria-hidden
    >
      <path d="M8 7V6a4 4 0 0 1 8 0v1" />
      <rect x="6" y="7" width="12" height="14" rx="2" />
      <path d="M10 11h4" />
      <path d="M10 15h4" />
    </svg>
  );
}

function MetricCard({
  title,
  total,
  bottomLabel,
  icon,
}: {
  title: string;
  total: number;
  bottomLabel: string;
  icon: 'users' | 'active' | 'admins' | 'linked';
}) {
  return (
    <div className="group relative overflow-hidden rounded-[14px] border border-slate-200/90 bg-white px-4 py-3 shadow-sm">
      <div className="absolute inset-x-0 top-0 h-[3px] bg-gradient-to-r from-[var(--analytics-budget)] via-[var(--analytics-budget-hover)] to-[var(--analytics-budget-soft)]" />

      <div className="grid min-h-[104px] grid-rows-[auto_auto_1fr] gap-2.5">
        <div className="flex justify-between">
          <p className="text-[15px] font-semibold text-slate-800">{title}</p>
          <div className="flex h-9 w-9 items-center justify-center rounded-[12px] border border-[var(--analytics-selected-fill)] bg-[var(--analytics-budget-background)]">
            <MetricCardIcon icon={icon} />
          </div>
        </div>

        <div className="flex justify-between">
          <span className="text-[20px] font-semibold text-slate-700">{total}</span>
          <span className="text-[12px] font-semibold text-slate-400">Today</span>
        </div>

        <div className="flex justify-between text-[12px] text-slate-500">
          <span>{bottomLabel}</span>
          <span>—</span>
        </div>
      </div>
    </div>
  );
}

function SimpleSelect({
  label,
  value,
  displayValue,
  options,
  onChange,
  disabled,
}: {
  label: string;
  value: string;
  displayValue: string;
  options: Array<{ value: string; label: string }>;
  onChange: (next: string) => void;
  disabled?: boolean;
}) {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    if (!open) return;
    const onDown = (event: MouseEvent) => {
      const node = ref.current;
      if (node && !node.contains(event.target as Node)) {
        setOpen(false);
      }
    };
    document.addEventListener('mousedown', onDown);
    return () => document.removeEventListener('mousedown', onDown);
  }, [open]);

  return (
    <div ref={ref} className="relative">
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        disabled={disabled}
        aria-label={label}
        aria-expanded={open}
        className="mt-1 flex w-full items-center justify-between gap-3 rounded-xl border border-slate-200 bg-white px-3 py-2 text-left text-sm text-slate-700 outline-none focus:border-[var(--primary)] disabled:opacity-60"
      >
        <span className="truncate">{displayValue}</span>
        <svg
          className={`h-4 w-4 shrink-0 text-slate-400 transition-transform ${open ? 'rotate-180' : ''}`}
          fill="none"
          stroke="currentColor"
          viewBox="0 0 24 24"
          aria-hidden
        >
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="m19 9-7 7-7-7" />
        </svg>
      </button>

      {open ? (
        <div className="absolute left-0 right-0 top-[calc(100%+6px)] z-50 overflow-hidden rounded-xl border border-slate-200 bg-white shadow-lg">
          <div className="max-h-64 overflow-auto py-1">
            {options.map((opt) => {
              const active = opt.value === value;
              return (
                <button
                  key={opt.value}
                  type="button"
                  onClick={() => {
                    onChange(opt.value);
                    setOpen(false);
                  }}
                  className={`flex w-full items-center justify-between px-3 py-2 text-left text-sm transition-colors ${
                    active
                      ? 'bg-[var(--primary-light)] font-semibold text-[var(--primary-strong)]'
                      : 'text-slate-700 hover:bg-slate-50'
                  }`}
                >
                  <span className="truncate">{opt.label}</span>
                  {active ? (
                    <span className="text-[var(--primary)]">
                      <svg viewBox="0 0 20 20" fill="currentColor" className="h-4 w-4" aria-hidden>
                        <path
                          fillRule="evenodd"
                          d="M16.704 5.29a1 1 0 010 1.42l-7.1 7.1a1 1 0 01-1.415 0l-3.39-3.39a1 1 0 111.415-1.415l2.683 2.683 6.392-6.392a1 1 0 011.415 0z"
                          clipRule="evenodd"
                        />
                      </svg>
                    </span>
                  ) : null}
                </button>
              );
            })}
          </div>
        </div>
      ) : null}
    </div>
  );
}

type UserTableRow = {
  id: string; // userId
  idNumber: string;
  fullName: string;
  email: string | null;
  position: string;
  roleLabel: string;
  statusLabel: string;
  regionLabel: string;
  linkedEmployeeId: string | null;
  userId: string;
  orgMemberRole: OrgMemberRole;
  orgMemberStatus: OrgMemberStatus;
  regions: string[];
  canResetPassword: boolean;
};

export default function UserManagementPage() {
  const router = useRouter();
  const { orgId, membershipRole, user, isReady, hasSupabase } = useAppAuth();
  const isEmployee = membershipRole === 'employee';
  const isSuperAdmin = membershipRole === 'super_admin';
  const supabase = useMemo(() => getSupabaseBrowserClient(), []);

  const [members, setMembers] = useState<OrgMemberView[]>([]);
  const [resetGrants, setResetGrants] = useState<Set<string>>(() => new Set());
  const [canResetPasswords, setCanResetPasswords] = useState(false);
  const [orgRegions, setOrgRegions] = useState<string[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [query, setQuery] = useState('');
  const deferredQuery = useDeferredValue(query);
  const [menuOpenFor, setMenuOpenFor] = useState<string | null>(null);

  const canUpdateUsers = can(membershipRole, 'users', 'update');
  const canCreateUsers = can(membershipRole, 'users', 'create');
  const canAccessPage =
    can(membershipRole, 'users', 'read') || canResetPasswords || isSuperAdmin;

  const load = async () => {
    if (!orgId || !user?.id) return;
    setLoading(true);
    setError(null);
    try {
      const res = await withTimeout(
        fetch(`/api/users/directory?orgId=${encodeURIComponent(orgId)}`),
        90000
      );
      const payload = (await res.json().catch(() => null)) as {
        ok?: boolean;
        error?: string;
        members?: OrgMemberView[];
        canResetPasswords?: boolean;
        isSuperAdmin?: boolean;
        resetGrants?: string[];
      } | null;

      if (!res.ok || !payload?.ok) {
        // Fallback for Super Admin if directory API tables are not migrated yet.
        if (supabase && (isSuperAdmin || can(membershipRole, 'users', 'read'))) {
          const next = await withTimeout(fetchOrgMemberViews(supabase, orgId), 90000);
          setMembers(next);
          setCanResetPasswords(isSuperAdmin);
          setResetGrants(new Set());
          return;
        }
        throw new Error(payload?.error || 'Failed to load users.');
      }

      setMembers(payload.members ?? []);
      setCanResetPasswords(Boolean(payload.canResetPasswords));
      setResetGrants(new Set(payload.resetGrants ?? []));
    } catch (e: unknown) {
      setError(e instanceof Error ? e.message : 'Failed to load users.');
    } finally {
      setLoading(false);
    }
  };

  const loadRegions = async () => {
    if (!supabase || !orgId) return;
    if (orgRegions.length > 0) return;
    try {
      const regions = await withTimeout(fetchOrgRegions(supabase, orgId), 30000);
      setOrgRegions(regions);
    } catch {
      // Regions are optional; keep UX responsive even if this fails.
    }
  };

  useEffect(() => {
    if (!isReady || !hasSupabase) return;
    if (isEmployee) {
      router.replace('/settings');
      router.refresh();
      return;
    }
    queueMicrotask(() => {
      void load();
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isReady, hasSupabase, orgId, isEmployee, router, isSuperAdmin]);

  const rows = useMemo((): UserTableRow[] => {
    const list = members.map((m): UserTableRow => {
      const linked = m.linkedEmployee;
      const idNumber = linked?.idNumber?.trim() ? linked.idNumber : '-';
      const fullName =
        linked?.fullName?.trim() ||
        m.fullName?.trim() ||
        m.email?.trim() ||
        'Unnamed user';
      const position = linked?.designation?.trim() ? linked.designation : '-';
      const regionLabel =
        m.role === 'regional_hr'
          ? m.regions.length > 0
            ? m.regions.join(', ')
            : '-'
          : linked?.region?.trim()
            ? linked.region
            : '-';

      return {
        id: m.userId,
        idNumber,
        fullName,
        email: m.email ?? null,
        position,
        roleLabel: ROLE_LABEL[m.role],
        statusLabel: STATUS_LABEL[m.status] ?? m.status,
        regionLabel,
        linkedEmployeeId: linked?.employeeId ?? null,
        userId: m.userId,
        orgMemberRole: m.role,
        orgMemberStatus: m.status,
        regions: m.regions,
        canResetPassword: resetGrants.has(m.userId),
      };
    });

    const q = deferredQuery.trim().toLowerCase();
    if (!q) return list;
    return list.filter((r) => {
      const hay =
        `${r.idNumber} ${r.fullName} ${r.email ?? ''} ${r.position} ${r.roleLabel} ${r.statusLabel} ${r.regionLabel}`.toLowerCase();
      return hay.includes(q);
    });
  }, [members, deferredQuery, resetGrants]);

  const metrics = useMemo(() => {
    const total = members.length;
    const active = members.filter((m) => m.status === 'active').length;
    const admins = members.filter((m) => m.role !== 'employee').length;
    const linked = members.filter((m) => !!m.linkedEmployee).length;
    return { total, active, admins, linked };
  }, [members]);

  const [inviteOpen, setInviteOpen] = useState(false);
  const [inviteForm, setInviteForm] = useState<{
    fullName: string;
    email: string;
    role: OrgMemberRole;
    regions: string[];
  }>({
    fullName: '',
    email: '',
    role: 'employee',
    regions: [],
  });

  const submitInvite = async () => {
    if (!orgId) return;
    setError(null);
    try {
      const res = await fetch('/api/users/invite', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          orgId,
          email: inviteForm.email,
          fullName: inviteForm.fullName,
          role: inviteForm.role,
          regions: inviteForm.role === 'regional_hr' ? inviteForm.regions : [],
          employeeId: null,
        }),
      });
      const payload = (await res.json().catch(() => null)) as { error?: string } | null;
      if (!res.ok) {
        throw new Error(payload?.error || 'Invite failed.');
      }
      setInviteOpen(false);
      setInviteForm({ fullName: '', email: '', role: 'employee', regions: [] });
      await load();
    } catch (e: unknown) {
      setError(e instanceof Error ? e.message : 'Invite failed.');
    }
  };

  const [editOpen, setEditOpen] = useState(false);
  const [editing, setEditing] = useState<UserTableRow | null>(null);
  const [editRole, setEditRole] = useState<OrgMemberRole>('employee');
  const [editRegions, setEditRegions] = useState<string[]>([]);
  const [editAllowReset, setEditAllowReset] = useState(false);
  const [editSaving, setEditSaving] = useState(false);
  const [editError, setEditError] = useState<string | null>(null);

  const [resetOpen, setResetOpen] = useState(false);
  const [resetTarget, setResetTarget] = useState<UserTableRow | null>(null);
  const [resetMethod, setResetMethod] = useState<'email_link' | 'temporary_password'>(
    'temporary_password'
  );
  const [resetSubmitting, setResetSubmitting] = useState(false);
  const [resetError, setResetError] = useState<string | null>(null);
  const [tempPasswordOnce, setTempPasswordOnce] = useState<string | null>(null);
  const [showTempPassword, setShowTempPassword] = useState(false);
  const [resetMessage, setResetMessage] = useState<string | null>(null);
  const [credentialMode, setCredentialMode] = useState<'reset' | 'activate' | 'reactivate'>(
    'reset'
  );
  const [activationUsername, setActivationUsername] = useState<string | null>(null);
  const [activationEmployeeId, setActivationEmployeeId] = useState<string | null>(null);
  /** Password issued but membership still not Active — offer status-only finalize. */
  const [activationNeedsFinalize, setActivationNeedsFinalize] = useState(false);

  const openEdit = (row: UserTableRow) => {
    setEditing(row);
    setEditRole(row.orgMemberRole);
    setEditRegions(row.regions ?? []);
    setEditAllowReset(row.canResetPassword);
    setEditError(null);
    setEditOpen(true);
    void loadRegions();
  };

  const openReset = (row: UserTableRow) => {
    setCredentialMode('reset');
    setResetTarget(row);
    setResetError(null);
    setResetMessage(null);
    setTempPasswordOnce(null);
    setShowTempPassword(false);
    setActivationNeedsFinalize(false);
    setActivationUsername(row.email);
    setActivationEmployeeId(row.idNumber !== '-' ? row.idNumber : null);
    setResetMethod(isDeliverableEmail(row.email) ? 'email_link' : 'temporary_password');
    setResetOpen(true);
    setMenuOpenFor(null);
  };

  const openActivate = (row: UserTableRow, mode: 'activate' | 'reactivate') => {
    setCredentialMode(mode);
    setResetTarget(row);
    setResetError(null);
    setResetMessage(null);
    setTempPasswordOnce(null);
    setShowTempPassword(false);
    setActivationNeedsFinalize(false);
    setActivationUsername(row.email);
    setActivationEmployeeId(row.idNumber !== '-' ? row.idNumber : null);
    setResetOpen(true);
    setMenuOpenFor(null);
  };

  const saveEdit = async () => {
    if (!editing || !orgId) return;
    setEditError(null);
    setEditSaving(true);
    try {
      const body: Record<string, unknown> = {
        orgId,
        targetUserId: editing.userId,
      };

      if (editRole !== editing.orgMemberRole) {
        body.role = editRole;
      }

      const regionsChanged =
        editRole === 'regional_hr' &&
        (editRegions.length !== editing.regions.length ||
          editRegions.some((r) => !editing.regions.includes(r)) ||
          editing.regions.some((r) => !editRegions.includes(r)));
      const leavingRegional =
        editing.orgMemberRole === 'regional_hr' && editRole !== 'regional_hr';

      if (regionsChanged || leavingRegional || (body.role && editRole === 'regional_hr')) {
        body.regions = editRole === 'regional_hr' ? editRegions : [];
      }

      if (
        isSuperAdmin &&
        editing.orgMemberRole !== 'super_admin' &&
        editAllowReset !== editing.canResetPassword
      ) {
        body.allowPasswordReset = editAllowReset;
      }

      if (
        !body.role &&
        body.regions === undefined &&
        body.allowPasswordReset === undefined
      ) {
        setEditOpen(false);
        setEditing(null);
        return;
      }

      const res = await fetch('/api/users/update', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      });
      const payload = (await res.json().catch(() => null)) as {
        ok?: boolean;
        error?: string;
        partial?: boolean;
        applied?: string[];
      } | null;
      if (!res.ok || !payload?.ok) {
        const base = payload?.error || 'Failed to update user.';
        const applied =
          payload?.partial && payload.applied?.length
            ? ` Partial changes recorded: ${payload.applied.join(', ')}.`
            : '';
        // Keep dialog open with current selections so the admin can retry/adjust.
        throw new Error(`${base}${applied}`);
      }

      setEditOpen(false);
      setEditing(null);
      await load();
    } catch (e: unknown) {
      setEditError(e instanceof Error ? e.message : 'Failed to update user.');
    } finally {
      setEditSaving(false);
    }
  };

  const submitReset = async (options?: { finalizeOnly?: boolean }) => {
    if (!orgId || !resetTarget) return;
    setResetSubmitting(true);
    setResetError(null);
    setResetMessage(null);
    // Do not clear an already-displayed recovery password on finalize retry.
    if (!options?.finalizeOnly) {
      setTempPasswordOnce(null);
      setShowTempPassword(false);
      setActivationNeedsFinalize(false);
    }
    try {
      if (
        credentialMode === 'activate' ||
        credentialMode === 'reactivate' ||
        options?.finalizeOnly
      ) {
        const res = await fetch('/api/users/activate', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            orgId,
            targetUserId: resetTarget.userId,
            mode: options?.finalizeOnly ? 'finalize' : credentialMode,
          }),
        });
        const payload = (await res.json().catch(() => null)) as {
          ok?: boolean;
          error?: string;
          message?: string;
          temporaryPassword?: string;
          passwordIssued?: boolean;
          statusUpdated?: boolean;
          canFinalizeStatus?: boolean;
          partial?: boolean;
          username?: string | null;
          employeeIdNumber?: string | null;
          employeeName?: string | null;
        } | null;

        // Always surface a one-time password when the API returned one (including partial success).
        if (payload?.temporaryPassword) {
          setTempPasswordOnce(payload.temporaryPassword);
        }
        if (payload?.username) setActivationUsername(payload.username);
        if (payload?.employeeIdNumber) setActivationEmployeeId(payload.employeeIdNumber);

        if (payload?.passwordIssued && payload.canFinalizeStatus && !payload.statusUpdated) {
          setActivationNeedsFinalize(true);
          setResetError(
            payload.error ||
              'Temporary password was issued, but the account is not Active yet. Copy the password, then complete activation.'
          );
          setResetMessage(payload.message ?? null);
          return;
        }

        if (!res.ok || !payload?.ok) {
          throw new Error(payload?.error || 'Activation failed.');
        }

        setActivationNeedsFinalize(false);
        setResetError(null);
        setResetMessage(
          payload.message ??
            (options?.finalizeOnly ? 'Account status set to Active.' : 'Account activated.')
        );
        await load();
        return;
      }

      const res = await fetch('/api/users/reset-password', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          orgId,
          targetUserId: resetTarget.userId,
          method: resetMethod,
        }),
      });
      const payload = (await res.json().catch(() => null)) as {
        ok?: boolean;
        error?: string;
        message?: string;
        temporaryPassword?: string;
      } | null;
      if (payload?.temporaryPassword) {
        setTempPasswordOnce(payload.temporaryPassword);
      }
      if (!res.ok || !payload?.ok) {
        throw new Error(payload?.error || 'Password reset failed.');
      }
      setResetMessage(payload.message ?? 'Password reset completed.');
    } catch (e: unknown) {
      setResetError(
        e instanceof Error
          ? e.message
          : credentialMode === 'reset'
            ? 'Password reset failed.'
            : 'Activation failed.'
      );
    } finally {
      setResetSubmitting(false);
    }
  };

  const deactivateUser = async (row: UserTableRow) => {
    if (!orgId || !canUpdateUsers) return;
    if (row.orgMemberStatus !== 'active') return;
    setMenuOpenFor(null);
    setError(null);
    try {
      const res = await fetch('/api/users/update', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ orgId, targetUserId: row.userId, deactivate: true }),
      });
      const payload = (await res.json().catch(() => null)) as { error?: string } | null;
      if (!res.ok) throw new Error(payload?.error || 'Failed to deactivate user.');
      await load();
    } catch (e: unknown) {
      setError(e instanceof Error ? e.message : 'Failed to deactivate user.');
    }
  };

  if (!hasSupabase) {
    return (
      <div className="mx-auto max-w-5xl rounded-[18px] border border-slate-200/90 bg-white p-4 shadow-sm sm:p-6">
        <h2 className="text-lg font-semibold text-slate-900">User Management</h2>
        <p className="mt-2 text-sm text-slate-600">
          Supabase is not configured. Set `NEXT_PUBLIC_SUPABASE_URL` and `NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY`.
        </p>
      </div>
    );
  }

  if (!canAccessPage && !loading && members.length === 0 && !error) {
    return (
      <div className="mx-auto max-w-5xl rounded-[18px] border border-slate-200/90 bg-white p-4 shadow-sm sm:p-6">
        <h2 className="text-lg font-semibold text-slate-900">User Management</h2>
        <p className="mt-2 text-sm text-slate-600">You do not have permission to view users.</p>
        <p className="mt-1 text-xs text-slate-500">Current role: {membershipRole ?? '—'}</p>
      </div>
    );
  }

  return (
    <div className="mx-auto max-w-6xl space-y-6">
      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 md:grid-cols-4">
        <MetricCard title="Total Users" total={metrics.total} bottomLabel="All team members" icon="users" />
        <MetricCard title="Active Users" total={metrics.active} bottomLabel="Can sign in today" icon="active" />
        <MetricCard title="Admin Roles" total={metrics.admins} bottomLabel="Non-employee access" icon="admins" />
        <MetricCard title="Linked Accounts" total={metrics.linked} bottomLabel="Connected to employees" icon="linked" />
      </div>

      <CompactEmployeeTable
        title="User Management"
        description="Manage team members, roles, and access permissions"
        rows={rows}
        emptyMessage="No users found."
        sortable={false}
        actions={
          <>
            {canCreateUsers ? (
              <button
                type="button"
                onClick={() => {
                  setInviteOpen(true);
                  void loadRegions();
                }}
                disabled={!supabase || !orgId}
                className="inline-flex h-9 items-center gap-2 rounded-xl border border-[var(--primary)] px-3 text-sm font-medium text-[var(--primary)] transition-colors hover:bg-[var(--primary-light)] disabled:opacity-60"
              >
                <PlusGlyph className="h-4 w-4" />
                New User
              </button>
            ) : null}
            <button
              type="button"
              onClick={() => void load()}
              disabled={loading}
              className="inline-flex h-9 items-center gap-2 rounded-xl border border-[var(--primary)] px-3 text-sm font-medium text-[var(--primary)] transition-colors hover:bg-[var(--primary-light)] disabled:opacity-60"
            >
              {loading ? 'Refreshing…' : 'Refresh'}
            </button>
          </>
        }
        toolbar={
          <TableSearchInput
            id="user-search"
            value={query}
            onChange={setQuery}
            placeholder="Search users..."
          />
        }
        columnsOverride={[
          { key: 'idNumber', label: 'ID NUMBER' },
          { key: 'fullName', label: 'FULL NAME' },
          { key: 'position', label: 'POSITION' },
          { key: 'role', label: 'ROLE' },
          { key: 'status', label: 'STATUS' },
          { key: 'region', label: 'REGION' },
          { key: 'actions', label: 'ACTIONS', align: 'right' },
        ]}
        detailsHeaderLabel=""
        hideDetailsColumn
        renderCell={(row: UserTableRow, key) => {
          if (key === 'idNumber') return <span className="text-[13px] text-slate-900">{row.idNumber}</span>;
          if (key === 'fullName') {
            return (
              <div className="flex items-center gap-2">
                <div className="flex h-5 w-5 items-center justify-center rounded-full bg-[var(--primary-light)] text-[10px] font-semibold text-[var(--primary)]">
                  {getAvatarInitial(row.fullName)}
                </div>
                <span className="whitespace-nowrap text-[13px] text-slate-900">{row.fullName}</span>
              </div>
            );
          }
          if (key === 'position') return <span className="text-[13px] text-slate-900">{row.position || '-'}</span>;
          if (key === 'role') return <span className="text-[13px] text-slate-900">{row.roleLabel}</span>;
          if (key === 'status') return <span className="text-[13px] text-slate-900">{row.statusLabel}</span>;
          if (key === 'region') return <span className="text-[13px] text-slate-900">{row.regionLabel}</span>;
          if (key === 'actions') {
            const viewHref = row.linkedEmployeeId ? `/employees/${row.linkedEmployeeId}` : null;
            const canManage = isSuperAdmin || canUpdateUsers;
            const canIssueCredentials =
              (isSuperAdmin || canResetPasswords) && row.orgMemberRole !== 'super_admin';
            const showActivate =
              canIssueCredentials && row.orgMemberStatus === 'pending_activation';
            const showReset = canIssueCredentials && row.orgMemberStatus === 'active';
            const showReactivate = canIssueCredentials && row.orgMemberStatus === 'inactive';
            const showDeactivate = canManage && row.orgMemberStatus === 'active';
            const menuItemClass =
              'block w-full rounded-md px-3 py-2 text-left text-sm text-slate-800 hover:bg-slate-50';
            return (
              <div className="flex justify-end">
                <RowActionsMenu
                  open={menuOpenFor === row.userId}
                  onOpenChange={(open) => setMenuOpenFor(open ? row.userId : null)}
                  ariaLabel={`Actions for ${row.fullName}`}
                >
                  {viewHref ? (
                    <Link
                      href={viewHref}
                      role="menuitem"
                      className={menuItemClass}
                      onClick={() => setMenuOpenFor(null)}
                    >
                      View User
                    </Link>
                  ) : null}
                  {canManage ? (
                    <button
                      type="button"
                      role="menuitem"
                      className={menuItemClass}
                      onClick={() => {
                        setMenuOpenFor(null);
                        openEdit(row);
                      }}
                    >
                      Edit User
                    </button>
                  ) : null}
                  {showActivate ? (
                    <button
                      type="button"
                      role="menuitem"
                      className={menuItemClass}
                      onClick={() => openActivate(row, 'activate')}
                    >
                      Activate and Generate Password
                    </button>
                  ) : null}
                  {showReset ? (
                    <button
                      type="button"
                      role="menuitem"
                      className={menuItemClass}
                      onClick={() => openReset(row)}
                    >
                      Reset Password
                    </button>
                  ) : null}
                  {showReactivate ? (
                    <button
                      type="button"
                      role="menuitem"
                      className={menuItemClass}
                      onClick={() => openActivate(row, 'reactivate')}
                    >
                      Reactivate User
                    </button>
                  ) : null}
                  {showDeactivate ? (
                    <button
                      type="button"
                      role="menuitem"
                      className={menuItemClass}
                      onClick={() => void deactivateUser(row)}
                    >
                      Deactivate User
                    </button>
                  ) : null}
                </RowActionsMenu>
              </div>
            );
          }
          return <span className="text-[13px] text-slate-900">-</span>;
        }}
        profileTab={null}
      />

      {error ? (
        <p className="rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-700">
          {error}
        </p>
      ) : null}

      {inviteOpen ? (
        <div className="rounded-[18px] border border-slate-200/90 bg-white p-4 shadow-sm sm:p-6">
          <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
            <div>
              <h3 className="text-sm font-semibold text-slate-900">Create user</h3>
              <p className="mt-1 text-sm text-slate-500">Invite a team member to access PD Plan.</p>
            </div>
            <button
              type="button"
              onClick={() => setInviteOpen(false)}
              className="rounded-lg border border-slate-200 bg-white px-3 py-2 text-sm text-slate-700 hover:bg-slate-50"
            >
              Close
            </button>
          </div>

          <div className="mt-4 grid grid-cols-1 gap-3 md:grid-cols-2">
            <div>
              <label className="text-xs font-semibold text-slate-600">Full name</label>
              <input
                value={inviteForm.fullName}
                onChange={(e) => setInviteForm((v) => ({ ...v, fullName: e.target.value }))}
                className="mt-1 w-full rounded-lg border border-slate-200 px-3 py-2 text-sm"
              />
            </div>
            <div>
              <label className="text-xs font-semibold text-slate-600">Email</label>
              <input
                value={inviteForm.email}
                onChange={(e) => setInviteForm((v) => ({ ...v, email: e.target.value }))}
                className="mt-1 w-full rounded-lg border border-slate-200 px-3 py-2 text-sm"
              />
            </div>
            <div>
              <label className="text-xs font-semibold text-slate-600">Role</label>
              <select
                value={inviteForm.role}
                onChange={(e) =>
                  setInviteForm((v) => ({
                    ...v,
                    role: e.target.value as OrgMemberRole,
                    regions: [],
                  }))
                }
                className="mt-1 w-full rounded-lg border border-slate-200 px-3 py-2 text-sm"
              >
                {ROLE_OPTIONS.map((r) => (
                  <option key={r} value={r}>
                    {ROLE_LABEL[r]}
                  </option>
                ))}
              </select>
            </div>
            {inviteForm.role === 'regional_hr' ? (
              <div className="md:col-span-2">
                <label className="text-xs font-semibold text-slate-600">Region</label>
                <div className="mt-2 flex flex-wrap gap-2">
                  {orgRegions.map((region) => {
                    const checked = inviteForm.regions.includes(region);
                    return (
                      <label
                        key={region}
                        className="inline-flex items-center gap-2 rounded-md border border-slate-200 bg-white px-3 py-2 text-xs text-slate-700"
                      >
                        <input
                          type="checkbox"
                          checked={checked}
                          onChange={(e) => {
                            setInviteForm((v) => ({
                              ...v,
                              regions: e.target.checked
                                ? [...v.regions, region]
                                : v.regions.filter((x) => x !== region),
                            }));
                          }}
                        />
                        {region}
                      </label>
                    );
                  })}
                  {orgRegions.length === 0 ? (
                    <p className="text-xs text-slate-500">No regions found yet (add employees first).</p>
                  ) : null}
                </div>
              </div>
            ) : null}
          </div>

          <div className="mt-4 flex flex-col-reverse gap-2 sm:flex-row sm:justify-end">
            <button
              type="button"
              onClick={() => setInviteOpen(false)}
              className="rounded-lg border border-slate-200 bg-white px-3 py-2 text-sm text-slate-700 hover:bg-slate-50"
            >
              Cancel
            </button>
            <button
              type="button"
              onClick={() => void submitInvite()}
              disabled={loading}
              className="inline-flex items-center gap-2 rounded-xl border border-[var(--primary)] px-4 py-2 text-sm font-medium text-[var(--primary)] transition-colors hover:bg-[var(--primary-light)] disabled:opacity-60"
            >
              Send invite
            </button>
          </div>
        </div>
      ) : null}

      {editOpen && editing ? (
        <div className="fixed inset-0 z-50 flex items-end justify-center bg-black/30 px-3 py-3 sm:items-center sm:px-4">
          <div className="flex max-h-[calc(100dvh-1.5rem)] w-full max-w-lg flex-col overflow-hidden rounded-2xl border border-slate-200 bg-white shadow-xl sm:max-h-[calc(100dvh-2rem)]">
            <div className="flex items-start justify-between gap-4 px-4 py-4 sm:px-6 sm:py-5">
              <div>
                <h3 className="text-[16px] font-semibold text-slate-900">Edit User</h3>
                <p className="mt-1 text-sm text-slate-500">{editing.fullName}</p>
              </div>
              <button
                type="button"
                onClick={() => {
                  setEditOpen(false);
                  setEditing(null);
                }}
                className="rounded-lg border border-slate-200 bg-white px-3 py-2 text-sm text-slate-700 hover:bg-slate-50"
              >
                Close
              </button>
            </div>

            <HeaderDivider />

            <div className="space-y-4 overflow-y-auto px-4 py-4 sm:px-6 sm:py-5">
              <div>
                <label className="text-xs font-semibold text-slate-700">Role</label>
                <SimpleSelect
                  label="Role"
                  value={editRole}
                  displayValue={ROLE_LABEL[editRole]}
                  options={ROLE_OPTIONS.map((r) => ({ value: r, label: ROLE_LABEL[r] }))}
                  onChange={(next) => setEditRole(next as OrgMemberRole)}
                />
              </div>

              <div>
                <label className="text-xs font-semibold text-slate-700">Account status</label>
                <p className="mt-1 rounded-xl border border-slate-200 bg-slate-50 px-3 py-2 text-sm text-slate-700">
                  Current: <span className="font-medium">{STATUS_LABEL[editing.orgMemberStatus]}</span>
                  . Use the actions menu for Activate / Deactivate / Reactivate (password
                  issuance is required for activation).
                </p>
              </div>

              {editError ? (
                <p className="rounded-lg border border-rose-200 bg-rose-50 px-3 py-2 text-sm text-rose-700">
                  {editError}
                </p>
              ) : null}

              {editRole === 'regional_hr' ? (
                <div>
                  <label className="text-xs font-semibold text-slate-700">Region</label>
                  <div className="mt-2 flex flex-wrap gap-2">
                    {orgRegions.map((region) => {
                      const active = editRegions.includes(region);
                      return (
                        <button
                          key={region}
                          type="button"
                          onClick={() => {
                            setEditRegions((current) =>
                              active ? current.filter((r) => r !== region) : [...current, region]
                            );
                          }}
                          className={`rounded-full border px-3 py-1 text-xs font-medium transition-colors ${
                            active
                              ? 'border-[var(--primary-border)] bg-[var(--primary-light)] text-[var(--primary-strong)]'
                              : 'border-slate-200 bg-white text-slate-700 hover:bg-slate-50'
                          }`}
                        >
                          {region}
                        </button>
                      );
                    })}
                  </div>
                </div>
              ) : null}

              {isSuperAdmin && editing.orgMemberRole !== 'super_admin' ? (
                <div className="rounded-xl border border-slate-200 bg-slate-50/80 px-3 py-3">
                  <p className="text-xs font-semibold uppercase tracking-wide text-slate-600">
                    Additional Permissions
                  </p>
                  <label className="mt-2 flex items-start gap-2 text-sm text-slate-800">
                    <input
                      type="checkbox"
                      checked={editAllowReset}
                      onChange={(e) => setEditAllowReset(e.target.checked)}
                      className="mt-0.5 h-4 w-4 rounded border-slate-300 text-[var(--primary)] focus:ring-[var(--primary)]"
                    />
                    <span>
                      <span className="font-medium">Allow Password Resets</span>
                      <span className="mt-0.5 block text-xs text-slate-500">
                        Allow this user to reset passwords for eligible accounts within their
                        assigned access scope.
                      </span>
                    </span>
                  </label>
                </div>
              ) : null}
            </div>

            <div className="flex flex-col-reverse gap-2 border-t border-slate-200 px-4 py-4 sm:flex-row sm:justify-end sm:px-6">
              <button
                type="button"
                onClick={() => {
                  setEditOpen(false);
                  setEditing(null);
                }}
                className="rounded-xl border border-slate-200 bg-white px-4 py-2 text-sm text-slate-700 hover:bg-slate-50"
              >
                Cancel
              </button>
              <button
                type="button"
                disabled={editSaving}
                onClick={() => void saveEdit()}
                className="rounded-xl bg-[var(--primary)] px-4 py-2 text-sm font-semibold text-white hover:opacity-95 disabled:opacity-60"
              >
                {editSaving ? 'Saving…' : 'Save'}
              </button>
            </div>
          </div>
        </div>
      ) : null}

      {resetOpen && resetTarget ? (
        <div className="fixed inset-0 z-50 flex items-end justify-center bg-black/30 px-3 py-3 sm:items-center sm:px-4">
          <div className="flex max-h-[calc(100dvh-1.5rem)] w-full max-w-lg flex-col overflow-hidden rounded-2xl border border-slate-200 bg-white shadow-xl">
            <div className="flex items-start justify-between gap-4 px-4 py-4 sm:px-6 sm:py-5">
              <div>
                <h3 className="text-[16px] font-semibold text-slate-900">
                  {credentialMode === 'activate'
                    ? 'Activate and Generate Password'
                    : credentialMode === 'reactivate'
                      ? 'Reactivate User'
                      : 'Reset Password'}
                </h3>
                <p className="mt-1 text-sm text-slate-500">{resetTarget.fullName}</p>
                {activationEmployeeId ? (
                  <p className="mt-0.5 text-xs text-slate-400">Employee ID: {activationEmployeeId}</p>
                ) : null}
                {activationUsername ? (
                  <p className="mt-0.5 text-xs text-slate-400">Username: {activationUsername}</p>
                ) : null}
              </div>
              <button
                type="button"
                onClick={() => {
                  if (resetSubmitting) return;
                  setResetOpen(false);
                  setResetTarget(null);
                  setTempPasswordOnce(null);
                  setShowTempPassword(false);
                  setActivationNeedsFinalize(false);
                }}
                className="rounded-lg border border-slate-200 bg-white px-3 py-2 text-sm text-slate-700 hover:bg-slate-50"
              >
                Close
              </button>
            </div>
            <HeaderDivider />
            <div className="space-y-4 overflow-y-auto px-4 py-4 sm:px-6 sm:py-5">
              {resetError ? (
                <p className="rounded-lg border border-rose-200 bg-rose-50 px-3 py-2 text-sm text-rose-700">
                  {resetError}
                </p>
              ) : null}
              {resetMessage ? (
                <p className="rounded-lg border border-emerald-200 bg-emerald-50 px-3 py-2 text-sm text-emerald-800">
                  {resetMessage}
                </p>
              ) : null}

              {!tempPasswordOnce ? (
                credentialMode === 'reset' ? (
                  <>
                    <p className="text-sm text-slate-600">
                      Choose a reset method. Verify the account holder’s identity before sharing any
                      temporary password.
                    </p>
                    <label className="flex items-start gap-2 rounded-xl border border-slate-200 px-3 py-3 text-sm">
                      <input
                        type="radio"
                        name="reset-method"
                        checked={resetMethod === 'email_link'}
                        disabled={!isDeliverableEmail(resetTarget.email)}
                        onChange={() => setResetMethod('email_link')}
                        className="mt-0.5"
                      />
                      <span>
                        <span className="font-medium text-slate-900">Send password reset link</span>
                        <span className="mt-0.5 block text-xs text-slate-500">
                          {isDeliverableEmail(resetTarget.email)
                            ? 'Requests a recovery email through Supabase Auth. Delivery depends on SMTP configuration.'
                            : 'Unavailable — this account has no deliverable email.'}
                        </span>
                      </span>
                    </label>
                    <label className="flex items-start gap-2 rounded-xl border border-slate-200 px-3 py-3 text-sm">
                      <input
                        type="radio"
                        name="reset-method"
                        checked={resetMethod === 'temporary_password'}
                        onChange={() => setResetMethod('temporary_password')}
                        className="mt-0.5"
                      />
                      <span>
                        <span className="font-medium text-slate-900">Generate temporary password</span>
                        <span className="mt-0.5 block text-xs text-slate-500">
                          Creates a one-time password shown only once. User must change it at next
                          login.
                        </span>
                      </span>
                    </label>
                  </>
                ) : (
                  <p className="text-sm text-slate-600">
                    This will generate a new temporary password, require a password change at first
                    login, and set the account to Active. Verify the employee’s identity before
                    sharing credentials. The password is shown once and cannot be retrieved later.
                  </p>
                )
              ) : (
                <div className="space-y-3">
                  {activationNeedsFinalize ? (
                    <p className="rounded-lg border border-amber-300 bg-amber-50 px-3 py-2 text-sm text-amber-950">
                      Partial success: the temporary password below was issued, but the account is
                      still not Active. Copy the password, then choose Complete Activation (this does
                      not generate a new password).
                    </p>
                  ) : (
                    <p className="rounded-lg border border-amber-200 bg-amber-50 px-3 py-2 text-sm text-amber-900">
                      This temporary password is displayed once. Copy it now — it is not stored and
                      cannot be retrieved later.
                    </p>
                  )}
                  <dl className="grid grid-cols-1 gap-2 text-sm text-slate-700 sm:grid-cols-2">
                    <div>
                      <dt className="text-xs font-semibold uppercase tracking-wide text-slate-500">
                        Employee
                      </dt>
                      <dd>{resetTarget.fullName}</dd>
                    </div>
                    <div>
                      <dt className="text-xs font-semibold uppercase tracking-wide text-slate-500">
                        Employee ID
                      </dt>
                      <dd>{activationEmployeeId ?? '—'}</dd>
                    </div>
                    <div className="sm:col-span-2">
                      <dt className="text-xs font-semibold uppercase tracking-wide text-slate-500">
                        Username
                      </dt>
                      <dd>{activationUsername ?? resetTarget.email ?? '—'}</dd>
                    </div>
                  </dl>
                  <div className="flex flex-col gap-2 sm:flex-row sm:items-center">
                    <code className="flex-1 rounded-lg border border-slate-200 bg-slate-50 px-3 py-2 text-sm tracking-wide text-slate-900">
                      {showTempPassword ? tempPasswordOnce : '••••••••••••••••'}
                    </code>
                    <button
                      type="button"
                      onClick={() => setShowTempPassword((v) => !v)}
                      className="rounded-xl border border-slate-200 px-3 py-2 text-sm text-slate-700 hover:bg-slate-50"
                    >
                      {showTempPassword ? 'Hide Password' : 'Show Password'}
                    </button>
                    <button
                      type="button"
                      onClick={() => void navigator.clipboard.writeText(tempPasswordOnce)}
                      className="rounded-xl border border-[var(--primary)] px-3 py-2 text-sm font-medium text-[var(--primary)] hover:bg-[var(--primary-light)]"
                    >
                      Copy Password
                    </button>
                  </div>
                </div>
              )}
            </div>
            <div className="flex flex-col-reverse gap-2 border-t border-slate-200 px-4 py-4 sm:flex-row sm:justify-end sm:px-6">
              <button
                type="button"
                disabled={resetSubmitting}
                onClick={() => {
                  setResetOpen(false);
                  setResetTarget(null);
                  setTempPasswordOnce(null);
                  setShowTempPassword(false);
                  setActivationNeedsFinalize(false);
                }}
                className="rounded-xl border border-slate-200 bg-white px-4 py-2 text-sm text-slate-700 hover:bg-slate-50"
              >
                {tempPasswordOnce && !activationNeedsFinalize ? 'Done' : 'Cancel'}
              </button>
              {activationNeedsFinalize ? (
                <button
                  type="button"
                  disabled={resetSubmitting}
                  onClick={() => void submitReset({ finalizeOnly: true })}
                  className="rounded-xl bg-[var(--primary)] px-4 py-2 text-sm font-semibold text-white hover:opacity-95 disabled:opacity-60"
                >
                  {resetSubmitting ? 'Working…' : 'Complete Activation'}
                </button>
              ) : !tempPasswordOnce ? (
                <button
                  type="button"
                  disabled={resetSubmitting}
                  onClick={() => void submitReset()}
                  className="rounded-xl bg-[var(--primary)] px-4 py-2 text-sm font-semibold text-white hover:opacity-95 disabled:opacity-60"
                >
                  {resetSubmitting
                    ? 'Working…'
                    : credentialMode === 'activate'
                      ? 'Activate and Generate Password'
                      : credentialMode === 'reactivate'
                        ? 'Reactivate and Generate Password'
                        : 'Confirm reset'}
                </button>
              ) : null}
            </div>
          </div>
        </div>
      ) : null}
    </div>
  );
}

