import 'server-only';
import { db } from '@/lib/supabase';

export type Grain = 'day' | 'week' | 'month' | 'year';

export type ReportRow = {
  bucket: string; bucket_end: string;
  revenue_total: number; revenue_parking: number; revenue_shuttle: number; revenue_extra: number;
  bookings_paid: number; cars_in: number; customers: number; new_customers: number;
  shuttle_bookings: number; shuttle_pax: number; car_days: number; occupancy_pct: number | null;
};

export const GRAINS: { key: Grain; label: string; current: string; periods: number; span: string }[] = [
  { key: 'day', label: 'รายวัน', current: 'วันนี้', periods: 30, span: '30 วันล่าสุด' },
  { key: 'week', label: 'รายสัปดาห์', current: 'สัปดาห์นี้', periods: 12, span: '12 สัปดาห์ล่าสุด' },
  { key: 'month', label: 'รายเดือน', current: 'เดือนนี้', periods: 12, span: '12 เดือนล่าสุด' },
  { key: 'year', label: 'รายปี', current: 'ปีนี้', periods: 5, span: '5 ปีล่าสุด' },
];

export function grainOf(p: string | undefined): (typeof GRAINS)[number] {
  return GRAINS.find((g) => g.key === p) ?? GRAINS[0];
}

export async function getReport(grain: Grain, periods: number): Promise<ReportRow[]> {
  const { data, error } = await db().rpc('exec_report', { p_grain: grain, p_periods: periods });
  if (error) throw new Error(error.message);
  // bigint/numeric may arrive as strings
  return (data as Record<string, unknown>[]).map((r) => {
    const o: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(r)) o[k] = k === 'bucket' || k === 'bucket_end' ? v : v === null ? null : Number(v);
    return o as ReportRow;
  });
}

const M = ['ม.ค.', 'ก.พ.', 'มี.ค.', 'เม.ย.', 'พ.ค.', 'มิ.ย.', 'ก.ค.', 'ส.ค.', 'ก.ย.', 'ต.ค.', 'พ.ย.', 'ธ.ค.'];
const parts = (iso: string) => iso.slice(0, 10).split('-').map(Number);

/** Short axis label for a bucket. Years are shown in the Thai calendar (พ.ศ.). */
export function bucketLabel(grain: Grain, start: string, end: string): string {
  const [y, m, d] = parts(start);
  const [, m2, d2] = parts(end);
  if (grain === 'day') return `${d} ${M[m - 1]}`;
  if (grain === 'week') return m === m2 ? `${d}–${d2} ${M[m - 1]}` : `${d} ${M[m - 1]}–${d2} ${M[m2 - 1]}`;
  if (grain === 'month') return `${M[m - 1]} ${String(y + 543).slice(2)}`;
  return `${y + 543}`;
}

export type ShuttleRow = {
  bucket: string; bucket_end: string; trips: number; trips_to: number; trips_from: number; pax: number;
  avg_wait_min: number | null; late_over_15: number; called_trips: number; peak_in_hour: number; busy_hours: number; vehicles: number;
};
export type DriverRow = { driver: string; trips: number; trips_to: number; trips_from: number; pax: number; avg_wait_min: number | null; late_over_15: number };

const nums = <T,>(rows: Record<string, unknown>[], keep: string[]): T[] =>
  rows.map((r) => Object.fromEntries(Object.entries(r).map(([k, v]) => [k, keep.includes(k) || v === null ? v : Number(v)])) as T);

export async function getShuttleReport(grain: Grain, periods: number): Promise<ShuttleRow[]> {
  const { data, error } = await db().rpc('shuttle_report', { p_grain: grain, p_periods: periods });
  if (error) throw new Error(error.message);
  return nums<ShuttleRow>(data as Record<string, unknown>[], ['bucket', 'bucket_end']);
}

export async function getDriverStats(from: string, to: string): Promise<DriverRow[]> {
  const { data, error } = await db().rpc('shuttle_driver_stats', { p_from: from, p_to: to });
  if (error) throw new Error(error.message);
  return nums<DriverRow>(data as Record<string, unknown>[], ['driver']);
}
