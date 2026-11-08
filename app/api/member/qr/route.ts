import { db } from '@/lib/supabase';
import { currentUser, json } from '@/lib/request';
import { memberQrUrl } from '@/lib/memberQr';

export const dynamic = 'force-dynamic';

/** A fresh signed QR link for the signed-in member's card. */
export async function GET(req: Request) {
  const uid = await currentUser(req);
  if (!uid) return json({ error: 'unauthorized' }, 401);
  const { data } = await db().rpc('customer_member', { p_line_user_id: uid });
  const m = (Array.isArray(data) ? data[0] : data) as { member_no: string | null; tier: string } | undefined;
  if (!m?.member_no) return json({ error: 'no_member' }, 404);
  const base = process.env.NEXT_PUBLIC_BASE_URL || new URL(req.url).origin;
  return json({ ...memberQrUrl(base, m.member_no, m.tier), memberNo: m.member_no, tier: m.tier });
}
