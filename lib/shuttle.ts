import 'server-only';
import { db } from './supabase';

/** ISO timestamp -> 'YYYY-MM-DDTHH:mm' in Bangkok (the value a datetime-local input takes) */
export const toBkkLocal = (iso: string) =>
  new Date(iso).toLocaleString('sv-SE', { timeZone: 'Asia/Bangkok' }).slice(0, 16).replace(' ', 'T');

/** Is there a free van for a trip starting at this Bangkok local time? Plus nearby free times when not. */
export async function shuttleCheck(local: string, pax: number): Promise<{ ok: boolean; suggestions: string[] }> {
  if (!/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}$/.test(local) || !(pax >= 1 && pax <= 20)) return { ok: true, suggestions: [] };
  const { data, error } = await db().rpc('shuttle_check', { p_at: `${local}:00+07:00`, p_pax: pax });
  if (error || !data) return { ok: true, suggestions: [] };   // never block a booking because the check failed
  const d = data as { ok: boolean; suggestions: string[] };
  return { ok: d.ok, suggestions: (d.suggestions ?? []).map(toBkkLocal) };
}
