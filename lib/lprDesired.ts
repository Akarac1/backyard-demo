import 'server-only';
import { db } from './supabase';

export type LprDesired = { plate: string; owner: string; from: string; to: string };

const bkkToday = () => new Date().toLocaleDateString('sv-SE', { timeZone: 'Asia/Bangkok' });
const addDays = (d: string, n: number) => new Date(Date.parse(`${d}T00:00:00Z`) + n * 86400000).toISOString().slice(0, 10);

/**
 * The plates the NVR allow list should hold right now: every confirmed / checked-in booking that has not ended yet,
 * one row per plate. A plate with several bookings gets ONE row covering all of them, because the NVR overwrites
 * a duplicate plate instead of extending it. A late-return grace day (bookings.late_grace) extends the end.
 * Rows are tagged "BY-<code> <name> <phone>" so the bridge only ever touches rows this system made.
 */
export async function lprDesired(): Promise<LprDesired[]> {
  const today = bkkToday();
  const { data, error } = await db()
    .from('bookings')
    .select('code, plate, start_date, end_date, late_grace, customers(name, phone)')
    .in('status', ['confirmed', 'checked_in'])
    .gte('end_date', addDays(today, -1))
    .order('start_date');
  if (error) throw new Error(error.message);
  type Row = { code: string; plate: string; start_date: string; end_date: string; late_grace: boolean; customers: { name: string; phone: string } | null };
  const byPlate = new Map<string, { from: string; to: string; codes: string[]; name: string; phone: string }>();
  for (const b of (data ?? []) as unknown as Row[]) {
    const plate = b.plate.replace(/[\s-]+/g, '').toUpperCase();
    if (!plate) continue;
    const to = b.late_grace ? addDays(b.end_date, 1) : b.end_date;
    const cur = byPlate.get(plate);
    if (!cur) byPlate.set(plate, { from: b.start_date, to, codes: [b.code], name: b.customers?.name ?? '', phone: b.customers?.phone ?? '' });
    else {
      if (b.start_date < cur.from) cur.from = b.start_date;
      if (to > cur.to) cur.to = to;
      cur.codes.push(b.code);
    }
  }
  return [...byPlate.entries()].map(([plate, v]) => ({
    plate,
    owner: `BY-${v.codes[0]}${v.codes.length > 1 ? `+${v.codes.length - 1}` : ''} ${v.name} ${v.phone}`.trim().slice(0, 60),
    from: v.from,
    to: v.to,
  }));
}
