/**
 * Late-night arrival / early-morning return rule (shuttle customers only, they are the ones who give times):
 *  - arriving at 22:00 or later on the first day  -> the first day is charged at half price
 *  - back BY 02:00 (landing time) on the return day -> the return day is charged at half price
 * Shared by the booking form (price preview) and the bookings API (what is stored). The database only
 * trusts the number the API passes (bookings.half_days, passed as p_free_days).
 */
export const LATE_ARRIVAL_FROM = '22:00';
export const EARLY_RETURN_BY = '02:00';

type In = { shuttle: boolean; start: string; end: string; outboundTime?: string | null; returnLanding?: string | null };

/** times are 'YYYY-MM-DDTHH:mm' (Bangkok time). count = number of half-price days (0..2, never more than the days booked) */
export function halfPriceDays({ shuttle, start, end, outboundTime, returnLanding }: In): { arrival: boolean; ret: boolean; count: number } {
  if (!shuttle || !start || !end || end < start) return { arrival: false, ret: false, count: 0 };
  const arrival = !!outboundTime && outboundTime.slice(0, 10) === start && outboundTime.slice(11, 16) >= LATE_ARRIVAL_FROM;
  const ret = !!returnLanding && returnLanding.slice(0, 10) === end && returnLanding.slice(11, 16) <= EARLY_RETURN_BY;
  const days = Math.round((Date.parse(`${end}T00:00:00Z`) - Date.parse(`${start}T00:00:00Z`)) / 86400000) + 1;
  return { arrival, ret, count: Math.min(days, (arrival ? 1 : 0) + (ret ? 1 : 0)) };
}

/** parking for one car: full days at the day price, half-price days at half of it (rounded to the baht, same as the database) */
export const parkingAmount = (days: number, halfDays: number, pricePerDay: number) => {
  const half = Math.min(Math.max(halfDays, 0), Math.max(days, 0));
  return (Math.max(days, 0) - half) * pricePerDay + half * Math.round(pricePerDay / 2);
};
