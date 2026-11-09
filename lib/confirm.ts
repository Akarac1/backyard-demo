import 'server-only';
import { db } from './supabase';
import { confirmationFlex, push } from './line';
import { thDate, thTime, bkkDay } from './format';

/** Who hears about shuttle trips with no van: SHUTTLE_ALERT_LINE_IDS, else the system alert list (user or group ids). */
const alertIds = () => (process.env.SHUTTLE_ALERT_LINE_IDS || process.env.ALERT_LINE_USER_IDS || '')
  .split(',').map((s) => s.trim()).filter(Boolean);

/** The customer changed the bags of a trip and the vehicle no longer works out: tell staff now. */
export async function alertBags(tripId: string, r: { vehicle: string | null; no_vehicle: boolean; too_big: boolean; late: boolean }) {
  const to = alertIds();
  if (!to.length) return;
  const { data } = await db().from('shuttle_trips')
    .select('direction, pax, large_bags, small_bags, pickup_at, called_at, bookings(code, plate, customers(name, phone))').eq('id', tripId).single();
  const t = data as unknown as { direction: string; pax: number; large_bags: number; small_bags: number; pickup_at: string | null; called_at: string | null; bookings: { code: string; plate: string; customers: { name: string; phone: string } | null } | null } | null;
  if (!t) return;
  const why = r.late ? `รถที่ออกไปแล้ว (${r.vehicle ?? '-'}) ใส่กระเป๋าไม่พอ` : r.too_big ? 'รถประจำคันไหนก็ใส่ไม่พอ ต้องใช้รถสำรองหรือ 2 คัน' : 'ไม่มีรถประจำว่างที่ใส่พอ';
  const text = [`🧳 ลูกค้าแจ้งกระเป๋าเพิ่ม: ${t.bookings?.code ?? ''}`,
    `${t.direction === 'to_airport' ? 'ขาไป' : 'ขากลับ'} ${t.pickup_at ? `${thDate(bkkDay(t.pickup_at))} ${thTime(t.pickup_at)}` : ''} · ${t.pax} คน · กระเป๋าใหญ่ ${t.large_bags}${t.called_at ? ' · เรียกรถแล้ว' : ''}`,
    `⚠️ ${why}`, `ลูกค้า ${t.bookings?.customers?.name ?? '-'} ${t.bookings?.customers?.phone ?? ''}`,
    'จัดรถที่หน้า "รถรับส่ง" ในหลังบ้าน (ใช้รถสำรองฉุกเฉินได้)'].join('\n');
  await Promise.all(to.map((id) => push(id, [{ type: 'text', text }]).catch((e) => console.error('alertBags', String(e)))));
}

/** (2) tell staff right away about trips that got no van, so they can sort it out before the day. */
export async function alertNoVan(bookingId: string) {
  const to = alertIds();
  if (!to.length) return;
  const { data } = await db().from('shuttle_trips')
    .select('direction, pax, large_bags, small_bags, pickup_at, bookings(code, plate, customers(name, phone))')
    .eq('booking_id', bookingId).is('vehicle_id', null).not('status', 'in', '(cancelled,done)');
  const rows = (data ?? []) as unknown as { direction: string; pax: number; large_bags: number; small_bags: number; pickup_at: string | null; bookings: { code: string; plate: string; customers: { name: string; phone: string } | null } | null }[];
  if (!rows.length) return;
  const b = rows[0].bookings;
  const lines = rows.map((t) => `• ${t.direction === 'to_airport' ? 'ขาไป (ลาน → สนามบิน)' : 'ขากลับ (สนามบิน → ลาน)'} ${t.pickup_at ? `${thDate(bkkDay(t.pickup_at))} ${thTime(t.pickup_at)}` : ''} · ${t.pax} คน${t.large_bags ? ` · กระเป๋าใหญ่ ${t.large_bags}` : ''}`);
  const text = [`🚐 รถรับส่งไม่พอ: ${b?.code ?? ''}`, ...lines, `ลูกค้า ${b?.customers?.name ?? '-'} ${b?.customers?.phone ?? ''} · ${b?.plate ?? ''}`,
    'จัดรถเอง (ใช้รถสำรองฉุกเฉินได้) หรือเลื่อนเวลาที่หน้า "รถรับส่ง" ในหลังบ้าน · ถ้ามีเที่ยวอื่นยกเลิก ระบบจะลองจัดให้อัตโนมัติ'].join('\n');
  await Promise.all(to.map((id) => push(id, [{ type: 'text', text }]).catch((e) => console.error('alertNoVan', String(e)))));
}

/** After a booking is confirmed: assign shuttle vehicles and send the confirmation to the customer. */
export async function afterConfirmed(bookingId: string) {
  const { data: trips } = await db().from('shuttle_trips').select('id, pickup_at').eq('booking_id', bookingId);
  for (const t of trips ?? []) {
    if (t.pickup_at) {
      const { error } = await db().rpc('assign_vehicle', { p_trip_id: t.id });
      if (error) console.error('assign_vehicle', error.message);
    }
  }
  await alertNoVan(bookingId).catch((e) => console.error('alertNoVan', String(e)));

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
