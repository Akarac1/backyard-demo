import 'server-only';
import crypto from 'node:crypto';

// Member QR: https://<site>/ops/m/<member_no>?tier=<code>&exp=<unix>&sig=<hmac>
// Readable by any scanner (member number + tier are in the clear), and signed so staff can tell a QR
// made by our app from a typed or edited one. Valid for QR_MINUTES; the card page refreshes it.
export const QR_MINUTES = 10;

function key() {
  const s = process.env.SESSION_SECRET;
  if (!s || s.length < 32) throw new Error('SESSION_SECRET must be set (32+ characters)');
  return s;
}
const mac = (no: string, tier: string, exp: number) =>
  crypto.createHmac('sha256', key()).update(`member-qr|${no}|${tier}|${exp}`).digest('base64url').slice(0, 22);

export function memberQrUrl(base: string, memberNo: string, tier: string): { url: string; exp: number } {
  const exp = Math.floor(Date.now() / 1000) + QR_MINUTES * 60;
  const q = new URLSearchParams({ tier, exp: String(exp), sig: mac(memberNo, tier, exp) });
  return { url: `${base.replace(/\/$/, '')}/ops/m/${encodeURIComponent(memberNo)}?${q}`, exp };
}

export type QrCheck = 'ok' | 'expired' | 'bad' | 'missing';
export function checkMemberQr(memberNo: string, tier?: string, exp?: string, sig?: string): QrCheck {
  if (!tier || !exp || !sig) return 'missing';
  const e = Number(exp);
  if (!Number.isFinite(e)) return 'bad';
  const want = mac(memberNo, tier, e);
  if (want.length !== sig.length || !crypto.timingSafeEqual(Buffer.from(want), Buffer.from(sig))) return 'bad';
  return e * 1000 < Date.now() ? 'expired' : 'ok';
}
