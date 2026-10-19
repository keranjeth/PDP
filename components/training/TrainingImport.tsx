"use client";
import { useState } from "react";
import { Download, Upload } from "lucide-react";
import { ImportModalShell } from "@/components/ui/ImportModalShell";
import {
  downloadTrainingTemplate,
  exportTrainingIssues,
  readTrainingWorkbook,
} from "@/lib/training/excel";
import type {
  TrainingImportRow,
  TrainingImportIssue,
} from "@/lib/training/import";
import type { TrainingInput } from "@/lib/training/types";

type Preview = {
  validRows: Array<{
    rowNumber: number;
    training: TrainingInput;
    fullName: string;
  }>;
  issues: TrainingImportIssue[];
};
const actionClass =
  "inline-flex h-9 items-center justify-center gap-2 rounded-xl border border-[var(--primary)] px-3 text-sm font-medium text-[var(--primary)] hover:bg-[var(--primary-light)] disabled:opacity-50";
export function TrainingImport({
  orgId,
  onClose,
  onImported,
}: {
  orgId: string;
  onClose: () => void;
  onImported: (message: string) => Promise<void>;
}) {
  const [rows, setRows] = useState<TrainingImportRow[]>([]);
  const [preview, setPreview] = useState<Preview | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const post = async (action: string, input: TrainingImportRow[]) => {
    const response = await fetch("/api/training-records/import", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ orgId, action, rows: input }),
    });
    const result = await response.json();
    if (!response.ok)
      throw new Error(result.error || "Unable to process this file.");
    return result;
  };
  return (
    <ImportModalShell
      isOpen
      title="Import Training Records"
      icon={<Upload className="h-5 w-5" />}
      onClose={() => {
        if (!busy) onClose();
      }}
    >
      <div className="space-y-5">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <p className="max-w-lg text-sm text-slate-600">
            Use one row per employee per training. Employee IDs must match
            Employees. Add Budget ID to link costs to an existing budget.
          </p>
          <button
            disabled={busy}
            className={actionClass}
            type="button"
            onClick={() =>
              void downloadTrainingTemplate().catch((e) => setError(String(e)))
            }
          >
            <Download className="h-4 w-4" />
            Download Template
          </button>
        </div>
        <p className="text-xs text-slate-500">
          Course Title and Currency can be left blank when Budget ID is
          supplied. Enter actual training dates. For funding splits, use Source:
          amount; Source: amount.
        </p>
        <label className="block rounded-xl border-2 border-dashed border-slate-200 bg-slate-50 p-5 text-sm font-medium text-slate-700">
          Choose Excel or CSV file
          <input
            type="file"
            accept=".xlsx,.xls,.csv"
            disabled={busy}
            className="mt-3 block w-full text-sm text-slate-500 file:mr-3 file:rounded-lg file:border file:border-slate-200 file:bg-white file:px-3 file:py-2 file:text-slate-700"
            onChange={async (e) => {
              const file = e.target.files?.[0];
              setRows([]);
              setPreview(null);
              setError("");
              if (!file) return;
              setBusy(true);
              try {
                const input = await readTrainingWorkbook(file);
                if (!input.length)
                  throw new Error(
                    "No training rows found. The sample row is ignored.",
                  );
                setRows(input);
                setPreview(await post("preview", input));
              } catch (err) {
                setError(
                  err instanceof Error
                    ? err.message
                    : "Unable to read this file.",
                );
              } finally {
                setBusy(false);
              }
            }}
          />
        </label>
        {busy ? (
          <p className="text-sm text-slate-500" role="status">
            Processing…
          </p>
        ) : null}
        {error ? (
          <p
            role="alert"
            className="rounded-xl border border-rose-200 bg-rose-50 p-3 text-sm text-rose-700"
          >
            {error}
          </p>
        ) : null}
        {preview ? (
          <div className="space-y-3">
            <p className="text-sm font-medium text-slate-800">
              Ready to import: {preview.validRows.length} · Excluded:{" "}
              {preview.issues.length}
            </p>
            {preview.validRows.length ? (
              <div className="max-h-48 overflow-auto rounded-xl border border-slate-200">
                <table className="w-full text-left text-sm">
                  <thead className="bg-slate-50">
                    <tr>
                      <th className="px-3 py-2">Employee ID</th>
                      <th className="px-3 py-2">Full Name</th>
                      <th className="px-3 py-2">Course Title</th>
                    </tr>
                  </thead>
                  <tbody>
                    {preview.validRows.slice(0, 5).map((r) => (
                      <tr
                        key={r.rowNumber}
                        className="border-t border-slate-100"
                      >
                        <td className="px-3 py-2">
                          {
                            rows.find((x) => x.rowNumber === r.rowNumber)
                              ?.employeeIdNumber
                          }
                        </td>
                        <td className="px-3 py-2">{r.fullName}</td>
                        <td className="px-3 py-2">{r.training.courseTitle}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            ) : null}
            {preview.issues.length ? (
              <>
                <p className="text-sm text-slate-600">
                  Excluded rows are listed in Records to Check. Existing
                  training costs are never overwritten by an import.
                </p>
                <button
                  disabled={busy}
                  className={actionClass}
                  type="button"
                  onClick={() =>
                    void exportTrainingIssues(preview.issues).catch((e) =>
                      setError(String(e)),
                    )
                  }
                >
                  <Download className="h-4 w-4" />
                  Download Records to Check
                </button>
              </>
            ) : null}
            <div className="flex justify-end">
              <button
                disabled={busy || !preview.validRows.length}
                className={`${actionClass} !bg-[var(--primary)] !text-white`}
                type="button"
                onClick={async () => {
                  setBusy(true);
                  setError("");
                  try {
                    const result = await post("import", rows);
                    await onImported(
                      `Imported ${result.imported} training record${result.imported === 1 ? "" : "s"}.${result.skipped || result.issues?.length ? ` Skipped ${(result.skipped || 0) + (result.issues?.length || 0)} duplicate or invalid rows.` : ""}`,
                    );
                  } catch (err) {
                    setError(
                      err instanceof Error ? err.message : "Import failed.",
                    );
                  } finally {
                    setBusy(false);
                  }
                }}
              >
                {busy
                  ? "Importing…"
                  : `Import ${preview.validRows.length} Training${preview.validRows.length === 1 ? "" : "s"}`}
              </button>
            </div>
          </div>
        ) : null}
      </div>
    </ImportModalShell>
  );
}
