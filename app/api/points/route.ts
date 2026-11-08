import { db } from '@/lib/supabase';
import { currentUser, json } from '@/lib/request';
import { serverT } from '@/lib/i18nDict';

export const dynamic = 'force-dynamic';

type Move = { at: string; points: number; label: string; expires_at?: string | null };

/** The signed-in customer's points: balance, what they are worth, what expires soon, last movements. */
export async function GET(req: Request) {
  const L = serverT(req);
  const uid = await currentUser(req);
  if (!uid) return json({ error: 'unauthorized' }, 401);
  const sb = db();
  const { data: p } = await sb.rpc('customer_points', { p_line_user_id: uid });
  const row = (Array.isArray(p) ? p[0] : p) as { points: number; point_value: number; enabled: boolean; expiring: number; expiring_at: string | null } | undefined;
  const { data: c } = await sb.from('customers').select('id').eq('line_user_id', uid).maybeSingle();
  const { data: st } = await sb.from('settings').select('points_per_baht, referral_points, points_expiry_months').eq('id', 1).single();
  const moves: Move[] = [];
  if (c) {
    const [{ data: lots }, { data: spends }] = await Promise.all([
      sb.from('point_lots').select('points, source, note, earned_at, expires_at, bookings(code)').eq('customer_id', c.id).order('earned_at', { ascending: false }).limit(15),
      sb.from('point_spends').select('points, reason, note, created_at, returned_at, bookings(code)').eq('customer_id', c.id).order('created_at', { ascending: false }).limit(15),
    ]);
    const code = (x: unknown) => (x as { code?: string } | null)?.code;
    for (const l of lots ?? []) moves.push({
      at: l.earned_at, points: l.points, expires_at: l.expires_at,
      label: l.source === 'payment' ? L('ชำระเงิน {c}', { c: code(l.bookings) ?? '' }) : l.source === 'referral' ? L('แนะนำเพื่อน') + (l.note ? ` (${l.note.replace(/^แนะนำ\s*/, '')})` : '') : L(l.note ?? 'แอดมินเพิ่มให้'),
    });
    for (const s of spends ?? []) if (!s.returned_at) moves.push({
      at: s.created_at, points: -s.points,
      label: s.reason === 'coupon' ? L('แลก {x}', { x: s.note ? L(s.note) : L('ของรางวัล') }) : s.reason === 'booking' ? L('ใช้เป็นส่วนลด {c}', { c: code(s.bookings) ?? '' }) : L(s.note ?? 'แอดมินปรับ'),
    });
    moves.sort((a, b) => b.at.localeCompare(a.at));
  }
  return json({
    points: row?.points ?? 0, pointValue: row?.point_value ?? 0, enabled: row?.enabled ?? false,
    expiring: row?.expiring ?? 0, expiringAt: row?.expiring_at ?? null, moves: moves.slice(0, 15),
    perBaht: st?.points_per_baht ?? 100, referral: st?.referral_points ?? 0, months: st?.points_expiry_months ?? 36,
  });
}
