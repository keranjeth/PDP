'use client';

import EmployeeForm from '@/components/EmployeeForm';
import { useEffect } from 'react';
import { useRouter } from 'next/navigation';
import { useAppAuth } from '@/components/providers/AppProviders';

export default function NewEmployeePage() {
  const router = useRouter();
  const { membershipRole, isReady } = useAppAuth();
  const isEmployee = membershipRole === 'employee';

  useEffect(() => {
    if (!isReady) return;
    if (isEmployee) {
      router.replace('/my/profile');
      router.refresh();
    }
  }, [isReady, isEmployee, router]);

  if (isEmployee) {
    return null;
  }
  return <EmployeeForm isNew={true} />;
}
