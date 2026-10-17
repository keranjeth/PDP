-- PostgREST/Supabase upsert uses ON CONFLICT (org_id, id_number) (see payroll-db,
-- employees import). PostgreSQL 42P10 if no unique constraint matches those exact columns.
-- Case-insensitive uniqueness remains via employees_org_id_id_number_ci_uniq on
-- (org_id, lower(id_number)); that index does not satisfy the upsert conflict target.

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM pg_constraint
    WHERE conrelid = 'public.employees'::regclass
      AND conname = 'employees_org_id_id_number_key'
  ) THEN
    ALTER TABLE public.employees
      ADD CONSTRAINT employees_org_id_id_number_key UNIQUE (org_id, id_number);
  END IF;
END $$;
