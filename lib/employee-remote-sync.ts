import type { SupabaseClient } from '@supabase/supabase-js';
import {
  fetchEmployeesFromSupabase,
  softDeleteEmployeeRemote,
  syncEmployeesToSupabase,
  type EmployeeRemoteSnapshot,
} from '@/lib/supabase/employee-db';
import { employeeStore } from '@/lib/store';
import { formatSupabaseError } from '@/lib/supabase/error-format';

let supabase: SupabaseClient | null = null;
let orgId: string | null = null;
let debounceTimer: ReturnType<typeof setTimeout> | null = null;
let pendingSync = false;

export function configureEmployeeRemoteSync(
  client: SupabaseClient | null,
  organizationId: string | null
) {
  supabase = client;
  orgId = organizationId;

  if (!client || !organizationId) {
    pendingSync = false;
  }

  if (pendingSync && supabase && orgId && typeof window !== 'undefined') {
    pendingSync = false;
    void syncEmployeesToSupabase(supabase, orgId, buildSnapshot()).catch((err) =>
      console.error('Employee remote sync failed:', formatSupabaseError(err), err)
    );
  }
}

/** @deprecated Use configureEmployeeRemoteSync */
export const configurePayrollRemoteSync = configureEmployeeRemoteSync;

function buildSnapshot(): EmployeeRemoteSnapshot {
  return {
    employees: employeeStore.getEmployees(),
  };
}

export function scheduleEmployeeRemoteSync() {
  if (typeof window === 'undefined') {
    return;
  }
  if (!supabase || !orgId) {
    pendingSync = true;
    return;
  }
  if (debounceTimer) {
    clearTimeout(debounceTimer);
  }
  debounceTimer = setTimeout(() => {
    debounceTimer = null;
    void syncEmployeesToSupabase(supabase!, orgId!, buildSnapshot()).catch((err) =>
      console.error('Employee remote sync failed:', formatSupabaseError(err), err)
    );
  }, 500);
}

/** @deprecated Use scheduleEmployeeRemoteSync */
export const schedulePayrollRemoteSync = scheduleEmployeeRemoteSync;

export async function hydrateEmployeesFromSupabase(
  client: SupabaseClient,
  organizationId: string
) {
  const employees = await fetchEmployeesFromSupabase(client, organizationId);
  employeeStore.hydrateFromRemote({ employees });
  configureEmployeeRemoteSync(client, organizationId);
}

/** @deprecated Use hydrateEmployeesFromSupabase */
export const hydratePayrollFromSupabase = hydrateEmployeesFromSupabase;

export function pushSoftDeletedEmployee(employeeId: string) {
  if (!supabase || !orgId) {
    return Promise.resolve();
  }
  return softDeleteEmployeeRemote(supabase, orgId, employeeId);
}
