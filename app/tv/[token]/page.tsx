import { notFound } from 'next/navigation';
import { timingSafeEqual } from 'node:crypto';
import { db } from '@/lib/supabase';
import { Board, type BoardTrip } from './Board';

export const dynamic = 'force-dynamic';
export const metadata = { title: 'จองานรับส่ง · Backyard', robots: { index: false, follow: false } };

const same = (a: string, b: string) => a.length === b.length && timingSafeEqual(Buffer.from(a), Buffer.from(b));

/** Driver board for the TV in the lot: trips coming up, who has taken them, and an alarm when one is late. */
export default async function TvPage({ params }: { params: Promise<{ token: string }> }) {
  const { token } = await params;
  const sb = db();
  const { data: s } = await sb.from('settings').select('tv_token, pickup_meeting_point').eq('id', 1).single();
  if (!s?.tv_token || !/^[0-9a-f]{64}$/.test(token) || !same(token, s.tv_token)) notFound();

  const now = Date.now();
  const from = new Date(now - 3 * 3600_000).toISOString();
  const to = new Date(now + 24 * 3600_000).toISOString();   // the next 24 hours, to get ready
  const sel = 'id, direction, pax, large_bags, pickup_at, landing_at, called_at, dispatched_at, status, departed_at, arrived_at, driver_staff_id, flight_number, drop_door, vehicles(name), driver:staff_users!shuttle_trips_driver_staff_id_fkey(display_name), bookings!inner(code, status, customers(name))';
  const [{ data: soon }, { data: called }] = await Promise.all([
    sb.from('shuttle_trips').select(sel).gte('pickup_at', from).lt('pickup_at', to)
      .not('status', 'in', '(done,cancelled)').in('bookings.status', ['confirmed', 'checked_in']).order('pickup_at'),
    // a customer who called the van counts whatever the planned time was
    sb.from('shuttle_trips').select(sel).not('called_at', 'is', null)
      .not('status', 'in', '(done,cancelled)').in('bookings.status', ['confirmed', 'checked_in']),
  ]);
  const seen = new Set<string>();
  const trips = ([...(called ?? []), ...(soon ?? [])] as unknown as BoardTrip[]).filter((t) => (seen.has(t.id) ? false : (seen.add(t.id), true)));
  // first names only on a screen others can see
  for (const t of trips) if (t.bookings?.customers?.name) t.bookings.customers.name = t.bookings.customers.name.trim().split(/\s+/)[0];
  return <Board trips={trips} serverNow={now} meetingPoint={s.pickup_meeting_point ?? ''} />;
}
