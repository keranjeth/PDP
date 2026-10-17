-- Replace legacy generic Allowance rows with clean named allowance structure.
-- The user will re-upload allowance data against these named components, so
-- existing active generic Allowance rows are retired instead of being guessed.

INSERT INTO public.allowance_types (org_id, name)
SELECT
  o.id,
  seed.name
FROM public.organizations o
CROSS JOIN (
  VALUES
    ('Responsibility Allowance'),
    ('Hardship Allowance'),
    ('Acting Allowance')
) AS seed(name)
ON CONFLICT (org_id, lower(name)) DO NOTHING;

UPDATE public.compensation_records
SET deleted_at = now()
WHERE deleted_at IS NULL
  AND lower(trim(component_type)) = 'allowance';

COMMENT ON TABLE public.allowance_types IS
  'Named allowance master. Generic legacy Allowance rows are retired in favor of explicit allowance components such as Responsibility Allowance, Hardship Allowance, and Acting Allowance.';
