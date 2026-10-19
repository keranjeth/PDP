'use client';

import React, { useRef, useState } from 'react';
import { createPortal } from 'react-dom';

const PRIMARY = 'var(--analytics-budget)';
const PRIMARY_SOFT = 'var(--analytics-actual)';

type TooltipRow = {
  color: string;
  label: string;
  value: string;
};

/**
 * Prefers a tooltip above the target with a gap (no overlap with the card).
 * Uses below only when there is not enough viewport space above.
 */
const TOOLTIP_EST_HEIGHT_PX = 150;
const TOOLTIP_MIN_WIDTH_PX = 220;
const TOOLTIP_GAP_PX = 8;
const TOOLTIP_VIEWPORT_EDGE_PX = 12;

function clampTooltipCenterX(centerX: number): number {
  if (typeof window === 'undefined') {
    return centerX;
  }
  const half = TOOLTIP_MIN_WIDTH_PX / 2;
  const edge = TOOLTIP_VIEWPORT_EDGE_PX;
  const min = edge + half;
  const max = window.innerWidth - edge - half;
  if (max <= min) {
    return window.innerWidth / 2;
  }
  return Math.min(Math.max(centerX, min), max);
}

export function getViewportTooltipAnchor(rect: DOMRectReadOnly): {
  viewportX: number;
  viewportY: number;
  placement: 'top' | 'bottom';
} {
  const viewportX = clampTooltipCenterX(rect.left + rect.width / 2);
  const h = TOOLTIP_EST_HEIGHT_PX;
  const gap = TOOLTIP_GAP_PX;
  const edge = TOOLTIP_VIEWPORT_EDGE_PX;
  const minSpaceAbove = h + gap + edge;
  const minSpaceBelow = h + gap + edge;

  const roomAbove = rect.top;
  const roomBelow =
    typeof window !== 'undefined'
      ? window.innerHeight - rect.bottom
      : minSpaceBelow;

  const canPlaceAbove = roomAbove >= minSpaceAbove;
  const canPlaceBelow = roomBelow >= minSpaceBelow;

  if (canPlaceAbove) {
    return {
      viewportX,
      viewportY: rect.top - gap,
      placement: 'top',
    };
  }

  if (canPlaceBelow) {
    let topY = rect.bottom + gap;
    topY = Math.max(topY, edge);
    if (typeof window !== 'undefined') {
      const maxTop = window.innerHeight - edge - h;
      if (maxTop >= edge) {
        topY = Math.min(topY, maxTop);
      }
    }
    return { viewportX, viewportY: topY, placement: 'bottom' };
  }

  let topY = rect.bottom + gap;
  topY = Math.max(topY, edge);
  if (typeof window !== 'undefined') {
    const maxTop = window.innerHeight - edge - h;
    if (maxTop >= edge) {
      topY = Math.min(topY, maxTop);
    }
  }
  return { viewportX, viewportY: topY, placement: 'bottom' };
}

export function calculateChange(currentValue: number, previousValue: number) {
  if (!Number.isFinite(currentValue) || !Number.isFinite(previousValue)) {
    return 0;
  }

  // Period comparison rule:
  // - If previous has no data / total is 0 and current > 0 => show +100%
  // - If both are 0 => 0%
  if (previousValue === 0) {
    return currentValue > 0 ? 100 : 0;
  }

  return ((currentValue - previousValue) / previousValue) * 100;
}

export function formatMillions(value: number) {
  if (!Number.isFinite(value)) {
    return '0K';
  }

  if (Math.abs(value) < 1_000_000) {
    return `${Math.round(value / 1_000)}K`;
  }

  return `${(value / 1_000_000).toFixed(1)}M`;
}

/** Whole units only for table/card readability. */
function formatExactAmount(value: number) {
  if (!Number.isFinite(value)) {
    return '0';
  }

  return new Intl.NumberFormat('en-US', {
    minimumFractionDigits: 0,
    maximumFractionDigits: 0,
  }).format(Math.round(value));
}

export function formatAmountWithCurrency(value: number, currency = '\u060B') {
  return `${formatMillions(value)} ${currency}`;
}

export function formatExactAmountWithCurrency(value: number, currency: string) {
  return `${formatExactAmount(value)} ${currency}`;
}

export function DashboardTooltip({
  viewportX,
  viewportY,
  placement,
  title,
  rows,
}: {
  viewportX: number;
  viewportY: number;
  placement: 'top' | 'bottom';
  title: string;
  rows: TooltipRow[];
}) {
  if (typeof document === 'undefined') {
    return null;
  }

  const positionClass =
    placement === 'top'
      ? '-translate-x-1/2 -translate-y-full'
      : '-translate-x-1/2';

  return createPortal(
    <div
      className={`pointer-events-none fixed z-[100] min-w-[220px] rounded-xl border border-slate-200 bg-white px-3.5 py-3 shadow-[0_14px_34px_rgba(15,23,42,0.10)] ${positionClass}`}
      style={{
        left: viewportX,
        top: viewportY,
      }}
    >
      <div className="border-b border-slate-100 pb-2">
        <p className="text-sm font-normal text-slate-800">{title}</p>
      </div>

      <div className="mt-2.5 space-y-2">
        {rows.map((row) => (
          <div
            key={row.label}
            className="flex items-center justify-between gap-4"
          >
            <div className="flex items-center gap-2">
              <span
                className="h-2.5 w-2.5 rounded-full"
                style={{ backgroundColor: row.color }}
              />
              <span className="text-[12px] font-normal text-slate-500">
                {row.label}
              </span>
            </div>
            <span className="text-[13px] font-normal text-slate-700">
              {row.value}
            </span>
          </div>
        ))}
      </div>
    </div>,
    document.body
  );
}

export type StatCardProps = {
  title: string;
  currentValue: number;
  previousValue: number;
  currency: string;
  valueStyle?: 'compact' | 'exact';
  bottomLabel: string;
  comparisonLabel?: string;
  icon: string;
  /** When set, shown instead of a formatted numeric value (e.g. "—" placeholders). */
  displayValue?: string;
  /** Hide trend/comparison chrome when metrics are not yet available. */
  placeholder?: boolean;
  /** Suppress comparisons when no historical snapshots exist. */
  showComparison?: boolean;
};

export function StatCard({
  title,
  currentValue,
  previousValue,
  currency,
  valueStyle = 'compact',
  bottomLabel,
  comparisonLabel = 'vs last month',
  icon,
  displayValue,
  placeholder = false,
  showComparison = true,
}: StatCardProps) {
  const cardRef = useRef<HTMLDivElement | null>(null);
  const [isHovered, setIsHovered] = useState(false);
  const [tipPos, setTipPos] = useState<{
    x: number;
    y: number;
    placement: 'top' | 'bottom';
  } | null>(null);

  const updateTipPosition = () => {
    const el = cardRef.current;
    if (!el) {
      return;
    }
    const r = el.getBoundingClientRect();
    const anchor = getViewportTooltipAnchor(r);
    setTipPos({
      x: anchor.viewportX,
      y: anchor.viewportY,
      placement: anchor.placement,
    });
  };
  const change = calculateChange(currentValue, previousValue);
  const isDown = change < 0;
  const trendClass = isDown ? 'text-rose-600' : 'text-[var(--analytics-budget)]';
  const arrow = isDown ? '\u2193' : '\u2191';
  const formattedTrend = `${isDown ? '' : '+'}${change.toFixed(1)}%`;
  const formattedValue =
    displayValue ??
    (valueStyle === 'exact'
      ? new Intl.NumberFormat('en-US', {
          minimumFractionDigits: 0,
          maximumFractionDigits: 0,
        }).format(Number.isFinite(currentValue) ? Math.round(currentValue) : 0)
      : formatMillions(currentValue));

  return (
    <div ref={cardRef} className="group relative rounded-[14px]">
      <div
        className="relative overflow-hidden rounded-[14px] border border-slate-200/90 bg-white px-4 py-3 shadow-sm"
        onMouseEnter={() => {
          setIsHovered(true);
          updateTipPosition();
        }}
        onMouseMove={updateTipPosition}
        onMouseLeave={() => {
          setIsHovered(false);
          setTipPos(null);
        }}
      >
        <div className="absolute inset-x-0 top-0 h-[3px] bg-gradient-to-r from-[var(--analytics-budget)] via-[var(--analytics-budget-hover)] to-[var(--analytics-budget-soft)]" />

        <div className="grid min-h-[104px] grid-rows-[auto_auto_1fr] gap-2.5">
          <div className="flex justify-between">
            <p className="text-[15px] font-semibold text-slate-800">{title}</p>
            <CardIcon type={icon} />
          </div>

          <div className="flex justify-between">
            <div className="flex items-baseline gap-1">
              <span className="text-[20px] font-semibold text-slate-700">
                {formattedValue}
              </span>
              {!placeholder && !displayValue ? (
                <span className="text-[20px] font-semibold text-slate-700">
                  {currency}
                </span>
              ) : null}
            </div>

            {!placeholder && showComparison ? (
              <div className={`flex items-center gap-1 text-[12px] font-semibold ${trendClass}`}>
                <span>{formattedTrend}</span>
                <span>{arrow}</span>
              </div>
            ) : placeholder ? (
              <span className="text-[12px] font-semibold text-slate-400">Pending</span>
            ) : null}
          </div>

          <div className="flex justify-between text-[12px] text-slate-500">
            <span>{bottomLabel}</span>
            {!placeholder && showComparison ? <span>{comparisonLabel}</span> : <span />}
          </div>
        </div>
      </div>

      {isHovered && tipPos ? (
        <DashboardTooltip
          viewportX={tipPos.x}
          viewportY={tipPos.y}
          placement={tipPos.placement}
          title={title}
          rows={
            placeholder
              ? [
                  {
                    color: PRIMARY,
                    label: 'Status',
                    value: 'Available when data is recorded',
                  },
                ]
              : showComparison ? [
                  {
                    color: PRIMARY,
                    label: 'Current',
                    value: formatExactAmountWithCurrency(currentValue, currency),
                  },
                  {
                    color: PRIMARY_SOFT,
                    label: 'Previous',
                    value: formatExactAmountWithCurrency(previousValue, currency),
                  },
                ] : [{ color: PRIMARY, label: 'Current', value: displayValue === '—' ? 'Unavailable' : displayValue === '…' ? 'Loading…' : formatExactAmountWithCurrency(currentValue, currency) }]
          }
        />
      ) : null}
    </div>
  );
}

function CardIcon({ type }: { type: string }) {
  const common = 'h-4 w-4 text-[var(--analytics-budget)]';

  if (type === 'wallet') {
    return (
      <div className="flex h-9 w-9 items-center justify-center rounded-[12px] border border-[var(--analytics-selected-fill)] bg-[var(--analytics-budget-background)]">
        <svg
          viewBox="0 0 24 24"
          fill="none"
          stroke="currentColor"
          strokeWidth="1.9"
          className={common}
        >
          <path d="M4 7.5A2.5 2.5 0 0 1 6.5 5H17a2 2 0 0 1 2 2v1H7a3 3 0 0 0 0 6h12v3a2 2 0 0 1-2 2H6.5A2.5 2.5 0 0 1 4 16.5v-9Z" />
          <path d="M17 10h2.5A1.5 1.5 0 0 1 21 11.5v1a1.5 1.5 0 0 1-1.5 1.5H17a2 2 0 1 1 0-4Z" />
        </svg>
      </div>
    );
  }

  if (type === 'tax') {
    return (
      <div className="flex h-9 w-9 items-center justify-center rounded-[12px] border border-[var(--analytics-selected-fill)] bg-[var(--analytics-budget-background)]">
        <svg
          viewBox="0 0 24 24"
          fill="none"
          stroke="currentColor"
          strokeWidth="1.9"
          className={common}
        >
          <path d="M5 16 10 11l3 3 6-6" />
          <path d="M15 8h4v4" />
          <path d="M4 19h16" />
        </svg>
      </div>
    );
  }

  if (type === 'piggy') {
    return (
      <div className="flex h-9 w-9 items-center justify-center rounded-[12px] border border-[var(--analytics-selected-fill)] bg-[var(--analytics-budget-background)]">
        <svg
          viewBox="0 0 24 24"
          fill="none"
          stroke="currentColor"
          strokeWidth="1.9"
          className={common}
        >
          <path d="M7 11V9.5C7 7.01 9.24 5 12 5s5 2.01 5 4.5V11" />
          <path d="M5.5 12.5c0-1.66 1.79-3 4-3h5c2.21 0 4 1.34 4 3V15c0 2.49-2.24 4.5-5 4.5H11c-2.76 0-5-2.01-5-4.5v-2.5Z" />
          <path d="M8.25 19.25V21" />
          <path d="M15.75 19.25V21" />
          <path d="M18.5 11.5h1.25c.97 0 1.75.78 1.75 1.75S20.72 15 19.75 15H18.5" />
          <path d="M7 8.25 5.5 7" />
        </svg>
      </div>
    );
  }

  return (
    <div className="flex h-9 w-9 items-center justify-center rounded-[12px] border border-[var(--analytics-selected-fill)] bg-[var(--analytics-budget-background)]">
      <svg
        viewBox="0 0 24 24"
        fill="none"
        stroke="currentColor"
        strokeWidth="1.9"
        className={common}
      >
        <path d="M4 12a8 8 0 0 1 16 0" />
        <path d="M12 12v7" />
        <path d="M12 12 8 15" />
        <path d="M12 12 16 15" />
      </svg>
    </div>
  );
}

