-- Allow Internal / External delivery methods on training records.
ALTER TABLE public.training_records
  DROP CONSTRAINT IF EXISTS training_records_delivery_method_check;

ALTER TABLE public.training_records
  ADD CONSTRAINT training_records_delivery_method_check
  CHECK (
    delivery_method IN (
      'In Person',
      'Online',
      'Hybrid',
      'Internal',
      'External'
    )
  );
