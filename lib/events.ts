import 'server-only';
import { db } from './supabase';

/** Record something for the admin "สถานะระบบ" page. Never throws. */
export async function logEvent(kind: string, level: 'info' | 'warn' | 'error', message: string, detail?: unknown) {
  try {
    await db().from('system_events').insert({ kind, level, message: message.slice(0, 500), detail: detail ?? null });
  } catch { /* monitoring must never break the app */ }
}
