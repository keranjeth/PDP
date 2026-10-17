-- Simplified payroll policy items.
-- Keeps policy sets / versions as the effective-dated parent model, but replaces
-- the generic rule registry UI target with readable payroll configuration rows.

CREATE TABLE IF NOT EXISTS public.payroll_policy_items (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id uuid NOT NULL REFERENCES public.organizations(id),
  policy_version_id uuid NOT NULL,
  policy_area text NOT NULL,
  name text NOT NULL,
  amount_type text NOT NULL,
  value numeric NULL,
  value_from numeric NULL,
  value_to numeric NULL,
  base_amount numeric NULL,
  taxable boolean NOT NULL DEFAULT false,
  pensionable boolean NOT NULL DEFAULT false,
  approval_required boolean NOT NULL DEFAULT false,
  effective_date date NOT NULL DEFAULT CURRENT_DATE,
  status text NOT NULL DEFAULT 'active',
  sort_order integer NOT NULL DEFAULT 100,
  created_at timestamptz NOT NULL DEFAULT now(),
  created_by uuid NULL,
  updated_at timestamptz NOT NULL DEFAULT now(),
  updated_by uuid NULL,
  CONSTRAINT payroll_policy_items_org_id_id_key UNIQUE (org_id, id),
  CONSTRAINT payroll_policy_items_version_fk
    FOREIGN KEY (org_id, policy_version_id)
    REFERENCES public.payroll_policy_versions (org_id, id)
    ON UPDATE RESTRICT
    ON DELETE CASCADE,
  CONSTRAINT payroll_policy_items_area_chk
    CHECK (policy_area IN (
      'salary_allowances',
      'tax_rules',
      'pension_rules',
      'one_time_payments',
      'deductions_recoveries',
      'final_payroll_rules'
    )),
  CONSTRAINT payroll_policy_items_amount_type_chk
    CHECK (amount_type IN (
      'manual',
      'fixed',
      'percent_basic_salary',
      'percent_gross_salary',
      'percent_taxable_earnings',
      'tax_bracket',
      'display_only'
    )),
  CONSTRAINT payroll_policy_items_status_chk
    CHECK (status IN ('draft', 'active', 'inactive', 'archived')),
  CONSTRAINT payroll_policy_items_name_chk
    CHECK (btrim(name) <> ''),
  CONSTRAINT payroll_policy_items_sort_order_chk
    CHECK (sort_order >= 0)
);

CREATE INDEX IF NOT EXISTS payroll_policy_items_org_version_area_idx
  ON public.payroll_policy_items (org_id, policy_version_id, policy_area, status, sort_order);

COMMENT ON TABLE public.payroll_policy_items IS
  'Readable payroll policy configuration rows for UI tables. Technical calculation metadata stays outside the user-facing UI.';

CREATE OR REPLACE FUNCTION public.touch_payroll_policy_item()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  NEW.updated_at := now();
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_touch_payroll_policy_item
  ON public.payroll_policy_items;

CREATE TRIGGER trg_touch_payroll_policy_item
  BEFORE UPDATE
  ON public.payroll_policy_items
  FOR EACH ROW
  EXECUTE FUNCTION public.touch_payroll_policy_item();

ALTER TABLE public.payroll_policy_items ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS payroll_policy_items_select_scoped ON public.payroll_policy_items;
CREATE POLICY payroll_policy_items_select_scoped
  ON public.payroll_policy_items
  FOR SELECT
  TO public
  USING (auth.uid() IS NOT NULL AND org_role(org_id) IS NOT NULL);

DROP POLICY IF EXISTS payroll_policy_items_insert_privileged ON public.payroll_policy_items;
CREATE POLICY payroll_policy_items_insert_privileged
  ON public.payroll_policy_items
  FOR INSERT
  TO public
  WITH CHECK (
    auth.uid() IS NOT NULL
    AND org_role(org_id) = ANY (ARRAY[
      'owner'::org_role,
      'admin'::org_role,
      'payroll_manager'::org_role,
      'super_admin'::org_role,
      'head_of_hr'::org_role,
      'hr_national'::org_role,
      'regional_hr'::org_role,
      'hr_manager'::org_role
    ])
  );

DROP POLICY IF EXISTS payroll_policy_items_update_privileged ON public.payroll_policy_items;
CREATE POLICY payroll_policy_items_update_privileged
  ON public.payroll_policy_items
  FOR UPDATE
  TO public
  USING (
    auth.uid() IS NOT NULL
    AND org_role(org_id) = ANY (ARRAY[
      'owner'::org_role,
      'admin'::org_role,
      'payroll_manager'::org_role,
      'super_admin'::org_role,
      'head_of_hr'::org_role,
      'hr_national'::org_role,
      'regional_hr'::org_role,
      'hr_manager'::org_role
    ])
  )
  WITH CHECK (
    auth.uid() IS NOT NULL
    AND org_role(org_id) = ANY (ARRAY[
      'owner'::org_role,
      'admin'::org_role,
      'payroll_manager'::org_role,
      'super_admin'::org_role,
      'head_of_hr'::org_role,
      'hr_national'::org_role,
      'regional_hr'::org_role,
      'hr_manager'::org_role
    ])
  );

DROP POLICY IF EXISTS payroll_policy_items_delete_privileged ON public.payroll_policy_items;
CREATE POLICY payroll_policy_items_delete_privileged
  ON public.payroll_policy_items
  FOR DELETE
  TO public
  USING (
    auth.uid() IS NOT NULL
    AND org_role(org_id) = ANY (ARRAY[
      'owner'::org_role,
      'admin'::org_role,
      'payroll_manager'::org_role,
      'super_admin'::org_role,
      'head_of_hr'::org_role
    ])
  );

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
  sort_order
)
SELECT
  pv.org_id,
  pv.id,
  seed.policy_area,
  seed.name,
  seed.amount_type,
  seed.value,
  seed.value_from,
  seed.value_to,
  seed.base_amount,
  seed.taxable,
  seed.pensionable,
  seed.approval_required,
  pv.effective_from,
  'active',
  seed.sort_order
FROM public.payroll_policy_versions pv
JOIN public.payroll_policy_sets ps
  ON ps.id = pv.policy_set_id
 AND ps.org_id = pv.org_id
CROSS JOIN (
  VALUES
    ('tax_rules', 'Income up to 5,000', 'tax_bracket', 0::numeric, 0::numeric, 5000::numeric, 0::numeric, false, false, false, 10),
    ('tax_rules', 'Income 5,001 to 12,500', 'tax_bracket', 0.02::numeric, 5000::numeric, 12500::numeric, 0::numeric, false, false, false, 20),
    ('tax_rules', 'Income 12,501 to 100,000', 'tax_bracket', 0.10::numeric, 12500::numeric, 100000::numeric, 150::numeric, false, false, false, 30),
    ('tax_rules', 'Income above 100,000', 'tax_bracket', 0.20::numeric, 100000::numeric, NULL::numeric, 8900::numeric, false, false, false, 40),
    ('pension_rules', 'Eligibility', 'display_only', NULL::numeric, NULL::numeric, NULL::numeric, NULL::numeric, false, false, false, 10),
    ('pension_rules', 'Monthly Accrual', 'display_only', NULL::numeric, NULL::numeric, NULL::numeric, NULL::numeric, false, false, false, 20),
    ('pension_rules', 'Daily Rate', 'display_only', NULL::numeric, NULL::numeric, NULL::numeric, NULL::numeric, false, false, false, 30),
    ('pension_rules', 'Included in Gross', 'display_only', NULL::numeric, NULL::numeric, NULL::numeric, NULL::numeric, false, false, false, 40),
    ('final_payroll_rules', 'Leave encashment', 'manual', NULL::numeric, NULL::numeric, NULL::numeric, NULL::numeric, true, false, true, 10),
    ('final_payroll_rules', 'Notice payment', 'manual', NULL::numeric, NULL::numeric, NULL::numeric, NULL::numeric, true, false, true, 20),
    ('final_payroll_rules', 'Notice deduction', 'manual', NULL::numeric, NULL::numeric, NULL::numeric, NULL::numeric, false, false, true, 30),
    ('final_payroll_rules', 'Recoveries', 'manual', NULL::numeric, NULL::numeric, NULL::numeric, NULL::numeric, false, false, true, 40),
    ('final_payroll_rules', 'Salary advance settlement', 'manual', NULL::numeric, NULL::numeric, NULL::numeric, NULL::numeric, false, false, true, 50),
    ('final_payroll_rules', 'Pension closeout', 'display_only', NULL::numeric, NULL::numeric, NULL::numeric, NULL::numeric, false, false, true, 60),
    ('final_payroll_rules', 'Tax treatment', 'display_only', NULL::numeric, NULL::numeric, NULL::numeric, NULL::numeric, false, false, true, 70)
) AS seed(
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
  sort_order
)
WHERE ps.policy_type IN ('regular_payroll', 'final_payroll')
  AND pv.version_no = 1
  AND NOT EXISTS (
    SELECT 1
    FROM public.payroll_policy_items existing
    WHERE existing.org_id = pv.org_id
      AND existing.policy_version_id = pv.id
      AND existing.policy_area = seed.policy_area
      AND lower(existing.name) = lower(seed.name)
  );
