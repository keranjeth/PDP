-- Phase 4: variable payroll inputs.
-- Adds import staging, payroll adjustments, and overtime entry tables that can feed
-- the payroll run domain without changing the existing payroll calculation formulas.

CREATE TABLE IF NOT EXISTS public.payroll_import_batches (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id uuid NOT NULL REFERENCES public.organizations(id),
  import_type text NOT NULL,
  source_name text NULL,
  source_file_name text NULL,
  status text NOT NULL DEFAULT 'uploaded',
  row_count integer NOT NULL DEFAULT 0,
  success_count integer NOT NULL DEFAULT 0,
  error_count integer NOT NULL DEFAULT 0,
  notes text NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  created_by uuid NULL,
  updated_at timestamptz NOT NULL DEFAULT now(),
  updated_by uuid NULL,
  approved_at timestamptz NULL,
  approved_by uuid NULL,
  consumed_at timestamptz NULL,
  consumed_run_id uuid NULL,
  CONSTRAINT payroll_import_batches_org_id_id_key UNIQUE (org_id, id),
  CONSTRAINT payroll_import_batches_import_type_chk
    CHECK (import_type IN ('payroll_adjustment', 'overtime_entry', 'mixed')),
  CONSTRAINT payroll_import_batches_status_chk
    CHECK (status IN ('uploaded', 'validated', 'approved', 'partially_consumed', 'consumed', 'failed', 'cancelled')),
  CONSTRAINT payroll_import_batches_row_count_chk CHECK (row_count >= 0),
  CONSTRAINT payroll_import_batches_success_count_chk CHECK (success_count >= 0),
  CONSTRAINT payroll_import_batches_error_count_chk CHECK (error_count >= 0)
);

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM pg_constraint
    WHERE conrelid = 'public.payroll_import_batches'::regclass
      AND conname = 'payroll_import_batches_consumed_run_fk'
  ) THEN
    ALTER TABLE public.payroll_import_batches
      ADD CONSTRAINT payroll_import_batches_consumed_run_fk
      FOREIGN KEY (org_id, consumed_run_id)
      REFERENCES public.payroll_runs (org_id, id)
      ON UPDATE RESTRICT
      ON DELETE SET NULL;
  END IF;
END $$;

CREATE INDEX IF NOT EXISTS payroll_import_batches_org_status_created_idx
  ON public.payroll_import_batches (org_id, status, created_at DESC);

COMMENT ON TABLE public.payroll_import_batches IS
  'Staging header for imported payroll variable inputs such as adjustments and overtime entries.';

CREATE TABLE IF NOT EXISTS public.payroll_import_rows (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id uuid NOT NULL REFERENCES public.organizations(id),
  import_batch_id uuid NOT NULL,
  row_no integer NOT NULL,
  employee_id uuid NULL,
  employee_id_number text NULL,
  row_type text NOT NULL,
  payload jsonb NOT NULL DEFAULT '{}'::jsonb,
  normalized_payload jsonb NOT NULL DEFAULT '{}'::jsonb,
  status text NOT NULL DEFAULT 'staged',
  error_message text NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  consumed_at timestamptz NULL,
  CONSTRAINT payroll_import_rows_org_id_id_key UNIQUE (org_id, id),
  CONSTRAINT payroll_import_rows_batch_row_no_key UNIQUE (import_batch_id, row_no),
  CONSTRAINT payroll_import_rows_row_type_chk
    CHECK (row_type IN ('payroll_adjustment', 'overtime_entry')),
  CONSTRAINT payroll_import_rows_status_chk
    CHECK (status IN ('staged', 'validated', 'approved', 'rejected', 'consumed')),
  CONSTRAINT payroll_import_rows_row_no_chk CHECK (row_no > 0)
);

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM pg_constraint
    WHERE conrelid = 'public.payroll_import_rows'::regclass
      AND conname = 'payroll_import_rows_batch_fk'
  ) THEN
    ALTER TABLE public.payroll_import_rows
      ADD CONSTRAINT payroll_import_rows_batch_fk
      FOREIGN KEY (org_id, import_batch_id)
      REFERENCES public.payroll_import_batches (org_id, id)
      ON UPDATE RESTRICT
      ON DELETE CASCADE;
  END IF;

  IF NOT EXISTS (
    SELECT 1
    FROM pg_constraint
    WHERE conrelid = 'public.payroll_import_rows'::regclass
      AND conname = 'payroll_import_rows_employee_fk'
  ) THEN
    ALTER TABLE public.payroll_import_rows
      ADD CONSTRAINT payroll_import_rows_employee_fk
      FOREIGN KEY (org_id, employee_id)
      REFERENCES public.employees (org_id, id)
      ON UPDATE RESTRICT
      ON DELETE SET NULL;
  END IF;
END $$;

CREATE INDEX IF NOT EXISTS payroll_import_rows_batch_status_idx
  ON public.payroll_import_rows (import_batch_id, status, row_no);

CREATE INDEX IF NOT EXISTS payroll_import_rows_org_employee_idx
  ON public.payroll_import_rows (org_id, employee_id, created_at DESC)
  WHERE employee_id IS NOT NULL;

COMMENT ON TABLE public.payroll_import_rows IS
  'Row-level staging for imported payroll variable inputs before they are approved and consumed.';

CREATE OR REPLACE FUNCTION public.refresh_payroll_import_batch_counters()
RETURNS trigger
LANGUAGE plpgsql
AS $$
DECLARE
  target_batch_id uuid;
  target_org_id uuid;
BEGIN
  target_batch_id := COALESCE(NEW.import_batch_id, OLD.import_batch_id);
  target_org_id := COALESCE(NEW.org_id, OLD.org_id);

  UPDATE public.payroll_import_batches b
  SET
    row_count = stats.row_count,
    success_count = stats.success_count,
    error_count = stats.error_count,
    status = CASE
      WHEN b.status IN ('consumed', 'cancelled') THEN b.status
      WHEN stats.row_count = 0 THEN 'uploaded'
      WHEN stats.error_count > 0 AND stats.success_count = 0 THEN 'failed'
      WHEN stats.row_count > 0 AND stats.row_count = stats.success_count THEN 'approved'
      WHEN stats.success_count > 0 THEN 'validated'
      ELSE b.status
    END,
    updated_at = now()
  FROM (
    SELECT
      COUNT(*)::integer AS row_count,
      COUNT(*) FILTER (WHERE status IN ('validated', 'approved', 'consumed'))::integer AS success_count,
      COUNT(*) FILTER (WHERE status = 'rejected')::integer AS error_count
    FROM public.payroll_import_rows
    WHERE import_batch_id = target_batch_id
      AND org_id = target_org_id
  ) AS stats
  WHERE b.id = target_batch_id
    AND b.org_id = target_org_id;

  RETURN COALESCE(NEW, OLD);
END;
$$;

DROP TRIGGER IF EXISTS trg_refresh_payroll_import_batch_counters
  ON public.payroll_import_rows;

CREATE TRIGGER trg_refresh_payroll_import_batch_counters
  AFTER INSERT OR UPDATE OR DELETE
  ON public.payroll_import_rows
  FOR EACH ROW
  EXECUTE FUNCTION public.refresh_payroll_import_batch_counters();

CREATE OR REPLACE FUNCTION public.stamp_payroll_import_batch_status()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  IF NEW.status = 'approved' AND COALESCE(NEW.approved_at, OLD.approved_at) IS NULL THEN
    NEW.approved_at := now();
  END IF;

  IF NEW.status IN ('consumed', 'partially_consumed') AND COALESCE(NEW.consumed_at, OLD.consumed_at) IS NULL THEN
    NEW.consumed_at := now();
  END IF;

  NEW.updated_at := now();
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_stamp_payroll_import_batch_status
  ON public.payroll_import_batches;

CREATE TRIGGER trg_stamp_payroll_import_batch_status
  BEFORE UPDATE
  ON public.payroll_import_batches
  FOR EACH ROW
  EXECUTE FUNCTION public.stamp_payroll_import_batch_status();

CREATE TABLE IF NOT EXISTS public.payroll_adjustments (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id uuid NOT NULL REFERENCES public.organizations(id),
  employee_id uuid NOT NULL,
  component_catalog_id uuid NOT NULL,
  adjustment_direction text NOT NULL,
  reason_code text NULL,
  description text NOT NULL,
  amount numeric NOT NULL,
  quantity numeric NULL,
  rate numeric NULL,
  effective_from date NOT NULL,
  effective_to date NULL,
  application_mode text NOT NULL DEFAULT 'one_time',
  installment_count integer NULL,
  remaining_installments integer NULL,
  status text NOT NULL DEFAULT 'draft',
  import_batch_id uuid NULL,
  import_row_id uuid NULL,
  approved_at timestamptz NULL,
  approved_by uuid NULL,
  consumed_at timestamptz NULL,
  applied_run_employee_id uuid NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  created_by uuid NULL,
  updated_at timestamptz NOT NULL DEFAULT now(),
  updated_by uuid NULL,
  CONSTRAINT payroll_adjustments_org_id_id_key UNIQUE (org_id, id),
  CONSTRAINT payroll_adjustments_direction_chk
    CHECK (adjustment_direction IN ('earning', 'deduction')),
  CONSTRAINT payroll_adjustments_application_mode_chk
    CHECK (application_mode IN ('one_time', 'installment')),
  CONSTRAINT payroll_adjustments_status_chk
    CHECK (status IN ('draft', 'pending_approval', 'approved', 'partially_consumed', 'consumed', 'cancelled', 'rejected')),
  CONSTRAINT payroll_adjustments_amount_chk CHECK (amount >= 0),
  CONSTRAINT payroll_adjustments_quantity_chk CHECK (quantity IS NULL OR quantity >= 0),
  CONSTRAINT payroll_adjustments_rate_chk CHECK (rate IS NULL OR rate >= 0),
  CONSTRAINT payroll_adjustments_effective_range_chk
    CHECK (effective_to IS NULL OR effective_to >= effective_from),
  CONSTRAINT payroll_adjustments_installment_count_chk
    CHECK (installment_count IS NULL OR installment_count > 0),
  CONSTRAINT payroll_adjustments_remaining_installments_chk
    CHECK (remaining_installments IS NULL OR remaining_installments >= 0),
  CONSTRAINT payroll_adjustments_description_chk
    CHECK (btrim(description) <> '')
);

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM pg_constraint
    WHERE conrelid = 'public.payroll_adjustments'::regclass
      AND conname = 'payroll_adjustments_employee_fk'
  ) THEN
    ALTER TABLE public.payroll_adjustments
      ADD CONSTRAINT payroll_adjustments_employee_fk
      FOREIGN KEY (org_id, employee_id)
      REFERENCES public.employees (org_id, id)
      ON UPDATE RESTRICT
      ON DELETE RESTRICT;
  END IF;

  IF NOT EXISTS (
    SELECT 1
    FROM pg_constraint
    WHERE conrelid = 'public.payroll_adjustments'::regclass
      AND conname = 'payroll_adjustments_component_catalog_fk'
  ) THEN
    ALTER TABLE public.payroll_adjustments
      ADD CONSTRAINT payroll_adjustments_component_catalog_fk
      FOREIGN KEY (org_id, component_catalog_id)
      REFERENCES public.pay_component_catalog (org_id, id)
      ON UPDATE RESTRICT
      ON DELETE RESTRICT;
  END IF;

  IF NOT EXISTS (
    SELECT 1
    FROM pg_constraint
    WHERE conrelid = 'public.payroll_adjustments'::regclass
      AND conname = 'payroll_adjustments_import_batch_fk'
  ) THEN
    ALTER TABLE public.payroll_adjustments
      ADD CONSTRAINT payroll_adjustments_import_batch_fk
      FOREIGN KEY (org_id, import_batch_id)
      REFERENCES public.payroll_import_batches (org_id, id)
      ON UPDATE RESTRICT
      ON DELETE SET NULL;
  END IF;

  IF NOT EXISTS (
    SELECT 1
    FROM pg_constraint
    WHERE conrelid = 'public.payroll_adjustments'::regclass
      AND conname = 'payroll_adjustments_import_row_fk'
  ) THEN
    ALTER TABLE public.payroll_adjustments
      ADD CONSTRAINT payroll_adjustments_import_row_fk
      FOREIGN KEY (org_id, import_row_id)
      REFERENCES public.payroll_import_rows (org_id, id)
      ON UPDATE RESTRICT
      ON DELETE SET NULL;
  END IF;

  IF NOT EXISTS (
    SELECT 1
    FROM pg_constraint
    WHERE conrelid = 'public.payroll_adjustments'::regclass
      AND conname = 'payroll_adjustments_applied_run_employee_fk'
  ) THEN
    ALTER TABLE public.payroll_adjustments
      ADD CONSTRAINT payroll_adjustments_applied_run_employee_fk
      FOREIGN KEY (org_id, applied_run_employee_id)
      REFERENCES public.payroll_run_employees (org_id, id)
      ON UPDATE RESTRICT
      ON DELETE SET NULL;
  END IF;
END $$;

CREATE INDEX IF NOT EXISTS payroll_adjustments_org_status_effective_idx
  ON public.payroll_adjustments (org_id, status, effective_from, effective_to);

CREATE INDEX IF NOT EXISTS payroll_adjustments_org_employee_effective_idx
  ON public.payroll_adjustments (org_id, employee_id, effective_from DESC);

COMMENT ON TABLE public.payroll_adjustments IS
  'Approved or staged variable payroll adjustments that can be consumed into payroll runs.';

CREATE TABLE IF NOT EXISTS public.overtime_entries (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id uuid NOT NULL REFERENCES public.organizations(id),
  employee_id uuid NOT NULL,
  component_catalog_id uuid NULL,
  overtime_code text NOT NULL,
  work_date date NOT NULL,
  hours numeric NOT NULL,
  approved_hours numeric NULL,
  rate_override numeric NULL,
  status text NOT NULL DEFAULT 'draft',
  notes text NULL,
  import_batch_id uuid NULL,
  import_row_id uuid NULL,
  approved_at timestamptz NULL,
  approved_by uuid NULL,
  consumed_at timestamptz NULL,
  applied_run_employee_id uuid NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  created_by uuid NULL,
  updated_at timestamptz NOT NULL DEFAULT now(),
  updated_by uuid NULL,
  CONSTRAINT overtime_entries_org_id_id_key UNIQUE (org_id, id),
  CONSTRAINT overtime_entries_status_chk
    CHECK (status IN ('draft', 'pending_approval', 'approved', 'partially_consumed', 'consumed', 'cancelled', 'rejected')),
  CONSTRAINT overtime_entries_code_chk
    CHECK (btrim(overtime_code) <> ''),
  CONSTRAINT overtime_entries_hours_chk CHECK (hours >= 0),
  CONSTRAINT overtime_entries_approved_hours_chk CHECK (approved_hours IS NULL OR approved_hours >= 0),
  CONSTRAINT overtime_entries_rate_override_chk CHECK (rate_override IS NULL OR rate_override >= 0)
);

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM pg_constraint
    WHERE conrelid = 'public.overtime_entries'::regclass
      AND conname = 'overtime_entries_employee_fk'
  ) THEN
    ALTER TABLE public.overtime_entries
      ADD CONSTRAINT overtime_entries_employee_fk
      FOREIGN KEY (org_id, employee_id)
      REFERENCES public.employees (org_id, id)
      ON UPDATE RESTRICT
      ON DELETE RESTRICT;
  END IF;

  IF NOT EXISTS (
    SELECT 1
    FROM pg_constraint
    WHERE conrelid = 'public.overtime_entries'::regclass
      AND conname = 'overtime_entries_component_catalog_fk'
  ) THEN
    ALTER TABLE public.overtime_entries
      ADD CONSTRAINT overtime_entries_component_catalog_fk
      FOREIGN KEY (org_id, component_catalog_id)
      REFERENCES public.pay_component_catalog (org_id, id)
      ON UPDATE RESTRICT
      ON DELETE RESTRICT;
  END IF;

  IF NOT EXISTS (
    SELECT 1
    FROM pg_constraint
    WHERE conrelid = 'public.overtime_entries'::regclass
      AND conname = 'overtime_entries_import_batch_fk'
  ) THEN
    ALTER TABLE public.overtime_entries
      ADD CONSTRAINT overtime_entries_import_batch_fk
      FOREIGN KEY (org_id, import_batch_id)
      REFERENCES public.payroll_import_batches (org_id, id)
      ON UPDATE RESTRICT
      ON DELETE SET NULL;
  END IF;

  IF NOT EXISTS (
    SELECT 1
    FROM pg_constraint
    WHERE conrelid = 'public.overtime_entries'::regclass
      AND conname = 'overtime_entries_import_row_fk'
  ) THEN
    ALTER TABLE public.overtime_entries
      ADD CONSTRAINT overtime_entries_import_row_fk
      FOREIGN KEY (org_id, import_row_id)
      REFERENCES public.payroll_import_rows (org_id, id)
      ON UPDATE RESTRICT
      ON DELETE SET NULL;
  END IF;

  IF NOT EXISTS (
    SELECT 1
    FROM pg_constraint
    WHERE conrelid = 'public.overtime_entries'::regclass
      AND conname = 'overtime_entries_applied_run_employee_fk'
  ) THEN
    ALTER TABLE public.overtime_entries
      ADD CONSTRAINT overtime_entries_applied_run_employee_fk
      FOREIGN KEY (org_id, applied_run_employee_id)
      REFERENCES public.payroll_run_employees (org_id, id)
      ON UPDATE RESTRICT
      ON DELETE SET NULL;
  END IF;
END $$;

CREATE INDEX IF NOT EXISTS overtime_entries_org_status_work_date_idx
  ON public.overtime_entries (org_id, status, work_date DESC);

CREATE INDEX IF NOT EXISTS overtime_entries_org_employee_work_date_idx
  ON public.overtime_entries (org_id, employee_id, work_date DESC);

COMMENT ON TABLE public.overtime_entries IS
  'Approved or staged overtime source records that can be consumed into payroll runs.';

CREATE OR REPLACE FUNCTION public.stamp_variable_input_status()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  IF NEW.status = 'approved' AND COALESCE(NEW.approved_at, OLD.approved_at) IS NULL THEN
    NEW.approved_at := now();
  END IF;

  IF NEW.status IN ('consumed', 'partially_consumed') AND COALESCE(NEW.consumed_at, OLD.consumed_at) IS NULL THEN
    NEW.consumed_at := now();
  END IF;

  NEW.updated_at := now();
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_stamp_payroll_adjustment_status
  ON public.payroll_adjustments;

CREATE TRIGGER trg_stamp_payroll_adjustment_status
  BEFORE UPDATE
  ON public.payroll_adjustments
  FOR EACH ROW
  EXECUTE FUNCTION public.stamp_variable_input_status();

DROP TRIGGER IF EXISTS trg_stamp_overtime_entry_status
  ON public.overtime_entries;

CREATE TRIGGER trg_stamp_overtime_entry_status
  BEFORE UPDATE
  ON public.overtime_entries
  FOR EACH ROW
  EXECUTE FUNCTION public.stamp_variable_input_status();

CREATE OR REPLACE FUNCTION public.prevent_consumed_variable_input_mutation()
RETURNS trigger
LANGUAGE plpgsql
AS $$
DECLARE
  old_status text;
BEGIN
  IF TG_OP = 'DELETE' THEN
    old_status := OLD.status;
  ELSE
    old_status := OLD.status;
  END IF;

  IF old_status IN ('consumed', 'cancelled') THEN
    RAISE EXCEPTION 'Finalized variable payroll input is immutable' USING ERRCODE = '23514';
  END IF;

  RETURN COALESCE(NEW, OLD);
END;
$$;

DROP TRIGGER IF EXISTS trg_prevent_consumed_payroll_adjustment_mutation
  ON public.payroll_adjustments;

CREATE TRIGGER trg_prevent_consumed_payroll_adjustment_mutation
  BEFORE UPDATE OR DELETE
  ON public.payroll_adjustments
  FOR EACH ROW
  EXECUTE FUNCTION public.prevent_consumed_variable_input_mutation();

DROP TRIGGER IF EXISTS trg_prevent_consumed_overtime_entry_mutation
  ON public.overtime_entries;

CREATE TRIGGER trg_prevent_consumed_overtime_entry_mutation
  BEFORE UPDATE OR DELETE
  ON public.overtime_entries
  FOR EACH ROW
  EXECUTE FUNCTION public.prevent_consumed_variable_input_mutation();

ALTER TABLE public.payroll_import_batches ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.payroll_import_rows ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.payroll_adjustments ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.overtime_entries ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS payroll_import_batches_select_scoped ON public.payroll_import_batches;
CREATE POLICY payroll_import_batches_select_scoped
  ON public.payroll_import_batches
  FOR SELECT
  TO public
  USING (auth.uid() IS NOT NULL AND org_role(org_id) IS NOT NULL);

DROP POLICY IF EXISTS payroll_import_batches_insert_privileged ON public.payroll_import_batches;
CREATE POLICY payroll_import_batches_insert_privileged
  ON public.payroll_import_batches
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

DROP POLICY IF EXISTS payroll_import_batches_update_privileged ON public.payroll_import_batches;
CREATE POLICY payroll_import_batches_update_privileged
  ON public.payroll_import_batches
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

DROP POLICY IF EXISTS payroll_import_batches_delete_privileged ON public.payroll_import_batches;
CREATE POLICY payroll_import_batches_delete_privileged
  ON public.payroll_import_batches
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

DROP POLICY IF EXISTS payroll_import_rows_select_scoped ON public.payroll_import_rows;
CREATE POLICY payroll_import_rows_select_scoped
  ON public.payroll_import_rows
  FOR SELECT
  TO public
  USING (auth.uid() IS NOT NULL AND org_role(org_id) IS NOT NULL);

DROP POLICY IF EXISTS payroll_import_rows_insert_privileged ON public.payroll_import_rows;
CREATE POLICY payroll_import_rows_insert_privileged
  ON public.payroll_import_rows
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

DROP POLICY IF EXISTS payroll_import_rows_update_privileged ON public.payroll_import_rows;
CREATE POLICY payroll_import_rows_update_privileged
  ON public.payroll_import_rows
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

DROP POLICY IF EXISTS payroll_import_rows_delete_privileged ON public.payroll_import_rows;
CREATE POLICY payroll_import_rows_delete_privileged
  ON public.payroll_import_rows
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

DROP POLICY IF EXISTS payroll_adjustments_select_scoped ON public.payroll_adjustments;
CREATE POLICY payroll_adjustments_select_scoped
  ON public.payroll_adjustments
  FOR SELECT
  TO public
  USING (auth.uid() IS NOT NULL AND org_role(org_id) IS NOT NULL);

DROP POLICY IF EXISTS payroll_adjustments_insert_privileged ON public.payroll_adjustments;
CREATE POLICY payroll_adjustments_insert_privileged
  ON public.payroll_adjustments
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

DROP POLICY IF EXISTS payroll_adjustments_update_privileged ON public.payroll_adjustments;
CREATE POLICY payroll_adjustments_update_privileged
  ON public.payroll_adjustments
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

DROP POLICY IF EXISTS payroll_adjustments_delete_privileged ON public.payroll_adjustments;
CREATE POLICY payroll_adjustments_delete_privileged
  ON public.payroll_adjustments
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

DROP POLICY IF EXISTS overtime_entries_select_scoped ON public.overtime_entries;
CREATE POLICY overtime_entries_select_scoped
  ON public.overtime_entries
  FOR SELECT
  TO public
  USING (auth.uid() IS NOT NULL AND org_role(org_id) IS NOT NULL);

DROP POLICY IF EXISTS overtime_entries_insert_privileged ON public.overtime_entries;
CREATE POLICY overtime_entries_insert_privileged
  ON public.overtime_entries
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

DROP POLICY IF EXISTS overtime_entries_update_privileged ON public.overtime_entries;
CREATE POLICY overtime_entries_update_privileged
  ON public.overtime_entries
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

DROP POLICY IF EXISTS overtime_entries_delete_privileged ON public.overtime_entries;
CREATE POLICY overtime_entries_delete_privileged
  ON public.overtime_entries
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
