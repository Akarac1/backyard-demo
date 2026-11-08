import { db } from '@/lib/supabase';
import { bkkLocalToIso, currentUser, json } from '@/lib/request';
import { dbErrorToThai } from '@/lib/format';

type Body = {
  start: string; end: string; name: string; phone: string; plate: string; province: string;
  shuttle: boolean; pax: number; outboundTime?: string; returnFlight?: string; returnLanding?: string;
  flightType?: 'domestic' | 'international';
};

export async function POST(req: Request) {
  const uid = await currentUser(req);
  if (!uid) return json({ error: 'กรุณาเปิดจาก LINE' }, 401);
  const b = (await req.json()) as Body;
  if (!b.name?.trim() || !b.phone?.trim() || !b.plate?.trim()) return json({ error: 'กรอกข้อมูลให้ครบ' }, 400);

  // Pickup time = landing + time to get out of the terminal (settings), customer-entered (no flight API in the lean plan).
  let returnPickup: string | null = null;
  if (b.shuttle && b.returnLanding) {
    const { data: s } = await db().from('settings').select('exit_minutes_domestic, exit_minutes_international').eq('id', 1).single();
    const exit = b.flightType === 'domestic' ? s?.exit_minutes_domestic ?? 30 : s?.exit_minutes_international ?? 60;
    returnPickup = new Date(Date.parse(bkkLocalToIso(b.returnLanding)!) + exit * 60_000).toISOString();
  }

  const { data, error } = await db().rpc('create_booking', {
    p_line_user_id: uid,
    p_name: b.name.trim(),
    p_phone: b.phone.trim(),
    p_plate: b.plate,
    p_province: b.province.trim(),
    p_start: b.start,
    p_end: b.end,
    p_shuttle: !!b.shuttle,
    p_pax: b.shuttle ? b.pax : null,
    p_outbound_flight: null,
    p_outbound_time: b.shuttle ? bkkLocalToIso(b.outboundTime) : null,
    p_return_flight: b.shuttle ? b.returnFlight || null : null,
    p_return_time: returnPickup,
  });
  if (error) return json({ error: dbErrorToThai(error.message) }, 409);
  return json({ id: (data as { id: string }).id });
}
