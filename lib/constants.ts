// Default currency
export const DEFAULT_CURRENCY = 'AFN';

// Date format for display
export const DATE_FORMAT = {
  display: 'MMM DD, YYYY',
  input: 'YYYY-MM-DD',
  monthYear: 'YYYY-MM',
};

// Employee status options
export const EMPLOYEE_STATUS_OPTIONS = [
  { value: 'Active', label: 'Active' },
  { value: 'Inactive', label: 'Inactive' },
] as const;

// Contract type options
export const CONTRACT_TYPE_OPTIONS = [
  { value: 'Regular', label: 'Regular' },
  { value: 'Non-Regular', label: 'Non-Regular' },
] as const;

// Job status options
export const JOB_STATUS_OPTIONS = [
  { value: 'Full-Time', label: 'Full-Time' },
  { value: 'Part-Time', label: 'Part-Time' },
] as const;

// Gender options
export const GENDER_OPTIONS = [
  { value: 'Male', label: 'Male' },
  { value: 'Female', label: 'Female' },
] as const;

export const BLOOD_GROUP_OPTIONS = [
  { value: 'A+', label: 'A+' },
  { value: 'A-', label: 'A-' },
  { value: 'B+', label: 'B+' },
  { value: 'B-', label: 'B-' },
  { value: 'AB+', label: 'AB+' },
  { value: 'AB-', label: 'AB-' },
  { value: 'O+', label: 'O+' },
  { value: 'O-', label: 'O-' },
] as const;

export const MARITAL_STATUS_OPTIONS = [
  { value: 'Single', label: 'Single' },
  { value: 'Married', label: 'Married' },
  { value: 'Separated', label: 'Separated' },
  { value: 'Widowed', label: 'Widowed' },
] as const;
