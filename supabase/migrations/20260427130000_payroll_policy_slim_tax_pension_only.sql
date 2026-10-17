-- Slim payroll policy configuration to tax + pension items only; retire generic rules table.

ALTER TABLE public.payroll_policy_items
  ADD COLUMN IF NOT EXISTS value_label text NULL,
  ADD COLUMN IF NOT EXISTS applies_to text NULL DEFAULT 'Regular employees';

COMMENT ON COLUMN public.payroll_policy_items.value_label IS 'Human-readable policy value (e.g. pension rule description).';
COMMENT ON COLUMN public.payroll_policy_items.applies_to IS 'Cohort label (e.g. Regular employees).';

DELETE FROM public.payroll_policy_items
WHERE policy_area IN (
  'salary_allowances',
  'one_time_payments',
  'deductions_recoveries',
  'final_payroll_rules'
);

ALTER TABLE public.payroll_policy_items
  DROP CONSTRAINT IF EXISTS payroll_policy_items_area_chk;

ALTER TABLE public.payroll_policy_items
  ADD CONSTRAINT payroll_policy_items_area_chk
  CHECK (policy_area IN ('tax_rules', 'pension_rules'));

UPDATE public.payroll_policy_items
SET name = 'Included in Gross Salary'
WHERE policy_area = 'pension_rules' AND name = 'Included in Gross';

UPDATE public.payroll_policy_items
SET
  value_label = CASE trim(name)
    WHEN 'Eligibility' THEN 'Regular employees only'
    WHEN 'Monthly Accrual' THEN 'Basic Salary ÷ 12'
    WHEN 'Daily Rate' THEN 'Basic Salary ÷ 360'
    WHEN 'Included in Gross Salary' THEN 'Yes'
    ELSE value_label
  END,
  applies_to = COALESCE(NULLIF(trim(applies_to), ''), 'Regular employees')
WHERE policy_area = 'pension_rules'
  AND value_label IS NULL;

INSERT INTO public.payroll_policy_items (
  org_id,
  policy_version_id,
  policy_area,
  name,
  amount_type,
  value,
  value_from,
  value_to,
  base_amount,
  taxable,
  pensionable,
  approval_required,
  effective_date,
  status,
  sort_order,
  value_label,
  applies_to
)
SELECT
  pv.org_id,
  pv.id,
  'pension_rules',
  'Pension Tax Allocation',
  'display_only',
  NULL,
  NULL,
  NULL,
  NULL,
  false,
  false,
  false,
  pv.effective_from,
  'active',
  50,
  'Gross Pension × Tax Category',
  'Regular employees'
FROM public.payroll_policy_versions pv
WHERE NOT EXISTS (
  SELECT 1
  FROM public.payroll_policy_items i
  WHERE i.policy_version_id = pv.id
    AND i.policy_area = 'pension_rules'
    AND i.name = 'Pension Tax Allocation'
);

DROP TABLE IF EXISTS public.payroll_policy_rules CASCADE;
