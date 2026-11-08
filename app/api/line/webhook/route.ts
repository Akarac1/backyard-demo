import { reply, verifySignature, type LineMessage } from '@/lib/line';
import { json } from '@/lib/request';
import { db } from '@/lib/supabase';
import { getContact, type Contact } from '@/lib/shop';

type P = { price_per_day: number; shuttle_price: number; extra_price_per_day: number; reschedule_min_days: number };
const DEFAULT_P: P = { price_per_day: 100, shuttle_price: 300, extra_price_per_day: 120, reschedule_min_days: 7 };
async function prices(): Promise<P> {
  const { data } = await db().from('settings').select('price_per_day, shuttle_price, extra_price_per_day, reschedule_min_days').eq('id', 1).maybeSingle();
  return (data as P | null) ?? DEFAULT_P;
}

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

export async function POST(req: Request) {
  const body = await req.text();
  if (!verifySignature(body, req.headers.get('x-line-signature'))) return json({ error: 'bad signature' }, 401);
  const { events } = JSON.parse(body) as { events: Event[] };

  const k = await getContact();
  await Promise.all(events.map(async (e) => {
    if (!e.replyToken) return;
    if (e.type === 'follow') {
      return reply(e.replyToken, [
        { type: 'image', originalContentUrl: `${base()}/welcome.png`, previewImageUrl: `${base()}/welcome.png` },
        { type: 'text', text: `ยินดีต้อนรับสู่ Backyard Airport · The Hangar\nจองที่จอดและรถรับส่งได้ตลอด 24 ชั่วโมงจากเมนูด้านล่าง\nคุยกับแอดมิน ${k.hours} · โทร ${k.display}` },
      ]);
    }
    const text = e.type === 'message' && e.message?.type === 'text' ? e.message.text ?? '' : '';
    // type "myid" in the chat to get your LINE user id (for ALERT_LINE_USER_IDS). Reply messages are free.
    if (/^\s*myid\s*$/i.test(text) && e.source?.userId) return reply(e.replyToken, [{ type: 'text', text: `LINE user ID ของคุณ:\n${e.source.userId}` }]);
    if (/ราคา|เงื่อนไข/.test(text)) return reply(e.replyToken, [priceFlex(await prices(), k)]);
    if (/แอดมิน|ติดต่อ|โทร/.test(text)) return reply(e.replyToken, [adminFlex(k)]);
    if (/จอง/.test(text)) return reply(e.replyToken, [bookFlex(await prices())]);
  }));
  return json({ ok: true });
}
