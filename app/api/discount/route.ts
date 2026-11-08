import { db } from '@/lib/supabase';
import { currentUser, json } from '@/lib/request';
import { serverT } from '@/lib/i18nDict';

export const dynamic = 'force-dynamic';

/** Preview of the returning-customer / referral discount for the review step.
 *  Signed-in LINE users only; returns just the amount, not who the phone belongs to.
 *  The real discount is decided again inside create_booking. */
export async function POST(req: Request) {
  const uid = await currentUser(req);
  if (!uid) return json({ error: serverT(req)('กรุณาเปิดจาก LINE') }, 401);
  const b = (await req.json().catch(() => ({}))) as { phone?: string; refPhone?: string; days?: number; shuttle?: boolean; start?: string };
  const phone = String(b.phone ?? '').slice(0, 30);
  const ref = String(b.refPhone ?? '').slice(0, 30);
  const days = Math.max(0, Math.min(400, Number(b.days) || 0));
  const [{ data, error }, { data: cps }, { data: camp }, { data: pts }, { data: rws }] = await Promise.all([
    phone.trim() ? db().rpc('booking_discount', { p_phone: phone, p_ref_phone: ref || null, p_days: Number(b.days) || null, p_shuttle: typeof b.shuttle === 'boolean' ? b.shuttle : null }) : Promise.resolve({ data: null, error: null }),
    db().from('coupons').select('id, code, title, value_baht, expires_at, customers!inner(line_user_id)')
      .eq('customers.line_user_id', uid).eq('status', 'active').eq('kind', 'parking_discount')
      .gt('expires_at', new Date().toISOString()).order('value_baht', { ascending: false }),
    days ? db().rpc('booking_campaign_preview', { p_line_user_id: uid, p_days: days, p_start: /^\d{4}-\d{2}-\d{2}$/.test(String(b.start)) ? b.start : null }) : Promise.resolve({ data: null }),
    db().rpc('customer_points', { p_line_user_id: uid }),
    // parking discounts the customer can buy with points right here (no trip to the rewards page)
    db().from('rewards').select('id, title, value_baht, points_cost, stock').eq('active', true).eq('kind', 'parking_discount')
      .order('value_baht', { ascending: false }),
  ]);
  const p = (Array.isArray(pts) ? pts[0] : pts) as { points: number; enabled: boolean } | undefined;
  const balance = p?.enabled ? Number(p.points ?? 0) : 0;
  const cp = (Array.isArray(camp) ? camp[0] : camp) as { name: string; amount: number; stackable: boolean } | undefined;
  const row = (!error && (Array.isArray(data) ? data[0] : data)) as { amount: number; reason: string | null } | undefined;
  return json({
    amount: row?.amount ?? 0, reason: row?.reason ?? null,
    campaign: cp ? { name: cp.name, amount: cp.amount, stackable: cp.stackable } : null,
    coupons: (cps ?? []).map((c) => ({ id: c.id, code: c.code, title: c.title, value: c.value_baht, expiresAt: c.expires_at })),
    points: balance, pointsEnabled: !!p?.enabled,
    rewards: p?.enabled ? (rws ?? []).filter((r) => r.stock == null || r.stock > 0)
      .map((r) => ({ id: r.id, title: r.title, value: r.value_baht, cost: r.points_cost })) : [],
  });
}
