import { db } from '@/lib/supabase';
import { todayBkk, addDays } from '@/lib/format';

export type DriverRating = { driver_staff_id: string | null; driver_name: string; ratings: number; avg_stars: number | null; s1: number; s2: number; s3: number; s4: number; s5: number; comments: number; trips_done: number };
export type RatingRow = { created_at: string; updated_at: string; stars: number; comment: string | null; direction: 'to_airport' | 'from_airport'; driver_staff_id: string | null; driver_name: string | null; customer_name: string | null; phone: string | null; booking_code: string | null; vehicle: string | null };

const isDay = (s?: string) => !!s && /^\d{4}-\d{2}-\d{2}$/.test(s);
const isId = (s?: string) => !!s && /^[0-9a-f-]{36}$/.test(s);

/** Query string -> filters. Default: last 30 days, everyone. */
export function ratingFilters(sp: Record<string, string | undefined>) {
  const to = isDay(sp.to) ? sp.to! : todayBkk();
  const from = isDay(sp.from) ? sp.from! : addDays(to, -29);
  const s = Number(sp.s);
  return { from: from <= to ? from : to, to, d: isId(sp.d) ? sp.d! : '', s: s >= 1 && s <= 5 ? s : 0, c: sp.c === '1' };
}

export async function getRatings(f: ReturnType<typeof ratingFilters>, limit = 500) {
  const sb = db();
  const [drivers, list] = await Promise.all([
    sb.rpc('rating_by_driver', { p_from: f.from, p_to: f.to }),
    sb.rpc('rating_list', { p_from: f.from, p_to: f.to, p_driver: f.d || null, p_stars: f.s || null, p_with_comment: f.c, p_limit: limit }),
  ]);
  if (drivers.error) throw new Error(drivers.error.message);
  const num = (v: unknown) => Number(v ?? 0);
  return {
    drivers: ((drivers.data ?? []) as DriverRating[]).map((d) => ({ ...d, ratings: num(d.ratings), avg_stars: d.avg_stars == null ? null : num(d.avg_stars), s1: num(d.s1), s2: num(d.s2), s3: num(d.s3), s4: num(d.s4), s5: num(d.s5), comments: num(d.comments), trips_done: num(d.trips_done) })),
    list: (list.data ?? []) as RatingRow[],
  };
}

export const legLabel = (d: string) => (d === 'from_airport' ? 'รับขากลับ' : 'ส่งไปสนามบิน');
