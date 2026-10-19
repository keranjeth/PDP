"use client";

import type { ChangeEvent, DragEvent } from "react";
import { useRef, useState } from "react";
import { Button } from "@/components/ui/Button";
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
    createBudget?: boolean;
  }>;
  issues: TrainingImportIssue[];
  budgetsToCreate?: number;
};

function UploadIcon({ className }: { className: string }) {
  return (
    <svg
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.8"
      strokeLinecap="round"
      strokeLinejoin="round"
      className={className}
      aria-hidden="true"
    >
      <path d="M12 16V4" />
      <path d="m7 9 5-5 5 5" />
      <path d="M20 16.5V18a2 2 0 0 1-2 2H6a2 2 0 0 1-2-2v-1.5" />
    </svg>
  );
}

function ImportSelectedFileRow({
  fileName,
  onRemove,
  removeDisabled,
}: {
  fileName: string;
  onRemove: () => void;
  removeDisabled: boolean;
}) {
  return (
    <div className="flex items-center justify-between gap-3 rounded-xl border border-slate-200 bg-white px-4 py-3 shadow-sm">
      <div className="flex min-w-0 flex-1 items-center gap-2">
        <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg bg-slate-100 text-slate-500">
          <UploadIcon className="h-4 w-4" />
        </div>
        <span className="truncate text-sm font-medium text-slate-900" title={fileName}>
          {fileName}
        </span>
      </div>
      <button
        type="button"
        onClick={onRemove}
        disabled={removeDisabled}
        className="shrink-0 rounded-lg px-3 py-1.5 text-sm font-medium text-red-700 transition-colors hover:bg-red-50 disabled:pointer-events-none disabled:opacity-40"
      >
        Remove
      </button>
    </div>
  );
}

export function TrainingImport({
  orgId,
  onClose,
  onImported,
}: {
  orgId: string;
  onClose: () => void;
  onImported: (message: string) => Promise<void>;
}) {
  const fileInputRef = useRef<HTMLInputElement>(null);
  const [fileName, setFileName] = useState<string | null>(null);
  const [rows, setRows] = useState<TrainingImportRow[]>([]);
  const [preview, setPreview] = useState<Preview | null>(null);
  const [busy, setBusy] = useState(false);
  const [isImporting, setIsImporting] = useState(false);
  const [error, setError] = useState("");
  const [isDragActive, setIsDragActive] = useState(false);

  const post = async (action: string, input: TrainingImportRow[]) => {
    const response = await fetch("/api/training-records/import", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ orgId, action, rows: input }),
    });
    const result = await response.json();
    if (!response.ok) {
      throw new Error(result.error || "Unable to process this file.");
    }
    return result as Preview & {
      imported?: number;
      skipped?: number;
      budgetsCreated?: number;
      issues?: TrainingImportIssue[];
    };
  };

  const clearFile = () => {
    setFileName(null);
    setRows([]);
    setPreview(null);
    setError("");
    if (fileInputRef.current) fileInputRef.current.value = "";
  };

  const processFile = async (file: File) => {
    setFileName(file.name);
    setRows([]);
    setPreview(null);
    setError("");
    setBusy(true);
    try {
      const input = await readTrainingWorkbook(file);
      if (!input.length) {
        throw new Error(
          "No training rows found. The sample row is ignored — add real rows and try again.",
        );
      }
      setRows(input);
      setPreview(await post("preview", input));
    } catch (err) {
      setError(err instanceof Error ? err.message : "Unable to read this file.");
      setRows([]);
      setPreview(null);
    } finally {
      setBusy(false);
    }
  };

  const onFileChange = async (event: ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    if (file) await processFile(file);
    event.target.value = "";
  };

  const onDrop = async (event: DragEvent<HTMLDivElement>) => {
    event.preventDefault();
    event.stopPropagation();
    setIsDragActive(false);
    if (busy || isImporting) return;
    const file = event.dataTransfer.files?.[0];
    if (file) await processFile(file);
  };

  const showLargeDropZone = !fileName;
  const removeDisabled = busy || isImporting;
  const budgetsToCreate =
    preview?.budgetsToCreate ??
    preview?.validRows.filter((r) => r.createBudget).length ??
    0;

  return (
    <ImportModalShell
      isOpen
      title="Import training records"
      icon={<UploadIcon className="h-6 w-6" />}
      onClose={() => {
        if (!busy && !isImporting) onClose();
      }}
    >
      {isImporting ? (
        <div className="space-y-8">
          <div className="flex items-center justify-center">
            <div className="relative flex h-24 w-24 items-center justify-center rounded-full bg-[var(--primary-light)]">
              <div className="absolute inset-0 animate-pulse rounded-full border border-[var(--primary-border)]" />
              <div className="h-14 w-14 animate-spin rounded-full border-4 border-[var(--primary)] border-t-transparent" />
            </div>
          </div>
          <div className="text-center">
            <p className="text-[22px] font-semibold text-slate-950">
              Importing training records
            </p>
            <p className="mt-2 text-[15px] text-slate-500">
              Creating missing budgets when needed, then saving training rows…
            </p>
          </div>
        </div>
      ) : (
        <div className="space-y-6">
          <div className="space-y-2 text-center">
            <p className="text-[15px] font-semibold text-slate-800">
              <button
                type="button"
                disabled={busy}
                onClick={() =>
                  void downloadTrainingTemplate().catch((e) =>
                    setError(String(e)),
                  )
                }
                className="font-semibold text-[var(--primary)] underline-offset-4 hover:text-[var(--primary-hover)] hover:underline disabled:opacity-50"
              >
                Download training template
              </button>
              <span className="font-semibold text-slate-800">
                {" "}
                → fill in data → upload here.
              </span>
            </p>
            <p className="text-sm font-normal text-slate-600">
              Leave Budget ID blank to create a new budget from Course Title,
              Training Cost, Currency, and Start Date.
            </p>
          </div>

          {showLargeDropZone ? (
            <div
              className={`rounded-[18px] border-2 border-dashed px-5 py-10 text-center transition-colors sm:px-8 sm:py-12 ${
                isDragActive
                  ? "border-[var(--primary)] bg-[var(--primary-light)]"
                  : "border-slate-200 bg-white"
              }`}
              onDragEnter={(e) => {
                e.preventDefault();
                e.stopPropagation();
                if (!busy) setIsDragActive(true);
              }}
              onDragLeave={(e) => {
                e.preventDefault();
                e.stopPropagation();
                const related = e.relatedTarget as Node | null;
                if (!e.currentTarget.contains(related)) setIsDragActive(false);
              }}
              onDragOver={(e) => {
                e.preventDefault();
                e.stopPropagation();
              }}
              onDrop={(e) => {
                void onDrop(e);
              }}
            >
              <div className="mx-auto flex h-16 w-16 items-center justify-center rounded-full bg-slate-100 text-slate-500">
                <UploadIcon className="h-8 w-8" />
              </div>
              <h4 className="mt-7 text-[18px] font-semibold text-slate-950">
                Upload XLSX File
              </h4>
              <p className="mt-3 text-[15px] text-slate-500">
                Drag and drop your file here, or click to browse
              </p>
              <div className="mt-7">
                <Button
                  type="button"
                  className="w-full !rounded-xl !bg-[var(--primary)] px-6 py-3 !text-[15px] font-semibold hover:!bg-[var(--primary-hover)] sm:min-w-[160px] sm:w-auto"
                  onClick={() => fileInputRef.current?.click()}
                  disabled={busy}
                >
                  {busy ? "Validating…" : "Choose File"}
                </Button>
              </div>
            </div>
          ) : null}

          {fileName ? (
            <ImportSelectedFileRow
              fileName={fileName}
              onRemove={clearFile}
              removeDisabled={removeDisabled}
            />
          ) : null}

          {busy && !preview ? (
            <div className="rounded-2xl border border-slate-200 bg-slate-50 px-5 py-4">
              <p className="text-sm font-medium text-slate-800">Validating file…</p>
              <p className="mt-1 text-sm text-slate-600">
                Matching employees and preparing training rows.
              </p>
            </div>
          ) : null}

          {preview ? (
            <div className="space-y-4 rounded-2xl border border-emerald-200 bg-emerald-50/60 px-5 py-4">
              <div className="flex flex-col gap-4 sm:flex-row sm:items-start sm:justify-between">
                <div>
                  <p className="text-sm font-medium text-emerald-900">
                    Ready to import
                  </p>
                  <p className="mt-1 text-sm text-emerald-800">
                    {preview.validRows.length} training row
                    {preview.validRows.length === 1 ? "" : "s"} ·{" "}
                    {preview.issues.length} excluded
                    {budgetsToCreate > 0
                      ? ` · ${budgetsToCreate} new budget${budgetsToCreate === 1 ? "" : "s"} will be created`
                      : ""}
                    .
                  </p>
                </div>
                <div className="flex w-full flex-col gap-2 sm:w-auto">
                  <Button
                    type="button"
                    className="w-full !rounded-xl !bg-[var(--primary)] px-5 py-2.5 !text-sm font-semibold hover:!bg-[var(--primary-hover)] sm:w-auto"
                    disabled={busy || !preview.validRows.length}
                    onClick={async () => {
                      setIsImporting(true);
                      setError("");
                      try {
                        const result = await post("import", rows);
                        const created = Number(result.budgetsCreated ?? 0);
                        await onImported(
                          `Imported ${result.imported ?? 0} training record${
                            (result.imported ?? 0) === 1 ? "" : "s"
                          }.${
                            created > 0
                              ? ` Created ${created} budget${created === 1 ? "" : "s"}.`
                              : ""
                          }${
                            result.skipped || result.issues?.length
                              ? ` Skipped ${(result.skipped || 0) + (result.issues?.length || 0)} duplicate or invalid rows.`
                              : ""
                          }`,
                        );
                      } catch (err) {
                        setError(
                          err instanceof Error ? err.message : "Import failed.",
                        );
                      } finally {
                        setIsImporting(false);
                      }
                    }}
                  >
                    {preview.validRows.length === 0
                      ? "Nothing new to import"
                      : `Import ${preview.validRows.length} record${
                          preview.validRows.length === 1 ? "" : "s"
                        }`}
                  </Button>
                  {preview.issues.length > 0 ? (
                    <button
                      type="button"
                      disabled={busy}
                      onClick={() =>
                        void exportTrainingIssues(preview.issues).catch((e) =>
                          setError(String(e)),
                        )
                      }
                      className="inline-flex h-9 items-center justify-center rounded-xl border border-slate-200 bg-white px-3 text-sm font-medium text-slate-700 transition-colors hover:bg-slate-50 disabled:opacity-50"
                    >
                      Download Records to Check
                    </button>
                  ) : null}
                </div>
              </div>

              {preview.validRows.length > 0 ? (
                <div className="max-h-56 overflow-auto rounded-xl border border-emerald-200 bg-white">
                  <table className="min-w-full text-left text-xs text-slate-800">
                    <thead className="sticky top-0 bg-slate-50 text-[11px] uppercase tracking-wide text-slate-500">
                      <tr>
                        <th className="px-3 py-2">Row</th>
                        <th className="px-3 py-2">Employee ID</th>
                        <th className="px-3 py-2">Name</th>
                        <th className="px-3 py-2">Course</th>
                        <th className="px-3 py-2">Budget</th>
                      </tr>
                    </thead>
                    <tbody>
                      {preview.validRows.slice(0, 40).map((r) => {
                        const source = rows.find(
                          (x) => x.rowNumber === r.rowNumber,
                        );
                        return (
                          <tr
                            key={r.rowNumber}
                            className="border-t border-slate-100"
                          >
                            <td className="px-3 py-2 tabular-nums">
                              {r.rowNumber}
                            </td>
                            <td className="px-3 py-2">
                              {source?.employeeIdNumber}
                            </td>
                            <td className="px-3 py-2">{r.fullName}</td>
                            <td className="px-3 py-2">
                              {r.training.courseTitle}
                            </td>
                            <td className="px-3 py-2">
                              {r.createBudget
                                ? "Create new"
                                : source?.budgetCode || "Linked"}
                            </td>
                          </tr>
                        );
                      })}
                    </tbody>
                  </table>
                </div>
              ) : null}
            </div>
          ) : null}

          {error ? (
            <div className="rounded-2xl border border-red-200 bg-red-50 px-5 py-4">
              <p className="text-sm font-medium text-red-900">
                Import could not continue
              </p>
              <p className="mt-1 text-sm text-red-800">{error}</p>
            </div>
          ) : null}

          <input
            ref={fileInputRef}
            type="file"
            accept=".xlsx,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"
            className="hidden"
            onChange={(e) => {
              void onFileChange(e);
            }}
          />
        </div>
      )}
    </ImportModalShell>
  );
}
