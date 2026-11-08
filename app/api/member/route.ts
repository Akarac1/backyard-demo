import { db } from '@/lib/supabase';
import { currentUser, json } from '@/lib/request';
import { serverT, dayIn, numIn } from '@/lib/i18nDict';

export const dynamic = 'force-dynamic';

const BIZ: Record<string, string> = { all: 'ทุกบริการ', parking: 'ที่จอดรถ', cafe: 'คาเฟ่', stay: 'ที่พัก' };

/** Member card data for the signed-in customer: tier, spend toward the next tier, points, campaigns for them. */
export async function GET(req: Request) {
  const L = serverT(req);
  const thD = (d: string) => dayIn(L.lang, d);
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
    campaigns: ((camps ?? []) as { name: string; description: string | null; business: string; kind: string; multiplier: number; bonus_points: number; ends_at: string | null; min_days: number; free_days: number; amount_off: number; percent_off: number; stay_from: string | null; stay_to: string | null }[])
      .map((c) => ({
        name: c.name, description: c.description, business: L(BIZ[c.business] ?? c.business), endsAt: c.ends_at,
        effect: c.kind === 'multiplier' ? L('แต้ม x{n}', { n: Number(c.multiplier) }) : c.kind === 'bonus' ? L('+{n} แต้มต่อการใช้บริการ', { n: c.bonus_points })
          : c.kind === 'free_days' ? L('จอด {a} วันขึ้นไป ฟรี {b} วัน', { a: c.min_days, b: c.free_days }) : c.kind === 'amount_off' ? L('จอด {a} วันขึ้นไป ลด {b} บาท', { a: c.min_days, b: numIn(L.lang, c.amount_off) })
          : c.kind === 'percent_off' ? L('ลดค่าจอด {n}%', { n: c.percent_off }) + (c.min_days > 1 ? L(' (จอด {n} วันขึ้นไป)', { n: c.min_days }) : '') : null,
        stay: c.stay_from || c.stay_to ? L('เข้าจอด {a} – {b}', { a: c.stay_from ? thD(c.stay_from) : '', b: c.stay_to ? thD(c.stay_to) : '' }) : null,
      })),
  });
}
