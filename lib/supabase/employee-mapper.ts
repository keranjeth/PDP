import type { Employee } from '@/lib/types';
import { isoToLocalDate, dateToCalendarIso } from '@/lib/employee-dates';

export type EmployeeRow = {
  id: string;
  org_id: string;
  id_number: string;
  full_name: string;
  gender: 'male' | 'female';
  date_of_birth: string | null;
  blood_group: string | null;
  marital_status: string | null;
  position_number: string | null;
  reports_to_position_number?: string | null;
  designation: string;
  staffing_category: string | null;
  overtime_group_name?: string | null;
  department: string;
  unit: string | null;
  region: string | null;
  duty_station: string | null;
  job_location: string | null;
  contract_type: 'regular' | 'non_regular' | null;
  job_status: 'full_time' | 'part_time' | null;
  employment_status: 'active' | 'inactive' | null;
  joining_date: string;
  contract_start_date: string | null;
  contract_end_date: string | null;
  currency: string;
  created_at: string;
};

export function employeeRowToEmployee(row: EmployeeRow): Employee {
  return {
    id: row.id,
    idNumber: row.id_number,
    fullName: row.full_name,
    gender: row.gender === 'male' ? 'Male' : 'Female',
    dateOfBirth: row.date_of_birth ? isoToLocalDate(row.date_of_birth) ?? undefined : undefined,
    bloodGroup: row.blood_group ?? undefined,
    maritalStatus: row.marital_status ?? undefined,
    positionNumber: row.position_number ?? undefined,
    reportsToPositionNumber: row.reports_to_position_number?.trim() || undefined,
    designation: row.designation,
    staffingCategory: row.staffing_category ?? undefined,
    overtimeGroupName: row.overtime_group_name ? String(row.overtime_group_name) : undefined,
    department: row.department,
    unit: row.unit ?? undefined,
    region: row.region ?? undefined,
    dutyStation: row.duty_station ?? undefined,
    jobLocation: row.job_location ?? undefined,
    contractType:
      row.contract_type === 'regular'
        ? 'Regular'
        : row.contract_type === 'non_regular'
          ? 'Non-Regular'
          : undefined,
    jobStatus:
      row.job_status === 'full_time'
        ? 'Full-Time'
        : row.job_status === 'part_time'
          ? 'Part-Time'
          : undefined,
    employmentStatus:
      row.employment_status === 'active'
        ? 'Active'
        : row.employment_status === 'inactive'
          ? 'Inactive'
          : undefined,
    joiningDate: isoToLocalDate(row.joining_date) ?? new Date(row.joining_date),
    contractStartDate: row.contract_start_date
      ? isoToLocalDate(row.contract_start_date) ?? undefined
      : undefined,
    contractEndDate: row.contract_end_date
      ? isoToLocalDate(row.contract_end_date) ?? undefined
      : undefined,
    currency: row.currency,
    createdAt: new Date(row.created_at),
  };
}

export function employeeToInsertRow(
  employee: Employee,
  orgId: string
): Record<string, unknown> {
  return {
    id: employee.id,
    org_id: orgId,
    id_number: employee.idNumber,
    full_name: employee.fullName,
    gender: employee.gender === 'Male' ? 'male' : 'female',
    date_of_birth: employee.dateOfBirth ? dateToCalendarIso(employee.dateOfBirth) : null,
    blood_group: employee.bloodGroup || null,
    marital_status: employee.maritalStatus || null,
    position_number: employee.positionNumber?.trim() || null,
    reports_to_position_number: employee.reportsToPositionNumber?.trim() || null,
    designation: employee.designation,
    staffing_category: employee.staffingCategory?.trim() || null,
    overtime_group_name: employee.overtimeGroupName?.trim() || null,
    department: employee.department,
    unit: employee.unit?.trim() || null,
    region: employee.region?.trim() || null,
    duty_station: employee.dutyStation?.trim() || null,
    job_location: employee.jobLocation?.trim() || null,
    contract_type:
      employee.contractType === 'Regular'
        ? 'regular'
        : employee.contractType === 'Non-Regular'
          ? 'non_regular'
          : null,
    job_status:
      employee.jobStatus === 'Full-Time'
        ? 'full_time'
        : employee.jobStatus === 'Part-Time'
          ? 'part_time'
          : null,
    employment_status:
      employee.employmentStatus === 'Active'
        ? 'active'
        : employee.employmentStatus === 'Inactive'
          ? 'inactive'
          : null,
    joining_date: dateToCalendarIso(employee.joiningDate),
    contract_start_date: employee.contractStartDate
      ? dateToCalendarIso(employee.contractStartDate)
      : null,
    contract_end_date: employee.contractEndDate ? dateToCalendarIso(employee.contractEndDate) : null,
    currency: employee.currency,
    created_at: employee.createdAt.toISOString(),
    deleted_at: null,
  };
}
