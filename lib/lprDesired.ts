import 'server-only';
import { db } from './supabase';

export type LprDesired = { plate: string; owner: string; from: string; to: string };
export type LprInvalid = { code: string; plate: string };

/** A Thai plate: optional leading digit, 1-3 consonants, 1-4 digits (1กข1234, กก12, ฎน68). Anything else is reported, never sent to the NVR. */
const THAI_PLATE = /^[0-9]?[ก-ฮ]{1,3}[0-9]{1,4}$/;
/** Customers sometimes type two plates in one field ("1กข123 / 2ขค456"): one NVR row per plate. */
const splitPlates = (raw: string) => raw.split(/[\/,;&]|\s+และ\s+/).map((p) => p.replace(/[\s-]+/g, '').toUpperCase()).filter(Boolean);
/** The NVR API refuses an Owner longer than 15 bytes (16 fails). Ours is ASCII only: BY-<code>[+n] <last 4 phone digits>. */
const OWNER_MAX_BYTES = 15;
const ownerText = (codes: string[], phone: string) => {
  const base = `BY-${codes[0]}${codes.length > 1 ? `+${codes.length - 1}` : ''}`;
  const last4 = phone.replace(/\D/g, '').slice(-4);
  const full = last4 ? `${base} ${last4}` : base;
  return Buffer.byteLength(full) <= OWNER_MAX_BYTES ? full : base.slice(0, OWNER_MAX_BYTES);
};

const bkkToday = () => new Date().toLocaleDateString('sv-SE', { timeZone: 'Asia/Bangkok' });
const addDays = (d: string, n: number) => new Date(Date.parse(`${d}T00:00:00Z`) + n * 86400000).toISOString().slice(0, 10);

/**
 * The plates the NVR allow list should hold right now: every confirmed / checked-in booking that has not ended yet,
 * one row per plate. A plate with several bookings gets ONE row covering all of them, because the NVR overwrites
 * a duplicate plate instead of extending it. A late-return grace day (bookings.late_grace) extends the end.
 * Rows are tagged "BY-<code> <last 4 of phone>" (15 bytes max) so the bridge only ever touches rows this system made.
 */
export async function lprDesired(): Promise<{ plates: LprDesired[]; invalid: LprInvalid[] }> {
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
  const invalid: LprInvalid[] = [];
  for (const b of (data ?? []) as unknown as Row[]) {
    const to = b.late_grace ? addDays(b.end_date, 1) : b.end_date;
    for (const plate of splitPlates(b.plate)) {
      if (!THAI_PLATE.test(plate)) { invalid.push({ code: b.code, plate }); continue; }
      const cur = byPlate.get(plate);
      if (!cur) byPlate.set(plate, { from: b.start_date, to, codes: [b.code], name: '', phone: b.customers?.phone ?? '' });
      else {
        if (b.start_date < cur.from) cur.from = b.start_date;
        if (to > cur.to) cur.to = to;
        cur.codes.push(b.code);
      }
    }
  }
  const plates = [...byPlate.entries()].map(([plate, v]) => ({
    plate,
    owner: ownerText(v.codes, v.phone),
    from: v.from,
    to: v.to,
  }));
  return { plates, invalid };
}
