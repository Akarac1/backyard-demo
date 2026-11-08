import { db } from '@/lib/supabase';
import { currentUser, json, ownBooking } from '@/lib/request';
import { verifySlip } from '@/lib/slip';
import { afterConfirmed } from '@/lib/confirm';
import { dbErrorToThai } from '@/lib/format';
import { serverT } from '@/lib/i18nDict';

export async function POST(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const L = serverT(req);
  const uid = await currentUser(req);
  if (!uid) return json({ error: 'unauthorized' }, 401);
  const booking = await ownBooking(id, uid);
  if (!booking) return json({ error: 'not_found' }, 404);
  if (booking.status !== 'pending_payment' && booking.status !== 'expired')
    return json({ confirmed: booking.status === 'confirmed', message: L('การจองนี้ชำระแล้ว') });

  const form = await req.formData();
  const file = form.get('slip');
  if (!(file instanceof File) || file.size === 0) return json({ message: L('กรุณาแนบรูปสลิป') }, 400);
  if (file.size > 4_000_000) return json({ message: L('รูปใหญ่เกิน 4 MB') }, 400);

  const { data: payment } = await db().from('payments').select('*')
    .eq('booking_id', id).eq('kind', 'booking').eq('status', 'pending').maybeSingle();
  if (!payment) return json({ message: L('ไม่พบรายการชำระเงิน') }, 404);

  // Keep the slip for the admin, whatever the check says.
  const path = `${id}/${Date.now()}-${file.name.replace(/[^\w.-]/g, '_')}`;
  await db().storage.from('slips').upload(path, file, { contentType: file.type || 'image/jpeg' });
  await db().from('payments').update({ slip_path: path }).eq('id', payment.id);
  // Slip received: hold the spot longer so a slow bank check or the admin can still confirm it.
  await db().from('bookings').update({ hold_expires_at: new Date(Date.now() + 60 * 60_000).toISOString() })
    .eq('id', id).eq('status', 'pending_payment');

  const result = await verifySlip(file, { amount: payment.amount, notBefore: new Date(payment.created_at), remark: `Backyard ${booking.code}` });
  if (!result.ok) {
    // pending/error/review: the slip is kept and shows up for the admin to confirm by hand
    const pending = result.reason === 'pending' || result.reason === 'error' || result.reason === 'review';
    return json({ confirmed: false, pending, message: (() => { const m = L(result.key ?? result.message, result.vars); return pending ? L('{m} (กันที่ไว้ให้ 1 ชั่วโมง)', { m }) : m; })() });
  }

  const { error } = await db().rpc('confirm_payment', { p_payment_id: payment.id, p_verified_by: `auto:${result.provider}:${result.transRef}` });
  if (error) return json({ confirmed: false, message: dbErrorToThai(error.message, L.lang) }, 409);

  await afterConfirmed(id);
  return json({ confirmed: true, message: L('ชำระเงินสำเร็จ ยืนยันการจองแล้ว') });
}
