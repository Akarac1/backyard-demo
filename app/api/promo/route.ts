import { db } from '@/lib/supabase';
import { currentUser, json } from '@/lib/request';
import { serverT } from '@/lib/i18nDict';
import { dbErrorToThai } from '@/lib/format';

export const dynamic = 'force-dynamic';

/** Redeem a shared promo code (e.g. from a Facebook post) -> a personal coupon in "คูปองของฉัน". */
export async function POST(req: Request) {
  const L = serverT(req);
  const uid = await currentUser(req);
  if (!uid) return json({ error: L('กรุณาเปิดจาก LINE') }, 401);
  const { code } = (await req.json().catch(() => ({}))) as { code?: string };
  const clean = String(code ?? '').replace(/\s/g, '').toUpperCase();
  if (!/^[A-Z0-9_-]{3,24}$/.test(clean)) return json({ error: dbErrorToThai('promo_invalid', L.lang) }, 400);
  const { data, error } = await db().rpc('redeem_promo_code', { p_line_user_id: uid, p_code: clean });
  if (error) return json({ error: dbErrorToThai(error.message, L.lang) }, 409);
  const c = data as { code: string; title: string; expires_at: string; value_baht: number };
  return json({ ok: true, code: c.code, title: c.title, expires_at: c.expires_at, value: c.value_baht });
}
