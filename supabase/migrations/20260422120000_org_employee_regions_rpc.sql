-- Fast distinct regions for an org (avoids transferring one row per employee to the browser).
CREATE OR REPLACE FUNCTION public.org_employee_regions(p_org_id uuid)
RETURNS TABLE(region text)
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF auth.uid() IS NULL THEN
    RAISE EXCEPTION 'not authenticated' USING ERRCODE = '28000';
  END IF;

  IF public.org_role(p_org_id) IS NULL THEN
    RAISE EXCEPTION 'forbidden' USING ERRCODE = '42501';
  END IF;

  RETURN QUERY
  SELECT DISTINCT trim(e.region)::text AS region
  FROM public.employees e
  WHERE e.org_id = p_org_id
    AND e.deleted_at IS NULL
    AND length(trim(e.region)) > 0
  ORDER BY 1;
END;
$$;

REVOKE ALL ON FUNCTION public.org_employee_regions(uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.org_employee_regions(uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION public.org_employee_regions(uuid) TO service_role;

CREATE INDEX IF NOT EXISTS employees_org_active_region_idx
  ON public.employees (org_id, region)
  WHERE deleted_at IS NULL AND length(trim(region)) > 0;
