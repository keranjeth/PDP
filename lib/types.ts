// Employee master data (PD Plan foundation)
export interface Employee {
  id: string;
  idNumber: string;
  fullName: string;
  gender: 'Male' | 'Female';
  dateOfBirth?: Date;
  positionNumber?: string;
  /** Manager's position slot (not person id); resolved to current occupant at display time. */
  reportsToPositionNumber?: string;
  designation: string;
  staffingCategory?: string;
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
