"use client";

import { useEffect, useState } from "react";
import { DashboardOverview } from "@/components/dashboard/pd-overview";
import { useAppAuth } from "@/components/providers/AppProviders";
import type { PdDashboardData } from "@/lib/pd-dashboard";
import { employeeStore } from "@/lib/store";
import { can } from "@/lib/user-management/permissions";

export default function DashboardPage() {
  const { orgId, membershipRole, isReady } = useAppAuth();
  const isEmployee = membershipRole === "employee";
  const canReadBudgets = can(membershipRole, "budgets", "read");
  const [result, setResult] = useState<{
    orgId: string;
    data?: PdDashboardData;
    error?: string;
  } | null>(null);

  useEffect(() => {
    if (!isReady || !orgId || !canReadBudgets || isEmployee) return;
    const controller = new AbortController();
    const load = async () => {
      try {
        const response = await fetch(
          `/api/dashboard?orgId=${encodeURIComponent(orgId)}`,
          {
            signal: controller.signal,
            cache: "no-store",
          },
        );
        if (!response.ok) {
          const body = await response.json().catch(() => ({}));
          throw new Error(body.error ?? "Unable to load the overview.");
        }
        const data = (await response.json()) as PdDashboardData;
        if (!controller.signal.aborted) setResult({ orgId, data });
      } catch (error) {
        if (!controller.signal.aborted)
          setResult({
            orgId,
            error:
              error instanceof Error
                ? error.message
                : "Unable to load the overview.",
          });
      }
    };
    void load();
    window.addEventListener("focus", load);
    return () => {
      controller.abort();
      window.removeEventListener("focus", load);
    };
  }, [isReady, orgId, canReadBudgets, isEmployee]);

  if (isEmployee) {
    const self = employeeStore.getEmployees()[0] ?? null;
    return (
      <div className="mx-auto max-w-7xl space-y-4">
        <div className="rounded-[18px] border border-slate-200/90 bg-white p-4 shadow-sm sm:p-6">
          <h3 className="text-lg font-semibold text-slate-900">Welcome back</h3>
          <p className="mt-1 text-sm text-slate-500">
            {self
              ? `Signed in as ${self.fullName}. Use My Profile to review your employee record.`
              : "Use My Profile to review your employee record when it is linked to your account."}
          </p>
        </div>
      </div>
    );
  }

  if (isReady && !canReadBudgets) {
    return (
      <p className="mx-auto max-w-7xl text-sm text-slate-600">
        You do not have permission to view this overview.
      </p>
    );
  }
  const current = result?.orgId === orgId ? result : null;
  if (current?.error) {
    return (
      <div
        role="alert"
        className="mx-auto max-w-7xl rounded-[18px] border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-800"
      >
        {current.error}
      </div>
    );
  }
  return <DashboardOverview data={current?.data} loading={!current?.data} />;
}
