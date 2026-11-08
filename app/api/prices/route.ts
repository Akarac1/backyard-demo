import { db } from '@/lib/supabase';
import { json } from '@/lib/request';

export const dynamic = 'force-dynamic';

/** Public: prices and rules shown on the booking page (set by the admin in /admin/settings). */
export async function GET() {
  const { data, error } = await db().from('settings')
    .select('price_per_day, shuttle_price, extra_price_per_day, hold_minutes, reschedule_min_days, pickup_meeting_point').eq('id', 1).single();
  if (error) return json({ error: 'unavailable' }, 500);
  return json(data);
}
