-- Extend public.member_status enum with pending_activation (additive).
-- Live DB uses enum member_status ('active','inactive'), not a CHECK constraint.
-- Does NOT bulk-update existing rows. Optional backfill is separate and requires approval.
--
-- PostgreSQL 12+ allows ADD VALUE inside a transaction (Supabase uses PG 15).
-- New enum labels cannot be used in the same transaction that adds them in some
-- older versions; this migration only adds the value and does not reference it
-- in DML, so it is safe under the Supabase migration workflow.

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM pg_enum e
    JOIN pg_type t ON t.oid = e.enumtypid
    JOIN pg_namespace n ON n.oid = t.typnamespace
    WHERE n.nspname = 'public'
      AND t.typname = 'member_status'
      AND e.enumlabel = 'pending_activation'
  ) THEN
    ALTER TYPE public.member_status ADD VALUE 'pending_activation';
  END IF;
END $$;

COMMENT ON TYPE public.member_status IS
  'Organization membership access status (separate from employee employment_status): active, inactive, pending_activation.';
