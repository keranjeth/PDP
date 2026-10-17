'use client';

import { useEffect } from 'react';
import { useParams } from 'next/navigation';
import EmployeeForm from '@/components/EmployeeForm';
import { useRouter } from 'next/navigation';
import { useAppAuth } from '@/components/providers/AppProviders';

export default function EmployeeEditPage() {
  const router = useRouter();
  const { membershipRole, isReady } = useAppAuth();
  const isEmployee = membershipRole === 'employee';
  const params = useParams();
  const employeeId = params.id as string;

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

  return <EmployeeForm employeeId={employeeId} isNew={false} />;
}
