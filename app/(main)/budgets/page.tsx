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
import { useAppAuth } from '@/components/providers/AppProviders';
import { Button } from '@/components/ui/Button';
import { CompactDataTable } from '@/components/ui/compact-employee-table';
import { DatePicker } from '@/components/ui/DatePicker';
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

const BUDGET_COLUMNS: Array<{ key: string; label: string; align?: 'left' | 'right' }> = [
  { key: 'budgetCode', label: 'Budget ID' },
  { key: 'employeeIdNumber', label: 'Employee ID' },
  { key: 'fullName', label: 'Full Name' },
  { key: 'region', label: 'Region' },
  { key: 'dutyStation', label: 'Duty Station' },
  { key: 'jobLocation', label: 'Job Location' },
  { key: 'department', label: 'Department' },
  { key: 'unit', label: 'Unit' },
  { key: 'positionTitle', label: 'Position Title' },
  { key: 'plannedCourse', label: 'Planned Course' },
  { key: 'initialAmount', label: 'Initial', align: 'right' },
  { key: 'currentAmount', label: 'Current', align: 'right' },
  { key: 'remainingAmount', label: 'Remaining', align: 'right' },
  { key: 'currency', label: 'Currency' },
  { key: 'plannedCourseStartDate', label: 'Planned Start' },
];

const ALL_FILTER = '__all__';

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

function planningYearFromIso(iso: string): number | null {
  const y = Number(iso.slice(0, 4));
  return Number.isFinite(y) ? y : null;
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

function historyTypeLabel(entry: BudgetHistoryEntry) {
  if (entry.type === 'adjustment') {
    return entry.direction === 'decrease' ? 'Decrease' : 'Increase';
  }
  if (entry.type === 'reallocation_in') return 'Reallocation in';
  return 'Reallocation out';
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
  const [filterRegion, setFilterRegion] = useState('');
  const [filterDepartment, setFilterDepartment] = useState('');
  const [filterCurrency, setFilterCurrency] = useState('');
  const [filterYear, setFilterYear] = useState('');

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

  const activeEmployees = useMemo(
    () => employees.filter((e) => e.employmentStatus === 'Active'),
    [employees]
  );

  const selectedNewEmployee = useMemo(
    () => activeEmployees.find((e) => e.id === newEmployeeId) ?? null,
    [activeEmployees, newEmployeeId]
  );

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
        if (employeeStore.getActiveEmployees().length === 0) {
          await hydrateEmployeesFromSupabase(supabase, orgId);
        }
      } catch (err) {
        console.error('Failed to hydrate employees for budgets:', err);
        const { data, error } = await supabase
          .from('employees')
          .select('*')
          .eq('org_id', orgId)
          .eq('employment_status', 'active')
          .is('deleted_at', null);
        if (!error && data?.length) {
          const { fetchEmployeesFromSupabase } = await import('@/lib/supabase/employee-db');
          const fetched = await fetchEmployeesFromSupabase(supabase, orgId);
          employeeStore.hydrateFromRemote({ employees: fetched });
        }
      }
    })();
  }, [supabase, orgId]);

  const filterOptions = useMemo(() => {
    const regions = new Set<string>();
    const departments = new Set<string>();
    const currencies = new Set<string>();
    const years = new Set<number>();
    for (const row of budgets) {
      if (row.region) regions.add(row.region);
      if (row.department) departments.add(row.department);
      if (row.currency) currencies.add(row.currency);
      const year = planningYearFromIso(row.plannedCourseStartDate);
      if (year) years.add(year);
    }
    return {
      regions: [...regions].sort((a, b) => a.localeCompare(b)),
      departments: [...departments].sort((a, b) => a.localeCompare(b)),
      currencies: [...currencies].sort((a, b) => a.localeCompare(b)),
      years: [...years].sort((a, b) => b - a),
    };
  }, [budgets]);

  const filteredRows = useMemo(() => {
    const q = deferredSearch.trim().toLowerCase();
    return budgets.filter((row) => {
      if (filterRegion && row.region !== filterRegion) return false;
      if (filterDepartment && row.department !== filterDepartment) return false;
      if (filterCurrency && row.currency !== filterCurrency) return false;
      if (filterYear) {
        const year = planningYearFromIso(row.plannedCourseStartDate);
        if (String(year ?? '') !== filterYear) return false;
      }
      if (!q) return true;
      const haystack = [
        row.budgetCode,
        row.employeeIdNumber,
        row.fullName,
        row.region,
        row.department,
        row.plannedCourse,
        row.currency,
        row.positionTitle,
      ]
        .join(' ')
        .toLowerCase();
      return haystack.includes(q);
    });
  }, [
    budgets,
    deferredSearch,
    filterRegion,
    filterDepartment,
    filterCurrency,
    filterYear,
  ]);

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
      setModalError('Select an active employee.');
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
      <div className="mx-auto max-w-5xl rounded-[18px] border border-slate-200/90 bg-white p-4 shadow-sm sm:p-6">
        <h2 className="text-lg font-semibold text-slate-900">Budgets</h2>
        <p className="mt-2 text-sm text-slate-600">You do not have permission to view budgets.</p>
      </div>
    );
  }

  return (
    <div className="mx-auto max-w-7xl">
      <CompactDataTable<BudgetTableRow>
        title="Budgets"
        description="Manage employee training budget allocations and planned courses."
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
          avatarChar: (row) => row.fullName.trim().charAt(0).toUpperCase() || '?',
        }}
        mobileExcludeFromGrid={['budgetCode', 'fullName']}
        actions={
          <>
            {canCreateBudgets ? (
              <button
                type="button"
                onClick={openNewModal}
                disabled={!orgId}
                className="inline-flex h-9 items-center gap-2 rounded-xl border border-[var(--primary)] px-3 text-sm font-medium text-[var(--primary)] transition-colors hover:bg-[var(--primary-light)] disabled:opacity-60"
              >
                <PlusGlyph className="h-4 w-4" />
                New Budget
              </button>
            ) : null}
            <button
              type="button"
              onClick={() => void reloadBudgets()}
              disabled={loading || !orgId}
              className="inline-flex h-9 items-center gap-2 rounded-xl border border-[var(--primary)] px-3 text-sm font-medium text-[var(--primary)] transition-colors hover:bg-[var(--primary-light)] disabled:opacity-60"
            >
              {loading ? 'Refreshing…' : 'Refresh'}
            </button>
          </>
        }
        toolbar={
          <div className="flex w-full flex-col gap-3 xl:flex-row xl:items-center xl:justify-between">
            <TableSearchInput
              id="budget-search"
              value={searchTerm}
              onChange={setSearchTerm}
              placeholder="Search budgets…"
            />
            <div className="flex flex-wrap items-center gap-2">
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
              <FilterSelect
                id="budget-filter-year"
                label="years"
                value={filterYear}
                onChange={setFilterYear}
                options={filterOptions.years.map((y) => ({
                  value: String(y),
                  label: String(y),
                }))}
              />
            </div>
          </div>
        }
        renderCell={(row, key) => {
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
                Edit
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
                Adjust
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
                Reallocate
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
                History
              </button>
            ) : null}
          </RowActionsMenu>
        )}
      />

      {listError ? (
        <p className="mt-4 rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-700">
          {listError}
        </p>
      ) : null}

      <Modal
        isOpen={activeModal?.kind === 'new'}
        onClose={closeModal}
        title="New budget"
        subtitle="Allocate training budget for an active employee."
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
            <Label htmlFor="new-budget-employee">Active employee</Label>
            <Select value={newEmployeeId || undefined} onValueChange={setNewEmployeeId}>
              <SelectTrigger id="new-budget-employee" className="mt-1">
                <SelectValue placeholder="Select employee…" />
              </SelectTrigger>
              <SelectContent>
                {[...activeEmployees]
                  .sort((a, b) => a.fullName.localeCompare(b.fullName))
                  .map((employee) => (
                    <SelectItem key={employee.id} value={employee.id}>
                      {employee.idNumber} — {employee.fullName}
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
