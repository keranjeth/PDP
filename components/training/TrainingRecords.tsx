"use client";
import { useMemo, useState } from "react";
import { Download, Eye, Plus, Trash2, Upload } from "lucide-react";
import { StatCard } from "@/components/dashboard/stat-card";
import { CompactDataTable } from "@/components/ui/compact-employee-table";
import { HeaderDivider } from "@/components/ui/HeaderDivider";
import { TableSearchInput } from "@/components/ui/table-controls";
import { Modal } from "@/components/ui/Modal";
import { formatCurrency } from "@/lib/format-currency";
import { can } from "@/lib/user-management/permissions";
import { exportTrainingRecords } from "@/lib/training/excel";
import type {
  TrainingInput,
  TrainingPageData,
  TrainingRecord,
} from "@/lib/training/types";
import { TrainingForm } from "./TrainingForm";
import { TrainingDetails, displayTrainingDate } from "./TrainingDetails";
import { TrainingImport } from "./TrainingImport";

const COLUMNS = [
  { key: "employeeIdNumber", label: "Employee ID" },
  { key: "fullName", label: "Full Name" },
  { key: "courseTitle", label: "Course Title" },
  { key: "trainingStartDate", label: "Training Date" },
  {
    key: "totalActualCost",
    label: "Total Actual Cost",
    align: "right" as const,
  },
  { key: "budgetBalance", label: "Budget Balance", align: "right" as const },
];
const ACTION =
  "inline-flex h-9 shrink-0 items-center gap-2 whitespace-nowrap rounded-xl border border-[var(--primary)] px-3 text-sm font-medium text-[var(--primary)] transition-colors hover:bg-[var(--primary-light)] disabled:opacity-50";
const EMPTY: TrainingPageData = { trainings: [], employees: [], budgets: [] };
export function TrainingRecords({
  data = EMPTY,
  orgId,
  role,
  loading = false,
  onReload,
}: {
  data?: TrainingPageData;
  orgId: string;
  role: string | null;
  loading?: boolean;
  onReload: () => Promise<void>;
}) {
  const [tab, setTab] = useState<"all" | "active" | "leavers">("all");
  const [search, setSearch] = useState("");
  const [selectedCurrency, setSelectedCurrency] = useState("AFN");
  const [form, setForm] = useState<TrainingRecord | "new" | null>(null);
  const [details, setDetails] = useState<TrainingRecord | null>(null);
  const [importOpen, setImportOpen] = useState(false);
  const [deleteMode, setDeleteMode] = useState(false);
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [confirmDelete, setConfirmDelete] = useState(false);
  const [deleting, setDeleting] = useState(false);
  const [exporting, setExporting] = useState(false);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const currencies = ["AFN", "USD", "EUR"].filter(
    (c) =>
      data.trainings.some((t) => t.currency === c) ||
      data.budgets.some((b) => b.currency === c),
  );
  const currency = currencies.includes(selectedCurrency)
    ? selectedCurrency
    : (currencies[0] ?? "AFN");
  const canCreate = can(role, "budgets", "create");
  const canEdit = can(role, "budgets", "update");
  const canDelete = can(role, "budgets", "delete");
  const rows = useMemo(
    () =>
      data.trainings.filter(
        (r) =>
          r.currency === currency &&
          (tab === "all" ||
            (tab === "active"
              ? r.employmentStatus === "Active"
              : r.employmentStatus === "Inactive")) &&
          (!search.trim() ||
            [
              r.employeeIdNumber,
              r.fullName,
              r.courseTitle,
              r.region,
              r.trainingCode,
            ]
              .join(" ")
              .toLowerCase()
              .includes(search.trim().toLowerCase())),
      ),
    [data, currency, tab, search],
  );
  const clearSelection = () => setSelected(new Set());
  const post = async (url: string, body: unknown, method = "POST") => {
    const response = await fetch(url, {
      method,
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    });
    const result = await response.json();
    if (!response.ok)
      throw new Error(result.error || "Unable to save training.");
    return result;
  };
  const onSave = async (input: TrainingInput, requestId: string) => {
    const editing = form !== "new" && form !== null;
    await post(
      editing ? `/api/training-records/${form.id}` : "/api/training-records",
      {
        orgId,
        training: input,
        requestId,
        updatedAt: editing ? form.updatedAt : undefined,
      },
      editing ? "PATCH" : "POST",
    );
    await onReload();
    setForm(null);
    setNotice(editing ? "Training updated." : "Training added.");
  };
  return (
    <div className="mx-auto max-w-7xl space-y-4">
      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 md:grid-cols-4">
        {[
          {
            title: "Total Trainings",
            value: rows.length,
            label: "Employee training records",
            icon: "wallet",
            money: false,
          },
          {
            title: "Employees Trained",
            value: new Set(rows.map((r) => r.employeeId)).size,
            label: "Each employee counted once",
            icon: "pulse",
            money: false,
          },
          {
            title: "Training Cost",
            value: rows.reduce((s, r) => s + r.trainingCost, 0),
            label: `Course costs · ${currency}`,
            icon: "tax",
            money: true,
          },
          {
            title: "Total Actual Cost",
            value: rows.reduce((s, r) => s + r.totalActualCost, 0),
            label: `Including additional costs · ${currency}`,
            icon: "piggy",
            money: true,
          },
        ].map((c) => (
          <StatCard
            key={c.title}
            title={c.title}
            currentValue={c.value}
            previousValue={0}
            currency={c.money ? currency : ""}
            bottomLabel={c.label}
            icon={c.icon}
            valueStyle="exact"
            displayValue={
              loading
                ? "…"
                : c.money
                  ? formatCurrency(c.value, currency)
                  : undefined
            }
            showComparison={false}
          />
        ))}
      </div>
      <div>
        <div className="flex gap-1 overflow-x-auto [scrollbar-width:none] [&::-webkit-scrollbar]:hidden">
          {[
            ["all", "All"],
            ["active", "Active"],
            ["leavers", "Leavers"],
          ].map(([value, label]) => (
            <button
              key={value}
              type="button"
              aria-pressed={tab === value}
              onClick={() => {
                setTab(value as typeof tab);
                clearSelection();
              }}
              className={`relative px-3 py-2 text-sm font-semibold transition-colors ${tab === value ? "text-[var(--analytics-budget)] after:absolute after:inset-x-2 after:bottom-0 after:h-0.5 after:rounded-full after:bg-[var(--analytics-budget)]" : "text-slate-500 hover:text-slate-800"}`}
            >
              {label}
            </button>
          ))}
        </div>
        <HeaderDivider />
      </div>
      {notice ? (
        <div
          role="status"
          className="flex items-center justify-between gap-3 rounded-xl border border-[var(--primary-border)] bg-[var(--primary-light)] px-4 py-3 text-sm text-slate-700"
        >
          {notice}
          <button
            type="button"
            onClick={() => setNotice("")}
            className="rounded-lg px-2 py-1 text-slate-500 hover:bg-white"
          >
            Dismiss
          </button>
        </div>
      ) : null}
      {error ? (
        <p
          role="alert"
          className="rounded-xl border border-rose-200 bg-rose-50 p-3 text-sm text-rose-700"
        >
          {error}
        </p>
      ) : null}
      <CompactDataTable<TrainingRecord>
        title="Training Records"
        description="View and manage employee training records."
        rows={rows}
        columns={COLUMNS}
        emptyMessage="No training records found."
        isLoading={loading}
        showEmptyHeaders
        tableMinWidthClassName="min-w-[980px]"
        sortable
        defaultSort={{ key: "trainingStartDate", direction: "desc" }}
        getSortValue={(r, key) =>
          r[key as keyof TrainingRecord] as string | number
        }
        headerContent={
          <div className="py-1 sm:py-2">
            <h3 className="text-[18px] font-semibold text-slate-950">
              Training Records
            </h3>
            <p className="mt-1 text-sm text-slate-500">
              View and manage employee training records.
            </p>
            <div className="mt-4 flex flex-col justify-between gap-3 lg:flex-row lg:items-center">
              <TableSearchInput
                id="training-search"
                value={search}
                onChange={(s) => {
                  setSearch(s);
                  clearSelection();
                }}
                placeholder="Search…"
                containerClassName="w-[170px] max-w-full shrink-0"
              />
              <div className="flex flex-wrap items-center gap-2">
                {currencies.length > 1 ? (
                  <select
                    aria-label="Training currency"
                    value={currency}
                    onChange={(e) => {
                      setSelectedCurrency(e.target.value);
                      clearSelection();
                    }}
                    className="h-9 rounded-xl border border-slate-200 bg-white px-3 text-sm text-slate-700"
                  >
                    {currencies.map((c) => (
                      <option key={c}>{c}</option>
                    ))}
                  </select>
                ) : null}
                {canCreate ? (
                  <button
                    type="button"
                    disabled={loading}
                    className={ACTION}
                    onClick={() => setImportOpen(true)}
                  >
                    <Upload className="h-4 w-4" />
                    Import
                  </button>
                ) : null}
                <button
                  type="button"
                  disabled={loading || exporting || !rows.length}
                  className={ACTION}
                  onClick={async () => {
                    setExporting(true);
                    setError("");
                    try {
                      await exportTrainingRecords(rows);
                    } catch (err) {
                      setError(
                        err instanceof Error ? err.message : "Export failed.",
                      );
                    } finally {
                      setExporting(false);
                    }
                  }}
                >
                  <Download className="h-4 w-4" />
                  {exporting ? "Exporting…" : "Export"}
                </button>
                {canCreate ? (
                  <button
                    type="button"
                    disabled={loading}
                    className={ACTION}
                    onClick={() => setForm("new")}
                  >
                    <Plus className="h-4 w-4" />
                    New
                  </button>
                ) : null}
                {canDelete ? (
                  <button
                    type="button"
                    disabled={loading || deleting}
                    className="inline-flex h-9 shrink-0 items-center gap-2 whitespace-nowrap rounded-xl border border-rose-700 bg-rose-50 px-3 text-sm font-medium text-rose-800 hover:bg-rose-100 disabled:opacity-50"
                    onClick={() => {
                      if (!deleteMode) {
                        setDeleteMode(true);
                        return;
                      }
                      if (selected.size) {
                        setConfirmDelete(true);
                        return;
                      }
                      setDeleteMode(false);
                      clearSelection();
                    }}
                  >
                    <Trash2 className="h-4 w-4" />
                    {!deleteMode
                      ? "Delete"
                      : selected.size
                        ? `Delete (${selected.size})`
                        : "Cancel"}
                  </button>
                ) : null}
              </div>
            </div>
          </div>
        }
        rowSelection={
          deleteMode
            ? {
                selectedIds: selected,
                onToggleRow: (id) =>
                  setSelected((prev) => {
                    const next = new Set(prev);
                    if (next.has(id)) next.delete(id);
                    else next.add(id);
                    return next;
                  }),
                onToggleAllVisible: (checked, ids) =>
                  setSelected((prev) => {
                    const next = new Set(prev);
                    ids.forEach((id) => {
                      if (checked) next.add(id);
                      else next.delete(id);
                    });
                    return next;
                  }),
              }
            : undefined
        }
        columnWidthClass={(key) =>
          key === "courseTitle"
            ? "w-[23%]"
            : key === "fullName"
              ? "w-[19%]"
              : ""
        }
        mobileSummary={{
          title: (r) => r.fullName,
          subtitle: (r) => r.employeeIdNumber,
          avatarChar: (r) => r.fullName.trim().charAt(0).toUpperCase(),
        }}
        mobileExcludeFromGrid={["employeeIdNumber", "fullName"]}
        renderCell={(r, key) =>
          key === "fullName" ? (
            <div className="flex min-w-0 items-center gap-2">
              <span className="flex h-6 w-6 shrink-0 items-center justify-center rounded-full bg-[var(--primary-light)] text-xs text-[var(--primary)]">
                {r.fullName.trim().charAt(0).toUpperCase()}
              </span>
              <span className="truncate" title={r.fullName}>
                {r.fullName}
              </span>
            </div>
          ) : key === "trainingStartDate" ? (
            <span className="whitespace-nowrap">
              {displayTrainingDate(r.trainingStartDate)}
            </span>
          ) : key === "totalActualCost" || key === "budgetBalance" ? (
            <span
              className={`whitespace-nowrap tabular-nums ${key === "budgetBalance" && r.budgetBalance !== null && r.budgetBalance < 0 ? "text-rose-700" : ""}`}
            >
              {r[key] === null ? "—" : formatCurrency(r[key]!, r.currency)}
            </span>
          ) : (
            <span
              className="block truncate"
              title={String(r[key as keyof TrainingRecord] ?? "")}
            >
              {String(r[key as keyof TrainingRecord] ?? "—")}
            </span>
          )
        }
        renderDetailsCell={(r) => (
          <button
            type="button"
            aria-label={`View training details for ${r.fullName}`}
            onClick={() => setDetails(r)}
            className="inline-flex h-5 w-5 items-center justify-center rounded-full text-[var(--primary)] transition-colors hover:bg-[var(--primary-light)]"
          >
            <Eye className="h-3.5 w-3.5" />
          </button>
        )}
      />
      {details ? (
        <TrainingDetails
          record={details}
          canEdit={canEdit}
          onClose={() => setDetails(null)}
          onEdit={() => {
            setForm(details);
            setDetails(null);
          }}
        />
      ) : null}
      {form ? (
        <TrainingForm
          key={form === "new" ? "new" : form.id}
          data={data}
          record={form === "new" ? undefined : form}
          onClose={() => setForm(null)}
          onSave={onSave}
        />
      ) : null}
      {importOpen ? (
        <TrainingImport
          orgId={orgId}
          onClose={() => setImportOpen(false)}
          onImported={async (message) => {
            await onReload();
            setImportOpen(false);
            setNotice(message);
          }}
        />
      ) : null}
      <Modal
        isOpen={confirmDelete}
        onClose={() => {
          if (!deleting) setConfirmDelete(false);
        }}
        title="Delete Training Records"
        footer={
          <>
            <button
              disabled={deleting}
              type="button"
              onClick={() => setConfirmDelete(false)}
              className="h-9 rounded-xl border border-slate-200 px-4 text-sm text-slate-700"
            >
              Cancel
            </button>
            <button
              disabled={deleting}
              type="button"
              className="h-9 rounded-xl border border-rose-600 bg-rose-600 px-4 text-sm font-medium text-white disabled:opacity-50"
              onClick={async () => {
                setDeleting(true);
                setError("");
                try {
                  const result = await post("/api/training-records/delete", {
                    orgId,
                    ids: [...selected],
                  });
                  await onReload();
                  setConfirmDelete(false);
                  setDeleteMode(false);
                  clearSelection();
                  setNotice(
                    `Deleted ${result.deleted} training record${result.deleted === 1 ? "" : "s"}.`,
                  );
                } catch (err) {
                  setError(
                    err instanceof Error
                      ? err.message
                      : "Unable to delete trainings.",
                  );
                } finally {
                  setDeleting(false);
                }
              }}
            >
              {deleting
                ? "Deleting…"
                : `Delete ${selected.size} Training${selected.size === 1 ? "" : "s"}`}
            </button>
          </>
        }
      >
        <p className="text-sm text-slate-600">
          Delete the selected training records? Their costs will be removed from
          the linked budget balances and reports.
        </p>
      </Modal>
    </div>
  );
}
