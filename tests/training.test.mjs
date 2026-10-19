import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
import test from "node:test";
import ts from "typescript";
const require = createRequire(import.meta.url);
function load(path, deps = {}) {
  const source = readFileSync(new URL(`../${path}`, import.meta.url), "utf8");
  const code = ts.transpileModule(source, {
    compilerOptions: {
      module: ts.ModuleKind.CommonJS,
      target: ts.ScriptTarget.ES2022,
      esModuleInterop: true,
    },
  }).outputText;
  const compiled = { exports: {} };
  new Function("require", "module", "exports", code)(
    (name) => deps[name] ?? require(name),
    compiled,
    compiled.exports,
  );
  return compiled.exports;
}
const types = load("lib/training/types.ts");
const validation = load("lib/training/validation.ts", { "./types": types });
const budgetTypes = load("lib/budgets/types.ts");
const imports = load("lib/training/import.ts", {
  "./validation": validation,
  "./types": types,
  "@/lib/budgets/types": budgetTypes,
});
const dates = load("lib/employee-dates.ts");
const excel = load("lib/training/excel.ts", {
  "@/lib/employee-dates": dates,
  "@/lib/budgets/types": budgetTypes,
  "./types": types,
  "./import": imports,
});
const EMP = "00000000-0000-4000-8000-000000000001";
const BUD = "00000000-0000-4000-8000-000000000002";
const input = (extra = {}) => ({
  employeeId: EMP,
  budgetId: BUD,
  courseTitle: "Excel skills",
  deliveryMethod: "Online",
  trainingStartDate: "2026-10-01",
  trainingEndDate: "2026-10-02",
  trainingCost: 100,
  additionalCost: 20,
  additionalCostNote: "Travel",
  currency: "AFN",
  fundingSources: [
    { name: "Funding A", amount: 70 },
    { name: "Funding B", amount: 50 },
  ],
  ...extra,
});
const row = (extra = {}) => ({
  rowNumber: 2,
  employeeIdNumber: "0012",
  budgetCode: "BGT-2026-001",
  courseTitle: "",
  deliveryMethod: "Online",
  trainingStartDate: "2026-10-01",
  trainingEndDate: "2026-10-02",
  trainingCost: 100,
  additionalCost: 0,
  additionalCostNote: "",
  currency: "",
  fundingSources: [],
  ...extra,
});
const employees = [{ id: EMP, idNumber: "0012", fullName: "Example Person" }];
const budgets = [
  {
    id: BUD,
    budgetCode: "BGT-2026-001",
    employeeId: EMP,
    plannedCourse: "Excel skills",
    currency: "AFN",
    plannedCourseStartDate: "2026-10-01",
  },
];

test("costs and funding splits are validated in cents, including a real zero", () => {
  assert.equal(validation.parseTrainingInput(input()).trainingCost, 100);
  assert.equal(
    validation.parseTrainingInput(
      input({ trainingCost: 0, additionalCost: 0, fundingSources: [] }),
    ).trainingCost,
    0,
  );
  assert.throws(
    () => validation.parseTrainingInput(input({ trainingCost: "" })),
    /required/,
  );
  assert.throws(
    () => validation.parseTrainingInput(input({ trainingCost: -1 })),
    /non-negative/,
  );
  assert.throws(
    () => validation.parseTrainingInput(input({ trainingCost: 1.001 })),
    /decimal/,
  );
  assert.throws(
    () =>
      validation.parseTrainingInput(
        input({ fundingSources: [{ name: "A", amount: 1 }] }),
      ),
    /equal/,
  );
  assert.throws(
    () =>
      validation.parseTrainingInput(
        input({
          fundingSources: [
            { name: "A", amount: 70 },
            { name: "a", amount: 50 },
          ],
        }),
      ),
    /once/,
  );
});
test("actual dates, delivery method, and additional cost notes are checked", () => {
  assert.throws(
    () =>
      validation.parseTrainingInput(input({ trainingStartDate: "2026-02-30" })),
    /dates/,
  );
  assert.throws(
    () =>
      validation.parseTrainingInput(input({ trainingEndDate: "2026-09-30" })),
    /before/,
  );
  assert.throws(
    () => validation.parseTrainingInput(input({ additionalCostNote: "" })),
    /note/,
  );
  assert.throws(
    () => validation.parseTrainingInput(input({ deliveryMethod: "Unknown" })),
    /In Person/,
  );
});
test("employee ID is the import key; course and currency come from the linked budget", () => {
  const result = imports.resolveTrainingImport(
    [row({ fullName: "Different name" })],
    employees,
    budgets,
    [],
  );
  assert.equal(result.issues.length, 0);
  assert.equal(result.validRows[0].training.employeeId, EMP);
  assert.equal(result.validRows[0].training.courseTitle, "Excel skills");
  assert.equal(result.validRows[0].training.currency, "AFN");
  assert.equal(result.validRows[0].fullName, "Example Person");
});
test("import excludes wrong budgets/currencies and retains repeated training on different dates", () => {
  const result = imports.resolveTrainingImport(
    [
      row(),
      row({ rowNumber: 3 }),
      row({
        rowNumber: 4,
        trainingStartDate: "2026-10-03",
        trainingEndDate: "2026-10-03",
      }),
      row({ rowNumber: 5, currency: "USD" }),
      row({ rowNumber: 6, budgetCode: "missing" }),
    ],
    employees,
    budgets,
    [],
  );
  assert.equal(result.validRows.length, 2);
  assert.equal(result.issues.length, 3);
  assert.ok(result.issues.some((r) => r.reason.includes("Currency")));
  const wrong = imports.resolveTrainingImport(
    [row()],
    employees,
    [{ ...budgets[0], employeeId: "someone-else" }],
    [],
  );
  assert.equal(wrong.validRows.length, 0);
});
test("blank Budget ID marks a new budget for creation on import", () => {
  const result = imports.resolveTrainingImport(
    [
      row({
        budgetCode: "",
        courseTitle: "Free course",
        currency: "AFN",
        trainingCost: 0,
      }),
    ],
    employees,
    budgets,
    [],
  );
  assert.equal(result.validRows[0].training.budgetId, null);
  assert.equal(result.validRows[0].createBudget, true);
  assert.equal(result.validRows[0].budgetSeed?.plannedCourse, "Free course");
});

test("blank Budget ID reuses a matching employee course and start date", () => {
  const result = imports.resolveTrainingImport(
    [
      row({
        budgetCode: "",
        courseTitle: "Excel skills",
        currency: "AFN",
        trainingStartDate: "2026-10-01",
        trainingEndDate: "2026-10-01",
      }),
    ],
    employees,
    budgets,
    [],
  );
  assert.equal(result.validRows[0].createBudget, false);
  assert.equal(result.validRows[0].training.budgetId, budgets[0].id);
});

test("Excel export preserves the full report, employee ID, dates, costs and funding", async () => {
  let saved;
  const originalDocument = globalThis.document;
  const originalCreate = URL.createObjectURL;
  const originalRevoke = URL.revokeObjectURL;
  globalThis.document = {
    body: { append() {} },
    createElement() {
      return { click() {}, remove() {} };
    },
  };
  URL.createObjectURL = (blob) => {
    saved = blob;
    return "blob:test";
  };
  URL.revokeObjectURL = () => {};
  try {
    const record = {
      ...input(),
      id: "training-id",
      trainingCode: "TRN-2026-001",
      employeeIdNumber: "0012",
      fullName: "Example Person",
      gender: "Female",
      positionTitle: "Officer",
      department: "HR",
      unit: "Learning",
      region: "Kabul",
      dutyStation: "Kabul",
      jobLocation: "Regional",
      employmentStatus: "Active",
      totalActualCost: 120,
      budgetCode: "BGT-2026-001",
      initialBudget: 1000,
      budgetAdjustment: 50,
      transfersIn: 20,
      transfersOut: 10,
      currentBudget: 1060,
      budgetBalance: 940,
      updatedAt: "",
    };
    await excel.exportTrainingRecords([record]);
    const ExcelJS = require("exceljs");
    const book = new ExcelJS.Workbook();
    await book.xlsx.load(await saved.arrayBuffer());
    const sheet = book.worksheets[0];
    assert.equal(sheet.getCell("B2").value, "0012");
    assert.equal(sheet.getCell("Y2").value, 120);
    assert.equal(sheet.getCell("V2").value, 940);
    assert.equal(sheet.getCell("G2").value, "Learning");
    const startDateCell = sheet.getCell("N2").value;
    const startDate =
      startDateCell instanceof Date
        ? startDateCell.toISOString().slice(0, 10)
        : String(startDateCell ?? "");
    assert.equal(startDate, "2026-10-01");
    const parsed = await excel.readTrainingWorkbook(
      new File([saved], "Training-Records.xlsx"),
    );
    assert.equal(parsed[0].employeeIdNumber, "0012");
    assert.equal(parsed[0].trainingStartDate, "2026-10-01");
    assert.equal(parsed[0].trainingCost, 100);
    assert.deepEqual(parsed[0].fundingSources, [
      { name: "Funding A", amount: "70.00" },
      { name: "Funding B", amount: "50.00" },
    ]);
  } finally {
    globalThis.document = originalDocument;
    URL.createObjectURL = originalCreate;
    URL.revokeObjectURL = originalRevoke;
  }
});

function route(path, access, other = {}) {
  return load(path, {
    "next/server": {
      NextResponse: { json: (body, init) => Response.json(body, init) },
    },
    "@/lib/budgets/authz": { requireBudgetApiAccess: access },
    "@/lib/training/validation": validation,
    "@/lib/training/server": { listTrainings: async () => [] },
    "@/lib/training/page-data": { loadTrainingPage: async () => ({}) },
    ...other,
  });
}
test("save retries return the existing training only when its content matches", async () => {
  const training = input({ fundingSources: [] });
  const requestId = "00000000-0000-4000-8000-000000000003";
  let previous = {
    id: requestId,
    training_code: "TRN-2026-001",
    ...validation.trainingToRow(training, "org"),
  };
  const query = {
    insert() {
      return query;
    },
    select() {
      return query;
    },
    eq() {
      return query;
    },
    is() {
      return query;
    },
    async single() {
      return { data: null, error: { code: "23505" } };
    },
    async maybeSingle() {
      return { data: previous, error: null };
    },
  };
  const access = async () => ({
    ok: true,
    user: { id: "user" },
    sessionClient: { from: () => query },
  });
  const { POST } = route("app/api/training-records/route.ts", access);
  const request = () =>
    new Request("https://example.test/api/training-records", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ orgId: "org", requestId, training }),
    });
  assert.equal((await POST(request())).status, 200);
  previous = { ...previous, training_cost: 999 };
  assert.equal((await POST(request())).status, 409);
});
test("stale training edits return a conflict instead of overwriting later changes", async () => {
  const filters = [];
  const query = {
    update() {
      return query;
    },
    eq(key, value) {
      filters.push([key, value]);
      return query;
    },
    is() {
      return query;
    },
    select() {
      return query;
    },
    async maybeSingle() {
      return { data: null, error: null };
    },
  };
  const { PATCH } = route(
    "app/api/training-records/[id]/route.ts",
    async () => ({ ok: true, sessionClient: { from: () => query } }),
  );
  const response = await PATCH(
    new Request("https://example.test/api/training-records/id", {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        orgId: "org",
        updatedAt: "2026-10-01T10:00:00Z",
        training: input(),
      }),
    }),
    { params: Promise.resolve({ id: EMP }) },
  );
  assert.equal(response.status, 409);
  assert.ok(
    filters.some(
      ([key, value]) =>
        key === "updated_at" && value === "2026-10-01T10:00:00Z",
    ),
  );
});
test("training mutations reject denied access before reaching a database query", async () => {
  const { POST } = route("app/api/training-records/route.ts", async () => ({
    ok: false,
    response: Response.json({ error: "Forbidden" }, { status: 403 }),
  }));
  const response = await POST(
    new Request("https://example.test/api/training-records", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ orgId: "other-org" }),
    }),
  );
  assert.equal(response.status, 403);
});
