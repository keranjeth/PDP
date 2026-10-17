-- Align tax_bracket rows on final_payroll policy versions with the canonical marginal schedule
-- (same numeric boundaries as regular payroll seed: 0–5000, 5000–12500, 12500–100000, 100000+).

UPDATE public.payroll_policy_items i
SET
  name = t.correct_name,
  value_from = t.correct_from,
  value_to = t.correct_to,
  base_amount = t.correct_base
FROM public.payroll_policy_versions pv
JOIN public.payroll_policy_sets ps
  ON ps.id = pv.policy_set_id
 AND ps.org_id = pv.org_id
JOIN (
  VALUES
    (0::numeric, 'Income up to 5,000'::text, 0::numeric, 5000::numeric, 0::numeric),
    (0.02::numeric, 'Income 5,001 to 12,500'::text, 5000::numeric, 12500::numeric, 0::numeric),
    (0.10::numeric, 'Income 12,501 to 100,000'::text, 12500::numeric, 100000::numeric, 150::numeric),
    (0.20::numeric, 'Income above 100,000'::text, 100000::numeric, NULL::numeric, 8900::numeric)
) AS t(rate, correct_name, correct_from, correct_to, correct_base)
  ON i.value = t.rate
WHERE ps.policy_type = 'final_payroll'
  AND i.policy_version_id = pv.id
  AND i.org_id = pv.org_id
  AND i.policy_area = 'tax_rules'
  AND i.amount_type = 'tax_bracket';
