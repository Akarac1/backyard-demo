import 'server-only';
import crypto from 'node:crypto';

const API = 'https://api.line.me/v2/bot';

function token() {
  const t = process.env.LINE_CHANNEL_ACCESS_TOKEN;
  if (!t) throw new Error('LINE_CHANNEL_ACCESS_TOKEN not set');
  return t;
}

export type LineMessage = Record<string, unknown>;

async function call(path: string, body: unknown) {
  const res = await fetch(`${API}${path}`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${token()}`, 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
  if (!res.ok) console.error('LINE API', path, res.status, await res.text());
  return res.ok;
}

/** Reply messages are free (do not count against the OA quota). Use them whenever there is a replyToken. */
export const reply = (replyToken: string, messages: LineMessage[]) =>
  call('/message/reply', { replyToken, messages });

/** Push messages count against the monthly quota. */
export const push = (to: string, messages: LineMessage[]) => {
  if (!process.env.LINE_CHANNEL_ACCESS_TOKEN || to.startsWith('demo-')) return Promise.resolve(false);
  return call('/message/push', { to, messages });
};

export function verifySignature(body: string, signature: string | null): boolean {
  const secret = process.env.LINE_CHANNEL_SECRET;
  if (!secret || !signature) return false;
  const mac = crypto.createHmac('sha256', secret).update(body).digest('base64');
  const a = Buffer.from(mac);
  const b = Buffer.from(signature);
  return a.length === b.length && crypto.timingSafeEqual(a, b);
}

/** Verify a LIFF ID token and return the LINE user id. In DEMO_MODE a missing token maps to a demo user. */
export async function userIdFromToken(idToken: string | null | undefined): Promise<string> {
  if (!idToken) {
    if (process.env.DEMO_MODE === 'true') return 'demo-user';
    throw new Error('unauthorized');
  }
  const res = await fetch('https://api.line.me/oauth2/v2.1/verify', {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({ id_token: idToken, client_id: process.env.LINE_LOGIN_CHANNEL_ID ?? '' }),
  });
  if (!res.ok) throw new Error(`id_token: ${res.status} ${await res.text().catch(() => '')}`);
  const data = (await res.json()) as { sub?: string };
  if (!data.sub) throw new Error('unauthorized');
  return data.sub;
}

/** Verify a LIFF access token (issued for our LINE Login channel) and return the LINE user id. */
export async function userIdFromAccessToken(accessToken: string): Promise<string> {
  const v = await fetch(`https://api.line.me/oauth2/v2.1/verify?access_token=${encodeURIComponent(accessToken)}`);
  if (!v.ok) throw new Error(`access_token: ${v.status}`);
  const info = (await v.json()) as { client_id?: string; expires_in?: number };
  if (info.client_id !== process.env.LINE_LOGIN_CHANNEL_ID || !info.expires_in || info.expires_in <= 0) throw new Error('access_token: wrong channel or expired');
  const p = await fetch('https://api.line.me/v2/profile', { headers: { Authorization: `Bearer ${accessToken}` } });
  if (!p.ok) throw new Error(`profile: ${p.status}`);
  const prof = (await p.json()) as { userId?: string };
  if (!prof.userId) throw new Error('unauthorized');
  return prof.userId;
}

/** Booking confirmation as a Flex message. */
export function confirmationFlex(b: {
  code: string; plate: string; start: string; end: string; days: number; total: number; shuttle: boolean; pax: number | null;
}, baseUrl: string): LineMessage {
  const row = (k: string, v: string) => ({
    type: 'box', layout: 'horizontal',
    contents: [
      { type: 'text', text: k, size: 'sm', color: '#8A94A6', flex: 2 },
      { type: 'text', text: v, size: 'sm', color: '#0E3320', flex: 4, wrap: true },
    ],
  });
  return {
    type: 'flex',
    altText: `ยืนยันการจอง ${b.code}`,
    contents: {
      type: 'bubble',
      header: {
        type: 'box', layout: 'vertical', backgroundColor: '#0E3320', paddingAll: '16px',
        contents: [
          { type: 'text', text: 'จองสำเร็จ', color: '#E0B04A', weight: 'bold', size: 'xl' },
          { type: 'text', text: `รหัสการจอง ${b.code}`, color: '#F5F7FA', size: 'sm' },
        ],
      },
      body: {
        type: 'box', layout: 'vertical', spacing: 'sm',
        contents: [
          row('ทะเบียน', b.plate),
          row('วันที่จอด', `${b.start} ถึง ${b.end} (${b.days} วัน)`),
          row('รถรับส่ง', b.shuttle ? `ไป-กลับ ${b.pax} คน` : 'ไม่ใช้'),
          row('ยอดชำระ', `${b.total.toLocaleString('th-TH')} บาท`),
        ],
      },
      footer: {
        type: 'box', layout: 'vertical',
        contents: [{
          type: 'button', style: 'primary', color: '#E0B04A',
          // open as a LIFF app (liff.line.me/<id>/my) so the page knows who the customer is;
          // a plain https link opens LINE's normal in-app browser with no LINE login
          action: { type: 'uri', label: 'ดูการจองของฉัน', uri: process.env.NEXT_PUBLIC_LIFF_ID ? `https://liff.line.me/${process.env.NEXT_PUBLIC_LIFF_ID}/my` : `${baseUrl}/liff/my` },
        }],
      },
    },
  };
}
