import { createBrowserClient } from '@supabase/ssr';
import type { SupabaseClient } from '@supabase/supabase-js';

export function clearSupabaseBrowserAuthStorage(): void {
  if (typeof window === 'undefined') {
    return;
  }

  try {
    const storage = window.localStorage;
    const keysToRemove: string[] = [];
    for (let i = 0; i < storage.length; i += 1) {
      const k = storage.key(i);
      if (!k) continue;
      if (k.startsWith('sb-') || k.includes('supabase.auth')) {
        keysToRemove.push(k);
      }
    }
    for (const k of keysToRemove) {
      storage.removeItem(k);
    }
  } catch {
    // Ignore storage access errors (private mode, disabled storage, etc.)
  }
}

export function getSupabaseBrowserClient(): SupabaseClient | null {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY;
  if (!url || !key) {
    return null;
  }
  try {
    return createBrowserClient(url, key);
  } catch (err: unknown) {
    const message = String(err instanceof Error ? err.message : err);
    // Supabase auth storage can occasionally be left in a truncated state (e.g. interrupted write),
    // which throws "Unexpected end of JSON input" during client initialization.
    // Self-heal by clearing Supabase browser auth keys and retrying once.
    if (
      typeof window !== 'undefined' &&
      message.toLowerCase().includes('unexpected end of json input')
    ) {
      clearSupabaseBrowserAuthStorage();

      try {
        return createBrowserClient(url, key);
      } catch {
        return null;
      }
    }
    return null;
  }
}
