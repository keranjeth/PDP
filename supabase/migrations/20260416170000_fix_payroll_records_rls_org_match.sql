-- Fix payroll_records RLS policies: ensure open-month check matches the same org_id.
-- Prior versions had `pm.org_id = pm.org_id` (always true).

DO $$
BEGIN
  -- INSERT
  IF EXISTS (
    SELECT 1 FROM pg_policy
    WHERE polrelid = 'public.payroll_records'::regclass
      AND polname = 'payroll_records_insert_payroll_manager_open'
  ) THEN
    EXECUTE 'DROP POLICY payroll_records_insert_payroll_manager_open ON public.payroll_records';
  END IF;

  EXECUTE $p$
    CREATE POLICY payroll_records_insert_payroll_manager_open
    ON public.payroll_records
    FOR INSERT
    TO public
    WITH CHECK (
      (org_role(org_id) = ANY (ARRAY['owner'::org_role, 'admin'::org_role, 'payroll_manager'::org_role]))
      AND EXISTS (
        SELECT 1
        FROM payroll_months pm
        WHERE pm.id = payroll_records.payroll_month_id
          AND pm.org_id = payroll_records.org_id
          AND pm.status = 'open'::payroll_month_status
      )
    )
  $p$;

  -- UPDATE
  IF EXISTS (
    SELECT 1 FROM pg_policy
    WHERE polrelid = 'public.payroll_records'::regclass
      AND polname = 'payroll_records_update_payroll_manager_open'
  ) THEN
    EXECUTE 'DROP POLICY payroll_records_update_payroll_manager_open ON public.payroll_records';
  END IF;

  EXECUTE $p$
    CREATE POLICY payroll_records_update_payroll_manager_open
    ON public.payroll_records
    FOR UPDATE
    TO public
    USING (
      (org_role(org_id) = ANY (ARRAY['owner'::org_role, 'admin'::org_role, 'payroll_manager'::org_role]))
      AND EXISTS (
        SELECT 1
        FROM payroll_months pm
        WHERE pm.id = payroll_records.payroll_month_id
          AND pm.org_id = payroll_records.org_id
          AND pm.status = 'open'::payroll_month_status
      )
    )
    WITH CHECK (
      (org_role(org_id) = ANY (ARRAY['owner'::org_role, 'admin'::org_role, 'payroll_manager'::org_role]))
      AND EXISTS (
        SELECT 1
        FROM payroll_months pm
        WHERE pm.id = payroll_records.payroll_month_id
          AND pm.org_id = payroll_records.org_id
          AND pm.status = 'open'::payroll_month_status
      )
    )
  $p$;

  -- DELETE
  IF EXISTS (
    SELECT 1 FROM pg_policy
    WHERE polrelid = 'public.payroll_records'::regclass
      AND polname = 'payroll_records_delete_admin_open'
  ) THEN
    EXECUTE 'DROP POLICY payroll_records_delete_admin_open ON public.payroll_records';
  END IF;

  EXECUTE $p$
    CREATE POLICY payroll_records_delete_admin_open
    ON public.payroll_records
    FOR DELETE
    TO public
    USING (
      (org_role(org_id) = ANY (ARRAY['owner'::org_role, 'admin'::org_role]))
      AND EXISTS (
        SELECT 1
        FROM payroll_months pm
        WHERE pm.id = payroll_records.payroll_month_id
          AND pm.org_id = payroll_records.org_id
          AND pm.status = 'open'::payroll_month_status
      )
    )
  $p$;
END $$;

