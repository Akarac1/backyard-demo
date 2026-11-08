import { db } from '@/lib/supabase';
import { todayBkk, addDays } from '@/lib/format';

export type LogRow = {
  at: string; kind: string; points: number; customer_id: string | null; customer_name: string | null; phone: string | null;
  member_no: string | null; booking_code: string | null; business: string | null; amount: number | null; note: string | null;
  by_name: string | null; expires_at: string | null; returned: boolean;
};
export type LogTotal = { kind: string; entries: number; points: number };

export const KINDS: { key: string; label: string; earn: boolean }[] = [
  { key: 'payment', label: 'ชำระค่าจอด', earn: true },
  { key: 'purchase', label: 'ซื้อสินค้า/บริการอื่น', earn: true },
  { key: 'referral', label: 'แนะนำเพื่อน', earn: true },
  { key: 'admin_add', label: 'ทีมงานเพิ่มให้', earn: true },
  { key: 'admin_take', label: 'ทีมงานหักออก', earn: false },
  { key: 'redeem', label: 'แลกของรางวัล', earn: false },
  { key: 'booking', label: 'ใช้เป็นส่วนลดการจอง', earn: false },
];
export const kindLabel = (k: string) => KINDS.find((x) => x.key === k)?.label ?? k;
export const BUSINESS: Record<string, string> = { parking: 'ที่จอดรถ', cafe: 'คาเฟ่', stay: 'ที่พัก' };

const isDay = (s?: string) => !!s && /^\d{4}-\d{2}-\d{2}$/.test(s);

/** Filters from the query string: default the last 30 days, all earned points. */
export function logFilters(sp: Record<string, string | undefined>) {
  const to = isDay(sp.to) ? sp.to! : todayBkk();
  const from = isDay(sp.from) ? sp.from! : addDays(to, -29);
  const k = sp.k === undefined ? 'earn' : ['', 'earn', 'spend', ...KINDS.map((x) => x.key)].includes(sp.k) ? sp.k : 'earn';
  const q = (sp.q ?? '').slice(0, 60);
  return { from: from <= to ? from : to, to, k, q };
}

export async function getLog(f: ReturnType<typeof logFilters>, limit = 1000) {
  const sb = db();
  const [rows, totals] = await Promise.all([
    sb.rpc('points_log', { p_from: f.from, p_to: f.to, p_kind: f.k || null, p_q: f.q || null, p_limit: limit }),
    sb.rpc('points_log_totals', { p_from: f.from, p_to: f.to, p_q: f.q || null }),
  ]);
  if (rows.error) throw new Error(rows.error.message);
  return { rows: (rows.data ?? []) as LogRow[], totals: ((totals.data ?? []) as LogTotal[]).map((t) => ({ ...t, entries: Number(t.entries), points: Number(t.points) })) };
}

/** Where the points came from, in one line. */
export function detail(r: LogRow): string {
  const parts: string[] = [];
  if (r.business && r.kind !== 'admin_add') parts.push(BUSINESS[r.business] ?? r.business);
  if (r.amount) parts.push(`${r.amount.toLocaleString('th-TH')} บาท`);
  if (r.booking_code) parts.push(`การจอง ${r.booking_code}`);
  return parts.join(' · ');
}

/** Who made the change: the staff member, the customer (redeem / booking discount), or the system. */
export const byWho = (r: LogRow) => r.by_name ?? (r.kind === 'redeem' || r.kind === 'booking' ? 'ลูกค้า' : 'ระบบ');
