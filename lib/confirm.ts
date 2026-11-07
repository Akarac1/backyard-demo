import 'server-only';
import { db } from './supabase';
import { confirmationFlex, push } from './line';
import { thDate } from './format';

/** After a booking is confirmed: assign shuttle vehicles and send the confirmation to the customer. */
export async function afterConfirmed(bookingId: string) {
  const { data: trips } = await db().from('shuttle_trips').select('id, pickup_at').eq('booking_id', bookingId);
  for (const t of trips ?? []) {
    if (t.pickup_at) {
      const { error } = await db().rpc('assign_vehicle', { p_trip_id: t.id });
      if (error) console.error('assign_vehicle', error.message);
    }
  }

  const { data: b } = await db().from('bookings')
    .select('code, plate, start_date, end_date, days, total_amount, shuttle, pax, customers(line_user_id)')
    .eq('id', bookingId).single();
  if (!b) return;
  const lineUserId = (b.customers as unknown as { line_user_id: string } | null)?.line_user_id;
  if (lineUserId) {
    await push(lineUserId, [confirmationFlex({
      code: b.code, plate: b.plate, start: thDate(b.start_date), end: thDate(b.end_date),
      days: b.days, total: b.total_amount, shuttle: b.shuttle, pax: b.pax,
    }, process.env.NEXT_PUBLIC_BASE_URL ?? '')]);
  }
}
