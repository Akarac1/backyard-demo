import { db } from '@/lib/supabase';
import { currentUser, json } from '@/lib/request';
import { dbErrorToThai } from '@/lib/format';
import { serverT } from '@/lib/i18nDict';

export const dynamic = 'force-dynamic';

type TripRow = {
  id: string; direction: 'to_airport' | 'from_airport'; status: string; completed_at: string | null;
  bookings: { code: string; customers: { name: string; line_user_id: string } | null } | null;
  driver: { display_name: string } | null;
  vehicles: { name: string; plate: string | null } | null;
};

/** The customer's finished trip, with their rating if they already gave one. */
export async function GET(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const uid = await currentUser(req);
  if (!uid) return json({ error: 'unauthorized' }, 401);
  const { id } = await params;
  if (!/^[0-9a-f-]{36}$/.test(id)) return json({ error: 'not_found' }, 404);
  const sb = db();
  const { data } = await sb.from('shuttle_trips')
    .select('id, direction, status, completed_at, bookings(code, customers(name, line_user_id)), driver:staff_users!shuttle_trips_driver_staff_id_fkey(display_name), vehicles(name, plate)')
    .eq('id', id).maybeSingle();
  const t = data as unknown as TripRow | null;
  if (!t || t.bookings?.customers?.line_user_id !== uid) return json({ error: 'not_found' }, 404);
  const { data: r } = await sb.from('trip_ratings').select('stars, comment, created_at').eq('trip_id', id).maybeSingle();
  return json({
    code: t.bookings?.code, direction: t.direction, done: t.status === 'done',
    driver: t.driver?.display_name.replace(/\s*\(.*\)$/, '') ?? null, plate: t.vehicles?.plate ?? null,
    rating: r ? { stars: r.stars, comment: r.comment ?? '' } : null,
    canEdit: !r || Date.parse(r.created_at) > Date.now() - 7 * 86400_000,
  });
}

export async function POST(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const L = serverT(req);
  const uid = await currentUser(req);
  if (!uid) return json({ error: L('กรุณาเปิดจาก LINE') }, 401);
  const { id } = await params;
  const b = (await req.json().catch(() => ({}))) as { stars?: number; comment?: string };
  const { error } = await db().rpc('customer_rate_trip', {
    p_line_user_id: uid, p_trip: id, p_stars: Math.round(Number(b.stars)), p_comment: String(b.comment ?? '').slice(0, 1000),
  });
  if (error) return json({ error: error.message === 'not_found' ? L('ไม่พบการจองนี้ หรือเปิดลิงก์จากบัญชี LINE อื่น') : dbErrorToThai(error.message, L.lang) }, 409);
  return json({ ok: true });
}
