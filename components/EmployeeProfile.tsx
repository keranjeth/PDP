'use client';

import Link from 'next/link';
import {
  useEffect,
  useMemo,
  useRef,
  useState,
  useSyncExternalStore,
  type ReactNode,
} from 'react';
import { useRouter } from 'next/navigation';
import {
  buildEmployeeInformationSnapshot,
  buildEmployeeProfileHref,
  EMPLOYEE_INFORMATION_TABS,
  EmployeeInformationGroupKey,
  EmployeeInformationTab,
  EmployeeProfilePreview,
  formatInformationValue,
} from '@/lib/employee-information';
import {
  getDirectReportsViaPosition,
  getManagerViaReportsToPosition,
} from '@/lib/reporting-relationships';
import { payrollStore } from '@/lib/store';
import type { Employee } from '@/lib/types';
import { useAppAuth } from '@/components/providers/AppProviders';
import { HeaderDivider } from '@/components/ui/HeaderDivider';
import { Modal } from '@/components/ui/Modal';
import { formatDisplayDateDMmmYYYY } from '@/lib/employee-dates';
import { getSupabaseBrowserClient } from '@/lib/supabase/client';
import { hydrateEmployeesFromSupabase } from '@/lib/employee-remote-sync';
import type { OrgMemberRole } from '@/lib/user-management/types';
import {
  fetchEmployeeLinkedOrgMember,
  fetchOrgRegions,
  setMemberRegions,
  setOrgMemberRole,
  type EmployeeLinkedMember,
} from '@/lib/user-management/org-members';
import { can } from '@/lib/user-management/permissions';

const PORTAL_ROLE_OPTIONS: OrgMemberRole[] = [
  'super_admin',
  'hr_national',
  'head_of_hr',
  'regional_hr',
  'employee',
];

const PORTAL_ROLE_LABEL: Record<OrgMemberRole, string> = {
  super_admin: 'Super Admin',
  hr_national: 'HR National',
  head_of_hr: 'Head of HR',
  regional_hr: 'Regional HR',
  employee: 'Employee',
};

function getInitials(name?: string) {
  if (!name?.trim()) {
    return 'NA';
  }

  return name
    .trim()
    .split(/\s+/)
    .slice(0, 2)
    .map((part) => part[0]?.toUpperCase())
    .join('');
}

type OffboardStatusSummary = {
  lastWorkingDate: string;
  exitType: string;
};

type ErrorPayload = {
  error?: string;
};

type RegionRow = {
  region: string;
};

function getErrorMessage(error: unknown, fallback: string): string {
  return error instanceof Error && error.message.trim() !== ''
    ? error.message
    : fallback;
}

function formatExitTypeStatus(exitType?: string | null) {
  const normalized = String(exitType ?? '').trim().toLowerCase();
  switch (normalized) {
    case 'resignation':
      return 'Resigned';
    case 'termination':
      return 'Terminated';
    case 'retirement':
      return 'Retired';
    case 'end_of_contract':
      return 'Contract ended';
    default:
      return normalized
        ? normalized.replace(/_/g, ' ').replace(/\b\w/g, (char) => char.toUpperCase())
        : 'Offboarded';
  }
}

function formatOffboardStatusLabel(summary?: OffboardStatusSummary | null) {
  if (!summary) {
    return 'Offboarded';
  }
  const exitLabel = formatExitTypeStatus(summary.exitType);
  const lastWorkingDate = new Date(`${summary.lastWorkingDate}T12:00:00`);
  if (Number.isNaN(lastWorkingDate.getTime())) {
    return exitLabel;
  }
  return `${exitLabel} - ${formatDisplayDateDMmmYYYY(lastWorkingDate)}`;
}

function toGroupKey(tab: EmployeeInformationTab): EmployeeInformationGroupKey {
  return tab.toLowerCase() as EmployeeInformationGroupKey;
}

function HeaderPill({
  label,
  tone = 'neutral',
}: {
  label: string;
  tone?: 'neutral' | 'status' | 'danger';
}) {
  return (
    <span
      className={`inline-flex items-center rounded-md px-2 py-1 text-[11px] ${
        tone === 'status'
          ? 'border border-[var(--primary-border)] bg-[var(--primary-light)] font-semibold text-[var(--primary-strong)]'
          : tone === 'danger'
            ? 'border border-rose-200 bg-rose-50 font-semibold text-rose-700'
          : 'bg-slate-100 text-slate-700'
      }`}
    >
      {tone === 'status' || tone === 'danger' ? (
        <span className="mr-1.5 inline-block h-1.5 w-1.5 rounded-full bg-current" />
      ) : null}
      {label}
    </span>
  );
}

function IconButton({
  children,
  onClick,
  label,
}: {
  children: React.ReactNode;
  onClick?: () => void;
  label: string;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      aria-label={label}
      className="inline-flex h-8 w-8 items-center justify-center rounded-lg border border-slate-200 text-slate-600 transition-colors hover:bg-slate-50 hover:text-slate-900"
    >
      {children}
    </button>
  );
}

function DetailRow({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex items-start justify-between gap-4 py-2">
      <span className="text-[13px] leading-snug text-slate-900">{label}</span>
      <span className="text-right text-[13px] leading-snug text-slate-900 tabular-nums">
        {value || '-'}
      </span>
    </div>
  );
}

/**
 * Two columns on md+ with the same vertical rule pattern everywhere (Personal → Payroll).
 * Stacks on small screens with a horizontal rule between blocks.
 */
function ProfileTwoColumn({
  left,
  right,
  leftTitle,
  rightTitle,
}: {
  left: React.ReactNode;
  right: React.ReactNode;
  leftTitle?: string;
  rightTitle?: string;
}) {
  return (
    <div className="grid grid-cols-1 md:grid-cols-2 md:gap-0">
      <div className="md:pr-5">
        {leftTitle ? (
          <div className="mb-3">
            <div className="text-[13px] font-semibold leading-snug text-slate-900">{leftTitle}</div>
            <HeaderDivider className="mt-2" />
          </div>
        ) : null}
        {left}
      </div>
      <div className="border-t border-slate-200 pt-5 md:border-l md:border-t-0 md:pl-5 md:pt-0">
        {rightTitle ? (
          <div className="mb-3">
            <div className="text-[13px] font-semibold leading-snug text-slate-900">{rightTitle}</div>
            <HeaderDivider className="mt-2" />
          </div>
        ) : null}
        {right}
      </div>
    </div>
  );
}

/** Shared summary / highlight metric shell (Compensation total, Payroll totals). */
function ProfileMetricCard({
  label,
  value,
  emphasizeValue,
}: {
  label: string;
  value: React.ReactNode;
  emphasizeValue?: boolean;
}) {
  return (
    <div className="rounded-xl border border-slate-200/80 bg-slate-50/90 px-4 py-2.5">
      <div className="flex items-start justify-between gap-4">
        <span className="text-[13px] font-semibold leading-snug text-slate-900">{label}</span>
        <span
          className={`text-right text-[13px] font-semibold leading-snug tabular-nums ${
            emphasizeValue ? 'text-[var(--forest-green-800)]' : 'text-slate-900'
          }`}
        >
          {value}
        </span>
      </div>
    </div>
  );
}

function formatYMDSpan(value?: Date | string | null | undefined, now = new Date()): string {
  if (!value) {
    return '-';
  }
  const start = new Date(value);
  if (Number.isNaN(start.getTime())) {
    return '-';
  }
  if (start.getTime() > now.getTime()) {
    return '-';
  }

  const from = new Date(start.getFullYear(), start.getMonth(), start.getDate());
  const to = new Date(now.getFullYear(), now.getMonth(), now.getDate());

  let years = to.getFullYear() - from.getFullYear();
  let months = to.getMonth() - from.getMonth();
  let days = to.getDate() - from.getDate();

  if (days < 0) {
    const prevMonthEnd = new Date(to.getFullYear(), to.getMonth(), 0).getDate();
    days += prevMonthEnd;
    months -= 1;
  }
  if (months < 0) {
    months += 12;
    years -= 1;
  }
  if (years < 0) {
    return '-';
  }

  const y = `${years} ${years === 1 ? 'Year' : 'Years'}`;
  const m = `${months} ${months === 1 ? 'Month' : 'Months'}`;
  const d = `${days} ${days === 1 ? 'Day' : 'Days'}`;
  return `${y}, ${m}, ${d}`;
}

function ProfileStandaloneFinalRow({ label, value }: { label: string; value: string }) {
  return (
    <div className="border-t border-slate-200 pt-6">
      <ProfileMetricCard label={label} value={value} />
    </div>
  );
}

function EmptyState({ label }: { label: string }) {
  return (
    <div className="flex flex-col items-center justify-center gap-2 rounded-2xl border border-dashed border-slate-200 bg-white px-6 py-16 text-center">
      <div className="text-3xl opacity-25">□</div>
      <p className="text-sm text-slate-700">{label} data will appear here</p>
      <p className="text-xs text-slate-400">No records to display</p>
    </div>
  );
}


function ProfileTabCardShell({
  title,
  headerRight,
  children,
}: {
  title: string;
  headerRight?: ReactNode;
  children: ReactNode;
}) {
  return (
    <div className="overflow-hidden rounded-2xl border border-slate-200 bg-white shadow-sm">
      <div className="flex items-center justify-between gap-3 border-b border-slate-200 px-4 py-4 sm:px-6">
        <h2 className="text-[15px] font-semibold text-slate-900">{title}</h2>
        {headerRight ? <div className="flex shrink-0 items-center gap-2">{headerRight}</div> : null}
      </div>
      <div className="px-4 py-5 sm:px-6 sm:py-6">{children}</div>
    </div>
  );
}

function GroupPanel({
  employeeId,
  activeTab,
  offboardStatusLabel,
}: {
  employeeId: string;
  activeTab: EmployeeInformationTab;
  offboardStatusLabel?: string | null;
}) {
  const employee = payrollStore.getEmployee(employeeId);

  if (!employee) {
    return <EmptyState label="Employee" />;
  }

  const snapshot = buildEmployeeInformationSnapshot(employee);
  const groupKey = toGroupKey(activeTab);

  if (groupKey === 'personal') {
    const leftKeys = [
      { key: 'idNumber', label: 'ID Number' },
      { key: 'fullName', label: 'Full Name' },
      { key: 'gender', label: 'Gender' },
      { key: 'dateOfBirth', label: 'Date of Birth' },
    ] as const;
    const rightKeys = [
      { key: 'bloodGroup', label: 'Blood Group' },
      { key: 'maritalStatus', label: 'Marital Status' },
    ] as const;

    return (
      <ProfileTabCardShell title={activeTab}>
        <div className="space-y-6">
          <ProfileTwoColumn
            left={
              <>
                {leftKeys.map(({ key, label }) => (
                  <DetailRow
                    key={key}
                    label={label}
                    value={formatInformationValue('personal', key, snapshot)}
                  />
                ))}
              </>
            }
            right={
              <>
                {rightKeys.map(({ key, label }) => (
                  <DetailRow
                    key={key}
                    label={label}
                    value={formatInformationValue('personal', key, snapshot)}
                  />
                ))}
              </>
            }
          />
          <ProfileStandaloneFinalRow label="Age" value={formatYMDSpan(employee.dateOfBirth)} />
        </div>
      </ProfileTabCardShell>
    );
  }

  if (groupKey === 'job') {
    const leftKeys = [
      { key: 'positionNumber', label: 'Position Number' },
      { key: 'designation', label: 'Designation' },
      { key: 'staffingCategory', label: 'Staffing Category' },
      { key: 'department', label: 'Department' },
      { key: 'unit', label: 'Unit' },
    ] as const;
    const rightKeys = [
      { key: 'region', label: 'Region' },
      { key: 'dutyStation', label: 'Duty Station' },
      { key: 'jobLocation', label: 'Job Location' },
    ] as const;

    return (
      <ProfileTabCardShell title={activeTab}>
        <ProfileTwoColumn
          left={
            <>
              {leftKeys.map(({ key, label }) => (
                <DetailRow
                  key={key}
                  label={label}
                  value={formatInformationValue('job', key, snapshot)}
                />
              ))}
            </>
          }
          right={
            <>
              {rightKeys.map(({ key, label }) => (
                <DetailRow
                  key={key}
                  label={label}
                  value={formatInformationValue('job', key, snapshot)}
                />
              ))}
            </>
          }
        />
      </ProfileTabCardShell>
    );
  }

  const leftKeys = [
    { key: 'contractType', label: 'Contract Type' },
    { key: 'employmentStatus', label: 'Employment Status' },
    { key: 'jobStatus', label: 'Job Status' },
  ] as const;
  const rightKeys = [
    { key: 'joiningDate', label: 'Joining Date' },
    { key: 'contractStartDate', label: 'Contract Start Date' },
    { key: 'contractEndDate', label: 'Contract End Date' },
  ] as const;

  return (
    <ProfileTabCardShell title={activeTab}>
      <div className="space-y-6">
        <ProfileTwoColumn
          left={
            <>
              {leftKeys.map(({ key, label }) => (
                <DetailRow
                  key={key}
                  label={label}
                  value={
                    key === 'employmentStatus' && offboardStatusLabel
                      ? offboardStatusLabel
                      : formatInformationValue('contract', key, snapshot)
                  }
                />
              ))}
            </>
          }
          right={
            <>
              {rightKeys.map(({ key, label }) => (
                <DetailRow
                  key={key}
                  label={label}
                  value={formatInformationValue('contract', key, snapshot)}
                />
              ))}
            </>
          }
        />
        <ProfileStandaloneFinalRow label="Length of Service" value={formatYMDSpan(employee.joiningDate)} />
      </div>
    </ProfileTabCardShell>
  );
}

function ReportingPersonLink({ person }: { person: Employee }) {
  return (
    <Link
      href={buildEmployeeProfileHref(person.id)}
      className="flex items-center gap-3 rounded-lg border border-slate-100 bg-white px-3 py-2.5 transition-colors hover:border-slate-200 hover:bg-slate-50"
    >
      <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-gradient-to-br from-[var(--primary)] to-[var(--primary-strong)] text-[11px] font-bold text-white shadow-sm">
        {getInitials(person.fullName)}
      </div>
      <div className="min-w-0 flex-1 text-left">
        <div className="truncate text-[13px] font-medium text-slate-900">{person.fullName}</div>
        {person.designation?.trim() ? (
          <div className="truncate text-[11px] text-slate-500">{person.designation}</div>
        ) : null}
      </div>
    </Link>
  );
}

function ReportingLineCard({ employeeId }: { employeeId: string }) {
  const employee = payrollStore.getEmployee(employeeId);
  const roster = payrollStore.getEmployees();

  if (!employee) {
    return (
      <section className="overflow-hidden rounded-2xl border border-slate-200 bg-white shadow-sm lg:sticky lg:top-4">
        <div className="border-b border-slate-100 px-5 py-4">
          <h3 className="text-[13px] font-semibold text-slate-700">Reporting Line</h3>
        </div>
        <div className="px-5 py-4">
          <p className="text-sm text-slate-500">Employee record is not available.</p>
        </div>
      </section>
    );
  }

  const manager = getManagerViaReportsToPosition(employee, roster);
  const directReports = getDirectReportsViaPosition(employee, roster);

  return (
    <section className="overflow-hidden rounded-2xl border border-slate-200 bg-white shadow-sm lg:sticky lg:top-4">
      <div className="border-b border-slate-100 px-5 py-4">
        <h3 className="text-[13px] font-semibold text-slate-700">Reporting Line</h3>
      </div>
      <div className="space-y-5 px-5 py-4">
        <div>
          <h4 className="mb-2 text-[11px] font-semibold uppercase tracking-wide text-slate-400">
            Reports To
          </h4>
          {manager ? (
            <ReportingPersonLink person={manager} />
          ) : (
            <p className="text-[13px] leading-relaxed text-slate-500">Not set</p>
          )}
        </div>
        <div>
          <h4 className="mb-2 text-[11px] font-semibold uppercase tracking-wide text-slate-400">
            Direct Reports
          </h4>
          {directReports.length > 0 ? (
            <ul className="space-y-2">
              {directReports.map((report) => (
                <li key={report.id}>
                  <ReportingPersonLink person={report} />
                </li>
              ))}
            </ul>
          ) : (
            <p className="text-[13px] text-slate-500">None</p>
          )}
        </div>
      </div>
    </section>
  );
}

export default function EmployeeProfile({
  employeeId,
  defaultTab,
  preview,
}: {
  employeeId: string;
  defaultTab: EmployeeInformationTab;
  preview?: EmployeeProfilePreview;
}) {
  const router = useRouter();
  const { orgId, membershipRole } = useAppAuth();
  const supabase = useMemo(() => getSupabaseBrowserClient(), []);
  const canOffboard = can((membershipRole ?? null) as OrgMemberRole | null, 'employees', 'update');
  const isSuperAdmin = membershipRole === 'super_admin';
  const [activeTab, setActiveTab] = useState<EmployeeInformationTab>(defaultTab);
  const scrollRef = useRef<HTMLDivElement | null>(null);
  const [canScrollRight, setCanScrollRight] = useState(false);
  const [canScrollLeft, setCanScrollLeft] = useState(false);

  const employee = useSyncExternalStore(
    (listener) => payrollStore.subscribe(listener),
    () => payrollStore.getEmployee(employeeId),
    () => null
  );
  const employeeName = employee?.fullName || preview?.fullName || 'Unknown Employee';
  const role = employee?.designation || preview?.designation || 'Employee';
  const idNumber = employee?.idNumber || preview?.idNumber || '-';
  const contractType = employee?.contractType || preview?.contractType || '-';
  const status = employee?.employmentStatus || preview?.employmentStatus || 'Inactive';
  const isOffboarded = status.toLowerCase() === 'inactive';

  const [assignRoleOpen, setAssignRoleOpen] = useState(false);
  const [assignRoleLoading, setAssignRoleLoading] = useState(false);
  const [assignRoleSaving, setAssignRoleSaving] = useState(false);
  const [assignRoleError, setAssignRoleError] = useState<string | null>(null);
  const [linkedMember, setLinkedMember] = useState<EmployeeLinkedMember | null>(null);
  const [orgRegions, setOrgRegions] = useState<string[]>([]);
  const [nextRole, setNextRole] = useState<OrgMemberRole>('employee');
  const [nextRegions, setNextRegions] = useState<string[]>([]);

  const [offboardOpen, setOffboardOpen] = useState(false);
  const [offboardLastWorkingDate, setOffboardLastWorkingDate] = useState('');
  const [offboardExitType, setOffboardExitType] = useState('resignation');
  const [offboardLeavingReason, setOffboardLeavingReason] = useState('');
  const [offboardEligibleForRehire, setOffboardEligibleForRehire] = useState(true);
  const [offboardRehireNote, setOffboardRehireNote] = useState('');
  const [offboardSubmitting, setOffboardSubmitting] = useState(false);
  const [offboardError, setOffboardError] = useState<string | null>(null);
  const [latestOffboardStatus, setLatestOffboardStatus] =
    useState<OffboardStatusSummary | null>(null);

  useEffect(() => {
    if (!isOffboarded || !supabase || !orgId) {
      return;
    }

    let cancelled = false;
    void Promise.resolve(
      supabase
        .from('leavers')
        .select('last_working_date,exit_type,offboarded_at')
        .eq('org_id', orgId)
        .eq('employee_id', employeeId)
        .order('offboarded_at', { ascending: false })
        .limit(1)
        .maybeSingle()
    )
      .then(({ data, error }) => {
        if (cancelled || error) {
          return;
        }
        const row = data as { last_working_date: string | null; exit_type: string | null } | null;
        if (!row?.last_working_date || !row.exit_type) {
          setLatestOffboardStatus(null);
          return;
        }
        setLatestOffboardStatus({
          lastWorkingDate: row.last_working_date,
          exitType: row.exit_type,
        });
      })
      .catch(() => null);

    return () => {
      cancelled = true;
    };
  }, [employeeId, isOffboarded, orgId, supabase]);

  const offboardStatusLabel = isOffboarded
    ? formatOffboardStatusLabel(latestOffboardStatus)
    : status;
  const offboardButtonLabel = isOffboarded ? 'Offboarded' : 'Offboard';
  const offboardButtonClass = isOffboarded
    ? 'border border-rose-200 bg-rose-50 text-rose-400 cursor-not-allowed'
    : 'border border-rose-600 text-rose-700 transition-colors hover:bg-rose-50';

  const openOffboard = () => {
    if (isOffboarded) {
      return;
    }
    const today = new Date();
    const yyyy = today.getFullYear();
    const mm = String(today.getMonth() + 1).padStart(2, '0');
    const dd = String(today.getDate()).padStart(2, '0');
    setOffboardLastWorkingDate(`${yyyy}-${mm}-${dd}`);
    setOffboardExitType('resignation');
    setOffboardLeavingReason('');
    setOffboardEligibleForRehire(true);
    setOffboardRehireNote('');
    setOffboardError(null);
    setOffboardOpen(true);
  };

  const openAssignRole = async () => {
    if (!supabase || !orgId) return;
    setAssignRoleError(null);
    setAssignRoleOpen(true);
    setAssignRoleLoading(true);
    try {
      const row = await Promise.race([
        fetchEmployeeLinkedOrgMember(supabase, orgId, employeeId),
        new Promise<null>((_, reject) =>
          window.setTimeout(() => reject(new Error('Request timed out. Please try again.')), 12000)
        ),
      ]);
      setLinkedMember(row);
      if (!row) {
        setAssignRoleError('No linked account found for this employee.');
        setNextRole('employee');
        setNextRegions([]);
        return;
      }
      setNextRole(row.role);
      if (row.role === 'regional_hr') {
        const { data: regionRows, error: regionErr } = await Promise.race([
          supabase
            .from('organization_member_regions')
            .select('region')
            .eq('org_id', orgId)
            .eq('user_id', row.userId),
          new Promise<{ data: RegionRow[] | null; error: Error }>((_, reject) =>
            window.setTimeout(
              () => reject(new Error('Request timed out. Please try again.')),
              12000
            )
          ),
        ]);
        if (!regionErr) {
          setNextRegions(
            ((regionRows ?? []) as RegionRow[]).map((r) => String(r.region))
          );
        } else {
          setNextRegions([]);
        }
      } else {
        setNextRegions([]);
      }
      const regions = await Promise.race([
        fetchOrgRegions(supabase, orgId),
        new Promise<string[]>((_, reject) =>
          window.setTimeout(() => reject(new Error('Request timed out. Please try again.')), 12000)
        ),
      ]);
      setOrgRegions(regions);
    } catch (error: unknown) {
      setLinkedMember(null);
      setAssignRoleError(getErrorMessage(error, 'Failed to load linked account.'));
    } finally {
      setAssignRoleLoading(false);
    }
  };

  const saveAssignedRole = async () => {
    if (!supabase || !orgId || !linkedMember) return;
    if (nextRole === 'regional_hr' && nextRegions.length === 0) {
      setAssignRoleError('Regional HR requires at least one region.');
      return;
    }
    setAssignRoleSaving(true);
    setAssignRoleError(null);
    try {
      if (nextRole !== linkedMember.role) {
        await setOrgMemberRole(supabase, orgId, linkedMember.userId, nextRole);
      }
      if (nextRole === 'regional_hr') {
        await setMemberRegions(supabase, orgId, linkedMember.userId, nextRegions);
      } else if (linkedMember.role === 'regional_hr') {
        await setMemberRegions(supabase, orgId, linkedMember.userId, []);
      }
      setAssignRoleOpen(false);
    } catch (error: unknown) {
      setAssignRoleError(getErrorMessage(error, 'Failed to assign role.'));
    } finally {
      setAssignRoleSaving(false);
    }
  };

  const submitOffboard = async () => {
    if (!orgId) return;
    setOffboardSubmitting(true);
    setOffboardError(null);
    try {
      const res = await fetch('/api/employees/offboard', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          orgId,
          employeeId,
          lastWorkingDate: offboardLastWorkingDate,
          exitType: offboardExitType,
          leavingReason: offboardLeavingReason,
          eligibleForRehire: offboardEligibleForRehire,
          rehireNote: offboardEligibleForRehire ? null : offboardRehireNote,
        }),
      });
      const payload = (await res.json().catch(() => null)) as ErrorPayload | null;
      if (!res.ok) {
        throw new Error(payload?.error ?? 'Offboarding failed.');
      }

      payrollStore.markEmployeesOffboardedLocally([
        { employeeId, lastWorkingDate: offboardLastWorkingDate },
      ]);
      setLatestOffboardStatus({
        lastWorkingDate: offboardLastWorkingDate,
        exitType: offboardExitType,
      });
      if (supabase && orgId) {
        void hydrateEmployeesFromSupabase(supabase, orgId).catch(() => null);
      }
      setOffboardOpen(false);
    } catch (error: unknown) {
      setOffboardError(getErrorMessage(error, 'Offboarding failed.'));
    } finally {
      setOffboardSubmitting(false);
    }
  };

  const scrollTabs = (direction: 1 | -1) => {
    const node = scrollRef.current;
    if (!node) {
      return;
    }

    node.scrollBy({ left: direction * 140, behavior: 'smooth' });
  };

  return (
    <div className="mx-auto max-w-6xl">
      <div className="overflow-hidden rounded-[24px] border border-slate-200 bg-white shadow-[0_18px_44px_rgba(15,23,42,0.08)]">
        <div className="px-4 py-4 sm:px-5">
          <div className="flex flex-wrap items-center justify-between gap-3">
            <div className="flex items-center gap-3">
              <IconButton onClick={() => router.back()} label="Go back">
                <ArrowLeftIcon className="h-4 w-4" />
              </IconButton>
              <span className="text-sm font-semibold text-slate-900">
                Employee Profile
              </span>
            </div>

            <div className="flex items-center gap-2">
              {isSuperAdmin ? (
                <button
                  type="button"
                  onClick={() => void openAssignRole()}
                  className="hidden h-8 items-center rounded-lg border border-[var(--primary)] px-3 text-xs font-semibold text-[var(--primary)] transition-colors hover:bg-[var(--primary-light)] md:inline-flex"
                >
                  Assign Role
                </button>
              ) : null}
              {canOffboard ? (
                <button
                  type="button"
                  onClick={openOffboard}
                  disabled={isOffboarded}
                  className={`hidden h-8 items-center rounded-lg px-3 text-xs font-semibold md:inline-flex ${offboardButtonClass}`}
                >
                  {offboardButtonLabel}
                </button>
              ) : null}
              <IconButton label="Search employee profile">
                <SearchIcon className="h-4 w-4" />
              </IconButton>
              <Link
                href={`/employees/${employeeId}/edit`}
                className="inline-flex h-8 w-8 items-center justify-center rounded-lg border border-slate-200 text-slate-600 transition-colors hover:bg-slate-50 hover:text-slate-900"
                aria-label="Edit employee profile"
              >
                <PencilIcon className="h-4 w-4" />
              </Link>
              <div
                className={`relative h-6 w-11 rounded-full ${
                  isOffboarded ? 'bg-red-500' : 'bg-[var(--primary)]'
                }`}
                aria-label={`Employee status: ${offboardStatusLabel}`}
              >
                <span
                  className={`absolute top-1 h-4 w-4 rounded-full bg-white ${
                    isOffboarded ? 'left-1' : 'left-6'
                  }`}
                />
              </div>
            </div>
          </div>

          {isSuperAdmin || canOffboard ? (
            <div className="mt-3 flex flex-wrap gap-2 md:hidden">
              {isSuperAdmin ? (
                <button
                  type="button"
                  onClick={() => void openAssignRole()}
                  className="inline-flex h-8 items-center rounded-lg border border-[var(--primary)] px-3 text-xs font-semibold text-[var(--primary)] transition-colors hover:bg-[var(--primary-light)]"
                >
                  Assign Role
                </button>
              ) : null}
              {canOffboard ? (
                <button
                  type="button"
                  onClick={openOffboard}
                  disabled={isOffboarded}
                  className={`inline-flex h-8 items-center rounded-lg px-3 text-xs font-semibold ${offboardButtonClass}`}
                >
                  {offboardButtonLabel}
                </button>
              ) : null}
            </div>
          ) : null}
        </div>

        <div className="bg-slate-50/70">
          <div className="px-4 pb-5 pt-5 sm:px-5">
            <div className="mb-5 flex flex-col gap-4 sm:flex-row sm:items-start">
              <div className="flex h-14 w-14 shrink-0 items-center justify-center rounded-full bg-gradient-to-br from-[var(--primary)] to-[var(--primary-strong)] text-base font-bold text-white shadow-[0_4px_16px_rgba(0,150,50,0.24)]">
                {getInitials(employeeName)}
              </div>
              <div className="min-w-0">
                <div className="text-[20px] font-bold leading-tight text-slate-900">
                  {employeeName}
                </div>
                <div className="mt-1 text-[11px] font-medium uppercase tracking-[0.18em] text-slate-400">
                  {role}
                </div>
                <div className="mt-3 flex flex-wrap gap-1.5">
                  <HeaderPill label={idNumber} />
                  <HeaderPill label={contractType} />
                  <HeaderPill
                    label={offboardStatusLabel}
                    tone={isOffboarded ? 'danger' : 'status'}
                  />
                </div>
              </div>
            </div>

            <div className="relative">
              <div
                ref={scrollRef}
                onScroll={(event) => {
                  const node = event.currentTarget;
                  setCanScrollLeft(node.scrollLeft > 2);
                  setCanScrollRight(
                    node.scrollLeft + node.clientWidth < node.scrollWidth - 2
                  );
                }}
                className="flex overflow-x-auto [scrollbar-width:none] [&::-webkit-scrollbar]:hidden"
              >
                {EMPLOYEE_INFORMATION_TABS.map((tab) => {
                  const isActive = activeTab === tab;

                  return (
                    <button
                      key={tab}
                      type="button"
                      onClick={() => setActiveTab(tab)}
                      className={`-mb-px shrink-0 border-b-2 px-4 py-2.5 text-[13px] ${
                        isActive
                          ? 'border-[var(--primary)] font-semibold text-[var(--primary)]'
                          : 'border-transparent text-slate-600'
                      }`}
                    >
                      {tab}
                    </button>
                  );
                })}
              </div>

              {canScrollLeft ? (
                <button
                  type="button"
                  onClick={() => scrollTabs(-1)}
                  className="absolute left-0 top-0 bottom-px flex w-10 items-center justify-start bg-gradient-to-r from-white via-white/90 to-transparent pl-1 text-slate-500"
                  aria-label="Scroll tabs left"
                >
                  <ArrowLeftIcon className="h-4 w-4" />
                </button>
              ) : null}

              {canScrollRight ? (
                <button
                  type="button"
                  onClick={() => scrollTabs(1)}
                  className="absolute right-0 top-0 bottom-px flex w-10 items-center justify-end bg-gradient-to-l from-white via-white/90 to-transparent pr-1 text-slate-500"
                  aria-label="Scroll tabs right"
                >
                  <ChevronRightIcon className="h-4 w-4" />
                </button>
              ) : null}
            </div>

            <HeaderDivider />
          </div>

          <div className="bg-[#F8F9FB] px-4 pb-4 pt-4 md:px-5">
            <div className="grid grid-cols-1 gap-4 lg:grid-cols-10 lg:items-start lg:gap-6">
              <div className="min-w-0 lg:col-span-7">
                <GroupPanel
                  employeeId={employeeId}
                  activeTab={activeTab}
                  offboardStatusLabel={isOffboarded ? offboardStatusLabel : null}
                />
              </div>
              <div className="min-w-0 lg:col-span-3">
                <ReportingLineCard employeeId={employeeId} />
              </div>
            </div>
          </div>
        </div>
      </div>

      <Modal
        isOpen={offboardOpen}
        onClose={() => {
          if (offboardSubmitting) return;
          setOffboardOpen(false);
        }}
        title="Offboard employee"
        footer={
          <>
            <button
              type="button"
              onClick={() => setOffboardOpen(false)}
              disabled={offboardSubmitting}
              className="inline-flex h-9 items-center justify-center whitespace-nowrap rounded-lg border border-[var(--primary)] bg-transparent px-3 text-sm font-normal text-[var(--primary)] transition-colors hover:bg-[var(--primary-light)] disabled:opacity-60"
            >
              Cancel
            </button>
            <button
              type="button"
              onClick={() => void submitOffboard()}
              disabled={offboardSubmitting}
              className="inline-flex h-9 items-center justify-center whitespace-nowrap rounded-lg border border-rose-600 bg-transparent px-3 text-sm font-normal text-rose-700 transition-colors hover:bg-rose-50 disabled:opacity-60"
            >
              {offboardSubmitting ? 'Offboarding…' : 'Confirm offboarding'}
            </button>
          </>
        }
      >
        {offboardError ? (
          <p className="mb-3 text-sm text-rose-700">{offboardError}</p>
        ) : null}

        <div className="space-y-3">
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
            <div>
              <label
                className="text-sm font-medium text-slate-700"
                htmlFor="profile-offboard-last-working-date"
              >
                Last working date
              </label>
              <input
                id="profile-offboard-last-working-date"
                type="date"
                value={offboardLastWorkingDate}
                onChange={(e) => setOffboardLastWorkingDate(e.target.value)}
                className="mt-1 h-9 w-full rounded-xl border border-slate-200 bg-white px-3 text-sm text-slate-700 outline-none focus:border-[var(--primary)]"
              />
            </div>
            <div>
              <label
                className="text-sm font-medium text-slate-700"
                htmlFor="profile-offboard-exit-type"
              >
                Exit type
              </label>
              <select
                id="profile-offboard-exit-type"
                value={offboardExitType}
                onChange={(e) => setOffboardExitType(e.target.value)}
                className="mt-1 h-9 w-full rounded-xl border border-slate-200 bg-white px-3 text-sm text-slate-700 outline-none focus:border-[var(--primary)]"
              >
                <option value="resignation">Resignation</option>
                <option value="end_of_contract">End of contract</option>
                <option value="termination">Termination</option>
                <option value="retirement">Retirement</option>
              </select>
            </div>
          </div>

          <div>
            <label
              className="text-sm font-medium text-slate-700"
              htmlFor="profile-offboard-reason"
            >
              Leaving reason
            </label>
            <textarea
              id="profile-offboard-reason"
              value={offboardLeavingReason}
              onChange={(e) => setOffboardLeavingReason(e.target.value)}
              rows={3}
              className="mt-1 w-full rounded-xl border border-slate-200 bg-white px-3 py-2 text-sm text-slate-700 outline-none focus:border-[var(--primary)]"
            />
          </div>

          <div className="flex items-start gap-3 rounded-xl border border-slate-200 bg-slate-50/50 px-3 py-2">
            <input
              id="profile-offboard-rehire"
              type="checkbox"
              checked={offboardEligibleForRehire}
              onChange={(e) => setOffboardEligibleForRehire(e.target.checked)}
              className="mt-1 h-4 w-4"
            />
            <div className="min-w-0">
              <label
                htmlFor="profile-offboard-rehire"
                className="text-sm font-medium text-slate-700"
              >
                Eligible for rehire
              </label>
              <p className="text-xs text-slate-500">
                If unchecked, provide a short note for future context.
              </p>
            </div>
          </div>

          {!offboardEligibleForRehire ? (
            <div>
              <label
                className="text-sm font-medium text-slate-700"
                htmlFor="profile-offboard-rehire-note"
              >
                Rehire note
              </label>
              <input
                id="profile-offboard-rehire-note"
                value={offboardRehireNote}
                onChange={(e) => setOffboardRehireNote(e.target.value)}
                className="mt-1 h-9 w-full rounded-xl border border-slate-200 bg-white px-3 text-sm text-slate-700 outline-none focus:border-[var(--primary)]"
              />
            </div>
          ) : null}
        </div>
      </Modal>

      <Modal
        isOpen={assignRoleOpen}
        onClose={() => {
          if (assignRoleSaving) return;
          setAssignRoleOpen(false);
        }}
        title="Assign role"
        footer={
          <>
            <button
              type="button"
              onClick={() => setAssignRoleOpen(false)}
              disabled={assignRoleSaving}
              className="inline-flex h-9 items-center justify-center whitespace-nowrap rounded-lg border border-slate-200 bg-white px-3 text-sm font-normal text-slate-700 transition-colors hover:bg-slate-50 disabled:opacity-60"
            >
              Cancel
            </button>
            <button
              type="button"
              onClick={() => void saveAssignedRole()}
              disabled={assignRoleSaving || assignRoleLoading || !linkedMember}
              className="inline-flex h-9 items-center justify-center whitespace-nowrap rounded-lg border border-[var(--primary)] bg-[var(--primary)] px-3 text-sm font-semibold text-white transition-colors hover:opacity-95 disabled:opacity-60"
            >
              {assignRoleSaving ? 'Saving…' : 'Save role'}
            </button>
          </>
        }
      >
        {assignRoleError ? (
          <p className="mb-3 text-sm text-rose-700">{assignRoleError}</p>
        ) : null}

        {assignRoleLoading ? (
          <p className="text-sm text-slate-600">Loading linked account…</p>
        ) : !linkedMember ? (
          <div className="rounded-xl border border-slate-200 bg-slate-50/40 p-4">
            <p className="text-sm font-medium text-slate-900">No linked account</p>
            <p className="mt-1 text-sm text-slate-600">
              This employee does not have a login linked yet. Assign a user first from User Management.
            </p>
          </div>
        ) : (
          <div className="space-y-3">
            <div>
              <label className="text-sm font-medium text-slate-700" htmlFor="assign-role-select">
                Role
              </label>
              <select
                id="assign-role-select"
                value={nextRole}
                onChange={(e) => {
                  const r = e.target.value as OrgMemberRole;
                  setNextRole(r);
                  if (r !== 'regional_hr') {
                    setNextRegions([]);
                  }
                }}
                className="mt-1 h-9 w-full rounded-xl border border-slate-200 bg-white px-3 text-sm text-slate-700 outline-none focus:border-[var(--primary)]"
              >
                {PORTAL_ROLE_OPTIONS.map((r) => (
                  <option key={r} value={r}>
                    {PORTAL_ROLE_LABEL[r]}
                  </option>
                ))}
              </select>
            </div>

            {nextRole === 'regional_hr' ? (
              <div>
                <label className="text-sm font-medium text-slate-700">Regions</label>
                <div className="mt-2 flex flex-wrap gap-2">
                  {orgRegions.map((region) => {
                    const checked = nextRegions.includes(region);
                    return (
                      <label
                        key={region}
                        className="inline-flex items-center gap-2 rounded-md border border-slate-200 bg-white px-3 py-2 text-xs text-slate-700"
                      >
                        <input
                          type="checkbox"
                          checked={checked}
                          onChange={(e) => {
                            setNextRegions((prev) =>
                              e.target.checked
                                ? [...prev, region]
                                : prev.filter((x) => x !== region)
                            );
                          }}
                        />
                        {region}
                      </label>
                    );
                  })}
                  {orgRegions.length === 0 ? (
                    <p className="text-xs text-slate-500">No regions found yet.</p>
                  ) : null}
                </div>
              </div>
            ) : null}
          </div>
        )}
      </Modal>
    </div>
  );
}

function ArrowLeftIcon({ className }: { className: string }) {
  return (
    <svg
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
      className={className}
    >
      <path d="M15 18 9 12l6-6" />
    </svg>
  );
}

function ChevronRightIcon({ className }: { className: string }) {
  return (
    <svg
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
      className={className}
    >
      <path d="m9 18 6-6-6-6" />
    </svg>
  );
}

function PencilIcon({ className }: { className: string }) {
  return (
    <svg
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
      className={className}
    >
      <path d="M12 20h9" />
      <path d="m16.5 3.5 4 4L8 20l-5 1 1-5Z" />
    </svg>
  );
}

function SearchIcon({ className }: { className: string }) {
  return (
    <svg
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
      className={className}
    >
      <circle cx="11" cy="11" r="7" />
      <path d="m20 20-3.5-3.5" />
    </svg>
  );
}
