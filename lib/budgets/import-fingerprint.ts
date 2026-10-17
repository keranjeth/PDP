import { createHash } from 'crypto';
import {
  budgetImportCanonicalPayload,
  type BudgetImportRecord,
} from '@/lib/budget-import';

/** Server-only SHA-256 fingerprint of a confirmed budget import payload. */
export function budgetImportFingerprint(records: BudgetImportRecord[]): string {
  return createHash('sha256').update(budgetImportCanonicalPayload(records)).digest('hex');
}
