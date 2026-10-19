"use client";
import { useEffect, useState } from "react";
import { Download } from "lucide-react";
import { HeaderDivider } from "@/components/ui/HeaderDivider";
import { formatCurrency } from "@/lib/format-currency";
import { exportTrainingRecords } from "@/lib/training/excel";
import type { TrainingRecord } from "@/lib/training/types";

export function TrainingReport({ orgId }: { orgId: string }) {
  const [data, setData] = useState<{
    orgId: string;
    rows: TrainingRecord[];
  } | null>(null);
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const [currency, setCurrency] = useState("AFN");
  const [status, setStatus] = useState("all");
  const [from, setFrom] = useState("");
  const [to, setTo] = useState("");
  useEffect(() => {
    let cancelled = false;
    const load = async () => {
      try {
        const response = await fetch(
          `/api/training-records?orgId=${encodeURIComponent(orgId)}&recordsOnly=true`,
          { cache: "no-store" },
        );
        const body = await response.json();
        if (!response.ok)
          throw new Error(body.error || "Unable to load training report.");
        if (!cancelled) {
          setError("");
          setData({ orgId, rows: body.trainings });
        }
      } catch (err) {
        if (!cancelled)
          setError(
            err instanceof Error
              ? err.message
              : "Unable to load training report.",
          );
      }
    };
    void load();
    window.addEventListener("focus", load);
    return () => {
      cancelled = true;
      window.removeEventListener("focus", load);
    };
  }, [orgId]);
  const invalidDates = Boolean(from && to && from > to);
  const rows = (data?.orgId === orgId ? data.rows : []).filter(
    (r) =>
      r.currency === currency &&
      (status === "all" ||
        (status === "active"
          ? r.employmentStatus === "Active"
          : r.employmentStatus === "Inactive")) &&
      (!from || r.trainingStartDate >= from) &&
      (!to || r.trainingStartDate <= to),
  );
  const costs = rows.reduce((sum, r) => sum + r.trainingCost, 0);
  const additional = rows.reduce((sum, r) => sum + r.additionalCost, 0);
  const funding = new Map<string, number>();
  rows.forEach((r) => {
    if (!r.fundingSources.length)
      funding.set(
        "Unspecified",
        (funding.get("Unspecified") ?? 0) + r.totalActualCost,
      );
    else
      r.fundingSources.forEach((s) =>
        funding.set(s.name, (funding.get(s.name) ?? 0) + s.amount),
      );
  });
  const fieldClass =
    "h-9 rounded-xl border border-slate-200 bg-white px-3 text-sm text-slate-700";
  return (
    <section className="rounded-[18px] border border-slate-200/90 bg-white p-4 shadow-sm sm:p-5">
      <h3 className="text-base font-semibold text-slate-900">
        Training Report
      </h3>
      <p className="mt-1 text-sm text-slate-500">
        Export employee details, training dates, budget balances, actual costs,
        and funding sources.
      </p>
      <HeaderDivider className="my-4" />
      <div className="flex flex-wrap items-end gap-3">
        <label className="flex flex-col gap-1 text-sm text-slate-600">
          Currency
          <select
            className={fieldClass}
            value={currency}
            onChange={(e) => setCurrency(e.target.value)}
          >
            {["AFN", "USD", "EUR"].map((c) => (
              <option key={c}>{c}</option>
            ))}
          </select>
        </label>
        <label className="flex flex-col gap-1 text-sm text-slate-600">
          Employees
          <select
            className={fieldClass}
            value={status}
            onChange={(e) => setStatus(e.target.value)}
          >
            <option value="all">All</option>
            <option value="active">Active</option>
            <option value="leavers">Leavers</option>
          </select>
        </label>
        <label className="flex flex-col gap-1 text-sm text-slate-600">
          From Date
          <input
            type="date"
            className={fieldClass}
            value={from}
            onChange={(e) => setFrom(e.target.value)}
          />
        </label>
        <label className="flex flex-col gap-1 text-sm text-slate-600">
          To Date
          <input
            type="date"
            className={fieldClass}
            value={to}
            onChange={(e) => setTo(e.target.value)}
          />
        </label>
        <button
          type="button"
          disabled={busy || !rows.length || invalidDates}
          className="inline-flex h-9 items-center gap-2 rounded-xl border border-[var(--primary)] px-3 text-sm font-medium text-[var(--primary)] hover:bg-[var(--primary-light)] disabled:opacity-50"
          onClick={async () => {
            setBusy(true);
            try {
              await exportTrainingRecords(rows);
            } catch (err) {
              setError(err instanceof Error ? err.message : "Export failed.");
            } finally {
              setBusy(false);
            }
          }}
        >
          <Download className="h-4 w-4" />
          {busy ? "Exporting…" : "Download Excel"}
        </button>
      </div>
      {error ? (
        <p role="alert" className="mt-3 text-sm text-rose-700">
          {error}
        </p>
      ) : null}
      {invalidDates ? (
        <p role="alert" className="mt-3 text-sm text-rose-700">
          From Date cannot be later than To Date.
        </p>
      ) : null}
      {!data && !error ? (
        <p className="mt-5 text-sm text-slate-500">Loading training report…</p>
      ) : (
        <>
          <div className="mt-5 grid grid-cols-2 gap-4 text-sm lg:grid-cols-4">
            {[
              ["Trainings", String(rows.length)],
              ["Training Cost", formatCurrency(costs, currency)],
              ["Additional Cost", formatCurrency(additional, currency)],
              [
                "Total Actual Cost",
                formatCurrency(costs + additional, currency),
              ],
            ].map(([label, value]) => (
              <div key={label}>
                <p className="text-slate-500">{label}</p>
                <p className="mt-1 font-semibold text-slate-900">{value}</p>
              </div>
            ))}
          </div>
          {funding.size ? (
            <div className="mt-5 border-t border-slate-200 pt-4">
              <h4 className="text-sm font-semibold text-slate-900">
                Costs by Funding Source
              </h4>
              <dl className="mt-3 space-y-2 text-sm">
                {[...funding]
                  .sort((a, b) => b[1] - a[1])
                  .map(([name, amount]) => (
                    <div key={name} className="flex justify-between gap-4">
                      <dt className="text-slate-600">{name}</dt>
                      <dd className="tabular-nums text-slate-900">
                        {formatCurrency(amount, currency)}
                      </dd>
                    </div>
                  ))}
              </dl>
            </div>
          ) : (
            <p className="mt-4 text-sm text-slate-500">
              No training records for these filters.
            </p>
          )}
        </>
      )}
    </section>
  );
}
