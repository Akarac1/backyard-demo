import { reply, verifySignature, type LineMessage } from '@/lib/line';
import { json } from '@/lib/request';

// Everything here answers with reply messages, which do not count against the LINE OA quota.
type Event = { type: string; replyToken?: string; message?: { type: string; text?: string } };

const base = () => process.env.NEXT_PUBLIC_BASE_URL ?? '';
const liffUrl = (path: string) =>
  process.env.NEXT_PUBLIC_LIFF_ID ? `https://liff.line.me/${process.env.NEXT_PUBLIC_LIFF_ID}${path}` : `${base()}/liff${path}`;

const bookButton: LineMessage = {
  type: 'template', altText: 'จองที่จอดรถ',
  template: { type: 'buttons', text: 'จองที่จอดรถ + รถรับส่งสุวรรณภูมิ', actions: [{ type: 'uri', label: 'จองเลย', uri: liffUrl('/book') }] },
};

const PRICES =
  'ราคาและเงื่อนไข\n' +
  '• ที่จอด วันละ 100 บาท (นับตามปฏิทิน รวมวันเข้าและวันออก)\n' +
  '• รถรับส่งไป-กลับสุวรรณภูมิ 300 บาทต่อการจอง (ไม่เกิน 7 คน)\n' +
  '• จอดเกินหรือเพิ่มวัน วันละ 120 บาท\n' +
  '• จ่ายเต็มตอนจอง ไม่คืนเงิน เลื่อนวันได้ 1 ครั้ง (ล่วงหน้า 7 วัน ภายใน 1 ปีนับจากวันจอง)';

export async function POST(req: Request) {
  const body = await req.text();
  if (!verifySignature(body, req.headers.get('x-line-signature'))) return json({ error: 'bad signature' }, 401);
  const { events } = JSON.parse(body) as { events: Event[] };

  await Promise.all(events.map(async (e) => {
    if (!e.replyToken) return;
    if (e.type === 'follow') {
      return reply(e.replyToken, [
        { type: 'image', originalContentUrl: `${base()}/welcome.png`, previewImageUrl: `${base()}/welcome.png` },
        { type: 'text', text: 'ยินดีต้อนรับสู่ Backyard Airport 🙏 จองที่จอดและรถรับส่งได้ตลอด 24 ชั่วโมงจากเมนูด้านล่าง คุยกับแอดมินได้ 08:00–20:00' },
      ]);
    }
    const text = e.type === 'message' && e.message?.type === 'text' ? e.message.text ?? '' : '';
    if (/ราคา|เงื่อนไข/.test(text)) return reply(e.replyToken, [{ type: 'text', text: PRICES }]);
    if (/จอง/.test(text)) return reply(e.replyToken, [bookButton]);
    if (/แอดมิน/.test(text)) {
      return reply(e.replyToken, [{ type: 'text', text: 'พิมพ์ข้อความทิ้งไว้ได้เลย แอดมินตอบ 08:00–20:00 ทุกวัน ถ้าเร่งด่วนโทร [เบอร์โทรร้าน]' }]);
    }
  }));
  return json({ ok: true });
}
