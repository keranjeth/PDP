/** Shared date parsing/formatting for employee import and forms. */

import * as XLSX from 'xlsx';

const MONTH_SHORT = [
  'Jan',
  'Feb',
  'Mar',
  'Apr',
  'May',
  'Jun',
  'Jul',
  'Aug',
  'Sep',
  'Oct',
  'Nov',
  'Dec',
] as const;

function monthIndexFromName(name: string): number | null {
  const key = name.toLowerCase().slice(0, 3);
  const idx = MONTH_SHORT.findIndex((m) => m.toLowerCase() === key);
  return idx >= 0 ? idx : null;
}

/** Template sample / export: ISO calendar date YYYY-MM-DD. */
export function formatDateForExcelTemplate(d: Date): string {
  return dateToCalendarIso(d) ?? '';
}

/** UI display: "1 Jan 2026" (day without leading zero). */
export function formatDisplayDateDMmmYYYY(d: Date): string {
  return `${d.getDate()} ${MONTH_SHORT[d.getMonth()]} ${d.getFullYear()}`;
}

function parseExcelSerial(value: number): Date | null {
  const parsed = XLSX.SSF.parse_date_code(value);
  if (!parsed) {
    return null;
  }
  return new Date(parsed.y, parsed.m - 1, parsed.d);
}

/**
 * Accepts Excel serial dates, Date instances, ISO strings, d/m/y, m/d/y when unambiguous,
 * and "1 Jan 2026" style. Not restricted to yyyy-mm-dd.
 */
export function parseFlexibleDate(value: unknown): Date | null {
  if (value instanceof Date && !Number.isNaN(value.getTime())) {
    return value;
  }

  if (typeof value === 'number' && Number.isFinite(value)) {
    return parseExcelSerial(value);
  }

  if (typeof value !== 'string') {
    return null;
  }

  const trimmed = value.trim();
  if (!trimmed) {
    return null;
  }

  const isoYmd = /^(\d{4})-(\d{1,2})-(\d{1,2})/;
  const isoMatch = trimmed.match(isoYmd);
  if (isoMatch) {
    const y = parseInt(isoMatch[1], 10);
    const mo = parseInt(isoMatch[2], 10);
    const day = parseInt(isoMatch[3], 10);
    const d = new Date(y, mo - 1, day);
    if (
      d.getFullYear() === y &&
      d.getMonth() === mo - 1 &&
      d.getDate() === day
    ) {
      return d;
    }
  }

  const dmy = /^(\d{1,2})[/.-](\d{1,2})[/.-](\d{2,4})$/;
  const dmyMatch = trimmed.match(dmy);
  if (dmyMatch) {
    const a = parseInt(dmyMatch[1], 10);
    const b = parseInt(dmyMatch[2], 10);
    let y = parseInt(dmyMatch[3], 10);
    if (y < 100) {
      y += y >= 70 ? 1900 : 2000;
    }

    let day: number;
    let month: number;
    if (a > 12) {
      day = a;
      month = b;
    } else if (b > 12) {
      day = b;
      month = a;
    } else {
      day = a;
      month = b;
    }

    if (month >= 1 && month <= 12 && day >= 1 && day <= 31) {
      const d = new Date(y, month - 1, day);
      if (
        d.getFullYear() === y &&
        d.getMonth() === month - 1 &&
        d.getDate() === day
      ) {
        return d;
      }
    }
  }

  const named = /^(\d{1,2})[\s/.\-]+([A-Za-z]{3,})[\s/.\-]+(\d{4})$/;
  const namedMatch = trimmed.match(named);
  if (namedMatch) {
    const day = parseInt(namedMatch[1], 10);
    const mon = monthIndexFromName(namedMatch[2]);
    const y = parseInt(namedMatch[3], 10);
    if (mon !== null && day >= 1 && day <= 31) {
      const d = new Date(y, mon, day);
      if (
        d.getFullYear() === y &&
        d.getMonth() === mon &&
        d.getDate() === day
      ) {
        return d;
      }
    }
  }

  return null;
}

export type ParsedImportDate =
  | { ok: true; iso: string }
  | { ok: false; blank: true }
  | { ok: false; blank?: false; message: string };

const MIN_REVIEW_YEAR = 1920;
const MAX_REVIEW_YEAR = 2100;

function isBlankDateCell(value: unknown) {
  if (value === null || value === undefined) return true;
  const text = String(value).trim().toLowerCase();
  return text === '' || text === '-' || text === 'n/a' || text === 'na' || text === 'none';
}

/** Calendar date as YYYY-MM-DD using local components. Does not use UTC conversion. */
export function calendarDateToIso(year: number, month: number, day: number): string | null {
  if (month < 1 || month > 12 || day < 1 || day > 31) return null;
  const check = new Date(year, month - 1, day);
  if (check.getFullYear() !== year || check.getMonth() !== month - 1 || check.getDate() !== day) {
    return null;
  }
  return `${year}-${String(month).padStart(2, '0')}-${String(day).padStart(2, '0')}`;
}

export function dateToCalendarIso(value: Date): string | null {
  if (!(value instanceof Date) || Number.isNaN(value.getTime())) return null;
  return calendarDateToIso(value.getFullYear(), value.getMonth() + 1, value.getDate());
}

export function isoToLocalDate(iso: string): Date | null {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(iso);
  if (!match) return null;
  const year = Number(match[1]);
  const month = Number(match[2]);
  const day = Number(match[3]);
  if (calendarDateToIso(year, month, day) !== iso) return null;
  return new Date(year, month - 1, day);
}

function reviewRangeMessage(iso: string) {
  return `Date ${iso} is outside ${MIN_REVIEW_YEAR}–${MAX_REVIEW_YEAR} and was not imported. Review this value; it was not changed automatically.`;
}

function acceptIso(iso: string): ParsedImportDate {
  const year = Number(iso.slice(0, 4));
  if (year < MIN_REVIEW_YEAR || year > MAX_REVIEW_YEAR) {
    return { ok: false, message: reviewRangeMessage(iso) };
  }
  return { ok: true, iso };
}

/**
 * Parse an import cell into YYYY-MM-DD.
 * Accepts genuine Excel date cells/serials and ISO strings (YYYY-MM-DD).
 * Rejects ambiguous day/month slash dates — do not guess DMY vs MDY.
 */
export function parseImportDate(value: unknown): ParsedImportDate {
  if (isBlankDateCell(value)) return { ok: false, blank: true };

  if (value instanceof Date) {
    // Excel/OOXML date-only cells are often UTC midnight. Using local getters in
    // Asia/Kabul (and similar zones) shifts those back one calendar day.
    const iso =
      value.getUTCHours() === 0 &&
      value.getUTCMinutes() === 0 &&
      value.getUTCSeconds() === 0 &&
      value.getUTCMilliseconds() === 0
        ? calendarDateToIso(
            value.getUTCFullYear(),
            value.getUTCMonth() + 1,
            value.getUTCDate()
          )
        : dateToCalendarIso(value);
    return iso ? acceptIso(iso) : { ok: false, message: 'Date is not a real calendar date.' };
  }

  if (typeof value === 'number' && Number.isFinite(value)) {
    const parsed = XLSX.SSF.parse_date_code(value);
    if (!parsed) return { ok: false, message: 'Excel date serial could not be read.' };
    const iso = calendarDateToIso(parsed.y, parsed.m, parsed.d);
    return iso ? acceptIso(iso) : { ok: false, message: 'Excel date serial is not a real calendar date.' };
  }

  const trimmed = String(value).trim();
  if (/^\d+(\.\d+)?$/.test(trimmed)) {
    const serial = Number(trimmed);
    if (serial > 20000 && serial < 80000) {
      return parseImportDate(serial);
    }
  }

  const ymd = /^(\d{4})-(\d{2})-(\d{2})$/.exec(trimmed);
  if (ymd) {
    const iso = calendarDateToIso(Number(ymd[1]), Number(ymd[2]), Number(ymd[3]));
    return iso
      ? acceptIso(iso)
      : { ok: false, message: `${trimmed} is not a real calendar date. Use YYYY-MM-DD.` };
  }

  if (/^\d{1,2}[/.-]\d{1,2}[/.-]\d{2,4}$/.test(trimmed)) {
    return {
      ok: false,
      message: `${trimmed} is ambiguous. Use YYYY-MM-DD (for example 2026-10-31).`,
    };
  }

  return {
    ok: false,
    message: `${trimmed} is not a recognized date. Use YYYY-MM-DD or an Excel date cell.`,
  };
}

export function payrollBaselineIso(payrollYear: number, overrideIso?: string | null): string | null {
  if (overrideIso && /^\d{4}-\d{2}-\d{2}$/.test(overrideIso)) return overrideIso;
  if (!Number.isInteger(payrollYear) || payrollYear < MIN_REVIEW_YEAR || payrollYear > MAX_REVIEW_YEAR) {
    return null;
  }
  return `${payrollYear}-01-01`;
}

/** Opening-balance start = later of joining date and the payroll baseline. */
export function deriveOpeningStartIso(joiningIso: string | null, baselineIso: string): string {
  if (!joiningIso || !/^\d{4}-\d{2}-\d{2}$/.test(joiningIso)) return baselineIso;
  return joiningIso > baselineIso ? joiningIso : baselineIso;
}

export function dayBeforeIso(iso: string): string | null {
  const date = isoToLocalDate(iso);
  if (!date) return null;
  date.setDate(date.getDate() - 1);
  return dateToCalendarIso(date);
}
