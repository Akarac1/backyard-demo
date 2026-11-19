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

// answers the admin added in Settings > LINE auto-replies; any failure (e.g. migration 0055 not run yet) means none
type Custom = { title: string; answer: string; keywords: string[]; enabled?: boolean; button_label?: string; button_url?: string };
async function customReplies(): Promise<Custom[]> {
  const { data } = await db().from('settings').select('line_replies').eq('id', 1).maybeSingle();
  const v = (data as { line_replies?: unknown } | null)?.line_replies;
  return Array.isArray(v) ? (v as Custom[]) : [];
}
const squash = (t: string) => t.toLowerCase().replace(/\s+/g, '');

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
    { type: 'text', text: subtitle, color: '#DCE7DF', size: 'xs', wrap: true },
  ],
});

const priceRow = (label: string, price: string, unit: string, note?: string) => ({
  type: 'box', layout: 'vertical', spacing: 'xs',
  contents: [
    {
      type: 'box', layout: 'horizontal', spacing: 'md', alignItems: 'center',
      contents: [
        { type: 'text', text: label, size: 'md', color: GREEN, weight: 'bold', flex: 5, wrap: true },
        {
          type: 'text', flex: 4, align: 'end', wrap: true,
          contents: [
            { type: 'span', text: price, size: 'xl', weight: 'bold', color: GREEN },
            { type: 'span', text: ` ${unit}`, size: 'xs', color: MUTED },
          ],
        },
      ],
    },
    ...(note ? [{ type: 'text', text: note, size: 'xs', color: MUTED, wrap: true }] : []),
  ],
});

const sectionTitle = (text: string) => ({ type: 'text', text, size: 'sm', weight: 'bold', color: GREEN, margin: 'sm' });

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

type Terms = { rule: ReturnType<typeof lateNightRule>; hold: number; meeting: string; discount: number; discountDays: number; discountShuttle: boolean };
/** everything the price card needs besides the three prices; any failure (e.g. migration not run) falls back to defaults */
async function terms(): Promise<Terms> {
  const { rule } = await extra();
  const { data } = await db().from('settings')
    .select('hold_minutes, pickup_meeting_point, member_discount, member_discount_min_days, member_discount_needs_shuttle').eq('id', 1).maybeSingle();
  const d = data as { hold_minutes?: number; pickup_meeting_point?: string; member_discount?: number; member_discount_min_days?: number; member_discount_needs_shuttle?: boolean } | null;
  return {
    rule, hold: d?.hold_minutes ?? 15, meeting: d?.pickup_meeting_point ?? '',
    discount: d?.member_discount ?? 0, discountDays: d?.member_discount_min_days ?? 1, discountShuttle: d?.member_discount_needs_shuttle ?? false,
  };
}

const priceFlex = (p: P, k: Contact, t: Terms): LineMessage => {
  const lateOn = t.rule.enabled && t.rule.percent < 100;
  return {
    type: 'flex',
    altText: `ราคา: ที่จอด ${p.price_per_day} บาท/วัน · รถรับส่งไป-กลับ ${p.shuttle_price} บาท/การจอง · จอดเกิน ${p.extra_price_per_day} บาท/วัน`,
    contents: {
      type: 'bubble',
      header: header('ราคาและเงื่อนไข 💰', 'Backyard Airport · The Hangar\nใกล้สนามบินสุวรรณภูมิ ขับประมาณ 15 นาที'),
      body: {
        type: 'box', layout: 'vertical', spacing: 'lg', paddingAll: '18px',
        contents: [
          priceRow('ที่จอดรถ', String(p.price_per_day), 'บาท/วัน', 'นับตามวันปฏิทิน รวมวันที่เข้าและวันที่ออก'),
          priceRow('รถรับส่งไป–กลับ', String(p.shuttle_price), 'บาท/การจอง', 'ไปสนามบินสุวรรณภูมิ นั่งได้ไม่เกิน 7 คน ต้องจองที่จอดพร้อมกัน'),
          priceRow('จอดเกินหรือเพิ่มวัน', String(p.extra_price_per_day), 'บาท/วัน', 'กรณีจอดเลยวันที่จองไว้ หรือขอเพิ่มวัน'),
          { type: 'separator', color: '#E4E9E5' },
          ...(lateOn || t.discount > 0 ? [
            sectionTitle('ส่วนลด'),
            {
              type: 'box', layout: 'vertical', spacing: 'sm',
              contents: [
                ...(lateOn ? [bullet(`🌙 ใช้รถรับ–ส่ง และเข้าลานตั้งแต่ ${t.rule.arrivalFrom} น. ค่าจอดวันเข้าคิด ${pct(t.rule.percent)}`),
                  bullet(`🌙 เครื่องลงขากลับภายใน ${t.rule.returnBy} น. ค่าจอดวันรับรถคิด ${pct(t.rule.percent)}`)] : []),
                ...(t.discount > 0 ? [bullet(`ลูกค้าเก่า หรือมีเพื่อนแนะนำ ลด ${t.discount} บาท เมื่อจองอย่างน้อย ${t.discountDays} วัน${t.discountShuttle ? ' และใช้รถรับ–ส่ง' : ''}`)] : []),
              ],
            },
            { type: 'separator', color: '#E4E9E5' },
          ] : []),
          sectionTitle('การจองและชำระเงิน 📋'),
          {
            type: 'box', layout: 'vertical', spacing: 'sm',
            contents: [
              bullet('ชำระเต็มจำนวนตอนจอง ผ่าน QR PromptPay'),
              bullet(`หลังกดยืนยัน ระบบกันที่ให้ ${t.hold} นาที ถ้าไม่ชำระภายในเวลานี้ ที่จะถูกคืนให้ลูกค้าท่านอื่น`),
              bullet('เรื่องการคืนเงิน ติดต่อแอดมินในแชทนี้ได้เลยนะคะ'),
              bullet(`เลื่อนวันได้ 1 ครั้ง แจ้งล่วงหน้าอย่างน้อย ${p.reschedule_min_days} วัน และเลื่อนภายใน 1 ปีนับจากวันจอง (ทักแอดมินในแชท)`),
            ],
          },
          ...(t.meeting ? [
            { type: 'separator', color: '#E4E9E5' },
            sectionTitle('รถรับ–ส่ง 🚐'),
            {
              type: 'box', layout: 'vertical', spacing: 'sm',
              contents: [
                bullet(`จุดนัดรับที่สนามบิน: ${t.meeting}`),
                bullet('ลงเครื่องและรับกระเป๋าเสร็จแล้ว กดเรียกรถในแชทนี้ คนขับจะไปถึงจุดนัดภายในประมาณ 15 นาที'),
              ],
            },
          ] : []),
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
  };
};

const adminFlex = (k: Contact): LineMessage => ({
  type: 'flex',
  altText: `ติดต่อแอดมิน ${k.hours} · โทร ${k.display}`,
  contents: {
    type: 'bubble',
    header: header('ติดต่อแอดมิน', `ตอบแชททุกวัน ${k.hours}`),
    body: {
      type: 'box', layout: 'vertical', spacing: 'md', paddingAll: '18px',
      contents: [
        { type: 'text', text: 'พิมพ์ข้อความทิ้งไว้ในแชทนี้ได้เลยนะคะ แอดมินจะตอบกลับโดยเร็วที่สุดค่ะ', size: 'sm', color: '#3A4A40', wrap: true },
        { type: 'text', text: 'จองที่จอดและส่งสลิปได้ตลอด 24 ชั่วโมง ไม่ต้องรอแอดมินค่ะ', size: 'sm', color: MUTED, wrap: true },
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
    // ---- answers added by the admin: checked first (top to bottom), so they can also override the built-in ones ----
    if (text) {
      const t = squash(text);
      const hit = (await customReplies()).find((c) => c.enabled !== false && Array.isArray(c.keywords) && c.keywords.some((w) => squash(String(w)).length >= 2 && t.includes(squash(String(w)))));
      if (hit) {
        const okUrl = hit.button_label && /^(https:\/\/|tel:)/.test(hit.button_url ?? '');
        return reply(e.replyToken, [infoFlex(hit.title, SHOP_NAME, hit.answer.split(/\n\s*\n/).map((x) => x.trim()).filter(Boolean),
          okUrl ? [{ label: hit.button_label as string, uri: hit.button_url as string, primary: true }] : [])]);
      }
    }
    // ---- common questions (specific ones first, the generic "จอง" last) ----
    if (/เชื่อม|ลูกค้าเก่า|เคยจอง|จองเก่า|การจองเดิม|ย้ายมา/.test(text)) {
      const x = await extra();
      return reply(e.replyToken, [infoFlex('เชื่อมการจองเก่าเข้า LINE 🔗', SHOP_NAME, [
        'ขอบคุณที่เคยไว้วางใจใช้บริการกับเรานะคะ 🙏 การจองเดิมเราบันทึกไว้ให้แล้วค่ะ แค่เชื่อมกับ LINE นี้ ก็จะดูการจองและเรียกรถรับ–ส่งได้เหมือนลูกค้าที่จองผ่าน LINE ค่ะ',
        'วิธีเชื่อม ใช้เวลาไม่นานค่ะ 👇\n1) เปิดเมนู “สมาชิก & การจอง” (หรือกดปุ่มด้านล่าง)\n2) กด “ร้านบันทึกการจองให้คุณไว้แล้ว? เชื่อมการจองที่นี่”\n3) กรอกเบอร์โทรที่เคยให้ร้านไว้ และทะเบียนรถในการจอง\n4) กด “เชื่อมการจอง”',
        ...(x.pointsOn && x.claimBonus > 0 ? [`เป็นการขอบคุณค่ะ เชื่อมสำเร็จครั้งแรกรับโบนัส ${x.claimBonus} แต้ม 🎁 (ได้ครั้งเดียวต่อคนนะคะ)`] : []),
        `ถ้าลองแล้วระบบหาการจองไม่เจอ ไม่เป็นไรค่ะ โทรบอกเราที่ ${k.display} ได้เลยนะคะ เดี๋ยวช่วยตรวจให้ค่ะ`,
      ], [{ label: 'เปิดสมาชิก & การจอง', uri: liffUrl('/my'), primary: true }, { label: `โทร ${k.display}`, uri: `tel:${k.phone}` }])]);
    }
    if (/รอกระเป๋า|รับกระเป๋า|เผื่อเวลา|เวลาเครื่องลง|เครื่องลง/.test(text)) {
      return reply(e.replyToken, [infoFlex('เรื่องเวลาที่กรอกตอนจอง ✈️', SHOP_NAME, [
        'ไม่ต้องกังวลเรื่องเวลารอกระเป๋านะ 😊 กรอกเวลาเครื่องลงตามที่ระบุในตั๋วได้เลย ไม่ต้องบวกเวลาเผื่อเอง',
        'เพราะรถจะออกไปรับตอนที่คุณกดเรียกรถในแชทนี้ค่ะ',
        'ยังมีข้อสงสัยตรงไหน พิมพ์ถามไว้ในแชทนี้ได้เลยนะคะ',
      ])]);
    }
    if (/เข้าดึก|ดึก|เช้ามืด|ตี\s*2|4\s*ทุ่ม|ลดค่าจอด/.test(text)) {
      const { rule } = await extra();
      const on = rule.enabled && rule.percent < 100;
      return reply(e.replyToken, [infoFlex('เข้าดึก / กลับเช้ามืด 🌙', SHOP_NAME, on ? [
        'ถ้าคุณมาถึงดึกหรือกลับเช้ามืด เราปรับค่าจอดให้ค่ะ เพราะใช้ลานจอดไม่เต็มวัน (สำหรับลูกค้าที่ใช้รถรับ–ส่ง)',
        `• เข้าลานตั้งแต่ ${rule.arrivalFrom} น. ค่าจอดวันที่เข้าคิด ${pct(rule.percent)}\n• เครื่องลงขากลับภายใน ${rule.returnBy} น. ค่าจอดวันที่รับรถคิด ${pct(rule.percent)}`,
        'ไม่ต้องคำนวณเอง แค่กรอกเวลาในหน้าจอง ระบบจะคิดให้อัตโนมัติค่ะ',
      ] : [
        'ตอนนี้ค่าจอดนับตามวันปฏิทิน รวมวันเข้าและวันออก ดูราคาได้โดยพิมพ์ "ราคา" นะคะ',
      ])]);
    }
    if (/เปิด(กี่โมง|กี่ชม|ทำการ|24|ตลอด|ไหม)|ปิดกี่โมง|24\s*(ชม|ชั่วโมง)|เวลาทำการ|เปิดให้บริการ/.test(text)) {
      return reply(e.replyToken, [infoFlex('เวลาเปิดให้บริการ 🕐', SHOP_NAME, [
        'ลานจอดเปิดให้บริการ 24 ชั่วโมงค่ะ ✅',
        `แอดมินตอบแชททุกวัน ${k.hours} ส่วนการจองและชำระเงิน ทำเองได้ตลอด 24 ชั่วโมง ไม่ต้องรอแอดมินค่ะ`,
      ])]);
    }
    if (/ที่อยู่|แผนที่|พิกัด|ไปยังไง|ไปอย่างไร|เดินทางมา|นำทาง/.test(text)) {
      return reply(e.replyToken, [infoFlex('ที่อยู่และแผนที่ 📍', SHOP_NAME, [ADDRESS, 'ใกล้สนามบินสุวรรณภูมิ ขับประมาณ 15 นาทีค่ะ'],
        [{ label: 'เปิดแผนที่', uri: MAP_URL, primary: true }, { label: `โทร ${k.display}`, uri: `tel:${k.phone}` }])]);
    }
    if (/รถรับ|รถส่ง|รับส่ง|รับ-ส่ง|รถตู้|shuttle/i.test(text)) {
      const p = await prices();
      return reply(e.replyToken, [infoFlex('รถรับ–ส่งสนามบิน 🚐', SHOP_NAME, [
        'เป็นบริการเสริมสำหรับคนที่ไม่อยากขับไปจอดที่สนามบินเอง เราไปส่งและไปรับกลับให้ค่ะ',
        `ค่าบริการไป–กลับ ${p.shuttle_price} บาทต่อการจอง (ไม่ได้คิดต่อคน) ไปสนามบินสุวรรณภูมิ นั่งได้ไม่เกิน 7 คนค่ะ`,
        'ต้องจองที่จอดพร้อมกัน แต่ถ้าอยากจอดอย่างเดียวโดยไม่ใช้รถรับ–ส่งก็ได้เหมือนกันค่ะ',
      ])]);
    }
    if (/จองยังไง|จองอย่างไร|วิธีจอง|ขั้นตอนจอง|จ่ายยังไง|จ่ายอย่างไร|ชำระ|โอนเงิน/.test(text)) {
      return reply(e.replyToken, [infoFlex('จองและชำระเงินยังไง 📝', SHOP_NAME, [
        'ทำเองได้ในมือถือ ตลอด 24 ชั่วโมงค่ะ ตามนี้เลย 👇',
        '1) เปิดหน้าจอง เลือกวันเข้า–ออก\n2) เลือกรถรับ–ส่งถ้าต้องการ แล้วใส่เวลา\n3) ชำระผ่าน QR PromptPay ในแอปธนาคาร\n4) ระบบส่งการ์ดยืนยันการจองให้ใน LINE ทันที',
        `ถ้าติดตรงไหน พิมพ์ถามในแชทนี้ หรือโทร ${k.display} ได้เลยนะคะ`,
      ], [{ label: `โทร ${k.display}`, uri: `tel:${k.phone}` }])]);
    }
    if (/แต้ม|สมาชิก|คะแนน/.test(text)) {
      const x = await extra();
      return reply(e.replyToken, [infoFlex('สมาชิกและแต้มสะสม ⭐', SHOP_NAME, x.pointsOn ? [
        'ทุกครั้งที่จองที่จอด คุณจะได้แต้มสะสม และนำไปแลกเป็นส่วนลดได้ค่ะ ดูแต้มของคุณได้ที่เมนู “สมาชิก & การจอง” นะคะ',
        ...(x.claimBonus > 0 ? [`ถ้าเคยจองกับเรามาก่อน เชื่อมการจองกับ LINE แล้วรับโบนัส ${x.claimBonus} แต้ม พิมพ์ "เชื่อม" เพื่อดูวิธีค่ะ`] : []),
      ] : ['สอบถามสิทธิสมาชิกกับเจ้าหน้าที่ได้ที่แชทนี้นะคะ'],
      [{ label: 'เปิดสมาชิก & การจอง', uri: liffUrl('/my'), primary: true }])]);
    }
    if (/ราคา|เงื่อนไข/.test(text)) { const [p, t] = await Promise.all([prices(), terms()]); return reply(e.replyToken, [priceFlex(p, k, t)]); }
    if (/แอดมิน|ติดต่อ|โทร/.test(text)) return reply(e.replyToken, [adminFlex(k)]);
    if (/จอง/.test(text)) return reply(e.replyToken, [bookFlex(await prices())]);
  }));
  return json({ ok: true });
}
