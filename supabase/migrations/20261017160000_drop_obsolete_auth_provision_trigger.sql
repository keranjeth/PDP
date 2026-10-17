-- Remove obsolete auth.users trigger from an earlier PD Plan scaffold.
-- It inserted into public.app_users, which is not part of the current schema
-- (profiles / organizations / organization_members). Leaving it breaks
-- registration and email confirmation when app_users is absent.
--
-- Does not alter Supabase internal auth triggers or current membership model.

DROP TRIGGER IF EXISTS pd_plan_provision_auth_user ON auth.users;

DROP FUNCTION IF EXISTS public.pd_plan_provision_auth_user();
