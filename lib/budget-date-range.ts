/** Calendar date-range presets for budget Planned Course Start Date filtering. */

export type BudgetDateRangePreset =
  | 'ytd'
  | 'current_month'
  | 'previous_month'
  | 'custom';

export const BUDGET_DATE_RANGE_OPTIONS: Array<{
  value: BudgetDateRangePreset;
  label: string;
}> = [
  { value: 'ytd', label: 'Year to Date' },
  { value: 'current_month', label: 'Current Month' },
  { value: 'previous_month', label: 'Previous Month' },
  { value: 'custom', label: 'Custom Range' },
];

function pad(n: number) {
  return String(n).padStart(2, '0');
}

export function toCalendarIso(year: number, monthIndex0: number, day: number): string {
  return `${year}-${pad(monthIndex0 + 1)}-${pad(day)}`;
}

export function todayCalendarIso(now = new Date()): string {
  return toCalendarIso(now.getFullYear(), now.getMonth(), now.getDate());
}

export function resolveBudgetDateRange(
  preset: BudgetDateRangePreset,
  customFrom: string,
  customTo: string,
  now = new Date()
): { from: string; to: string } | { error: string } {
  const year = now.getFullYear();
  const month = now.getMonth();

  if (preset === 'ytd') {
    return {
      from: toCalendarIso(year, 0, 1),
      to: todayCalendarIso(now),
    };
  }

  if (preset === 'current_month') {
    const lastDay = new Date(year, month + 1, 0).getDate();
    return {
      from: toCalendarIso(year, month, 1),
      to: toCalendarIso(year, month, lastDay),
    };
  }

  if (preset === 'previous_month') {
    const prev = new Date(year, month - 1, 1);
    const prevYear = prev.getFullYear();
    const prevMonth = prev.getMonth();
    const lastDay = new Date(prevYear, prevMonth + 1, 0).getDate();
    return {
      from: toCalendarIso(prevYear, prevMonth, 1),
      to: toCalendarIso(prevYear, prevMonth, lastDay),
    };
  }

  const from = customFrom.trim();
  const to = customTo.trim();
  if (!/^\d{4}-\d{2}-\d{2}$/.test(from) || !/^\d{4}-\d{2}-\d{2}$/.test(to)) {
    return { error: 'Custom range requires From Date and To Date as YYYY-MM-DD.' };
  }
  if (from > to) {
    return { error: 'From Date must not be later than To Date.' };
  }
  return { from, to };
}

export function isoInInclusiveRange(iso: string, from: string, to: string) {
  const day = iso.slice(0, 10);
  return day >= from && day <= to;
}
