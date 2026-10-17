import type { Employee } from './types';
import { EmployeeImportRecord } from './employee-import';

class EmployeeStore {
  private employees: Map<string, Employee>;
  private employeesCache: Employee[];
  private listeners: Set<() => void>;
  private revision: number;

  constructor() {
    this.employees = new Map();
    this.employeesCache = [];
    this.listeners = new Set();
    this.revision = 0;
  }

  subscribe(listener: () => void): () => void {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  private emitChange() {
    this.revision += 1;
    this.listeners.forEach((listener) => {
      try {
        listener();
      } catch (err) {
        console.error('EmployeeStore listener error:', err);
      }
    });
  }

  private refreshCaches() {
    this.employeesCache = Array.from(this.employees.values());
  }

  private persistAndSync() {
    this.refreshCaches();
    this.emitChange();
    if (typeof window !== 'undefined') {
      void import('./employee-remote-sync').then((m) => m.scheduleEmployeeRemoteSync());
    }
  }

  hydrateFromRemote(payload: { employees: Employee[] }): void {
    this.employees = new Map(payload.employees.map((e) => [e.id, e]));
    this.refreshCaches();
    this.emitChange();
  }

  markEmployeesOffboardedLocally(
    updates: Array<{ employeeId: string; lastWorkingDate: string }>
  ): void {
    for (const { employeeId, lastWorkingDate } of updates) {
      const employee = this.employees.get(employeeId);
      if (!employee) {
        continue;
      }
      const end = new Date(`${lastWorkingDate}T12:00:00`);
      this.employees.set(employeeId, {
        ...employee,
        employmentStatus: 'Inactive',
        contractEndDate: Number.isFinite(end.getTime()) ? end : employee.contractEndDate,
      });
    }
    this.refreshCaches();
    this.emitChange();
  }

  clearLocalState(): void {
    this.employees.clear();
    this.refreshCaches();
    this.emitChange();
  }

  getRevision(): number {
    return this.revision;
  }

  addEmployee(employee: Employee): void {
    this.employees.set(employee.id, employee);
    this.persistAndSync();
  }

  upsertEmployee(employeeData: EmployeeImportRecord) {
    const existingEmployee = Array.from(this.employees.values()).find(
      (employee) =>
        employee.idNumber.toLowerCase() === employeeData.idNumber.toLowerCase()
    );

    if (existingEmployee) {
      this.employees.set(existingEmployee.id, {
        ...existingEmployee,
        ...employeeData,
      });
      this.persistAndSync();
      return 'updated' as const;
    }

    const newEmployee: Employee = {
      id: crypto.randomUUID(),
      createdAt: new Date(),
      ...employeeData,
    };

    this.employees.set(newEmployee.id, newEmployee);
    this.persistAndSync();
    return 'created' as const;
  }

  upsertEmployees(importedEmployees: EmployeeImportRecord[]) {
    let created = 0;
    let updated = 0;

    importedEmployees.forEach((employeeData) => {
      const result = this.upsertEmployee(employeeData);
      if (result === 'created') {
        created += 1;
      } else {
        updated += 1;
      }
    });

    return { created, updated };
  }

  updateEmployee(id: string, updates: Partial<Employee>): void {
    const employee = this.employees.get(id);
    if (!employee) {
      throw new Error('Employee not found');
    }

    this.employees.set(id, { ...employee, ...updates });
    this.persistAndSync();
  }

  deleteEmployee(id: string): void {
    this.employees.delete(id);
    if (typeof window !== 'undefined') {
      void import('./employee-remote-sync').then(async (m) => {
        try {
          await m.pushSoftDeletedEmployee(id);
        } catch (err) {
          console.error('Remote employee delete failed:', err);
        }
        m.scheduleEmployeeRemoteSync();
      });
    }
  }

  purgeEmployeesLocally(ids: string[]): void {
    let changed = false;
    for (const id of ids) {
      if (this.employees.delete(id)) {
        changed = true;
      }
    }
    if (!changed) return;
    this.refreshCaches();
    this.emitChange();
  }

  getEmployees(): Employee[] {
    return this.employeesCache;
  }

  getEmployee(id: string): Employee | null {
    return this.employees.get(id) || null;
  }

  getActiveEmployees(): Employee[] {
    return Array.from(this.employees.values()).filter((e) => e.employmentStatus === 'Active');
  }

  getDashboardSummary() {
    const employees = this.getEmployees();
    const activeEmployees = employees.filter((e) => e.employmentStatus === 'Active');
    return {
      totalEmployees: employees.length,
      activeEmployees: activeEmployees.length,
    };
  }
}

export const employeeStore = new EmployeeStore();

/** @deprecated Use employeeStore */
export const payrollStore = employeeStore;
