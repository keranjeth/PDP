'use client';

import { useEffect, useMemo, useRef, useState, useSyncExternalStore } from 'react';
import { useRouter } from 'next/navigation';
import { Plus } from 'lucide-react';

import type { Employee } from '@/lib/types';
import {
  BLOOD_GROUP_OPTIONS,
  CONTRACT_TYPE_OPTIONS,
  DEFAULT_CURRENCY,
  EMPLOYEE_STATUS_OPTIONS,
  GENDER_OPTIONS,
  JOB_STATUS_OPTIONS,
  MARITAL_STATUS_OPTIONS,
} from '@/lib/constants';
import { payrollStore } from '@/lib/store';
import { format } from 'date-fns';

import { Button } from '@/components/ui/Button';
import { HeaderDivider } from '@/components/ui/HeaderDivider';
import { DatePicker } from '@/components/ui/DatePicker';
import { Input } from '@/components/ui/Input';
import { Label } from '@/components/ui/Label';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/Select';

function subscribePayrollStore(onStoreChange: () => void) {
  return payrollStore.subscribe(onStoreChange);
}

/** Stable reference for useSyncExternalStore getServerSnapshot (must not return a new [] each call). */
const SERVER_EMPLOYEES_SNAPSHOT: Employee[] = [];

interface EmployeeFormProps {
  employeeId?: string;
  isNew?: boolean;
}

type Option = {
  value: string;
  label: string;
};

type StepKey = 'personal' | 'job' | 'contract' | 'review';

const steps: Array<{ key: StepKey; label: string }> = [
  { key: 'personal', label: 'Personal Details' },
  { key: 'job', label: 'Job Details' },
  { key: 'contract', label: 'Contract Details' },
  { key: 'review', label: 'Review' },
];

const STANDARD_OVERTIME_GROUP = 'Standard';

const supportOvertimeGroupOptions: Option[] = [
  { value: '8 Hours', label: '8 Hours' },
  { value: '10 Hours', label: '10 Hours' },
  { value: '12 Hours', label: '12 Hours' },
];

const currencyOptions: Option[] = [
  { value: 'AFN', label: 'AFN' },
  { value: 'USD', label: 'USD' },
  { value: 'EUR', label: 'EUR' },
];

function setHoursSafe(d: Date) {
  const next = new Date(d);
  next.setHours(12, 0, 0, 0);
  return next;
}

function uniqueOptions(values: Array<string | undefined>, fallback: Option[] = []): Option[] {
  const byValue = new Map<string, Option>();
  for (const option of fallback) {
    byValue.set(option.value, option);
  }
  for (const raw of values) {
    const value = String(raw ?? '').trim();
    if (!value || byValue.has(value)) {
      continue;
    }
    byValue.set(value, { value, label: value });
  }
  return Array.from(byValue.values()).sort((a, b) => a.label.localeCompare(b.label));
}

function formatDateDisplay(value?: Date) {
  if (!(value instanceof Date) || Number.isNaN(value.getTime())) return '-';
  return format(value, 'dd/MM/yyyy');
}

function ReviewDetailRow({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex items-start justify-between gap-4 py-2">
      <span className="text-[13px] leading-snug text-slate-900">{label}</span>
      <span className="text-right text-[13px] leading-snug text-slate-900 tabular-nums">{value || '-'}</span>
    </div>
  );
}

function ReviewTwoColumn({
  leftTitle,
  rightTitle,
  leftRows,
  rightRows,
}: {
  leftTitle: string;
  rightTitle: string;
  leftRows: Array<{ key: string; label: string; value: string }>;
  rightRows: Array<{ key: string; label: string; value: string }>;
}) {
  return (
    <div className="grid grid-cols-1 md:grid-cols-2 md:gap-0">
      <div className="md:pr-5">
        <div className="mb-3">
          <div className="text-[13px] font-semibold leading-snug text-slate-900">{leftTitle}</div>
          <HeaderDivider className="mt-2" />
        </div>
        {leftRows.map((row) => (
          <ReviewDetailRow key={row.key} label={row.label} value={row.value} />
        ))}
      </div>
      <div className="border-t border-slate-200 pt-5 md:border-l md:border-t-0 md:pl-5 md:pt-0">
        <div className="mb-3">
          <div className="text-[13px] font-semibold leading-snug text-slate-900">{rightTitle}</div>
          <HeaderDivider className="mt-2" />
        </div>
        {rightRows.map((row) => (
          <ReviewDetailRow key={row.key} label={row.label} value={row.value} />
        ))}
      </div>
    </div>
  );
}

function CustomSelect({
  label,
  value,
  options,
  placeholder,
  required,
  error,
  onChange,
  onAddOption,
}: {
  label: string;
  value: string;
  options: Option[];
  placeholder: string;
  required?: boolean;
  error?: string;
  onChange: (value: string) => void;
  onAddOption?: (option: Option) => void;
}) {
  const [adding, setAdding] = useState(false);
  const [customValue, setCustomValue] = useState('');

  const submitCustom = () => {
    const next = customValue.trim();
    if (!next) {
      return;
    }
    const option = { value: next, label: next };
    onAddOption?.(option);
    onChange(next);
    setCustomValue('');
    setAdding(false);
  };

  return (
    <div className="space-y-2">
      <Label className="text-sm font-semibold text-slate-950">
        {label} {required ? <span className="text-rose-600">*</span> : null}
      </Label>
      <Select
        value={value}
        onValueChange={(next) => {
          if (next === '__custom__') {
            setAdding(true);
            return;
          }
          onChange(next);
        }}
      >
        <SelectTrigger className="h-11 rounded-md text-[15px]">
          <SelectValue placeholder={placeholder} />
        </SelectTrigger>
        <SelectContent>
          {options.map((option) => (
            <SelectItem key={option.value} value={option.value}>
              {option.label}
            </SelectItem>
          ))}
          {onAddOption ? (
            <SelectItem value="__custom__">
              <span className="inline-flex items-center gap-2 text-[var(--primary)]">
                <Plus className="h-3.5 w-3.5" />
                Add custom item
              </span>
            </SelectItem>
          ) : null}
        </SelectContent>
      </Select>
      {adding ? (
        <div className="flex gap-2">
          <Input
            value={customValue}
            onChange={(event) => setCustomValue(event.target.value)}
            placeholder={`Add ${label.toLowerCase()}`}
            className="h-10 rounded-md"
          />
          <Button type="button" variant="outline" className="h-10 px-3" onClick={submitCustom}>
            Add
          </Button>
        </div>
      ) : null}
      {error ? <p className="text-xs font-medium text-rose-600">{error}</p> : null}
    </div>
  );
}

function Field({
  label,
  required,
  error,
  children,
}: {
  label: string;
  required?: boolean;
  error?: string;
  children: React.ReactNode;
}) {
  return (
    <div className="space-y-2">
      <Label className="text-sm font-semibold text-slate-950">
        {label} {required ? <span className="text-rose-600">*</span> : null}
      </Label>
      {children}
      {error ? <p className="text-xs font-medium text-rose-600">{error}</p> : null}
    </div>
  );
}

export default function EmployeeEntryForm({ employeeId, isNew = false }: EmployeeFormProps) {
  const router = useRouter();
  const contractStartTouchedRef = useRef(false);

  const existingEmployee = useSyncExternalStore(
    subscribePayrollStore,
    () => (employeeId ? payrollStore.getEmployee(employeeId) : null),
    () => null
  );

  const existingEmployees = useSyncExternalStore(
    subscribePayrollStore,
    () => payrollStore.getEmployees(),
    () => SERVER_EMPLOYEES_SNAPSHOT
  );
  const baseOptions = useMemo(
    () => ({
      designation: uniqueOptions(existingEmployees.map((employee) => employee.designation)),
      staffingCategory: uniqueOptions(existingEmployees.map((employee) => employee.staffingCategory)),
      department: uniqueOptions(existingEmployees.map((employee) => employee.department)),
      unit: uniqueOptions(existingEmployees.map((employee) => employee.unit)),
      region: uniqueOptions(existingEmployees.map((employee) => employee.region)),
      dutyStation: uniqueOptions(existingEmployees.map((employee) => employee.dutyStation)),
      jobLocation: uniqueOptions(existingEmployees.map((employee) => employee.jobLocation)),
      currency: uniqueOptions(existingEmployees.map((employee) => employee.currency), currencyOptions),
    }),
    [existingEmployees]
  );

  const [loading, setLoading] = useState(false);
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [formData, setFormData] = useState<Partial<Employee>>({});
  const [customOptions, setCustomOptions] = useState<Record<string, Option[]>>({});
  const formSourceKey = isNew
    ? 'new'
    : existingEmployee?.id
      ? `edit:${existingEmployee.id}`
      : 'pending';
  const [syncedFormSourceKey, setSyncedFormSourceKey] = useState(formSourceKey);
  const stepResetKey = `${employeeId ?? 'new'}:${isNew ? 'new' : 'edit'}`;
  const [stepState, setStepState] = useState({ resetKey: stepResetKey, stepIndex: 0 });
  const stepIndex = stepState.resetKey === stepResetKey ? stepState.stepIndex : 0;
  const setStepIndex = (value: number | ((prev: number) => number)) => {
    setStepState((prev) => {
      const currentIndex = prev.resetKey === stepResetKey ? prev.stepIndex : 0;
      const nextIndex = typeof value === 'function' ? value(currentIndex) : value;
      return { resetKey: stepResetKey, stepIndex: nextIndex };
    });
  };

  if (formSourceKey !== syncedFormSourceKey) {
    setSyncedFormSourceKey(formSourceKey);
    if (!isNew && existingEmployee) {
      setFormData(existingEmployee);
    } else if (isNew) {
      const today = setHoursSafe(new Date());
      setFormData({
        idNumber: '',
        fullName: '',
        gender: 'Male',
        dateOfBirth: undefined,
        bloodGroup: '',
        maritalStatus: '',
        staffingCategory: '',
        overtimeGroupName: '',
        positionNumber: '',
        designation: '',
        department: '',
        unit: '',
        region: '',
        dutyStation: '',
        jobLocation: '',
        contractType: 'Regular',
        jobStatus: 'Full-Time',
        employmentStatus: 'Active',
        joiningDate: today,
        contractStartDate: undefined,
        contractEndDate: undefined,
        currency: DEFAULT_CURRENCY,
      });
    }
  }

  useEffect(() => {
    contractStartTouchedRef.current = false;
  }, [formSourceKey]);

  const section = steps[stepIndex];
  const currency = String(formData.currency ?? DEFAULT_CURRENCY);

  const optionSet = (key: string, fallback: Option[]) =>
    uniqueOptions([...(fallback.map((option) => option.value)), ...(customOptions[key] ?? []).map((o) => o.value)]);

  const addCustomOption = (key: string, option: Option) => {
    setCustomOptions((prev) => ({
      ...prev,
      [key]: uniqueOptions([...(prev[key] ?? []).map((o) => o.value), option.value]),
    }));
  };

  const handleEmployeeChange = <K extends keyof Employee>(key: K, value: Employee[K]) => {
    setFormData((prev) => ({ ...prev, [key]: value }));
    setErrors((prev) => {
      if (!prev[key as string]) return prev;
      const next = { ...prev };
      delete next[key as string];
      return next;
    });
  };

  const handleJoiningDateChange = (next?: Date) => {
    const safe = next ? setHoursSafe(next) : undefined;
    setFormData((prev) => ({ ...prev, joiningDate: safe }));
  };

  const isSupportStaffCategory = useMemo(() => {
    return String(formData.staffingCategory ?? '').trim().toLowerCase() === 'support staff';
  }, [formData.staffingCategory]);

  // Support Staff needs an 8/10/12 Hours group. Other categories may leave overtime blank.
  if (isSupportStaffCategory) {
    const current = String(formData.overtimeGroupName ?? '').trim();
    const allowed = new Set(supportOvertimeGroupOptions.map((o) => o.value));
    if (!current || !allowed.has(current)) {
      const fallback = supportOvertimeGroupOptions[0]?.value ?? STANDARD_OVERTIME_GROUP;
      if (current !== fallback) {
        setFormData((prev) => ({ ...prev, overtimeGroupName: fallback }));
      }
    }
  }

  const validateStep = (idx: number): boolean => {
    const stepKey = steps[idx]?.key;
    const next: Record<string, string> = {};

    if (stepKey === 'personal') {
      if (!String(formData.idNumber ?? '').trim()) next.idNumber = 'Required';
      if (!String(formData.fullName ?? '').trim()) next.fullName = 'Required';
      if (!String(formData.gender ?? '').trim()) next.gender = 'Required';
    }

    if (stepKey === 'job') {
      if (!String(formData.designation ?? '').trim()) next.designation = 'Required';
      if (!String(formData.department ?? '').trim()) next.department = 'Required';
    }

    if (stepKey === 'contract') {
      if (!(formData.joiningDate instanceof Date) || Number.isNaN(formData.joiningDate.getTime())) {
        next.joiningDate = 'Required';
      }

      const isSupport = String(formData.staffingCategory ?? '')
        .trim()
        .toLowerCase() === 'support staff';
      const groupName = String(formData.overtimeGroupName ?? '').trim();
      const allowedSupport = new Set(supportOvertimeGroupOptions.map((o) => o.value));

      if (isSupport) {
        if (!groupName) next.overtimeGroupName = 'Overtime Group is required for Support Staff.';
        else if (!allowedSupport.has(groupName)) {
          next.overtimeGroupName = 'Support Staff must use overtime groups: 8 Hours / 10 Hours / 12 Hours.';
        }
      } else if (groupName && groupName !== STANDARD_OVERTIME_GROUP) {
        next.overtimeGroupName = `Non-support staff must use "${STANDARD_OVERTIME_GROUP}", or leave overtime blank.`;
      }
    }

    setErrors(next);
    return Object.keys(next).length === 0;
  };

  const validateAll = () => {
    for (let i = 0; i < steps.length; i += 1) {
      if (!validateStep(i)) {
        setStepIndex(i);
        return false;
      }
    }
    return true;
  };

  const draftEmployeeForCalculation = useMemo<Employee>(() => {
    const today = setHoursSafe(new Date());
    return {
      id: existingEmployee?.id ?? 'draft',
      idNumber: String(formData.idNumber ?? ''),
      fullName: String(formData.fullName ?? ''),
      gender: (formData.gender as Employee['gender']) ?? 'Male',
      dateOfBirth: formData.dateOfBirth,
      bloodGroup: formData.bloodGroup,
      maritalStatus: formData.maritalStatus,
      positionNumber: String(formData.positionNumber ?? ''),
      reportsToPositionNumber: formData.reportsToPositionNumber,
      designation: String(formData.designation ?? ''),
      staffingCategory: String(formData.staffingCategory ?? ''),
      overtimeGroupName: String(formData.overtimeGroupName ?? STANDARD_OVERTIME_GROUP),
      department: String(formData.department ?? ''),
      unit: String(formData.unit ?? ''),
      region: String(formData.region ?? ''),
      dutyStation: String(formData.dutyStation ?? ''),
      jobLocation: String(formData.jobLocation ?? ''),
      contractType: (formData.contractType as Employee['contractType']) ?? 'Regular',
      jobStatus: (formData.jobStatus as Employee['jobStatus']) ?? 'Full-Time',
      employmentStatus: (formData.employmentStatus as Employee['employmentStatus']) ?? 'Active',
      joiningDate: formData.joiningDate ?? today,
      contractStartDate: formData.contractStartDate,
      contractEndDate: formData.contractEndDate,
      currency,
      createdAt: existingEmployee?.createdAt ?? new Date(),
    };
  }, [currency, existingEmployee, formData]);

  const goNext = () => {
    if (!validateStep(stepIndex)) return;
    setStepIndex((prev) => Math.min(prev + 1, steps.length - 1));
  };

  const goPrev = () => {
    if (stepIndex === 0) {
      router.push('/employees');
      return;
    }
    setStepIndex((prev) => Math.max(prev - 1, 0));
  };

  const handleSubmit = async (event: React.FormEvent) => {
    event.preventDefault();
    if (!validateAll()) return;

    setLoading(true);
    try {
      const employeeIdToSave = employeeId ?? crypto.randomUUID();
      const normalized: Employee = {
        ...draftEmployeeForCalculation,
        id: employeeIdToSave,
        idNumber: String(formData.idNumber ?? '').trim(),
        fullName: String(formData.fullName ?? '').trim(),
        positionNumber: String(formData.positionNumber ?? '').trim() || undefined,
        reportsToPositionNumber: String(formData.reportsToPositionNumber ?? '').trim() || undefined,
        designation: String(formData.designation ?? '').trim(),
        staffingCategory: String(formData.staffingCategory ?? '').trim(),
        overtimeGroupName: String(formData.overtimeGroupName ?? '').trim() || undefined,
        department: String(formData.department ?? '').trim(),
        unit: String(formData.unit ?? '').trim(),
        region: String(formData.region ?? '').trim(),
        dutyStation: String(formData.dutyStation ?? '').trim(),
        jobLocation: String(formData.jobLocation ?? '').trim(),
        joiningDate: setHoursSafe(formData.joiningDate as Date),
        contractStartDate:
          formData.contractStartDate instanceof Date
            ? setHoursSafe(formData.contractStartDate)
            : undefined,
        contractEndDate:
          formData.contractEndDate instanceof Date
            ? setHoursSafe(formData.contractEndDate)
            : undefined,
        currency,
        createdAt: existingEmployee?.createdAt ?? new Date(),
      };

      if (isNew) {
        payrollStore.addEmployee(normalized);
      } else if (employeeId) {
        const inStore = payrollStore.getEmployee(employeeId);
        if (inStore) {
          payrollStore.updateEmployee(employeeId, normalized);
        } else {
          // Store may hydrate after first paint; upsert full row instead of throwing.
          payrollStore.addEmployee(normalized);
        }
      }

      router.push('/employees');
    } finally {
      setLoading(false);
    }
  };

  const selectOptions = {
    gender: GENDER_OPTIONS.map((option) => ({ value: option.value, label: option.label })),
    bloodGroup: BLOOD_GROUP_OPTIONS.map((option) => ({ value: option.value, label: option.label })),
    maritalStatus: MARITAL_STATUS_OPTIONS.map((option) => ({ value: option.value, label: option.label })),
    contractType: CONTRACT_TYPE_OPTIONS.map((option) => ({ value: option.value, label: option.label })),
    jobStatus: JOB_STATUS_OPTIONS.map((option) => ({ value: option.value, label: option.label })),
    employmentStatus: EMPLOYEE_STATUS_OPTIONS.map((option) => ({
      value: option.value,
      label: option.label,
    })),
  };

  return (
    <div className="min-h-screen bg-gray-50 px-3 py-4 sm:px-5">
      <form className="mx-auto w-full max-w-5xl space-y-4" onSubmit={handleSubmit}>
        <div className="overflow-hidden rounded-2xl border border-[var(--primary-border)] bg-white">
          <div className="px-5 py-8 sm:px-8">
            <div className="flex items-center gap-3">
              <button
                type="button"
                onClick={() => router.push('/dashboard')}
                aria-label="Back to dashboard"
                className="inline-flex h-9 w-9 items-center justify-center rounded-lg border border-slate-200 bg-white text-slate-700 transition-colors hover:bg-slate-50 hover:text-slate-900"
              >
                <svg
                  viewBox="0 0 24 24"
                  fill="none"
                  stroke="currentColor"
                  strokeWidth="2"
                  strokeLinecap="round"
                  strokeLinejoin="round"
                  className="h-4 w-4"
                >
                  <path d="M15 18 9 12l6-6" />
                </svg>
              </button>
              <h1 className="text-2xl font-bold text-slate-950">{section.label}</h1>
            </div>
          </div>
          <HeaderDivider />

          <div className="px-5 py-8 sm:px-8">
            <div className="mb-10 flex items-center justify-between gap-2">
              {steps.map((step, index) => (
                <button
                  key={step.key}
                  type="button"
                  onClick={() => {
                    if (index <= stepIndex || validateStep(stepIndex)) {
                      setStepIndex(index);
                    }
                  }}
                  className="flex flex-1 items-center last:flex-none"
                  aria-label={`Go to ${step.label}`}
                >
                  <span
                    className={`flex h-10 w-10 shrink-0 items-center justify-center rounded-full text-base transition-colors ${
                      stepIndex >= index
                        ? 'bg-[var(--primary)] text-white'
                        : 'bg-[var(--primary-light)] text-gray-700'
                    }`}
                  >
                    {index + 1}
                  </span>
                  {index < steps.length - 1 ? (
                    <span
                      className={`mx-3 h-1 flex-1 rounded-full ${
                        stepIndex > index ? 'bg-[var(--primary)]' : 'bg-[var(--primary-light)]'
                      }`}
                    />
                  ) : null}
                </button>
              ))}
            </div>

            <div className="rounded-lg border border-[var(--primary-border)] bg-white p-5 shadow-inner sm:p-7">
              <div className="mb-7">
                <h2 className="text-xl font-bold text-slate-950">{section.label}</h2>
              </div>

              {section.key === 'personal' ? (
                <div className="grid grid-cols-1 gap-x-8 gap-y-6 md:grid-cols-2">
                  <Field label="ID Number" required error={errors.idNumber}>
                    <Input
                      value={String(formData.idNumber ?? '')}
                      onChange={(event) => handleEmployeeChange('idNumber', event.target.value as never)}
                      placeholder="Enter ID number"
                      className="h-11 rounded-md"
                      required
                    />
                  </Field>
                  <Field label="Full Name" required error={errors.fullName}>
                    <Input
                      value={String(formData.fullName ?? '')}
                      onChange={(event) => handleEmployeeChange('fullName', event.target.value as never)}
                      placeholder="Enter full name"
                      className="h-11 rounded-md"
                      required
                    />
                  </Field>
                  <CustomSelect
                    label="Gender"
                    required
                    value={String(formData.gender ?? '')}
                    options={selectOptions.gender}
                    placeholder="Select gender..."
                    error={errors.gender}
                    onChange={(value) => handleEmployeeChange('gender', value as never)}
                  />
                  <Field label="Date of Birth">
                    <DatePicker
                      value={formData.dateOfBirth}
                      onChange={(date) =>
                        handleEmployeeChange('dateOfBirth', (date ? setHoursSafe(date) : undefined) as never)
                      }
                      placeholder="dd/mm/yyyy"
                      className="h-11 rounded-md"
                    />
                  </Field>
                  <CustomSelect
                    label="Blood Group"
                    value={String(formData.bloodGroup ?? '')}
                    options={selectOptions.bloodGroup}
                    placeholder="Select blood group..."
                    onChange={(value) => handleEmployeeChange('bloodGroup', value as never)}
                  />
                  <CustomSelect
                    label="Marital Status"
                    value={String(formData.maritalStatus ?? '')}
                    options={selectOptions.maritalStatus}
                    placeholder="Select marital status..."
                    onChange={(value) => handleEmployeeChange('maritalStatus', value as never)}
                  />
                </div>
              ) : null}

              {section.key === 'job' ? (
                <div className="grid grid-cols-1 gap-x-8 gap-y-6 md:grid-cols-2">
                  <Field label="Position Number" error={errors.positionNumber}>
                    <Input
                      value={String(formData.positionNumber ?? '')}
                      onChange={(event) => handleEmployeeChange('positionNumber', event.target.value as never)}
                      placeholder="Enter position number"
                      className="h-11 rounded-md"
                    />
                  </Field>
                  <Field label="Designation" required error={errors.designation}>
                    <Input
                      value={String(formData.designation ?? '')}
                      onChange={(event) => handleEmployeeChange('designation', event.target.value as never)}
                      placeholder="Enter designation"
                      className="h-11 rounded-md"
                      required
                    />
                  </Field>
                  <Field label="Staffing Category">
                    <Input
                      value={String(formData.staffingCategory ?? '')}
                      onChange={(event) => handleEmployeeChange('staffingCategory', event.target.value as never)}
                      placeholder="Enter staffing category"
                      className="h-11 rounded-md"
                    />
                  </Field>
                  <Field label="Department" required error={errors.department}>
                    <Input
                      value={String(formData.department ?? '')}
                      onChange={(event) => handleEmployeeChange('department', event.target.value as never)}
                      placeholder="Enter department"
                      className="h-11 rounded-md"
                      required
                    />
                  </Field>
                  <Field label="Unit">
                    <Input
                      value={String(formData.unit ?? '')}
                      onChange={(event) => handleEmployeeChange('unit', event.target.value as never)}
                      placeholder="Enter unit"
                      className="h-11 rounded-md"
                    />
                  </Field>
                  <Field label="Region">
                    <Input
                      value={String(formData.region ?? '')}
                      onChange={(event) => handleEmployeeChange('region', event.target.value as never)}
                      placeholder="Enter region"
                      className="h-11 rounded-md"
                    />
                  </Field>
                  <Field label="Duty Station">
                    <Input
                      value={String(formData.dutyStation ?? '')}
                      onChange={(event) => handleEmployeeChange('dutyStation', event.target.value as never)}
                      placeholder="Enter duty station"
                      className="h-11 rounded-md"
                    />
                  </Field>
                  <Field label="Job Location">
                    <Input
                      value={String(formData.jobLocation ?? '')}
                      onChange={(event) => handleEmployeeChange('jobLocation', event.target.value as never)}
                      placeholder="Enter job location"
                      className="h-11 rounded-md"
                    />
                  </Field>
                </div>
              ) : null}

              {section.key === 'contract' ? (
                <div className="grid grid-cols-1 gap-x-8 gap-y-6 md:grid-cols-2">
                  {/* Joining date: first standalone row (half width on desktop). */}
                  <Field label="Joining Date" required error={errors.joiningDate}>
                    <DatePicker
                      value={formData.joiningDate}
                      onChange={handleJoiningDateChange}
                      placeholder="dd/mm/yyyy"
                      className="h-11 rounded-md"
                    />
                  </Field>
                  <div className="hidden md:block" />

                  {/* Contract dates: start/end on the next grid row. */}
                  <Field label="Contract Start Date" error={errors.contractStartDate}>
                    <DatePicker
                      value={formData.contractStartDate}
                      onChange={(date) => {
                        contractStartTouchedRef.current = true;
                        handleEmployeeChange('contractStartDate', (date ? setHoursSafe(date) : undefined) as never);
                      }}
                      placeholder="dd/mm/yyyy"
                      className="h-11 rounded-md"
                    />
                  </Field>
                  <Field label="Contract End Date">
                    <DatePicker
                      value={formData.contractEndDate}
                      onChange={(date) =>
                        handleEmployeeChange('contractEndDate', (date ? setHoursSafe(date) : undefined) as never)
                      }
                      placeholder="dd/mm/yyyy"
                      className="h-11 rounded-md"
                    />
                  </Field>

                  {/* Contract type/job status as the last grid row. */}
                  <CustomSelect
                    label="Contract Type"
                    value={String(formData.contractType ?? '')}
                    options={selectOptions.contractType}
                    placeholder="Select contract type..."
                    onChange={(value) => handleEmployeeChange('contractType', value as never)}
                  />
                  <CustomSelect
                    label="Job Status"
                    value={String(formData.jobStatus ?? '')}
                    options={selectOptions.jobStatus}
                    placeholder="Select job status..."
                    onChange={(value) => handleEmployeeChange('jobStatus', value as never)}
                  />

                  <CustomSelect
                    label="Currency"
                    value={currency}
                    options={optionSet('currency', baseOptions.currency)}
                    placeholder="Select currency..."
                    onChange={(value) => handleEmployeeChange('currency', value as never)}
                    onAddOption={(option) => addCustomOption('currency', option)}
                  />

                  {isSupportStaffCategory ? (
                    <CustomSelect
                      label="Overtime Group"
                      required
                      value={String(formData.overtimeGroupName ?? '')}
                      options={supportOvertimeGroupOptions}
                      placeholder="Select overtime group..."
                      error={errors.overtimeGroupName}
                      onChange={(value) => handleEmployeeChange('overtimeGroupName', value as never)}
                    />
                  ) : null}
                </div>
              ) : null}

              {section.key === 'review' ? (
                <div className="space-y-6">
                  <ReviewTwoColumn
                    leftTitle="Personal Details"
                    rightTitle="Job Details"
                    leftRows={[
                      { key: 'idNumber', label: 'ID Number', value: String(formData.idNumber ?? '') },
                      { key: 'fullName', label: 'Full Name', value: String(formData.fullName ?? '') },
                      { key: 'gender', label: 'Gender', value: String(formData.gender ?? '') },
                      { key: 'dob', label: 'Date of Birth', value: formatDateDisplay(formData.dateOfBirth) },
                      { key: 'bloodGroup', label: 'Blood Group', value: String(formData.bloodGroup ?? '') },
                      { key: 'maritalStatus', label: 'Marital Status', value: String(formData.maritalStatus ?? '') },
                    ]}
                    rightRows={[
                      { key: 'positionNumber', label: 'Position Number', value: String(formData.positionNumber ?? '') },
                      { key: 'designation', label: 'Designation', value: String(formData.designation ?? '') },
                      { key: 'staffingCategory', label: 'Staffing Category', value: String(formData.staffingCategory ?? '') },
                      { key: 'department', label: 'Department', value: String(formData.department ?? '') },
                      { key: 'unit', label: 'Unit', value: String(formData.unit ?? '') },
                      { key: 'region', label: 'Region', value: String(formData.region ?? '') },
                      { key: 'dutyStation', label: 'Duty Station', value: String(formData.dutyStation ?? '') },
                      { key: 'jobLocation', label: 'Job Location', value: String(formData.jobLocation ?? '') },
                    ]}
                  />

                  <div className="rounded-2xl border border-slate-200 bg-white p-5 sm:p-6">
                    <div className="mb-3">
                      <div className="text-[13px] font-semibold leading-snug text-slate-900">Contract Details</div>
                      <HeaderDivider className="mt-2" />
                    </div>
                    <ReviewDetailRow label="Joining Date" value={formatDateDisplay(formData.joiningDate)} />
                    <ReviewDetailRow label="Contract Start Date" value={formatDateDisplay(formData.contractStartDate)} />
                    <ReviewDetailRow label="Contract End Date" value={formatDateDisplay(formData.contractEndDate)} />
                    <ReviewDetailRow label="Contract Type" value={String(formData.contractType ?? '')} />
                    <ReviewDetailRow label="Job Status" value={String(formData.jobStatus ?? '')} />
                    <ReviewDetailRow label="Currency" value={String(formData.currency ?? DEFAULT_CURRENCY)} />
                    <ReviewDetailRow
                      label="Overtime Group"
                      value={String(formData.overtimeGroupName ?? STANDARD_OVERTIME_GROUP)}
                    />
                  </div>
                </div>
              ) : null}

              <div className="mt-10 flex items-center justify-between">
                <Button
                  type="button"
                  onClick={goPrev}
                  variant="outline"
                  className="h-11 min-w-24 rounded-md border-[var(--primary)] px-5 text-[var(--primary-strong)] hover:bg-[var(--primary-light)] hover:text-slate-900"
                >
                  Previous
                </Button>

                {stepIndex < steps.length - 1 ? (
                  <Button
                    type="button"
                    onClick={goNext}
                    variant="outline"
                    className="h-11 min-w-24 rounded-md border-[var(--primary)] px-5 text-[var(--primary-strong)] hover:bg-[var(--primary-light)] hover:text-slate-900"
                  >
                    Next
                  </Button>
                ) : (
                  <Button
                    type="submit"
                    disabled={loading}
                    variant="outline"
                    className="h-11 min-w-28 rounded-md border-[var(--primary)] px-5 text-[var(--primary-strong)] hover:bg-[var(--primary-light)] hover:text-slate-900"
                  >
                    {loading ? 'Saving...' : 'Create'}
                  </Button>
                )}
              </div>
            </div>
          </div>
        </div>
      </form>
    </div>
  );
}
