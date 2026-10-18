import * as XLSX from 'xlsx';
import {
  dateToCalendarIso,
  formatDateForExcelTemplate,
  isoToLocalDate,
  parseImportDate,
} from './employee-dates';
import {
  normalizeSeparationExitType,
  SEPARATION_EXIT_TYPE_OPTIONS,
  type SeparationExitType,
} from './separation';
import { Employee } from './types';

/**
 * Excel import: sheet "Employee Data", file Employee-Data.xlsx.
 * Columns: Personal → Job → Contract → Separation.
 * Age and Length of Service are calculated, not imported.
 */

type EmployeeImportDateField =
  | 'dateOfBirth'
  | 'joiningDate'
  | 'contractStartDate'
  | 'contractEndDate'
  | 'lastWorkingDate';

type EmployeeImportStringField =
  | Exclude<keyof Omit<Employee, 'id' | 'createdAt'>, Exclude<EmployeeImportDateField, 'lastWorkingDate'>>
  | 'separationType'
  | 'separationReason';

type EmployeeImportField = EmployeeImportStringField | EmployeeImportDateField;

export type EmployeeImportColumn = {
  key: EmployeeImportField;
  header: string;
  type: 'string' | 'date';
  required: boolean;
  dateWhenBlank?: 'skip';
  sectionTitle: 'Personal' | 'Job' | 'Contract' | 'Separation';
};

export type EmployeeImportRecord = Omit<Employee, 'id' | 'createdAt'> & {
  separationType?: SeparationExitType;
  separationReason?: string;
  lastWorkingDate?: Date;
};

export type EmployeeImportValidationResult =
  | {
      ok: true;
      records: EmployeeImportRecord[];
      fileName: string;
      skippedSampleRow: boolean;
    }
  | {
      ok: false;
      errors: string[];
      fileName: string;
    };

export const EMPLOYEE_IMPORT_COLUMNS: EmployeeImportColumn[] = [
  {
    key: 'idNumber',
    header: 'ID Number',
    type: 'string',
    required: true,
    sectionTitle: 'Personal',
  },
  {
    key: 'fullName',
    header: 'Full Name',
    type: 'string',
    required: true,
    sectionTitle: 'Personal',
  },
  {
    key: 'gender',
    header: 'Gender',
    type: 'string',
    required: true,
    sectionTitle: 'Personal',
  },
  {
    key: 'dateOfBirth',
    header: 'Date of Birth',
    type: 'date',
    required: false,
    dateWhenBlank: 'skip',
    sectionTitle: 'Personal',
  },
  {
    key: 'positionNumber',
    header: 'Position Number',
    type: 'string',
    required: false,
    sectionTitle: 'Job',
  },
  {
    key: 'reportsToPositionNumber',
    header: 'Reports To Position Number',
    type: 'string',
    required: false,
    sectionTitle: 'Job',
  },
  {
    key: 'designation',
    header: 'Designation',
    type: 'string',
    required: true,
    sectionTitle: 'Job',
  },
  {
    key: 'staffingCategory',
    header: 'Staffing Category',
    type: 'string',
    required: false,
    sectionTitle: 'Job',
  },
  {
    key: 'department',
    header: 'Department',
    type: 'string',
    required: true,
    sectionTitle: 'Job',
  },
  {
    key: 'unit',
    header: 'Unit',
    type: 'string',
    required: false,
    sectionTitle: 'Job',
  },
  {
    key: 'region',
    header: 'Region',
    type: 'string',
    required: false,
    sectionTitle: 'Job',
  },
  {
    key: 'dutyStation',
    header: 'Duty Station',
    type: 'string',
    required: false,
    sectionTitle: 'Job',
  },
  {
    key: 'jobLocation',
    header: 'Job Location',
    type: 'string',
    required: false,
    sectionTitle: 'Job',
  },
  {
    key: 'contractType',
    header: 'Contract Type',
    type: 'string',
    required: false,
    sectionTitle: 'Contract',
  },
  {
    key: 'jobStatus',
    header: 'Job Status',
    type: 'string',
    required: false,
    sectionTitle: 'Contract',
  },
  {
    key: 'employmentStatus',
    header: 'Employment Status',
    type: 'string',
    required: true,
    sectionTitle: 'Contract',
  },
  {
    key: 'joiningDate',
    header: 'Joining Date',
    type: 'date',
    required: true,
    sectionTitle: 'Contract',
  },
  {
    key: 'contractStartDate',
    header: 'Contract Start Date',
    type: 'date',
    required: false,
    dateWhenBlank: 'skip',
    sectionTitle: 'Contract',
  },
  {
    key: 'contractEndDate',
    header: 'Contract End Date',
    type: 'date',
    required: false,
    dateWhenBlank: 'skip',
    sectionTitle: 'Contract',
  },
  {
    key: 'separationType',
    header: 'Separation Type',
    type: 'string',
    required: false,
    sectionTitle: 'Separation',
  },
  {
    key: 'separationReason',
    header: 'Separation Reason',
    type: 'string',
    required: false,
    sectionTitle: 'Separation',
  },
  {
    key: 'lastWorkingDate',
    header: 'Last Working Date',
    type: 'date',
    required: false,
    dateWhenBlank: 'skip',
    sectionTitle: 'Separation',
  },
];

export const TEMPLATE_SHEET_NAME = 'Employee Data';
export const TEMPLATE_FILE_NAME = 'Employee-Data.xlsx';
export const EMPLOYEE_EXPORT_SHEET_NAME = 'Employee Records';
export const EMPLOYEE_EXPORT_FILE_NAME = 'Employee-Records.xlsx';

export type EmployeeTableExportRow = {
  idNumber: string;
  fullName: string;
  designation: string;
  department: string;
  region: string;
};

const SAMPLE_IMPORT_RECORD: EmployeeImportRecord = {
  idNumber: '123456',
  fullName: 'Sample Employee',
  gender: 'Male',
  dateOfBirth: new Date(1990, 4, 15),
  positionNumber: 'POS-001',
  reportsToPositionNumber: 'POS-100',
  designation: 'HR Officer',
  staffingCategory: 'National',
  department: 'Human Resources',
  unit: 'Operations',
  region: 'Central',
  dutyStation: 'Kabul',
  jobLocation: 'Head Office',
  contractType: 'Regular',
  jobStatus: 'Full-Time',
  employmentStatus: 'Active',
  joiningDate: new Date(2026, 0, 15),
  contractStartDate: new Date(2026, 0, 15),
  contractEndDate: new Date(2026, 11, 31),
};

const GENDER_VALUES = new Set<Employee['gender']>(['Male', 'Female']);
const CONTRACT_TYPE_VALUES = new Set<Employee['contractType']>([
  'Regular',
  'Non-Regular',
]);
const JOB_STATUS_VALUES = new Set<Employee['jobStatus']>([
  'Full-Time',
  'Part-Time',
]);
const EMPLOYMENT_STATUS_VALUES = new Set<Employee['employmentStatus']>([
  'Active',
  'Inactive',
]);

export function getEmployeeImportTemplateSections(): {
  sectionTitle: string;
  headers: string[];
}[] {
  const order: string[] = [];
  const bySection = new Map<string, string[]>();

  for (const column of EMPLOYEE_IMPORT_COLUMNS) {
    if (!bySection.has(column.sectionTitle)) {
      bySection.set(column.sectionTitle, []);
      order.push(column.sectionTitle);
    }
    bySection.get(column.sectionTitle)!.push(column.header);
  }

  return order.map((sectionTitle) => ({
    sectionTitle,
    headers: bySection.get(sectionTitle) ?? [],
  }));
}

function isBlankCell(value: unknown) {
  return value === null || value === undefined || String(value).trim() === '';
}

function normalizeString(value: unknown) {
  return String(value ?? '').trim();
}

function formatIsoDate(value: Date) {
  return dateToCalendarIso(value) ?? '';
}

function headerIndexMap(headerRow: unknown[]) {
  const map = new Map<string, number>();
  headerRow.forEach((cell, index) => {
    const name = normalizeString(cell).toLowerCase();
    if (name && !map.has(name)) map.set(name, index);
  });
  return map;
}

function validateHeaderRow(headerRow: unknown[]) {
  const map = headerIndexMap(headerRow);
  const missing = EMPLOYEE_IMPORT_COLUMNS.filter(
    (column) => !map.has(column.header.toLowerCase())
  ).map((column) => column.header);
  if (missing.length > 0) {
    return `Missing columns: ${missing.join(', ')}. Match columns by header name; order does not matter. Download a fresh template.`;
  }
  return null;
}

function isSampleRow(record: EmployeeImportRecord) {
  return EMPLOYEE_IMPORT_COLUMNS.every((column) => {
    const sampleValue = SAMPLE_IMPORT_RECORD[column.key as keyof EmployeeImportRecord];
    const recordValue = record[column.key as keyof EmployeeImportRecord];

    if (column.type === 'date') {
      if (column.dateWhenBlank === 'skip') {
        const sampleTime =
          sampleValue instanceof Date ? sampleValue.getTime() : null;
        const recordTime =
          recordValue instanceof Date ? recordValue.getTime() : null;
        return sampleTime === recordTime;
      }
      return (
        recordValue instanceof Date &&
        sampleValue instanceof Date &&
        formatIsoDate(recordValue) === formatIsoDate(sampleValue)
      );
    }

    return String(recordValue ?? '') === String(sampleValue ?? '');
  });
}

function parseRow(
  row: unknown[],
  rowNumber: number,
  seenIdNumbers: Set<string>,
  columnsByHeader: Map<string, number>
): { record: EmployeeImportRecord | null; errors: string[] } {
  const errors: string[] = [];
  const record = {} as EmployeeImportRecord;

  EMPLOYEE_IMPORT_COLUMNS.forEach((column) => {
    const index = columnsByHeader.get(column.header.toLowerCase());
    const cellValue = index === undefined ? '' : row[index];

    if (column.type === 'string') {
      const normalized = normalizeString(cellValue);

      if (!normalized) {
        if (column.required) {
          errors.push(`Row ${rowNumber}: ${column.header} is required.`);
        }
        return;
      }

      (record as Record<string, unknown>)[column.key] = normalized;
      return;
    }

    if (isBlankCell(cellValue)) {
      if (column.required) {
        errors.push(`Row ${rowNumber}: ${column.header} is required.`);
      }
      return;
    }

    const parsedDate = parseImportDate(cellValue);
    if (!parsedDate.ok) {
      errors.push(
        `Row ${rowNumber}: ${column.header} — ${
          parsedDate.blank ? 'is required.' : parsedDate.message
        }`
      );
      return;
    }

    (record as Record<string, unknown>)[column.key] =
      isoToLocalDate(parsedDate.iso) ?? undefined;
  });

  if (errors.length > 0) {
    return { record: null, errors };
  }

  if (!GENDER_VALUES.has(record.gender)) {
    errors.push(`Row ${rowNumber}: Gender must be Male or Female.`);
  }

  if (record.contractType && !CONTRACT_TYPE_VALUES.has(record.contractType)) {
    errors.push(
      `Row ${rowNumber}: Contract Type must be Regular or Non-Regular, or left blank.`
    );
  }

  if (record.jobStatus && !JOB_STATUS_VALUES.has(record.jobStatus)) {
    errors.push(
      `Row ${rowNumber}: Job Status must be Full-Time or Part-Time, or left blank.`
    );
  }

  if (!record.employmentStatus || !EMPLOYMENT_STATUS_VALUES.has(record.employmentStatus)) {
    errors.push(`Row ${rowNumber}: Employment Status must be Active or Inactive.`);
  }

  if (
    record.contractStartDate &&
    record.contractEndDate &&
    record.contractEndDate < record.contractStartDate
  ) {
    errors.push(
      `Row ${rowNumber}: Contract Start Date must not be later than Contract End Date.`
    );
  }

  const separationTypeRaw = String(
    (record as { separationType?: string }).separationType ?? ''
  ).trim();
  const separationReason = String(
    (record as { separationReason?: string }).separationReason ?? ''
  ).trim();
  const lastWorkingDate = record.lastWorkingDate;

  if (record.employmentStatus === 'Active') {
    if (separationTypeRaw || separationReason || lastWorkingDate) {
      errors.push(
        `Row ${rowNumber}: Separation fields must be blank for an Active employee.`
      );
    }
    delete (record as { separationType?: unknown }).separationType;
    delete (record as { separationReason?: unknown }).separationReason;
    delete (record as { lastWorkingDate?: unknown }).lastWorkingDate;
  } else if (record.employmentStatus === 'Inactive') {
    if (!separationTypeRaw) {
      errors.push(
        `Row ${rowNumber}: Separation Type is required for an inactive employee.`
      );
    } else {
      const normalizedType = normalizeSeparationExitType(separationTypeRaw);
      if (!normalizedType) {
        errors.push(
          `Row ${rowNumber}: Separation Type must be one of: ${SEPARATION_EXIT_TYPE_OPTIONS.map((o) => o.label).join(', ')}.`
        );
      } else {
        record.separationType = normalizedType;
      }
    }

    if (!separationReason) {
      errors.push(
        `Row ${rowNumber}: Separation Reason is required for an inactive employee.`
      );
    } else {
      record.separationReason = separationReason;
    }

    if (!lastWorkingDate) {
      errors.push(
        `Row ${rowNumber}: Last Working Date is required for an inactive employee.`
      );
    } else if (record.joiningDate && lastWorkingDate < record.joiningDate) {
      errors.push(
        `Row ${rowNumber}: Joining Date must not be later than Last Working Date.`
      );
    }
  }

  const normalizedIdNumber = record.idNumber.toLowerCase();
  if (seenIdNumbers.has(normalizedIdNumber)) {
    errors.push(`Row ${rowNumber}: Duplicate ID Number found in the import file.`);
  } else {
    seenIdNumbers.add(normalizedIdNumber);
  }

  return {
    record: errors.length > 0 ? null : record,
    errors,
  };
}

function buildTemplateRows() {
  const headerRow = EMPLOYEE_IMPORT_COLUMNS.map((column) => column.header);
  const sampleRow = EMPLOYEE_IMPORT_COLUMNS.map((column) => {
    const value = SAMPLE_IMPORT_RECORD[column.key as keyof EmployeeImportRecord];
    if (column.type === 'date' && column.dateWhenBlank === 'skip' && !value) {
      return '';
    }
    return value instanceof Date ? formatDateForExcelTemplate(value) : (value ?? '');
  });

  return [headerRow, sampleRow];
}

function columnLetter(index1Based: number) {
  let n = index1Based;
  let letter = '';
  while (n > 0) {
    const rem = (n - 1) % 26;
    letter = String.fromCharCode(65 + rem) + letter;
    n = Math.floor((n - 1) / 26);
  }
  return letter;
}

export function downloadEmployeeImportTemplate() {
  void (async () => {
    const ExcelJSMod = await import('exceljs');
    const ExcelJS = ExcelJSMod.default;
    const workbook = new ExcelJS.Workbook();
    const ws = workbook.addWorksheet(TEMPLATE_SHEET_NAME, {
      views: [{ state: 'frozen', ySplit: 1, activeCell: 'A2', showGridLines: true }],
    });

    const PRIMARY_ARGB = 'FF16D187';
    const thin = { style: 'thin' as const, color: { argb: PRIMARY_ARGB } };

    const [headers, sample] = buildTemplateRows();

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
    const rowCount = ws.rowCount;
    for (let r = 1; r <= rowCount; r += 1) {
      const row = ws.getRow(r);
      for (let c = 1; c <= columnCount; c += 1) {
        const cell = row.getCell(c);
        cell.border = { top: thin, left: thin, bottom: thin, right: thin };
        if (r !== 1) {
          cell.alignment = { vertical: 'middle', horizontal: 'left', wrapText: false };
        }
      }
    }

    const dateColumns = EMPLOYEE_IMPORT_COLUMNS.map((column, index) =>
      column.type === 'date' ? index + 1 : null
    ).filter((v): v is number => v != null);

    for (const col of dateColumns) {
      ws.getColumn(col).numFmt = 'yyyy-mm-dd';
      for (let r = 2; r <= Math.max(rowCount, 2); r += 1) {
        const cell = ws.getRow(r).getCell(col);
        if (typeof cell.value === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(cell.value)) {
          const [y, m, d] = cell.value.split('-').map(Number);
          cell.value = new Date(y, m - 1, d);
          cell.numFmt = 'yyyy-mm-dd';
        }
      }
    }

    const dropdowns: Array<{ header: string; values: string[] }> = [
      { header: 'Gender', values: ['Male', 'Female'] },
      { header: 'Contract Type', values: ['Regular', 'Non-Regular'] },
      { header: 'Job Status', values: ['Full-Time', 'Part-Time'] },
      { header: 'Employment Status', values: ['Active', 'Inactive'] },
      {
        header: 'Separation Type',
        values: SEPARATION_EXIT_TYPE_OPTIONS.map((option) => option.label),
      },
    ];

    for (const dropdown of dropdowns) {
      const colIndex =
        EMPLOYEE_IMPORT_COLUMNS.findIndex((column) => column.header === dropdown.header) + 1;
      if (colIndex <= 0) continue;
      const letter = columnLetter(colIndex);
      // Apply validation for a large practical data-entry range.
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      (ws as any).dataValidations.add(`${letter}2:${letter}5000`, {
        type: 'list',
        allowBlank: true,
        formulae: [`"${dropdown.values.join(',')}"`],
        showErrorMessage: true,
        errorTitle: 'Invalid value',
        error: `Choose one of: ${dropdown.values.join(', ')}`,
      });
    }

    for (let col = 1; col <= columnCount; col += 1) {
      let maxLen = String(headers[col - 1]).length;
      ws.eachRow({ includeEmpty: false }, (row) => {
        const v = row.getCell(col).value;
        const text = v == null ? '' : typeof v === 'number' ? String(v) : String(v);
        maxLen = Math.max(maxLen, text.length);
      });
      ws.getColumn(col).width = Math.min(Math.max(maxLen + 2.5, 11), 48);
    }

    const buf = await workbook.xlsx.writeBuffer();
    const blob = new Blob([buf], {
      type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
    });
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = url;
    link.download = TEMPLATE_FILE_NAME;
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
    URL.revokeObjectURL(url);
  })();
}

/** Export table columns for the current Employee Records view (all matching rows). */
export async function downloadEmployeeRecordsExport(
  rows: EmployeeTableExportRow[],
  options?: { fileName?: string; sheetName?: string }
) {
  const ExcelJSMod = await import('exceljs');
  const ExcelJS = ExcelJSMod.default;
  const workbook = new ExcelJS.Workbook();
  const sheetName = options?.sheetName ?? EMPLOYEE_EXPORT_SHEET_NAME;
  const ws = workbook.addWorksheet(sheetName, {
    views: [{ state: 'frozen', ySplit: 1, activeCell: 'A2', showGridLines: true }],
  });

  const PRIMARY_ARGB = 'FF16D187';
  const thin = { style: 'thin' as const, color: { argb: PRIMARY_ARGB } };
  const headers = [
    'ID Number',
    'Full Name',
    'Designation',
    'Department',
    'Region',
  ] as const;

  ws.addRow([...headers]);
  for (const row of rows) {
    ws.addRow([
      String(row.idNumber ?? ''),
      String(row.fullName ?? ''),
      String(row.designation ?? ''),
      String(row.department ?? ''),
      String(row.region ?? ''),
    ]);
  }

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
  const rowCount = ws.rowCount;
  for (let r = 1; r <= rowCount; r += 1) {
    const excelRow = ws.getRow(r);
    for (let c = 1; c <= columnCount; c += 1) {
      const cell = excelRow.getCell(c);
      cell.border = { top: thin, left: thin, bottom: thin, right: thin };
      if (r !== 1) {
        cell.alignment = { vertical: 'middle', horizontal: 'left', wrapText: false };
      }
    }
  }

  // Keep Employee IDs as text so leading zeros are preserved.
  ws.getColumn(1).numFmt = '@';
  for (let r = 2; r <= rowCount; r += 1) {
    const cell = ws.getRow(r).getCell(1);
    cell.value = String(cell.value ?? '');
    cell.numFmt = '@';
  }

  for (let col = 1; col <= columnCount; col += 1) {
    let maxLen = String(headers[col - 1]).length;
    ws.eachRow({ includeEmpty: false }, (row) => {
      const v = row.getCell(col).value;
      const text = v == null ? '' : String(v);
      maxLen = Math.max(maxLen, text.length);
    });
    ws.getColumn(col).width = Math.min(Math.max(maxLen + 2.5, 11), 48);
  }

  const buf = await workbook.xlsx.writeBuffer();
  const blob = new Blob([buf], {
    type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
  });
  const url = URL.createObjectURL(blob);
  const link = document.createElement('a');
  link.href = url;
  link.download = options?.fileName ?? EMPLOYEE_EXPORT_FILE_NAME;
  document.body.appendChild(link);
  link.click();
  document.body.removeChild(link);
  URL.revokeObjectURL(url);
}

export async function validateEmployeeImportFile(
  file: File
): Promise<EmployeeImportValidationResult> {
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

  if (!workbook.SheetNames.includes(TEMPLATE_SHEET_NAME)) {
    return {
      ok: false,
      fileName: file.name,
      errors: [
        `The workbook must contain a sheet named exactly "${TEMPLATE_SHEET_NAME}".`,
      ],
    };
  }

  const worksheet = workbook.Sheets[TEMPLATE_SHEET_NAME];

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
  const headerError = validateHeaderRow(rows[0] ?? []);
  if (headerError) {
    return {
      ok: false,
      fileName: file.name,
      errors: [headerError],
    };
  }

  const records: EmployeeImportRecord[] = [];
  const errors: string[] = [];
  const seenIdNumbers = new Set<string>();
  let skippedSampleRow = false;

  rows.slice(1).forEach((row, index) => {
    const rowNumber = index + 2;
    const isEmpty = EMPLOYEE_IMPORT_COLUMNS.every((column) => {
      const columnIndex = headerMap.get(column.header.toLowerCase());
      return columnIndex === undefined || isBlankCell(row[columnIndex]);
    });

    if (isEmpty) {
      return;
    }

    const parsed = parseRow(row, rowNumber, seenIdNumbers, headerMap);
    if (parsed.errors.length > 0) {
      errors.push(...parsed.errors);
      return;
    }

    if (!parsed.record) {
      return;
    }

    if (isSampleRow(parsed.record)) {
      skippedSampleRow = true;
      return;
    }

    records.push(parsed.record);
  });

  if (errors.length > 0) {
    return {
      ok: false,
      fileName: file.name,
      errors,
    };
  }

  if (records.length === 0) {
    return {
      ok: false,
      fileName: file.name,
      errors: [
        skippedSampleRow
          ? 'The template sample row was detected and skipped. Add at least one real employee row before importing.'
          : 'No employee rows were found to import.',
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
