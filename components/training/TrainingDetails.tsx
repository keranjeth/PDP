"use client";
import { Pencil } from "lucide-react";
import { Modal } from "@/components/ui/Modal";
import { formatCurrency } from "@/lib/format-currency";
import type { TrainingRecord } from "@/lib/training/types";

export function displayTrainingDate(value: string) {
  return new Date(`${value}T12:00:00Z`).toLocaleDateString("en-GB", {
    day: "numeric",
    month: "short",
    year: "numeric",
    timeZone: "UTC",
  });
}
export function TrainingDetails({
  record: r,
  canEdit,
  onEdit,
  onClose,
}: {
  record: TrainingRecord;
  canEdit: boolean;
  onEdit: () => void;
  onClose: () => void;
}) {
  const amount = (value: number | null) =>
    value === null ? "—" : formatCurrency(value, r.currency);
  const sections: Array<{ title: string; fields: Array<[string, string]> }> = [
    {
      title: "Employee Details",
      fields: [
        ["Employee ID", r.employeeIdNumber],
        ["Full Name", r.fullName],
        ["Gender", r.gender],
        ["Position Title", r.positionTitle],
        ["Department", r.department],
        ["Unit", r.unit],
        ["Region", r.region],
        ["Duty Station", r.dutyStation],
        ["Job Location", r.jobLocation],
        [
          "Employee Status",
          r.employmentStatus === "Inactive" ? "Separated" : r.employmentStatus,
        ],
      ],
    },
    {
      title: "Training Details",
      fields: [
        ["Training ID", r.trainingCode],
        ["Course Title", r.courseTitle],
        ["Delivery Method", r.deliveryMethod],
        ["Training Start Date", displayTrainingDate(r.trainingStartDate)],
        ["Training End Date", displayTrainingDate(r.trainingEndDate)],
        ["Currency", r.currency],
      ],
    },
    {
      title: "Budget Details",
      fields: [
        ["Budget ID", r.budgetCode || "Without a budget"],
        ["Initial Budget", amount(r.initialBudget)],
        ["Budget Adjustments", amount(r.budgetAdjustment)],
        ["Transfers In", amount(r.transfersIn)],
        ["Transfers Out", amount(r.transfersOut)],
        ["Current Budget", amount(r.currentBudget)],
        ["Budget Balance", amount(r.budgetBalance)],
      ],
    },
    {
      title: "Training Costs",
      fields: [
        ["Training Cost", amount(r.trainingCost)],
        ["Additional Cost", amount(r.additionalCost)],
        ["Total Actual Cost", amount(r.totalActualCost)],
        ["Additional Cost Note", r.additionalCostNote],
      ],
    },
  ];
  return (
    <Modal
      isOpen
      onClose={onClose}
      title="Training Details"
      subtitle={r.trainingCode}
      size="xl"
      footer={
        <>
          <button
            type="button"
            onClick={onClose}
            className="h-9 rounded-xl border border-slate-200 px-4 text-sm font-medium text-slate-700 hover:bg-slate-50"
          >
            Close
          </button>
          {canEdit ? (
            <button
              type="button"
              onClick={onEdit}
              className="inline-flex h-9 items-center gap-2 rounded-xl border border-[var(--primary)] px-4 text-sm font-medium text-[var(--primary)] hover:bg-[var(--primary-light)]"
            >
              <Pencil className="h-4 w-4" />
              Edit Training
            </button>
          ) : null}
        </>
      }
    >
      <div className="space-y-6">
        {sections.map((section) => (
          <section key={section.title}>
            <h4 className="mb-4 border-b border-slate-200 pb-2 text-sm font-semibold text-slate-900">
              {section.title}
            </h4>
            <dl className="grid grid-cols-1 gap-x-6 gap-y-4 text-sm sm:grid-cols-2">
              {section.fields.map(([label, value]) => (
                <div key={label}>
                  <dt className="text-slate-500">{label}</dt>
                  <dd className="mt-1 whitespace-pre-wrap break-words font-medium text-slate-900">
                    {value || "—"}
                  </dd>
                </div>
              ))}
            </dl>
          </section>
        ))}
        <section>
          <h4 className="mb-4 border-b border-slate-200 pb-2 text-sm font-semibold text-slate-900">
            Funding Sources
          </h4>
          {r.fundingSources.length ? (
            <dl className="space-y-2 text-sm">
              {r.fundingSources.map((s) => (
                <div key={s.name} className="flex justify-between gap-4">
                  <dt className="text-slate-700">{s.name}</dt>
                  <dd className="font-medium text-slate-900">
                    {amount(s.amount)}
                  </dd>
                </div>
              ))}
            </dl>
          ) : (
            <p className="text-sm text-slate-500">No funding sources added.</p>
          )}
        </section>
      </div>
    </Modal>
  );
}
