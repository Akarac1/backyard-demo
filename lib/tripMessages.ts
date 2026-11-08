import 'server-only';
import { db } from './supabase';
import { push } from './line';
import { bkkDay, thDate, thTime } from './format';

export type TripStep = 'en_route' | 'arrived' | 'done';

type Ctx = {
  direction: 'to_airport' | 'from_airport';
  pax: number;
  pickupAt: string | null;
  flight: string | null;
  vehicle: string | null;
  driver: string;
  code: string;
  plate: string;
  name: string;
  lineUserId: string | null;
  meetingPoint: string;
  returnPickupAt: string | null;
  returnFlight: string | null;
};

const PHONE = process.env.SHOP_PHONE ?? '0888101089';
const PHONE_DISPLAY = PHONE.replace(/^(\d{3})(\d{3})(\d{4})$/, '$1-$2-$3');
const when = (ts: string) => `${thDate(bkkDay(ts))} เวลา ${thTime(ts)} น.`;

/** Load what a customer message needs for one trip. */
export async function tripContext(tripId: string, driverName: string): Promise<Ctx | null> {
  const sb = db();
  const { data: t } = await sb.from('shuttle_trips')
    .select('id, booking_id, direction, pax, pickup_at, flight_number, vehicles(name), bookings(code, plate, customers(name, line_user_id))')
    .eq('id', tripId).maybeSingle();
  if (!t) return null;
  const b = t.bookings as unknown as { code: string; plate: string; customers: { name: string; line_user_id: string } | null } | null;
  const [{ data: ret }, { data: st }] = await Promise.all([
    sb.from('shuttle_trips').select('pickup_at, flight_number').eq('booking_id', t.booking_id).eq('direction', 'from_airport').neq('status', 'cancelled').maybeSingle(),
    sb.from('settings').select('pickup_meeting_point').eq('id', 1).single(),
  ]);
  return {
    direction: t.direction, pax: t.pax, pickupAt: t.pickup_at, flight: t.flight_number,
    vehicle: (t.vehicles as unknown as { name: string } | null)?.name ?? null, driver: driverName,
    code: b?.code ?? '', plate: b?.plate ?? '', name: b?.customers?.name ?? '', lineUserId: b?.customers?.line_user_id ?? null,
    meetingPoint: st?.pickup_meeting_point ?? 'ชั้น 2 ประตู 4',
    returnPickupAt: ret?.pickup_at ?? null, returnFlight: ret?.flight_number ?? null,
  };
}

/** The text sent to the customer when the driver changes the trip status. */
export function statusText(c: Ctx, step: TripStep): string {
  const hi = c.name ? `คุณ${c.name}` : 'ลูกค้า';
  if (c.direction === 'to_airport') {
    if (step === 'arrived')
      return `🚐 รถรับส่งพร้อมแล้วที่ลาน Backyard\n${hi} เชิญขึ้นรถได้เลย${c.vehicle ? ` (${c.vehicle})` : ''} · ${c.pax} ท่าน\nคนขับ: ${c.driver}`;
    if (step === 'en_route')
      return `🛫 ออกเดินทางไปสนามบินสุวรรณภูมิแล้ว ใช้เวลาประมาณ 15 นาที\nรถ ${c.plate} ของ${hi}จอดอยู่ที่ลานอย่างปลอดภัย`;
    const back = c.returnPickupAt
      ? `\n\n📅 วันกลับ ${when(c.returnPickupAt)}\nคนขับจะรอรับที่${c.meetingPoint}${c.returnFlight ? ` หลังเที่ยวบิน ${c.returnFlight} ลง` : ''}\nถ้าเที่ยวบินหรือเวลาเปลี่ยน แจ้งในแชทนี้ หรือโทร ${PHONE_DISPLAY}`
      : `\n\nวันกลับ แจ้งเวลาเครื่องลงในแชทนี้ หรือโทร ${PHONE_DISPLAY} คนขับจะไปรับที่${c.meetingPoint}`;
    return `✈️ ส่งถึงสนามบินสุวรรณภูมิเรียบร้อย\nขอบคุณ${hi}ที่ใช้บริการ Backyard Airport · The Hangar\nขอให้เดินทางปลอดภัย และมีความสุขกับทริปนี้${back}\n\nรหัสการจอง ${c.code}`;
  }
  if (step === 'en_route')
    return `🚐 คนขับ ${c.driver} ออกเดินทางไปรับ${hi}ที่สนามบินแล้ว\nจุดนัดรับ: ${c.meetingPoint}${c.pickupAt ? `\nนัดรับประมาณ ${thTime(c.pickupAt)} น.` : ''}`;
  if (step === 'arrived')
    return `📍 รถรับส่งถึงจุดนัดรับแล้ว: ${c.meetingPoint}${c.vehicle ? ` (${c.vehicle})` : ''}\nออกจากโถงผู้โดยสารแล้วมาที่จุดนัดได้เลย ติดต่อไม่สะดวกโทร ${PHONE_DISPLAY}`;
  return `🏠 ถึงลาน Backyard เรียบร้อย ยินดีต้อนรับกลับ\nรถ ${c.plate} พร้อมให้${hi}รับคืนแล้ว\nขอบคุณที่ใช้บริการ Backyard Airport · The Hangar หวังว่าจะได้ดูแลอีกครั้ง 🙏`;
}

export function noteText(c: Ctx, note: string): string {
  return `📢 แจ้งจากคนขับรถรับส่ง (${c.direction === 'to_airport' ? 'ขาไปสนามบิน' : 'ขากลับ'})\n${note}\n\nสอบถามเพิ่มเติม โทร ${PHONE_DISPLAY}`;
}

/** Push to the customer's LINE. Returns 'sent' | 'no_line' | 'failed'. Push messages count against the OA quota. */
export async function sendToCustomer(c: Ctx, text: string): Promise<'sent' | 'no_line' | 'failed'> {
  if (!c.lineUserId || c.lineUserId.startsWith('demo-')) return 'no_line';
  try {
    const ok = await push(c.lineUserId, [{ type: 'text', text }]);
    return ok ? 'sent' : 'failed';
  } catch (e) {
    console.error('trip message', e);
    return 'failed';
  }
}
