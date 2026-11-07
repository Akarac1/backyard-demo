import { db } from '@/lib/supabase';
import { currentUser, json, ownBooking } from '@/lib/request';
import { verifySlip } from '@/lib/slip';
import { afterConfirmed } from '@/lib/confirm';
import { dbErrorToThai } from '@/lib/format';

export async function POST(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const uid = await currentUser(req);
  if (!uid) return json({ error: 'unauthorized' }, 401);
  const booking = await ownBooking(id, uid);
  if (!booking) return json({ error: 'not_found' }, 404);
  if (booking.status !== 'pending_payment' && booking.status !== 'expired')
    return json({ confirmed: booking.status === 'confirmed', message: 'การจองนี้ชำระแล้ว' });

  const form = await req.formData();
  const file = form.get('slip');
  if (!(file instanceof File) || file.size === 0) return json({ message: 'กรุณาแนบรูปสลิป' }, 400);
  if (file.size > 5_000_000) return json({ message: 'รูปใหญ่เกิน 5 MB' }, 400);

  const { data: payment } = await db().from('payments').select('*')
    .eq('booking_id', id).eq('kind', 'booking').eq('status', 'pending').maybeSingle();
  if (!payment) return json({ message: 'ไม่พบรายการชำระเงิน' }, 404);

  // Keep the slip for the admin, whatever the check says.
  const path = `${id}/${Date.now()}-${file.name.replace(/[^\w.-]/g, '_')}`;
  await db().storage.from('slips').upload(path, file, { contentType: file.type || 'image/jpeg' });
  await db().from('payments').update({ slip_path: path }).eq('id', payment.id);
  // Slip received: hold the spot longer so a slow bank check or the admin can still confirm it.
  await db().from('bookings').update({ hold_expires_at: new Date(Date.now() + 60 * 60_000).toISOString() })
    .eq('id', id).eq('status', 'pending_payment');

  const result = await verifySlip(file, payment.amount);
  if (!result.ok) {
    const pending = result.reason === 'pending' || result.reason === 'error';
    return json({ confirmed: false, pending, message: pending ? `${result.message} (กันที่ไว้ให้ 1 ชั่วโมง)` : result.message });
  }

  const { error } = await db().rpc('confirm_payment', { p_payment_id: payment.id, p_verified_by: `auto:${result.provider}:${result.transRef}` });
  if (error) return json({ confirmed: false, message: dbErrorToThai(error.message) }, 409);

  await afterConfirmed(id);
  return json({ confirmed: true, message: 'ชำระเงินสำเร็จ ยืนยันการจองแล้ว' });
}
