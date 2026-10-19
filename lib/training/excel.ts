import type { TrainingRecord } from "./types";
import type { TrainingImportIssue, TrainingImportRow } from "./import";
import { parseImportDate } from "@/lib/employee-dates";
import { DELIVERY_METHODS } from "./types";
import { BUDGET_CURRENCIES } from "@/lib/budgets/types";

export const TRAINING_TEMPLATE_SHEET_NAME = "Training Data";
export const TRAINING_TEMPLATE_FILE_NAME = "Training-Data.xlsx";

export const TRAINING_IMPORT_HEADERS = [
  "Employee ID",
  "Full Name",
  "Budget ID",
  "Course Title",
  "Delivery Method",
  "Training Start Date",
  "Training End Date",
  "Training Cost",
  "Additional Cost",
  "Additional Cost Note",
  "Currency",
  "Funding Sources",
] as const;

const REPORT_HEADERS = [
  "Training ID",
  "Employee ID",
  "Full Name",
  "Gender",
  "Position Title",
  "Department",
  "Unit",
  "Region",
  "Duty Station",
  "Job Location",
  "Employee Status",
  "Course Title",
  "Delivery Method",
  "Training Start Date",
  "Training End Date",
  "Budget ID",
  "Initial Budget",
  "Budget Adjustments",
  "Transfers In",
  "Transfers Out",
  "Current Budget",
  "Budget Balance",
  "Training Cost",
  "Additional Cost",
  "Total Actual Cost",
  "Additional Cost Note",
  "Funding Sources",
  "Currency",
];

const PRIMARY_ARGB = "FF16D187";

async function styleAndDownload(
  sheetName: string,
  headers: string[],
  rows: unknown[][],
  filename: string,
  options?: {
    numericColumns?: number[];
    dateColumns?: number[];
    textColumns?: number[];
    dropdowns?: Array<{ column: number; values: string[] }>;
  },
) {
  const ExcelJS = (await import("exceljs")).default;
  const book = new ExcelJS.Workbook();
  const sheet = book.addWorksheet(sheetName, {
    views: [{ state: "frozen", ySplit: 1, activeCell: "A2", showGridLines: true }],
  });

  const thin = { style: "thin" as const, color: { argb: PRIMARY_ARGB } };
  sheet.addRow([...headers]);
  for (const values of rows) {
    sheet.addRow(values);
  }

  const headerRow = sheet.getRow(1);
  headerRow.height = 20;
  headerRow.eachCell({ includeEmpty: false }, (cell) => {
    cell.fill = {
      type: "pattern",
      pattern: "solid",
      fgColor: { argb: PRIMARY_ARGB },
    };
    cell.font = { bold: true, color: { argb: "FFFFFFFF" }, size: 11 };
    cell.alignment = { vertical: "middle", horizontal: "center", wrapText: true };
  });

  const columnCount = headers.length;
  for (let r = 1; r <= sheet.rowCount; r += 1) {
    const row = sheet.getRow(r);
    for (let c = 1; c <= columnCount; c += 1) {
      const cell = row.getCell(c);
      cell.border = { top: thin, left: thin, bottom: thin, right: thin };
      if (r !== 1) {
        cell.alignment = { vertical: "middle", horizontal: "left", wrapText: false };
      }
    }
  }

  for (const col of options?.textColumns ?? [1, 3]) {
    sheet.getColumn(col).numFmt = "@";
    for (let r = 2; r <= sheet.rowCount; r += 1) {
      const cell = sheet.getRow(r).getCell(col);
      cell.value = String(cell.value ?? "");
      cell.numFmt = "@";
    }
  }

  for (const col of options?.dateColumns ?? []) {
    sheet.getColumn(col).numFmt = "@";
    for (let r = 2; r <= sheet.rowCount; r += 1) {
      const cell = sheet.getRow(r).getCell(col);
      if (typeof cell.value === "string" && /^\d{4}-\d{2}-\d{2}$/.test(cell.value)) {
        cell.value = cell.value;
        cell.numFmt = "@";
      }
    }
  }

  for (const col of options?.numericColumns ?? []) {
    sheet.getColumn(col).numFmt = "#,##0.00";
  }

  for (const dropdown of options?.dropdowns ?? []) {
    const letter = sheet.getColumn(dropdown.column).letter;
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    (sheet as any).dataValidations.add(`${letter}2:${letter}5000`, {
      type: "list",
      allowBlank: true,
      formulae: [`"${dropdown.values.join(",")}"`],
      showErrorMessage: true,
      errorTitle: "Invalid value",
      error: `Choose one of: ${dropdown.values.join(", ")}`,
    });
  }

  for (let col = 1; col <= columnCount; col += 1) {
    let maxLen = String(headers[col - 1]).length;
    sheet.eachRow({ includeEmpty: false }, (row) => {
      const v = row.getCell(col).value;
      const text = v == null ? "" : String(v);
      maxLen = Math.max(maxLen, text.length);
    });
    sheet.getColumn(col).width = Math.min(Math.max(maxLen + 2.5, 12), 42);
  }

  const buffer = await book.xlsx.writeBuffer();
  const url = URL.createObjectURL(
    new Blob([buffer as unknown as BlobPart], {
      type: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
    }),
  );
  const link = document.createElement("a");
  link.href = url;
  link.download = filename;
  document.body.append(link);
  link.click();
  link.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

export async function downloadTrainingTemplate() {
  await styleAndDownload(
    TRAINING_TEMPLATE_SHEET_NAME,
    [...TRAINING_IMPORT_HEADERS],
    [
      [
        "__PDP_SAMPLE__",
        "Sample Employee",
        "",
        "Example Course Title",
        "In Person",
        "2026-10-01",
        "2026-10-03",
        1000,
        0,
        "",
        "AFN",
        "",
      ],
    ],
    TRAINING_TEMPLATE_FILE_NAME,
    {
      numericColumns: [8, 9],
      dateColumns: [6, 7],
      textColumns: [1, 3],
      dropdowns: [
        { column: 5, values: [...DELIVERY_METHODS] },
        { column: 11, values: [...BUDGET_CURRENCIES] },
      ],
    },
  );
}

export async function exportTrainingRecords(rows: TrainingRecord[]) {
  await styleAndDownload(
    "Training Records",
    REPORT_HEADERS,
    rows.map((r) => [
      r.trainingCode,
      r.employeeIdNumber,
      r.fullName,
      r.gender,
      r.positionTitle,
      r.department,
      r.unit,
      r.region,
      r.dutyStation,
      r.jobLocation,
      r.employmentStatus,
      r.courseTitle,
      r.deliveryMethod,
      r.trainingStartDate,
      r.trainingEndDate,
      r.budgetCode,
      r.initialBudget,
      r.budgetAdjustment,
      r.transfersIn,
      r.transfersOut,
      r.currentBudget,
      r.budgetBalance,
      r.trainingCost,
      r.additionalCost,
      r.totalActualCost,
      r.additionalCostNote,
      r.fundingSources.map((s) => `${s.name}: ${s.amount.toFixed(2)}`).join("; "),
      r.currency,
    ]),
    "Training-Records.xlsx",
    {
      numericColumns: [17, 18, 19, 20, 21, 22, 23, 24, 25],
      textColumns: [1, 2, 16],
      dateColumns: [14, 15],
    },
  );
}

export async function exportTrainingIssues(rows: TrainingImportIssue[]) {
  await styleAndDownload(
    "Records to Check",
    ["Row", "Employee ID", "Course Title", "Comment"],
    rows.map((r) => [r.rowNumber, r.employeeIdNumber, r.courseTitle, r.reason]),
    "Training-Records-to-Check.xlsx",
    { textColumns: [2] },
  );
}

export async function readTrainingWorkbook(
  file: File,
): Promise<TrainingImportRow[]> {
  if (!file.name.toLowerCase().endsWith(".xlsx")) {
    throw new Error("Upload the provided Excel template in .xlsx format only.");
  }
  const XLSX = await import("xlsx");
  const book = XLSX.read(await file.arrayBuffer(), {
    type: "array",
    cellDates: true,
  });
  if (!book.SheetNames.length) throw new Error("The file has no worksheets.");

  const sheetName = book.SheetNames.includes(TRAINING_TEMPLATE_SHEET_NAME)
    ? TRAINING_TEMPLATE_SHEET_NAME
    : book.SheetNames[0];
  const sheet = book.Sheets[sheetName];
  const rows = XLSX.utils.sheet_to_json<unknown[]>(sheet, {
    header: 1,
    defval: "",
    raw: true,
  });
  const header = rows[0]?.map((s) => String(s).trim()) ?? [];
  for (const required of [
    "Employee ID",
    "Delivery Method",
    "Training Start Date",
    "Training End Date",
    "Training Cost",
  ]) {
    if (!header.includes(required)) {
      throw new Error(
        `Missing column: ${required}. Download a fresh ${TRAINING_TEMPLATE_FILE_NAME} template.`,
      );
    }
  }

  const get = (row: unknown[], name: string) => row[header.indexOf(name)] ?? "";
  const date = (value: unknown) => {
    const result = parseImportDate(value);
    return result.ok ? result.iso : String(value ?? "");
  };
  const source = rows
    .slice(1)
    .map((r, i) => ({ row: r, rowNumber: i + 2 }))
    .filter(
      ({ row }) =>
        row.some((v) => String(v).trim() !== "") &&
        String(get(row, "Employee ID")).trim().toLowerCase() !== "__pdp_sample__",
    );
  if (source.length > 2000) {
    throw new Error("Import up to 2,000 training records at a time.");
  }

  return source.map(({ row, rowNumber }) => {
    let fundingSources: unknown = [];
    const funding = String(get(row, "Funding Sources")).trim();
    if (funding) {
      if (funding.startsWith("[")) {
        try {
          fundingSources = JSON.parse(funding);
        } catch {
          fundingSources = null;
        }
      } else {
        fundingSources = funding.split(";").map((s) => {
          const at = s.lastIndexOf(":");
          return {
            name: at < 0 ? s.trim() : s.slice(0, at).trim(),
            amount: at < 0 ? "" : s.slice(at + 1).trim(),
          };
        });
      }
    }
    return {
      rowNumber,
      employeeIdNumber: String(get(row, "Employee ID")).trim(),
      budgetCode: String(get(row, "Budget ID")).trim(),
      courseTitle: String(get(row, "Course Title")).trim(),
      deliveryMethod: String(get(row, "Delivery Method")).trim(),
      trainingStartDate: date(get(row, "Training Start Date")),
      trainingEndDate: date(get(row, "Training End Date")),
      trainingCost: get(row, "Training Cost"),
      additionalCost: get(row, "Additional Cost"),
      additionalCostNote: String(get(row, "Additional Cost Note")).trim(),
      currency: String(get(row, "Currency")).trim(),
      fundingSources,
    };
  });
}
