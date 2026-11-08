import { db } from '@/lib/supabase';
import { currentUser, json } from '@/lib/request';
import { serverT } from '@/lib/i18nDict';

export const dynamic = 'force-dynamic';

type TripRow = {
  id: string; direction: string; pax: number; status: string; pickup_at: string | null; called_at: string | null; departed_at: string | null; flight_number: string | null;
  bookings: { code: string; plate: string; customers: { name: string; line_user_id: string } | null } | null;
  driver: { display_name: string; phone: string | null } | null;
};

async function load(id: string, uid: string) {
  if (!/^[0-9a-f-]{36}$/.test(id)) return null;
  const { data } = await db().from('shuttle_trips')
    .select('id, direction, pax, status, pickup_at, called_at, departed_at, flight_number, bookings(code, plate, customers(name, line_user_id)), driver:staff_users!shuttle_trips_driver_staff_id_fkey(display_name, phone)')
    .eq('id', id).maybeSingle();
  const t = data as unknown as TripRow | null;
  if (!t || t.bookings?.customers?.line_user_id !== uid) return null;
  return t;
}

async function view(t: TripRow) {
  const { data: s } = await db().from('settings').select('pickup_meeting_point, shop_phone').eq('id', 1).single();
  return {
    code: t.bookings?.code, name: t.bookings?.customers?.name, pax: t.pax, flight: t.flight_number, status: t.status,
    calledAt: t.called_at,
    // about 15 minutes from when the driver set off (or from the call, until a driver accepts)
    eta: t.called_at ? new Date(Date.parse(t.departed_at && t.departed_at > t.called_at ? t.departed_at : t.called_at) + 15 * 60_000).toISOString() : null,
    meetingPoint: s?.pickup_meeting_point ?? 'ชั้น 2 ประตู 4', isReturn: t.direction === 'from_airport',
    driver: t.driver ? { name: t.driver.display_name.replace(/\s*\(.*\)$/, ''), phone: t.driver.phone } : null,
    shopPhone: (s?.shop_phone || process.env.SHOP_PHONE || '0888101089').replace(/\D/g, ''),
  };
}

/** Trip info for the call page (own trips only). */
export async function GET(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const uid = await currentUser(req);
  if (!uid) return json({ error: 'unauthorized' }, 401);
  const t = await load((await params).id, uid);
  if (!t) return json({ error: 'not_found' }, 404);
  return json(await view(t));
}

/** The customer is ready: call the van. */
export async function POST(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const uid = await currentUser(req);
  if (!uid) return json({ error: 'unauthorized' }, 401);
  const { id } = await params;
  const { error } = await db().rpc('customer_call_trip', { p_line_user_id: uid, p_trip_id: id });
  if (error) {
    const msg: Record<string, string> = {
      not_found: 'ไม่พบการจองนี้', not_your_trip: 'ไม่พบการจองนี้', not_return_trip: 'ปุ่มนี้ใช้สำหรับรถรับขากลับ',
      trip_closed: 'งานรับส่งนี้เสร็จหรือถูกยกเลิกแล้ว',
    };
    return json({ error: serverT(req)(msg[error.message] ?? 'เรียกรถไม่สำเร็จ กรุณาโทรหาร้าน') }, 409);
  }
  const t = await load(id, uid);
  return json(t ? await view(t) : { ok: true });
}
