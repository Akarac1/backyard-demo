import { db } from '@/lib/supabase';
import { currentUser, json } from '@/lib/request';

export const dynamic = 'force-dynamic';

/** Preview of the returning-customer / referral discount for the review step.
 *  Signed-in LINE users only; returns just the amount, not who the phone belongs to.
 *  The real discount is decided again inside create_booking. */
export async function POST(req: Request) {
  const uid = await currentUser(req);
  if (!uid) return json({ error: 'กรุณาเปิดจาก LINE' }, 401);
  const b = (await req.json().catch(() => ({}))) as { phone?: string; refPhone?: string; days?: number; shuttle?: boolean };
  const phone = String(b.phone ?? '').slice(0, 30);
  const ref = String(b.refPhone ?? '').slice(0, 30);
  const [{ data, error }, { data: cps }] = await Promise.all([
    phone.trim() ? db().rpc('booking_discount', { p_phone: phone, p_ref_phone: ref || null, p_days: Number(b.days) || null, p_shuttle: typeof b.shuttle === 'boolean' ? b.shuttle : null }) : Promise.resolve({ data: null, error: null }),
    db().from('coupons').select('id, code, title, value_baht, expires_at, customers!inner(line_user_id)')
      .eq('customers.line_user_id', uid).eq('status', 'active').eq('kind', 'parking_discount')
      .gt('expires_at', new Date().toISOString()).order('value_baht', { ascending: false }),
  ]);
  const row = (!error && (Array.isArray(data) ? data[0] : data)) as { amount: number; reason: string | null } | undefined;
  return json({
    amount: row?.amount ?? 0, reason: row?.reason ?? null,
    coupons: (cps ?? []).map((c) => ({ id: c.id, code: c.code, title: c.title, value: c.value_baht, expiresAt: c.expires_at })),
  });
}
