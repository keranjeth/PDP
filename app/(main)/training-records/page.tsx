"use client";
import { useCallback, useEffect, useState } from "react";
import { useAppAuth } from "@/components/providers/AppProviders";
import { TrainingRecords } from "@/components/training/TrainingRecords";
import type { TrainingPageData } from "@/lib/training/types";
import { can } from "@/lib/user-management/permissions";

export default function TrainingRecordsPage() {
  const { orgId, membershipRole, isReady } = useAppAuth();
  const canRead = can(membershipRole, "budgets", "read");
  const [result, setResult] = useState<{
    orgId: string;
    data?: TrainingPageData;
    error?: string;
  } | null>(null);
  const reload = useCallback(async () => {
    if (!orgId || !isReady || !canRead) return;
    const response = await fetch(
      `/api/training-records?orgId=${encodeURIComponent(orgId)}`,
      { cache: "no-store" },
    );
    const data = await response.json();
    if (!response.ok)
      throw new Error(data.error || "Unable to load training records.");
    setResult({ orgId, data });
  }, [orgId, isReady, canRead]);
  useEffect(() => {
    if (!orgId || !isReady || !canRead) return;
    let cancelled = false;
    const load = async () => {
      try {
        const response = await fetch(
          `/api/training-records?orgId=${encodeURIComponent(orgId)}`,
          { cache: "no-store" },
        );
        const data = await response.json();
        if (!response.ok)
          throw new Error(data.error || "Unable to load training records.");
        if (!cancelled) setResult({ orgId, data });
      } catch (error) {
        if (!cancelled)
          setResult({
            orgId,
            error:
              error instanceof Error
                ? error.message
                : "Unable to load training records.",
          });
      }
    };
    void load();
    window.addEventListener("focus", load);
    return () => {
      cancelled = true;
      window.removeEventListener("focus", load);
    };
  }, [orgId, isReady, canRead]);
  if (isReady && !canRead)
    return (
      <p className="text-sm text-slate-600">
        You do not have permission to view training records.
      </p>
    );
  const current = result?.orgId === orgId ? result : null;
  if (current?.error)
    return (
      <p
        role="alert"
        className="rounded-xl border border-rose-200 bg-rose-50 p-4 text-sm text-rose-700"
      >
        {current.error}
      </p>
    );
  return (
    <TrainingRecords
      key={orgId ?? "loading"}
      orgId={orgId ?? ""}
      role={membershipRole}
      data={current?.data}
      loading={!current?.data}
      onReload={reload}
    />
  );
}
