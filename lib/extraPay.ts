import 'server-only';
import { db } from './supabase';
import { push, type LineMessage } from './line';

const liff = (path: string) =>
  process.env.NEXT_PUBLIC_LIFF_ID ? `https://liff.line.me/${process.env.NEXT_PUBLIC_LIFF_ID}${path}` : `${(process.env.NEXT_PUBLIC_BASE_URL ?? '').replace(/\/$/, '')}/liff${path}`;

/** Where the customer pays one extra payment (extra parking days etc.). */
export const extraPayUrl = (paymentId: string) => liff(`/pay-extra/${paymentId}`);

const fmtDay = (d: string) => new Date(`${d}T00:00:00+07:00`).toLocaleDateString('th-TH', { day: 'numeric', month: 'short', year: 'numeric', timeZone: 'Asia/Bangkok' });

/** Send the customer a card with the amount and a button to the QR page. false = nothing sent (no LINE, or not pending). */
export async function sendExtraPayCard(paymentId: string): Promise<boolean> {
  const { data: p } = await db().from('payments').select('id, kind, amount, status, booking_id').eq('id', paymentId).maybeSingle();
  if (!p || p.status !== 'pending') return false;
  const { data: b } = await db().from('bookings').select('code, plate, end_date, customers(line_user_id)').eq('id', p.booking_id).maybeSingle();
  const uid = (b?.customers as unknown as { line_user_id: string | null } | null)?.line_user_id;
  if (!b || !uid || uid.startsWith('demo-')) return false;
  const title = p.kind === 'overstay' ? 'ค่าจอดเพิ่ม' : 'ยอดที่ต้องชำระเพิ่ม';
  const row = (k: string, v: string) => ({
    type: 'box', layout: 'horizontal',
    contents: [
      { type: 'text', text: k, size: 'sm', color: '#8A94A6', flex: 2 },
      { type: 'text', text: v, size: 'sm', color: '#0E3320', flex: 4, wrap: true },
    ],
  });
  const msg: LineMessage = {
    type: 'flex', altText: `${title} ${p.amount.toLocaleString('th-TH')} บาท · ${b.code}`,
    contents: {
      type: 'bubble',
      header: { type: 'box', layout: 'vertical', backgroundColor: '#0E3320', paddingAll: '16px', contents: [
        { type: 'text', text: title, color: '#E0B04A', weight: 'bold', size: 'xl' },
        { type: 'text', text: `รหัสการจอง ${b.code}`, color: '#F5F7FA', size: 'sm' },
      ] },
      body: { type: 'box', layout: 'vertical', spacing: 'sm', contents: [
        row('ทะเบียน', b.plate),
        row('รับรถออกวันที่', fmtDay(b.end_date)),
        row('ยอดชำระ', `${p.amount.toLocaleString('th-TH')} บาท`),
      ] },
      footer: { type: 'box', layout: 'vertical', contents: [{
        type: 'button', style: 'primary', color: '#E0B04A',
        action: { type: 'uri', label: 'สแกนจ่าย / ส่งสลิป', uri: extraPayUrl(p.id) },
      }] },
    },
  };
  return (await push(uid, [msg])) !== false;
}

/** Short thank-you after an extra payment was recorded. */
export async function sendExtraPaidNote(paymentId: string): Promise<void> {
  const { data: p } = await db().from('payments').select('amount, booking_id').eq('id', paymentId).maybeSingle();
  if (!p) return;
  const { data: b } = await db().from('bookings').select('code, customers(line_user_id)').eq('id', p.booking_id).maybeSingle();
  const uid = (b?.customers as unknown as { line_user_id: string | null } | null)?.line_user_id;
  if (!b || !uid || uid.startsWith('demo-')) return;
  await push(uid, [{ type: 'text', text: `ได้รับชำระ ${p.amount.toLocaleString('th-TH')} บาท สำหรับการจอง ${b.code} แล้ว ขอบคุณครับ` }]);
}
