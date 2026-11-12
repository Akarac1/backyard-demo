import { db } from '@/lib/supabase';
import { bkkLocalToIso, currentUser, json } from '@/lib/request';
import { dbErrorToThai } from '@/lib/format';
import { serverT } from '@/lib/i18nDict';
import { afterConfirmed } from '@/lib/confirm';
import { bagCount, shuttleCheck } from '@/lib/shuttle';

type Body = {
  start: string; end: string; name: string; phone: string; plate: string; province: string;
  shuttle: boolean; pax: number; outboundTime?: string; returnFlight?: string; returnLanding?: string;
  flightType?: 'domestic' | 'international'; refPhone?: string; couponId?: string; rewardId?: string;
  largeBags?: number; smallBags?: number;
  cars?: { plate: string; province: string }[];   // other cars booked together (group booking)
};

export async function POST(req: Request) {
  const L = serverT(req);
  const uid = await currentUser(req);
  if (!uid) return json({ error: L('กรุณาเปิดจาก LINE') }, 401);
  const b = (await req.json()) as Body;
  if (!b.name?.trim() || !b.phone?.trim() || !b.plate?.trim()) return json({ error: L('กรอกข้อมูลให้ครบ') }, 400);

  // Pickup time = landing + time to get out of the terminal (settings), customer-entered (no flight API in the lean plan).
  let returnPickup: string | null = null;
  if (b.shuttle && b.returnLanding) {
    const { data: s } = await db().from('settings').select('exit_minutes_domestic, exit_minutes_international').eq('id', 1).single();
    const exit = b.flightType === 'domestic' ? s?.exit_minutes_domestic ?? 30 : s?.exit_minutes_international ?? 60;
    returnPickup = new Date(Date.parse(bkkLocalToIso(b.returnLanding)!) + exit * 60_000).toISOString();
  }

  const isId = (v?: string) => !!v && /^[0-9a-f-]{36}$/.test(v);
  // points used on the review page: redeem + book in one transaction (create_booking_with_reward)
  const useReward = isId(b.rewardId) && !isId(b.couponId) && !(Array.isArray(b.cars) && b.cars.length > 0);
  // one call books it all (create_booking_bags hands the bag counts to the trips and spends points when asked)
  const extra = (Array.isArray(b.cars) ? b.cars : []).slice(0, 20)
    .map((c) => ({ plate: String(c?.plate ?? '').trim(), province: String(c?.province ?? '').trim() })).filter((c) => c.plate);
  const group = extra.length > 0;
  const { data, error } = group
    // several cars in one go: one payment, one shuttle for the whole group (create_booking_group)
    ? await db().rpc('create_booking_group', {
      p_line_user_id: uid, p_name: b.name.trim(), p_phone: b.phone.trim(),
      p_cars: [{ plate: b.plate, province: b.province.trim() }, ...extra],
      p_start: b.start, p_end: b.end, p_shuttle: !!b.shuttle, p_pax: b.shuttle ? b.pax : null,
      p_outbound_flight: null, p_outbound_time: b.shuttle ? bkkLocalToIso(b.outboundTime) : null,
      p_return_flight: b.shuttle ? b.returnFlight || null : null, p_return_time: returnPickup,
      p_ref_phone: b.refPhone?.trim() || null, p_coupon: isId(b.couponId) ? b.couponId : null,
      p_large: b.shuttle ? bagCount(b.largeBags) : 0,
    })
    : await db().rpc('create_booking_bags', {
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
    p_ref_phone: b.refPhone?.trim() || null,
    ...(useReward ? { p_reward: b.rewardId } : { p_coupon: isId(b.couponId) ? b.couponId : null }),
    p_large: b.shuttle ? bagCount(b.largeBags) : 0,
    p_small: 0,   // only large bags are counted
  });
  if (error) {
    // the van filled up between the check on the form and this booking: send nearby free times back
    if (error.message === 'shuttle_full' && b.outboundTime) {
      const c = await shuttleCheck(b.outboundTime, b.pax, b.largeBags);
      return json({ error: dbErrorToThai(error.message, L.lang), code: 'shuttle_full', tooBig: c.tooBig, suggestions: c.suggestions }, 409);
    }
    return json({ error: dbErrorToThai(error.message, L.lang) }, 409);
  }
  const id = (data as { id: string }).id;
  const paidInFull = (data as { status: string }).status === 'confirmed';
  // keep the landing time: the "welcome to Suvarnabhumi" card is sent at this time
  if (b.shuttle && b.returnLanding) {
    await db().from('shuttle_trips').update({ landing_at: bkkLocalToIso(b.returnLanding) }).eq('booking_id', id).eq('direction', 'from_airport');
  }
  // paid entirely with discount + points: nothing to pay, send the confirmation now
  if (paidInFull) await afterConfirmed(id).catch((e) => console.error('afterConfirmed', String(e)));
  return json({ id, paid: paidInFull });
}
