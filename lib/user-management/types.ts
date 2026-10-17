export type OrgMemberStatus = 'active' | 'inactive' | 'pending_activation';

export type OrgMemberRole =
  | 'super_admin'
  | 'hr_national'
  | 'head_of_hr'
  | 'regional_hr'
  | 'employee';

export type OrgMemberRow = {
  org_id: string;
  user_id: string;
  role: OrgMemberRole;
  status: OrgMemberStatus;
  created_at?: string;
};

export type ProfileRow = {
  user_id: string;
  full_name: string | null;
  email?: string | null;
};

export type EmployeeLinkRow = {
  org_id: string;
  employee_id: string;
  user_id: string;
  created_at: string;
};

export type EmployeeLiteRow = {
  id: string;
  id_number: string;
  full_name: string;
  designation?: string | null;
  region?: string | null;
  employment_status: string;
  deleted_at: string | null;
};

export type OrgMemberView = {
  userId: string;
  role: OrgMemberRole;
  status: OrgMemberStatus;
  fullName: string | null;
  email: string | null;
  regions: string[];
  linkedEmployee: null | {
    employeeId: string;
    idNumber: string;
    fullName: string;
    designation: string | null;
    region: string | null;
  };
};

