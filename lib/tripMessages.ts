import 'server-only';
import { db } from './supabase';
import { push, type LineMessage } from './line';
import { bkkDay, thDate, thTime } from './format';

export type TripStep = 'en_route' | 'arrived' | 'done';

type Ctx = {
  direction: 'to_airport' | 'from_airport';
  pax: number;
  pickupAt: string | null;
  flight: string | null;
  driver: string;
  driverPhone: string | null;
  /** the shuttle: 'Toyota Commuter สีขาว · ฮห 1234' (empty when unknown) */
  van: string;
  code: string;
  plate: string;
  name: string;
  lineUserId: string | null;
  meetingPoint: string;
  returnPickupAt: string | null;
  returnFlight: string | null;
  tripId: string;
  calledAt: string | null;
  shopPhone: string;
};

const GREEN = '#0E3320';
const GOLD = '#E0B04A';
const MUTED = '#6B7A70';
const SOFT = '#FFF6E0';
const fmtPhone = (p: string) => p.replace(/^(\d{3})(\d{3})(\d{4})$/, '$1-$2-$3');
const liff = (path: string) => (process.env.NEXT_PUBLIC_LIFF_ID ? `https://liff.line.me/${process.env.NEXT_PUBLIC_LIFF_ID}${path}` : `${process.env.NEXT_PUBLIC_BASE_URL ?? ''}/liff${path}`);
const dayTime = (ts: string) => `${thDate(bkkDay(ts))} · ${thTime(ts)} น.`;

/** Load what a customer message needs. driverId = the staff member pressing the button. */
export async function tripContext(tripId: string, driverId: string, driverName: string): Promise<Ctx | null> {
  const sb = db();
  const { data: t } = await sb.from('shuttle_trips')
    .select('id, booking_id, direction, pax, pickup_at, flight_number, called_at, vehicle_id, bookings(code, plate, customers(name, line_user_id))')
    .eq('id', tripId).maybeSingle();
  if (!t) return null;
  const b = t.bookings as unknown as { code: string; plate: string; customers: { name: string; line_user_id: string } | null } | null;
  const [{ data: ret }, { data: st }, { data: me }] = await Promise.all([
    sb.from('shuttle_trips').select('pickup_at, flight_number').eq('booking_id', t.booking_id).eq('direction', 'from_airport').neq('status', 'cancelled').maybeSingle(),
    sb.from('settings').select('pickup_meeting_point, shop_phone').eq('id', 1).single(),
    driverId ? sb.from('staff_users').select('phone, vehicle_id').eq('id', driverId).maybeSingle() : Promise.resolve({ data: null }),
  ]);
  // the trip's vehicle, or the one the driver pressing the button drives
  const vehicleId = (t.vehicle_id as string | null) ?? (me as { vehicle_id?: string | null } | null)?.vehicle_id ?? null;
  const { data: v } = vehicleId
    ? await sb.from('vehicles').select('plate, model').eq('id', vehicleId).maybeSingle()
    : { data: null };
  const van = [v?.model, v?.plate].filter(Boolean).join(' · ');
  return {
    van,
    direction: t.direction, pax: t.pax, pickupAt: t.pickup_at, flight: t.flight_number,
    driver: driverName.replace(/\s*\(.*\)$/, ''), driverPhone: me?.phone ?? null,
    code: b?.code ?? '', plate: b?.plate ?? '', name: b?.customers?.name ?? '', lineUserId: b?.customers?.line_user_id ?? null,
    meetingPoint: st?.pickup_meeting_point ?? 'ชั้น 2 ประตู 4',
    returnPickupAt: ret?.pickup_at ?? null, returnFlight: ret?.flight_number ?? null,
    tripId: t.id, calledAt: t.called_at ?? null,
    shopPhone: (st?.shop_phone || process.env.SHOP_PHONE || '0888101089').replace(/\D/g, ''),
  };
}

// ---------------------------------------------------------------------
// Flex card building blocks (brand: green + gold)
// ---------------------------------------------------------------------
type Row = [string, string];
type Button = { label: string; uri: string; primary?: boolean };

function row([label, value]: Row) {
  return {
    type: 'box', layout: 'baseline', spacing: 'md',
    contents: [
      { type: 'text', text: label, size: 'sm', color: MUTED, flex: 3 },
      { type: 'text', text: value, size: 'sm', color: GREEN, weight: 'bold', flex: 6, wrap: true },
    ],
  };
}

function card(o: {
  alt: string; icon: string; title: string; subtitle: string; rows?: Row[];
  highlight?: { title: string; lines: string[] }; message?: string; buttons?: Button[];
  /** 1–5 stars that open the rating page: who is being rated and the trip */
  rate?: { tripId: string; driver: string };
}): LineMessage {
  const body: unknown[] = [];
  if (o.message) body.push({ type: 'text', text: o.message, size: 'sm', color: GREEN, wrap: true });
  if (o.rows?.length) body.push({ type: 'box', layout: 'vertical', spacing: 'sm', contents: o.rows.map(row) });
  if (o.highlight) {
    body.push({
      type: 'box', layout: 'vertical', spacing: 'xs', backgroundColor: SOFT, cornerRadius: '12px', paddingAll: '14px',
      contents: [
        { type: 'text', text: o.highlight.title, size: 'sm', weight: 'bold', color: '#7A5200' },
        ...o.highlight.lines.map((l, i) => ({ type: 'text', text: l, size: i === 0 ? 'md' : 'sm', weight: i === 0 ? 'bold' : 'regular', color: GREEN, wrap: true })),
      ],
    });
  }
  if (o.rate) {
    const url = (n: number) => liff(`/rate/${o.rate!.tripId}?s=${n}`);
    body.push({
      type: 'box', layout: 'vertical', spacing: 'sm', paddingTop: '4px',
      contents: [
        { type: 'separator', color: '#E3E9E5' },
        { type: 'text', text: o.rate.driver ? `ให้คะแนนคนขับ ${o.rate.driver}` : 'ให้คะแนนการเดินทางครั้งนี้', size: 'sm', weight: 'bold', color: GREEN, align: 'center', margin: 'lg', wrap: true },
        {
          type: 'box', layout: 'horizontal', spacing: 'none', margin: 'sm', justifyContent: 'center',
          contents: [1, 2, 3, 4, 5].map((n) => ({
            type: 'text', text: '★', size: '3xl', color: GOLD, align: 'center', flex: 0,
            action: { type: 'uri', label: `${n} ดาว`, uri: url(n) },
          })),
        },
        { type: 'text', text: 'แตะดาวเพื่อให้คะแนนและติชม (ไม่บังคับ)', size: 'xxs', color: MUTED, align: 'center', wrap: true },
      ],
    });
  }
  return {
    type: 'flex', altText: o.alt,
    contents: {
      type: 'bubble', size: 'mega',
      header: {
        type: 'box', layout: 'vertical', backgroundColor: GREEN, paddingAll: '18px', spacing: 'xs',
        contents: [
          { type: 'text', text: 'BACKYARD AIRPORT · THE HANGAR', size: 'xxs', color: GOLD, weight: 'bold' },
          {
            type: 'box', layout: 'horizontal', spacing: 'md', margin: 'md', alignItems: 'center',
            contents: [
              { type: 'text', text: o.icon, size: 'xxl', flex: 0 },
              {
                type: 'box', layout: 'vertical', flex: 1,
                contents: [
                  { type: 'text', text: o.title, size: 'lg', weight: 'bold', color: '#FFFFFF', wrap: true },
                  { type: 'text', text: o.subtitle, size: 'xs', color: '#BFD3C4', wrap: true },
                ],
              },
            ],
          },
        ],
      },
      body: { type: 'box', layout: 'vertical', spacing: 'lg', paddingAll: '18px', contents: body.length ? body : [{ type: 'filler' }] },
      ...(o.buttons?.length ? {
        footer: {
          type: 'box', layout: 'vertical', spacing: 'sm', paddingAll: '14px',
          contents: o.buttons.map((b) => ({
            type: 'button', height: 'sm', style: b.primary ? 'primary' : 'secondary', color: b.primary ? GOLD : '#EEF2EF',
            action: { type: 'uri', label: b.label, uri: b.uri },
          })),
        },
      } : {}),
    },
  };
}

function callButtons(c: Ctx, primaryDriver: boolean): Button[] {
  const out: Button[] = [];
  if (c.driverPhone) out.push({ label: `โทรหาคนขับ ${fmtPhone(c.driverPhone)}`, uri: `tel:${c.driverPhone}`, primary: primaryDriver });
  out.push({ label: `โทรหาร้าน ${fmtPhone(c.shopPhone)}`, uri: `tel:${c.shopPhone}`, primary: primaryDriver && !c.driverPhone });
  return out;
}

/** driver name, then the van (model · plate) when known */
const driverRows = (c: Ctx): Row[] => [['คนขับ', c.driver], ...(c.van ? [['รถรับส่ง', c.van] as Row] : [])];

/** The card sent to the customer when the driver changes the trip status. */
export function statusMessage(c: Ctx, step: TripStep): LineMessage {
  // "คุณสมชาย" but "คุณ Akarachai"
  const who = c.name ? `คุณ${/^[A-Za-z]/.test(c.name) ? ' ' : ''}${c.name}` : 'คุณลูกค้า';
  if (c.direction === 'to_airport') {
    if (step === 'arrived') return card({
      alt: 'รถรับส่งพร้อมแล้วที่ลาน Backyard', icon: '🚐', title: 'รถรับส่งพร้อมแล้ว', subtitle: 'เชิญขึ้นรถที่ลาน Backyard ได้เลย',
      rows: [['ผู้โดยสาร', `${c.pax} ท่าน`], ...driverRows(c), ['รหัสการจอง', c.code]],
      buttons: callButtons(c, true),
    });
    if (step === 'en_route') return card({
      alt: 'กำลังเดินทางไปสนามบินสุวรรณภูมิ', icon: '🛫', title: 'กำลังไปสนามบิน', subtitle: 'ถึงสุวรรณภูมิในประมาณ 15 นาที',
      rows: [['รถของคุณ', `${c.plate} · จอดปลอดภัยที่ลาน`], ...driverRows(c)],
    });
    return card({
      alt: `ถึงสนามบินแล้ว ขอให้เดินทางปลอดภัย${c.returnPickupAt ? ` · วันกลับ ${dayTime(c.returnPickupAt)}` : ''}`,
      icon: '✈️', title: 'ถึงสนามบินเรียบร้อย', subtitle: 'ขอบคุณที่ใช้บริการ ขอให้เดินทางปลอดภัย',
      message: `${who} ขอให้มีความสุขกับการเดินทางครั้งนี้ เราจะดูแลรถ ${c.plate} ให้อย่างดีจนกว่าจะกลับมา`,
      highlight: c.returnPickupAt
        ? { title: 'นัดรับวันกลับ', lines: [dayTime(c.returnPickupAt), `จุดนัดรับ: ${c.meetingPoint}`, ...(c.returnFlight ? [`หลังเที่ยวบิน ${c.returnFlight} ลง`] : []), 'เที่ยวบินเปลี่ยน แจ้งในแชทนี้ได้เลย'] }
        : { title: 'วันกลับ', lines: ['แจ้งเวลาเครื่องลงในแชทนี้', `คนขับจะไปรับที่${c.meetingPoint}`] },
      buttons: [{ label: 'สมาชิก & การจอง', uri: liff('/my'), primary: true }, { label: `โทรหาร้าน ${fmtPhone(c.shopPhone)}`, uri: `tel:${c.shopPhone}` }],
      rate: { tripId: c.tripId, driver: c.driver },
    });
  }
  if (step === 'en_route' && c.calledAt) {
    const eta = new Date(Date.now() + 15 * 60_000).toISOString();
    return card({
      alt: `คนขับรับทราบแล้ว กำลังไปจุดนัดรับ จะถึงประมาณ ${thTime(eta)} น.`, icon: '🚐', title: 'คนขับรับทราบแล้ว', subtitle: 'กำลังไปจุดนัดรับ ถึงในประมาณ 15 นาที',
      rows: [['ถึงประมาณ', `${thTime(eta)} น.`], ['จุดนัดรับ', c.meetingPoint], ...driverRows(c)],
      message: 'รอที่จุดนัดได้เลย คนขับจะส่งข้อความอีกครั้งเมื่อรถถึง',
      buttons: callButtons(c, false),
    });
  }
  if (step === 'en_route') return card({
    alt: `คนขับออกไปรับที่สนามบินแล้ว · จุดนัด ${c.meetingPoint}`, icon: '🚐', title: 'คนขับออกไปรับแล้ว', subtitle: `${c.driver} กำลังเดินทางไปสุวรรณภูมิ`,
    rows: [['จุดนัดรับ', c.meetingPoint], ...(c.pickupAt ? [['เวลานัด', `${thTime(c.pickupAt)} น.`] as Row] : []), ...driverRows(c)],
    buttons: callButtons(c, false),
  });
  if (step === 'arrived') return card({
    alt: `รถถึงจุดนัดรับแล้ว · ${c.meetingPoint}`, icon: '📍', title: 'รถถึงจุดนัดรับแล้ว', subtitle: 'ออกจากโถงผู้โดยสารแล้วมาที่จุดนัดได้เลย',
    rows: [['จุดนัดรับ', c.meetingPoint], ['ผู้โดยสาร', `${c.pax} ท่าน`], ...driverRows(c)],
    buttons: callButtons(c, true),
  });
  return card({
    alt: 'ถึงลาน Backyard แล้ว รถของคุณพร้อมรับคืน', icon: '🏠', title: 'ยินดีต้อนรับกลับ', subtitle: 'ถึงลาน Backyard แล้ว รถของคุณพร้อมรับคืน',
    rows: [['รถของคุณ', c.plate], ['รหัสการจอง', c.code]],
    message: `ขอบคุณ${who} ที่ไว้วางใจ Backyard Airport · The Hangar หวังว่าจะได้ดูแลอีกในทริปหน้า`,
    buttons: [{ label: 'จองครั้งต่อไป', uri: liff('/book'), primary: true }],
    rate: { tripId: c.tripId, driver: c.driver },
  });
}

/** "Welcome to Suvarnabhumi": sent at the landing time, with the button that calls the van. */
export function welcomeMessage(c: Ctx): LineMessage {
  const who = c.name ? `คุณ${/^[A-Za-z]/.test(c.name) ? ' ' : ''}${c.name}` : 'คุณลูกค้า';
  return card({
    alt: 'ยินดีต้อนรับสู่สุวรรณภูมิ · ได้กระเป๋าแล้วกดเรียกรถมารับได้เลย', icon: '🛬', title: 'ยินดีต้อนรับสู่สุวรรณภูมิ', subtitle: `ยินดีต้อนรับกลับบ้าน ${who}`,
    message: 'เมื่อรับกระเป๋าเรียบร้อยและพร้อมออกจากโถงผู้โดยสาร กดปุ่ม “เรียกรถมารับ” ด้านล่าง คนขับจะไปถึงจุดนัดภายในประมาณ 15 นาที',
    rows: [['จุดนัดรับ', c.meetingPoint], ['ผู้โดยสาร', `${c.pax} ท่าน`], ...(c.flight ? [['เที่ยวบิน', c.flight] as Row] : [])],
    highlight: { title: 'ยังรอกระเป๋าอยู่?', lines: ['ไม่ต้องรีบ กดเรียกรถเมื่อพร้อมออกจากโถงได้เลย', 'เที่ยวบินล่าช้า ไม่ต้องแจ้ง ระบบรอให้คุณกด'] },
    buttons: [{ label: 'เรียกรถมารับ', uri: liff(`/call/${c.tripId}`), primary: true }, { label: `โทรหาร้าน ${fmtPhone(c.shopPhone)}`, uri: `tel:${c.shopPhone}` }],
  });
}

export function noteMessage(c: Ctx, note: string): LineMessage {
  return card({
    alt: `แจ้งจากคนขับ: ${note}`, icon: '📢', title: 'แจ้งจากคนขับ', subtitle: c.direction === 'to_airport' ? 'รถรับส่งขาไปสนามบิน' : 'รถรับส่งขากลับ',
    message: note, rows: driverRows(c), buttons: callButtons(c, true),
  });
}

/** Push to the customer's LINE. Returns 'sent' | 'no_line' | 'failed'. Push messages count against the OA quota. */
export async function sendToCustomer(c: Ctx, message: LineMessage): Promise<'sent' | 'no_line' | 'failed'> {
  if (!c.lineUserId || c.lineUserId.startsWith('demo-')) return 'no_line';
  try {
    const ok = await push(c.lineUserId, [message]);
    return ok ? 'sent' : 'failed';
  } catch (e) {
    console.error('trip message', e);
    return 'failed';
  }
}
