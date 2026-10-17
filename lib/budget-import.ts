import * as XLSX from 'xlsx';
import {
  dateToCalendarIso,
  formatDateForExcelTemplate,
  parseImportDate,
} from './employee-dates';
import { BUDGET_CURRENCIES, type BudgetCurrency } from './budgets/types';

export const BUDGET_TEMPLATE_SHEET_NAME = 'Budget Data';
export const BUDGET_TEMPLATE_FILE_NAME = 'Budget-Data.xlsx';

export type BudgetImportRecord = {
  employeeIdNumber: string;
  fullName: string;
  plannedCourse: string;
  amount: number;
  currency: BudgetCurrency;
  plannedCourseStartDate: string; // YYYY-MM-DD
  rowNumber: number;
};

export type BudgetImportValidationResult =
  | {
      ok: true;
      records: BudgetImportRecord[];
      fileName: string;
      skippedSampleRow: boolean;
    }
  | {
      ok: false;
      errors: string[];
      fileName: string;
    };

const HEADERS = [
  'Employee ID',
  'Full Name',
  'Planned Course',
  'Budget',
  'Currency',
  'Planned Course Start Date',
] as const;

const SAMPLE_RECORD: BudgetImportRecord = {
  employeeIdNumber: '265046',
  fullName: 'Abdul Basir Halim',
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

function headerIndexMap(headerRow: unknown[]) {
  const map = new Map<string, number>();
  headerRow.forEach((cell, index) => {
    const name = normalizeString(cell).toLowerCase();
    if (name && !map.has(name)) map.set(name, index);
  });
  return map;
}

function isSampleRow(record: BudgetImportRecord) {
  return (
    record.employeeIdNumber === SAMPLE_RECORD.employeeIdNumber &&
    record.fullName === SAMPLE_RECORD.fullName &&
    record.plannedCourse === SAMPLE_RECORD.plannedCourse &&
    record.amount === SAMPLE_RECORD.amount &&
    record.currency === SAMPLE_RECORD.currency &&
    record.plannedCourseStartDate === SAMPLE_RECORD.plannedCourseStartDate
  );
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

function parseRow(
  row: unknown[],
  rowNumber: number,
  columnsByHeader: Map<string, number>
): { record: BudgetImportRecord | null; errors: string[] } {
  const errors: string[] = [];
  const get = (header: (typeof HEADERS)[number]) => {
    const index = columnsByHeader.get(header.toLowerCase());
    return index === undefined ? '' : row[index];
  };

  const employeeIdNumber = normalizeString(get('Employee ID'));
  const fullName = normalizeString(get('Full Name'));
  const plannedCourse = normalizeString(get('Planned Course'));
  const amountRaw = get('Budget');
  const currencyRaw = normalizeString(get('Currency')).toUpperCase();
  const dateRaw = get('Planned Course Start Date');

  if (!employeeIdNumber) {
    errors.push(`Row ${rowNumber}: Employee ID is required.`);
  }
  if (!fullName) {
    errors.push(`Row ${rowNumber}: Full Name is required.`);
  }
  if (!plannedCourse) {
    errors.push(`Row ${rowNumber}: Planned Course is required.`);
  }

  const amount = parseAmount(amountRaw);
  if (isBlankCell(amountRaw)) {
    errors.push(`Row ${rowNumber}: Budget is required.`);
  } else if (amount === null || amount < 0) {
    errors.push(`Row ${rowNumber}: Budget must be a valid non-negative amount.`);
  }

  if (!currencyRaw) {
    errors.push(`Row ${rowNumber}: Currency is required.`);
  } else if (!CURRENCY_SET.has(currencyRaw)) {
    errors.push(`Row ${rowNumber}: Currency must be AFN, USD, or EUR.`);
  }

  let plannedCourseStartDate = '';
  if (isBlankCell(dateRaw)) {
    errors.push(`Row ${rowNumber}: Planned Course Start Date is required.`);
  } else {
    const parsed = parseImportDate(dateRaw);
    if (!parsed.ok) {
      errors.push(
        `Row ${rowNumber}: ${
          parsed.blank
            ? 'Planned Course Start Date is required.'
            : `Invalid Planned Course Start Date. ${parsed.message}`
        }`
      );
    } else {
      plannedCourseStartDate = parsed.iso;
    }
  }

  if (errors.length > 0) {
    return { record: null, errors };
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
    errors: [],
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
    const sample = [
      SAMPLE_RECORD.employeeIdNumber,
      SAMPLE_RECORD.fullName,
      SAMPLE_RECORD.plannedCourse,
      SAMPLE_RECORD.amount,
      SAMPLE_RECORD.currency,
      formatDateForExcelTemplate(
        new Date(
          Number(SAMPLE_RECORD.plannedCourseStartDate.slice(0, 4)),
          Number(SAMPLE_RECORD.plannedCourseStartDate.slice(5, 7)) - 1,
          Number(SAMPLE_RECORD.plannedCourseStartDate.slice(8, 10))
        )
      ),
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

    // Budget amount column
    ws.getColumn(4).numFmt = '#,##0.00';
    // Date column
    ws.getColumn(6).numFmt = 'yyyy-mm-dd';
    const dateCell = ws.getRow(2).getCell(6);
    if (typeof dateCell.value === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(dateCell.value)) {
      const [y, m, d] = dateCell.value.split('-').map(Number);
      dateCell.value = new Date(y, m - 1, d);
      dateCell.numFmt = 'yyyy-mm-dd';
    }

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
      ws.getColumn(col).width = Math.min(Math.max(maxLen + 2.5, 12), 40);
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

  const rows = XLSX.utils.sheet_to_json<(string | number | Date | null)[]>(worksheet, {
    header: 1,
    raw: true,
    defval: '',
    blankrows: false,
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
  const errors: string[] = [];
  let skippedSampleRow = false;

  rows.slice(1).forEach((row, index) => {
    const rowNumber = index + 2;
    const isEmpty = HEADERS.every((header) => {
      const columnIndex = headerMap.get(header.toLowerCase());
      return columnIndex === undefined || isBlankCell(row[columnIndex]);
    });
    if (isEmpty) return;

    const parsed = parseRow(row, rowNumber, headerMap);
    if (parsed.errors.length > 0) {
      errors.push(...parsed.errors);
      return;
    }
    if (!parsed.record) return;

    if (isSampleRow(parsed.record)) {
      skippedSampleRow = true;
      return;
    }

    records.push(parsed.record);
  });

  if (errors.length > 0) {
    return { ok: false, fileName: file.name, errors };
  }

  if (records.length === 0) {
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
    parts.plannedCourseStartDate.slice(0, 10),
  ].join('|');
}

export function dateToCalendarIsoSafe(value: Date | string | null | undefined) {
  if (!value) return null;
  if (typeof value === 'string') {
    return /^\d{4}-\d{2}-\d{2}$/.test(value) ? value : null;
  }
  return dateToCalendarIso(value);
}
