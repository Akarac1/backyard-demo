import { reply, verifySignature, type LineMessage } from '@/lib/line';
import { json } from '@/lib/request';
import { db } from '@/lib/supabase';
import { getContact, type Contact } from '@/lib/shop';
import { lateNightRule, DEFAULT_LATE_NIGHT } from '@/lib/freeDays';

type P = { price_per_day: number; shuttle_price: number; extra_price_per_day: number; reschedule_min_days: number };
const DEFAULT_P: P = { price_per_day: 100, shuttle_price: 300, extra_price_per_day: 120, reschedule_min_days: 7 };
async function prices(): Promise<P> {
  const { data } = await db().from('settings').select('price_per_day, shuttle_price, extra_price_per_day, reschedule_min_days').eq('id', 1).maybeSingle();
  return (data as P | null) ?? DEFAULT_P;
}

// rule for late arrival / early return and the member-points settings; any failure (e.g. migration 0054 not run yet) falls back to defaults
async function extra() {
  const { data } = await db().from('settings')
    .select('late_night_enabled, late_arrival_from, early_return_by, late_night_percent, points_enabled, claim_bonus_points').eq('id', 1).maybeSingle();
  const d = data as { points_enabled?: boolean; claim_bonus_points?: number } | null;
  return {
    rule: d ? lateNightRule(data as never) : DEFAULT_LATE_NIGHT,
    pointsOn: d?.points_enabled ?? true,
    claimBonus: Number(d?.claim_bonus_points) || 0,
  };
}

const SHOP_NAME = 'Backyard Airport · The Hangar';
const ADDRESS = '242 หมู่ 7 ถนนกิ่งแก้ว ตำบลราชาเทวะ อำเภอบางพลี สมุทรปราการ 10540';
const MAP_URL = process.env.NEXT_PUBLIC_MAP_URL ?? 'https://maps.app.goo.gl/9s7ZS7NdW4Uayuz17';

// Everything here answers with reply messages, which do not count against the LINE OA quota.
type Event = { type: string; replyToken?: string; message?: { type: string; text?: string }; source?: { userId?: string } };

const GREEN = '#0E3320';
const GOLD = '#E0B04A';
const MUTED = '#6B7A70';

const base = () => process.env.NEXT_PUBLIC_BASE_URL ?? '';
const liffUrl = (path: string) =>
  process.env.NEXT_PUBLIC_LIFF_ID ? `https://liff.line.me/${process.env.NEXT_PUBLIC_LIFF_ID}${path}` : `${base()}/liff${path}`;

const header = (title: string, subtitle: string) => ({
  type: 'box', layout: 'vertical', backgroundColor: GREEN, paddingAll: '18px', spacing: 'xs',
  contents: [
    { type: 'text', text: title, color: GOLD, weight: 'bold', size: 'xl' },
    { type: 'text', text: subtitle, color: '#DCE7DF', size: 'xs' },
  ],
});

const priceRow = (label: string, price: string, unit: string, note?: string) => ({
  type: 'box', layout: 'vertical', spacing: 'none',
  contents: [
    {
      type: 'box', layout: 'horizontal', alignItems: 'flex-end',
      contents: [
        { type: 'text', text: label, size: 'md', color: GREEN, weight: 'bold', flex: 5, wrap: true },
        { type: 'text', text: price, size: 'xl', color: GREEN, weight: 'bold', align: 'end', flex: 3 },
        { type: 'text', text: unit, size: 'xs', color: MUTED, align: 'end', flex: 3, gravity: 'bottom' },
      ],
    },
    ...(note ? [{ type: 'text', text: note, size: 'xs', color: MUTED, wrap: true }] : []),
  ],
});

const bullet = (text: string) => ({
  type: 'box', layout: 'baseline', spacing: 'sm',
  contents: [
    { type: 'text', text: '•', size: 'sm', color: GOLD, flex: 0 },
    { type: 'text', text, size: 'sm', color: '#3A4A40', wrap: true },
  ],
});

const callButton = (style: 'primary' | 'secondary', k: Contact) => ({
  type: 'button', style, height: 'sm', color: style === 'primary' ? GREEN : undefined,
  action: { type: 'uri', label: `โทร ${k.display}`, uri: `tel:${k.phone}` },
});

const priceFlex = (p: P, k: Contact): LineMessage => ({
  type: 'flex',
  altText: `ราคา: ที่จอด ${p.price_per_day} บาท/วัน · รถรับส่งไป-กลับ ${p.shuttle_price} บาท`,
  contents: {
    type: 'bubble',
    header: header('ราคาและเงื่อนไข', 'Backyard Airport · The Hangar · ใกล้สุวรรณภูมิ 15 นาที'),
    body: {
      type: 'box', layout: 'vertical', spacing: 'lg', paddingAll: '18px',
      contents: [
        priceRow('ที่จอดรถ', String(p.price_per_day), 'บาท / วัน'),
        priceRow('รถรับส่งไป-กลับ', String(p.shuttle_price), 'บาท / การจอง', 'สนามบินสุวรรณภูมิ · ไม่เกิน 7 คน · ต้องจองที่จอดด้วย'),
        priceRow('จอดเกินหรือเพิ่มวัน', String(p.extra_price_per_day), 'บาท / วัน'),
        { type: 'separator', color: '#E4E9E5' },
        { type: 'text', text: 'เงื่อนไข', size: 'sm', weight: 'bold', color: GREEN },
        {
          type: 'box', layout: 'vertical', spacing: 'xs',
          contents: [
            bullet('นับวันตามปฏิทิน รวมวันเข้าและวันออก'),
            bullet('จ่ายเต็มจำนวนตอนจองผ่าน PromptPay'),
            bullet(`ไม่คืนเงิน เลื่อนวันได้ 1 ครั้ง ล่วงหน้าอย่างน้อย ${p.reschedule_min_days} วัน ภายใน 1 ปีนับจากวันจอง`),
          ],
        },
      ],
    },
    footer: {
      type: 'box', layout: 'vertical', spacing: 'sm', paddingAll: '14px',
      contents: [
        { type: 'button', style: 'primary', color: GOLD, height: 'sm', action: { type: 'uri', label: 'จองเลย', uri: liffUrl('/book') } },
        callButton('secondary', k),
      ],
    },
  },
});

const adminFlex = (k: Contact): LineMessage => ({
  type: 'flex',
  altText: `ติดต่อแอดมิน ${k.hours} · โทร ${k.display}`,
  contents: {
    type: 'bubble',
    header: header('ติดต่อแอดมิน', `ตอบแชททุกวัน ${k.hours}`),
    body: {
      type: 'box', layout: 'vertical', spacing: 'md', paddingAll: '18px',
      contents: [
        { type: 'text', text: 'พิมพ์ข้อความทิ้งไว้ในแชทนี้ได้เลย แอดมินจะตอบกลับโดยเร็วที่สุด', size: 'sm', color: '#3A4A40', wrap: true },
        { type: 'text', text: 'จองที่จอดและส่งสลิปได้ตลอด 24 ชั่วโมง ไม่ต้องรอแอดมิน', size: 'sm', color: MUTED, wrap: true },
        {
          type: 'box', layout: 'horizontal', margin: 'md',
          contents: [
            { type: 'text', text: 'โทร', size: 'sm', color: MUTED, flex: 1 },
            { type: 'text', text: k.display, size: 'lg', weight: 'bold', color: GREEN, flex: 4 },
          ],
        },
      ],
    },
    footer: {
      type: 'box', layout: 'vertical', spacing: 'sm', paddingAll: '14px',
      contents: [
        callButton('primary', k),
        { type: 'button', style: 'secondary', height: 'sm', action: { type: 'uri', label: 'จองที่จอดรถ', uri: liffUrl('/book') } },
      ],
    },
  },
});

const bookFlex = (p: P): LineMessage => ({
  type: 'flex',
  altText: 'จองที่จอดรถ + รถรับส่งสุวรรณภูมิ',
  contents: {
    type: 'bubble', size: 'kilo',
    header: header('จองที่จอดรถ', `จอด ${p.price_per_day} บาท/วัน · รถรับส่งไป-กลับ ${p.shuttle_price} บาท`),
    footer: {
      type: 'box', layout: 'vertical', paddingAll: '14px',
      contents: [{ type: 'button', style: 'primary', color: GOLD, height: 'sm', action: { type: 'uri', label: 'จองเลย', uri: liffUrl('/book') } }],
    },
  },
});

type Btn = { label: string; uri: string; primary?: boolean };
/** small card: title, optional subtitle, lines of text, up to 2 buttons */
const infoFlex = (title: string, subtitle: string, lines: string[], buttons: Btn[] = []): LineMessage => ({
  type: 'flex',
  altText: `${title}: ${lines[0] ?? ''}`.slice(0, 380),
  contents: {
    type: 'bubble',
    header: header(title, subtitle),
    body: {
      type: 'box', layout: 'vertical', spacing: 'md', paddingAll: '18px',
      contents: lines.map((text) => ({ type: 'text', text, size: 'sm', color: '#3A4A40', wrap: true })),
    },
    ...(buttons.length ? {
      footer: {
        type: 'box', layout: 'vertical', spacing: 'sm', paddingAll: '14px',
        contents: buttons.map((b) => ({
          type: 'button', style: b.primary ? 'primary' : 'secondary', height: 'sm', color: b.primary ? GREEN : undefined,
          action: { type: 'uri', label: b.label, uri: b.uri },
        })),
      },
    } : {}),
  },
});

const pct = (n: number) => (n === 50 ? 'ครึ่งราคา' : n === 0 ? 'ฟรี' : `${n}% ของราคาปกติ`);

export async function POST(req: Request) {
  const body = await req.text();
  if (!verifySignature(body, req.headers.get('x-line-signature'))) return json({ error: 'bad signature' }, 401);
  const { events } = JSON.parse(body) as { events: Event[] };

  const k = await getContact();
  await Promise.all(events.map(async (e) => {
    if (!e.replyToken) return;
    // the welcome message on follow is set in LINE OA Manager (Greeting message), not here
    if (e.type === 'follow') return;
    const text = e.type === 'message' && e.message?.type === 'text' ? e.message.text ?? '' : '';
    // type "myid" in the chat to get your LINE user id (for ALERT_LINE_USER_IDS). Reply messages are free.
    if (/^\s*myid\s*$/i.test(text) && e.source?.userId) return reply(e.replyToken, [{ type: 'text', text: `LINE user ID ของคุณ:\n${e.source.userId}` }]);
    // ---- common questions (specific ones first, the generic "จอง" last) ----
    if (/เชื่อม|ลูกค้าเก่า|เคยจอง|จองเก่า|การจองเดิม|ย้ายมา/.test(text)) {
      const x = await extra();
      return reply(e.replyToken, [infoFlex('เชื่อมการจองเก่าเข้า LINE', SHOP_NAME, [
        'ถ้าเคยจองกับร้านมาก่อน ร้านบันทึกการจองไว้ให้แล้ว เชื่อมกับ LINE นี้เพื่อดูการจองและเรียกรถรับ–ส่งได้',
        '1) เปิดเมนู “สมาชิก & การจอง” (หรือกดปุ่มด้านล่าง)\n2) กด “ร้านบันทึกการจองให้คุณไว้แล้ว? เชื่อมการจองที่นี่”\n3) กรอกเบอร์โทรที่ให้ร้านไว้ และทะเบียนรถในการจอง\n4) กด “เชื่อมการจอง”',
        ...(x.pointsOn && x.claimBonus > 0 ? [`เชื่อมสำเร็จครั้งแรกรับโบนัส ${x.claimBonus} แต้ม (ได้ครั้งเดียวต่อคน)`] : []),
        `ถ้าระบบหาการจองไม่เจอ ติดต่อเจ้าหน้าที่ที่ ${k.display}`,
      ], [{ label: 'เปิดสมาชิก & การจอง', uri: liffUrl('/my'), primary: true }, { label: `โทร ${k.display}`, uri: `tel:${k.phone}` }])]);
    }
    if (/รอกระเป๋า|รับกระเป๋า|เผื่อเวลา|เวลาเครื่องลง|เครื่องลง/.test(text)) {
      return reply(e.replyToken, [infoFlex('เวลาที่ต้องกรอกตอนจอง', SHOP_NAME, [
        'ให้กรอกเวลาเครื่องลงตามตั๋วได้เลย ไม่ต้องเผื่อเวลารับกระเป๋า',
        'เมื่อลงเครื่องและรับกระเป๋าเรียบร้อยแล้ว ให้กดเรียกรถในแชทนี้ คนขับจะไปถึงจุดนัดภายในประมาณ 15 นาที',
      ], [{ label: 'เปิดหน้าจอง', uri: liffUrl('/book'), primary: true }])]);
    }
    if (/เข้าดึก|ดึก|เช้ามืด|ตี\s*2|4\s*ทุ่ม|ลดค่าจอด/.test(text)) {
      const { rule } = await extra();
      const on = rule.enabled && rule.percent < 100;
      return reply(e.replyToken, [infoFlex('เข้าดึก / กลับเช้ามืด', SHOP_NAME, on ? [
        `ลูกค้าที่ใช้รถรับ–ส่ง และเข้าลานตั้งแต่ ${rule.arrivalFrom} น. ค่าจอดวันเข้าคิด ${pct(rule.percent)}`,
        `ถ้าเครื่องลงขากลับภายใน ${rule.returnBy} น. ค่าจอดวันรับรถคิด ${pct(rule.percent)}`,
        'ระบบคำนวณให้ในหน้าจองอัตโนมัติจากเวลาที่คุณกรอก',
      ] : [
        'ตอนนี้ค่าจอดนับตามวันปฏิทิน รวมวันเข้าและวันออก ดูราคาโดยพิมพ์ "ราคา"',
      ], [{ label: 'เปิดหน้าจอง', uri: liffUrl('/book'), primary: true }])]);
    }
    if (/เปิด(กี่โมง|กี่ชม|ทำการ|24|ตลอด|ไหม)|ปิดกี่โมง|24\s*(ชม|ชั่วโมง)|เวลาทำการ|เปิดให้บริการ/.test(text)) {
      return reply(e.replyToken, [infoFlex('เวลาเปิดให้บริการ', SHOP_NAME, [
        'ลานจอดเปิดให้บริการ 24 ชั่วโมง',
        `แอดมินตอบแชททุกวัน ${k.hours} นอกเวลาจองและชำระเงินเองได้ตลอด 24 ชั่วโมง`,
      ], [{ label: 'เปิดหน้าจอง', uri: liffUrl('/book'), primary: true }])]);
    }
    if (/ที่อยู่|แผนที่|พิกัด|ไปยังไง|ไปอย่างไร|เดินทางมา|นำทาง/.test(text)) {
      return reply(e.replyToken, [infoFlex('ที่อยู่และแผนที่', SHOP_NAME, [ADDRESS, 'ใกล้สนามบินสุวรรณภูมิ ขับประมาณ 15 นาที'],
        [{ label: 'เปิดแผนที่', uri: MAP_URL, primary: true }, { label: `โทร ${k.display}`, uri: `tel:${k.phone}` }])]);
    }
    if (/รถรับ|รถส่ง|รับส่ง|รับ-ส่ง|รถตู้|shuttle/i.test(text)) {
      const p = await prices();
      return reply(e.replyToken, [infoFlex('รถรับ–ส่งสนามบิน', SHOP_NAME, [
        `เป็นบริการเสริม ไป–กลับ ${p.shuttle_price} บาทต่อการจอง ไปสนามบินสุวรรณภูมิ ไม่เกิน 7 คน`,
        'ต้องจองที่จอดพร้อมกัน เลือกได้ในหน้าจอง หรือจะจอดอย่างเดียวก็ได้',
      ], [{ label: 'จองเลย', uri: liffUrl('/book'), primary: true }])]);
    }
    if (/จองยังไง|จองอย่างไร|วิธีจอง|ขั้นตอนจอง|จ่ายยังไง|จ่ายอย่างไร|ชำระ|โอนเงิน/.test(text)) {
      return reply(e.replyToken, [infoFlex('วิธีจองและชำระเงิน', SHOP_NAME, [
        '1) เปิดหน้าจอง เลือกวันเข้า–ออก\n2) เลือกรถรับ–ส่งถ้าต้องการ แล้วใส่เวลา\n3) ชำระผ่าน QR PromptPay ในแอปธนาคาร\n4) ระบบส่งการ์ดยืนยันการจองให้ใน LINE ทันที',
        'จองและชำระเงินได้ตลอด 24 ชั่วโมง',
      ], [{ label: 'เปิดหน้าจอง', uri: liffUrl('/book'), primary: true }])]);
    }
    if (/แต้ม|สมาชิก|คะแนน/.test(text)) {
      const x = await extra();
      return reply(e.replyToken, [infoFlex('สมาชิกและแต้มสะสม', SHOP_NAME, x.pointsOn ? [
        'ยิ่งจอด ยิ่งคุ้ม สะสมแต้มจากการจอง แลกเป็นส่วนลดได้ ดูแต้มและสิทธิพิเศษที่เมนู “สมาชิก & การจอง”',
        ...(x.claimBonus > 0 ? [`ลูกค้าเก่าที่เชื่อมการจองกับ LINE รับโบนัส ${x.claimBonus} แต้ม พิมพ์ "เชื่อม" เพื่อดูวิธี`] : []),
      ] : ['สอบถามสิทธิสมาชิกกับเจ้าหน้าที่ได้ที่แชทนี้'],
      [{ label: 'เปิดสมาชิก & การจอง', uri: liffUrl('/my'), primary: true }])]);
    }
    if (/ราคา|เงื่อนไข/.test(text)) return reply(e.replyToken, [priceFlex(await prices(), k)]);
    if (/แอดมิน|ติดต่อ|โทร/.test(text)) return reply(e.replyToken, [adminFlex(k)]);
    if (/จอง/.test(text)) return reply(e.replyToken, [bookFlex(await prices())]);
  }));
  return json({ ok: true });
}
