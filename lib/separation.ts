/** Shared separation / offboarding exit types (DB + UI). */

export const SEPARATION_EXIT_TYPE_VALUES = [
  'resignation',
  'end_of_contract',
  'termination',
  'retirement',
  'redundancy',
  'death',
] as const;

export type SeparationExitType = (typeof SEPARATION_EXIT_TYPE_VALUES)[number];

export const SEPARATION_EXIT_TYPE_OPTIONS: Array<{
  value: SeparationExitType;
  label: string;
}> = [
  { value: 'resignation', label: 'Resignation' },
  { value: 'end_of_contract', label: 'End of Contract' },
  { value: 'termination', label: 'Termination' },
  { value: 'retirement', label: 'Retirement' },
  { value: 'redundancy', label: 'Redundancy' },
  { value: 'death', label: 'Death' },
];

const LABEL_TO_VALUE = new Map(
  SEPARATION_EXIT_TYPE_OPTIONS.map((option) => [
    option.label.toLowerCase(),
    option.value,
  ])
);

const VALUE_SET = new Set<string>(SEPARATION_EXIT_TYPE_VALUES);

export function normalizeSeparationExitType(value: string): SeparationExitType | null {
  const trimmed = value.trim();
  if (!trimmed) return null;
  const asSnake = trimmed.toLowerCase().replace(/\s+/g, '_');
  if (VALUE_SET.has(asSnake)) {
    return asSnake as SeparationExitType;
  }
  return LABEL_TO_VALUE.get(trimmed.toLowerCase()) ?? null;
}

export function formatSeparationExitTypeLabel(value?: string | null): string {
  const normalized = normalizeSeparationExitType(String(value ?? ''));
  if (!normalized) {
    const raw = String(value ?? '').trim();
    return raw
      ? raw.replace(/_/g, ' ').replace(/\b\w/g, (char) => char.toUpperCase())
      : 'Offboarded';
  }
  return (
    SEPARATION_EXIT_TYPE_OPTIONS.find((option) => option.value === normalized)?.label ??
    normalized
  );
}
