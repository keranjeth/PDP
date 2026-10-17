import { DEFAULT_CURRENCY } from './constants';
import { formatDisplayDateDMmmYYYY } from './employee-dates';
import type { Employee } from './types';

export type EmployeeProfilePreview = Pick<
  Employee,
  'fullName' | 'designation' | 'idNumber' | 'contractType' | 'employmentStatus'
>;

export type EmployeeInformationGroupKey = 'personal' | 'job' | 'contract';

export type EmployeeInformationTab = Capitalize<EmployeeInformationGroupKey>;

type ValueKind = 'text';

type BaseFieldDefinition<TSection, TValueKey extends keyof TSection> = {
  key: TValueKey;
  label: string;
  kind?: ValueKind;
};

export type EmployeeInformationSnapshot = {
  personal: {
    idNumber: string;
    fullName: string;
    gender: string;
    dateOfBirth: string;
    age: string;
    bloodGroup: string;
    maritalStatus: string;
  };
  job: {
    positionNumber: string;
    designation: string;
    staffingCategory: string;
    department: string;
    unit: string;
    region: string;
    dutyStation: string;
    jobLocation: string;
  };
  contract: {
    contractType: string;
    jobStatus: string;
    employmentStatus: string;
    joiningDate: string;
    contractStartDate: string;
    contractEndDate: string;
    lengthOfService: string;
  };
};

export const EMPLOYEE_INFORMATION_TABS: EmployeeInformationTab[] = [
  'Personal',
  'Job',
  'Contract',
];

export const EMPLOYEE_INFORMATION_FIELDS: {
  [K in EmployeeInformationGroupKey]: Array<
    BaseFieldDefinition<EmployeeInformationSnapshot[K], keyof EmployeeInformationSnapshot[K]>
  >;
} = {
  personal: [
    { key: 'idNumber', label: 'ID Number' },
    { key: 'fullName', label: 'Full Name' },
    { key: 'gender', label: 'Gender' },
    { key: 'dateOfBirth', label: 'Date of Birth' },
    { key: 'bloodGroup', label: 'Blood Group' },
    { key: 'maritalStatus', label: 'Marital Status' },
  ],
  job: [
    { key: 'positionNumber', label: 'Position Number' },
    { key: 'designation', label: 'Designation' },
    { key: 'staffingCategory', label: 'Staffing Category' },
    { key: 'department', label: 'Department' },
    { key: 'unit', label: 'Unit' },
    { key: 'region', label: 'Region' },
    { key: 'dutyStation', label: 'Duty Station' },
    { key: 'jobLocation', label: 'Job Location' },
  ],
  contract: [
    { key: 'contractType', label: 'Contract Type' },
    { key: 'jobStatus', label: 'Job Status' },
    { key: 'employmentStatus', label: 'Employment Status' },
    { key: 'joiningDate', label: 'Joining Date' },
    { key: 'contractStartDate', label: 'Contract Start Date' },
    { key: 'contractEndDate', label: 'Contract End Date' },
  ],
};

function formatDisplayDate(value?: Date | string) {
  if (!value) {
    return '-';
  }

  const date = new Date(value);
  if (Number.isNaN(date.getTime())) {
    return '-';
  }

  return formatDisplayDateDMmmYYYY(date);
}

function calculateAge(value?: Date | string) {
  if (!value) {
    return '-';
  }

  const date = new Date(value);
  if (Number.isNaN(date.getTime())) {
    return '-';
  }

  const today = new Date();
  let age = today.getFullYear() - date.getFullYear();
  const hasBirthdayPassed =
    today.getMonth() > date.getMonth() ||
    (today.getMonth() === date.getMonth() && today.getDate() >= date.getDate());

  if (!hasBirthdayPassed) {
    age -= 1;
  }

  return age >= 0 ? `${age}` : '-';
}

export function calculateLengthOfService(joiningDate?: Date | string) {
  if (!joiningDate) {
    return '-';
  }

  const start = new Date(joiningDate);
  if (Number.isNaN(start.getTime())) {
    return '-';
  }

  const today = new Date();
  let years = today.getFullYear() - start.getFullYear();
  let months = today.getMonth() - start.getMonth();
  let days = today.getDate() - start.getDate();

  if (days < 0) {
    months -= 1;
    const previousMonth = new Date(today.getFullYear(), today.getMonth(), 0);
    days += previousMonth.getDate();
  }

  if (months < 0) {
    years -= 1;
    months += 12;
  }

  return `${years} Years, ${months} Months, ${days} Days`;
}

export function buildEmployeeInformationSnapshot(employee: Employee): EmployeeInformationSnapshot {
  return {
    personal: {
      idNumber: employee.idNumber,
      fullName: employee.fullName,
      gender: employee.gender,
      dateOfBirth: formatDisplayDate(employee.dateOfBirth),
      age: calculateAge(employee.dateOfBirth),
      bloodGroup: employee.bloodGroup || '-',
      maritalStatus: employee.maritalStatus || '-',
    },
    job: {
      positionNumber: employee.positionNumber || '-',
      designation: employee.designation || '-',
      staffingCategory: employee.staffingCategory || '-',
      department: employee.department || '-',
      unit: employee.unit || '-',
      region: employee.region || '-',
      dutyStation: employee.dutyStation || '-',
      jobLocation: employee.jobLocation || '-',
    },
    contract: {
      contractType: employee.contractType || '-',
      jobStatus: employee.jobStatus || '-',
      employmentStatus: employee.employmentStatus || '-',
      joiningDate: formatDisplayDate(employee.joiningDate),
      contractStartDate: formatDisplayDate(employee.contractStartDate),
      contractEndDate: formatDisplayDate(employee.contractEndDate),
      lengthOfService: calculateLengthOfService(employee.joiningDate),
    },
  };
}

export function formatInformationValue<K extends EmployeeInformationGroupKey>(
  _group: K,
  fieldKey: keyof EmployeeInformationSnapshot[K],
  snapshot: EmployeeInformationSnapshot
) {
  const groupValues = snapshot[_group] as Record<string, unknown>;
  const value = groupValues[fieldKey as string];
  return String(value ?? '-');
}

const PROFILE_TAB_BY_QUERY: Record<string, EmployeeInformationTab> = {
  overview: 'Personal',
  personal: 'Personal',
  job: 'Job',
  contract: 'Contract',
};

export function tabFromQuery(tab: string | null): EmployeeInformationTab {
  const key = (tab ?? '').trim().toLowerCase();
  if (!key) {
    return 'Personal';
  }
  return PROFILE_TAB_BY_QUERY[key] ?? 'Personal';
}

export function buildEmployeeProfileHref(employeeId: string, tab?: string | null): string {
  if (tab == null || tab === '') {
    return `/employees/${employeeId}`;
  }
  return `/employees/${employeeId}?tab=${encodeURIComponent(tab)}`;
}

/** Currency label for profile chrome (employee master only). */
export function employeeDisplayCurrency(employee: Employee): string {
  return employee.currency || DEFAULT_CURRENCY;
}
