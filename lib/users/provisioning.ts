import { generateSecureTempPassword } from '@/lib/users/password-policy';

const EMPLOYEE_EMAIL_DOMAIN = 'workforce.local';

export function normalizeEmployeeId(employeeId: unknown): string {
  return String(employeeId ?? '').trim();
}

export function generateEmployeeEmail(employeeId: unknown): string {
  const id = normalizeEmployeeId(employeeId);
  return `${id}@${EMPLOYEE_EMAIL_DOMAIN}`.toLowerCase();
}

/**
 * Temporary password for newly provisioned accounts.
 * Cryptographically random — never derived from employee id / email.
 */
export function generateEmployeeTempPassword(_employeeId?: unknown): string {
  void _employeeId;
  return generateSecureTempPassword(16);
}
