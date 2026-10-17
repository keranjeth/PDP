'use client';

import { useParams, useSearchParams } from 'next/navigation';
import EmployeeProfile from '@/components/EmployeeProfile';
import { tabFromQuery } from '@/lib/employee-information';

export default function EmployeeProfilePage() {
  const params = useParams();
  const searchParams = useSearchParams();
  const employeeId = params.id as string;
  const defaultTab = tabFromQuery(searchParams.get('tab'));

  return (
    <EmployeeProfile
      key={`${employeeId}-${defaultTab}`}
      employeeId={employeeId}
      defaultTab={defaultTab}
    />
  );
}
