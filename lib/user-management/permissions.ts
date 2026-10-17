import type { OrgMemberRole } from '@/lib/user-management/types';

export type Resource = 'users' | 'employees' | 'settings' | 'budgets' | '*';
export type Action = 'create' | 'read' | 'update' | 'delete';

const ROLE_PERMISSIONS: Record<OrgMemberRole, Array<{ resource: Resource; actions: Action[] }>> =
  {
    super_admin: [{ resource: '*', actions: ['create', 'read', 'update', 'delete'] }],
    head_of_hr: [
      { resource: 'employees', actions: ['create', 'read', 'update', 'delete'] },
      { resource: 'budgets', actions: ['create', 'read', 'update', 'delete'] },
      { resource: 'settings', actions: ['read', 'update'] },
    ],
    hr_national: [
      { resource: 'employees', actions: ['create', 'read', 'update'] },
      { resource: 'budgets', actions: ['create', 'read', 'update'] },
      { resource: 'settings', actions: ['read'] },
    ],
    regional_hr: [
      { resource: 'employees', actions: ['create', 'read', 'update'] },
      { resource: 'budgets', actions: ['create', 'read', 'update'] },
      { resource: 'settings', actions: ['read'] },
    ],
    employee: [
      { resource: 'employees', actions: ['read'] },
      { resource: 'budgets', actions: ['read'] },
      { resource: 'settings', actions: ['read'] },
    ],
  };

export function can(
  role: OrgMemberRole | string | null | undefined,
  resource: Resource,
  action: Action
) {
  if (!role || !(role in ROLE_PERMISSIONS)) {
    return false;
  }
  const perms = ROLE_PERMISSIONS[role as OrgMemberRole];
  return perms.some(
    (p) =>
      (p.resource === '*' || p.resource === resource) && p.actions.includes(action)
  );
}
