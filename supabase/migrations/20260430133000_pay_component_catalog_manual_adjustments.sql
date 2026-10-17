-- Add standard manual payroll adjustment components (earning/deduction, variable) per org.
-- These are used for one-time payroll adjustments via payroll_adjustments.

WITH target_orgs AS (
  SELECT id AS org_id FROM public.organizations
), seed AS (
  SELECT * FROM (VALUES
    ('manual_addition', 'Manual Addition', 'earning', 'variable', 'bonus', 'payroll_input', 40),
    ('loan_recovery', 'Loan Recovery', 'deduction', 'variable', 'recovery', 'payroll_input', 90),
    ('overpayment_recovery', 'Overpayment Recovery', 'deduction', 'variable', 'recovery', 'payroll_input', 91),
    ('salary_correction', 'Salary Correction', 'deduction', 'variable', 'recovery', 'payroll_input', 92)
  ) AS t(component_code, display_name, direction, frequency, component_type, source_mode, sort_order)
)
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
  o.org_id,
  s.component_code,
  s.display_name,
  s.direction,
  s.frequency,
  s.component_type,
  'amount'::text,
  s.source_mode,
  CASE WHEN s.direction = 'deduction' THEN 'deductions' ELSE 'earnings' END,
  s.sort_order,
  true,
  NULL,
  NULL,
  NULL
FROM target_orgs o
CROSS JOIN seed s
WHERE NOT EXISTS (
  SELECT 1
  FROM public.pay_component_catalog c
  WHERE c.org_id = o.org_id
    AND lower(c.component_code) = lower(s.component_code)
);

