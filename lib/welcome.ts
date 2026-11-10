import 'server-only';
import { db } from './supabase';
import { sendToCustomer, tripContext, welcomeMessages } from './tripMessages';

/**
 * Sends the "welcome to Suvarnabhumi" card (with the pickup-point picture) for every return trip
 * whose landing time has come. Runs from the 5-minute monitor job, and from /api/cron/welcome.
 */
export async function sendDueWelcomes(): Promise<{ checked: number; sent: Record<string, string>; error?: string }> {
  const { data: due, error } = await db().rpc('trips_due_welcome');
  if (error) return { checked: 0, sent: {}, error: error.message };
  const sent: Record<string, string> = {};
  for (const { id } of (due ?? []) as { id: string }[]) {
    // claim first, so two overlapping runs never send the same card twice
    const { data: first } = await db().rpc('trip_mark_welcome', { p_trip_id: id });
    if (!first) continue;
    const ctx = await tripContext(id, '', 'ทีมงาน Backyard');
    sent[id] = ctx ? await sendToCustomer(ctx, welcomeMessages(ctx)) : 'not_found';
    if (sent[id] === 'failed') {
      // LINE refused it (quota, outage): release the claim so the next 5-minute run tries again
      console.error('welcome card failed, will retry', id);
      await db().from('shuttle_trips').update({ welcome_sent_at: null }).eq('id', id);
    }
  }
  return { checked: due?.length ?? 0, sent };
}
