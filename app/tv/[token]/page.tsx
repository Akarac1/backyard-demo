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
  // Start of today in Bangkok (UTC+7, no DST): the driver's screen shows the whole day, so the TV must too.
  const BKK = 7 * 3600_000;
  const today0 = Math.floor((now + BKK) / 86400_000) * 86400_000 - BKK;
  const fromOut = new Date(Math.min(now - 3 * 3600_000, today0)).toISOString();
  const fromBack = new Date(today0 - 86400_000).toISOString();   // a return trip still open from yesterday (late flight) stays up
  const to = new Date(now + 24 * 3600_000).toISOString();   // the next 24 hours, to get ready
  // a car already checked out by the lot staff can still have its return trip open: keep it on the board
  const live = ['confirmed', 'checked_in', 'checked_out'];
  const sel = 'id, direction, pax, large_bags, pickup_at, landing_at, called_at, dispatched_at, status, departed_at, arrived_at, driver_staff_id, flight_number, drop_door, vehicles(name), driver:staff_users!shuttle_trips_driver_staff_id_fkey(display_name), bookings!inner(code, status, customers(name))';
  const open = () => sb.from('shuttle_trips').select(sel).not('status', 'in', '(done,cancelled)').in('bookings.status', live);
  const [outQ, backQ, calledQ] = await Promise.all([
    open().eq('direction', 'to_airport').gte('pickup_at', fromOut).lt('pickup_at', to).order('pickup_at'),
    // return trips: by planned pickup time or by landing time
    open().eq('direction', 'from_airport').or(`and(pickup_at.gte."${fromBack}",pickup_at.lt."${to}"),and(landing_at.gte."${fromBack}",landing_at.lt."${to}")`),
    // a customer who called the van counts whatever the planned time was
    open().not('called_at', 'is', null),
  ]);
  for (const q of [outQ, backQ, calledQ]) if (q.error) console.error('tv board query', q.error.message);
  const soon = [...(outQ.data ?? []), ...(backQ.data ?? [])];
  const called = calledQ.data;
  const seen = new Set<string>();
  const trips = ([...(called ?? []), ...(soon ?? [])] as unknown as BoardTrip[]).filter((t) => (seen.has(t.id) ? false : (seen.add(t.id), true)));
  // first names only on a screen others can see
  for (const t of trips) if (t.bookings?.customers?.name) t.bookings.customers.name = t.bookings.customers.name.trim().split(/\s+/)[0];
  return <Board trips={trips} serverNow={now} meetingPoint={s.pickup_meeting_point ?? ''} />;
}
