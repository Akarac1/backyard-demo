import { db } from '@/lib/supabase';
import { json } from '@/lib/request';
import { sendToCustomer, tripContext, welcomeMessage } from '@/lib/tripMessages';

export const dynamic = 'force-dynamic';

/**
 * Sends the "welcome to Suvarnabhumi" card for return trips whose landing time has come.
 * Call every 5 minutes from a scheduler (Supabase pg_cron + pg_net, n8n, cron-job.org…) with
 *   Authorization: Bearer <CRON_SECRET>
 */
export async function GET(req: Request) {
  const secret = process.env.CRON_SECRET;
  const auth = req.headers.get('authorization') ?? '';
  if (!secret || auth !== `Bearer ${secret}`) return json({ error: 'unauthorized' }, 401);

  const { data: due, error } = await db().rpc('trips_due_welcome');
  if (error) return json({ error: error.message }, 500);
  const results: Record<string, string> = {};
  for (const { id } of (due ?? []) as { id: string }[]) {
    // claim first, so two overlapping runs never send the same card twice
    const { data: first } = await db().rpc('trip_mark_welcome', { p_trip_id: id });
    if (!first) continue;
    const ctx = await tripContext(id, '', 'ทีมงาน Backyard');
    results[id] = ctx ? await sendToCustomer(ctx, welcomeMessage(ctx)) : 'not_found';
  }
  return json({ checked: due?.length ?? 0, sent: results });
}
