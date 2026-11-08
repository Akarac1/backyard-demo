import { db } from '@/lib/supabase';
import { currentUser, json } from '@/lib/request';

export const dynamic = 'force-dynamic';

const BIZ: Record<string, string> = { all: 'ทุกบริการ', parking: 'ที่จอดรถ', cafe: 'คาเฟ่', stay: 'ที่พัก' };

/** Member card data for the signed-in customer: tier, spend toward the next tier, points, campaigns for them. */
export async function GET(req: Request) {
  const uid = await currentUser(req);
  if (!uid) return json({ error: 'unauthorized' }, 401);
  const sb = db();
  const { data } = await sb.rpc('customer_member', { p_line_user_id: uid });
  const m = (Array.isArray(data) ? data[0] : data) as Record<string, unknown> | undefined;
  if (!m) return json({ error: 'unavailable' }, 500);
  const { data: camps } = await sb.rpc('active_campaigns', { p_tier: m.tier as string, p_business: null });
  return json({
    memberNo: m.member_no, name: m.name, tier: m.tier, tierName: m.tier_name, multiplier: Number(m.multiplier),
    spend: m.spend, windowMonths: m.window_months, nextTierName: m.next_tier_name, nextMin: m.next_min,
    points: m.points, manual: m.manual,
    campaigns: ((camps ?? []) as { name: string; description: string | null; business: string; kind: string; multiplier: number; bonus_points: number; ends_at: string | null; min_days: number; free_days: number; amount_off: number }[])
      .map((c) => ({
        name: c.name, description: c.description, business: BIZ[c.business] ?? c.business, endsAt: c.ends_at,
        effect: c.kind === 'multiplier' ? `แต้ม x${Number(c.multiplier)}` : c.kind === 'bonus' ? `+${c.bonus_points} แต้มต่อการใช้บริการ`
          : c.kind === 'free_days' ? `จอด ${c.min_days} วันขึ้นไป ฟรี ${c.free_days} วัน` : c.kind === 'amount_off' ? `จอด ${c.min_days} วันขึ้นไป ลด ${c.amount_off.toLocaleString('th-TH')} บาท` : null,
      })),
  });
}
