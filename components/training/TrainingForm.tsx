"use client";

import { useState } from "react";
import { Plus, Trash2 } from "lucide-react";
import { Modal } from "@/components/ui/Modal";
import { formatCurrency } from "@/lib/format-currency";
import {
  DELIVERY_METHODS,
  type TrainingInput,
  type TrainingPageData,
  type TrainingRecord,
} from "@/lib/training/types";
import { parseTrainingInput } from "@/lib/training/validation";

const inputClass =
  "mt-1 h-10 w-full rounded-xl border border-slate-200 bg-white px-3 text-sm text-slate-800 outline-none focus:border-[var(--primary)] disabled:bg-slate-50 disabled:text-slate-500";
const buttonClass =
  "inline-flex h-9 items-center justify-center gap-2 rounded-xl border border-slate-200 px-4 text-sm font-medium text-slate-700 hover:bg-slate-50 disabled:opacity-50";
export function TrainingForm({
  data,
  record,
  onClose,
  onSave,
}: {
  data: TrainingPageData;
  record?: TrainingRecord;
  onClose: () => void;
  onSave: (input: TrainingInput, requestId: string) => Promise<void>;
}) {
  const [requestId] = useState(() => crypto.randomUUID());
  const [employeeNumber, setEmployeeNumber] = useState(
    record?.employeeIdNumber ?? "",
  );
  const [budgetId, setBudgetId] = useState(record?.budgetId ?? "");
  const [courseTitle, setCourseTitle] = useState(record?.courseTitle ?? "");
  const [deliveryMethod, setDeliveryMethod] = useState<string>(
    record?.deliveryMethod ?? "In Person",
  );
  const [start, setStart] = useState(record?.trainingStartDate ?? "");
  const [end, setEnd] = useState(record?.trainingEndDate ?? "");
  const [cost, setCost] = useState(record ? String(record.trainingCost) : "");
  const [extra, setExtra] = useState(String(record?.additionalCost ?? 0));
  const [note, setNote] = useState(record?.additionalCostNote ?? "");
  const [currency, setCurrency] = useState<string>(record?.currency ?? "AFN");
  const [sources, setSources] = useState(
    (record?.fundingSources ?? []).map((s) => ({
      name: s.name,
      amount: String(s.amount),
    })),
  );
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const employee = data.employees.find(
    (e) => e.idNumber === employeeNumber.trim(),
  );
  const budgets = data.budgets.filter((b) => b.employeeId === employee?.id);
  const budget = budgets.find((b) => b.id === budgetId);
  const total =
    Math.round(((Number(cost) || 0) + (Number(extra) || 0)) * 100) / 100;
  const projectedBalance = budget
    ? budget.remainingAmount +
      (record?.budgetId === budget.id ? record.totalActualCost : 0) -
      total
    : null;
  const changeEmployee = (id: string) => {
    setEmployeeNumber(id);
    setBudgetId("");
  };
  const chooseBudget = (id: string) => {
    setBudgetId(id);
    const b = budgets.find((x) => x.id === id);
    if (b) {
      setCourseTitle(b.plannedCourse);
      setCurrency(b.currency);
    }
  };
  return (
    <Modal
      isOpen
      onClose={() => {
        if (!busy) onClose();
      }}
      title={record ? "Edit Training" : "New Training"}
      subtitle={record?.trainingCode}
      size="xl"
      footer={
        <>
          <button
            type="button"
            disabled={busy}
            className={buttonClass}
            onClick={onClose}
          >
            Cancel
          </button>
          <button
            form="training-form"
            type="submit"
            disabled={busy}
            className={`${buttonClass} !border-[var(--primary)] !bg-[var(--primary)] !text-white hover:!bg-[var(--primary-hover)]`}
          >
            {busy ? "Saving…" : "Save Training"}
          </button>
        </>
      }
    >
      <form
        id="training-form"
        className="space-y-6"
        onSubmit={async (event) => {
          event.preventDefault();
          if (busy) return;
          setError("");
          try {
            const training = parseTrainingInput({
              employeeId: employee?.id,
              budgetId: budgetId || null,
              courseTitle,
              deliveryMethod,
              trainingStartDate: start,
              trainingEndDate: end,
              trainingCost: cost,
              additionalCost: extra,
              additionalCostNote: note,
              currency,
              fundingSources: sources,
            });
            setBusy(true);
            await onSave(training, requestId);
          } catch (err) {
            setError(
              err instanceof Error ? err.message : "Unable to save training.",
            );
          } finally {
            setBusy(false);
          }
        }}
      >
        {error ? (
          <p
            role="alert"
            className="rounded-xl border border-rose-200 bg-rose-50 px-3 py-2 text-sm text-rose-700"
          >
            {error}
          </p>
        ) : null}
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
          <label className="text-sm font-medium text-slate-700">
            Employee ID
            <input
              list="training-employee-options"
              required
              disabled={busy || Boolean(record)}
              className={inputClass}
              value={employeeNumber}
              onChange={(e) => changeEmployee(e.target.value)}
              placeholder="Enter or select Employee ID"
              autoComplete="off"
            />
            <datalist id="training-employee-options">
              {data.employees.map((e) => (
                <option key={e.id} value={e.idNumber}>
                  {e.fullName}
                  {e.employmentStatus === "Inactive" ? " (Separated)" : ""}
                </option>
              ))}
            </datalist>
          </label>
          <label className="text-sm font-medium text-slate-700">
            Full Name
            <input
              className={inputClass}
              disabled
              value={employee?.fullName ?? ""}
              placeholder="Fetched from Employees"
            />
          </label>
          <label className="text-sm font-medium text-slate-700 sm:col-span-2">
            Training Budget
            <select
              className={inputClass}
              disabled={busy || !employee}
              value={budgetId}
              onChange={(e) => chooseBudget(e.target.value)}
            >
              <option value="">Without a budget</option>
              {budgets.map((b) => (
                <option key={b.id} value={b.id}>
                  {b.budgetCode} · {b.plannedCourse} · Balance{" "}
                  {formatCurrency(b.remainingAmount, b.currency)}
                </option>
              ))}
            </select>
          </label>
        </div>
        {budget ? (
          <div className="grid grid-cols-2 gap-4 rounded-xl border border-slate-200 bg-slate-50 p-4 text-sm sm:grid-cols-3">
            <div>
              <p className="text-slate-500">Initial Budget</p>
              <p className="mt-1 font-medium text-slate-900">
                {formatCurrency(budget.initialAmount, budget.currency)}
              </p>
            </div>
            <div>
              <p className="text-slate-500">Current Budget</p>
              <p className="mt-1 font-medium text-slate-900">
                {formatCurrency(budget.currentAmount, budget.currency)}
              </p>
            </div>
            <div>
              <p className="text-slate-500">Budget Balance</p>
              <p className="mt-1 font-medium text-slate-900">
                {formatCurrency(budget.remainingAmount, budget.currency)}
              </p>
            </div>
          </div>
        ) : (
          <p className="text-sm text-slate-500">
            Select a training budget to deduct these costs from its balance.
          </p>
        )}
        <section className="space-y-4">
          <h4 className="border-b border-slate-200 pb-2 text-sm font-semibold text-slate-900">
            Training Details
          </h4>
          <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
            <label className="text-sm font-medium text-slate-700 sm:col-span-2">
              Course Title
              <input
                required
                maxLength={500}
                disabled={busy}
                className={inputClass}
                value={courseTitle}
                onChange={(e) => setCourseTitle(e.target.value)}
              />
            </label>
            <label className="text-sm font-medium text-slate-700">
              Delivery Method
              <select
                required
                disabled={busy}
                className={inputClass}
                value={deliveryMethod}
                onChange={(e) => setDeliveryMethod(e.target.value)}
              >
                {DELIVERY_METHODS.map((m) => (
                  <option key={m}>{m}</option>
                ))}
              </select>
            </label>
            <label className="text-sm font-medium text-slate-700">
              Currency
              <select
                disabled={busy || Boolean(budget)}
                className={inputClass}
                value={currency}
                onChange={(e) => setCurrency(e.target.value)}
              >
                {["AFN", "USD", "EUR"].map((c) => (
                  <option key={c}>{c}</option>
                ))}
              </select>
            </label>
            <label className="text-sm font-medium text-slate-700">
              Training Start Date
              <input
                type="date"
                required
                disabled={busy}
                className={inputClass}
                value={start}
                onChange={(e) => {
                  setStart(e.target.value);
                  if (!end) setEnd(e.target.value);
                }}
              />
            </label>
            <label className="text-sm font-medium text-slate-700">
              Training End Date
              <input
                type="date"
                required
                min={start || undefined}
                disabled={busy}
                className={inputClass}
                value={end}
                onChange={(e) => setEnd(e.target.value)}
              />
            </label>
          </div>
        </section>
        <section className="space-y-4">
          <h4 className="border-b border-slate-200 pb-2 text-sm font-semibold text-slate-900">
            Training Costs
          </h4>
          <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
            <label className="text-sm font-medium text-slate-700">
              Training Cost
              <input
                type="number"
                required
                min="0"
                step="0.01"
                disabled={busy}
                className={inputClass}
                value={cost}
                onChange={(e) => setCost(e.target.value)}
              />
            </label>
            <label className="text-sm font-medium text-slate-700">
              Additional Cost
              <input
                type="number"
                required
                min="0"
                step="0.01"
                disabled={busy}
                className={inputClass}
                value={extra}
                onChange={(e) => setExtra(e.target.value)}
              />
            </label>
            <label className="text-sm font-medium text-slate-700 sm:col-span-2">
              Additional Cost Note
              <textarea
                required={Number(extra) > 0}
                maxLength={2000}
                disabled={busy}
                className={`${inputClass} h-20 py-2`}
                value={note}
                onChange={(e) => setNote(e.target.value)}
                placeholder="For example, travel or Mahram costs"
              />
            </label>
          </div>
          <div className="flex flex-wrap justify-between gap-3 rounded-xl border border-[var(--primary-border)] bg-[var(--primary-light)] p-4 text-sm">
            <span>
              Total Actual Cost{" "}
              <strong className="ml-2 text-slate-900">
                {formatCurrency(total, currency)}
              </strong>
            </span>
            {projectedBalance !== null ? (
              <span>
                Balance after this training{" "}
                <strong
                  className={`ml-2 ${projectedBalance < 0 ? "text-rose-700" : "text-slate-900"}`}
                >
                  {formatCurrency(projectedBalance, currency)}
                </strong>
              </span>
            ) : null}
          </div>
        </section>
        <section className="space-y-3">
          <div className="flex items-center justify-between gap-3">
            <h4 className="text-sm font-semibold text-slate-900">
              Funding Sources
            </h4>
            <button
              type="button"
              disabled={busy || sources.length >= 20}
              className={buttonClass}
              onClick={() => setSources([...sources, { name: "", amount: "" }])}
            >
              <Plus className="h-4 w-4" />
              Add Source
            </button>
          </div>
          {sources.length ? (
            <p className="text-xs text-slate-500">
              Funding amounts must total {formatCurrency(total, currency)}.
            </p>
          ) : (
            <p className="text-sm text-slate-500">
              Optional. Add a source and amount when funding is known.
            </p>
          )}
          {sources.map((source, index) => (
            <div
              key={index}
              className="grid grid-cols-[minmax(0,1fr)_minmax(100px,160px)_36px] items-end gap-2"
            >
              <label className="text-sm text-slate-700">
                Source
                <input
                  required
                  maxLength={200}
                  disabled={busy}
                  className={inputClass}
                  value={source.name}
                  onChange={(e) =>
                    setSources(
                      sources.map((s, i) =>
                        i === index ? { ...s, name: e.target.value } : s,
                      ),
                    )
                  }
                />
              </label>
              <label className="text-sm text-slate-700">
                Amount
                <input
                  type="number"
                  required
                  min="0"
                  step="0.01"
                  disabled={busy}
                  className={inputClass}
                  value={source.amount}
                  onChange={(e) =>
                    setSources(
                      sources.map((s, i) =>
                        i === index ? { ...s, amount: e.target.value } : s,
                      ),
                    )
                  }
                />
              </label>
              <button
                type="button"
                disabled={busy}
                aria-label={`Remove funding source ${index + 1}`}
                className="mb-1 rounded-lg p-2 text-rose-600 hover:bg-rose-50"
                onClick={() =>
                  setSources(sources.filter((_, i) => i !== index))
                }
              >
                <Trash2 className="h-4 w-4" />
              </button>
            </div>
          ))}
        </section>
      </form>
    </Modal>
  );
}
