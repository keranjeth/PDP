'use client';

import Link from 'next/link';
import { useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import { HeaderDivider } from '@/components/ui/HeaderDivider';
import type { DashboardEmployeeRow } from '@/lib/dashboard';
import { buildEmployeeProfileHref } from '@/lib/employee-information';

export type CompactEmployeeSortKey =
  | 'idNumber'
  | 'fullName'
  | 'designation'
  | 'department'
  | 'region'
  | 'employmentStatus';

type CompactEmployeeSortState = {
  key: CompactEmployeeSortKey;
  direction: 'asc' | 'desc';
};

function getAvatarInitial(name: string) {
  return name.trim().charAt(0).toUpperCase() || '?';
}

export function toTitleCaseLabel(label: string) {
  const titled = label
    .toLowerCase()
    .replace(/\b\w/g, (character) => character.toUpperCase());
  // Preserve "ID" acronym casing (e.g. "ID Number" not "Id Number")
  return titled.replace(/\bId\b/g, 'ID');
}

function useResettablePageIndex(resetKey: string) {
  const [state, setState] = useState({ resetKey, pageIndex: 0 });
  const pageIndex = state.resetKey === resetKey ? state.pageIndex : 0;
  const setPageIndex = (value: number | ((prev: number) => number)) => {
    setState((prev) => {
      const currentIndex = prev.resetKey === resetKey ? prev.pageIndex : 0;
      const nextIndex = typeof value === 'function' ? value(currentIndex) : value;
      return { resetKey, pageIndex: nextIndex };
    });
  };
  return [pageIndex, setPageIndex] as const;
}

function SortGlyph({
  active,
  direction,
}: {
  active: boolean;
  direction: 'asc' | 'desc';
}) {
  return (
    <span className={`text-[10px] ${active ? 'text-[var(--primary)]' : 'text-slate-300'}`}>
      {direction === 'asc' ? '\u25B2' : '\u25BC'}
    </span>
  );
}

/** Same chrome as {@link CompactEmployeeTable}: header, toolbar/actions, sortable table, mobile cards, pagination. */
export function CompactDataTable<T extends { id: string }>({
  title,
  description,
  rows,
  emptyMessage,
  actions,
  toolbar,
  headerContent,
  columns,
  sortable = false,
  defaultSort,
  getSortValue,
  renderCell,
  renderDetailsCell,
  detailsHeaderLabel = 'Details',
  columnWidthClass,
  mobileSummary,
  mobileExcludeFromGrid,
  isLoading,
  embedded = false,
  hideTitleBlock = false,
  betweenHeaderAndTable,
  rowSelection,
  getRowSelectionLabel,
  detailsColumnClassName,
  hidePagination = false,
  showEmptyHeaders = false,
}: {
  title: string;
  description: string;
  rows: T[];
  emptyMessage: string;
  actions?: ReactNode;
  toolbar?: ReactNode;
  /**
   * When set, replaces the default title/toolbar/actions header chrome.
   * Other pages keep the default layout when this prop is omitted.
   */
  headerContent?: ReactNode;
  columns: Array<{ key: string; label: string; align?: 'left' | 'right' }>;
  sortable?: boolean;
  defaultSort?: { key: string; direction: 'asc' | 'desc' };
  getSortValue?: (row: T, key: string) => string | number | Date;
  renderCell: (row: T, columnKey: string) => ReactNode;
  renderDetailsCell?: (row: T) => ReactNode;
  detailsHeaderLabel?: string;
  /** Width class for the trailing column (default compact `w-[72px]`). Use `min-w-0` for equal table columns. */
  detailsColumnClassName?: string;
  columnWidthClass?: (key: string) => string;
  /** When set, mobile card header matches employee-style avatar + title + subtitle. */
  mobileSummary?: {
    title: (row: T) => string;
    subtitle: (row: T) => string;
    avatarChar: (row: T) => string;
  };
  /** Column keys omitted from the mobile grid (shown in the card header instead). */
  mobileExcludeFromGrid?: string[];
  isLoading?: boolean;
  /** Omit outer card border/shadow when nested inside another panel. */
  embedded?: boolean;
  /** Hide title + description (e.g. when the parent panel already shows them). */
  hideTitleBlock?: boolean;
  /** Renders between the toolbar header and the table (e.g. bulk-delete controls). */
  betweenHeaderAndTable?: ReactNode;
  rowSelection?: {
    selectedIds: Set<string>;
    onToggleRow: (rowId: string) => void;
    onToggleAllVisible: (select: boolean, visibleRowIds: string[]) => void;
    /** `single` hides the header “select all” control; only one row should be selected. */
    mode?: 'multi' | 'single';
  };
  getRowSelectionLabel?: (row: T) => string;
  /** When true, all rows render and the pagination footer is omitted. */
  hidePagination?: boolean;
  /** Keep the table's column labels visible before the first record is added. */
  showEmptyHeaders?: boolean;
}) {
  const detailsColClass = detailsColumnClassName ?? 'w-[72px]';
  const firstKey = columns[0]?.key ?? 'id';
  const [sortState, setSortState] = useState<{ key: string; direction: 'asc' | 'desc' }>(
    defaultSort ?? { key: firstKey, direction: 'asc' }
  );
  const [pageSize, setPageSize] = useState<number>(25);

  const displayRows = useMemo(() => {
    if (!sortable || !getSortValue) {
      return rows;
    }

    return [...rows].sort((left, right) => {
      const leftRaw = getSortValue(left, sortState.key);
      const rightRaw = getSortValue(right, sortState.key);

      const toNum = (v: string | number | Date) => {
        if (v instanceof Date) return v.getTime();
        if (typeof v === 'number') return v;
        const n = Number(v);
        return Number.isFinite(n) ? n : NaN;
      };

      const ln = toNum(leftRaw);
      const rn = toNum(rightRaw);
      if (!Number.isNaN(ln) && !Number.isNaN(rn)) {
        return sortState.direction === 'asc' ? ln - rn : rn - ln;
      }

      const comparison = String(leftRaw).localeCompare(String(rightRaw), undefined, {
        sensitivity: 'base',
        numeric: true,
      });

      return sortState.direction === 'asc' ? comparison : -comparison;
    });
  }, [rows, sortable, sortState, getSortValue]);

  const rowsIdentity = useMemo(
    () => `${rows.length}:${rows.map((r) => r.id).join(',')}`,
    [rows]
  );

  const paginationResetKey = `${pageSize}|${sortState.key}|${sortState.direction}|${rowsIdentity}`;
  const [pageIndex, setPageIndex] = useResettablePageIndex(paginationResetKey);

  const totalRecords = displayRows.length;
  const isAll = hidePagination || pageSize === Number.POSITIVE_INFINITY;
  const effectivePageSize = isAll ? Math.max(totalRecords, 1) : pageSize;
  const totalPages = Math.max(1, Math.ceil(totalRecords / effectivePageSize));
  const safePageIndex = Math.min(pageIndex, totalPages - 1);
  const pageStart = safePageIndex * effectivePageSize;
  const pageEndExclusive = Math.min(pageStart + effectivePageSize, totalRecords);
  const pagedRows = isAll ? displayRows : displayRows.slice(pageStart, pageEndExclusive);
  const showingFrom = totalRecords === 0 ? 0 : pageStart + 1;
  const showingTo = pageEndExclusive;

  const handleSort = (key: string) => {
    if (!sortable) {
      return;
    }

    setSortState((current) => ({
      key,
      direction:
        current.key === key && current.direction === 'asc' ? 'desc' : 'asc',
    }));
  };

  const widthFor = columnWidthClass ?? (() => '');
  const excludeMobile = new Set(mobileExcludeFromGrid ?? []);
  const mobileColumns = columns.filter((column) => !excludeMobile.has(column.key));

  const paginationPages = useMemo(() => {
    if (isAll || totalPages <= 1) return [];
    const pages = new Set<number>();
    pages.add(0);
    pages.add(totalPages - 1);
    pages.add(safePageIndex);
    pages.add(safePageIndex - 1);
    pages.add(safePageIndex + 1);
    const list = [...pages].filter((p) => p >= 0 && p < totalPages).sort((a, b) => a - b);
    const withGaps: Array<number | 'gap'> = [];
    for (let i = 0; i < list.length; i += 1) {
      const p = list[i]!;
      const prev = withGaps[withGaps.length - 1];
      if (typeof prev === 'number' && p - prev > 1) {
        withGaps.push('gap');
      }
      withGaps.push(p);
    }
    return withGaps;
  }, [isAll, totalPages, safePageIndex]);

  const visibleRowIds = useMemo(() => pagedRows.map((r) => r.id), [pagedRows]);
  const selectionMode = rowSelection?.mode ?? 'multi';
  const selectionHeaderRef = useRef<HTMLInputElement>(null);
  useEffect(() => {
    const el = selectionHeaderRef.current;
    if (!el || !rowSelection || selectionMode === 'single') {
      return;
    }
    const n = visibleRowIds.filter((id) => rowSelection.selectedIds.has(id)).length;
    el.indeterminate = n > 0 && n < visibleRowIds.length;
  }, [rowSelection, visibleRowIds, selectionMode]);

  const allVisibleSelected =
    rowSelection &&
    selectionMode !== 'single' &&
    visibleRowIds.length > 0 &&
    visibleRowIds.every((id) => rowSelection.selectedIds.has(id));

  const rowLabel = getRowSelectionLabel ?? (() => 'row');

  return (
    <section
      className={
        embedded
          ? 'overflow-hidden rounded-t-lg bg-white'
          : 'overflow-hidden rounded-2xl border border-slate-200 bg-white shadow-sm'
      }
    >
      {headerContent ? (
        <div className="px-4 py-4 sm:px-6">{headerContent}</div>
      ) : (
        <div
          className={`flex flex-col gap-4 px-4 py-5 sm:px-6 sm:py-6 lg:flex-row lg:items-center ${
            hideTitleBlock ? 'lg:justify-end' : 'lg:justify-between'
          }`}
        >
          {!hideTitleBlock ? (
            <div className="min-w-0">
              <h3 className="text-[18px] font-semibold text-slate-950">{title}</h3>
              <p className="mt-1 text-sm text-slate-500">{description}</p>
            </div>
          ) : null}
          {toolbar || actions ? (
            <div className="flex w-full flex-col gap-3 lg:w-auto lg:flex-row lg:items-center">
              {toolbar ? <div className="w-full lg:w-auto">{toolbar}</div> : null}
              {actions ? (
                <div className="flex flex-col gap-3 sm:flex-row sm:flex-wrap lg:flex-nowrap">
                  {actions}
                </div>
              ) : null}
            </div>
          ) : null}
        </div>
      )}

      <HeaderDivider />

      {betweenHeaderAndTable}

      {isLoading ? (
        <div className="px-4 py-10 text-center text-sm text-slate-500 sm:px-6 sm:py-12">Loading…</div>
      ) : displayRows.length === 0 && !showEmptyHeaders ? (
        <div className="px-4 py-10 text-center text-sm text-slate-500 sm:px-6 sm:py-12">
          {emptyMessage}
        </div>
      ) : (
        <div className={embedded ? 'overflow-hidden' : ''}>
          <div className="overflow-x-auto">
            <table className="hidden w-full table-fixed text-sm md:table">
            <thead className="relative z-10 border-b border-slate-200 bg-slate-50/80">
              <tr>
                {rowSelection ? (
                  <th className="w-10 px-2 py-1.5 text-center text-[13px] font-semibold text-slate-900">
                    {selectionMode === 'single' ? (
                      <span className="sr-only">Select one row</span>
                    ) : (
                      <input
                        ref={selectionHeaderRef}
                        type="checkbox"
                        className="h-3.5 w-3.5 rounded border-slate-300 accent-[var(--primary)] text-[var(--primary)]"
                        checked={allVisibleSelected}
                        onChange={(e) =>
                          rowSelection.onToggleAllVisible(e.target.checked, visibleRowIds)
                        }
                        aria-label="Select all visible rows"
                      />
                    )}
                  </th>
                ) : null}
                {columns.map((column) => (
                  <th
                    key={column.key}
                    className={`px-4 py-1.5 text-left text-[13px] font-semibold text-slate-900 ${
                      column.align === 'right' ? 'text-right' : ''
                    } ${widthFor(column.key)}`}
                  >
                    <button
                      type="button"
                      onClick={() => handleSort(column.key)}
                      className={`inline-flex items-center gap-1.5 ${
                        sortable ? 'transition-colors hover:text-slate-700' : 'cursor-default'
                      } ${column.align === 'right' ? 'justify-end' : ''}`}
                    >
                      <span className="whitespace-nowrap">{toTitleCaseLabel(column.label)}</span>
                      {sortable ? (
                        <SortGlyph
                          active={sortState.key === column.key}
                          direction={sortState.direction}
                        />
                      ) : null}
                    </button>
                  </th>
                ))}
                {renderDetailsCell ? (
                  <th
                    className={`px-4 py-1.5 text-right text-[13px] font-semibold text-slate-900 whitespace-nowrap ${detailsColClass}`}
                  >
                    {toTitleCaseLabel(detailsHeaderLabel)}
                  </th>
                ) : null}
              </tr>
            </thead>

            <tbody className="bg-white">
              {displayRows.length === 0 ? <tr><td colSpan={columns.length + (renderDetailsCell ? 1 : 0) + (rowSelection ? 1 : 0)} className="px-4 py-10 text-center text-sm text-slate-500">{emptyMessage}</td></tr> : null}
              {pagedRows.map((row, index) => (
                <tr
                  key={row.id}
                  className={`border-b border-slate-200 last:border-b-0 hover:bg-[var(--primary-light)]/40 ${
                    index % 2 === 0 ? 'bg-white' : 'bg-slate-50/20'
                  }`}
                >
                  {rowSelection ? (
                    <td className="px-2 py-1.5 text-center">
                      <input
                        type="checkbox"
                        className="h-3.5 w-3.5 rounded border-slate-300 accent-[var(--primary)] text-[var(--primary)]"
                        checked={rowSelection.selectedIds.has(row.id)}
                        onChange={() => rowSelection.onToggleRow(row.id)}
                        aria-label={`Select ${rowLabel(row)}`}
                      />
                    </td>
                  ) : null}
                  {columns.map((column) => (
                    <td
                      key={column.key}
                      className={`px-4 py-1.5 ${column.align === 'right' ? 'text-right' : ''}`}
                    >
                      {renderCell(row, column.key)}
                    </td>
                  ))}
                  {renderDetailsCell ? (
                    <td className={`px-4 py-1.5 text-right ${detailsColClass}`}>{renderDetailsCell(row)}</td>
                  ) : null}
                </tr>
              ))}
            </tbody>
          </table>
          </div>

          <div className="space-y-3 p-4 md:hidden">
            {displayRows.length === 0 ? <p className="py-6 text-center text-sm text-slate-500">{emptyMessage}</p> : null}
            {pagedRows.map((row) => (
              <div
                key={row.id}
                className="rounded-lg border border-slate-200 bg-slate-50/20 p-4 hover:bg-[var(--primary-light)]/40"
              >
                <div className="flex items-start justify-between gap-3">
                  {rowSelection ? (
                    <input
                      type="checkbox"
                      className="mt-1 h-4 w-4 shrink-0 rounded border-slate-300 accent-[var(--primary)] text-[var(--primary)]"
                      checked={rowSelection.selectedIds.has(row.id)}
                      onChange={() => rowSelection.onToggleRow(row.id)}
                      aria-label={`Select ${rowLabel(row)}`}
                    />
                  ) : null}
                  {mobileSummary ? (
                    <div className="flex min-w-0 flex-1 items-center gap-2.5">
                      <div className="flex h-8 w-8 items-center justify-center rounded-full bg-[var(--primary-light)] text-sm font-semibold text-[var(--primary)]">
                        {mobileSummary.avatarChar(row)}
                      </div>
                      <div className="min-w-0">
                        <p className="truncate text-sm text-slate-900">{mobileSummary.title(row)}</p>
                        <p className="text-xs text-slate-500">{mobileSummary.subtitle(row)}</p>
                      </div>
                    </div>
                  ) : null}

                  <div className="shrink-0">
                    {renderDetailsCell ? renderDetailsCell(row) : null}
                  </div>
                </div>

                {mobileColumns.length > 0 ? (
                  <div className="mt-3 grid grid-cols-1 gap-3 text-sm min-[420px]:grid-cols-2">
                    {mobileColumns.map((column) => (
                      <div key={column.key}>
                        <p className="text-[11px] uppercase tracking-[0.08em] text-slate-500">
                          {toTitleCaseLabel(column.label)}
                        </p>
                        <div className="mt-0.5 text-slate-900">{renderCell(row, column.key)}</div>
                      </div>
                    ))}
                  </div>
                ) : null}
              </div>
            ))}
          </div>

          {hidePagination ? null : (
            <div className="border-t border-slate-200 bg-white px-4 py-3 text-sm text-slate-600 sm:px-6">
              <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
                <div className="flex flex-wrap items-center gap-3">
                  <span className="text-sm text-slate-600">
                    Showing {showingFrom} to {showingTo} of {totalRecords} records
                  </span>
                  <label className="flex items-center gap-2 text-sm text-slate-600">
                    <span className="text-slate-500">Rows</span>
                    <select
                      value={isAll ? 'all' : String(pageSize)}
                      onChange={(e) => {
                        const v = e.target.value;
                        setPageSize(v === 'all' ? Number.POSITIVE_INFINITY : Number(v));
                      }}
                      className="h-8 rounded-lg border border-slate-200 bg-white px-2 text-sm text-slate-700 outline-none focus:border-[var(--primary)]"
                    >
                      <option value="25">25</option>
                      <option value="50">50</option>
                      <option value="100">100</option>
                      <option value="all">All</option>
                    </select>
                  </label>
                </div>

                <div className="flex items-center justify-end gap-1.5">
                  <button
                    type="button"
                    disabled={isAll || safePageIndex === 0}
                    onClick={() => setPageIndex((p) => Math.max(0, p - 1))}
                    className="h-8 rounded-lg border border-slate-200 bg-white px-3 text-sm text-slate-700 transition-colors hover:bg-slate-50 disabled:opacity-40"
                  >
                    Prev
                  </button>
                  {!isAll && totalPages > 1 ? (
                    <div className="hidden items-center gap-1 sm:flex">
                      {paginationPages.map((p, idx) =>
                        p === 'gap' ? (
                          <span key={`gap-${idx}`} className="px-1.5 text-slate-400">
                            …
                          </span>
                        ) : (
                          <button
                            key={p}
                            type="button"
                            onClick={() => setPageIndex(p)}
                            className={`h-8 min-w-8 rounded-lg border px-2 text-sm transition-colors ${
                              p === safePageIndex
                                ? 'border-[var(--primary)] bg-[var(--primary-light)] text-[var(--primary)]'
                                : 'border-slate-200 bg-white text-slate-700 hover:bg-slate-50'
                            }`}
                          >
                            {p + 1}
                          </button>
                        )
                      )}
                    </div>
                  ) : null}
                  <button
                    type="button"
                    disabled={isAll || safePageIndex >= totalPages - 1}
                    onClick={() => setPageIndex((p) => Math.min(totalPages - 1, p + 1))}
                    className="h-8 rounded-lg border border-slate-200 bg-white px-3 text-sm text-slate-700 transition-colors hover:bg-slate-50 disabled:opacity-40"
                  >
                    Next
                  </button>
                </div>
              </div>
            </div>
          )}
        </div>
      )}
    </section>
  );
}

export function CompactEmployeeTable<
  T extends { id: string; fullName: string; idNumber?: string },
>({
  title,
  description,
  rows,
  emptyMessage,
  amountLabel: _amountLabel,
  actions,
  toolbar,
  columnsOverride,
  detailsHeaderLabel,
  renderCell,
  renderDetailsCell,
  hideDetailsColumn = false,
  sortable = false,
  defaultSort,
  /** `?tab=` for employee profile; default Overview → Personal tab. Pass `null` to omit query (profile default). */
  profileTab = 'Overview',
  /** When set, shows a leading checkbox column for bulk actions (e.g. offboarding). */
  rowSelection,
  onDisplayRowsChange,
}: {
  title: string;
  description: string;
  rows: T[];
  emptyMessage: string;
  amountLabel?: string;
  actions?: React.ReactNode;
  toolbar?: React.ReactNode;
  /** Optional custom columns to reuse this table chrome for other modules (User Management). */
  columnsOverride?: Array<{ key: string; label: string; align?: 'left' | 'right' }>;
  detailsHeaderLabel?: string;
  renderCell?: (row: T, columnKey: string) => React.ReactNode;
  renderDetailsCell?: (row: T) => React.ReactNode;
  /** When true, omit the trailing details/eye column (e.g. User Management uses Actions instead). */
  hideDetailsColumn?: boolean;
  sortable?: boolean;
  defaultSort?: CompactEmployeeSortState;
  profileTab?: string | null;
  rowSelection?: {
    selectedIds: Set<string>;
    onToggleRow: (rowId: string) => void;
    onToggleAllVisible: (select: boolean, visibleRowIds: string[]) => void;
  };
  /** Full sorted row set (all pages) for export and similar actions. */
  onDisplayRowsChange?: (rows: T[]) => void;
}) {
  void _amountLabel;
  const [sortState, setSortState] = useState<CompactEmployeeSortState>(
    defaultSort ?? { key: 'idNumber', direction: 'asc' }
  );
  const [pageSize, setPageSize] = useState<number>(25);

  const displayRows = useMemo(() => {
    if (!sortable) {
      return rows;
    }

    return [...rows].sort((left, right) => {
      const leftValue = (left as Record<string, string | number | undefined>)[sortState.key];
      const rightValue = (right as Record<string, string | number | undefined>)[sortState.key];

      if (typeof leftValue === 'number' && typeof rightValue === 'number') {
        return sortState.direction === 'asc'
          ? leftValue - rightValue
          : rightValue - leftValue;
      }

      const comparison = String(leftValue).localeCompare(String(rightValue), undefined, {
        sensitivity: 'base',
        numeric: true,
      });

      return sortState.direction === 'asc' ? comparison : -comparison;
    });
  }, [rows, sortable, sortState]);

  useEffect(() => {
    onDisplayRowsChange?.(displayRows);
  }, [displayRows, onDisplayRowsChange]);

  const rowsIdentity = useMemo(
    () => `${rows.length}:${rows.map((r) => r.id).join(',')}`,
    [rows]
  );

  const paginationResetKey = `${pageSize}|${sortState.key}|${sortState.direction}|${rowsIdentity}`;
  const [pageIndex, setPageIndex] = useResettablePageIndex(paginationResetKey);

  const totalRecords = displayRows.length;
  const isAll = pageSize === Number.POSITIVE_INFINITY;
  const effectivePageSize = isAll ? Math.max(totalRecords, 1) : pageSize;
  const totalPages = Math.max(1, Math.ceil(totalRecords / effectivePageSize));
  const safePageIndex = Math.min(pageIndex, totalPages - 1);
  const pageStart = safePageIndex * effectivePageSize;
  const pageEndExclusive = Math.min(pageStart + effectivePageSize, totalRecords);
  const pagedRows = isAll ? displayRows : displayRows.slice(pageStart, pageEndExclusive);
  const showingFrom = totalRecords === 0 ? 0 : pageStart + 1;
  const showingTo = pageEndExclusive;

  const handleSort = (key: CompactEmployeeSortKey) => {
    if (!sortable) {
      return;
    }

    setSortState((current) => ({
      key,
      direction:
        current.key === key && current.direction === 'asc' ? 'desc' : 'asc',
    }));
  };

  const columns: Array<{ key: string; label: string; align?: 'left' | 'right' }> =
    columnsOverride ?? [
      { key: 'idNumber', label: 'ID NUMBER' },
      { key: 'fullName', label: 'FULL NAME' },
      { key: 'designation', label: 'DESIGNATION' },
      { key: 'department', label: 'DEPARTMENT' },
      { key: 'region', label: 'REGION' },
    ];

  const detailsHeader = detailsHeaderLabel ?? 'Details';
  const showDetailsColumn = !hideDetailsColumn;

  const visibleRowIds = useMemo(() => pagedRows.map((r) => r.id), [pagedRows]);
  const visibleRowKey = visibleRowIds.join('\n');
  const selectedVisibleCount = rowSelection
    ? visibleRowIds.reduce(
        (count, id) => count + (rowSelection.selectedIds.has(id) ? 1 : 0),
        0
      )
    : 0;
  const selectionHeaderRef = useRef<HTMLInputElement>(null);
  useEffect(() => {
    const el = selectionHeaderRef.current;
    if (!el || !rowSelection) {
      return;
    }
    el.indeterminate = selectedVisibleCount > 0 && selectedVisibleCount < visibleRowIds.length;
  }, [selectedVisibleCount, visibleRowKey, visibleRowIds.length, rowSelection]);

  const allVisibleSelected =
    rowSelection &&
    visibleRowIds.length > 0 &&
    visibleRowIds.every((id) => rowSelection.selectedIds.has(id));

  const cellRenderer =
    renderCell ??
    ((row: T, key: string) => {
      const emp = row as unknown as DashboardEmployeeRow;
      if (key === 'idNumber') {
        return <span className="text-[13px] text-slate-900">{emp.idNumber}</span>;
      }
      if (key === 'fullName') {
        return (
          <div className="flex items-center gap-2">
            <div className="flex h-5 w-5 items-center justify-center rounded-full bg-[var(--primary-light)] text-[10px] font-semibold text-[var(--primary)]">
              {getAvatarInitial(emp.fullName)}
            </div>
            <span className="min-w-0 truncate text-[13px] text-slate-900" title={emp.fullName}>
              {emp.fullName}
            </span>
          </div>
        );
      }
      if (key === 'designation') {
        return <span className="text-[13px] text-slate-900">{emp.designation || '-'}</span>;
      }
      if (key === 'department') {
        return <span className="text-[13px] text-slate-900">{emp.department || '-'}</span>;
      }
      if (key === 'region') {
        return <span className="text-[13px] text-slate-900">{emp.region || '-'}</span>;
      }
      if (key === 'employmentStatus') {
        const status = emp.employmentStatus || '—';
        return (
          <span
            className={`inline-flex items-center rounded-full px-2 py-0.5 text-[11px] font-semibold ${
              status === 'Active'
                ? 'bg-[var(--primary-light)] text-[var(--primary)]'
                : status === 'Inactive'
                  ? 'bg-rose-50 text-rose-700'
                  : 'bg-slate-50 text-slate-500'
            }`}
          >
            {status}
          </span>
        );
      }
      return <span className="text-[13px] text-slate-900">-</span>;
    });

  const detailsRenderer =
    renderDetailsCell ??
    ((row: T) => {
      const emp = row as unknown as DashboardEmployeeRow;
      return (
        <Link
          href={buildEmployeeProfileHref(emp.id, profileTab)}
          className="inline-flex h-5 w-5 items-center justify-center rounded-full text-[var(--primary)] transition-colors hover:bg-[var(--primary-light)]"
          aria-label={`View details for ${emp.fullName}`}
        >
          <EyeIcon className="h-3.5 w-3.5" />
        </Link>
      );
    });

  const mobileColumns = columns.filter(
    (column) => column.key !== 'idNumber' && column.key !== 'fullName' && column.key !== 'actions'
  );
  const mobileActionsColumn = columns.find((column) => column.key === 'actions');

  const columnWidthClass = (key: string) => {
    if (key === 'idNumber') return 'w-[110px]';
    // Let the primary text column absorb remaining width to avoid blank right side.
    if (key === 'fullName') return 'w-[30%] min-w-[220px]';
    if (key === 'designation') return 'w-[180px]';
    if (key === 'department') return 'w-[150px]';
    if (key === 'region') return 'w-[120px]';
    if (key === 'employmentStatus') return 'w-[110px]';
    if (key === 'actions') return 'w-[120px]';
    return '';
  };

  const paginationPages = useMemo(() => {
    if (isAll || totalPages <= 1) return [];
    const pages = new Set<number>();
    pages.add(0);
    pages.add(totalPages - 1);
    pages.add(safePageIndex);
    pages.add(safePageIndex - 1);
    pages.add(safePageIndex + 1);
    const list = [...pages].filter((p) => p >= 0 && p < totalPages).sort((a, b) => a - b);
    const withGaps: Array<number | 'gap'> = [];
    for (let i = 0; i < list.length; i += 1) {
      const p = list[i]!;
      const prev = withGaps[withGaps.length - 1];
      if (typeof prev === 'number' && p - prev > 1) {
        withGaps.push('gap');
      }
      withGaps.push(p);
    }
    return withGaps;
  }, [isAll, totalPages, safePageIndex]);

  const headerActions = <>{actions}</>;
  const hasHeaderControls = Boolean(toolbar || actions);

  return (
    <section className="overflow-hidden rounded-2xl border border-slate-200 bg-white shadow-sm">
      <div className="flex flex-col gap-4 px-4 py-4 sm:px-6">
        <div className="min-w-0">
          <h3 className="text-[18px] font-semibold text-slate-950">{title}</h3>
          <p className="mt-1 text-sm text-slate-500">{description}</p>
        </div>
        {hasHeaderControls ? (
          <div className="flex w-full min-w-0 flex-wrap items-center gap-x-3 gap-y-3">
            {toolbar ? <div className="min-w-0 shrink-0">{toolbar}</div> : null}
            {actions ? (
              <div className="ml-auto flex min-w-0 flex-wrap items-center justify-end gap-2">
                {headerActions}
              </div>
            ) : null}
          </div>
        ) : null}
      </div>

      <HeaderDivider />

      {displayRows.length === 0 ? (
        <div className="px-4 py-10 text-center text-sm text-slate-500 sm:px-6 sm:py-12">
          {emptyMessage}
        </div>
      ) : (
        <>
        <div className="overflow-x-auto">
          <table className="hidden w-full table-fixed text-sm md:table">
            <thead className="relative z-10 border-b border-slate-200 bg-slate-50/80">
              <tr>
                {rowSelection ? (
                  <th className="w-10 px-2 py-1.5 text-center text-[13px] font-semibold text-slate-900">
                    <input
                      ref={selectionHeaderRef}
                      type="checkbox"
                      className="h-3.5 w-3.5 rounded border-slate-300 accent-[var(--primary)] text-[var(--primary)]"
                      checked={allVisibleSelected}
                      onChange={(e) =>
                        rowSelection.onToggleAllVisible(e.target.checked, visibleRowIds)
                      }
                      aria-label="Select all visible employees"
                    />
                  </th>
                ) : null}
                {columns.map((column) => (
                  <th
                    key={column.key}
                    className={`px-4 py-1.5 text-left text-[13px] font-semibold text-slate-900 ${
                      column.align === 'right' ? 'text-right' : ''
                    } ${columnWidthClass(column.key)}`}
                  >
                    <button
                      type="button"
                      onClick={() => handleSort(column.key as CompactEmployeeSortKey)}
                      className={`inline-flex items-center gap-1.5 ${
                        sortable ? 'transition-colors hover:text-slate-700' : 'cursor-default'
                      } ${column.align === 'right' ? 'justify-end' : ''}`}
                    >
                      <span className="whitespace-nowrap">{toTitleCaseLabel(column.label)}</span>
                      {sortable ? (
                        <SortGlyph
                          active={sortState.key === (column.key as CompactEmployeeSortKey)}
                          direction={sortState.direction}
                        />
                      ) : null}
                    </button>
                  </th>
                ))}
                {showDetailsColumn ? (
                  <th className="w-[72px] px-4 py-1.5 text-right text-[13px] font-semibold text-slate-900 whitespace-nowrap">
                    {detailsHeader}
                  </th>
                ) : null}
              </tr>
            </thead>

            <tbody className="bg-white">
              {pagedRows.map((row, index) => (
                <tr
                  key={row.id}
                  className={`border-b border-slate-200 last:border-b-0 hover:bg-[var(--primary-light)]/40 ${
                    index % 2 === 0 ? 'bg-white' : 'bg-slate-50/20'
                  }`}
                >
                  {rowSelection ? (
                    <td className="px-2 py-1.5 text-center">
                      <input
                        type="checkbox"
                        className="h-3.5 w-3.5 rounded border-slate-300 accent-[var(--primary)] text-[var(--primary)]"
                        checked={rowSelection.selectedIds.has(row.id)}
                        onChange={() => rowSelection.onToggleRow(row.id)}
                        aria-label={`Select ${row.fullName}`}
                      />
                    </td>
                  ) : null}
                  {columns.map((column) => (
                    <td
                      key={column.key}
                      className={`px-4 py-1.5 ${column.align === 'right' ? 'text-right' : ''}`}
                    >
                      {cellRenderer(row, column.key)}
                    </td>
                  ))}
                  {showDetailsColumn ? (
                    <td className="px-4 py-1.5 text-right">{detailsRenderer(row)}</td>
                  ) : null}
                </tr>
              ))}
            </tbody>
          </table>
        </div>

          <div className="space-y-3 p-4 md:hidden">
            {pagedRows.map((row) => (
              <div
                key={row.id}
                className="rounded-lg border border-slate-200 bg-slate-50/20 p-4 hover:bg-[var(--primary-light)]/40"
              >
                <div className="flex items-start justify-between gap-3">
                  {rowSelection ? (
                    <input
                      type="checkbox"
                      className="mt-1 h-4 w-4 shrink-0 rounded border-slate-300 accent-[var(--primary)] text-[var(--primary)]"
                      checked={rowSelection.selectedIds.has(row.id)}
                      onChange={() => rowSelection.onToggleRow(row.id)}
                      aria-label={`Select ${row.fullName}`}
                    />
                  ) : null}
                  <div className="flex min-w-0 flex-1 items-center gap-2.5">
                    <div className="flex h-8 w-8 items-center justify-center rounded-full bg-[var(--primary-light)] text-sm font-semibold text-[var(--primary)]">
                      {getAvatarInitial(row.fullName)}
                    </div>
                    <div className="min-w-0">
                      <p className="truncate text-sm text-slate-900">
                        {row.fullName}
                      </p>
                      <p className="text-xs text-slate-500">{row.idNumber}</p>
                    </div>
                  </div>

                  {showDetailsColumn ? (
                    <div className="shrink-0">{detailsRenderer(row)}</div>
                  ) : null}
                </div>

                {mobileColumns.length > 0 ? (
                  <div className="mt-3 grid grid-cols-1 gap-3 text-sm min-[420px]:grid-cols-2">
                    {mobileColumns.map((column) => (
                      <div key={column.key}>
                        <p className="text-[11px] uppercase tracking-[0.08em] text-slate-500">
                          {toTitleCaseLabel(column.label)}
                        </p>
                        <div className="mt-0.5 text-slate-900">{cellRenderer(row, column.key)}</div>
                      </div>
                    ))}
                  </div>
                ) : null}

                {mobileActionsColumn ? (
                  <div className="mt-4 border-t border-slate-200 pt-3">
                    <div className="flex items-center justify-end">
                      {cellRenderer(row, mobileActionsColumn.key)}
                    </div>
                  </div>
                ) : null}
              </div>
            ))}
          </div>

          <div className="border-t border-slate-200 bg-white px-4 py-3 text-sm text-slate-600 sm:px-6">
            <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
              <div className="flex flex-wrap items-center gap-3">
                <span className="text-sm text-slate-600">
                  Showing {showingFrom} to {showingTo} of {totalRecords} records
                </span>
                <label className="flex items-center gap-2 text-sm text-slate-600">
                  <span className="text-slate-500">Rows</span>
                  <select
                    value={isAll ? 'all' : String(pageSize)}
                    onChange={(e) => {
                      const v = e.target.value;
                      setPageSize(v === 'all' ? Number.POSITIVE_INFINITY : Number(v));
                    }}
                    className="h-8 rounded-lg border border-slate-200 bg-white px-2 text-sm text-slate-700 outline-none focus:border-[var(--primary)]"
                  >
                    <option value="25">25</option>
                    <option value="50">50</option>
                    <option value="100">100</option>
                    <option value="all">All</option>
                  </select>
                </label>
              </div>

              <div className="flex items-center justify-end gap-1.5">
                <button
                  type="button"
                  disabled={isAll || safePageIndex === 0}
                  onClick={() => setPageIndex((p) => Math.max(0, p - 1))}
                  className="h-8 rounded-lg border border-slate-200 bg-white px-3 text-sm text-slate-700 transition-colors hover:bg-slate-50 disabled:opacity-40"
                >
                  Prev
                </button>
                {!isAll && totalPages > 1 ? (
                  <div className="hidden items-center gap-1 sm:flex">
                    {paginationPages.map((p, idx) =>
                      p === 'gap' ? (
                        <span key={`gap-${idx}`} className="px-1.5 text-slate-400">
                          …
                        </span>
                      ) : (
                        <button
                          key={p}
                          type="button"
                          onClick={() => setPageIndex(p)}
                          className={`h-8 min-w-8 rounded-lg border px-2 text-sm transition-colors ${
                            p === safePageIndex
                              ? 'border-[var(--primary)] bg-[var(--primary-light)] text-[var(--primary)]'
                              : 'border-slate-200 bg-white text-slate-700 hover:bg-slate-50'
                          }`}
                        >
                          {p + 1}
                        </button>
                      )
                    )}
                  </div>
                ) : null}
                <button
                  type="button"
                  disabled={isAll || safePageIndex >= totalPages - 1}
                  onClick={() => setPageIndex((p) => Math.min(totalPages - 1, p + 1))}
                  className="h-8 rounded-lg border border-slate-200 bg-white px-3 text-sm text-slate-700 transition-colors hover:bg-slate-50 disabled:opacity-40"
                >
                  Next
                </button>
              </div>
            </div>
          </div>
        </>
      )}
    </section>
  );
}

function EyeIcon({ className }: { className: string }) {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" className={className}>
      <path
        d="M2 12s3.6-6 10-6 10 6 10 6-3.6 6-10 6S2 12 2 12Z"
        strokeWidth="1.8"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
      <circle cx="12" cy="12" r="2.5" strokeWidth="1.8" />
    </svg>
  );
}
