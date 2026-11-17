import { db } from '@/lib/supabase';
import { currentUser, json } from '@/lib/request';
import { serverT } from '@/lib/i18nDict';
import { dbErrorToThai } from '@/lib/format';

export const dynamic = 'force-dynamic';

/** Link bookings the shop entered for this customer (no LINE account yet) to the signed-in LINE user.
 *  Proof = phone + a plate from those bookings; the database limits wrong tries. */
export async function POST(req: Request) {
  const L = serverT(req);
  const uid = await currentUser(req);
  if (!uid) return json({ error: L('กรุณาเปิดจาก LINE') }, 401);
  const { phone, plate } = (await req.json().catch(() => ({}))) as { phone?: string; plate?: string };
  const { data, error } = await db().rpc('claim_imported_bookings', {
    p_line_user_id: uid, p_phone: String(phone ?? '').slice(0, 30), p_plate: String(plate ?? '').slice(0, 20),
  });
  if (error) return json({ error: dbErrorToThai(error.message, L.lang) }, 409);
  const n = Number(data ?? -1);
  if (n < 1) return json({ error: dbErrorToThai('claim_not_found', L.lang) }, 404);
  return json({ ok: true, bookings: n });
}
