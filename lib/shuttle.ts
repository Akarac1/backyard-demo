import 'server-only';
import { db } from './supabase';

/** ISO timestamp -> 'YYYY-MM-DDTHH:mm' in Bangkok (the value a datetime-local input takes) */
export const toBkkLocal = (iso: string) =>
  new Date(iso).toLocaleString('sv-SE', { timeZone: 'Asia/Bangkok' }).slice(0, 16).replace(' ', 'T');

/** Is there a free van for a trip starting at this Bangkok local time? Plus nearby free times when not. */
export const bagCount = (v: unknown) => Math.max(0, Math.min(20, Math.floor(Number(v) || 0)));

/** Is there a free vehicle (seats + bags) for a trip starting at this Bangkok local time? Plus nearby free times when not.
 *  tooBig = no regular vehicle takes this group at all (the customer should contact the shop). */
export async function shuttleCheck(local: string, pax: number, large = 0, small = 0): Promise<{ ok: boolean; tooBig: boolean; suggestions: string[] }> {
  if (!/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}$/.test(local) || !(pax >= 1 && pax <= 20)) return { ok: true, tooBig: false, suggestions: [] };
  const { data, error } = await db().rpc('shuttle_check', { p_at: `${local}:00+07:00`, p_pax: pax, p_large: bagCount(large), p_small: bagCount(small) });
  if (error || !data) return { ok: true, tooBig: false, suggestions: [] };   // never block a booking because the check failed
  const d = data as { ok: boolean; too_big?: boolean; suggestions: string[] };
  return { ok: d.ok, tooBig: !!d.too_big, suggestions: (d.suggestions ?? []).map(toBkkLocal) };
}
