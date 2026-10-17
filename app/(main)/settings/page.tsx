'use client';

import { useEffect } from 'react';
import { useRouter } from 'next/navigation';
import { useAppAuth } from '@/components/providers/AppProviders';
import { can } from '@/lib/user-management/permissions';
import type { OrgMemberRole } from '@/lib/user-management/types';

export default function SettingsPage() {
  const { membershipRole } = useAppAuth();
  const router = useRouter();
  const role = membershipRole as OrgMemberRole | null;
  const canReadUsers = can(role, 'users', 'read');

  useEffect(() => {
    if (membershipRole === 'employee') {
      router.replace('/my/profile');
      return;
    }
    if (canReadUsers) {
      router.replace('/settings/users');
      return;
    }
    router.replace('/my/profile');
  }, [membershipRole, canReadUsers, router]);

  return null;
}
