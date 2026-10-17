-- Payroll component catalog normalization (Phase 1)
-- This migration introduces a canonical component catalog without changing
-- the current payroll calculation engine.

CREATE OR REPLACE FUNCTION public.normalize_pay_component_code(input text)
RETURNS text
LANGUAGE sql
IMMUTABLE
AS $$
  SELECT regexp_replace(
    lower(regexp_replace(trim(COALESCE(input, '')), '[^a-zA-Z0-9]+', '_', 'g')),
    '^_+|_+$',
    '',
    'g'
  );
$$;

CREATE TABLE IF NOT EXISTS public.pay_component_catalog (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id uuid NOT NULL REFERENCES public.organizations(id),
  component_code text NOT NULL,
  display_name text NOT NULL,
  direction text NOT NULL,
  frequency text NOT NULL,
  component_type text NOT NULL,
  value_unit text NOT NULL,
  source_mode text NOT NULL,
  display_group text NULL,
  sort_order integer NOT NULL DEFAULT 0,
  is_active boolean NOT NULL DEFAULT true,
  legacy_component_type text NULL,
  legacy_input_key text NULL,
  legacy_calculation_key text NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  created_by uuid NULL,
  updated_at timestamptz NOT NULL DEFAULT now(),
  updated_by uuid NULL,

  CONSTRAINT pay_component_catalog_org_id_id_key UNIQUE (org_id, id),
  CONSTRAINT pay_component_catalog_org_code_key UNIQUE (org_id, component_code),
  CONSTRAINT pay_component_catalog_display_name_chk CHECK (btrim(display_name) <> ''),
  CONSTRAINT pay_component_catalog_code_chk CHECK (component_code ~ '^[a-z][a-z0-9_]*$'),
  CONSTRAINT pay_component_catalog_direction_chk
    CHECK (direction IN ('earning', 'deduction', 'employer_contribution', 'accrual')),
  CONSTRAINT pay_component_catalog_frequency_chk
    CHECK (frequency IN ('recurring', 'variable')),
  CONSTRAINT pay_component_catalog_component_type_chk
    CHECK (component_type IN (
      'salary',
      'allowance',
      'overtime',
      'bonus',
      'tax',
      'pension',
      'recovery',
      'salary_advance_repayment',
      'leave_encashment',
      'notice_payment',
      'notice_deduction'
    )),
  CONSTRAINT pay_component_catalog_value_unit_chk
    CHECK (value_unit IN ('amount', 'hours', 'days', 'rate', 'percent')),
  CONSTRAINT pay_component_catalog_source_mode_chk
    CHECK (source_mode IN (
      'compensation_record',
      'payroll_input',
      'calculation_output',
      'manual_adjustment',
      'imported_input',
      'derived_line'
    )),
  CONSTRAINT pay_component_catalog_sort_order_chk CHECK (sort_order >= 0)
);

CREATE UNIQUE INDEX IF NOT EXISTS pay_component_catalog_org_display_name_ci_key
  ON public.pay_component_catalog (org_id, lower(display_name));

CREATE INDEX IF NOT EXISTS pay_component_catalog_org_active_sort_idx
  ON public.pay_component_catalog (org_id, is_active, sort_order);

CREATE INDEX IF NOT EXISTS pay_component_catalog_org_classification_idx
  ON public.pay_component_catalog (org_id, direction, frequency, component_type);

CREATE INDEX IF NOT EXISTS pay_component_catalog_org_source_mode_idx
  ON public.pay_component_catalog (org_id, source_mode);

CREATE INDEX IF NOT EXISTS pay_component_catalog_org_legacy_component_ci_idx
  ON public.pay_component_catalog (org_id, lower(legacy_component_type))
  WHERE legacy_component_type IS NOT NULL;

COMMENT ON TABLE public.pay_component_catalog IS
  'Canonical payroll component catalog. Classification and representation layer for recurring compensation, payroll inputs, deductions, employer-side values, and accrual outputs. Does not alter the current payroll engine.';

COMMENT ON COLUMN public.pay_component_catalog.direction IS
  'earning | deduction | employer_contribution | accrual';

COMMENT ON COLUMN public.pay_component_catalog.frequency IS
  'recurring | variable';

COMMENT ON COLUMN public.pay_component_catalog.component_type IS
  'Business meaning for component classification (salary, allowance, overtime, pension, tax, etc.).';

COMMENT ON COLUMN public.pay_component_catalog.source_mode IS
  'Primary origin of the component: compensation_record, payroll_input, calculation_output, manual_adjustment, imported_input, or derived_line.';

ALTER TABLE public.pay_component_catalog ENABLE ROW LEVEL SECURITY;

CREATE POLICY pay_component_catalog_select_scoped
  ON public.pay_component_catalog
  FOR SELECT
  TO public
  USING (auth.uid() IS NOT NULL AND org_role(org_id) IS NOT NULL);

CREATE POLICY pay_component_catalog_insert_privileged
  ON public.pay_component_catalog
  FOR INSERT
  TO public
  WITH CHECK (
    auth.uid() IS NOT NULL
    AND org_role(org_id) = ANY (ARRAY[
      'super_admin'::org_role,
      'head_of_hr'::org_role,
      'hr_national'::org_role,
      'regional_hr'::org_role,
      'hr_manager'::org_role
    ])
  );

CREATE POLICY pay_component_catalog_update_privileged
  ON public.pay_component_catalog
  FOR UPDATE
  TO public
  USING (
    auth.uid() IS NOT NULL
    AND org_role(org_id) = ANY (ARRAY[
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
      'super_admin'::org_role,
      'head_of_hr'::org_role,
      'hr_national'::org_role,
      'regional_hr'::org_role,
      'hr_manager'::org_role
    ])
  );

CREATE POLICY pay_component_catalog_delete_privileged
  ON public.pay_component_catalog
  FOR DELETE
  TO public
  USING (
    auth.uid() IS NOT NULL
    AND org_role(org_id) = ANY (ARRAY[
      'super_admin'::org_role,
      'head_of_hr'::org_role
    ])
  );
