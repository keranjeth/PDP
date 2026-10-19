import type { TrainingRecord } from "./types";
import type { TrainingImportIssue, TrainingImportRow } from "./import";
import { parseImportDate } from "@/lib/employee-dates";

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
];
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
async function saveWorkbook(
  headers: string[],
  rows: unknown[][],
  filename: string,
  numericColumns: number[] = [],
) {
  const ExcelJS = await import("exceljs");
  const book = new ExcelJS.Workbook();
  const sheet = book.addWorksheet("Training Records");
  sheet.addRow(headers);
  rows.forEach((values) => {
    const row = sheet.addRow(values);
    headers.forEach((header, index) => {
      const value = values[index];
      if (
        header.endsWith("Date") &&
        typeof value === "string" &&
        /^\d{4}-\d{2}-\d{2}$/.test(value)
      ) {
        row.getCell(index + 1).value = new Date(`${value}T00:00:00Z`);
        row.getCell(index + 1).numFmt = "yyyy-mm-dd";
      }
    });
  });
  sheet.views = [{ state: "frozen", ySplit: 1 }];
  sheet.autoFilter = {
    from: "A1",
    to: { row: Math.max(1, rows.length + 1), column: headers.length },
  };
  headers.forEach((header, i) => {
    const col = sheet.getColumn(i + 1);
    col.width = /Name|Course|Note|Funding/.test(header)
      ? 30
      : Math.max(17, header.length + 2);
    if (numericColumns.includes(i + 1)) col.numFmt = "#,##0.00";
  });
  const top = sheet.getRow(1);
  top.height = 30;
  top.eachCell((cell) => {
    cell.font = {
      name: "Arial",
      size: 11,
      bold: true,
      color: { argb: "FFFFFFFF" },
    };
    cell.fill = {
      type: "pattern",
      pattern: "solid",
      fgColor: { argb: "FF0F172A" },
    };
    cell.alignment = { vertical: "middle", wrapText: true };
  });
  for (let r = 2; r <= sheet.rowCount; r++) {
    sheet.getRow(r).height = 23;
    sheet.getRow(r).eachCell((cell) => {
      cell.font = { name: "Arial", size: 10 };
      cell.alignment = { vertical: "middle" };
    });
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
  await saveWorkbook(
    TRAINING_IMPORT_HEADERS,
    [
      [
        "__PDP_SAMPLE__",
        "Sample only",
        "",
        "Example course",
        "In Person",
        "2026-10-01",
        "2026-10-01",
        1000,
        0,
        "",
        "AFN",
        "",
      ],
    ],
    "Training-Data.xlsx",
    [8, 9],
  );
}
export async function exportTrainingRecords(rows: TrainingRecord[]) {
  await saveWorkbook(
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
      r.fundingSources
        .map((s) => `${s.name}: ${s.amount.toFixed(2)}`)
        .join("; "),
      r.currency,
    ]),
    "Training-Records.xlsx",
    [17, 18, 19, 20, 21, 22, 23, 24, 25],
  );
}
export async function exportTrainingIssues(rows: TrainingImportIssue[]) {
  await saveWorkbook(
    ["Row", "Employee ID", "Course Title", "Comment"],
    rows.map((r) => [r.rowNumber, r.employeeIdNumber, r.courseTitle, r.reason]),
    "Training-Records-to-Check.xlsx",
  );
}
export async function readTrainingWorkbook(
  file: File,
): Promise<TrainingImportRow[]> {
  const XLSX = await import("xlsx");
  const book = XLSX.read(await file.arrayBuffer(), {
    type: "array",
    cellDates: true,
  });
  if (!book.SheetNames.length) throw new Error("The file has no worksheets.");
  const sheet = book.Sheets[book.SheetNames[0]];
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
  ])
    if (!header.includes(required))
      throw new Error(
        `Missing column: ${required}. Use the training template.`,
      );
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
        String(get(row, "Employee ID")).trim().toLowerCase() !==
          "__pdp_sample__",
    );
  if (source.length > 2000)
    throw new Error("Import up to 2,000 training records at a time.");
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
      } else
        fundingSources = funding.split(";").map((s) => {
          const at = s.lastIndexOf(":");
          return {
            name: at < 0 ? s.trim() : s.slice(0, at).trim(),
            amount: at < 0 ? "" : s.slice(at + 1).trim(),
          };
        });
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
