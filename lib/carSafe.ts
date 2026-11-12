import 'server-only';
import { db } from './supabase';
import { push } from './line';
import { carSafeMessage } from './tripMessages';

export type SafeResult = 'sent' | 'no_line' | 'failed' | 'already';

/** Guard marked the car as found: send the "your car is safe" card once per booking per day. */
export async function sendCarSafeCard(actor: string, bookingId: string): Promise<SafeResult> {
  const { data: first, error } = await db().rpc('lot_claim_safe_card', { p_actor: actor, p_booking: bookingId });
  if (error) throw new Error(error.message);
  if (!first) return 'already';
  const { data: b } = await db().from('bookings').select('plate, customers(name, line_user_id)').eq('id', bookingId).single();
  const c = (b as unknown as { plate: string; customers: { name: string; line_user_id: string | null } | null } | null);
  const lineId = c?.customers?.line_user_id;
  if (!c || !lineId || lineId.startsWith('demo-')) return 'no_line';
  try {
    const ok = await push(lineId, [carSafeMessage({ plate: c.plate, name: c.customers?.name ?? '', checkedAt: new Date().toISOString() })]);
    if (ok) return 'sent';
  } catch (e) { console.error('car safe card', e); }
  // LINE refused it: release today's claim so the guard can press again
  await db().rpc('lot_release_safe_card', { p_actor: actor, p_booking: bookingId });
  return 'failed';
}
