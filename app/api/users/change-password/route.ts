import { NextResponse } from 'next/server';
import { getSupabaseAdminClient } from '@/lib/supabase/admin';
import { getRequestUser, userMustChangePassword } from '@/lib/api/request-auth';
import { validatePasswordStrength } from '@/lib/users/password-policy';

type Body = { newPassword?: string };

export async function POST(request: Request) {
  const { user, error: authError } = await getRequestUser(request);
  if (!user) {
    return NextResponse.json({ error: authError ?? 'Unauthorized' }, { status: 401 });
  }

  let body: Body | null = null;
  try {
    body = (await request.json()) as Body;
  } catch {
    return NextResponse.json({ error: 'Invalid JSON body.' }, { status: 400 });
  }

  const newPassword = String(body?.newPassword ?? '');
  const strength = validatePasswordStrength(newPassword);
  if (!strength.ok) {
    return NextResponse.json({ error: strength.error }, { status: 400 });
  }

  const admin = getSupabaseAdminClient();

  // Block password changes for inactive memberships (any org).
  const { data: memberships } = await admin
    .from('organization_members')
    .select('status')
    .eq('user_id', user.id);

  const hasActive = ((memberships ?? []) as Array<{ status: string }>).some(
    (m) => m.status === 'active'
  );
  if (!hasActive) {
    return NextResponse.json({ error: 'Account is inactive.' }, { status: 403 });
  }

  const { data, error } = await admin.auth.admin.updateUserById(user.id, {
    password: newPassword,
    app_metadata: {
      ...(user.app_metadata ?? {}),
      must_change_password: false,
    },
    user_metadata: {
      ...(user.user_metadata ?? {}),
      must_change_password: false,
    },
  });

  if (error || !data?.user) {
    return NextResponse.json(
      { error: error?.message ?? 'Failed to update password.' },
      { status: 400 }
    );
  }

  // If they were forced to change password, confirm flag was present (audit clarity only).
  void userMustChangePassword(user);

  return NextResponse.json({ ok: true });
}
