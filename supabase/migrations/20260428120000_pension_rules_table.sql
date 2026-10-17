-- Structured pension policy per payroll policy version (replaces display-only pension_policy_items rows).

CREATE TABLE IF NOT EXISTS public.pension_rules (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id uuid NOT NULL REFERENCES public.organizations (id) ON DELETE CASCADE,
  policy_version_id uuid NOT NULL,
  eligibility text NOT NULL DEFAULT 'regular'::text,
  include_in_gross boolean NOT NULL DEFAULT true,
  pension_tax_method text NOT NULL DEFAULT 'tax_bracket'::text,
  is_active boolean NOT NULL DEFAULT true,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT pension_rules_org_version_unique UNIQUE (org_id, policy_version_id),
  CONSTRAINT pension_rules_eligibility_chk CHECK (eligibility IN ('all', 'regular', 'non_regular')),
  CONSTRAINT pension_rules_tax_method_chk CHECK (pension_tax_method = 'tax_bracket'::text),
  CONSTRAINT pension_rules_version_fk FOREIGN KEY (org_id, policy_version_id)
    REFERENCES public.payroll_policy_versions (org_id, id) ON DELETE CASCADE
);

CREATE INDEX IF NOT EXISTS pension_rules_org_version_idx
  ON public.pension_rules (org_id, policy_version_id);

COMMENT ON TABLE public.pension_rules IS
  'Single structured pension configuration per payroll policy version; drives eligibility, gross inclusion, and tax allocation method.';

COMMENT ON COLUMN public.pension_rules.eligibility IS
  'all | regular | non_regular — who may accrue pension under this policy version.';
COMMENT ON COLUMN public.pension_rules.include_in_gross IS
  'When true, gross pension is included in gross salary used for tax brackets.';
COMMENT ON COLUMN public.pension_rules.pension_tax_method IS
  'Allocation method; currently only tax_bracket (Gross Pension × tax category from progressive brackets).';

CREATE OR REPLACE FUNCTION public.touch_pension_rules_updated_at()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  NEW.updated_at := now();
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_touch_pension_rules ON public.pension_rules;
CREATE TRIGGER trg_touch_pension_rules
  BEFORE UPDATE ON public.pension_rules
  FOR EACH ROW
  EXECUTE FUNCTION public.touch_pension_rules_updated_at();

ALTER TABLE public.pension_rules ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS pension_rules_select_scoped ON public.pension_rules;
CREATE POLICY pension_rules_select_scoped
  ON public.pension_rules
  FOR SELECT
  TO public
  USING (auth.uid() IS NOT NULL AND org_role(org_id) IS NOT NULL);

DROP POLICY IF EXISTS pension_rules_insert_privileged ON public.pension_rules;
CREATE POLICY pension_rules_insert_privileged
  ON public.pension_rules
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

DROP POLICY IF EXISTS pension_rules_update_privileged ON public.pension_rules;
CREATE POLICY pension_rules_update_privileged
  ON public.pension_rules
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

DROP POLICY IF EXISTS pension_rules_delete_privileged ON public.pension_rules;
CREATE POLICY pension_rules_delete_privileged
  ON public.pension_rules
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

-- Seed one row per existing policy version (defaults match legacy behaviour).
INSERT INTO public.pension_rules (
  org_id,
  policy_version_id,
  eligibility,
  include_in_gross,
  pension_tax_method,
  is_active
)
SELECT
  pv.org_id,
  pv.id,
  'regular',
  true,
  'tax_bracket',
  true
FROM public.payroll_policy_versions pv
WHERE NOT EXISTS (
  SELECT 1
  FROM public.pension_rules pr
  WHERE pr.org_id = pv.org_id
    AND pr.policy_version_id = pv.id
);

DELETE FROM public.payroll_policy_items
WHERE policy_area = 'pension_rules';

ALTER TABLE public.payroll_policy_items
  DROP CONSTRAINT IF EXISTS payroll_policy_items_area_chk;

ALTER TABLE public.payroll_policy_items
  ADD CONSTRAINT payroll_policy_items_area_chk
  CHECK (policy_area IN ('tax_rules'));
