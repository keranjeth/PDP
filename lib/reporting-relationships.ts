import type { Employee } from '@/lib/types';

export function normalizePositionNumber(value: string): string {
  return value.trim().toLowerCase();
}

/**
 * Find who currently occupies a position slot. Prefers Active employment; if multiple,
 * uses the latest joining date. Falls back to inactive incumbents for display when no active match.
 */
export function resolveEmployeeForPositionNumber(
  positionNumber: string,
  employees: Iterable<Employee>
): Employee | null {
  const target = normalizePositionNumber(positionNumber);
  if (!target) {
    return null;
  }

  const matches = [...employees].filter(
    (e) => normalizePositionNumber(e.positionNumber ?? '') === target
  );

  if (matches.length === 0) {
    return null;
  }

  const active = matches.filter((e) => e.employmentStatus === 'Active');
  const pool = active.length > 0 ? active : matches;

  return [...pool].sort(
    (a, b) => b.joiningDate.getTime() - a.joiningDate.getTime()
  )[0]!;
}

/** Manager = current occupant of `employee.reportsToPositionNumber`. */
export function getManagerViaReportsToPosition(
  employee: Employee,
  allEmployees: Employee[]
): Employee | null {
  const reportsTo = employee.reportsToPositionNumber?.trim();
  if (!reportsTo) {
    return null;
  }
  return resolveEmployeeForPositionNumber(reportsTo, allEmployees);
}

/** Direct reports = employees whose `reportsToPositionNumber` equals this position. */
export function getDirectReportsViaPosition(
  employee: Employee,
  allEmployees: Employee[]
): Employee[] {
  const myPos = normalizePositionNumber(employee.positionNumber ?? '');
  if (!myPos) {
    return [];
  }

  return allEmployees
    .filter((e) => {
      if (e.id === employee.id) {
        return false;
      }
      const rt = e.reportsToPositionNumber?.trim();
      if (!rt) {
        return false;
      }
      return normalizePositionNumber(rt) === myPos;
    })
    .sort((a, b) =>
      a.fullName.localeCompare(b.fullName, undefined, { sensitivity: 'base' })
    );
}
