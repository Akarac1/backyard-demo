'use server';
import { revalidatePath } from 'next/cache';
import { redirect } from 'next/navigation';
import { db } from '@/lib/supabase';
import { staffForAction } from '@/lib/auth';
import { afterConfirmed } from '@/lib/confirm';
import { bkkLocalToIso } from '@/lib/request';
import { thDate } from '@/lib/format';

export type ActionResult = { ok?: string; error?: string } | null;

const ERR: Record<string, string> = {
  not_allowed: 'ไม่มีสิทธิ์ทำรายการนี้ ลองออกจากระบบแล้วเข้าใหม่',
  not_found: 'ไม่พบข้อมูล อาจถูกลบหรือเปลี่ยนไปแล้ว',
  invalid_range: 'วันออกต้องไม่ก่อนวันเข้า',
  invalid_pax: 'จำนวนผู้โดยสารต้องอยู่ระหว่าง 1–7 คน',
  bad_status_change: 'เปลี่ยนสถานะแบบนี้ไม่ได้',
  bad_status: 'ทำรายการนี้ได้เฉพาะการจองที่ยืนยันแล้วหรือรถอยู่ในลาน',
  payment_not_pending: 'ไม่มียอดค้างชำระ',
  invalid_days: 'จำนวนวันต้องอยู่ระหว่าง 1–60',
  vehicle_busy: 'รถคันนี้มีเที่ยวอื่นในช่วงเวลาใกล้กัน',
  not_enough_points: 'แต้มของลูกค้าไม่พอให้หัก',
  invalid_points: 'จำนวนแต้มไม่ถูกต้อง',
  invalid_reward: 'ข้อมูลของรางวัลไม่ครบ (ชื่อ แต้มที่ใช้ อายุคูปอง 1–1095 วัน และคูปองส่วนลดค่าจอดต้องมีมูลค่า)',
  invalid_tier: 'ข้อมูลระดับไม่ถูกต้อง (ระดับแรกต้องเริ่มที่ 0 บาท และตัวคูณ 0.1–10)',
  invalid_tier_order: 'ระดับที่สูงกว่าต้องใช้ยอดมากกว่าระดับก่อนหน้า',
  invalid_campaign: 'ข้อมูลแคมเปญไม่ครบ (แต้มคูณต้องมากกว่า 1, โบนัสอย่างน้อย 1 แต้ม, ส่วนลดวันฟรีต้องจองมากกว่าจำนวนวันฟรี, ส่วนลดเงินต้องกำหนดวันขั้นต่ำ, วันสิ้นสุดต้องหลังวันเริ่ม)',
  invalid_purchase: 'ยอดเงินไม่ถูกต้อง',
  member_not_found: 'ไม่พบสมาชิกจากเบอร์หรือเลขสมาชิกนี้',
  coupon_not_found: 'ไม่พบรหัสคูปองนี้',
  coupon_used: 'คูปองนี้ถูกใช้หรือยกเลิกไปแล้ว',
  coupon_expired: 'คูปองนี้หมดอายุแล้ว',
  coupon_parking: 'คูปองส่วนลดค่าจอดใช้ได้ในหน้าจองของลูกค้าเท่านั้น',
  landing_after_pickup: 'เวลาเครื่องลงต้องไม่ช้ากว่าเวลารับ',
  too_many_pax: 'ผู้โดยสารเกินจำนวนที่นั่งของรถคันนี้',
  invalid_settings: 'ค่าที่ตั้งไม่ถูกต้อง (ช่องสำรองต้องน้อยกว่าช่องทั้งหมด และเวลากันที่ 5–120 นาที)',
  weak_password: 'รหัสผ่านต้องยาวอย่างน้อย 10 ตัวอักษร',
  wrong_password: 'รหัสผ่านเดิมไม่ถูกต้อง',
  username_taken: 'ชื่อผู้ใช้นี้มีแล้ว',
  invalid_username: 'ชื่อผู้ใช้ใช้ได้เฉพาะ a-z 0-9 . _ - ยาว 3–32 ตัว',
  last_admin: 'ต้องมีแอดมินที่ใช้งานได้อย่างน้อย 1 คน',
};
function thai(msg: string): string {
  if (msg.startsWith('full:')) return `วันที่ ${thDate(msg.slice(5))} ที่จอดเต็มแล้ว (รวมช่องสำรอง)`;
  if (msg.startsWith('full_after_hold_expired:')) return `หมดเวลากันที่ และวันที่ ${thDate(msg.split(':')[1])} เต็มแล้ว`;
  return ERR[msg] ?? 'ทำรายการไม่สำเร็จ ลองใหม่อีกครั้ง';
}

/** Run a database function as the signed-in admin; actor id is always taken from the session. */
async function run(fn: string, args: Record<string, unknown>, okText: string, paths: string[], roles: ('admin' | 'exec' | 'driver')[] = ['admin']): Promise<ActionResult> {
  let actor: string;
  try { actor = (await staffForAction(roles)).uid; } catch { return { error: ERR.not_allowed }; }
  const { error } = await db().rpc(fn, { p_actor: actor, ...args });
  if (error) {
    if (!ERR[error.message] && !error.message.startsWith('full')) console.error(fn, error.message);
    return { error: thai(error.message) };
  }
  paths.forEach((p) => revalidatePath(p));
  return { ok: okText };
}

const str = (f: FormData, k: string) => String(f.get(k) ?? '').trim();
const num = (f: FormData, k: string) => Number(f.get(k));

// ---------- bookings ----------
export async function updateBooking(_: ActionResult, f: FormData): Promise<ActionResult> {
  const id = str(f, 'id');
  return run('admin_update_booking', {
    p_id: id, p_name: str(f, 'name'), p_phone: str(f, 'phone'), p_plate: str(f, 'plate'), p_province: str(f, 'province'),
    p_start: str(f, 'start'), p_end: str(f, 'end'), p_pax: f.get('pax') ? num(f, 'pax') : null, p_note: str(f, 'note'),
  }, 'บันทึกแล้ว', [`/admin/bookings/${id}`, '/admin', '/admin/bookings']);
}

export async function setStatus(_: ActionResult, f: FormData): Promise<ActionResult> {
  const id = str(f, 'id');
  const status = str(f, 'status');
  const labels: Record<string, string> = { checked_in: 'เช็กอินแล้ว', checked_out: 'เช็กเอาต์แล้ว', cancelled: 'ยกเลิกแล้ว', no_show: 'บันทึกว่าไม่มาตามนัดแล้ว', confirmed: 'ย้อนกลับเป็นยืนยันแล้ว' };
  return run('admin_set_booking_status', { p_id: id, p_status: status }, labels[status] ?? 'บันทึกแล้ว', [`/admin/bookings/${id}`, '/admin', '/admin/bookings', '/admin/trips']);
}

export async function markPaid(_: ActionResult, f: FormData): Promise<ActionResult> {
  const id = str(f, 'id');
  const r = await run('admin_mark_paid', { p_booking_id: id, p_method: str(f, 'method') || 'cash' }, 'บันทึกรับเงินและยืนยันการจองแล้ว', [`/admin/bookings/${id}`, '/admin', '/admin/bookings']);
  if (r?.ok) await afterConfirmed(id).catch((e) => console.error('afterConfirmed', e));
  return r;
}

export async function addExtraDays(_: ActionResult, f: FormData): Promise<ActionResult> {
  const id = str(f, 'id');
  return run('admin_add_extra_days', { p_booking_id: id, p_days: num(f, 'days'), p_paid: f.get('paid') === 'on' },
    'เพิ่มวันจอดแล้ว', [`/admin/bookings/${id}`, '/admin', '/exec']);
}

export async function confirmSlip(_: ActionResult, f: FormData): Promise<ActionResult> {
  const pid = str(f, 'payment_id');
  let actor: string;
  try { actor = (await staffForAction(['admin'])).uid; } catch { return { error: ERR.not_allowed }; }
  const { data, error } = await db().rpc('admin_confirm_slip', { p_actor: actor, p_payment_id: pid });
  if (error) return { error: thai(error.message) };
  const bookingId = (data as { id: string } | null)?.id;
  if (bookingId) await afterConfirmed(bookingId).catch((e) => console.error('afterConfirmed', e));
  revalidatePath('/admin'); revalidatePath('/admin/bookings');
  return { ok: 'ยืนยันรับเงินแล้ว' };
}

export async function lprDone(_: ActionResult, f: FormData): Promise<ActionResult> {
  return run('admin_lpr_done', { p_id: num(f, 'id') }, 'บันทึกแล้ว', ['/admin']);
}

// ---------- trips ----------
export async function updateTrip(_: ActionResult, f: FormData): Promise<ActionResult> {
  const vehicle = str(f, 'vehicle_id');
  const time = str(f, 'pickup_at');
  const landing = str(f, 'landing_at');
  return run('admin_update_trip', {
    p_trip_id: str(f, 'id'), p_vehicle_id: vehicle || null, p_pickup_at: time ? bkkLocalToIso(time) : null,
    p_landing_at: landing ? bkkLocalToIso(landing) : null,
  }, 'บันทึกเที่ยวรถแล้ว', ['/admin/trips', '/admin']);
}

export async function autoAssign(_: ActionResult, f: FormData): Promise<ActionResult> {
  try { await staffForAction(['admin']); } catch { return { error: ERR.not_allowed }; }
  const { data, error } = await db().rpc('assign_vehicle', { p_trip_id: str(f, 'id') });
  if (error) return { error: error.message === 'no_pickup_time' ? 'ยังไม่มีเวลารับ' : thai(error.message) };
  revalidatePath('/admin/trips'); revalidatePath('/admin');
  return data ? { ok: 'จัดรถให้แล้ว' } : { error: 'ไม่มีรถว่างในช่วงเวลานี้ ลองเลือกรถหรือเปลี่ยนเวลาเอง' };
}

// ---------- settings ----------
export async function updateSettings(_: ActionResult, f: FormData): Promise<ActionResult> {
  return run('admin_update_settings', {
    p_total: num(f, 'total_spots'), p_reserve: num(f, 'reserve_spots'), p_price: num(f, 'price_per_day'),
    p_extra: num(f, 'extra_price_per_day'), p_shuttle: num(f, 'shuttle_price'), p_hold: num(f, 'hold_minutes'),
    p_reschedule_days: num(f, 'reschedule_min_days'), p_meeting: str(f, 'pickup_meeting_point'),
  }, 'บันทึกการตั้งค่าแล้ว', ['/admin/settings', '/admin']);
}

// ---------- staff ----------
export async function createStaff(_: ActionResult, f: FormData): Promise<ActionResult> {
  let actor: string;
  try { actor = (await staffForAction(['admin'])).uid; } catch { return { error: ERR.not_allowed }; }
  const { data: newId, error } = await db().rpc('staff_create', {
    p_username: str(f, 'username'), p_name: str(f, 'name'), p_role: str(f, 'role'), p_password: String(f.get('password') ?? ''), p_actor: actor,
  });
  if (error) return { error: thai(error.message) };
  if (str(f, 'phone')) await db().rpc('staff_set_phone', { p_actor: actor, p_id: newId, p_phone: str(f, 'phone') });
  revalidatePath('/admin/users');
  return { ok: 'เพิ่มผู้ใช้แล้ว' };
}

export async function updateStaff(_: ActionResult, f: FormData): Promise<ActionResult> {
  const r = await run('staff_update', {
    p_id: str(f, 'id'), p_name: str(f, 'name'), p_role: str(f, 'role'), p_active: f.get('active') === 'on',
    p_new_password: String(f.get('password') ?? '') || null,
  }, 'บันทึกแล้ว', ['/admin/users']);
  if (r?.error) return r;
  return run('staff_set_phone', { p_id: str(f, 'id'), p_phone: str(f, 'phone') }, 'บันทึกแล้ว', ['/admin/users']);
}

export async function ackTripNote(_: ActionResult, f: FormData): Promise<ActionResult> {
  return run('admin_ack_trip_note', { p_trip_id: str(f, 'id') }, 'รับทราบแล้ว', ['/admin', '/admin/trips']);
}

export async function changeOwnPassword(_: ActionResult, f: FormData): Promise<ActionResult> {
  if (String(f.get('new')) !== String(f.get('confirm'))) return { error: 'รหัสผ่านใหม่ทั้งสองช่องไม่ตรงกัน' };
  return run('staff_change_own_password', { p_old: String(f.get('old') ?? ''), p_new: String(f.get('new') ?? '') },
    'เปลี่ยนรหัสผ่านแล้ว', ['/account'], ['admin', 'exec', 'driver']);
}

// ---------- search ----------
export async function quickSearch(f: FormData) {
  const q = str(f, 'q');
  redirect(q ? `/admin/bookings?q=${encodeURIComponent(q)}` : '/admin/bookings');
}

// ---------- returning customers / referral discount ----------
export async function importMembers(_: ActionResult, f: FormData): Promise<ActionResult> {
  let actor: string;
  try { actor = (await staffForAction(['admin'])).uid; } catch { return { error: ERR.not_allowed }; }
  const lines = String(f.get('lines') ?? '').slice(0, 200_000);
  if (!lines.trim()) return { error: 'วางเบอร์โทรอย่างน้อย 1 บรรทัด' };
  const { data, error } = await db().rpc('admin_import_members', { p_actor: actor, p_lines: lines });
  if (error) return { error: thai(error.message) };
  revalidatePath('/admin/members');
  const total = lines.split(/\r?\n/).filter((l) => l.trim()).length;
  return { ok: `เพิ่มใหม่ ${data} เบอร์ จาก ${total} บรรทัด (เบอร์ที่มีอยู่แล้วหรือรูปแบบผิดจะถูกข้าม)` };
}

export async function removeMember(_: ActionResult, f: FormData): Promise<ActionResult> {
  return run('admin_remove_member', { p_phone: str(f, 'phone') }, 'ลบเบอร์แล้ว', ['/admin/members']);
}

export async function setMemberDiscount(_: ActionResult, f: FormData): Promise<ActionResult> {
  return run('admin_set_member_discount', { p_amount: num(f, 'amount') }, 'บันทึกส่วนลดแล้ว', ['/admin/members']);
}

// ---------- points ----------
export async function adjustPoints(_: ActionResult, f: FormData): Promise<ActionResult> {
  const pts = Math.trunc(num(f, 'points'));
  const bid = str(f, 'booking_id');
  return run('admin_adjust_points', { p_customer: str(f, 'customer_id'), p_points: pts, p_note: str(f, 'note') },
    pts > 0 ? `เพิ่ม ${pts} แต้มแล้ว` : `หัก ${-pts} แต้มแล้ว`, [`/admin/bookings/${bid}`, '/admin/members']);
}

export async function setPointsSettings(_: ActionResult, f: FormData): Promise<ActionResult> {
  return run('admin_set_points_settings', {
    p_enabled: f.get('enabled') === 'on', p_per_baht: num(f, 'per_baht'), p_value: num(f, 'value'),
    p_referral: num(f, 'referral'), p_months: num(f, 'months'),
  }, 'บันทึกกติกาแต้มแล้ว', ['/admin/members']);
}

// ---------- rewards & coupons ----------
export async function saveReward(_: ActionResult, f: FormData): Promise<ActionResult> {
  const stock = str(f, 'stock');
  return run('admin_save_reward', {
    p_id: str(f, 'id') || null, p_title: str(f, 'title'), p_description: str(f, 'description'),
    p_business: str(f, 'business'), p_kind: str(f, 'kind'), p_value: num(f, 'value') || 0,
    p_cost: num(f, 'cost'), p_valid_days: num(f, 'valid_days'), p_stock: stock === '' ? null : Number(stock),
    p_active: f.get('active') === 'on', p_sort: num(f, 'sort') || 0,
  }, 'บันทึกของรางวัลแล้ว', ['/admin/members']);
}

export async function takeCoupon(_: ActionResult, f: FormData): Promise<ActionResult> {
  let actor: string;
  try { actor = (await staffForAction(['admin'])).uid; } catch { return { error: ERR.not_allowed }; }
  const { data, error } = await db().rpc('admin_use_coupon', { p_actor: actor, p_code: str(f, 'code') });
  if (error) return { error: thai(error.message) };
  revalidatePath('/admin/members');
  const c = data as { code: string; title: string };
  return { ok: `ใช้คูปอง ${c.code} “${c.title}” แล้ว` };
}

export async function cancelCoupon(_: ActionResult, f: FormData): Promise<ActionResult> {
  return run('admin_cancel_coupon', { p_code: str(f, 'code') }, 'ยกเลิกคูปองและคืนแต้มแล้ว', ['/admin/members']);
}

// ---------- tiers & campaigns ----------
export async function saveTier(_: ActionResult, f: FormData): Promise<ActionResult> {
  return run('admin_save_tier', { p_code: str(f, 'code'), p_name: str(f, 'name'), p_min: num(f, 'min'), p_mult: num(f, 'mult') },
    'บันทึกระดับแล้ว', ['/admin/campaigns']);
}

export async function setTierOverride(_: ActionResult, f: FormData): Promise<ActionResult> {
  const bid = str(f, 'booking_id');
  return run('admin_set_tier_override', { p_customer: str(f, 'customer_id'), p_tier: str(f, 'tier') },
    str(f, 'tier') ? 'กำหนดระดับให้ลูกค้าแล้ว' : 'กลับไปใช้ระดับตามยอดใช้จ่าย', [`/admin/bookings/${bid}`, '/admin/campaigns']);
}

const bkkInput = (v: string) => (v ? new Date(`${v}:00+07:00`).toISOString() : null);

export async function saveCampaign(_: ActionResult, f: FormData): Promise<ActionResult> {
  return run('admin_save_campaign', {
    p_id: str(f, 'id') || null, p_name: str(f, 'name'), p_description: str(f, 'description'),
    p_business: str(f, 'business'), p_tiers: f.getAll('tiers').map(String), p_kind: str(f, 'kind'),
    p_multiplier: num(f, 'multiplier') || 1, p_bonus: num(f, 'bonus') || 0,
    p_starts: bkkInput(str(f, 'starts')), p_ends: bkkInput(str(f, 'ends')), p_active: f.get('active') === 'on',
    p_min_days: num(f, 'min_days') || 0, p_free_days: num(f, 'free_days') || 0, p_amount_off: num(f, 'amount_off') || 0,
    p_stackable: f.get('stackable') === 'on',
    p_stay_from: str(f, 'stay_from') || null, p_stay_to: str(f, 'stay_to') || null, p_percent_off: num(f, 'percent_off') || 0,
  }, 'บันทึกแคมเปญแล้ว', ['/admin/campaigns']);
}

export async function recordPurchase(_: ActionResult, f: FormData): Promise<ActionResult> {
  let actor: string;
  try { actor = (await staffForAction(['admin'])).uid; } catch { return { error: ERR.not_allowed }; }
  const { data, error } = await db().rpc('admin_record_purchase', {
    p_actor: actor, p_who: str(f, 'who'), p_business: str(f, 'business'), p_amount: num(f, 'amount'), p_note: str(f, 'note'),
  });
  if (error) return { error: thai(error.message) };
  revalidatePath('/admin/campaigns');
  const r = (Array.isArray(data) ? data[0] : data) as { customer_name: string; points: number; tier: string };
  return { ok: `บันทึกแล้ว · ${r.customer_name} ได้ ${r.points} แต้ม (ระดับ ${r.tier})` };
}

export async function setMemberDiscountRules(_: ActionResult, f: FormData): Promise<ActionResult> {
  return run('admin_set_member_discount_rules', { p_min_days: num(f, 'min_days'), p_needs_shuttle: f.get('needs_shuttle') === 'on' },
    'บันทึกเงื่อนไขแล้ว', ['/admin/members']);
}
