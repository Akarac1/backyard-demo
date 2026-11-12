import { db } from '@/lib/supabase';
import { currentUser, json, ownBooking } from '@/lib/request';
import { paymentQr } from '@/lib/qr';

export async function GET(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const uid = await currentUser(req);
  if (!uid) return json({ error: 'unauthorized' }, 401);
  const booking = await ownBooking(id, uid);
  if (!booking) return json({ error: 'not_found' }, 404);

  // group booking: the lead car carries the one payment for every car
  let group: { leadId: string; total: number; cars: { id: string; plate: string; province: string; amount: number }[] } | null = null;
  const gid = (booking as unknown as { group_id: string | null }).group_id;
  if (gid) {
    const [{ data: g }, { data: cars }] = await Promise.all([
      db().from('booking_groups').select('lead_booking_id').eq('id', gid).maybeSingle(),
      db().from('bookings').select('id, plate, plate_province, total_amount').eq('group_id', gid).order('created_at'),
    ]);
    const list = (cars ?? []) as { id: string; plate: string; plate_province: string; total_amount: number }[];
    if (list.length > 1) group = {
      leadId: g?.lead_booking_id ?? list[0].id, total: list.reduce((a, c) => a + c.total_amount, 0),
      cars: list.map((c) => ({ id: c.id, plate: c.plate, province: c.plate_province, amount: c.total_amount })),
    };
  }
  const payable = group ? group.total : booking.total_amount;
  let qr: string | null = null;
  if (booking.status === 'pending_payment') qr = (await paymentQr(payable))?.image ?? null;
  return json({ booking, qr, group, payable, promptpayName: process.env.PROMPTPAY_NAME ?? 'Backyard Airport' });
}
