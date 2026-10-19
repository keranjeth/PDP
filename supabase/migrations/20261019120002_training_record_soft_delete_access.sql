-- Keep employee/region authorization on retained history. Live lists and costs exclude deleted rows.
ALTER POLICY training_read_scoped ON public.training_records
  USING (public.can_access_employee(org_id,employee_id));
