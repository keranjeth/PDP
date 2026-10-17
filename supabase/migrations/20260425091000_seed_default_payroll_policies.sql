-- Phase 3 seed: default organization-wide payroll policies.
-- These seeds provide resolvable baseline policy versions for payroll runs without
-- changing the existing payroll calculation formulas.

WITH orgs AS (
  SELECT id AS org_id
  FROM public.organizations
),
policy_seed AS (
  SELECT *
  FROM (VALUES
    ('regular_payroll', 'Default Regular Payroll Policy', 'Baseline regular payroll policy for the current payroll engine.'),
    ('offcycle_payroll', 'Default Off-cycle Payroll Policy', 'Baseline off-cycle payroll policy for the current payroll engine.'),
    ('final_payroll', 'Default Final Payroll Policy', 'Baseline final payroll policy for the current payroll engine.')
  ) AS v(policy_type, policy_name, description)
),
inserted_sets AS (
  INSERT INTO public.payroll_policy_sets (
    org_id,
    policy_name,
    policy_type,
    description,
    status
  )
  SELECT
    o.org_id,
    s.policy_name,
    s.policy_type,
    s.description,
    'active'
  FROM orgs o
  CROSS JOIN policy_seed s
  ON CONFLICT (org_id, policy_type, policy_name) DO UPDATE
  SET
    description = EXCLUDED.description,
    status = 'active',
    updated_at = now()
  RETURNING id, org_id, policy_type
),
all_sets AS (
  SELECT id, org_id, policy_type
  FROM inserted_sets
  UNION
  SELECT ps.id, ps.org_id, ps.policy_type
  FROM public.payroll_policy_sets ps
  WHERE ps.policy_name IN (
    'Default Regular Payroll Policy',
    'Default Off-cycle Payroll Policy',
    'Default Final Payroll Policy'
  )
),
inserted_versions AS (
  INSERT INTO public.payroll_policy_versions (
    org_id,
    policy_set_id,
    version_no,
    effective_from,
    effective_to,
    status,
    notes,
    approved_at
  )
  SELECT
    s.org_id,
    s.id,
    1,
    DATE '2000-01-01',
    NULL,
    'active',
    'Baseline seeded policy version for the current payroll engine. Current pension/tax formulas remain in application code.',
    now()
  FROM all_sets s
  ON CONFLICT (policy_set_id, version_no) DO UPDATE
  SET
    status = 'active',
    notes = EXCLUDED.notes,
    approved_at = COALESCE(public.payroll_policy_versions.approved_at, EXCLUDED.approved_at),
    updated_at = now()
  RETURNING id, org_id
),
all_versions AS (
  SELECT id, org_id
  FROM inserted_versions
  UNION
  SELECT pv.id, pv.org_id
  FROM public.payroll_policy_versions pv
  JOIN public.payroll_policy_sets ps
    ON ps.id = pv.policy_set_id
   AND ps.org_id = pv.org_id
  WHERE pv.version_no = 1
    AND ps.policy_name IN (
      'Default Regular Payroll Policy',
      'Default Off-cycle Payroll Policy',
      'Default Final Payroll Policy'
    )
)
INSERT INTO public.payroll_policy_scopes (
  org_id,
  policy_version_id,
  scope_type,
  scope_operator,
  scope_value,
  priority
)
SELECT
  v.org_id,
  v.id,
  'org',
  'eq',
  v.org_id::text,
  10
FROM all_versions v
WHERE NOT EXISTS (
  SELECT 1
  FROM public.payroll_policy_scopes ps
  WHERE ps.org_id = v.org_id
    AND ps.policy_version_id = v.id
    AND ps.scope_type = 'org'
    AND lower(ps.scope_value) = lower(v.org_id::text)
);
