import { tr, dayIn, type Lang } from './i18nDict';
const TH_MONTHS = ['ม.ค.', 'ก.พ.', 'มี.ค.', 'เม.ย.', 'พ.ค.', 'มิ.ย.', 'ก.ค.', 'ส.ค.', 'ก.ย.', 'ต.ค.', 'พ.ย.', 'ธ.ค.'];

/** '2026-11-20' -> '20 พ.ย.' */
export function thDate(iso: string): string {
  const [, m, d] = iso.slice(0, 10).split('-').map(Number);
  return `${d} ${TH_MONTHS[m - 1]}`;
}

/** timestamptz -> 'HH:MM' in Bangkok */
export function thTime(ts: string | null | undefined): string {
  if (!ts) return '-';
  return new Date(ts).toLocaleTimeString('th-TH', { timeZone: 'Asia/Bangkok', hour: '2-digit', minute: '2-digit' });
}

export function todayBkk(): string {
  return new Date().toLocaleDateString('en-CA', { timeZone: 'Asia/Bangkok' });
}

export function addDays(iso: string, n: number): string {
  const d = new Date(iso + 'T00:00:00Z');
  d.setUTCDate(d.getUTCDate() + n);
  return d.toISOString().slice(0, 10);
}

export const baht = (n: number) => `${n.toLocaleString('th-TH')} บาท`;

/** Postgres exception text from our functions -> message for the customer (Thai unless a language is given). */
export function dbErrorToThai(msg: string, lang: Lang = 'th'): string {
  if (msg.startsWith('full:')) return tr(lang, 'วันที่ {d} ที่จอดเต็มแล้ว ลองเลือกวันอื่น', { d: dayIn(lang, msg.slice(5)) });
  if (msg.startsWith('full_after_hold_expired:')) return tr(lang, 'หมดเวลากันที่ และวันที่ {d} เต็มแล้ว แอดมินจะติดต่อกลับ', { d: dayIn(lang, msg.split(':')[1]) });
  const map: Record<string, string> = {
    start_date_in_past: 'วันเข้าจอดต้องไม่ใช่วันที่ผ่านมาแล้ว',
    invalid_range: 'วันรับรถคืนต้องไม่ก่อนวันเข้าจอด',
    invalid_pax: 'รถรับส่งนั่งได้ 1–7 คน',
    already_rescheduled: 'การจองนี้ใช้สิทธิ์เลื่อนไปแล้ว',
    too_late: 'ต้องเลื่อนล่วงหน้าอย่างน้อย 7 วันก่อนวันเข้าจอด',
    beyond_one_year: 'วันใหม่ต้องไม่เกิน 1 ปีนับจากวันที่จอง',
    not_confirmed: 'การจองนี้ยังไม่ได้ยืนยัน',
    payment_not_pending: 'รายการนี้ชำระแล้ว',
    coupon_invalid: 'คูปองนี้ใช้ไม่ได้แล้ว (อาจหมดอายุหรือใช้ไปแล้ว) กด “แก้ไข” แล้วลองใหม่',
    not_enough_points: 'แต้มไม่พอสำหรับของรางวัลนี้',
    reward_closed: 'ของรางวัลนี้ปิดแลกแล้ว',
    out_of_stock: 'ของรางวัลนี้หมดแล้ว',
    not_found: 'ไม่พบของรางวัลนี้',
    trip_not_done: 'ให้คะแนนได้เมื่อการเดินทางเสร็จแล้ว',
    invalid_rating: 'กรุณาเลือกดาว 1–5 ดวง',
    rating_closed: 'เลยเวลาแก้ไขคะแนนแล้ว (แก้ได้ภายใน 7 วัน)',
  };
  return tr(lang, map[msg] ?? 'เกิดข้อผิดพลาด ลองใหม่อีกครั้ง');
}

/** timestamptz -> 'YYYY-MM-DD' in Bangkok (a UTC timestamp's date can be the day before) */
export function bkkDay(ts: string): string {
  return new Date(ts).toLocaleDateString('en-CA', { timeZone: 'Asia/Bangkok' });
}
