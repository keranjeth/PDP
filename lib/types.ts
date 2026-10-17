// Employee master data (PD Plan foundation — payroll types removed in Phase 1 cleanup)
export interface Employee {
  id: string;
  idNumber: string;
  fullName: string;
  gender: 'Male' | 'Female';
  dateOfBirth?: Date;
  bloodGroup?: string;
  maritalStatus?: string;
  positionNumber?: string;
  /** Manager's position slot (not person id); resolved to current occupant at display time. */
  reportsToPositionNumber?: string;
  designation: string;
  staffingCategory?: string;
  overtimeGroupName?: string;
  department: string;
  unit?: string;
  region?: string;
  dutyStation?: string;
  jobLocation?: string;
  contractType?: 'Regular' | 'Non-Regular';
  jobStatus?: 'Full-Time' | 'Part-Time';
  employmentStatus?: 'Active' | 'Inactive';
  joiningDate: Date;
  contractStartDate?: Date;
  contractEndDate?: Date;
  currency: string;
  createdAt: Date;
}

export interface DashboardSummary {
  totalEmployees: number;
  activeEmployees: number;
}

export interface ValidationError {
  field: string;
  message: string;
}
