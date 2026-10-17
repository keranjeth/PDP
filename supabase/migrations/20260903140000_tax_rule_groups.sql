-- Parent groups for tax brackets. Child rows remain in payroll_policy_items.
CREATE TABLE IF NOT EXISTS public.tax_rule_groups (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id uuid NOT NULL REFERENCES public.organizations(id),
  policy_version_id uuid NOT NULL,
  name text NOT NULL,
  effective_from date NOT NULL,
  effective_to date NULL,
  enabled boolean NOT NULL DEFAULT true,
  created_at timestamptz NOT NULL DEFAULT now(),
  created_by uuid NULL,
  updated_at timestamptz NOT NULL DEFAULT now(),
  updated_by uuid NULL,
  CONSTRAINT tax_rule_groups_org_id_id_key UNIQUE (org_id, id),
  CONSTRAINT tax_rule_groups_name_chk CHECK (btrim(name) <> ''),
  CONSTRAINT tax_rule_groups_dates_chk CHECK (
    effective_to IS NULL OR effective_to >= effective_from
  ),
  CONSTRAINT tax_rule_groups_version_fk
    FOREIGN KEY (org_id, policy_version_id)
    REFERENCES public.payroll_policy_versions (org_id, id)
    ON UPDATE RESTRICT
    ON DELETE CASCADE
);

CREATE INDEX IF NOT EXISTS tax_rule_groups_org_version_effective_idx
  ON public.tax_rule_groups (org_id, policy_version_id, enabled, effective_from DESC);

COMMENT ON TABLE public.tax_rule_groups IS
  'Parent tax rule groups. Child brackets live in payroll_policy_items.tax_rule_group_id.';

ALTER TABLE public.payroll_policy_items
  ADD COLUMN IF NOT EXISTS tax_rule_group_id uuid NULL;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'payroll_policy_items_tax_rule_group_fk'
  ) THEN
    ALTER TABLE public.payroll_policy_items
      ADD CONSTRAINT payroll_policy_items_tax_rule_group_fk
      FOREIGN KEY (tax_rule_group_id)
      REFERENCES public.tax_rule_groups(id)
      ON UPDATE RESTRICT
      ON DELETE SET NULL;
  END IF;
END $$;

CREATE INDEX IF NOT EXISTS payroll_policy_items_tax_rule_group_idx
  ON public.payroll_policy_items (tax_rule_group_id);

ALTER TABLE public.tax_rule_groups ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS tax_rule_groups_select_scoped ON public.tax_rule_groups;
CREATE POLICY tax_rule_groups_select_scoped
  ON public.tax_rule_groups FOR SELECT TO public
  USING (auth.uid() IS NOT NULL AND org_role(org_id) IS NOT NULL);

DROP POLICY IF EXISTS tax_rule_groups_insert_privileged ON public.tax_rule_groups;
CREATE POLICY tax_rule_groups_insert_privileged
  ON public.tax_rule_groups FOR INSERT TO public
  WITH CHECK (
    auth.uid() IS NOT NULL
    AND org_role(org_id) = ANY (ARRAY[
      'owner'::org_role, 'admin'::org_role, 'payroll_manager'::org_role,
      'super_admin'::org_role, 'head_of_hr'::org_role
    ])
  );

DROP POLICY IF EXISTS tax_rule_groups_update_privileged ON public.tax_rule_groups;
CREATE POLICY tax_rule_groups_update_privileged
  ON public.tax_rule_groups FOR UPDATE TO public
  USING (
    auth.uid() IS NOT NULL
    AND org_role(org_id) = ANY (ARRAY[
      'owner'::org_role, 'admin'::org_role, 'payroll_manager'::org_role,
      'super_admin'::org_role, 'head_of_hr'::org_role
    ])
  )
  WITH CHECK (
    auth.uid() IS NOT NULL
    AND org_role(org_id) = ANY (ARRAY[
      'owner'::org_role, 'admin'::org_role, 'payroll_manager'::org_role,
      'super_admin'::org_role, 'head_of_hr'::org_role
    ])
  );

DROP POLICY IF EXISTS tax_rule_groups_delete_privileged ON public.tax_rule_groups;
CREATE POLICY tax_rule_groups_delete_privileged
  ON public.tax_rule_groups FOR DELETE TO public
  USING (
    auth.uid() IS NOT NULL
    AND org_role(org_id) = ANY (ARRAY[
      'owner'::org_role, 'admin'::org_role, 'payroll_manager'::org_role,
      'super_admin'::org_role
    ])
  );

GRANT SELECT, INSERT, UPDATE, DELETE ON TABLE public.tax_rule_groups TO anon, authenticated, service_role;

INSERT INTO public.tax_rule_groups (
  id, org_id, policy_version_id, name, effective_from, effective_to, enabled
)
SELECT
  gen_random_uuid(),
  org_id,
  policy_version_id,
  'Income Tax – ' || TO_CHAR(effective_date, 'Mon YYYY'),
  effective_date,
  NULL,
  BOOL_OR(status = 'active')
FROM public.payroll_policy_items
WHERE policy_area = 'tax_rules'
  AND amount_type = 'tax_bracket'
GROUP BY org_id, policy_version_id, effective_date
ON CONFLICT DO NOTHING;

UPDATE public.payroll_policy_items ppi
SET tax_rule_group_id = trg.id
FROM public.tax_rule_groups trg
WHERE ppi.policy_area = 'tax_rules'
  AND ppi.amount_type = 'tax_bracket'
  AND ppi.org_id = trg.org_id
  AND ppi.policy_version_id = trg.policy_version_id
  AND ppi.effective_date = trg.effective_from
  AND ppi.tax_rule_group_id IS NULL;

UPDATE public.tax_rule_groups trg
SET effective_to = nxt.next_from - 1,
    updated_at = NOW()
FROM (
  SELECT
    id,
    effective_from,
    LEAD(effective_from) OVER (
      PARTITION BY org_id, policy_version_id
      ORDER BY effective_from, created_at
    ) AS next_from
  FROM public.tax_rule_groups
) nxt
WHERE trg.id = nxt.id
  AND nxt.next_from IS NOT NULL
  AND nxt.next_from > trg.effective_from
  AND trg.effective_to IS NULL;
