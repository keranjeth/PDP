export function formatSupabaseError(err: unknown): string {
  if (err == null) {
    return 'Unknown error';
  }
  if (err instanceof Error) {
    const base = err.message?.trim() || '';
    const cause =
      err.cause instanceof Error
        ? err.cause.message
        : err.cause != null
          ? formatSupabaseError(err.cause)
          : '';
    if (base && cause) {
      return `${base} (${cause})`;
    }
    if (base) {
      return base;
    }
    if (cause) {
      return cause;
    }
    return err.name || 'Error';
  }
  if (typeof err === 'object') {
    const o = err as Record<string, unknown>;
    const parts = [o.message, o.details, o.hint, o.code, o.error_description, o.error]
      .filter((v) => typeof v === 'string' && v.length > 0) as string[];
    if (parts.length > 0) {
      return parts.join(' — ');
    }
    try {
      const names = Object.getOwnPropertyNames(o);
      const pick: Record<string, unknown> = {};
      for (const k of names) {
        pick[k] = o[k];
      }
      const s = JSON.stringify(pick);
      if (s && s !== '{}') {
        return s;
      }
    } catch {
      /* ignore */
    }
  }
  try {
    return JSON.stringify(err);
  } catch {
    return String(err);
  }
}
