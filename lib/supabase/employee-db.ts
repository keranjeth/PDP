import type { SupabaseClient } from '@supabase/supabase-js';
import type { Employee } from '@/lib/types';
import {
  employeeRowToEmployee,
  employeeToInsertRow,
  type EmployeeRow,
} from '@/lib/supabase/employee-mapper';

export async function fetchEmployeesFromSupabase(
  supabase: SupabaseClient,
  orgId: string
): Promise<Employee[]> {
  const { data: empRows, error: empErr } = await supabase
    .from('employees')
    .select('*')
    .eq('org_id', orgId)
    .is('deleted_at', null);

  if (empErr) {
    throw empErr;
  }

  return ((empRows ?? []) as EmployeeRow[]).map((row) => employeeRowToEmployee(row));
}

export type EmployeeRemoteSnapshot = {
  employees: Employee[];
};

export async function syncEmployeesToSupabase(
  supabase: SupabaseClient,
  orgId: string,
  snapshot: EmployeeRemoteSnapshot
): Promise<void> {
  const { employees } = snapshot;

  const dedupeByKey = <T,>(
    items: T[],
    getKey: (item: T) => string,
    chooseWinner: (existing: T, next: T) => T
  ): T[] => {
    const byKey = new Map<string, T>();
    for (const item of items) {
      const key = getKey(item);
      if (!key) continue;
      const existing = byKey.get(key);
      byKey.set(key, existing ? chooseWinner(existing, item) : item);
    }
    return Array.from(byKey.values());
  };

  const uniqueEmployees = dedupeByKey<Employee>(
    employees,
    (e) => String(e.idNumber ?? '').trim().toLowerCase(),
    (existing, next) => {
      const existingCreated =
        existing.createdAt instanceof Date ? existing.createdAt.getTime() : 0;
      const nextCreated = next.createdAt instanceof Date ? next.createdAt.getTime() : 0;
      return nextCreated >= existingCreated ? next : existing;
    }
  );

  if (uniqueEmployees.length === 0) {
    return;
  }

  const idNumbers = uniqueEmployees
    .map((e) => e.idNumber)
    .filter(Boolean)
    .map((v) => v.toLowerCase());

  const { data: existingRows, error: existingErr } = await supabase
    .from('employees')
    .select('id,id_number')
    .eq('org_id', orgId)
    .in('id_number', idNumbers);

  if (existingErr) {
    throw existingErr;
  }

  const idNumberToId = new Map<string, string>();
  for (const r of (existingRows ?? []) as Array<{ id: string; id_number: string }>) {
    idNumberToId.set(String(r.id_number).toLowerCase(), r.id);
  }

  const employeeRows = uniqueEmployees.map((e) => {
    const row = employeeToInsertRow(e, orgId);
    const existingId = idNumberToId.get(e.idNumber.toLowerCase());
    if (existingId) {
      row.id = existingId;
    }
    return row as Record<string, unknown>;
  });

  const upsertEmployees = async (rows: Array<Record<string, unknown>>) => {
    const { error } = await supabase
      .from('employees')
      .upsert(rows, { onConflict: 'org_id,id_number' });
    if (error) throw error;
  };

  await upsertEmployees(employeeRows);
}

export async function softDeleteEmployeeRemote(
  supabase: SupabaseClient,
  orgId: string,
  employeeId: string
): Promise<void> {
  const { error } = await supabase
    .from('employees')
    .update({ deleted_at: new Date().toISOString() })
    .eq('org_id', orgId)
    .eq('id', employeeId);

  if (error) {
    throw error;
  }
}
