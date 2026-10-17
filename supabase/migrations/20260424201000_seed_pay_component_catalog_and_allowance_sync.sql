-- Phase 1 catalog seed + allowance_types synchronization.
-- Keeps the current pension formulas intact; these rows only classify how
-- existing outputs should be represented in display/reporting and future line items.

INSERT INTO public.pay_component_catalog (
  org_id,
  component_code,
  display_name,
  direction,
  frequency,
  component_type,
  value_unit,
  source_mode,
  display_group,
  sort_order,
  is_active,
  legacy_component_type,
  legacy_input_key,
  legacy_calculation_key
)
SELECT
  o.id,
  s.component_code,
  s.display_name,
  s.direction,
  s.frequency,
  s.component_type,
  s.value_unit,
  s.source_mode,
  s.display_group,
  s.sort_order,
  true,
  s.legacy_component_type,
  s.legacy_input_key,
  s.legacy_calculation_key
FROM public.organizations o
CROSS JOIN (
  VALUES
    ('basic_salary', 'Basic Salary', 'earning', 'recurring', 'salary', 'amount', 'compensation_record', 'earnings', 10, 'Basic Salary', NULL, NULL),
    ('medical', 'Medical', 'earning', 'recurring', 'allowance', 'amount', 'compensation_record', 'earnings', 20, 'Medical', NULL, NULL),
    ('food', 'Food', 'earning', 'recurring', 'allowance', 'amount', 'compensation_record', 'earnings', 30, 'Food', NULL, NULL),
    ('transportation', 'Transportation', 'earning', 'recurring', 'allowance', 'amount', 'compensation_record', 'earnings', 40, 'Transportation', NULL, NULL),
    ('fixed_overtime', 'Fixed Overtime', 'earning', 'recurring', 'overtime', 'amount', 'compensation_record', 'earnings', 50, 'Fixed Overtime', NULL, NULL),
    ('night_shift', 'Night Shift', 'earning', 'recurring', 'allowance', 'amount', 'compensation_record', 'earnings', 60, 'Night Shift', NULL, NULL),
    ('bonus', 'Bonus', 'earning', 'variable', 'bonus', 'amount', 'payroll_input', 'variable_earnings', 110, NULL, 'bonuses', NULL),
    ('overtime', 'Overtime', 'earning', 'variable', 'overtime', 'amount', 'payroll_input', 'variable_earnings', 120, NULL, 'overtime', NULL),
    ('payroll_arrears', 'Payroll Arrears', 'earning', 'variable', 'salary', 'amount', 'payroll_input', 'variable_earnings', 130, NULL, 'payrollArrears', NULL),
    ('tax_deduction', 'Tax Deduction', 'deduction', 'variable', 'tax', 'amount', 'calculation_output', 'deductions', 210, NULL, NULL, 'taxDeduction'),
    ('basic_pension_accrual', 'Current Month Pension', 'accrual', 'recurring', 'pension', 'amount', 'calculation_output', 'pension', 310, NULL, NULL, 'basicPension'),
    ('pension_arrears_accrual', 'Pension Arrears', 'accrual', 'variable', 'pension', 'amount', 'derived_line', 'pension', 320, NULL, 'pensionArrears', NULL),
    ('pension_tax_allocation', 'Pension Tax Allocation', 'deduction', 'variable', 'pension', 'amount', 'calculation_output', 'pension', 330, NULL, NULL, 'pensionTaxAllocation')
) AS s(
  component_code,
  display_name,
  direction,
  frequency,
  component_type,
  value_unit,
  source_mode,
  display_group,
  sort_order,
  legacy_component_type,
  legacy_input_key,
  legacy_calculation_key
)
ON CONFLICT (org_id, component_code) DO UPDATE
SET
  display_name = EXCLUDED.display_name,
  direction = EXCLUDED.direction,
  frequency = EXCLUDED.frequency,
  component_type = EXCLUDED.component_type,
  value_unit = EXCLUDED.value_unit,
  source_mode = EXCLUDED.source_mode,
  display_group = EXCLUDED.display_group,
  sort_order = EXCLUDED.sort_order,
  legacy_component_type = EXCLUDED.legacy_component_type,
  legacy_input_key = EXCLUDED.legacy_input_key,
  legacy_calculation_key = EXCLUDED.legacy_calculation_key,
  updated_at = now();

CREATE OR REPLACE FUNCTION public.sync_allowance_type_to_pay_component_catalog()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  base_code text;
  next_code text;
BEGIN
  IF NEW.name IS NULL OR btrim(NEW.name) = '' THEN
    RETURN NEW;
  END IF;

  base_code := public.normalize_pay_component_code(NEW.name);
  IF base_code IS NULL OR base_code = '' THEN
    RETURN NEW;
  END IF;

  next_code := CASE
    WHEN base_code IN (
      'basic_salary',
      'medical',
      'food',
      'transportation',
      'fixed_overtime',
      'night_shift',
      'bonus',
      'overtime',
      'payroll_arrears',
      'tax_deduction',
      'basic_pension_accrual',
      'pension_arrears_accrual',
      'pension_tax_allocation'
    ) THEN base_code || '_allowance'
    ELSE base_code
  END;

  INSERT INTO public.pay_component_catalog (
    org_id,
    component_code,
    display_name,
    direction,
    frequency,
    component_type,
    value_unit,
    source_mode,
    display_group,
    sort_order,
    is_active,
    legacy_component_type
  )
  VALUES (
    NEW.org_id,
    next_code,
    trim(NEW.name),
    'earning',
    'recurring',
    'allowance',
    'amount',
    'compensation_record',
    'allowances',
    500,
    true,
    trim(NEW.name)
  )
  ON CONFLICT (org_id, component_code) DO UPDATE
  SET
    display_name = EXCLUDED.display_name,
    direction = EXCLUDED.direction,
    frequency = EXCLUDED.frequency,
    component_type = EXCLUDED.component_type,
    value_unit = EXCLUDED.value_unit,
    source_mode = EXCLUDED.source_mode,
    display_group = EXCLUDED.display_group,
    is_active = true,
    legacy_component_type = EXCLUDED.legacy_component_type,
    updated_at = now();

  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_allowance_type_to_pay_component_catalog
  ON public.allowance_types;

CREATE TRIGGER trg_allowance_type_to_pay_component_catalog
  AFTER INSERT OR UPDATE OF org_id, name
  ON public.allowance_types
  FOR EACH ROW
  EXECUTE FUNCTION public.sync_allowance_type_to_pay_component_catalog();

INSERT INTO public.pay_component_catalog (
  org_id,
  component_code,
  display_name,
  direction,
  frequency,
  component_type,
  value_unit,
  source_mode,
  display_group,
  sort_order,
  is_active,
  legacy_component_type
)
SELECT
  at.org_id,
  CASE
    WHEN public.normalize_pay_component_code(at.name) IN (
      'basic_salary',
      'medical',
      'food',
      'transportation',
      'fixed_overtime',
      'night_shift',
      'bonus',
      'overtime',
      'payroll_arrears',
      'tax_deduction',
      'basic_pension_accrual',
      'pension_arrears_accrual',
      'pension_tax_allocation'
    ) THEN public.normalize_pay_component_code(at.name) || '_allowance'
    ELSE public.normalize_pay_component_code(at.name)
  END,
  trim(at.name),
  'earning',
  'recurring',
  'allowance',
  'amount',
  'compensation_record',
  'allowances',
  500,
  true,
  trim(at.name)
FROM public.allowance_types at
WHERE at.name IS NOT NULL
  AND btrim(at.name) <> ''
  AND public.normalize_pay_component_code(at.name) <> ''
ON CONFLICT (org_id, component_code) DO UPDATE
SET
  display_name = EXCLUDED.display_name,
  is_active = true,
  legacy_component_type = EXCLUDED.legacy_component_type,
  updated_at = now();
