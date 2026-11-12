import { db } from '@/lib/supabase';
import { currentUser, json, ownBooking } from '@/lib/request';
import { verifySlip } from '@/lib/slip';
import { afterConfirmed } from '@/lib/confirm';
import { dbErrorToThai } from '@/lib/format';
import { serverT } from '@/lib/i18nDict';

export async function POST(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id: reqId } = await params;
  const L = serverT(req);
  const uid = await currentUser(req);
  if (!uid) return json({ error: 'unauthorized' }, 401);
  let booking = await ownBooking(reqId, uid);
  if (!booking) return json({ error: 'not_found' }, 404);
  // group booking: the slip always belongs to the lead car (one payment for every car)
  const gid = (booking as unknown as { group_id: string | null }).group_id;
  if (gid) {
    const { data: g } = await db().from('booking_groups').select('lead_booking_id').eq('id', gid).maybeSingle();
    if (g?.lead_booking_id && g.lead_booking_id !== booking.id) booking = (await ownBooking(g.lead_booking_id, uid)) ?? booking;
  }
  const id = booking.id;
  if (booking.status !== 'pending_payment' && booking.status !== 'expired')
    return json({ confirmed: booking.status === 'confirmed', message: L('การจองนี้ชำระแล้ว') });

  const form = await req.formData();
  const file = form.get('slip');
  if (!(file instanceof File) || file.size === 0) return json({ message: L('กรุณาแนบรูปสลิป') }, 400);
  if (file.size > 4_000_000) return json({ message: L('รูปใหญ่เกิน 4 MB') }, 400);
  // images only, judged by the file's first bytes (the name and type the phone sends can be anything)
  const kind = imageKind(new Uint8Array(await file.slice(0, 12).arrayBuffer()));
  if (!kind) return json({ message: L('รองรับเฉพาะรูป JPG, PNG หรือ WebP') }, 400);

  const { data: payment } = await db().from('payments').select('*')
    .eq('booking_id', id).eq('kind', 'booking').eq('status', 'pending').maybeSingle();
  if (!payment) return json({ message: L('ไม่พบรายการชำระเงิน') }, 404);
  // at most 6 tries per payment: protects the slip-check quota
  const { error: tooMany } = await db().rpc('payment_slip_attempt', { p_payment: payment.id });
  if (tooMany) return json({ message: L('ส่งสลิปครบจำนวนครั้งแล้ว แอดมินจะตรวจสลิปล่าสุดให้ หรือทักแชทหาร้าน') }, 429);

  // Keep the slip for the admin, whatever the check says.
  const path = `${id}/${Date.now()}.${kind.ext}`;
  await db().storage.from('slips').upload(path, file, { contentType: kind.type });
  await db().from('payments').update({ slip_path: path }).eq('id', payment.id);
  // Slip received: hold the spot longer so a slow bank check or the admin can still confirm it.
  const hold = new Date(Date.now() + 60 * 60_000).toISOString();
  await db().from('bookings').update({ hold_expires_at: hold }).eq('id', id).eq('status', 'pending_payment');
  if (gid) await db().from('bookings').update({ hold_expires_at: hold }).eq('group_id', gid).eq('status', 'pending_payment');

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

/** JPG / PNG / WebP from the magic bytes, or null. */
function imageKind(b: Uint8Array): { ext: string; type: string } | null {
  if (b[0] === 0xff && b[1] === 0xd8 && b[2] === 0xff) return { ext: 'jpg', type: 'image/jpeg' };
  if (b[0] === 0x89 && b[1] === 0x50 && b[2] === 0x4e && b[3] === 0x47) return { ext: 'png', type: 'image/png' };
  if (b[0] === 0x52 && b[1] === 0x49 && b[2] === 0x46 && b[3] === 0x46 && b[8] === 0x57 && b[9] === 0x45 && b[10] === 0x42 && b[11] === 0x50)
    return { ext: 'webp', type: 'image/webp' };
  return null;
}
