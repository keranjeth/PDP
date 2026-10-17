import type { SupabaseClient } from '@supabase/supabase-js';
import type { Employee } from '@/lib/types';

export type LeaverSnapshotRow = {
  leaver_id: string;
  employee_id: string;
  id_number: string;
  full_name: string;
  gender: 'male' | 'female';
  position_number: string;
  reports_to_position_number: string | null;
  designation: string;
  staffing_category: string;
  department: string;
  unit: string;
  region: string;
  duty_station: string;
  job_location: string;
  contract_type: 'regular' | 'non_regular';
  job_status: 'full_time' | 'part_time';
  employment_status: 'active' | 'inactive';
  joining_date: string;
  contract_start_date: string;
  contract_end_date: string;
  created_at: string;
  offboarded_at: string;
  last_working_date: string;
  exit_type: string;
  leaving_reason: string;
  eligible_for_rehire: boolean;
  rehire_note: string | null;
};

function toDate(value: string) {
  const d = new Date(value);
  return Number.isNaN(d.getTime()) ? new Date() : d;
}

export function employeeFromLeaverSnapshot(row: LeaverSnapshotRow): Employee {
  return {
    id: row.employee_id,
    idNumber: row.id_number,
    fullName: row.full_name,
    gender: row.gender === 'male' ? 'Male' : 'Female',
    dateOfBirth: undefined,
    positionNumber: row.position_number,
    reportsToPositionNumber: row.reports_to_position_number ?? undefined,
    designation: row.designation,
    staffingCategory: row.staffing_category,
    department: row.department,
    unit: row.unit,
    region: row.region,
    dutyStation: row.duty_station,
    jobLocation: row.job_location,
    contractType: row.contract_type === 'regular' ? 'Regular' : 'Non-Regular',
    jobStatus: row.job_status === 'full_time' ? 'Full-Time' : 'Part-Time',
    employmentStatus: row.employment_status === 'active' ? 'Active' : 'Inactive',
    joiningDate: toDate(row.joining_date),
    contractStartDate: toDate(row.contract_start_date),
    contractEndDate: toDate(row.contract_end_date),
    createdAt: toDate(row.offboarded_at ?? row.created_at),
  };
}

export async function fetchOrgLeavers(
  supabase: SupabaseClient,
  orgId: string
): Promise<LeaverSnapshotRow[]> {
  const { data, error } = await supabase
    .from('leavers')
    .select(
      [
        'leaver_id',
        'employee_id',
        'id_number',
        'full_name',
        'gender',
        'position_number',
        'reports_to_position_number',
        'designation',
        'staffing_category',
        'department',
        'unit',
        'region',
        'duty_station',
        'job_location',
        'contract_type',
        'job_status',
        'employment_status',
        'joining_date',
        'contract_start_date',
        'contract_end_date',
        'created_at',
        'offboarded_at',
        'last_working_date',
        'exit_type',
        'leaving_reason',
        'eligible_for_rehire',
        'rehire_note',
      ].join(',')
    )
    .eq('org_id', orgId)
    .order('offboarded_at', { ascending: false });

  if (error) {
    throw error;
  }

  return (data ?? []) as unknown as LeaverSnapshotRow[];
}
