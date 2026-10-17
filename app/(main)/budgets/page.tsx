'use client';

import type { ChangeEvent, DragEvent } from 'react';
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
import { useAppAuth } from '@/components/providers/AppProviders';
import { Button } from '@/components/ui/Button';
import { CompactDataTable } from '@/components/ui/compact-employee-table';
import { DatePicker } from '@/components/ui/DatePicker';
import { HeaderDivider } from '@/components/ui/HeaderDivider';
import { ImportModalShell } from '@/components/ui/ImportModalShell';
import { Input } from '@/components/ui/Input';
import { Label } from '@/components/ui/Label';
import { Modal } from '@/components/ui/Modal';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/Select';
import { PlusGlyph, TableSearchInput } from '@/components/ui/table-controls';
import {
  downloadBudgetImportTemplate,
  validateBudgetImportFile,
  type BudgetImportRecord,
} from '@/lib/budget-import';
import {
  BUDGET_DATE_RANGE_OPTIONS,
  isoInInclusiveRange,
  resolveBudgetDateRange,
  type BudgetDateRangePreset,
} from '@/lib/budget-date-range';
import {
  BUDGET_CURRENCIES,
  type AdjustBudgetRequest,
  type BudgetAdjustDirection,
  type BudgetCurrency,
  type BudgetHistoryEntry,
  type BudgetListItem,
  type CreateBudgetRequest,
  type ReallocateBudgetRequest,
  type UpdateBudgetRequest,
} from '@/lib/budgets/types';
import { dateToCalendarIso } from '@/lib/employee-dates';
import { hydrateEmployeesFromSupabase } from '@/lib/employee-remote-sync';
import { formatCurrency } from '@/lib/format-currency';
import { groupImportValidationErrors } from '@/lib/import-error-utils';
import { employeeStore } from '@/lib/store';
import { getSupabaseBrowserClient } from '@/lib/supabase/client';
import type { Employee } from '@/lib/types';
import { can } from '@/lib/user-management/permissions';

type BudgetTableRow = BudgetListItem;

type ActiveModal =
  | { kind: 'new' }
  | { kind: 'edit'; budget: BudgetListItem }
  | { kind: 'adjust'; budget: BudgetListItem }
  | { kind: 'reallocate'; budget: BudgetListItem }
  | { kind: 'history'; budget: BudgetListItem };

type BudgetEmploymentTab = 'active' | 'separated' | 'all';

type PendingBudgetImport = {
  fileName: string;
  records: BudgetImportRecord[];
  skippedSampleRow: boolean;
};

type CurrencyTotals = {
  original: number;
  current: number;
  remaining: number;
};

const BUDGET_COLUMNS: Array<{ key: string; label: string; align?: 'left' | 'right' }> = [
  { key: 'budgetCode', label: 'Budget ID' },
  { key: 'employeeIdNumber', label: 'Employee ID' },
  { key: 'fullName', label: 'Full Name' },
  { key: 'plannedCourse', label: 'Planned Course' },
  { key: 'initialAmount', label: 'Budget', align: 'right' },
  { key: 'currency', label: 'Currency' },
  { key: 'currentAmount', label: 'Current Budget', align: 'right' },
  { key: 'remainingAmount', label: 'Remaining Budget', align: 'right' },
  { key: 'plannedCourseStartDate', label: 'Planned Start' },
];

const ALL_FILTER = '__all__';
const TEMPLATE_DOWNLOAD_TOAST_MS = 4000;
const IMPORT_SUCCESS_TOAST_MS = 30000;

function useIsClientMounted() {
  return useSyncExternalStore(
    () => () => {},
    () => true,
    () => false
  );
}

function useEmployeesSnapshot() {
  return useSyncExternalStore(
    (listener) => employeeStore.subscribe(listener),
    () => employeeStore.getEmployees(),
    () => [] as Employee[]
  );
}

function getInitials(name: string) {
  const parts = name.trim().split(/\s+/).filter(Boolean);
  if (parts.length === 0) return '?';
  if (parts.length === 1) return parts[0].slice(0, 2).toUpperCase();
  return `${parts[0][0] ?? ''}${parts[parts.length - 1][0] ?? ''}`.toUpperCase();
}

function calendarIsoToDate(iso: string): Date | undefined {
  const [y, m, d] = iso.split('-').map(Number);
  if (!y || !m || !d) return undefined;
  return new Date(y, m - 1, d, 12, 0, 0);
}

function formatDisplayDate(iso: string) {
  const date = calendarIsoToDate(iso);
  if (!date) return iso;
  return date.toLocaleDateString(undefined, {
    year: 'numeric',
    month: 'short',
    day: 'numeric',
  });
}

async function readApiError(response: Response): Promise<string> {
  try {
    const body = (await response.json()) as { error?: string; message?: string };
    return body.error ?? body.message ?? `Request failed (${response.status})`;
  } catch {
    return `Request failed (${response.status})`;
  }
}

async function fetchBudgets(orgId: string): Promise<BudgetListItem[]> {
  const response = await fetch(`/api/budgets?orgId=${encodeURIComponent(orgId)}`);
  if (!response.ok) {
    throw new Error(await readApiError(response));
  }
  const data = (await response.json()) as { budgets?: BudgetListItem[] };
  return data.budgets ?? [];
}

async function createBudget(payload: CreateBudgetRequest): Promise<void> {
  const response = await fetch('/api/budgets', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(payload),
  });
  if (!response.ok) {
    throw new Error(await readApiError(response));
  }
}

async function updateBudget(budgetId: string, payload: UpdateBudgetRequest): Promise<void> {
  const response = await fetch(`/api/budgets/${encodeURIComponent(budgetId)}`, {
    method: 'PATCH',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(payload),
  });
  if (!response.ok) {
    throw new Error(await readApiError(response));
  }
}

async function adjustBudget(budgetId: string, payload: AdjustBudgetRequest): Promise<void> {
  const response = await fetch(`/api/budgets/${encodeURIComponent(budgetId)}/adjust`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(payload),
  });
  if (!response.ok) {
    throw new Error(await readApiError(response));
  }
}

async function reallocateBudget(payload: ReallocateBudgetRequest): Promise<void> {
  const response = await fetch('/api/budgets/reallocate', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(payload),
  });
  if (!response.ok) {
    throw new Error(await readApiError(response));
  }
}

async function fetchBudgetHistory(budgetId: string, orgId: string): Promise<BudgetHistoryEntry[]> {
  const response = await fetch(
    `/api/budgets/${encodeURIComponent(budgetId)}/history?orgId=${encodeURIComponent(orgId)}`
  );
  if (!response.ok) {
    throw new Error(await readApiError(response));
  }
  const data = (await response.json()) as { history?: BudgetHistoryEntry[] };
  return data.history ?? [];
}

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
    if (!open) return;

    const place = () => {
      const rect = buttonRef.current?.getBoundingClientRect();
      if (!rect || rect.width < 1 || rect.height < 1) return;
      const menuWidth = 192;
      const left = Math.min(Math.max(8, rect.right - menuWidth), window.innerWidth - menuWidth - 8);
      setCoords({ top: rect.bottom + 4, left });
    };

    const placeTimer = window.requestAnimationFrame(place);
    const onPointerDown = (event: MouseEvent) => {
      const target = event.target as Node;
      if (buttonRef.current?.contains(target) || menuRef.current?.contains(target)) return;
      onOpenChangeRef.current(false);
    };
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') onOpenChangeRef.current(false);
    };
    const onReposition = () => place();
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
        className="inline-flex h-7 w-7 items-center justify-center rounded-full text-[var(--primary)] transition-colors hover:bg-[var(--primary-light)]"
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

function ReadOnlyField({ label, value }: { label: string; value: string }) {
  return (
    <div>
      <Label className="text-slate-600">{label}</Label>
      <p className="mt-1 rounded-lg border border-slate-200 bg-slate-50 px-3 py-2 text-sm text-slate-800">
        {value || '—'}
      </p>
    </div>
  );
}

function FilterSelect({
  id,
  label,
  value,
  onChange,
  options,
}: {
  id: string;
  label: string;
  value: string;
  onChange: (value: string) => void;
  options: Array<{ value: string; label: string }>;
}) {
  return (
    <div className="min-w-[8.5rem]">
      <Label htmlFor={id} className="sr-only">
        {label}
      </Label>
      <Select value={value || ALL_FILTER} onValueChange={(v) => onChange(v === ALL_FILTER ? '' : v)}>
        <SelectTrigger id={id} className="h-9 text-sm">
          <SelectValue placeholder={label} />
        </SelectTrigger>
        <SelectContent>
          <SelectItem value={ALL_FILTER}>All {label}</SelectItem>
          {options.map((opt) => (
            <SelectItem key={opt.value} value={opt.value}>
              {opt.label}
            </SelectItem>
          ))}
        </SelectContent>
      </Select>
    </div>
  );
}

function BudgetSummaryCard({
  title,
  totalsByCurrency,
  pick,
}: {
  title: string;
  totalsByCurrency: Map<string, CurrencyTotals>;
  pick: keyof CurrencyTotals;
}) {
  const currencies = [...totalsByCurrency.keys()].sort((a, b) => a.localeCompare(b));

  return (
    <div className="group relative overflow-hidden rounded-[14px] border border-slate-200/90 bg-white px-4 py-3 shadow-sm">
      <div className="absolute inset-x-0 top-0 h-[3px] bg-gradient-to-r from-[var(--analytics-budget)] via-[var(--analytics-budget-hover)] to-[var(--analytics-budget-soft)]" />
      <p className="text-[15px] font-semibold text-slate-800">{title}</p>
      <div className="mt-2 space-y-1">
        {currencies.length === 0 ? (
          <p className="text-[20px] font-semibold text-slate-700">—</p>
        ) : (
          currencies.map((currency) => (
            <p key={currency} className="text-[18px] font-semibold tabular-nums text-slate-700">
              {formatCurrency(totalsByCurrency.get(currency)![pick], currency)}
            </p>
          ))
        )}
      </div>
      {currencies.length > 1 ? (
        <p className="mt-2 text-[12px] text-slate-500">Totals by currency (filtered view)</p>
      ) : (
        <p className="mt-2 text-[12px] text-slate-500">Filtered budgets</p>
      )}
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

function BudgetsImportModal({
  isOpen,
  onClose,
  onDownloadTemplate,
  onPickFile,
  onImport,
  pendingImport,
  isValidatingImport,
  isImporting,
  isDragActive,
  onDragEnter,
  onDragLeave,
  onDragOver,
  onDrop,
  stagedFileName,
  groupedImportErrors,
  onClearFile,
  budgetPreview,
}: {
  isOpen: boolean;
  onClose: () => void;
  onDownloadTemplate: () => void;
  onPickFile: () => void;
  onImport: () => void;
  pendingImport: PendingBudgetImport | null;
  stagedFileName: string | null;
  groupedImportErrors: string[];
  onClearFile: () => void;
  isValidatingImport: boolean;
  isImporting: boolean;
  isDragActive: boolean;
  onDragEnter: (event: DragEvent<HTMLDivElement>) => void;
  onDragLeave: (event: DragEvent<HTMLDivElement>) => void;
  onDragOver: (event: DragEvent<HTMLDivElement>) => void;
  onDrop: (event: DragEvent<HTMLDivElement>) => void;
  budgetPreview: string | null;
}) {
  const budgetFileName = pendingImport?.fileName ?? stagedFileName ?? null;
  const showLargeDropZone = !budgetFileName;
  const removeDisabled = isValidatingImport || isImporting;

  return (
    <ImportModalShell
      isOpen={isOpen}
      title="Import budgets"
      icon={<UploadIcon className="h-6 w-6" />}
      onClose={onClose}
    >
      {isImporting ? (
        <div className="space-y-8">
          <div className="flex items-center justify-center">
            <div className="relative flex h-24 w-24 items-center justify-center rounded-full bg-[var(--primary-light)]">
              <div className="absolute inset-0 animate-pulse rounded-full border border-[var(--primary-border)]" />
              <div className="h-14 w-14 animate-spin rounded-full border-4 border-[var(--primary)] border-t-transparent" />
            </div>
          </div>
          <div className="text-center">
            <p className="text-[22px] font-semibold text-slate-950">Importing budgets</p>
            <p className="mt-2 text-[15px] text-slate-500">Creating budget allocations from your file…</p>
          </div>
        </div>
      ) : (
        <div className="space-y-6">
          <p className="text-center text-[15px] font-semibold text-slate-800">
            <button
              type="button"
              onClick={onDownloadTemplate}
              className="font-semibold text-[var(--primary)] underline-offset-4 hover:text-[var(--primary-hover)] hover:underline"
            >
              Download budget template
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
                  onClick={onPickFile}
                  disabled={isValidatingImport}
                >
                  {isValidatingImport ? 'Validating…' : 'Choose File'}
                </Button>
              </div>
            </div>
          ) : null}

          {budgetFileName ? (
            <ImportSelectedFileRow
              fileName={budgetFileName}
              onRemove={onClearFile}
              removeDisabled={removeDisabled}
            />
          ) : null}

          {pendingImport ? (
            <div className="rounded-2xl border border-emerald-200 bg-emerald-50 px-5 py-4">
              <div className="flex flex-col gap-4 sm:flex-row sm:items-start sm:justify-between">
                <div>
                  <p className="text-sm font-medium text-emerald-900">Ready to import</p>
                  <p className="mt-1 text-sm text-emerald-800">
                    {pendingImport.records.length} budget rows validated successfully.
                  </p>
                  {pendingImport.skippedSampleRow ? (
                    <p className="mt-2 text-sm text-emerald-700">
                      The sample template row was detected and ignored.
                    </p>
                  ) : null}
                  {budgetPreview ? (
                    <p className="mt-2 text-sm text-emerald-900">{budgetPreview}</p>
                  ) : null}
                </div>
                <Button
                  type="button"
                  className="w-full !rounded-xl !bg-[var(--primary)] px-5 py-2.5 !text-sm font-semibold hover:!bg-[var(--primary-hover)] sm:w-auto"
                  onClick={onImport}
                  disabled={isValidatingImport}
                >
                  {budgetPreview ? 'Confirm Import' : 'Review Import'}
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

function historyTypeLabel(entry: BudgetHistoryEntry) {
  if (entry.type === 'adjustment') {
    return entry.direction === 'decrease' ? 'Decrease' : 'Increase';
  }
  if (entry.type === 'reallocation_in') return 'Reallocation in';
  return 'Reallocation out';
}

function formatPreviewTotals(totalsByCurrency: Record<string, number> | undefined) {
  if (!totalsByCurrency) return '';
  const parts = Object.entries(totalsByCurrency)
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([currency, amount]) => formatCurrency(amount, currency));
  return parts.length ? ` Totals: ${parts.join(' · ')}.` : '';
}

export default function BudgetsPage() {
  const { orgId, membershipRole, isReady } = useAppAuth();
  const supabase = useMemo(() => getSupabaseBrowserClient(), []);
  const employees = useEmployeesSnapshot();

  const canReadBudgets = can(membershipRole, 'budgets', 'read');
  const canCreateBudgets = can(membershipRole, 'budgets', 'create');
  const canUpdateBudgets = can(membershipRole, 'budgets', 'update');

  const [budgets, setBudgets] = useState<BudgetListItem[]>([]);
  const [loading, setLoading] = useState(false);
  const [listError, setListError] = useState<string | null>(null);
  const [searchTerm, setSearchTerm] = useState('');
  const deferredSearch = useDeferredValue(searchTerm);
  const [budgetTab, setBudgetTab] = useState<BudgetEmploymentTab>('all');
  const [filterRegion, setFilterRegion] = useState('');
  const [filterDepartment, setFilterDepartment] = useState('');
  const [filterCurrency, setFilterCurrency] = useState('');
  const [dateRangePreset, setDateRangePreset] = useState<BudgetDateRangePreset>('ytd');
  const [customRangeFrom, setCustomRangeFrom] = useState('');
  const [customRangeTo, setCustomRangeTo] = useState('');

  const [menuOpenFor, setMenuOpenFor] = useState<string | null>(null);
  const [activeModal, setActiveModal] = useState<ActiveModal | null>(null);
  const [modalError, setModalError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);

  const [newEmployeeId, setNewEmployeeId] = useState('');
  const [newPlannedCourse, setNewPlannedCourse] = useState('');
  const [newAmount, setNewAmount] = useState('');
  const [newCurrency, setNewCurrency] = useState<BudgetCurrency>('AFN');
  const [newStartDate, setNewStartDate] = useState<Date | undefined>();

  const [editPlannedCourse, setEditPlannedCourse] = useState('');
  const [editAmount, setEditAmount] = useState('');
  const [editCurrency, setEditCurrency] = useState<BudgetCurrency>('AFN');
  const [editStartDate, setEditStartDate] = useState<Date | undefined>();

  const [adjustDirection, setAdjustDirection] = useState<BudgetAdjustDirection>('increase');
  const [adjustAmount, setAdjustAmount] = useState('');
  const [adjustNote, setAdjustNote] = useState('');

  const [reallocateDestinationId, setReallocateDestinationId] = useState('');
  const [reallocateAmount, setReallocateAmount] = useState('');
  const [reallocateNote, setReallocateNote] = useState('');

  const [historyEntries, setHistoryEntries] = useState<BudgetHistoryEntry[]>([]);
  const [historyLoading, setHistoryLoading] = useState(false);

  const [isImportModalOpen, setIsImportModalOpen] = useState(false);
  const [pendingBudgetImport, setPendingBudgetImport] = useState<PendingBudgetImport | null>(null);
  const [stagedBudgetFileName, setStagedBudgetFileName] = useState<string | null>(null);
  const [isValidatingImport, setIsValidatingImport] = useState(false);
  const [isImporting, setIsImporting] = useState(false);
  const [isDragActive, setIsDragActive] = useState(false);
  const [importErrors, setImportErrors] = useState<string[]>([]);
  const [budgetPreviewText, setBudgetPreviewText] = useState<string | null>(null);
  const [previewPotentialDuplicates, setPreviewPotentialDuplicates] = useState(0);
  const [templateDownloadToastOpen, setTemplateDownloadToastOpen] = useState(false);
  const [importSuccessToastOpen, setImportSuccessToastOpen] = useState(false);

  const budgetImportFileRef = useRef<File | null>(null);
  const budgetImportInputRef = useRef<HTMLInputElement | null>(null);
  const templateDownloadToastTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const importSuccessToastTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const selectedNewEmployee = useMemo(
    () => employees.find((e) => e.id === newEmployeeId) ?? null,
    [employees, newEmployeeId]
  );

  const resolvedDateRange = useMemo(
    () => resolveBudgetDateRange(dateRangePreset, customRangeFrom, customRangeTo),
    [dateRangePreset, customRangeFrom, customRangeTo]
  );

  const dateRangeError = 'error' in resolvedDateRange ? resolvedDateRange.error : null;

  const reloadBudgets = async () => {
    if (!orgId) return;
    setLoading(true);
    setListError(null);
    try {
      const rows = await fetchBudgets(orgId);
      setBudgets(rows);
    } catch (err) {
      setListError(err instanceof Error ? err.message : 'Failed to load budgets.');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    if (!isReady || !orgId || !canReadBudgets) return;
    let cancelled = false;
    void (async () => {
      setLoading(true);
      setListError(null);
      try {
        const rows = await fetchBudgets(orgId);
        if (!cancelled) setBudgets(rows);
      } catch (err) {
        if (!cancelled) {
          setListError(err instanceof Error ? err.message : 'Failed to load budgets.');
        }
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [isReady, orgId, canReadBudgets]);

  useEffect(() => {
    if (!supabase || !orgId) return;
    void (async () => {
      try {
        if (employeeStore.getEmployees().length === 0) {
          await hydrateEmployeesFromSupabase(supabase, orgId);
        }
      } catch (err) {
        console.error('Failed to hydrate employees for budgets:', err);
        const { data, error } = await supabase
          .from('employees')
          .select('*')
          .eq('org_id', orgId)
          .is('deleted_at', null);
        if (!error && data?.length) {
          const { fetchEmployeesFromSupabase } = await import('@/lib/supabase/employee-db');
          const fetched = await fetchEmployeesFromSupabase(supabase, orgId);
          employeeStore.hydrateFromRemote({ employees: fetched });
        }
      }
    })();
  }, [supabase, orgId]);

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

  const filterOptions = useMemo(() => {
    const regions = new Set<string>();
    const departments = new Set<string>();
    const currencies = new Set<string>();
    for (const row of budgets) {
      if (row.region) regions.add(row.region);
      if (row.department) departments.add(row.department);
      if (row.currency) currencies.add(row.currency);
    }
    return {
      regions: [...regions].sort((a, b) => a.localeCompare(b)),
      departments: [...departments].sort((a, b) => a.localeCompare(b)),
      currencies: [...currencies].sort((a, b) => a.localeCompare(b)),
    };
  }, [budgets]);

  const filteredRows = useMemo(() => {
    const q = deferredSearch.trim().toLowerCase();
    return budgets.filter((row) => {
      if (budgetTab === 'active' && row.employmentStatus !== 'Active') return false;
      if (budgetTab === 'separated' && row.employmentStatus !== 'Inactive') return false;

      if (filterRegion && row.region !== filterRegion) return false;
      if (filterDepartment && row.department !== filterDepartment) return false;
      if (filterCurrency && row.currency !== filterCurrency) return false;

      if (!dateRangeError && !('error' in resolvedDateRange)) {
        if (
          !isoInInclusiveRange(
            row.plannedCourseStartDate,
            resolvedDateRange.from,
            resolvedDateRange.to
          )
        ) {
          return false;
        }
      }

      if (!q) return true;
      const haystack = [
        row.budgetCode,
        row.employeeIdNumber,
        row.fullName,
        row.plannedCourse,
        row.currency,
      ]
        .join(' ')
        .toLowerCase();
      return haystack.includes(q);
    });
  }, [
    budgets,
    deferredSearch,
    budgetTab,
    filterRegion,
    filterDepartment,
    filterCurrency,
    dateRangeError,
    resolvedDateRange,
  ]);

  const summaryByCurrency = useMemo(() => {
    const map = new Map<string, CurrencyTotals>();
    for (const row of filteredRows) {
      const currency = row.currency || 'AFN';
      const entry = map.get(currency) ?? { original: 0, current: 0, remaining: 0 };
      entry.original += row.initialAmount;
      entry.current += row.currentAmount;
      entry.remaining += row.remainingAmount;
      map.set(currency, entry);
    }
    return map;
  }, [filteredRows]);

  const groupedImportErrors = useMemo(
    () => groupImportValidationErrors(importErrors),
    [importErrors]
  );

  const resetImportState = () => {
    setPendingBudgetImport(null);
    setStagedBudgetFileName(null);
    setBudgetPreviewText(null);
    setPreviewPotentialDuplicates(0);
    setImportErrors([]);
    budgetImportFileRef.current = null;
  };

  const openImportModal = () => {
    resetImportState();
    setIsImportModalOpen(true);
  };

  const closeImportModal = () => {
    if (isImporting) return;
    setIsImportModalOpen(false);
    resetImportState();
  };

  const dismissTemplateDownloadToast = () => {
    setTemplateDownloadToastOpen(false);
    if (templateDownloadToastTimerRef.current !== null) {
      clearTimeout(templateDownloadToastTimerRef.current);
      templateDownloadToastTimerRef.current = null;
    }
  };

  const dismissImportSuccessToast = () => {
    setImportSuccessToastOpen(false);
    if (importSuccessToastTimerRef.current !== null) {
      clearTimeout(importSuccessToastTimerRef.current);
      importSuccessToastTimerRef.current = null;
    }
  };

  const handleTemplateDownload = () => {
    downloadBudgetImportTemplate();
    setTemplateDownloadToastOpen(true);
    if (templateDownloadToastTimerRef.current !== null) {
      clearTimeout(templateDownloadToastTimerRef.current);
    }
    templateDownloadToastTimerRef.current = setTimeout(() => {
      setTemplateDownloadToastOpen(false);
      templateDownloadToastTimerRef.current = null;
    }, TEMPLATE_DOWNLOAD_TOAST_MS);
  };

  const processImportFile = async (file: File) => {
    setStagedBudgetFileName(file.name);
    setPendingBudgetImport(null);
    setBudgetPreviewText(null);
    setPreviewPotentialDuplicates(0);
    setImportErrors([]);
    setIsValidatingImport(true);

    try {
      budgetImportFileRef.current = file;
      const result = await validateBudgetImportFile(file);

      if (!result.ok) {
        setImportErrors(groupImportValidationErrors(result.errors));
        return;
      }

      setStagedBudgetFileName(null);
      setPendingBudgetImport({
        fileName: result.fileName,
        records: result.records,
        skippedSampleRow: result.skippedSampleRow,
      });
    } catch (error) {
      console.error('Error validating budget import file:', error);
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

  const handleImportBudgets = async () => {
    if (!pendingBudgetImport || !orgId) return;

    if (!budgetPreviewText) {
      setIsValidatingImport(true);
      try {
        const res = await fetch('/api/budgets/import', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            orgId,
            records: pendingBudgetImport.records,
            preview: true,
          }),
        });
        const payload = (await res.json().catch(() => null)) as {
          error?: string;
          errors?: string[];
          total?: number;
          potentialDuplicates?: number;
          totalsByCurrency?: Record<string, number>;
        } | null;

        if (!res.ok) {
          const apiErrors = payload?.errors?.length
            ? groupImportValidationErrors(payload.errors)
            : [payload?.error || 'Preview failed.'];
          setImportErrors(apiErrors);
          return;
        }

        const duplicates = payload?.potentialDuplicates ?? 0;
        setPreviewPotentialDuplicates(duplicates);
        const total = payload?.total ?? pendingBudgetImport.records.length;
        const duplicateNote =
          duplicates > 0
            ? ` ${duplicates} potential duplicate${duplicates === 1 ? '' : 's'} — confirm to import anyway.`
            : '';
        setBudgetPreviewText(
          `${total} budget row${total === 1 ? '' : 's'} ready.${duplicateNote}${formatPreviewTotals(payload?.totalsByCurrency)}`
        );
      } catch (error) {
        console.error('Budget import preview failed:', error);
        setImportErrors(['Preview failed. Please try again.']);
      } finally {
        setIsValidatingImport(false);
      }
      return;
    }

    setIsImporting(true);
    setImportErrors([]);
    try {
      const res = await fetch('/api/budgets/import', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          orgId,
          records: pendingBudgetImport.records,
          allowPotentialDuplicates: previewPotentialDuplicates > 0,
        }),
      });
      const payload = (await res.json().catch(() => null)) as {
        error?: string;
        errors?: string[];
        imported?: number;
      } | null;

      if (!res.ok) {
        const apiErrors = payload?.errors?.length
          ? groupImportValidationErrors(payload.errors)
          : [payload?.error || 'Import failed.'];
        setImportErrors(apiErrors);
        return;
      }

      setIsImportModalOpen(false);
      resetImportState();
      await reloadBudgets();
      setImportSuccessToastOpen(true);
      if (importSuccessToastTimerRef.current !== null) {
        clearTimeout(importSuccessToastTimerRef.current);
      }
      importSuccessToastTimerRef.current = setTimeout(() => {
        setImportSuccessToastOpen(false);
        importSuccessToastTimerRef.current = null;
      }, IMPORT_SUCCESS_TOAST_MS);
    } catch (error) {
      console.error('Budget import failed:', error);
      setImportErrors([
        error instanceof Error ? error.message : 'Import failed while saving budget data.',
      ]);
    } finally {
      setIsImporting(false);
    }
  };

  const handleDragEnter = (event: DragEvent<HTMLDivElement>) => {
    event.preventDefault();
    event.stopPropagation();
    if (!isImporting) setIsDragActive(true);
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
    if (isImporting) return;
    const file = event.dataTransfer.files?.[0];
    if (file) await processImportFile(file);
  };

  const resetNewForm = () => {
    setNewEmployeeId('');
    setNewPlannedCourse('');
    setNewAmount('');
    setNewCurrency('AFN');
    setNewStartDate(undefined);
  };

  const openNewModal = () => {
    resetNewForm();
    setModalError(null);
    setActiveModal({ kind: 'new' });
  };

  const openEditModal = (budget: BudgetListItem) => {
    setEditPlannedCourse(budget.plannedCourse);
    setEditAmount(String(budget.initialAmount));
    setEditCurrency(
      BUDGET_CURRENCIES.includes(budget.currency as BudgetCurrency)
        ? (budget.currency as BudgetCurrency)
        : 'AFN'
    );
    setEditStartDate(calendarIsoToDate(budget.plannedCourseStartDate));
    setModalError(null);
    setActiveModal({ kind: 'edit', budget });
  };

  const openAdjustModal = (budget: BudgetListItem) => {
    setAdjustDirection('increase');
    setAdjustAmount('');
    setAdjustNote('');
    setModalError(null);
    setActiveModal({ kind: 'adjust', budget });
  };

  const openReallocateModal = (budget: BudgetListItem) => {
    setReallocateDestinationId('');
    setReallocateAmount('');
    setReallocateNote('');
    setModalError(null);
    setActiveModal({ kind: 'reallocate', budget });
  };

  const openHistoryModal = (budget: BudgetListItem) => {
    setHistoryEntries([]);
    setModalError(null);
    setActiveModal({ kind: 'history', budget });
    if (!orgId) return;
    setHistoryLoading(true);
    void fetchBudgetHistory(budget.id, orgId)
      .then(setHistoryEntries)
      .catch((err) => {
        setModalError(err instanceof Error ? err.message : 'Failed to load history.');
      })
      .finally(() => setHistoryLoading(false));
  };

  const closeModal = () => {
    if (submitting) return;
    setActiveModal(null);
    setModalError(null);
  };

  const parseAmount = (raw: string): number | null => {
    const normalized = raw.trim().replace(/,/g, '');
    if (normalized === '') return null;
    const value = Number(normalized);
    if (!Number.isFinite(value) || value < 0) return null;
    return value;
  };

  const submitNewBudget = async () => {
    if (!orgId || !selectedNewEmployee) {
      setModalError('Select an employee.');
      return;
    }
    const amount = parseAmount(newAmount);
    if (amount === null) {
      setModalError('Enter a valid budget amount (0 or greater).');
      return;
    }
    if (!newPlannedCourse.trim()) {
      setModalError('Planned course is required.');
      return;
    }
    const startIso = newStartDate ? dateToCalendarIso(newStartDate) : null;
    if (!startIso) {
      setModalError('Planned start date is required.');
      return;
    }
    setSubmitting(true);
    setModalError(null);
    try {
      const payload: CreateBudgetRequest = {
        orgId,
        employeeId: selectedNewEmployee.id,
        plannedCourse: newPlannedCourse.trim(),
        initialAmount: amount,
        currency: newCurrency,
        plannedCourseStartDate: startIso,
      };
      await createBudget(payload);
      setActiveModal(null);
      await reloadBudgets();
    } catch (err) {
      setModalError(err instanceof Error ? err.message : 'Could not create budget.');
    } finally {
      setSubmitting(false);
    }
  };

  const submitEditBudget = async () => {
    const modal = activeModal;
    if (!orgId || modal?.kind !== 'edit') return;
    const amount = parseAmount(editAmount);
    if (amount === null) {
      setModalError('Enter a valid initial amount.');
      return;
    }
    if (!editPlannedCourse.trim()) {
      setModalError('Planned course is required.');
      return;
    }
    const startIso = editStartDate ? dateToCalendarIso(editStartDate) : null;
    if (!startIso) {
      setModalError('Planned start date is required.');
      return;
    }
    setSubmitting(true);
    setModalError(null);
    try {
      const payload: UpdateBudgetRequest = {
        orgId,
        plannedCourse: editPlannedCourse.trim(),
        currency: editCurrency,
        plannedCourseStartDate: startIso,
      };
      if (!modal.budget.hasTransactions) {
        payload.initialAmount = amount;
      }
      await updateBudget(modal.budget.id, payload);
      setActiveModal(null);
      await reloadBudgets();
    } catch (err) {
      setModalError(err instanceof Error ? err.message : 'Could not update budget.');
    } finally {
      setSubmitting(false);
    }
  };

  const submitAdjust = async () => {
    const modal = activeModal;
    if (!orgId || modal?.kind !== 'adjust') return;
    const amount = parseAmount(adjustAmount);
    if (amount === null || amount <= 0) {
      setModalError('Enter an adjustment amount greater than zero.');
      return;
    }
    setSubmitting(true);
    setModalError(null);
    try {
      await adjustBudget(modal.budget.id, {
        orgId,
        direction: adjustDirection,
        amount,
        note: adjustNote.trim() || undefined,
      });
      setActiveModal(null);
      await reloadBudgets();
    } catch (err) {
      setModalError(err instanceof Error ? err.message : 'Could not adjust budget.');
    } finally {
      setSubmitting(false);
    }
  };

  const submitReallocate = async () => {
    const modal = activeModal;
    if (!orgId || modal?.kind !== 'reallocate') return;
    const amount = parseAmount(reallocateAmount);
    if (amount === null || amount <= 0) {
      setModalError('Enter an amount greater than zero.');
      return;
    }
    if (!reallocateDestinationId) {
      setModalError('Select a destination budget.');
      return;
    }
    setSubmitting(true);
    setModalError(null);
    try {
      await reallocateBudget({
        orgId,
        sourceBudgetId: modal.budget.id,
        destinationBudgetId: reallocateDestinationId,
        amount,
        note: reallocateNote.trim() || undefined,
      });
      setActiveModal(null);
      await reloadBudgets();
    } catch (err) {
      setModalError(err instanceof Error ? err.message : 'Could not reallocate budget.');
    } finally {
      setSubmitting(false);
    }
  };

  const reallocateDestinations = useMemo(() => {
    if (activeModal?.kind !== 'reallocate') return [];
    return budgets.filter((b) => b.id !== activeModal.budget.id);
  }, [activeModal, budgets]);

  const menuItemClass =
    'block w-full rounded-md px-3 py-2 text-left text-sm text-slate-800 hover:bg-slate-50 disabled:cursor-not-allowed disabled:opacity-50';

  if (isReady && !canReadBudgets) {
    return (
      <div className="space-y-4 bg-slate-50 p-4 sm:p-6">
        <div className="mx-auto max-w-5xl rounded-[18px] border border-slate-200/90 bg-white p-4 shadow-sm sm:p-6">
          <h2 className="text-lg font-semibold text-slate-900">Budgets</h2>
          <p className="mt-2 text-sm text-slate-600">You do not have permission to view budgets.</p>
        </div>
      </div>
    );
  }

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

      <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
        <BudgetSummaryCard title="Original Budget" totalsByCurrency={summaryByCurrency} pick="original" />
        <BudgetSummaryCard title="Current Budget" totalsByCurrency={summaryByCurrency} pick="current" />
        <BudgetSummaryCard
          title="Remaining Budget"
          totalsByCurrency={summaryByCurrency}
          pick="remaining"
        />
      </div>

      <div>
        <div className="flex gap-1 overflow-x-auto [scrollbar-width:none] [&::-webkit-scrollbar]:hidden">
          <button
            type="button"
            onClick={() => setBudgetTab('active')}
            className={`relative px-3 py-2 text-sm font-semibold transition-colors ${
              budgetTab === 'active'
                ? 'text-[var(--analytics-budget)] after:absolute after:inset-x-2 after:bottom-0 after:h-0.5 after:rounded-full after:bg-[var(--analytics-budget)]'
                : 'text-slate-500 hover:text-slate-800'
            }`}
          >
            Active
          </button>
          <button
            type="button"
            onClick={() => setBudgetTab('separated')}
            className={`relative px-3 py-2 text-sm font-semibold transition-colors ${
              budgetTab === 'separated'
                ? 'text-[var(--analytics-budget)] after:absolute after:inset-x-2 after:bottom-0 after:h-0.5 after:rounded-full after:bg-[var(--analytics-budget)]'
                : 'text-slate-500 hover:text-slate-800'
            }`}
          >
            Separated
          </button>
          <button
            type="button"
            onClick={() => setBudgetTab('all')}
            className={`relative px-3 py-2 text-sm font-semibold transition-colors ${
              budgetTab === 'all'
                ? 'text-[var(--analytics-budget)] after:absolute after:inset-x-2 after:bottom-0 after:h-0.5 after:rounded-full after:bg-[var(--analytics-budget)]'
                : 'text-slate-500 hover:text-slate-800'
            }`}
          >
            All Budgets
          </button>
        </div>
        <HeaderDivider />
      </div>

      <CompactDataTable<BudgetTableRow>
        title="Budgets"
        description="Manage employee training budgets and planned development activities."
        rows={filteredRows}
        emptyMessage={loading ? 'Loading budgets…' : 'No budget records match your filters.'}
        isLoading={loading}
        sortable
        defaultSort={{ key: 'budgetCode', direction: 'asc' }}
        getSortValue={(row, key) => {
          if (key === 'initialAmount' || key === 'currentAmount' || key === 'remainingAmount') {
            return row[key as keyof BudgetListItem] as number;
          }
          if (key === 'plannedCourseStartDate') {
            return calendarIsoToDate(row.plannedCourseStartDate)?.getTime() ?? 0;
          }
          const value = row[key as keyof BudgetListItem];
          if (typeof value === 'number') return value;
          return String(value ?? '');
        }}
        columns={BUDGET_COLUMNS}
        detailsColumnClassName="w-[72px]"
        mobileSummary={{
          title: (row) => row.budgetCode,
          subtitle: (row) => row.fullName,
          avatarChar: (row) => getInitials(row.fullName),
        }}
        mobileExcludeFromGrid={['budgetCode', 'fullName']}
        actions={
          <>
            {canCreateBudgets ? (
              <>
                <button
                  type="button"
                  onClick={openImportModal}
                  disabled={!orgId}
                  className="inline-flex h-9 shrink-0 items-center gap-2 whitespace-nowrap rounded-xl border border-[var(--primary)] px-3 text-sm font-medium text-[var(--primary)] transition-colors hover:bg-[var(--primary-light)] disabled:opacity-60"
                >
                  <UploadIcon className="h-4 w-4" />
                  Import
                </button>
                <button
                  type="button"
                  onClick={openNewModal}
                  disabled={!orgId}
                  className="inline-flex h-9 shrink-0 items-center gap-2 whitespace-nowrap rounded-xl border border-[var(--primary)] px-3 text-sm font-medium text-[var(--primary)] transition-colors hover:bg-[var(--primary-light)] disabled:opacity-60"
                >
                  <PlusGlyph className="h-4 w-4" />
                  New Budget
                </button>
              </>
            ) : null}
          </>
        }
        toolbar={
          <TableSearchInput
            id="budget-search"
            value={searchTerm}
            onChange={setSearchTerm}
            placeholder="Search budgets…"
          />
        }
        betweenHeaderAndTable={
          <div className="space-y-2 px-4 pb-4 sm:px-6">
            <div className="flex flex-wrap items-end gap-2">
              <div className="min-w-[10rem]">
                <Label htmlFor="budget-date-range" className="sr-only">
                  Date range
                </Label>
                <Select
                  value={dateRangePreset}
                  onValueChange={(v) => setDateRangePreset(v as BudgetDateRangePreset)}
                >
                  <SelectTrigger id="budget-date-range" className="h-9 text-sm">
                    <SelectValue placeholder="Date range" />
                  </SelectTrigger>
                  <SelectContent>
                    {BUDGET_DATE_RANGE_OPTIONS.map((opt) => (
                      <SelectItem key={opt.value} value={opt.value}>
                        {opt.label}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
              {dateRangePreset === 'custom' ? (
                <>
                  <div className="min-w-[9rem]">
                    <Label htmlFor="budget-custom-from" className="text-xs text-slate-600">
                      From
                    </Label>
                    <Input
                      id="budget-custom-from"
                      type="date"
                      value={customRangeFrom}
                      onChange={(e) => setCustomRangeFrom(e.target.value)}
                      className="mt-1 h-9 text-sm"
                    />
                  </div>
                  <div className="min-w-[9rem]">
                    <Label htmlFor="budget-custom-to" className="text-xs text-slate-600">
                      To
                    </Label>
                    <Input
                      id="budget-custom-to"
                      type="date"
                      value={customRangeTo}
                      onChange={(e) => setCustomRangeTo(e.target.value)}
                      className="mt-1 h-9 text-sm"
                    />
                  </div>
                </>
              ) : null}
              <FilterSelect
                id="budget-filter-region"
                label="regions"
                value={filterRegion}
                onChange={setFilterRegion}
                options={filterOptions.regions.map((r) => ({ value: r, label: r }))}
              />
              <FilterSelect
                id="budget-filter-department"
                label="departments"
                value={filterDepartment}
                onChange={setFilterDepartment}
                options={filterOptions.departments.map((d) => ({ value: d, label: d }))}
              />
              <FilterSelect
                id="budget-filter-currency"
                label="currencies"
                value={filterCurrency}
                onChange={setFilterCurrency}
                options={filterOptions.currencies.map((c) => ({ value: c, label: c }))}
              />
            </div>
            {dateRangeError ? (
              <p className="text-sm text-amber-800">{dateRangeError}</p>
            ) : null}
          </div>
        }
        renderCell={(row, key) => {
          if (key === 'fullName') {
            return (
              <div className="flex min-w-0 items-center gap-2">
                <span
                  className="inline-flex h-7 w-7 shrink-0 items-center justify-center rounded-full bg-[var(--primary-light)] text-[11px] font-semibold text-[var(--primary)]"
                  aria-hidden
                >
                  {getInitials(row.fullName)}
                </span>
                <span className="truncate text-[13px] text-slate-900">{row.fullName || '—'}</span>
              </div>
            );
          }
          if (key === 'initialAmount' || key === 'currentAmount' || key === 'remainingAmount') {
            const amount = row[key as 'initialAmount' | 'currentAmount' | 'remainingAmount'];
            return (
              <span className="text-[13px] tabular-nums text-slate-900">
                {formatCurrency(amount, row.currency)}
              </span>
            );
          }
          if (key === 'plannedCourseStartDate') {
            return (
              <span className="text-[13px] text-slate-900">
                {formatDisplayDate(row.plannedCourseStartDate)}
              </span>
            );
          }
          const text = String(row[key as keyof BudgetListItem] ?? '—');
          return <span className="text-[13px] text-slate-900">{text || '—'}</span>;
        }}
        renderDetailsCell={(row) => (
          <RowActionsMenu
            open={menuOpenFor === row.id}
            onOpenChange={(open) => setMenuOpenFor(open ? row.id : null)}
            ariaLabel={`Budget actions for ${row.budgetCode}`}
          >
            {canUpdateBudgets ? (
              <button
                type="button"
                role="menuitem"
                className={menuItemClass}
                onClick={() => {
                  setMenuOpenFor(null);
                  openEditModal(row);
                }}
              >
                Edit Budget
              </button>
            ) : null}
            {canUpdateBudgets ? (
              <button
                type="button"
                role="menuitem"
                className={menuItemClass}
                onClick={() => {
                  setMenuOpenFor(null);
                  openAdjustModal(row);
                }}
              >
                Adjust Budget
              </button>
            ) : null}
            {canUpdateBudgets ? (
              <button
                type="button"
                role="menuitem"
                className={menuItemClass}
                onClick={() => {
                  setMenuOpenFor(null);
                  openReallocateModal(row);
                }}
              >
                Reallocate Budget
              </button>
            ) : null}
            {canReadBudgets ? (
              <button
                type="button"
                role="menuitem"
                className={menuItemClass}
                onClick={() => {
                  setMenuOpenFor(null);
                  openHistoryModal(row);
                }}
              >
                Budget History
              </button>
            ) : null}
          </RowActionsMenu>
        )}
      />

      {listError ? (
        <p className="rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-700">
          {listError}
        </p>
      ) : null}

      <input
        ref={budgetImportInputRef}
        type="file"
        accept=".xlsx,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"
        className="hidden"
        onChange={handleFileSelection}
      />

      <BudgetsImportModal
        isOpen={isImportModalOpen}
        onClose={closeImportModal}
        onDownloadTemplate={handleTemplateDownload}
        onPickFile={() => budgetImportInputRef.current?.click()}
        onImport={() => void handleImportBudgets()}
        pendingImport={pendingBudgetImport}
        stagedFileName={stagedBudgetFileName}
        groupedImportErrors={groupedImportErrors}
        onClearFile={() => {
          if (isValidatingImport || isImporting) return;
          resetImportState();
        }}
        isValidatingImport={isValidatingImport}
        isImporting={isImporting}
        isDragActive={isDragActive}
        onDragEnter={handleDragEnter}
        onDragLeave={handleDragLeave}
        onDragOver={handleDragOver}
        onDrop={handleDrop}
        budgetPreview={budgetPreviewText}
      />

      <Modal
        isOpen={activeModal?.kind === 'new'}
        onClose={closeModal}
        title="New budget"
        subtitle="Allocate training budget for an employee."
        size="lg"
        footer={
          <>
            <Button type="button" variant="secondary" size="sm" onClick={closeModal} disabled={submitting}>
              Cancel
            </Button>
            <Button type="button" size="sm" onClick={() => void submitNewBudget()} disabled={submitting}>
              {submitting ? 'Creating…' : 'Create budget'}
            </Button>
          </>
        }
      >
        {modalError && activeModal?.kind === 'new' ? (
          <p className="mb-3 text-sm text-rose-700">{modalError}</p>
        ) : null}
        <div className="space-y-4">
          <div>
            <Label htmlFor="new-budget-employee">Employee</Label>
            <Select value={newEmployeeId || undefined} onValueChange={setNewEmployeeId}>
              <SelectTrigger id="new-budget-employee" className="mt-1">
                <SelectValue placeholder="Select employee…" />
              </SelectTrigger>
              <SelectContent>
                {[...employees]
                  .sort((a, b) => a.fullName.localeCompare(b.fullName))
                  .map((employee) => (
                    <SelectItem key={employee.id} value={employee.id}>
                      {employee.idNumber} — {employee.fullName}
                      {employee.employmentStatus === 'Inactive' ? ' (Separated)' : ''}
                    </SelectItem>
                  ))}
              </SelectContent>
            </Select>
          </div>

          {selectedNewEmployee ? (
            <div className="grid gap-3 sm:grid-cols-2">
              <ReadOnlyField label="Region" value={selectedNewEmployee.region ?? ''} />
              <ReadOnlyField label="Duty station" value={selectedNewEmployee.dutyStation ?? ''} />
              <ReadOnlyField label="Job location" value={selectedNewEmployee.jobLocation ?? ''} />
              <ReadOnlyField label="Department" value={selectedNewEmployee.department} />
              <ReadOnlyField label="Unit" value={selectedNewEmployee.unit ?? ''} />
              <ReadOnlyField label="Position title" value={selectedNewEmployee.designation} />
            </div>
          ) : null}

          <div>
            <Label htmlFor="new-planned-course">Planned course</Label>
            <Input
              id="new-planned-course"
              value={newPlannedCourse}
              onChange={(e) => setNewPlannedCourse(e.target.value)}
              className="mt-1"
              placeholder="Course name"
            />
          </div>

          <div className="grid gap-3 sm:grid-cols-2">
            <div>
              <Label htmlFor="new-amount">Initial amount</Label>
              <Input
                id="new-amount"
                inputMode="decimal"
                value={newAmount}
                onChange={(e) => setNewAmount(e.target.value)}
                className="mt-1"
                placeholder="0.00"
              />
            </div>
            <div>
              <Label htmlFor="new-currency">Currency</Label>
              <Select value={newCurrency} onValueChange={(v) => setNewCurrency(v as BudgetCurrency)}>
                <SelectTrigger id="new-currency" className="mt-1">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {BUDGET_CURRENCIES.map((c) => (
                    <SelectItem key={c} value={c}>
                      {c}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
          </div>

          <div>
            <Label>Planned course start date</Label>
            <div className="mt-1">
              <DatePicker value={newStartDate} onChange={setNewStartDate} />
            </div>
          </div>
        </div>
      </Modal>

      <Modal
        isOpen={activeModal?.kind === 'edit'}
        onClose={closeModal}
        title="Edit budget details"
        subtitle={
          activeModal?.kind === 'edit'
            ? `${activeModal.budget.budgetCode} · ${activeModal.budget.fullName}`
            : undefined
        }
        size="lg"
        footer={
          <>
            <Button type="button" variant="secondary" size="sm" onClick={closeModal} disabled={submitting}>
              Cancel
            </Button>
            <Button type="button" size="sm" onClick={() => void submitEditBudget()} disabled={submitting}>
              {submitting ? 'Saving…' : 'Save changes'}
            </Button>
          </>
        }
      >
        {modalError && activeModal?.kind === 'edit' ? (
          <p className="mb-3 text-sm text-rose-700">{modalError}</p>
        ) : null}
        {activeModal?.kind === 'edit' ? (
          <div className="space-y-4">
            {activeModal.budget.hasTransactions ? (
              <p className="rounded-lg border border-amber-200 bg-amber-50 px-3 py-2 text-sm text-amber-900">
                This budget has transactions. Initial amount cannot be changed; use Adjust or
                Reallocate to change balances.
              </p>
            ) : null}
            <div>
              <Label htmlFor="edit-planned-course">Planned course</Label>
              <Input
                id="edit-planned-course"
                value={editPlannedCourse}
                onChange={(e) => setEditPlannedCourse(e.target.value)}
                className="mt-1"
              />
            </div>
            <div className="grid gap-3 sm:grid-cols-2">
              <div>
                <Label htmlFor="edit-amount">Initial amount</Label>
                <Input
                  id="edit-amount"
                  inputMode="decimal"
                  value={editAmount}
                  onChange={(e) => setEditAmount(e.target.value)}
                  className="mt-1"
                  disabled={activeModal.budget.hasTransactions}
                />
              </div>
              <div>
                <Label htmlFor="edit-currency">Currency</Label>
                <Select
                  value={editCurrency}
                  onValueChange={(v) => setEditCurrency(v as BudgetCurrency)}
                >
                  <SelectTrigger id="edit-currency" className="mt-1">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    {BUDGET_CURRENCIES.map((c) => (
                      <SelectItem key={c} value={c}>
                        {c}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
            </div>
            <div>
              <Label>Planned course start date</Label>
              <div className="mt-1">
                <DatePicker value={editStartDate} onChange={setEditStartDate} />
              </div>
            </div>
          </div>
        ) : null}
      </Modal>

      <Modal
        isOpen={activeModal?.kind === 'adjust'}
        onClose={closeModal}
        title="Adjust budget"
        subtitle={
          activeModal?.kind === 'adjust'
            ? `${activeModal.budget.budgetCode} · Current ${formatCurrency(activeModal.budget.currentAmount, activeModal.budget.currency)}`
            : undefined
        }
        footer={
          <>
            <Button type="button" variant="secondary" size="sm" onClick={closeModal} disabled={submitting}>
              Cancel
            </Button>
            <Button type="button" size="sm" onClick={() => void submitAdjust()} disabled={submitting}>
              {submitting ? 'Applying…' : 'Apply adjustment'}
            </Button>
          </>
        }
      >
        {modalError && activeModal?.kind === 'adjust' ? (
          <p className="mb-3 text-sm text-rose-700">{modalError}</p>
        ) : null}
        <div className="space-y-4">
          <div>
            <Label htmlFor="adjust-direction">Direction</Label>
            <Select
              value={adjustDirection}
              onValueChange={(v) => setAdjustDirection(v as BudgetAdjustDirection)}
            >
              <SelectTrigger id="adjust-direction" className="mt-1">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="increase">Increase</SelectItem>
                <SelectItem value="decrease">Decrease</SelectItem>
              </SelectContent>
            </Select>
          </div>
          <div>
            <Label htmlFor="adjust-amount">Amount</Label>
            <Input
              id="adjust-amount"
              inputMode="decimal"
              value={adjustAmount}
              onChange={(e) => setAdjustAmount(e.target.value)}
              className="mt-1"
            />
          </div>
          <div>
            <Label htmlFor="adjust-note">Note (optional)</Label>
            <Input
              id="adjust-note"
              value={adjustNote}
              onChange={(e) => setAdjustNote(e.target.value)}
              className="mt-1"
            />
          </div>
        </div>
      </Modal>

      <Modal
        isOpen={activeModal?.kind === 'reallocate'}
        onClose={closeModal}
        title="Reallocate budget"
        subtitle={
          activeModal?.kind === 'reallocate'
            ? `From ${activeModal.budget.budgetCode} · Remaining ${formatCurrency(activeModal.budget.remainingAmount, activeModal.budget.currency)}`
            : undefined
        }
        size="lg"
        footer={
          <>
            <Button type="button" variant="secondary" size="sm" onClick={closeModal} disabled={submitting}>
              Cancel
            </Button>
            <Button
              type="button"
              size="sm"
              onClick={() => void submitReallocate()}
              disabled={submitting}
            >
              {submitting ? 'Reallocating…' : 'Reallocate'}
            </Button>
          </>
        }
      >
        {modalError && activeModal?.kind === 'reallocate' ? (
          <p className="mb-3 text-sm text-rose-700">{modalError}</p>
        ) : null}
        <div className="space-y-4">
          <div>
            <Label htmlFor="reallocate-destination">Destination budget</Label>
            <Select value={reallocateDestinationId || undefined} onValueChange={setReallocateDestinationId}>
              <SelectTrigger id="reallocate-destination" className="mt-1">
                <SelectValue placeholder="Select destination…" />
              </SelectTrigger>
              <SelectContent>
                {reallocateDestinations.map((dest) => (
                  <SelectItem key={dest.id} value={dest.id}>
                    {dest.budgetCode} — {dest.fullName} ({dest.currency})
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          <div>
            <Label htmlFor="reallocate-amount">Amount</Label>
            <Input
              id="reallocate-amount"
              inputMode="decimal"
              value={reallocateAmount}
              onChange={(e) => setReallocateAmount(e.target.value)}
              className="mt-1"
            />
          </div>
          <div>
            <Label htmlFor="reallocate-note">Note (optional)</Label>
            <Input
              id="reallocate-note"
              value={reallocateNote}
              onChange={(e) => setReallocateNote(e.target.value)}
              className="mt-1"
            />
          </div>
        </div>
      </Modal>

      <Modal
        isOpen={activeModal?.kind === 'history'}
        onClose={closeModal}
        title="Budget history"
        subtitle={
          activeModal?.kind === 'history'
            ? `${activeModal.budget.budgetCode} · ${activeModal.budget.fullName}`
            : undefined
        }
        size="xl"
        footer={
          <Button type="button" variant="secondary" size="sm" onClick={closeModal}>
            Close
          </Button>
        }
      >
        {modalError && activeModal?.kind === 'history' ? (
          <p className="mb-3 text-sm text-rose-700">{modalError}</p>
        ) : null}
        {historyLoading ? (
          <p className="text-sm text-slate-600">Loading history…</p>
        ) : historyEntries.length === 0 ? (
          <p className="text-sm text-slate-600">No adjustments or reallocations recorded yet.</p>
        ) : (
          <ul className="divide-y divide-slate-200 rounded-lg border border-slate-200">
            {historyEntries.map((entry) => (
              <li key={entry.id} className="px-4 py-3 text-sm">
                <div className="flex flex-wrap items-start justify-between gap-2">
                  <div>
                    <p className="font-medium text-slate-900">{historyTypeLabel(entry)}</p>
                    <p className="text-slate-600">
                      {new Date(entry.createdAt).toLocaleString()}
                      {entry.performedByName ? ` · ${entry.performedByName}` : ''}
                    </p>
                    {entry.relatedBudgetCode ? (
                      <p className="text-slate-600">Related: {entry.relatedBudgetCode}</p>
                    ) : null}
                    {entry.note ? <p className="mt-1 text-slate-700">{entry.note}</p> : null}
                  </div>
                  <p className="font-semibold tabular-nums text-slate-900">
                    {formatCurrency(entry.amount, entry.currency)}
                  </p>
                </div>
              </li>
            ))}
          </ul>
        )}
      </Modal>
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
