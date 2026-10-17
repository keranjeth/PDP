-- Payroll reporting view (camelCase JSONB keys per lib/types.ts).
-- Do NOT drop UNIQUE (org_id, id) on employees or payroll_months: composite FKs from
-- compensation_records / payroll_records require those constraints.
-- Do NOT drop UNIQUE (org_id, id_number) on employees: PostgREST upserts use ON CONFLICT (org_id, id_number).

-- Reporting view (RLS on underlying payroll_records / payroll_months applies)
CREATE OR REPLACE VIEW public.v_payroll_records_reporting AS
SELECT
  pr.id AS payroll_record_id,
  pr.org_id,
  pr.payroll_month_id,
  pr.employee_id,
  pm.month_key,
  pr.processed_at,
  pr.closed_at,
  pr.created_at,
  pr.updated_at,
  (pr.inputs->>'basicSalary')::numeric AS input_basic_salary,
  (pr.inputs->>'medicalAllowance')::numeric AS input_medical_allowance,
  (pr.inputs->>'foodAllowance')::numeric AS input_food_allowance,
  (pr.inputs->>'transportationAllowance')::numeric AS input_transportation_allowance,
  (pr.inputs->>'fixedOvertime')::numeric AS input_fixed_overtime,
  (pr.inputs->>'nightShiftAllowance')::numeric AS input_night_shift_allowance,
  (pr.inputs->>'bonuses')::numeric AS input_bonuses,
  (pr.inputs->>'overtime')::numeric AS input_overtime,
  (pr.inputs->>'payrollArrears')::numeric AS input_payroll_arrears,
  (pr.inputs->>'pensionArrears')::numeric AS input_pension_arrears_days,
  (pr.calculations->>'grossSalary')::numeric AS calc_gross_salary,
  (pr.calculations->>'taxDeduction')::numeric AS calc_tax_deduction,
  (pr.calculations->>'totalNetPayable')::numeric AS calc_total_net_payable,
  (pr.calculations->>'taxCategory')::numeric AS calc_tax_category,
  (pr.calculations->>'basicPension')::numeric AS calc_basic_pension,
  (pr.calculations->>'grossPension')::numeric AS calc_gross_pension,
  (pr.calculations->>'pensionTaxAllocation')::numeric AS calc_pension_tax_allocation,
  (pr.calculations->>'accruableNetPension')::numeric AS calc_accruable_net_pension,
  (pr.calculations->>'totalNetPayable')::numeric
    - COALESCE((pr.calculations->>'accruableNetPension')::numeric, 0) AS calc_take_home_pay
FROM public.payroll_records pr
JOIN public.payroll_months pm
  ON pm.id = pr.payroll_month_id
 AND pm.org_id = pr.org_id;

COMMENT ON VIEW public.v_payroll_records_reporting IS
  'Reporting extraction of payroll_records inputs/calculations JSONB; camelCase keys per lib/types.ts and lib/supabase/payroll-jsonb-contract.ts';
