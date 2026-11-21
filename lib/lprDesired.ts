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

type Stay = { from: string; to: string; codes: string[]; phone: string };
type PlateRow = { code: string; plate: string; start_date: string; end_date: string; late_grace: boolean; customers: { name: string; phone: string } | null };

/** Same merge rule as lprDesired() below: contiguous/overlapping bookings on one plate become one stay, a gap starts a new one. */
function mergeIntoStays(stays: Stay[], b: PlateRow, to: string) {
  const last = stays[stays.length - 1];
  if (last && b.start_date <= addDays(last.to, 1)) {
    if (to > last.to) last.to = to;
    last.codes.push(b.code);
  } else {
    stays.push({ from: b.start_date, to, codes: [b.code], phone: b.customers?.phone ?? '' });
  }
}

/**
 * The plates the NVR allow list should hold right now: every confirmed / checked-in booking that has not ended yet,
 * one row per plate, because the NVR overwrites a duplicate plate instead of holding two date ranges for it.
 * A late-return grace day (bookings.late_grace) extends the end.
 *
 * A customer can have more than one booking on the same plate with a gap between them (e.g. 1-5 Dec, then 10-15
 * Dec). Those must NOT be merged into one row spanning 1-15 Dec — that would leave the plate allowed through the
 * gap (6-9 Dec) when nothing is actually booked. Back-to-back/overlapping bookings on the same plate DO merge
 * (they're genuinely one continuous stay). Among separate stays, only the one relevant right now is sent — the
 * one covering today, else whichever starts soonest — and the next sync cycle (every POLL_SECONDS) naturally
 * rolls on to the next stay once the current one's window ends and ages out of the query below.
 *
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
  const staysByPlate = new Map<string, Stay[]>();
  const invalid: LprInvalid[] = [];
  for (const b of (data ?? []) as unknown as PlateRow[]) {
    const to = b.late_grace ? addDays(b.end_date, 1) : b.end_date;
    for (const plate of splitPlates(b.plate)) {
      if (!THAI_PLATE.test(plate)) { invalid.push({ code: b.code, plate }); continue; }
      // data is ordered by start_date, so only the most recent stay can possibly touch this one
      const stays = staysByPlate.get(plate) ?? [];
      mergeIntoStays(stays, b, to);
      staysByPlate.set(plate, stays);
    }
  }
  const plates = [...staysByPlate.entries()].map(([plate, stays]) => {
    // whichever stay covers today, else whichever starts soonest (stays are already in start-date order)
    const chosen = stays.find((s) => s.from <= today && today <= s.to) ?? stays.find((s) => s.from > today) ?? stays[stays.length - 1];
    return { plate, owner: ownerText(chosen.codes, chosen.phone), from: chosen.from, to: chosen.to };
  });
  return { plates, invalid };
}

export type LprQueuedStay = { from: string; to: string; codes: string[] };
/**
 * For one booking's own plate: every other confirmed/checked-in stay on the same plate, and whether THIS
 * booking's code is the one the NVR currently holds (see lprDesired() above for the merge/selection rule).
 * Used by the booking-detail admin page to warn when a booking's own window is queued behind another one —
 * the NVR will not yet show this plate's dates, because it only ever holds a single row per plate.
 * Returns null when the plate is malformed or this booking isn't the kind lprDesired() tracks at all.
 */
export async function lprQueueStatus(bookingCode: string, rawPlate: string): Promise<{ plate: string; active: LprQueuedStay; mine: boolean } | null> {
  const plate = splitPlates(rawPlate)[0];
  if (!plate || !THAI_PLATE.test(plate)) return null;
  const today = bkkToday();
  const { data, error } = await db()
    .from('bookings')
    .select('code, plate, start_date, end_date, late_grace')
    .in('status', ['confirmed', 'checked_in'])
    .gte('end_date', addDays(today, -1))
    .order('start_date');
  if (error) throw new Error(error.message);
  const stays: Stay[] = [];
  for (const b of (data ?? []) as unknown as Omit<PlateRow, 'customers'>[]) {
    const to = b.late_grace ? addDays(b.end_date, 1) : b.end_date;
    for (const p of splitPlates(b.plate)) {
      if (p !== plate) continue;
      mergeIntoStays(stays, { ...b, customers: null }, to);
    }
  }
  if (stays.length < 2) return null; // nothing else sharing this plate: no queue to speak of
  const chosen = stays.find((s) => s.from <= today && today <= s.to) ?? stays.find((s) => s.from > today) ?? stays[stays.length - 1];
  return { plate, active: { from: chosen.from, to: chosen.to, codes: chosen.codes }, mine: chosen.codes.includes(bookingCode) };
}
