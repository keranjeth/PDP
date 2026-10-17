import { randomBytes, randomInt } from 'crypto';

export const PASSWORD_MIN_LENGTH = 12;

const UPPER = 'ABCDEFGHJKLMNPQRSTUVWXYZ';
const LOWER = 'abcdefghijkmnopqrstuvwxyz';
const DIGITS = '23456789';
const SPECIAL = '!@#$%^&*-_=+';
const ALL = `${UPPER}${LOWER}${DIGITS}${SPECIAL}`;

export type PasswordValidationResult = {
  ok: boolean;
  error?: string;
};

/** Shared password rules for create, change, and admin reset. */
export function validatePasswordStrength(password: string): PasswordValidationResult {
  const value = String(password ?? '');
  if (value.length < PASSWORD_MIN_LENGTH) {
    return {
      ok: false,
      error: `Password must be at least ${PASSWORD_MIN_LENGTH} characters long.`,
    };
  }
  if (!/[A-Z]/.test(value)) {
    return { ok: false, error: 'Password must include an uppercase letter.' };
  }
  if (!/[a-z]/.test(value)) {
    return { ok: false, error: 'Password must include a lowercase letter.' };
  }
  if (!/[0-9]/.test(value)) {
    return { ok: false, error: 'Password must include a number.' };
  }
  if (!/[!@#$%^&*\-_=+]/.test(value)) {
    return { ok: false, error: 'Password must include a special character.' };
  }
  return { ok: true };
}

function pick(chars: string): string {
  return chars[randomInt(0, chars.length)]!;
}

/** Cryptographically secure temporary password (never derived from employee id/email). */
export function generateSecureTempPassword(length = 16): string {
  const size = Math.max(PASSWORD_MIN_LENGTH, length);
  const required = [pick(UPPER), pick(LOWER), pick(DIGITS), pick(SPECIAL)];
  const rest = Array.from({ length: size - required.length }, () => pick(ALL));
  const chars = [...required, ...rest];

  // Fisher–Yates with crypto randomness
  for (let i = chars.length - 1; i > 0; i -= 1) {
    const j = randomInt(0, i + 1);
    const tmp = chars[i]!;
    chars[i] = chars[j]!;
    chars[j] = tmp;
  }

  // Touch randomBytes so entropy is drawn even if pick paths were short
  randomBytes(8);
  return chars.join('');
}

export function isSyntheticLocalEmail(email: string | null | undefined): boolean {
  const value = String(email ?? '').trim().toLowerCase();
  return value.endsWith('@workforce.local');
}

export function isDeliverableEmail(email: string | null | undefined): boolean {
  const value = String(email ?? '').trim().toLowerCase();
  if (!value || !value.includes('@')) return false;
  if (isSyntheticLocalEmail(value)) return false;
  // Basic shape check — not a deliverability guarantee.
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value);
}
