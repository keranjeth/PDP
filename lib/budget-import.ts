import * as XLSX from 'xlsx';
import { parseImportDate } from './employee-dates';
import { BUDGET_CURRENCIES, type BudgetCurrency } from './budgets/types';

export const BUDGET_TEMPLATE_SHEET_NAME = 'Budget Data';
export const BUDGET_TEMPLATE_FILE_NAME = 'Budget-Data.xlsx';

/** Unambiguous sample marker — never matches a real employee ID. */
export const BUDGET_IMPORT_SAMPLE_EMPLOYEE_ID = '__PDP_SAMPLE__';

export type BudgetImportRecord = {
  employeeIdNumber: string;
  /** Optional visual reference only — matching uses Employee ID. */
  fullName: string;
  plannedCourse: string;
  amount: number;
  currency: BudgetCurrency;
  /** YYYY-MM-DD when provided; empty string when omitted. */
  plannedCourseStartDate: string;
  rowNumber: number;
};

export type BudgetImportPreviewRow = {
  rowNumber: number;
  employeeIdNumber: string;
  fullName: string;
  employmentStatus: 'Active' | 'Inactive';
  plannedCourse: string;
  amount: number;
  currency: string;
  plannedCourseStartDate: string;
  isPotentialDuplicate: boolean;
  duplicateReasons: string[];
};

/** Row excluded from import — included in “Download Records to Check”. */
export type BudgetImportCheckRow = {
  rowNumber: number;
  employeeIdNumber: string;
  uploadedName: string;
  masterName: string;
  plannedCourse: string;
  amount: string;
  currency: string;
  plannedCourseStartDate: string;
  reason: string;
};

export type BudgetImportValidationResult =
  | {
      ok: true;
      records: BudgetImportRecord[];
      checkRows: BudgetImportCheckRow[];
      fileName: string;
      skippedSampleRow: boolean;
    }
  | {
      ok: false;
      errors: string[];
      fileName: string;
    };

function csvEscape(value: string) {
  return `"${String(value).replace(/"/g, '""')}"`;
}

/** Full rejected-row report — never truncated. */
export function downloadBudgetImportCheckCsv(
  rows: BudgetImportCheckRow[],
  fileLabel = 'Records-to-Check'
) {
  const header = [
    'Worksheet Row',
    'Employee ID',
    'Uploaded Name',
    'Employee Master Name',
    'Planned Course',
    'Budget',
    'Currency',
    'Planned Course Start Date',
    'Rejection Reason',
  ];
  const lines = [
    header.join(','),
    ...rows.map((row) =>
      [
        row.rowNumber,
        row.employeeIdNumber,
        row.uploadedName,
        row.masterName,
        row.plannedCourse,
        row.amount,
        row.currency,
        row.plannedCourseStartDate,
        row.reason,
      ]
        .map((value) => csvEscape(String(value ?? '')))
        .join(',')
    ),
  ];
  const blob = new Blob([lines.join('\n')], { type: 'text/csv;charset=utf-8' });
  const url = URL.createObjectURL(blob);
  const link = document.createElement('a');
  link.href = url;
  link.download = `Budget-Import-${fileLabel}.csv`;
  document.body.appendChild(link);
  link.click();
  document.body.removeChild(link);
  URL.revokeObjectURL(url);
}

const HEADERS = [
  'Employee ID',
  'Full Name',
  'Planned Course',
  'Budget',
  'Currency',
  'Planned Course Start Date',
] as const;

const SAMPLE_RECORD: BudgetImportRecord = {
  employeeIdNumber: BUDGET_IMPORT_SAMPLE_EMPLOYEE_ID,
  fullName: 'Sample Employee — Do Not Import',
  plannedCourse: 'Advanced Excel',
  amount: 2000,
  currency: 'AFN',
  plannedCourseStartDate: '2026-03-15',
  rowNumber: 2,
};

const CURRENCY_SET = new Set<string>(BUDGET_CURRENCIES);

function isBlankCell(value: unknown) {
  return value === null || value === undefined || String(value).trim() === '';
}

function normalizeString(value: unknown) {
  return String(value ?? '').trim();
}

/** Trim only — never coerce to number (keeps leading zeros). */
export function normalizeEmployeeIdCell(value: unknown): string {
  if (value === null || value === undefined) return '';
  if (typeof value === 'number' && Number.isFinite(value)) {
    // Excel may have already dropped leading zeros; avoid scientific notation.
    return Number.isInteger(value) ? String(value) : String(value);
  }
  return String(value).trim();
}

/** Merge exclusion reports by worksheet row (later entries win). Never truncates. */
export function mergeBudgetImportCheckRows(
  ...groups: Array<BudgetImportCheckRow[] | undefined | null>
): BudgetImportCheckRow[] {
  const byRow = new Map<number, BudgetImportCheckRow>();
  for (const group of groups) {
    for (const row of group ?? []) {
      byRow.set(row.rowNumber, row);
    }
  }
  return [...byRow.values()].sort((a, b) => a.rowNumber - b.rowNumber);
}

function headerIndexMap(headerRow: unknown[]) {
  const map = new Map<string, number>();
  headerRow.forEach((cell, index) => {
    const name = normalizeString(cell).toLowerCase();
    if (name && !map.has(name)) map.set(name, index);
  });
  return map;
}

/** Detect sample by marker ID (case/whitespace insensitive). */
export function isBudgetImportSampleRow(record: {
  employeeIdNumber?: string;
  fullName?: string;
}) {
  const id = normalizeString(record.employeeIdNumber).toLowerCase();
  if (id === BUDGET_IMPORT_SAMPLE_EMPLOYEE_ID.toLowerCase()) return true;
  const name = normalizeString(record.fullName).toLowerCase();
  return name.includes('do not import') && id.startsWith('__pdp_sample');
}

function parseAmount(value: unknown): number | null {
  if (typeof value === 'number' && Number.isFinite(value)) {
    return value;
  }
  const text = normalizeString(value).replace(/,/g, '');
  if (!text) return null;
  const n = Number(text);
  return Number.isFinite(n) ? n : null;
}

function formatDateCell(value: unknown): string {
  if (isBlankCell(value)) return '';
  const parsed = parseImportDate(value);
  if (parsed.ok) return parsed.iso;
  return normalizeString(value);
}

function parseRow(
  row: unknown[],
  rowNumber: number,
  columnsByHeader: Map<string, number>
): { record: BudgetImportRecord | null; checkRow: BudgetImportCheckRow | null } {
  const reasons: string[] = [];
  const get = (header: (typeof HEADERS)[number]) => {
    const index = columnsByHeader.get(header.toLowerCase());
    return index === undefined ? '' : row[index];
  };

  const employeeIdNumber = normalizeEmployeeIdCell(get('Employee ID'));
  const fullName = normalizeString(get('Full Name'));
  const plannedCourse = normalizeString(get('Planned Course'));
  const amountRaw = get('Budget');
  const currencyRaw = normalizeString(get('Currency')).toUpperCase();
  const dateRaw = get('Planned Course Start Date');
  const amountDisplay = isBlankCell(amountRaw) ? '' : normalizeString(amountRaw);
  const dateDisplay = formatDateCell(dateRaw);

  if (!employeeIdNumber) reasons.push('Employee ID is required.');
  if (!plannedCourse) reasons.push('Planned Course is required.');

  const amount = parseAmount(amountRaw);
  if (isBlankCell(amountRaw)) {
    reasons.push('Budget is required.');
  } else if (amount === null || amount < 0) {
    reasons.push('Budget must be a valid non-negative amount.');
  }

  if (!currencyRaw) {
    reasons.push('Currency is required.');
  } else if (!CURRENCY_SET.has(currencyRaw)) {
    reasons.push('Currency must be AFN, USD, or EUR.');
  }

  let plannedCourseStartDate = '';
  if (!isBlankCell(dateRaw)) {
    const parsed = parseImportDate(dateRaw);
    if (!parsed.ok) {
      reasons.push(
        `Invalid Planned Course Start Date. ${
          parsed.blank ? 'Use YYYY-MM-DD or leave blank.' : parsed.message
        }`
      );
    } else {
      plannedCourseStartDate = parsed.iso;
    }
  }

  if (reasons.length > 0) {
    return {
      record: null,
      checkRow: {
        rowNumber,
        employeeIdNumber,
        uploadedName: fullName,
        masterName: '',
        plannedCourse,
        amount: amountDisplay,
        currency: currencyRaw,
        plannedCourseStartDate: dateDisplay,
        reason: reasons.join(' '),
      },
    };
  }

  return {
    record: {
      employeeIdNumber,
      fullName,
      plannedCourse,
      amount: amount as number,
      currency: currencyRaw as BudgetCurrency,
      plannedCourseStartDate,
      rowNumber,
    },
    checkRow: null,
  };
}

export function downloadBudgetImportTemplate() {
  void (async () => {
    const ExcelJSMod = await import('exceljs');
    const ExcelJS = ExcelJSMod.default;
    const workbook = new ExcelJS.Workbook();
    const ws = workbook.addWorksheet(BUDGET_TEMPLATE_SHEET_NAME, {
      views: [{ state: 'frozen', ySplit: 1, activeCell: 'A2', showGridLines: true }],
    });

    const PRIMARY_ARGB = 'FF16D187';
    const thin = { style: 'thin' as const, color: { argb: PRIMARY_ARGB } };

    const headers = [...HEADERS];
    // Store the sample date as a plain YYYY-MM-DD string so Asia/Kabul (and UTC)
    // round-trips never shift the calendar day.
    const sample = [
      SAMPLE_RECORD.employeeIdNumber,
      SAMPLE_RECORD.fullName,
      SAMPLE_RECORD.plannedCourse,
      SAMPLE_RECORD.amount,
      SAMPLE_RECORD.currency,
      SAMPLE_RECORD.plannedCourseStartDate,
    ];

    ws.addRow(headers);
    ws.addRow(sample);

    const headerRow = ws.getRow(1);
    headerRow.height = 20;
    headerRow.eachCell({ includeEmpty: false }, (cell) => {
      cell.fill = {
        type: 'pattern',
        pattern: 'solid',
        fgColor: { argb: PRIMARY_ARGB },
      };
      cell.font = { bold: true, color: { argb: 'FFFFFFFF' }, size: 11 };
      cell.alignment = { vertical: 'middle', horizontal: 'center', wrapText: true };
    });

    const columnCount = headers.length;
    for (let r = 1; r <= ws.rowCount; r += 1) {
      const row = ws.getRow(r);
      for (let c = 1; c <= columnCount; c += 1) {
        const cell = row.getCell(c);
        cell.border = { top: thin, left: thin, bottom: thin, right: thin };
        if (r !== 1) {
          cell.alignment = { vertical: 'middle', horizontal: 'left', wrapText: false };
        }
      }
    }

    // Employee ID as text so leading zeros are preserved.
    ws.getColumn(1).numFmt = '@';
    const idCell = ws.getRow(2).getCell(1);
    idCell.value = SAMPLE_RECORD.employeeIdNumber;
    idCell.numFmt = '@';

    ws.getColumn(4).numFmt = '#,##0.00';
    // Date column as text (calendar date, no timezone conversion).
    ws.getColumn(6).numFmt = '@';
    const dateCell = ws.getRow(2).getCell(6);
    dateCell.value = SAMPLE_RECORD.plannedCourseStartDate;
    dateCell.numFmt = '@';

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    (ws as any).dataValidations.add('E2:E5000', {
      type: 'list',
      allowBlank: false,
      formulae: [`"${BUDGET_CURRENCIES.join(',')}"`],
      showErrorMessage: true,
      errorTitle: 'Invalid currency',
      error: 'Choose AFN, USD, or EUR',
    });

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    (ws as any).dataValidations.add('D2:D5000', {
      type: 'decimal',
      operator: 'greaterThanOrEqual',
      formulae: [0],
      allowBlank: false,
      showErrorMessage: true,
      errorTitle: 'Invalid budget',
      error: 'Budget must be a non-negative number',
    });

    for (let col = 1; col <= columnCount; col += 1) {
      let maxLen = String(headers[col - 1]).length;
      ws.eachRow({ includeEmpty: false }, (row) => {
        const v = row.getCell(col).value;
        const text = v == null ? '' : typeof v === 'number' ? String(v) : String(v);
        maxLen = Math.max(maxLen, text.length);
      });
      ws.getColumn(col).width = Math.min(Math.max(maxLen + 2.5, 12), 42);
    }

    const buf = await workbook.xlsx.writeBuffer();
    const blob = new Blob([buf], {
      type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
    });
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = url;
    link.download = BUDGET_TEMPLATE_FILE_NAME;
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
    URL.revokeObjectURL(url);
  })();
}

export async function validateBudgetImportFile(
  file: File
): Promise<BudgetImportValidationResult> {
  if (!file.name.toLowerCase().endsWith('.xlsx')) {
    return {
      ok: false,
      fileName: file.name,
      errors: ['Upload the provided Excel template in .xlsx format only.'],
    };
  }

  const buffer = await file.arrayBuffer();
  const workbook = XLSX.read(buffer, {
    type: 'array',
    cellDates: true,
    raw: true,
  });

  if (!workbook.SheetNames.includes(BUDGET_TEMPLATE_SHEET_NAME)) {
    return {
      ok: false,
      fileName: file.name,
      errors: [
        `The workbook must contain a sheet named exactly "${BUDGET_TEMPLATE_SHEET_NAME}".`,
      ],
    };
  }

  const worksheet = workbook.Sheets[BUDGET_TEMPLATE_SHEET_NAME];
  if (!worksheet) {
    return {
      ok: false,
      fileName: file.name,
      errors: ['The uploaded workbook does not contain a readable worksheet.'],
    };
  }

  // Keep blank rows so worksheet row numbers stay accurate.
  const rows = XLSX.utils.sheet_to_json<(string | number | Date | null)[]>(worksheet, {
    header: 1,
    raw: true,
    defval: '',
    blankrows: true,
  });

  if (rows.length === 0) {
    return {
      ok: false,
      fileName: file.name,
      errors: ['The uploaded workbook is empty.'],
    };
  }

  const headerMap = headerIndexMap(rows[0] ?? []);
  const missing = HEADERS.filter((header) => !headerMap.has(header.toLowerCase()));
  if (missing.length > 0) {
    return {
      ok: false,
      fileName: file.name,
      errors: [
        `Missing columns: ${missing.join(', ')}. Download a fresh Budget-Data.xlsx template.`,
      ],
    };
  }

  const records: BudgetImportRecord[] = [];
  const checkRows: BudgetImportCheckRow[] = [];
  let skippedSampleRow = false;

  rows.slice(1).forEach((row, index) => {
    const rowNumber = index + 2; // Excel row (header is row 1)
    const isEmpty = HEADERS.every((header) => {
      const columnIndex = headerMap.get(header.toLowerCase());
      return columnIndex === undefined || isBlankCell(row[columnIndex]);
    });
    if (isEmpty) return;

    const parsed = parseRow(row, rowNumber, headerMap);
    if (parsed.checkRow) {
      checkRows.push(parsed.checkRow);
      return;
    }
    if (!parsed.record) return;

    if (isBudgetImportSampleRow(parsed.record)) {
      skippedSampleRow = true;
      return;
    }

    records.push(parsed.record);
  });

  if (records.length === 0 && checkRows.length === 0) {
    return {
      ok: false,
      fileName: file.name,
      errors: [
        skippedSampleRow
          ? 'The template sample row was detected and skipped. Add at least one real budget row before importing.'
          : 'No budget rows were found to import.',
      ],
    };
  }

  return {
    ok: true,
    fileName: file.name,
    records,
    checkRows,
    skippedSampleRow,
  };
}

/** Normalize names for comparison: case/whitespace insensitive. */
export function normalizePersonName(value: string) {
  return value.trim().toLowerCase().replace(/\s+/g, ' ');
}

export function budgetDuplicateKey(parts: {
  employeeIdNumber: string;
  plannedCourse: string;
  plannedCourseStartDate: string;
}) {
  return [
    parts.employeeIdNumber.trim().toLowerCase(),
    parts.plannedCourse.trim().toLowerCase().replace(/\s+/g, ' '),
    (parts.plannedCourseStartDate || '').slice(0, 10),
  ].join('|');
}

/** Canonical payload string used for import idempotency fingerprints. */
export function budgetImportCanonicalPayload(records: BudgetImportRecord[]): string {
  return [...records]
    .sort((a, b) => a.rowNumber - b.rowNumber || a.employeeIdNumber.localeCompare(b.employeeIdNumber))
    .map((r) =>
      [
        r.rowNumber,
        r.employeeIdNumber.trim().toLowerCase(),
        normalizePersonName(r.fullName),
        r.plannedCourse.trim().toLowerCase().replace(/\s+/g, ' '),
        Number(r.amount).toFixed(4),
        r.currency.toUpperCase(),
        (r.plannedCourseStartDate || '').slice(0, 10),
      ].join('\t')
    )
    .join('\n');
}
