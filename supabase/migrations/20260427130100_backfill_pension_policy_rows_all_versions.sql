-- Ensure every policy version has the standard pension display rows (e.g. off-cycle sets).

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
  s.name,
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
  s.sort_order,
  s.value_label,
  s.applies_to
FROM public.payroll_policy_versions pv
CROSS JOIN (
  VALUES
    ('Eligibility', 10, 'Regular employees only', 'Regular employees'),
    ('Monthly Accrual', 20, 'Basic Salary ÷ 12', 'Regular employees'),
    ('Daily Rate', 30, 'Basic Salary ÷ 360', 'Regular employees'),
    ('Included in Gross Salary', 40, 'Yes', 'Regular employees'),
    ('Pension Tax Allocation', 50, 'Gross Pension × Tax Category', 'Regular employees')
) AS s(name, sort_order, value_label, applies_to)
WHERE NOT EXISTS (
  SELECT 1
  FROM public.payroll_policy_items i
  WHERE i.policy_version_id = pv.id
    AND i.policy_area = 'pension_rules'
    AND i.name = s.name
);
