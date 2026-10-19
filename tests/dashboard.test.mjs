import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
import test from "node:test";
import ts from "typescript";

const require = createRequire(import.meta.url);
function loadTs(path, dependencies = {}) {
  const source = readFileSync(new URL(`../${path}`, import.meta.url), "utf8");
  const code = ts.transpileModule(source, {
    compilerOptions: {
      module: ts.ModuleKind.CommonJS,
      target: ts.ScriptTarget.ES2022,
    },
  }).outputText;
  const compiled = { exports: {} };
  new Function("require", "module", "exports", code)(
    (name) => dependencies[name] ?? require(name),
    compiled,
    compiled.exports,
  );
  return compiled.exports;
}
const { buildPdOverview } = loadTs("lib/pd-dashboard.ts");
const { readAllPages } = loadTs("lib/supabase/read-all-pages.ts");
const { mapBudgetListItem } = loadTs("lib/budgets/map.ts");
const budget = (values = {}) => ({
  id: "b1",
  employeeId: "e1",
  currency: "AFN",
  currentAmount: 100,
  remainingAmount: 80,
  plannedCourseStartDate: "2026-09-01",
  ...values,
});
const data = (values = {}) => ({
  budgets: [],
  totalEmployees: 0,
  actualCostsAvailable: false,
  trainings: [],
  ...values,
});

test("uses current allocation and balance after adjustments; keeps currencies separate", () => {
  const result = buildPdOverview(
    data({
      budgets: [
        budget({ currentAmount: 120, remainingAmount: 95 }),
        budget({ id: "b2", currentAmount: 80, remainingAmount: 60 }),
        budget({ currency: "USD", currentAmount: 900 }),
      ],
    }),
    "AFN",
    2026,
  );
  assert.equal(result.totalBudget, 200);
  assert.equal(result.remainingBudget, 155);
  assert.equal(result.months[8].budget, 200);
});

test("undated budgets remain visible without being assigned an invented month", () => {
  const result = buildPdOverview(
    data({
      budgets: [
        budget({ plannedCourseStartDate: "" }),
        budget({ plannedCourseStartDate: "2027-02-01" }),
        budget({ plannedCourseStartDate: "2026-12-01" }),
      ],
    }),
    "AFN",
    2026,
  );
  assert.equal(result.undatedBudget, 100);
  assert.equal(result.totalBudget, 300);
  assert.equal(
    result.months.reduce((sum, row) => sum + row.budget, 0),
    100,
  );
  assert.equal(result.months[11].budget, 100);
  assert.equal(result.months[0].budget, 0);
});

test("unknown actual costs remain distinct from a known zero", () => {
  assert.equal(buildPdOverview(data(), "AFN", 2026).actualCost, null);
  assert.equal(
    buildPdOverview(data({ actualCostsAvailable: true }), "AFN", 2026)
      .actualCost,
    0,
  );
});

test("repeated training participation is retained, sorted by actual date and limited to five", () => {
  const trainings = Array.from({ length: 7 }, (_, i) => ({
    id: `t${i}`,
    employeeIdNumber: "0012",
    currency: "AFN",
    trainingDate: `2026-10-${String(i + 1).padStart(2, "0")}`,
    actualCost: 10,
  }));
  const before = structuredClone(trainings);
  const result = buildPdOverview(
    data({ trainings, actualCostsAvailable: true }),
    "AFN",
    2026,
  );
  assert.equal(result.actualCost, 70);
  assert.equal(result.months[9].actual, 70);
  assert.deepEqual(
    result.recentTrainings.map((r) => r.id),
    ["t6", "t5", "t4", "t3", "t2"],
  );
  assert.deepEqual(trainings, before);
});

test("pagination reads beyond the database row cap and never returns partial success on errors", async () => {
  const rows = Array.from({ length: 1203 }, (_, id) => ({ id }));
  const result = await readAllPages(async (from, to) => ({
    data: rows.slice(from, to + 1),
    error: null,
  }));
  assert.equal(result.length, 1203);
  await assert.rejects(
    () =>
      readAllPages(async (from, to) =>
        from === 0
          ? { data: rows.slice(from, to + 1), error: null }
          : { data: null, error: { message: "Database unavailable" } },
      ),
    /Database unavailable/,
  );
});

function routeWith(access) {
  return loadTs("app/api/dashboard/route.ts", {
    "next/server": {
      NextResponse: { json: (body, init) => Response.json(body, init) },
    },
    "@/lib/budgets/authz": { requireBudgetApiAccess: access },
    "@/lib/budgets/map": { mapBudgetListItem },
    "@/lib/supabase/read-all-pages": { readAllPages },
  });
}

test("API denies unauthenticated, foreign-organization and unauthorized requests before querying", async () => {
  for (const status of [401, 403]) {
    const { GET } = routeWith(async () => ({
      ok: false,
      response: Response.json({ error: "Denied" }, { status }),
    }));
    assert.equal(
      (await GET(new Request("https://example.test/api/dashboard?orgId=other")))
        .status,
      status,
    );
  }
});

test("API uses scoped session queries, includes leavers once, and paginates all budgets", async () => {
  const tables = {
    employees: [{ id: "a" }, { id: "b" }],
    leavers: [
      { employee_id: "a", leaver_id: "la" },
      { employee_id: "c", leaver_id: "lc" },
    ],
    v_employee_budget_list: Array.from({ length: 1203 }, (_, i) => ({
      id: String(i),
      employee_id: "a",
      currency: "AFN",
      current_amount: 100,
      remaining_amount: 100,
    })),
  };
  const filters = [];
  const client = {
    from(table) {
      const query = {
        select() {
          return query;
        },
        eq(key, value) {
          filters.push([table, key, value]);
          return query;
        },
        is() {
          return query;
        },
        order() {
          return query;
        },
        async range(from, to) {
          return { data: tables[table].slice(from, to + 1), error: null };
        },
      };
      return query;
    },
  };
  const { GET } = routeWith(async (_request, org, action) => {
    assert.equal(org, "my-org");
    assert.equal(action, "read");
    return { ok: true, sessionClient: client };
  });
  const response = await GET(
    new Request("https://example.test/api/dashboard?orgId=my-org"),
  );
  const result = await response.json();
  assert.equal(response.status, 200);
  assert.equal(result.totalEmployees, 3);
  assert.equal(result.budgets.length, 1203);
  assert.equal(result.actualCostsAvailable, false);
  assert.deepEqual(result.trainings, []);
  assert.ok(
    filters.every(([, key, value]) => key === "org_id" && value === "my-org"),
  );
  assert.equal(response.headers.get("cache-control"), "private, no-store");
});
