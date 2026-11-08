import { db } from '@/lib/supabase';
import { currentUser, json } from '@/lib/request';
import { serverT } from '@/lib/i18nDict';
import { dbErrorToThai } from '@/lib/format';

export const dynamic = 'force-dynamic';

/** Reward catalog + the signed-in customer's points and coupons. */
export async function GET(req: Request) {
  const uid = await currentUser(req);
  if (!uid) return json({ error: 'unauthorized' }, 401);
  const sb = db();
  const [{ data: p }, { data: rewards }, { data: coupons }] = await Promise.all([
    sb.rpc('customer_points', { p_line_user_id: uid }),
    sb.from('rewards').select('id, title, description, business, kind, value_baht, points_cost, valid_days, stock')
      .eq('active', true).order('sort').order('points_cost'),
    sb.from('coupons').select('id, code, title, business, kind, value_baht, status, expires_at, used_at, created_at, customers!inner(line_user_id)')
      .eq('customers.line_user_id', uid).order('created_at', { ascending: false }).limit(30),
  ]);
  const row = (Array.isArray(p) ? p[0] : p) as { points: number; enabled: boolean } | undefined;
  const now = Date.now();
  return json({
    points: row?.points ?? 0, enabled: row?.enabled ?? false,
    rewards: (rewards ?? []).filter((r) => r.stock == null || r.stock > 0),
    coupons: (coupons ?? []).map(({ customers: _c, ...c }) => ({
      ...c, status: c.status === 'active' && Date.parse(c.expires_at) <= now ? 'expired' : c.status,
    })),
  });
}

/** Exchange points for a reward. */
export async function POST(req: Request) {
  const L = serverT(req);
  const uid = await currentUser(req);
  if (!uid) return json({ error: L('กรุณาเปิดจาก LINE') }, 401);
  const { rewardId } = (await req.json().catch(() => ({}))) as { rewardId?: string };
  if (!rewardId || !/^[0-9a-f-]{36}$/.test(rewardId)) return json({ error: L('ไม่พบของรางวัลนี้') }, 400);
  const { data, error } = await db().rpc('redeem_reward', { p_line_user_id: uid, p_reward: rewardId });
  if (error) return json({ error: dbErrorToThai(error.message, L.lang) }, 409);
  const c = data as { code: string; title: string; expires_at: string };
  return json({ code: c.code, title: c.title, expiresAt: c.expires_at });
}
