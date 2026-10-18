'use client';

import type { ChangeEvent, DragEvent } from 'react';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { Button } from '@/components/ui/Button';
import { CompactEmployeeTable } from '@/components/ui/compact-employee-table';
import { ImportModalShell } from '@/components/ui/ImportModalShell';
import { payrollStore } from '@/lib/store';
import { Employee } from '@/lib/types';
import { useAppAuth } from '@/components/providers/AppProviders';
import { hydrateEmployeesFromSupabase } from '@/lib/employee-remote-sync';
import { HeaderDivider } from '@/components/ui/HeaderDivider';
import { Modal } from '@/components/ui/Modal';
import { getSupabaseBrowserClient } from '@/lib/supabase/client';
import {
  EmployeeImportRecord,
  downloadEmployeeImportTemplate,
  downloadEmployeeRecordsExport,
  validateEmployeeImportFile,
} from '@/lib/employee-import';
import { buildEmployeeRows, DashboardEmployeeRow } from '@/lib/dashboard';
import { PlusGlyph, TableSearchInput } from '@/components/ui/table-controls';
import { can } from '@/lib/user-management/permissions';
import type { OrgMemberRole } from '@/lib/user-management/types';
import { employeeFromLeaverSnapshot, fetchOrgLeavers, type LeaverSnapshotRow } from '@/lib/leavers';
import { groupImportValidationErrors } from '@/lib/import-error-utils';
import { dateToCalendarIso } from '@/lib/employee-dates';
import { SEPARATION_EXIT_TYPE_OPTIONS } from '@/lib/separation';

function calendarOrNull(value: Date | null | undefined) {
  return value instanceof Date ? dateToCalendarIso(value) : null;
}

function employeeRecordsForApi(records: EmployeeImportRecord[]) {
  return records.map((record) => ({
    ...record,
    dateOfBirth: calendarOrNull(record.dateOfBirth),
    joiningDate: calendarOrNull(record.joiningDate),
    contractStartDate: calendarOrNull(record.contractStartDate),
    contractEndDate: calendarOrNull(record.contractEndDate),
    lastWorkingDate: calendarOrNull(record.lastWorkingDate),
  }));
}

type PendingImport = {
  fileName: string;
  records: EmployeeImportRecord[];
  skippedSampleRow: boolean;
};

type ImportProgress = {
  processed: number;
  total: number;
  percentage: number;
  created: number;
  updated: number;
  currentName: string;
};

const TEMPLATE_DOWNLOAD_TOAST_MS = 4000;
const IMPORT_SUCCESS_TOAST_MS = 30000;
const IMPORT_BATCH_SIZE = 250;

function calculateChange(currentValue: number, previousValue: number) {
  if (!Number.isFinite(currentValue) || !Number.isFinite(previousValue)) {
    return 0;
  }

  if (previousValue === 0) {
    return currentValue > 0 ? 100 : 0;
  }

  return ((currentValue - previousValue) / previousValue) * 100;
}

function EmployeeMetricCard({
  title,
  total,
  previousValue,
  bottomLabel,
  icon,
}: {
  title: string;
  total: number;
  previousValue: number;
  bottomLabel: string;
  icon: string;
}) {
  const change = calculateChange(total, previousValue);
  const isDown = change < 0;
  const trendClass = isDown ? 'text-rose-600' : 'text-[var(--analytics-budget)]';
  const arrow = isDown ? '\u2193' : '\u2191';
  const formattedTrend = `${isDown ? '' : '+'}${change.toFixed(1)}%`;

  return (
    <div className="group relative overflow-hidden rounded-[14px] border border-slate-200/90 bg-white px-4 py-3 shadow-sm">
      <div className="absolute inset-x-0 top-0 h-[3px] bg-gradient-to-r from-[var(--analytics-budget)] via-[var(--analytics-budget-hover)] to-[var(--analytics-budget-soft)]" />

      <div className="grid min-h-[104px] grid-rows-[auto_auto_1fr] gap-2.5">
        <div className="flex justify-between">
          <p className="text-[15px] font-semibold text-slate-800">{title}</p>
          <CardIcon type={icon} />
        </div>

        <div className="flex justify-between">
          <span className="text-[20px] font-semibold text-slate-700">{total}</span>
          <div
            className={`flex items-center gap-1 text-[12px] font-semibold ${trendClass}`}
          >
            <span>{formattedTrend}</span>
            <span>{arrow}</span>
          </div>
        </div>

        <div className="flex justify-between text-[12px] text-slate-500">
          <span>{bottomLabel}</span>
          <span>vs last month</span>
        </div>
      </div>
    </div>
  );
}

function CardIcon({ type }: { type: string }) {
  const common = 'h-4 w-4 text-[var(--analytics-budget)]';

  if (type === 'employees') {
    return (
      <div className="flex h-9 w-9 items-center justify-center rounded-[12px] border border-[var(--analytics-selected-fill)] bg-[var(--analytics-budget-background)]">
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.9" className={common}>
          <path d="M16 21v-2a4 4 0 0 0-4-4H8a4 4 0 0 0-4 4v2" />
          <circle cx="10" cy="7" r="4" />
          <path d="M22 21v-2a4 4 0 0 0-3-3.87" />
          <path d="M16 3.13a4 4 0 0 1 0 7.75" />
        </svg>
      </div>
    );
  }

  if (type === 'active') {
    return (
      <div className="flex h-9 w-9 items-center justify-center rounded-[12px] border border-[var(--analytics-selected-fill)] bg-[var(--analytics-budget-background)]">
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.9" className={common}>
          <path d="M22 11.08V12a10 10 0 1 1-5.93-9.14" />
          <path d="M22 4 12 14.01l-3-3" />
        </svg>
      </div>
    );
  }

  if (type === 'new') {
    return (
      <div className="flex h-9 w-9 items-center justify-center rounded-[12px] border border-[var(--analytics-selected-fill)] bg-[var(--analytics-budget-background)]">
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.9" className={common}>
          <path d="M16 21v-2a4 4 0 0 0-4-4H8a4 4 0 0 0-4 4v2" />
          <circle cx="10" cy="7" r="4" />
          <path d="M19 8v6" />
          <path d="M22 11h-6" />
        </svg>
      </div>
    );
  }

  if (type === 'departed') {
    return (
      <div className="flex h-9 w-9 items-center justify-center rounded-[12px] border border-[var(--analytics-selected-fill)] bg-[var(--analytics-budget-background)]">
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.9" className={common}>
          <path d="M16 21v-2a4 4 0 0 0-4-4H8a4 4 0 0 0-4 4v2" />
          <circle cx="10" cy="7" r="4" />
          <path d="m15 11 6 6" />
          <path d="m21 11-6 6" />
        </svg>
      </div>
    );
  }

  return (
    <div className="flex h-9 w-9 items-center justify-center rounded-[12px] border border-[var(--analytics-selected-fill)] bg-[var(--analytics-budget-background)]">
      <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.9" className={common}>
        <path d="M4 12h4l2.2-6 3.6 12L16 12h4" />
      </svg>
    </div>
  );
}

function ImportSelectedFileRow({
  fileName,
  onRemove,
  removeDisabled,
}: {
  fileName: string;
  onRemove: () => void;
  removeDisabled: boolean;
}) {
  return (
    <div className="flex items-center justify-between gap-3 rounded-xl border border-slate-200 bg-white px-4 py-3 shadow-sm">
      <div className="flex min-w-0 flex-1 items-center gap-2">
        <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg bg-slate-100 text-slate-500">
          <UploadIcon className="h-4 w-4" />
        </div>
        <span className="truncate text-sm font-medium text-slate-900" title={fileName}>
          {fileName}
        </span>
      </div>
      <button
        type="button"
        onClick={onRemove}
        disabled={removeDisabled}
        className="shrink-0 rounded-lg px-3 py-1.5 text-sm font-medium text-red-700 transition-colors hover:bg-red-50 disabled:pointer-events-none disabled:opacity-40"
      >
        Remove
      </button>
    </div>
  );
}

function EmployeesImportModal({
  isOpen,
  onClose,
  onDownloadEmployeeTemplate,
  onPickEmployeeFile,
  onImportEmployees,
  pendingEmployeeImport,
  isValidatingImport,
  isImporting,
  importProgress,
  isDragActive,
  onDragEnter,
  onDragLeave,
  onDragOver,
  onDrop,
  stagedEmployeeFileName,
  groupedImportErrors,
  onClearEmployeeFile,
  employeePreview,
}: {
  isOpen: boolean;
  onClose: () => void;
  onDownloadEmployeeTemplate: () => void;
  onPickEmployeeFile: () => void;
  onImportEmployees: () => void;
  pendingEmployeeImport: PendingImport | null;
  stagedEmployeeFileName: string | null;
  groupedImportErrors: string[];
  onClearEmployeeFile: () => void;
  isValidatingImport: boolean;
  isImporting: boolean;
  importProgress: ImportProgress | null;
  isDragActive: boolean;
  onDragEnter: (event: DragEvent<HTMLDivElement>) => void;
  onDragLeave: (event: DragEvent<HTMLDivElement>) => void;
  onDragOver: (event: DragEvent<HTMLDivElement>) => void;
  onDrop: (event: DragEvent<HTMLDivElement>) => void;
  employeePreview: string | null;
}) {
  const showProgress = isImporting && importProgress;
  const employeeFileName =
    pendingEmployeeImport?.fileName ?? stagedEmployeeFileName ?? null;
  const showLargeDropZone = !employeeFileName;
  const removeDisabled = isValidatingImport || isImporting;

  return (
    <ImportModalShell
      isOpen={isOpen}
      title="Import employees"
      icon={<UploadIcon className="h-6 w-6" />}
      onClose={onClose}
    >
      {showProgress ? (
        <div className="space-y-8">
          <div className="flex items-center justify-center">
            <div className="relative flex h-24 w-24 items-center justify-center rounded-full bg-[var(--primary-light)]">
              <div className="absolute inset-0 animate-pulse rounded-full border border-[var(--primary-border)]" />
              <div className="h-14 w-14 animate-spin rounded-full border-4 border-[var(--primary)] border-t-transparent" />
            </div>
          </div>

          <div className="text-center">
            <p className="text-[22px] font-semibold text-slate-950">Importing employees</p>
            <p className="mt-2 text-[15px] text-slate-500">Progress is being tracked row by row.</p>
          </div>

          <div className="rounded-2xl border border-slate-200 bg-slate-50 px-4 py-4 sm:px-6 sm:py-5">
            <div className="flex flex-col gap-3 sm:flex-row sm:items-end sm:justify-between">
              <div>
                <p className="text-sm text-slate-500">Progress</p>
                <p className="mt-1 text-[20px] font-semibold text-slate-950">
                  {importProgress.processed} of {importProgress.total} employees imported
                </p>
              </div>
              <p className="text-[24px] font-semibold text-[var(--primary)]">
                {importProgress.percentage}%
              </p>
            </div>

            <div className="mt-5 h-3 overflow-hidden rounded-full bg-slate-200">
              <div
                className="h-full rounded-full bg-gradient-to-r from-[var(--primary)] via-[var(--primary-hover)] to-[var(--forest-green-400)] transition-all duration-300"
                style={{ width: `${importProgress.percentage}%` }}
              />
            </div>

            <div className="mt-5 flex flex-wrap items-center justify-between gap-3 text-sm text-slate-600">
              <span>
                Current:{' '}
                <span className="font-normal text-slate-600">
                  {importProgress.currentName || 'Preparing import...'}
                </span>
              </span>
              <span>
                {importProgress.created} created, {importProgress.updated} updated
              </span>
            </div>
          </div>
        </div>
      ) : (
        <div className="space-y-6">
          <p className="text-center text-[15px] font-semibold text-slate-800">
            <button
              type="button"
              onClick={onDownloadEmployeeTemplate}
              className="font-semibold text-[var(--primary)] underline-offset-4 hover:text-[var(--primary-hover)] hover:underline"
            >
              Download employee template
            </button>
            <span className="font-semibold text-slate-800"> → fill in data → upload here.</span>
          </p>

          {showLargeDropZone ? (
            <div
              className={`rounded-[18px] border-2 border-dashed px-5 py-10 text-center transition-colors sm:px-8 sm:py-12 ${
                isDragActive ? 'border-[var(--primary)] bg-[var(--primary-light)]' : 'border-slate-200 bg-white'
              }`}
              onDragEnter={onDragEnter}
              onDragLeave={onDragLeave}
              onDragOver={onDragOver}
              onDrop={onDrop}
            >
              <div className="mx-auto flex h-16 w-16 items-center justify-center rounded-full bg-slate-100 text-slate-500">
                <UploadIcon className="h-8 w-8" />
              </div>

              <h4 className="mt-7 text-[18px] font-semibold text-slate-950">Upload XLSX File</h4>
              <p className="mt-3 text-[15px] text-slate-500">
                Drag and drop your file here, or click to browse
              </p>

              <div className="mt-7">
                <Button
                  type="button"
                  className="w-full !rounded-xl !bg-[var(--primary)] px-6 py-3 !text-[15px] font-semibold hover:!bg-[var(--primary-hover)] sm:min-w-[160px] sm:w-auto"
                  onClick={onPickEmployeeFile}
                  disabled={isValidatingImport}
                >
                  {isValidatingImport ? 'Validating...' : 'Choose File'}
                </Button>
              </div>
            </div>
          ) : null}

          {employeeFileName ? (
            <ImportSelectedFileRow
              fileName={employeeFileName}
              onRemove={onClearEmployeeFile}
              removeDisabled={removeDisabled}
            />
          ) : null}

          {pendingEmployeeImport ? (
            <div className="rounded-2xl border border-emerald-200 bg-emerald-50 px-5 py-4">
              <div className="flex flex-col gap-4 sm:flex-row sm:items-start sm:justify-between">
                <div>
                  <p className="text-sm font-medium text-emerald-900">Ready to import</p>
                  <p className="mt-1 text-sm text-emerald-800">
                    {pendingEmployeeImport.records.length} employee rows validated successfully.
                  </p>
                  {pendingEmployeeImport.skippedSampleRow ? (
                    <p className="mt-2 text-sm text-emerald-700">
                      The sample template row was detected and ignored.
                    </p>
                  ) : null}
                  {employeePreview ? (
                    <p className="mt-2 text-sm text-emerald-900">{employeePreview}</p>
                  ) : null}
                </div>

                <Button
                  type="button"
                  className="w-full !rounded-xl !bg-[var(--primary)] px-5 py-2.5 !text-sm font-semibold hover:!bg-[var(--primary-hover)] sm:w-auto"
                  onClick={onImportEmployees}
                >
                  {employeePreview ? 'Confirm Import' : 'Review Import'}
                </Button>
              </div>
            </div>
          ) : null}

          {groupedImportErrors.length > 0 ? (
            <div className="rounded-2xl border border-red-200 bg-red-50 px-5 py-4">
              <p className="text-sm font-medium text-red-900">Import validation failed</p>
              <ul className="mt-3 space-y-2 text-sm text-red-800">
                {groupedImportErrors.map((error) => (
                  <li key={error}>{error}</li>
                ))}
              </ul>
            </div>
          ) : null}
        </div>
      )}
    </ImportModalShell>
  );
}

export default function EmployeesPage() {
  const router = useRouter();
  const { orgId, isReady, membershipRole } = useAppAuth();
  const isEmployee = membershipRole === 'employee';
  const canUpdateEmployees = can(
    (membershipRole ?? null) as OrgMemberRole | null,
    'employees',
    'update'
  );
  const isSuperAdmin = membershipRole === 'super_admin';

  const [employees, setEmployees] = useState<Employee[]>([]);
  const [employeeRows, setEmployeeRows] = useState<DashboardEmployeeRow[]>([]);
  const [leaverRows, setLeaverRows] = useState<DashboardEmployeeRow[]>([]);
  const [employeeTab, setEmployeeTab] = useState<'active' | 'leavers'>('active');
  const [searchTerm, setSearchTerm] = useState('');
  const [isLeaversLoading, setIsLeaversLoading] = useState(false);
  const [leaversError, setLeaversError] = useState<string | null>(null);

  const [offboardOpen, setOffboardOpen] = useState(false);
  const [offboardingEmployeeIds, setOffboardingEmployeeIds] = useState<string[]>([]);
  const [offboardSelectMode, setOffboardSelectMode] = useState(false);
  const [offboardSelectedIds, setOffboardSelectedIds] = useState<Set<string>>(() => new Set());
  const [offboardLastWorkingDate, setOffboardLastWorkingDate] = useState('');
  const [offboardExitType, setOffboardExitType] = useState('resignation');
  const [offboardLeavingReason, setOffboardLeavingReason] = useState('');
  const [offboardEligibleForRehire, setOffboardEligibleForRehire] = useState(true);
  const [offboardRehireNote, setOffboardRehireNote] = useState('');
  const [offboardSubmitting, setOffboardSubmitting] = useState(false);
  const [offboardError, setOffboardError] = useState<string | null>(null);

  const [hardDeleteSelectMode, setHardDeleteSelectMode] = useState(false);
  const [hardDeleteSelectedIds, setHardDeleteSelectedIds] = useState<Set<string>>(
    () => new Set()
  );
  const [hardDeleteOpen, setHardDeleteOpen] = useState(false);
  const [hardDeletingIds, setHardDeletingIds] = useState<string[]>([]);
  const [hardDeleteConfirmText, setHardDeleteConfirmText] = useState('');
  const [hardDeleteSubmitting, setHardDeleteSubmitting] = useState(false);
  const [hardDeleteError, setHardDeleteError] = useState<string | null>(null);
  const [hardDeleteProgress, setHardDeleteProgress] = useState<{
    done: number;
    total: number;
  } | null>(null);
  const [isImportModalOpen, setIsImportModalOpen] = useState(false);
  const [isDragActive, setIsDragActive] = useState(false);
  const [pendingImport, setPendingImport] = useState<PendingImport | null>(null);
  const [stagedEmployeeFileName, setStagedEmployeeFileName] = useState<string | null>(
    null
  );
  const [importErrors, setImportErrors] = useState<string[]>([]);
  const [templateDownloadToastOpen, setTemplateDownloadToastOpen] =
    useState(false);
  const templateDownloadToastTimerRef = useRef<ReturnType<
    typeof setTimeout
  > | null>(null);
  const [importSuccessToastOpen, setImportSuccessToastOpen] = useState(false);
  const importSuccessToastTimerRef = useRef<ReturnType<
    typeof setTimeout
  > | null>(null);
  const [isValidatingImport, setIsValidatingImport] = useState(false);
  const [isImporting, setIsImporting] = useState(false);
  const [importProgress, setImportProgress] = useState<ImportProgress | null>(null);
  const [employeePreviewText, setEmployeePreviewText] = useState<string | null>(null);
  const [sortedExportRows, setSortedExportRows] = useState<DashboardEmployeeRow[]>([]);
  const [isExporting, setIsExporting] = useState(false);
  const [exportError, setExportError] = useState<string | null>(null);
  const employeeImportFileRef = useRef<File | null>(null);
  const fileInputRef = useRef<HTMLInputElement | null>(null);

  const handleDisplayRowsChange = useCallback((rows: DashboardEmployeeRow[]) => {
    setSortedExportRows(rows);
  }, []);

  const groupedImportErrors = useMemo(
    () => groupImportValidationErrors(importErrors),
    [importErrors]
  );

  const loadEmployees = () => {
    const employeeData = payrollStore.getEmployees();
    const rows = buildEmployeeRows(employeeData);

    setEmployees(employeeData);
    setEmployeeRows(rows);
  };

  useEffect(() => {
    if (!isReady) {
      return;
    }
    if (isEmployee) {
      router.replace('/my/profile');
      router.refresh();
      return;
    }
    queueMicrotask(() => {
      loadEmployees();
    });
    const unsubscribe = payrollStore.subscribe(() => {
      loadEmployees();
    });
    return unsubscribe;
  }, [isReady, isEmployee, router]);

  const filteredEmployeeRows = useMemo(() => {
    const query = searchTerm.trim().toLowerCase();
    const activeIdSet = new Set(
      employees
        .filter((e) => e.employmentStatus !== 'Inactive')
        .map((e) => e.id)
    );
    const baseRows =
      employeeTab === 'leavers'
        ? leaverRows
        : employeeRows.filter((row) => activeIdSet.has(row.id));
    if (!query) return baseRows;
    return baseRows.filter(
      (employee) =>
        employee.fullName.toLowerCase().includes(query) ||
        employee.idNumber.toLowerCase().includes(query) ||
        employee.department.toLowerCase().includes(query) ||
        employee.designation.toLowerCase().includes(query) ||
        employee.region.toLowerCase().includes(query)
    );
  }, [searchTerm, employeeRows, employees, employeeTab, leaverRows]);

  useEffect(() => {
    if (!isReady || !orgId || employeeTab !== 'leavers') {
      return;
    }

    const supabase = getSupabaseBrowserClient();
    if (!supabase) {
      queueMicrotask(() => {
        setLeaversError('Supabase is not configured.');
      });
      return;
    }

    let cancelled = false;
    queueMicrotask(() => {
      setIsLeaversLoading(true);
      setLeaversError(null);
    });
    void fetchOrgLeavers(supabase, orgId)
      .then((rows: LeaverSnapshotRow[]) => {
        if (cancelled) return;
        const leaverEmployees = rows.map(employeeFromLeaverSnapshot);
        const computedRows = buildEmployeeRows(leaverEmployees);
        setLeaverRows(computedRows);
      })
      .catch((err: unknown) => {
        if (cancelled) return;
        setLeaversError(
          err instanceof Error ? err.message : 'Failed to load leavers.'
        );
        setLeaverRows([]);
      })
      .finally(() => {
        if (cancelled) return;
        setIsLeaversLoading(false);
      });

    return () => {
      cancelled = true;
    };
  }, [employeeTab, isReady, orgId]);

  const now = new Date();
  const currentMonth = now.getMonth();
  const currentYear = now.getFullYear();
  const previousMonthDate = new Date(currentYear, currentMonth - 1, 1);
  const previousMonth = previousMonthDate.getMonth();
  const previousMonthYear = previousMonthDate.getFullYear();
  const previousPeriodEnd = new Date(currentYear, currentMonth, 0, 23, 59, 59, 999);

  const totalEmployees = employees.length;
  const activeEmployees = employees.filter(
    (employee) => employee.employmentStatus === 'Active'
  ).length;

  const previousTotalEmployees = employees.filter(
    (employee) => employee.createdAt && new Date(employee.createdAt) <= previousPeriodEnd
  ).length;
  const previousActiveEmployees = employees.filter(
    (employee) =>
      employee.employmentStatus === 'Active' &&
      employee.createdAt &&
      new Date(employee.createdAt) <= previousPeriodEnd
  ).length;

  const joinedThisMonth = employees.filter((employee) => {
    const joiningDate = new Date(employee.joiningDate);
    return (
      joiningDate.getMonth() === currentMonth &&
      joiningDate.getFullYear() === currentYear
    );
  }).length;
  const joinedPreviousMonth = employees.filter((employee) => {
    const joiningDate = new Date(employee.joiningDate);
    return (
      joiningDate.getMonth() === previousMonth &&
      joiningDate.getFullYear() === previousMonthYear
    );
  }).length;
  const departedThisMonth = employees.filter((employee) => {
    if (!employee.contractEndDate) return false;
    const endDate = new Date(employee.contractEndDate);
    return (
      employee.employmentStatus === 'Inactive' &&
      endDate.getMonth() === currentMonth &&
      endDate.getFullYear() === currentYear
    );
  }).length;
  const departedPreviousMonth = employees.filter((employee) => {
    if (!employee.contractEndDate) return false;
    const endDate = new Date(employee.contractEndDate);
    return (
      employee.employmentStatus === 'Inactive' &&
      endDate.getMonth() === previousMonth &&
      endDate.getFullYear() === previousMonthYear
    );
  }).length;

  const openOffboardModalForIds = (employeeIds: string[]) => {
    if (employeeIds.length === 0) {
      return;
    }
    const today = new Date();
    const yyyy = today.getFullYear();
    const mm = String(today.getMonth() + 1).padStart(2, '0');
    const dd = String(today.getDate()).padStart(2, '0');
    setOffboardingEmployeeIds(employeeIds);
    setOffboardLastWorkingDate(`${yyyy}-${mm}-${dd}`);
    setOffboardExitType('resignation');
    setOffboardLeavingReason('');
    setOffboardEligibleForRehire(true);
    setOffboardRehireNote('');
    setOffboardError(null);
    setOffboardOpen(true);
  };

  const toggleOffboardRow = (rowId: string) => {
    setOffboardSelectedIds((prev) => {
      const next = new Set(prev);
      if (next.has(rowId)) {
        next.delete(rowId);
      } else {
        next.add(rowId);
      }
      return next;
    });
  };

  const toggleOffboardAllVisible = (select: boolean, visibleRowIds: string[]) => {
    setOffboardSelectedIds((prev) => {
      const next = new Set(prev);
      if (select) {
        for (const id of visibleRowIds) {
          next.add(id);
        }
      } else {
        for (const id of visibleRowIds) {
          next.delete(id);
        }
      }
      return next;
    });
  };

  const exitHardDeleteMode = () => {
    setHardDeleteSelectMode(false);
    setHardDeleteSelectedIds(new Set());
  };

  const openHardDeleteModalForIds = (employeeIds: string[]) => {
    if (employeeIds.length === 0) return;
    setHardDeletingIds(employeeIds);
    setHardDeleteConfirmText('');
    setHardDeleteError(null);
    setHardDeleteProgress(null);
    setHardDeleteOpen(true);
  };

  const toggleHardDeleteRow = (rowId: string) => {
    setHardDeleteSelectedIds((prev) => {
      const next = new Set(prev);
      if (next.has(rowId)) next.delete(rowId);
      else next.add(rowId);
      return next;
    });
  };

  const toggleHardDeleteAllVisible = (select: boolean, visibleRowIds: string[]) => {
    void visibleRowIds;
    // Select/clear the full filtered list (not only the current page).
    if (select) {
      setHardDeleteSelectedIds(new Set(filteredEmployeeRows.map((r) => r.id)));
      return;
    }
    setHardDeleteSelectedIds(new Set());
  };

  const submitHardDelete = async () => {
    if (!orgId || hardDeletingIds.length === 0) return;
    if (hardDeleteConfirmText.trim().toUpperCase() !== 'DELETE') {
      setHardDeleteError('Type DELETE to confirm permanent deletion.');
      return;
    }

    const ids = [...hardDeletingIds];
    const total = ids.length;
    setHardDeleteSubmitting(true);
    setHardDeleteError(null);
    setHardDeleteProgress({ done: 0, total });
    const idToName = new Map(filteredEmployeeRows.map((r) => [r.id, r.fullName]));

    try {
      const res = await fetch('/api/employees/hard-delete', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          orgId,
          employeeIds: ids,
        }),
      });

      let payload: {
        ok?: boolean;
        results?: Array<{ employeeId: string; ok: boolean; error?: string }>;
        error?: string;
      } | null = null;
      try {
        payload = await res.json();
      } catch {
        payload = null;
      }

      if (!res.ok && !payload?.results) {
        throw new Error(payload?.error ?? 'Permanent delete failed.');
      }

      const results = payload?.results ?? [];
      const succeeded = results.filter((r) => r.ok).map((r) => r.employeeId);
      const failures = results
        .filter((r) => !r.ok)
        .map((r) => `${idToName.get(r.employeeId) ?? r.employeeId}: ${r.error ?? 'Failed.'}`);

      if (succeeded.length > 0) {
        payrollStore.purgeEmployeesLocally(succeeded);
        setLeaverRows((prev) => prev.filter((r) => !succeeded.includes(r.id)));
        loadEmployees();
      }

      setHardDeleteProgress({ done: succeeded.length, total });

      if (failures.length > 0) {
        throw new Error(
          `Deleted ${succeeded.length} of ${total}. Failures: ${failures.slice(0, 8).join(' ')}${
            failures.length > 8 ? ` (+${failures.length - 8} more)` : ''
          }`
        );
      }

      setHardDeleteOpen(false);
      setHardDeletingIds([]);
      setHardDeleteProgress(null);
      exitHardDeleteMode();

      const supabaseClient = getSupabaseBrowserClient();
      if (supabaseClient && orgId) {
        void hydrateEmployeesFromSupabase(supabaseClient, orgId).catch((err) =>
          console.error('Background employee hydrate after hard delete failed:', err)
        );
      }
    } catch (err: unknown) {
      setHardDeleteError(
        err instanceof Error ? err.message : 'Permanent delete failed.'
      );
    } finally {
      setHardDeleteSubmitting(false);
    }
  };

  const submitOffboarding = async () => {
    if (!orgId || offboardingEmployeeIds.length === 0) {
      return;
    }
    if (!offboardLastWorkingDate) {
      setOffboardError('Last Working Date is required.');
      return;
    }
    if (!offboardExitType) {
      setOffboardError('Separation Type is required.');
      return;
    }
    if (!offboardLeavingReason.trim()) {
      setOffboardError('Separation Reason is required.');
      return;
    }
    setOffboardSubmitting(true);
    setOffboardError(null);
    const idToName = new Map(filteredEmployeeRows.map((r) => [r.id, r.fullName]));
    const failures: string[] = [];
    try {
      const results = await Promise.all(
        offboardingEmployeeIds.map(async (employeeId) => {
          const res = await fetch('/api/employees/offboard', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
              orgId,
              employeeId,
              lastWorkingDate: offboardLastWorkingDate,
              exitType: offboardExitType,
              leavingReason: offboardLeavingReason.trim(),
              eligibleForRehire: offboardEligibleForRehire,
              rehireNote: offboardEligibleForRehire ? null : offboardRehireNote,
            }),
          });
          let payload: { error?: string } | null = null;
          try {
            payload = (await res.json()) as { error?: string };
          } catch {
            payload = null;
          }
          return { employeeId, ok: res.ok, error: payload?.error };
        })
      );

      for (const { employeeId, ok, error } of results) {
        if (!ok) {
          const label = idToName.get(employeeId) ?? employeeId;
          failures.push(`${label}: ${error ?? 'Offboarding failed.'}`);
        }
      }

      if (failures.length > 0) {
        throw new Error(failures.join(' '));
      }

      payrollStore.markEmployeesOffboardedLocally(
        offboardingEmployeeIds.map((employeeId) => ({
          employeeId,
          lastWorkingDate: offboardLastWorkingDate,
        }))
      );
      loadEmployees();
      setEmployeeTab('leavers');
      setOffboardOpen(false);
      setOffboardingEmployeeIds([]);
      setOffboardSelectedIds(new Set());
      setOffboardSelectMode(false);

      const supabaseClient = getSupabaseBrowserClient();
      if (supabaseClient) {
        void hydrateEmployeesFromSupabase(supabaseClient, orgId).catch((err) =>
          console.error('Background employee hydrate after offboard failed:', err)
        );
      }
    } catch (err: unknown) {
      setOffboardError(err instanceof Error ? err.message : 'Offboarding failed.');
    } finally {
      setOffboardSubmitting(false);
    }
  };

  const resetImportState = () => {
    setPendingImport(null);
    setStagedEmployeeFileName(null);
    setImportErrors([]);
    setImportProgress(null);
    setIsValidatingImport(false);
    setIsImporting(false);
    setIsDragActive(false);
    setEmployeePreviewText(null);
    employeeImportFileRef.current = null;
  };

  const clearEmployeeImportFile = () => {
    employeeImportFileRef.current = null;
    setStagedEmployeeFileName(null);
    setPendingImport(null);
    setImportErrors([]);
    setImportProgress(null);
    setIsDragActive(false);
  };

  const openImportModal = () => {
    resetImportState();
    setIsImportModalOpen(true);
  };

  const closeImportModal = () => {
    if (isImporting) {
      return;
    }

    setIsImportModalOpen(false);
    resetImportState();
  };

  const dismissImportSuccessToast = () => {
    setImportSuccessToastOpen(false);
    if (importSuccessToastTimerRef.current !== null) {
      clearTimeout(importSuccessToastTimerRef.current);
      importSuccessToastTimerRef.current = null;
    }
  };

  const dismissTemplateDownloadToast = () => {
    setTemplateDownloadToastOpen(false);
    if (templateDownloadToastTimerRef.current !== null) {
      clearTimeout(templateDownloadToastTimerRef.current);
      templateDownloadToastTimerRef.current = null;
    }
  };

  const handleTemplateDownload = () => {
    downloadEmployeeImportTemplate();
    setTemplateDownloadToastOpen(true);
    if (templateDownloadToastTimerRef.current !== null) {
      clearTimeout(templateDownloadToastTimerRef.current);
    }
    templateDownloadToastTimerRef.current = setTimeout(() => {
      setTemplateDownloadToastOpen(false);
      templateDownloadToastTimerRef.current = null;
    }, TEMPLATE_DOWNLOAD_TOAST_MS);
  };

  useEffect(() => {
    return () => {
      if (templateDownloadToastTimerRef.current !== null) {
        clearTimeout(templateDownloadToastTimerRef.current);
      }
      if (importSuccessToastTimerRef.current !== null) {
        clearTimeout(importSuccessToastTimerRef.current);
      }
    };
  }, []);

  const processImportFile = async (file: File) => {
    setStagedEmployeeFileName(file.name);
    setPendingImport(null);
    setEmployeePreviewText(null);
    setImportErrors([]);
    setImportProgress(null);
    setIsValidatingImport(true);

    try {
      employeeImportFileRef.current = file;
      const result = await validateEmployeeImportFile(file);

      if (!result.ok) {
        setImportErrors(groupImportValidationErrors(result.errors));
        return;
      }

      setStagedEmployeeFileName(null);
      setPendingImport({
        fileName: result.fileName,
        records: result.records,
        skippedSampleRow: result.skippedSampleRow,
      });
    } catch (error) {
      console.error('Error validating import file:', error);
      setImportErrors([
        'The import file could not be read. Download a fresh template and try again.',
      ]);
    } finally {
      setIsValidatingImport(false);
    }
  };

  const handleFileSelection = async (event: ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    if (file) {
      await processImportFile(file);
    }
    event.target.value = '';
  };

  const handleImportEmployees = async () => {
    if (!pendingImport) {
      return;
    }

    if (!employeePreviewText) {
      setIsValidatingImport(true);
      try {
        const res = await fetch('/api/employees/import', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            orgId,
            records: employeeRecordsForApi(pendingImport.records),
            preview: true,
          }),
        });
        const payload = (await res.json().catch(() => null)) as {
          error?: string;
          total?: number;
          newRecords?: number;
          existingRecords?: number;
        } | null;
        if (!res.ok) {
          setImportErrors([payload?.error || 'Preview failed.']);
          return;
        }
        setEmployeePreviewText(
          `${payload?.total ?? pendingImport.records.length} records, ${payload?.newRecords ?? 0} new, ${payload?.existingRecords ?? 0} existing. Blank optional cells keep the current values.`
        );
      } finally {
        setIsValidatingImport(false);
      }
      return;
    }

    setIsImporting(true);
    setImportErrors([]);

    const total = pendingImport.records.length;
    let committedRows = 0;
    let committedInserted = 0;
    let committedSkipped = 0;
    const rlsSkippedSample: Array<{ idNumber: string; reason: string }> = [];

    setImportProgress({
      processed: 0, // confirmed rows written/skipped by the API
      total,
      percentage: 0,
      created: 0, // reused as "inserted" (confirmed)
      updated: 0, // reused as "skipped" (confirmed)
      currentName: 'Waiting for database...',
    });

    try {
      if (!orgId) {
        throw new Error('Workspace not ready.');
      }

      for (let i = 0; i < pendingImport.records.length; i += IMPORT_BATCH_SIZE) {
        const batch = pendingImport.records.slice(i, i + IMPORT_BATCH_SIZE);

        setImportProgress((prev) => ({
          processed: prev?.processed ?? 0,
          total,
          percentage: prev?.percentage ?? 0,
          created: committedInserted,
          updated: committedSkipped,
          currentName: `Saving ${Math.min(i + 1, total)}–${Math.min(
            i + batch.length,
            total
          )} to database...`,
        }));

        const res = await fetch('/api/employees/import', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ orgId, records: employeeRecordsForApi(batch) }),
        });

        if (!res.ok) {
          const payload = (await res.json().catch(() => null)) as
            | { error?: string }
            | null;
          throw new Error(payload?.error || 'Employee import failed.');
        }

        const payload = (await res.json().catch(() => null)) as
          | {
              ok?: boolean;
              imported?: number;
              skipped?: number;
              rlsSkipped?: Array<{ idNumber: string; reason: string }>;
            }
          | null;

        const imported = Number(payload?.imported ?? 0);
        const skipped = Number(payload?.skipped ?? 0);
        const rlsSkipped = payload?.rlsSkipped ?? [];

        committedInserted += imported;
        committedSkipped += skipped;
        committedRows += imported + skipped;

        for (const s of rlsSkippedSample.length < 10 ? rlsSkipped : []) {
          if (rlsSkippedSample.length >= 10) break;
          rlsSkippedSample.push(s);
        }

        setImportProgress({
          processed: committedRows,
          total,
          percentage: Math.round((committedRows / total) * 100),
          created: committedInserted,
          updated: committedSkipped,
          currentName:
            imported > 0
              ? `Inserted ${imported} rows`
              : skipped > 0
                ? `Skipped ${skipped} rows`
                : 'No rows inserted (check permissions)',
        });
      }

      if (committedInserted === 0) {
        const sample =
          rlsSkippedSample.length > 0
            ? `\n\nSample RLS blocks:\n${rlsSkippedSample
                .slice(0, 5)
                .map((s) => `- ${s.idNumber}: ${s.reason}`)
                .join('\n')}`
            : '';
        throw new Error(`No employees were inserted into the database.${sample}`);
      }

      // Close the modal immediately after the final DB batch commit.
      setIsImporting(false);
      setIsImportModalOpen(false);
      resetImportState();
      setImportSuccessToastOpen(true);
      if (importSuccessToastTimerRef.current !== null) {
        clearTimeout(importSuccessToastTimerRef.current);
      }
      importSuccessToastTimerRef.current = setTimeout(() => {
        setImportSuccessToastOpen(false);
        importSuccessToastTimerRef.current = null;
      }, IMPORT_SUCCESS_TOAST_MS);

      // Re-hydrate in the background (prevents the UI from looking "stuck" at 100%).
      void (async () => {
        try {
          const supabaseClient = (await import('@/lib/supabase/client'))
            .getSupabaseBrowserClient();
          if (supabaseClient) {
            await hydrateEmployeesFromSupabase(supabaseClient, orgId);
            loadEmployees();
          }
        } catch (err) {
          console.error('Post-import hydration failed:', err);
        }
      })();
    } catch (error) {
      console.error('Error importing employees:', error);
      setIsImporting(false);
      setImportErrors([
        error instanceof Error
          ? error.message
          : 'Import failed while saving employee data. Please try again.',
      ]);
    }
  };

  const handleDragEnter = (event: DragEvent<HTMLDivElement>) => {
    event.preventDefault();
    event.stopPropagation();
    if (!isImporting) {
      setIsDragActive(true);
    }
  };

  const handleDragOver = (event: DragEvent<HTMLDivElement>) => {
    event.preventDefault();
    event.stopPropagation();
  };

  const handleDragLeave = (event: DragEvent<HTMLDivElement>) => {
    event.preventDefault();
    event.stopPropagation();
    const relatedTarget = event.relatedTarget as Node | null;

    if (!event.currentTarget.contains(relatedTarget)) {
      setIsDragActive(false);
    }
  };

  const handleDrop = async (event: DragEvent<HTMLDivElement>) => {
    event.preventDefault();
    event.stopPropagation();
    setIsDragActive(false);

    if (isImporting) {
      return;
    }

    const file = event.dataTransfer.files?.[0];
    if (file) {
      await processImportFile(file);
    }
  };

  const canReadEmployees = can(
    (membershipRole ?? null) as OrgMemberRole | null,
    'employees',
    'read'
  );

  const handleExportEmployees = async () => {
    if (!canReadEmployees || isExporting) return;
    setExportError(null);
    setIsExporting(true);
    try {
      await downloadEmployeeRecordsExport(
        sortedExportRows.map((row) => ({
          idNumber: row.idNumber,
          fullName: row.fullName,
          designation: row.designation,
          department: row.department,
          region: row.region,
        })),
        {
          fileName:
            employeeTab === 'leavers' ? 'Employee-Leavers.xlsx' : 'Employee-Records.xlsx',
          sheetName: employeeTab === 'leavers' ? 'Leavers' : 'Employee Records',
        }
      );
    } catch (error) {
      console.error('Employee export failed:', error);
      setExportError(
        error instanceof Error
          ? error.message
          : 'Export failed. Please try again.'
      );
    } finally {
      setIsExporting(false);
    }
  };

  return (
    <div className="space-y-4 bg-slate-50 p-4 sm:p-6">
      {templateDownloadToastOpen ? (
        <div
          className="fixed top-20 left-4 right-4 z-[200] flex items-start gap-3 rounded-lg border border-emerald-200/80 bg-white py-3 pl-4 pr-2 shadow-lg shadow-slate-900/10 ring-1 ring-slate-900/5 sm:left-auto sm:right-4 sm:max-w-sm"
          role="status"
          aria-live="polite"
        >
          <p className="flex-1 pt-0.5 text-sm font-medium text-emerald-900">
            Template downloaded successfully.
          </p>
          <button
            type="button"
            onClick={dismissTemplateDownloadToast}
            className="shrink-0 rounded-md p-1.5 text-slate-500 transition-colors hover:bg-slate-100 hover:text-slate-800"
            aria-label="Dismiss notification"
          >
            <CloseIcon className="h-4 w-4" />
          </button>
        </div>
      ) : null}

      {importSuccessToastOpen ? (
        <div
          className="fixed bottom-4 left-4 right-4 z-[200] flex items-start gap-3 rounded-lg border border-emerald-200/80 bg-white py-3 pl-4 pr-2 shadow-lg shadow-slate-900/10 ring-1 ring-slate-900/5 sm:right-auto sm:max-w-sm"
          role="status"
          aria-live="polite"
        >
          <p className="flex-1 pt-0.5 text-sm font-medium text-emerald-900">
            Import completed successfully.
          </p>
          <button
            type="button"
            onClick={dismissImportSuccessToast}
            className="shrink-0 rounded-md p-1.5 text-slate-500 transition-colors hover:bg-slate-100 hover:text-slate-800"
            aria-label="Dismiss notification"
          >
            <CloseIcon className="h-4 w-4" />
          </button>
        </div>
      ) : null}

      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 md:grid-cols-4">
        <EmployeeMetricCard
          title="Total Employees"
          total={totalEmployees}
          previousValue={previousTotalEmployees}
          bottomLabel="All employees in system"
          icon="employees"
        />
        <EmployeeMetricCard
          title="Active Employees"
          total={activeEmployees}
          previousValue={previousActiveEmployees}
          bottomLabel="Currently working"
          icon="active"
        />
        <EmployeeMetricCard
          title="New This Month"
          total={joinedThisMonth}
          previousValue={joinedPreviousMonth}
          bottomLabel={`New hires in ${now.toLocaleString('en-US', { month: 'long' })}`}
          icon="new"
        />
        <EmployeeMetricCard
          title="Departed This Month"
          total={departedThisMonth}
          previousValue={departedPreviousMonth}
          bottomLabel={`Left in ${now.toLocaleString('en-US', { month: 'long' })}`}
          icon="departed"
        />
      </div>

      <div>
        <div className="flex gap-1 overflow-x-auto [scrollbar-width:none] [&::-webkit-scrollbar]:hidden">
          <button
            type="button"
            onClick={() => {
              setExportError(null);
              setEmployeeTab('active');
            }}
            className={`relative px-3 py-2 text-sm font-semibold transition-colors ${
              employeeTab === 'active'
                ? 'text-[var(--analytics-budget)] after:absolute after:inset-x-2 after:bottom-0 after:h-0.5 after:rounded-full after:bg-[var(--analytics-budget)]'
                : 'text-slate-500 hover:text-slate-800'
            }`}
          >
            Active
          </button>
          <button
            type="button"
            onClick={() => {
              setExportError(null);
              setEmployeeTab('leavers');
            }}
            className={`relative px-3 py-2 text-sm font-semibold transition-colors ${
              employeeTab === 'leavers'
                ? 'text-[var(--analytics-budget)] after:absolute after:inset-x-2 after:bottom-0 after:h-0.5 after:rounded-full after:bg-[var(--analytics-budget)]'
                : 'text-slate-500 hover:text-slate-800'
            }`}
          >
            Leavers
          </button>
        </div>
        <HeaderDivider />
      </div>

      {employeeTab === 'leavers' && isLeaversLoading ? (
        <div className="rounded-[14px] border border-slate-200/90 bg-white px-4 py-4 text-sm text-slate-600 shadow-sm">
          Loading leavers…
        </div>
      ) : null}
      {employeeTab === 'leavers' && leaversError ? (
        <div className="rounded-[14px] border border-rose-200/80 bg-white px-4 py-4 text-sm text-rose-700 shadow-sm">
          {leaversError}
        </div>
      ) : null}

      <CompactEmployeeTable
        title={employeeTab === 'leavers' ? 'Leavers' : 'Employee Records'}
        description={
          employeeTab === 'leavers'
            ? 'Offboarded employees (snapshot preserved)'
            : 'View and manage employee information.'
        }
        rows={filteredEmployeeRows}
        emptyMessage="No employees found. Add your first employee or import a validated template to get started."
        sortable
        defaultSort={{ key: 'fullName', direction: 'asc' }}
        onDisplayRowsChange={handleDisplayRowsChange}
        rowSelection={
          hardDeleteSelectMode && isSuperAdmin
            ? {
                selectedIds: hardDeleteSelectedIds,
                onToggleRow: toggleHardDeleteRow,
                onToggleAllVisible: toggleHardDeleteAllVisible,
              }
            : employeeTab === 'active' && canUpdateEmployees && offboardSelectMode
              ? {
                  selectedIds: offboardSelectedIds,
                  onToggleRow: toggleOffboardRow,
                  onToggleAllVisible: toggleOffboardAllVisible,
                }
              : undefined
        }
        actions={
          <>
            {employeeTab === 'active' ? (
              <button
                type="button"
                onClick={openImportModal}
                className="inline-flex h-9 shrink-0 items-center gap-2 whitespace-nowrap rounded-xl border border-[var(--primary)] px-3 text-sm font-medium text-[var(--primary)] transition-colors hover:bg-[var(--primary-light)]"
              >
                <UploadIcon className="h-4 w-4" />
                Import
              </button>
            ) : null}

            {canReadEmployees ? (
              <button
                type="button"
                onClick={() => void handleExportEmployees()}
                disabled={isExporting || !orgId}
                className="inline-flex h-9 shrink-0 items-center gap-2 whitespace-nowrap rounded-xl border border-[var(--primary)] px-3 text-sm font-medium text-[var(--primary)] transition-colors hover:bg-[var(--primary-light)] disabled:opacity-60"
              >
                <DownloadIcon className="h-4 w-4" />
                {isExporting ? 'Exporting…' : 'Export'}
              </button>
            ) : null}

            {employeeTab === 'active' ? (
              <Link
                href="/employees/new"
                className="inline-flex h-9 shrink-0 items-center gap-2 whitespace-nowrap rounded-xl border border-[var(--primary)] px-3 text-sm font-medium text-[var(--primary)] transition-colors hover:bg-[var(--primary-light)]"
              >
                <PlusGlyph className="h-4 w-4" />
                New
              </Link>
            ) : null}

            {employeeTab === 'active' && canUpdateEmployees ? (
              <button
                type="button"
                title="Offboard Employee"
                onClick={() => {
                  exitHardDeleteMode();
                  if (!offboardSelectMode) {
                    setOffboardSelectMode(true);
                    return;
                  }
                  if (offboardSelectedIds.size > 0) {
                    openOffboardModalForIds(Array.from(offboardSelectedIds));
                    return;
                  }
                  setOffboardSelectMode(false);
                  setOffboardSelectedIds(new Set());
                }}
                className="inline-flex h-9 shrink-0 items-center gap-2 whitespace-nowrap rounded-xl border border-rose-600 bg-transparent px-3 text-sm font-medium text-rose-700 transition-colors hover:bg-rose-50"
              >
                <OffboardIcon className="h-4 w-4" />
                {!offboardSelectMode
                  ? 'Offboard'
                  : offboardSelectedIds.size > 0
                    ? `Offboard (${offboardSelectedIds.size})`
                    : 'Cancel'}
              </button>
            ) : null}

            {isSuperAdmin ? (
              <button
                type="button"
                title="Permanently delete employee data"
                onClick={() => {
                  setOffboardSelectMode(false);
                  setOffboardSelectedIds(new Set());
                  if (!hardDeleteSelectMode) {
                    setHardDeleteSelectMode(true);
                    return;
                  }
                  if (hardDeleteSelectedIds.size > 0) {
                    openHardDeleteModalForIds(Array.from(hardDeleteSelectedIds));
                    return;
                  }
                  exitHardDeleteMode();
                }}
                className="inline-flex h-9 shrink-0 items-center gap-2 whitespace-nowrap rounded-xl border border-rose-700 bg-rose-50 px-3 text-sm font-medium text-rose-800 hover:bg-rose-100"
              >
                <TrashIcon className="h-4 w-4" />
                {!hardDeleteSelectMode
                  ? 'Delete'
                  : hardDeleteSelectedIds.size > 0
                    ? `Delete (${hardDeleteSelectedIds.size})`
                    : 'Cancel'}
              </button>
            ) : null}
          </>
        }
        toolbar={
          <div className="space-y-1">
            <TableSearchInput
              id="employee-search"
              value={searchTerm}
              onChange={(next) => {
                setExportError(null);
                setSearchTerm(next);
              }}
              placeholder="Search…"
              containerClassName="w-[170px] max-w-full shrink-0"
            />
            {exportError ? (
              <p className="text-xs text-rose-700" role="alert">
                {exportError}
              </p>
            ) : null}
          </div>
        }
        renderDetailsCell={
          employeeTab === 'active'
            ? (row: DashboardEmployeeRow) => (
                <div className="flex items-center justify-end gap-2">
                  <Link
                    href={`/employees/${row.id}`}
                    className="inline-flex h-5 w-5 items-center justify-center rounded-full text-[var(--primary)] transition-colors hover:bg-[var(--primary-light)]"
                    aria-label={`View details for ${row.fullName}`}
                  >
                    <EyeIcon className="h-3.5 w-3.5" />
                  </Link>
                </div>
              )
            : undefined
        }
      />

      <Modal
        isOpen={hardDeleteOpen}
        onClose={() => {
          if (hardDeleteSubmitting) return;
          setHardDeleteOpen(false);
          setHardDeletingIds([]);
          setHardDeleteConfirmText('');
          setHardDeleteError(null);
          setHardDeleteProgress(null);
        }}
        title={
          hardDeleteSubmitting
            ? 'Deleting employees'
            : hardDeletingIds.length > 1
              ? `Permanently delete ${hardDeletingIds.length} employees`
              : 'Permanently delete employee'
        }
        footer={
          hardDeleteSubmitting ? null : (
            <>
              <button
                type="button"
                onClick={() => {
                  setHardDeleteOpen(false);
                  setHardDeletingIds([]);
                  setHardDeleteConfirmText('');
                  setHardDeleteError(null);
                  setHardDeleteProgress(null);
                }}
                className="inline-flex h-9 items-center justify-center whitespace-nowrap rounded-lg border border-slate-200 bg-white px-3 text-sm font-normal text-slate-700 transition-colors hover:bg-slate-50"
              >
                Cancel
              </button>
              <button
                type="button"
                onClick={() => void submitHardDelete()}
                disabled={hardDeleteConfirmText.trim().toUpperCase() !== 'DELETE'}
                className="inline-flex h-9 items-center justify-center whitespace-nowrap rounded-lg border border-rose-700 bg-rose-600 px-3 text-sm font-semibold text-white transition-colors hover:bg-rose-700 disabled:cursor-not-allowed disabled:opacity-60"
              >
                Delete permanently
              </button>
            </>
          )
        }
      >
        {hardDeleteError ? (
          <p className="mb-3 text-sm text-rose-700">{hardDeleteError}</p>
        ) : null}
        {hardDeleteSubmitting && hardDeleteProgress ? (
          <div className="space-y-4">
            <p className="text-sm text-slate-600">
              Please keep this window open while deletion runs.
            </p>
            <div className="flex items-end justify-between gap-3">
              <p className="text-sm font-medium text-slate-900">
                {hardDeleteProgress.done > 0
                  ? `${hardDeleteProgress.done} of ${hardDeleteProgress.total} employees deleted`
                  : `Deleting ${hardDeleteProgress.total} employees…`}
              </p>
              <p className="text-sm font-semibold tabular-nums text-slate-900">
                {hardDeleteProgress.total === 0
                  ? 0
                  : Math.round(
                      (hardDeleteProgress.done / hardDeleteProgress.total) * 100
                    )}
                %
              </p>
            </div>
            <div
              className="h-2.5 overflow-hidden rounded-full bg-slate-100"
              role="progressbar"
              aria-valuemin={0}
              aria-valuemax={hardDeleteProgress.total}
              aria-valuenow={hardDeleteProgress.done}
              aria-label="Employee deletion progress"
            >
              <div
                className={`h-full rounded-full bg-rose-600 ${
                  hardDeleteProgress.done === 0 ? 'w-1/3 animate-pulse' : ''
                }`}
                style={
                  hardDeleteProgress.done === 0
                    ? undefined
                    : {
                        width: `${
                          hardDeleteProgress.total === 0
                            ? 0
                            : (hardDeleteProgress.done / hardDeleteProgress.total) * 100
                        }%`,
                      }
                }
              />
            </div>
          </div>
        ) : (
          <div className="space-y-3">
            <p className="rounded-lg border border-rose-200 bg-rose-50 px-3 py-2 text-sm text-rose-900">
              This permanently removes the selected employee record(s) and connected separation
              and leaver data. Linked logins for this organization are deactivated. This cannot be
              undone.
            </p>
            <ul className="max-h-40 list-disc space-y-1 overflow-y-auto pl-5 text-sm text-slate-700">
              {hardDeletingIds.map((id) => {
                const row = filteredEmployeeRows.find((r) => r.id === id);
                return (
                  <li key={id}>
                    {row?.fullName ?? id}
                    {row?.idNumber ? ` (${row.idNumber})` : ''}
                  </li>
                );
              })}
            </ul>
            <div>
              <label className="text-sm font-medium text-slate-700" htmlFor="hard-delete-confirm">
                Type <span className="font-semibold">DELETE</span> to confirm
              </label>
              <input
                id="hard-delete-confirm"
                value={hardDeleteConfirmText}
                onChange={(e) => setHardDeleteConfirmText(e.target.value)}
                disabled={hardDeleteSubmitting}
                className="mt-1 h-9 w-full rounded-xl border border-slate-200 bg-white px-3 text-sm text-slate-700 outline-none focus:border-rose-500"
                placeholder="DELETE"
                autoComplete="off"
              />
            </div>
          </div>
        )}
      </Modal>

      <Modal
        isOpen={offboardOpen}
        onClose={() => {
          if (offboardSubmitting) return;
          setOffboardOpen(false);
          setOffboardingEmployeeIds([]);
        }}
        title={
          offboardingEmployeeIds.length > 1
            ? `Offboard ${offboardingEmployeeIds.length} employees`
            : 'Offboard employee'
        }
        footer={
          <>
            <button
              type="button"
              onClick={() => {
                setOffboardOpen(false);
                setOffboardingEmployeeIds([]);
              }}
              disabled={offboardSubmitting}
              className="inline-flex h-9 items-center justify-center whitespace-nowrap rounded-lg border border-[var(--primary)] bg-transparent px-3 text-sm font-normal text-[var(--primary)] transition-colors hover:bg-[var(--primary-light)] disabled:opacity-60"
            >
              Cancel
            </button>
            <button
              type="button"
              onClick={() => void submitOffboarding()}
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
              <label className="text-sm font-medium text-slate-700" htmlFor="offboard-exit-type">
                Separation Type
              </label>
              <select
                id="offboard-exit-type"
                value={offboardExitType}
                onChange={(e) => setOffboardExitType(e.target.value)}
                className="mt-1 h-9 w-full rounded-xl border border-slate-200 bg-white px-3 text-sm text-slate-700 outline-none focus:border-[var(--primary)]"
                required
              >
                {SEPARATION_EXIT_TYPE_OPTIONS.map((option) => (
                  <option key={option.value} value={option.value}>
                    {option.label}
                  </option>
                ))}
              </select>
            </div>
            <div>
              <label className="text-sm font-medium text-slate-700" htmlFor="offboard-last-working-date">
                Last Working Date
              </label>
              <input
                id="offboard-last-working-date"
                type="date"
                value={offboardLastWorkingDate}
                onChange={(e) => setOffboardLastWorkingDate(e.target.value)}
                className="mt-1 h-9 w-full rounded-xl border border-slate-200 bg-white px-3 text-sm text-slate-700 outline-none focus:border-[var(--primary)]"
                required
              />
            </div>
          </div>

          <div>
            <label className="text-sm font-medium text-slate-700" htmlFor="offboard-reason">
              Separation Reason
            </label>
            <input
              id="offboard-reason"
              type="text"
              value={offboardLeavingReason}
              onChange={(e) => setOffboardLeavingReason(e.target.value)}
              className="mt-1 h-9 w-full rounded-xl border border-slate-200 bg-white px-3 text-sm text-slate-700 outline-none focus:border-[var(--primary)]"
              required
            />
          </div>

          <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
            <div className="flex items-center gap-2">
              <input
                id="offboard-rehire"
                type="checkbox"
                checked={offboardEligibleForRehire}
                onChange={(e) => setOffboardEligibleForRehire(e.target.checked)}
                className="h-4 w-4 rounded border-slate-300 text-[var(--primary)] focus:ring-[var(--primary)]"
              />
              <label htmlFor="offboard-rehire" className="text-sm font-medium text-slate-700">
                Eligible for rehire
              </label>
            </div>

            {!offboardEligibleForRehire ? (
              <div>
                <label className="text-sm font-medium text-slate-700" htmlFor="offboard-rehire-note">
                  Rehire note (required)
                </label>
                <input
                  id="offboard-rehire-note"
                  value={offboardRehireNote}
                  onChange={(e) => setOffboardRehireNote(e.target.value)}
                  className="mt-1 h-9 w-full rounded-xl border border-slate-200 bg-white px-3 text-sm text-slate-700 outline-none focus:border-[var(--primary)]"
                  placeholder="Why not eligible?"
                />
              </div>
            ) : null}
          </div>
        </div>
      </Modal>

      <EmployeesImportModal
        isOpen={isImportModalOpen}
        onClose={closeImportModal}
        onDownloadEmployeeTemplate={handleTemplateDownload}
        onPickEmployeeFile={() => fileInputRef.current?.click()}
        onImportEmployees={() => {
          void handleImportEmployees();
        }}
        pendingEmployeeImport={pendingImport}
        stagedEmployeeFileName={stagedEmployeeFileName}
        groupedImportErrors={groupedImportErrors}
        onClearEmployeeFile={clearEmployeeImportFile}
        isValidatingImport={isValidatingImport}
        isImporting={isImporting}
        importProgress={importProgress}
        employeePreview={employeePreviewText}
        isDragActive={isDragActive}
        onDragEnter={handleDragEnter}
        onDragLeave={handleDragLeave}
        onDragOver={handleDragOver}
        onDrop={(event) => {
          void handleDrop(event);
        }}
      />

      <input
        ref={fileInputRef}
        type="file"
        accept=".xlsx,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"
        className="hidden"
        onChange={(event) => {
          void handleFileSelection(event);
        }}
      />
    </div>
  );
}

function UploadIcon({ className }: { className: string }) {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" className={className}>
      <path
        d="M12 16V4m0 0-4 4m4-4 4 4M5 15v3a2 2 0 0 0 2 2h10a2 2 0 0 0 2-2v-3"
        strokeWidth="1.8"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  );
}

function DownloadIcon({ className }: { className: string }) {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" className={className}>
      <path
        d="M12 4v12m0 0 4-4m-4 4-4-4M5 15v3a2 2 0 0 0 2 2h10a2 2 0 0 0 2-2v-3"
        strokeWidth="1.8"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  );
}

function EyeIcon({ className }: { className: string }) {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" className={className}>
      <path
        d="M2 12s3.5-7 10-7 10 7 10 7-3.5 7-10 7-10-7-10-7Z"
        strokeWidth="1.8"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
      <path
        d="M12 12a3 3 0 1 0 0.001 0Z"
        strokeWidth="1.8"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  );
}

function OffboardIcon({ className }: { className: string }) {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" className={className}>
      <path
        d="M9 3h6a2 2 0 0 1 2 2v3"
        strokeWidth="1.8"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
      <path
        d="M7 8h10a2 2 0 0 1 2 2v9a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2v-9a2 2 0 0 1 2-2Z"
        strokeWidth="1.8"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
      <path
        d="m10 12 4 4m0-4-4 4"
        strokeWidth="1.8"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  );
}

function TrashIcon({ className }: { className: string }) {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" className={className}>
      <path
        d="M4 7h16M9 7V5a1 1 0 0 1 1-1h4a1 1 0 0 1 1 1v2m-8 0 1 12a2 2 0 0 0 2 2h4a2 2 0 0 0 2-2l1-12M10 11v6M14 11v6"
        strokeWidth="1.8"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  );
}

function CloseIcon({ className }: { className: string }) {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" className={className}>
      <path
        d="M6 6l12 12M18 6 6 18"
        strokeWidth="1.8"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  );
}
