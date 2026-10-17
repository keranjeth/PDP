import { createClient } from '@supabase/supabase-js';

/**
 * Supabase admin (secret key) client for server-only operations.
 *
 * Use this ONLY for actions that cannot be performed with RLS-protected user sessions
 * (e.g. inviting/creating auth users). All app data access should prefer RLS.
 * Never import this module from client components.
 */
export function getSupabaseAdminClient() {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const secretKey = process.env.SUPABASE_SECRET_KEY;

  if (!url || !secretKey) {
    throw new Error(
      'Missing Supabase admin env. Set NEXT_PUBLIC_SUPABASE_URL and SUPABASE_SECRET_KEY.'
    );
  }

  return createClient(url, secretKey, {
    auth: { autoRefreshToken: false, persistSession: false },
  });
}

