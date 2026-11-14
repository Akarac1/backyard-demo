import { db } from '@/lib/supabase';
import { currentUser, json } from '@/lib/request';
import { verifySlip } from '@/lib/slip';
import { sendExtraPaidNote } from '@/lib/extraPay';
import { dbErrorToThai } from '@/lib/format';
import { serverT } from '@/lib/i18nDict';

export async function POST(req: Request, { params }: { params: Promise<{ pid: string }> }) {
  const { pid } = await params;
  const L = serverT(req);
  const uid = await currentUser(req);
  if (!uid) return json({ error: 'unauthorized' }, 401);
  if (!/^[0-9a-f-]{36}$/.test(pid)) return json({ error: 'not_found' }, 404);
  const { data: p } = await db().from('payments')
    .select('id, kind, amount, status, created_at, booking_id, bookings!inner(code, customers!inner(line_user_id))')
    .eq('id', pid).eq('bookings.customers.line_user_id', uid).neq('kind', 'booking').maybeSingle();
  if (!p) return json({ message: L('ไม่พบรายการชำระเงิน') }, 404);
  if (p.status !== 'pending') return json({ confirmed: p.status === 'verified', message: L('รายการนี้ชำระแล้ว') });

  const form = await req.formData();
  const file = form.get('slip');
  if (!(file instanceof File) || file.size === 0) return json({ message: L('กรุณาแนบรูปสลิป') }, 400);
  if (file.size > 4_000_000) return json({ message: L('รูปใหญ่เกิน 4 MB') }, 400);
  const b = new Uint8Array(await file.slice(0, 12).arrayBuffer());
  const kind = b[0] === 0xff && b[1] === 0xd8 && b[2] === 0xff ? { ext: 'jpg', type: 'image/jpeg' }
    : b[0] === 0x89 && b[1] === 0x50 && b[2] === 0x4e && b[3] === 0x47 ? { ext: 'png', type: 'image/png' }
    : b[0] === 0x52 && b[1] === 0x49 && b[2] === 0x46 && b[3] === 0x46 && b[8] === 0x57 ? { ext: 'webp', type: 'image/webp' } : null;
  if (!kind) return json({ message: L('รองรับเฉพาะรูป JPG, PNG หรือ WebP') }, 400);

  const { error: tooMany } = await db().rpc('payment_slip_attempt', { p_payment: p.id });
  if (tooMany) return json({ message: L('ส่งสลิปครบจำนวนครั้งแล้ว แอดมินจะตรวจสลิปล่าสุดให้ หรือทักแชทหาร้าน') }, 429);

  const path = `${p.booking_id}/${Date.now()}.${kind.ext}`;
  await db().storage.from('slips').upload(path, file, { contentType: kind.type });
  await db().from('payments').update({ slip_path: path }).eq('id', p.id);

  const code = (p.bookings as unknown as { code: string }).code;
  const result = await verifySlip(file, { amount: p.amount, notBefore: new Date(p.created_at), remark: `Backyard ${code}` });
  if (!result.ok) {
    const pending = result.reason === 'pending' || result.reason === 'error' || result.reason === 'review';
    return json({ confirmed: false, pending, message: L(result.key ?? result.message, result.vars) });
  }
  const { error } = await db().rpc('confirm_payment', { p_payment_id: p.id, p_verified_by: `auto:${result.provider}:${result.transRef}` });
  if (error) return json({ confirmed: false, message: dbErrorToThai(error.message, L.lang) }, 409);
  await sendExtraPaidNote(p.id).catch(() => {});
  return json({ confirmed: true, message: L('ชำระเงินสำเร็จ') });
}
