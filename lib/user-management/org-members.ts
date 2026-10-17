import type { SupabaseClient } from '@supabase/supabase-js';
import type {
  EmployeeLinkRow,
  EmployeeLiteRow,
  OrgMemberRow,
  OrgMemberRole,
  OrgMemberStatus,
  OrgMemberView,
  ProfileRow,
} from '@/lib/user-management/types';

/** PostgREST URLs fail with 400 when `.in()` lists are huge; keep batches conservative. */
const IN_QUERY_BATCH_SIZE = 150;

function chunkIds<T>(ids: T[], size: number): T[][] {
  const out: T[][] = [];
  for (let i = 0; i < ids.length; i += size) {
    out.push(ids.slice(i, i + size));
  }
  return out;
}

export type EmployeeLinkedMember = {
  userId: string;
  role: OrgMemberRole;
  status: OrgMemberStatus;
};

/**
 * If this employee is linked to an auth user, returns that member's org role (source of truth: organization_members).
 */
export async function fetchEmployeeLinkedOrgMember(
  supabase: SupabaseClient,
  orgId: string,
  employeeId: string
): Promise<EmployeeLinkedMember | null> {
  const { data: link, error: linkErr } = await supabase
    .from('employee_user_links')
    .select('user_id')
    .eq('org_id', orgId)
    .eq('employee_id', employeeId)
    .maybeSingle();

  if (linkErr) {
    throw linkErr;
  }
  const userId = (link as { user_id?: string } | null)?.user_id;
  if (!userId) {
    return null;
  }

  const { data: member, error: memErr } = await supabase
    .from('organization_members')
    .select('user_id,role,status')
    .eq('org_id', orgId)
    .eq('user_id', userId)
    .maybeSingle();

  if (memErr) {
    throw memErr;
  }
  if (!member) {
    return null;
  }

  return {
    userId: (member as OrgMemberRow).user_id,
    role: (member as OrgMemberRow).role as OrgMemberRole,
    status: (member as OrgMemberRow).status as OrgMemberStatus,
  };
}

export async function fetchOrgMemberViews(
  supabase: SupabaseClient,
  orgId: string
): Promise<OrgMemberView[]> {
  const { data: members, error: membersErr } = await supabase
    .from('organization_members')
    .select('user_id,role,status')
    .eq('org_id', orgId);

  if (membersErr) {
    throw membersErr;
  }

  const memberRows = (members ?? []) as Array<
    Pick<OrgMemberRow, 'user_id' | 'role' | 'status'> & { user_id: string }
  >;

  const userIds = memberRows.map((m) => m.user_id);

  if (userIds.length === 0) {
    return [];
  }

  const profileByUserId = new Map<string, ProfileRow & { email?: string | null }>();
  const profileBatches = chunkIds(userIds, IN_QUERY_BATCH_SIZE);
  const profileResults = await Promise.all(
    profileBatches.map((batch) =>
      supabase.from('profiles').select('user_id,full_name,email').in('user_id', batch)
    )
  );
  for (const { data: profiles, error: profErr } of profileResults) {
    if (profErr) {
      throw profErr;
    }
    for (const p of (profiles ?? []) as Array<ProfileRow & { email?: string | null }>) {
      profileByUserId.set(p.user_id, p);
    }
  }

  const { data: links, error: linkErr } = await supabase
    .from('employee_user_links')
    .select('org_id,employee_id,user_id,created_at')
    .eq('org_id', orgId);

  if (linkErr) {
    throw linkErr;
  }

  const linkByUserId = new Map<string, EmployeeLinkRow>();
  for (const l of (links ?? []) as EmployeeLinkRow[]) {
    linkByUserId.set(l.user_id, l);
  }

  const { data: regionRows, error: regionErr } = await supabase
    .from('organization_member_regions')
    .select('user_id,region')
    .eq('org_id', orgId);

  if (regionErr) {
    throw regionErr;
  }

  const regionsByUserId = new Map<string, string[]>();
  for (const r of (regionRows ?? []) as Array<{ user_id: string; region: string }>) {
    const list = regionsByUserId.get(r.user_id) ?? [];
    list.push(String(r.region));
    regionsByUserId.set(r.user_id, list);
  }

  const employeeIds = [...linkByUserId.values()].map((l) => l.employee_id);
  const employeeById = new Map<string, EmployeeLiteRow>();

  if (employeeIds.length > 0) {
    const employeeBatches = chunkIds(employeeIds, IN_QUERY_BATCH_SIZE);
    const employeeResults = await Promise.all(
      employeeBatches.map((batch) =>
        supabase
          .from('employees')
          .select('id,id_number,full_name,designation,region,employment_status,deleted_at')
          .eq('org_id', orgId)
          .in('id', batch)
      )
    );
    for (const { data: employees, error: empErr } of employeeResults) {
      if (empErr) {
        throw empErr;
      }
      for (const e of (employees ?? []) as EmployeeLiteRow[]) {
        employeeById.set(e.id, e);
      }
    }
  }

  return memberRows
    .map((m): OrgMemberView => {
      const profile = profileByUserId.get(m.user_id) ?? null;
      const link = linkByUserId.get(m.user_id) ?? null;
      const employee = link ? employeeById.get(link.employee_id) ?? null : null;

      return {
        userId: m.user_id,
        role: m.role as OrgMemberRole,
        status: m.status as OrgMemberStatus,
        fullName: profile?.full_name ?? null,
        email: profile?.email ?? null,
        regions: (regionsByUserId.get(m.user_id) ?? []).sort((a, b) =>
          a.localeCompare(b)
        ),
        linkedEmployee:
          employee && !employee.deleted_at
            ? {
                employeeId: employee.id,
                idNumber: employee.id_number,
                fullName: employee.full_name,
                designation: employee.designation ?? null,
                region: employee.region ?? null,
              }
            : null,
      };
    })
    .sort((a, b) => {
      const aKey = (a.fullName ?? a.userId).toLowerCase();
      const bKey = (b.fullName ?? b.userId).toLowerCase();
      return aKey.localeCompare(bKey);
    });
}

export async function setOrgMemberRole(
  supabase: SupabaseClient,
  orgId: string,
  userId: string,
  role: OrgMemberRole
) {
  const { error } = await supabase
    .from('organization_members')
    .update({ role })
    .eq('org_id', orgId)
    .eq('user_id', userId);

  if (error) {
    throw error;
  }
}

export async function setOrgMemberStatus(
  supabase: SupabaseClient,
  orgId: string,
  userId: string,
  status: OrgMemberStatus
) {
  const { error } = await supabase
    .from('organization_members')
    .update({ status })
    .eq('org_id', orgId)
    .eq('user_id', userId);

  if (error) {
    throw error;
  }
}

export async function linkUserToEmployee(
  supabase: SupabaseClient,
  orgId: string,
  userId: string,
  employeeId: string
) {
  const { error } = await supabase.from('employee_user_links').insert({
    org_id: orgId,
    user_id: userId,
    employee_id: employeeId,
  });

  if (error) {
    throw error;
  }
}

export async function unlinkUserFromEmployee(
  supabase: SupabaseClient,
  orgId: string,
  userId: string
) {
  const { error } = await supabase
    .from('employee_user_links')
    .delete()
    .eq('org_id', orgId)
    .eq('user_id', userId);

  if (error) {
    throw error;
  }
}

export async function setMemberRegions(
  supabase: SupabaseClient,
  orgId: string,
  userId: string,
  regions: string[]
) {
  const desired = Array.from(
    new Set(regions.map((r) => r.trim()).filter(Boolean))
  );

  const { data: existingRows, error: existingErr } = await supabase
    .from('organization_member_regions')
    .select('region')
    .eq('org_id', orgId)
    .eq('user_id', userId);

  if (existingErr) {
    throw existingErr;
  }

  const existing = new Set(
    (existingRows ?? []).map((r) => String((r as { region: string }).region))
  );
  const desiredSet = new Set(desired);

  const toDelete = [...existing].filter((r) => !desiredSet.has(r));
  const toInsert = desired.filter((r) => !existing.has(r));

  if (toDelete.length > 0) {
    const { error } = await supabase
      .from('organization_member_regions')
      .delete()
      .eq('org_id', orgId)
      .eq('user_id', userId)
      .in('region', toDelete);
    if (error) {
      throw error;
    }
  }

  if (toInsert.length > 0) {
    const { error } = await supabase.from('organization_member_regions').insert(
      toInsert.map((region) => ({
        org_id: orgId,
        user_id: userId,
        region,
      }))
    );
    if (error) {
      throw error;
    }
  }
}

export async function fetchOrgRegions(
  supabase: SupabaseClient,
  orgId: string
): Promise<string[]> {
  const { data: rpcData, error: rpcErr } = await supabase.rpc('org_employee_regions', {
    p_org_id: orgId,
  });

  if (!rpcErr && rpcData != null) {
    const rows = rpcData as Array<{ region: string }>;
    return rows.map((r) => String(r.region ?? '').trim()).filter(Boolean);
  }

  const { data, error } = await supabase
    .from('employees')
    .select('region')
    .eq('org_id', orgId)
    .is('deleted_at', null);

  if (error) {
    throw rpcErr ?? error;
  }

  const set = new Set<string>();
  for (const row of data ?? []) {
    const region = String((row as { region: string | null }).region ?? '').trim();
    if (region) {
      set.add(region);
    }
  }
  return [...set].sort((a, b) => a.localeCompare(b));
}

