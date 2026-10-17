'use client';

import React from 'react';

interface TableProps<T> {
  columns: Array<{
    key: keyof T | string;
    label: string;
    render?: (value: unknown, row: T) => React.ReactNode;
  }>;
  data: T[];
  onRowClick?: (row: T) => void;
  emptyMessage?: string;
  className?: string;
}

export function Table<T extends Record<string, unknown>>({
  columns,
  data,
  onRowClick,
  emptyMessage = 'No data available',
  className = '',
}: TableProps<T>) {
  const [pageSize, setPageSize] = React.useState<number>(25);
  const dataIdentity = React.useMemo(
    () => `${data.length}:${data.map((row) => String((row as { id?: unknown }).id ?? '')).join(',')}`,
    [data]
  );
  const paginationResetKey = `${pageSize}|${dataIdentity}`;
  const [pageState, setPageState] = React.useState({ resetKey: paginationResetKey, pageIndex: 0 });
  const pageIndex = pageState.resetKey === paginationResetKey ? pageState.pageIndex : 0;
  const setPageIndex = (value: number | ((prev: number) => number)) => {
    setPageState((prev) => {
      const currentIndex = prev.resetKey === paginationResetKey ? prev.pageIndex : 0;
      const nextIndex = typeof value === 'function' ? value(currentIndex) : value;
      return { resetKey: paginationResetKey, pageIndex: nextIndex };
    });
  };

  const totalRecords = data.length;
  const isAll = pageSize === Number.POSITIVE_INFINITY;
  const effectivePageSize = isAll ? Math.max(totalRecords, 1) : pageSize;
  const totalPages = Math.max(1, Math.ceil(totalRecords / effectivePageSize));
  const safePageIndex = Math.min(pageIndex, totalPages - 1);
  const pageStart = safePageIndex * effectivePageSize;
  const pageEndExclusive = Math.min(pageStart + effectivePageSize, totalRecords);
  const pagedData = isAll ? data : data.slice(pageStart, pageEndExclusive);
  const showingFrom = totalRecords === 0 ? 0 : pageStart + 1;
  const showingTo = pageEndExclusive;

  const paginationPages = React.useMemo(() => {
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

  if (data.length === 0) {
    return (
      <div className={`text-center py-12 text-gray-500 ${className}`}>
        {emptyMessage}
      </div>
    );
  }

  return (
    <div className={`overflow-x-auto ${className}`}>
      <table className="w-full table-fixed divide-y divide-gray-200">
        <thead className="bg-gray-50">
          <tr>
            {columns.map((column) => (
              <th
                key={String(column.key)}
                className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider whitespace-nowrap"
              >
                {column.label}
              </th>
            ))}
          </tr>
        </thead>
        <tbody className="bg-white divide-y divide-gray-200">
          {pagedData.map((row, rowIndex) => (
            <tr
              key={rowIndex}
              onClick={() => onRowClick?.(row)}
              className={
                onRowClick
                  ? 'cursor-pointer transition-colors hover:bg-[var(--primary-light)]'
                  : ''
              }
            >
              {columns.map((column) => (
                <td
                  key={String(column.key)}
                  className="px-6 py-4 whitespace-nowrap text-sm text-gray-900"
                >
                  {column.render 
                    ? column.render(row[column.key as keyof T], row)
                    : String(row[column.key as keyof T] ?? '-')
                  }
                </td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>

      <div className="border-t border-gray-200 bg-white px-6 py-3 text-sm text-gray-600">
        <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
          <div className="flex flex-wrap items-center gap-3">
            <span>
              Showing {showingFrom} to {showingTo} of {totalRecords} records
            </span>
            <label className="flex items-center gap-2">
              <span className="text-gray-500">Rows</span>
              <select
                value={isAll ? 'all' : String(pageSize)}
                onChange={(e) => {
                  const v = e.target.value;
                  setPageSize(v === 'all' ? Number.POSITIVE_INFINITY : Number(v));
                }}
                className="h-8 rounded-lg border border-gray-200 bg-white px-2 text-sm text-gray-700 outline-none focus:border-[var(--primary)]"
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
              className="h-8 rounded-lg border border-gray-200 bg-white px-3 text-sm text-gray-700 transition-colors hover:bg-gray-50 disabled:opacity-40"
            >
              Prev
            </button>
            {!isAll && totalPages > 1 ? (
              <div className="hidden items-center gap-1 sm:flex">
                {paginationPages.map((p, idx) =>
                  p === 'gap' ? (
                    <span key={`gap-${idx}`} className="px-1.5 text-gray-400">
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
                          : 'border-gray-200 bg-white text-gray-700 hover:bg-gray-50'
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
              className="h-8 rounded-lg border border-gray-200 bg-white px-3 text-sm text-gray-700 transition-colors hover:bg-gray-50 disabled:opacity-40"
            >
              Next
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
