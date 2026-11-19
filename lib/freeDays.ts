/**
 * Late-night arrival / early-morning return rule (shuttle customers only, they are the ones who give times).
 * The admin sets it in Settings > Price (settings.late_night_*):
 *  - arriving from `arrivalFrom` on the first day  -> the first day is charged at `percent`% of the day price
 *  - back BY `returnBy` (landing time) on the return day -> the return day is charged at `percent`%
 * Shared by the booking form (price preview) and the bookings API (what is stored). The database only
 * trusts the number the API passes (bookings.half_days, passed as p_free_days) and reads the percent itself.
 */
export type LateNightRule = { enabled: boolean; arrivalFrom: string; returnBy: string; percent: number };
export const DEFAULT_LATE_NIGHT: LateNightRule = { enabled: true, arrivalFrom: '22:00', returnBy: '02:00', percent: 50 };

/** the rule from a settings row / the prices API (missing fields fall back to the defaults) */
export const lateNightRule = (s?: { late_night_enabled?: boolean | null; late_arrival_from?: string | null; early_return_by?: string | null; late_night_percent?: number | null } | null): LateNightRule => ({
  enabled: s?.late_night_enabled ?? DEFAULT_LATE_NIGHT.enabled,
  arrivalFrom: s?.late_arrival_from ?? DEFAULT_LATE_NIGHT.arrivalFrom,
  returnBy: s?.early_return_by ?? DEFAULT_LATE_NIGHT.returnBy,
  percent: s?.late_night_percent ?? DEFAULT_LATE_NIGHT.percent,
});

type In = { shuttle: boolean; start: string; end: string; outboundTime?: string | null; returnLanding?: string | null; rule?: LateNightRule };

/** times are 'YYYY-MM-DDTHH:mm' (Bangkok time). count = number of reduced-price days (0..2, never more than the days booked) */
export function halfPriceDays({ shuttle, start, end, outboundTime, returnLanding, rule = DEFAULT_LATE_NIGHT }: In): { arrival: boolean; ret: boolean; count: number } {
  if (!rule.enabled || rule.percent >= 100 || !shuttle || !start || !end || end < start) return { arrival: false, ret: false, count: 0 };
  const arrival = !!outboundTime && outboundTime.slice(0, 10) === start && outboundTime.slice(11, 16) >= rule.arrivalFrom;
  const ret = !!returnLanding && returnLanding.slice(0, 10) === end && returnLanding.slice(11, 16) <= rule.returnBy;
  const days = Math.round((Date.parse(`${end}T00:00:00Z`) - Date.parse(`${start}T00:00:00Z`)) / 86400000) + 1;
  return { arrival, ret, count: Math.min(days, (arrival ? 1 : 0) + (ret ? 1 : 0)) };
}

/** parking for one car: full days at the day price, reduced days at percent% of it (rounded to the baht, same as the database) */
export const parkingAmount = (days: number, halfDays: number, pricePerDay: number, percent = 50) => {
  const half = Math.min(Math.max(halfDays, 0), Math.max(days, 0));
  return (Math.max(days, 0) - half) * pricePerDay + half * Math.round((pricePerDay * percent) / 100);
};
