import { NextResponse } from 'next/server';
import type { User } from '@supabase/supabase-js';
import {
  getActiveMembership,
  getRequestUser,
  guardProtectedApiUser,
} from '@/lib/api/request-auth';
import { can } from '@/lib/user-management/permissions';
import type { Action } from '@/lib/user-management/permissions';
import type { OrgMemberRole } from '@/lib/user-management/types';

export async function requireBudgetApiAccess(
  request: Request,
  orgId: string,
  action: Action
): Promise<
  | {
      ok: true;
      user: User;
      sessionClient: NonNullable<Awaited<ReturnType<typeof getRequestUser>>['sessionClient']>;
      role: OrgMemberRole;
    }
  | { ok: false; response: NextResponse }
> {
  const { user, sessionClient, error } = await getRequestUser(request);
  if (error || !user || !sessionClient) {
    return {
      ok: false,
      response: NextResponse.json({ error: error ?? 'Unauthorized' }, { status: 401 }),
    };
  }

  const blocked = await guardProtectedApiUser(user, sessionClient);
  if (blocked) {
    return { ok: false, response: blocked };
  }

  if (!orgId) {
    return {
      ok: false,
      response: NextResponse.json({ error: 'orgId is required.' }, { status: 400 }),
    };
  }

  const membership = await getActiveMembership(orgId, user.id);
  if (!membership) {
    return {
      ok: false,
      response: NextResponse.json({ error: 'Forbidden' }, { status: 403 }),
    };
  }

  if (!can(membership.role, 'budgets', action)) {
    return {
      ok: false,
      response: NextResponse.json({ error: 'Forbidden' }, { status: 403 }),
    };
  }

  return {
    ok: true,
    user,
    sessionClient,
    role: membership.role,
  };
}
