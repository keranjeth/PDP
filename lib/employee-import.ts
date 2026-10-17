import * as XLSX from 'xlsx';
import {
  dateToCalendarIso,
  formatDateForExcelTemplate,
  isoToLocalDate,
  parseImportDate,
  type ImportDateOrder,
} from './employee-dates';
import {
  BLOOD_GROUP_OPTIONS,
  DEFAULT_CURRENCY,
  MARITAL_STATUS_OPTIONS,
} from './constants';
import { Employee } from './types';

/**
 * Excel import: sheet "Employee Data", file Employee-Data.xlsx.
 * Columns are Personal → Job → Contract only (same order as the template).
 * Age and Length of Service are not import columns.
 */

type EmployeeImportDateField =
  | 'dateOfBirth'
  | 'joiningDate'
  | 'contractStartDate'
  | 'contractEndDate';

type EmployeeImportStringField = Exclude<
  keyof Omit<Employee, 'id' | 'createdAt'>,
  EmployeeImportDateField
>;

type EmployeeImportField = EmployeeImportStringField | EmployeeImportDateField;

export type EmployeeImportColumn = {
  key: EmployeeImportField;
  header: string;
  type: 'string' | 'date';
  required: boolean;
  /** For optional date cells: omit field vs default contract end */
  dateWhenBlank?: 'skip' | 'contractEndDefault';
  sectionTitle: 'Personal' | 'Job' | 'Contract';
};

export type EmployeeImportRecord = Omit<Employee, 'id' | 'createdAt'>;

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
  // Personal (matches UI labels; Age omitted — calculated)
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
    key: 'bloodGroup',
    header: 'Blood Group',
    type: 'string',
    required: false,
    sectionTitle: 'Personal',
  },
  {
    key: 'maritalStatus',
    header: 'Marital Status',
    type: 'string',
    required: false,
    sectionTitle: 'Personal',
  },
  // Job
  {
    key: 'positionNumber',
    header: 'Position Number',
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
    key: 'overtimeGroupName',
    header: 'Overtime Group',
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
  // Contract
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
    required: false,
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
];

export const TEMPLATE_SHEET_NAME = 'Employee Data';
export const TEMPLATE_FILE_NAME = 'Employee-Data.xlsx';

const BLOOD_GROUP_VALUES = new Set<string>(
  BLOOD_GROUP_OPTIONS.map((option) => option.value)
);
const MARITAL_STATUS_VALUES = new Set<string>(
  MARITAL_STATUS_OPTIONS.map((option) => option.value)
);

const SAMPLE_IMPORT_RECORD: EmployeeImportRecord = {
  idNumber: '123456',
  fullName: 'Sample Employee',
  gender: 'Male',
  dateOfBirth: new Date('1990-05-15'),
  bloodGroup: 'O+',
  maritalStatus: 'Single',
  positionNumber: 'POS-001',
  designation: 'HR Officer',
  staffingCategory: 'National',
  overtimeGroupName: 'Standard',
  department: 'Human Resources',
  unit: 'Operations',
  region: 'Central',
  dutyStation: 'Kabul',
  jobLocation: 'Head Office',
  contractType: 'Regular',
  jobStatus: 'Full-Time',
  employmentStatus: 'Active',
  joiningDate: new Date('2026-01-15'),
  contractStartDate: new Date('2026-01-15'),
  contractEndDate: new Date('2026-12-31'),
  currency: DEFAULT_CURRENCY,
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
    (column) => column.required && !map.has(column.header.toLowerCase())
  ).map((column) => column.header);
  if (missing.length > 0) {
    return `Missing required columns: ${missing.join(', ')}. Match columns by header name; order does not matter.`;
  }
  return null;
}

function isSampleRow(record: EmployeeImportRecord) {
  return EMPLOYEE_IMPORT_COLUMNS.every((column) => {
    const sampleValue = SAMPLE_IMPORT_RECORD[column.key];
    const recordValue = record[column.key];

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
  columnsByHeader: Map<string, number>,
  dateOrder: ImportDateOrder
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

      record[column.key] = normalized as never;
      return;
    }

    if (isBlankCell(cellValue)) {
      if (column.required) {
        errors.push(`Row ${rowNumber}: ${column.header} is required.`);
      }
      return;
    }

    const parsedDate = parseImportDate(cellValue, dateOrder);
    if (!parsedDate.ok) {
      errors.push(
        `Row ${rowNumber}: ${column.header} — ${
          parsedDate.blank
            ? 'is required.'
            : parsedDate.message
        }`
      );
      return;
    }

    record[column.key] = (isoToLocalDate(parsedDate.iso) ?? undefined) as never;
  });

  if (errors.length > 0) {
    return { record: null, errors };
  }

  record.currency = DEFAULT_CURRENCY;

  if (!GENDER_VALUES.has(record.gender)) {
    errors.push(`Row ${rowNumber}: Gender must be Male or Female.`);
  }

  if (record.contractType && !CONTRACT_TYPE_VALUES.has(record.contractType)) {
    errors.push(`Row ${rowNumber}: Contract Type must be Regular or Non-Regular, or left blank.`);
  }

  if (record.jobStatus && !JOB_STATUS_VALUES.has(record.jobStatus)) {
    errors.push(`Row ${rowNumber}: Job Status must be Full-Time or Part-Time, or left blank.`);
  }

  if (record.employmentStatus && !EMPLOYMENT_STATUS_VALUES.has(record.employmentStatus)) {
    errors.push(
      `Row ${rowNumber}: Employment Status must be Active or Inactive, or left blank.`
    );
  }

  if (record.bloodGroup && !BLOOD_GROUP_VALUES.has(record.bloodGroup)) {
    errors.push(
      `Row ${rowNumber}: Blood Group must be one of: ${[...BLOOD_GROUP_VALUES].join(', ')} — or leave blank.`
    );
  }

  if (record.maritalStatus && !MARITAL_STATUS_VALUES.has(record.maritalStatus)) {
    errors.push(
      `Row ${rowNumber}: Marital Status must be one of: ${[...MARITAL_STATUS_VALUES].join(', ')} — or leave blank.`
    );
  }

  if (
    record.contractStartDate &&
    record.contractEndDate &&
    record.contractEndDate < record.contractStartDate
  ) {
    errors.push(
      `Row ${rowNumber}: Contract End Date cannot be earlier than Contract Start Date.`
    );
  }

  // Overtime Group is optional. Support Staff, when set, must be 8 / 10 / 12 Hours.
  const staffingCategory = String(record.staffingCategory ?? '').trim().toLowerCase();
  const isSupportStaff = staffingCategory === 'support staff';

  const canonicalOvertimeGroupsByLower = new Map<string, string>([
    ['8 hours', '8 Hours'],
    ['10 hours', '10 Hours'],
    ['12 hours', '12 Hours'],
    ['standard', 'Standard'],
  ]);

  const rawOvertimeGroupName = String(record.overtimeGroupName ?? '').trim();
  const overtimeGroupCanonical =
    canonicalOvertimeGroupsByLower.get(rawOvertimeGroupName.toLowerCase()) ?? null;

  if (rawOvertimeGroupName) {
    if (!overtimeGroupCanonical) {
      errors.push(
        `Row ${rowNumber}: Overtime Group must be 8 Hours, 10 Hours, 12 Hours, or Standard, or left blank.`
      );
    } else if (isSupportStaff && overtimeGroupCanonical === 'Standard') {
      errors.push(
        `Row ${rowNumber}: Overtime Group for Support Staff must be 8 Hours, 10 Hours, or 12 Hours.`
      );
    } else if (!isSupportStaff && overtimeGroupCanonical !== 'Standard') {
      errors.push(
        `Row ${rowNumber}: Overtime Group must be Standard for non-support categories, or left blank.`
      );
    } else {
      record.overtimeGroupName = overtimeGroupCanonical as never;
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
    const value = SAMPLE_IMPORT_RECORD[column.key];
    if (column.type === 'date' && column.dateWhenBlank === 'skip' && !value) {
      return '';
    }
    return value instanceof Date ? formatDateForExcelTemplate(value) : value;
  });

  return [headerRow, sampleRow];
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

    // Auto-fit columns (same heuristic as payroll export).
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

export async function validateEmployeeImportFile(
  file: File,
  dateOrder: ImportDateOrder = 'DMY'
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

  const rows = XLSX.utils.sheet_to_json<(string | number | Date | null)[]>(
    worksheet,
    {
      header: 1,
      raw: true,
      defval: '',
      blankrows: false,
    }
  );

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

    const parsed = parseRow(row, rowNumber, seenIdNumbers, headerMap, dateOrder);
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
