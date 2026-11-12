'use server';
import { revalidatePath } from 'next/cache';
import { redirect } from 'next/navigation';
import { db } from '@/lib/supabase';
import { staffForAction } from '@/lib/auth';
import { sendCarSafeCard, type SafeResult } from '@/lib/carSafe';
import type { Role } from '@/lib/session';
import { afterConfirmed } from '@/lib/confirm';
import { bkkLocalToIso } from '@/lib/request';
import { thDate } from '@/lib/format';

export type ActionResult = { ok?: string; error?: string } | null;

const ERR: Record<string, string> = {
  not_allowed: 'บัญชีนี้ดูได้อย่างเดียว แก้ไขรายการนี้ไม่ได้ (ถ้าควรแก้ได้ ลองออกจากระบบแล้วเข้าใหม่)',
  not_found: 'ไม่พบข้อมูล อาจถูกลบหรือเปลี่ยนไปแล้ว',
  plate_taken: 'ทะเบียนนี้มีอยู่ในระบบแล้ว',
  last_vehicle: 'ต้องมีรถที่ใช้งานอยู่อย่างน้อย 1 คัน',
  invalid_range: 'วันออกต้องไม่ก่อนวันเข้า',
  invalid_pax: 'จำนวนผู้โดยสารต้องอยู่ระหว่าง 1–7 คน',
  bad_status_change: 'เปลี่ยนสถานะแบบนี้ไม่ได้',
  bad_status: 'ทำรายการนี้ได้เฉพาะการจองที่ยืนยันแล้วหรือรถอยู่ในลาน',
  payment_not_pending: 'ไม่มียอดค้างชำระ',
  invalid_days: 'จำนวนวันต้องอยู่ระหว่าง 1–60',
  vehicle_busy: 'รถคันนี้มีเที่ยวอื่นในช่วงเวลาใกล้กัน',
  not_enough_points: 'แต้มของลูกค้าไม่พอให้หัก',
  invalid_points: 'จำนวนแต้มไม่ถูกต้อง หรือยังไม่ได้ใส่เหตุผล',
  invalid_phone: 'เบอร์โทรไม่ถูกต้อง (ต้องขึ้นต้นด้วย 0 และมี 9–10 หลัก)',
  points_over_limit: 'เกินจำนวนแต้มที่หัวหน้าหน้างานให้ได้ต่อครั้ง ให้แอดมินเป็นคนให้',
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
  too_much_luggage: 'กระเป๋าเกินกว่าที่รถคันนี้ใส่ได้ เลือกรถคันที่ใหญ่กว่า',
  invalid_plate: 'ทะเบียนไม่ถูกต้อง (2–12 ตัวอักษร)',
  plate_exists: 'ทะเบียนนี้อยู่ในรายการแล้ว',
  invalid_grace_hour: 'ชั่วโมงต้องอยู่ระหว่าง 18–23',
  not_in_lot: 'รถคันนี้ไม่ได้อยู่ในลานแล้ว',
  invalid_exit_minutes: 'เวลาออกจากโถงต้องอยู่ระหว่าง 0–180 นาที',
  invalid_presets: 'ข้อความสำเร็จรูปมีได้ไม่เกิน 12 ข้อความ ข้อความละไม่เกิน 200 ตัวอักษร',
  invalid_bags: 'จำนวนกระเป๋าต้องอยู่ระหว่าง 0–20 ใบ',
  invalid_vehicle: 'ข้อมูลรถไม่ถูกต้อง (ชื่อ ที่นั่ง 1–30 ความจุกระเป๋า 0–60 หน่วย ไม่เกิน 30 ใบ ลำดับ 1–9)',
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
  if (msg.startsWith('vehicle_has_trips:')) return `รถคันนี้ยังมีงานรับส่งที่ยังไม่เสร็จ ${msg.split(':')[1]} งาน ย้ายงานไปคันอื่นในหน้ารถรับส่งก่อน แล้วค่อยลบ`;
  if (msg.startsWith('seats_too_few:')) return `ลดที่นั่งไม่ได้ มีงานที่จัดให้คันนี้ไว้แล้ว ${msg.split(':')[1]} คน ย้ายงานนั้นก่อน หรือใส่ที่นั่งอย่างน้อย ${msg.split(':')[1]}`;
  return ERR[msg] ?? 'ทำรายการไม่สำเร็จ ลองใหม่อีกครั้ง';
}

/** Run a database function as the signed-in admin; actor id is always taken from the session. */
async function run(fn: string, args: Record<string, unknown>, okText: string, paths: string[], roles: Role[] = ['admin']): Promise<ActionResult> {
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

export async function setDispatch(_: ActionResult, f: FormData): Promise<ActionResult> {
  return run('admin_set_dispatch', { p_drive: num(f, 'drive'), p_wait: num(f, 'wait'), p_slack: num(f, 'slack'), p_freeze: num(f, 'freeze') },
    'บันทึกการจัดรถแล้ว', ['/admin/settings']);
}

export async function setExitMinutes(_: ActionResult, f: FormData): Promise<ActionResult> {
  return run('admin_set_exit_minutes', { p_domestic: num(f, 'domestic'), p_international: num(f, 'international') },
    'บันทึกเวลาออกจากโถงแล้ว มีผลกับการจองใหม่', ['/admin/settings']);
}

export async function setNotePresets(_: ActionResult, f: FormData): Promise<ActionResult> {
  const presets = f.getAll('preset').map((v) => String(v).trim()).filter(Boolean);
  return run('admin_set_note_presets', { p_presets: presets }, 'บันทึกข้อความสำเร็จรูปแล้ว', ['/admin/settings', '/driver']);
}

export async function grantBlackDiamond(_: ActionResult, f: FormData): Promise<ActionResult> {
  return run('admin_bd_grant', { p_customer: str(f, 'customer_id'), p_note: str(f, 'note') }, 'มอบบัตร Black Diamond ให้สมาชิกแล้ว · เพิ่มป้ายทะเบียนของสมาชิกได้เลย', ['/admin/members/black-diamond', '/admin/members'], ['admin']);
}
export async function setBlackDiamondActive(_: ActionResult, f: FormData): Promise<ActionResult> {
  const on = str(f, 'active') === '1';
  return run('admin_bd_set_active', { p_customer: str(f, 'customer_id'), p_active: on }, on ? 'เปิดสิทธิ์แล้ว' : 'พักสิทธิ์แล้ว', ['/admin/members/black-diamond', '/admin/members'], ['admin']);
}
export async function revokeBlackDiamond(_: ActionResult, f: FormData): Promise<ActionResult> {
  return run('admin_bd_revoke', { p_customer: str(f, 'customer_id') }, 'ยกเลิกบัตรและลบป้ายทะเบียนของสมาชิกแล้ว', ['/admin/members/black-diamond', '/admin/members'], ['admin']);
}
export async function addVipPlate(_: ActionResult, f: FormData): Promise<ActionResult> {
  return run('admin_bd_add_plate', { p_customer: str(f, 'customer_id'), p_plate: str(f, 'plate'), p_province: str(f, 'province') }, 'เพิ่มป้ายทะเบียนแล้ว', ['/admin/members/black-diamond'], ['admin']);
}
export async function removeVipPlate(_: ActionResult, f: FormData): Promise<ActionResult> {
  return run('admin_vip_remove', { p_id: str(f, 'id') }, 'ลบป้ายทะเบียนแล้ว', ['/admin/members/black-diamond']);
}
export async function setLateGraceHour(_: ActionResult, f: FormData): Promise<ActionResult> {
  return run('admin_set_late_grace_hour', { p_hour: num(f, 'hour') }, 'บันทึกเวลาแล้ว', ['/admin/settings', '/ops', '/ops/lot']);
}

/** Guard marks a car as found in the lot: sends the "your car is safe" card (once per booking per day). */
export async function markCarFound(bookingId: string): Promise<{ result?: SafeResult; error?: string }> {
  let actor: string;
  try { actor = (await staffForAction(['admin', 'ops'])).uid; } catch { return { error: ERR.not_allowed }; }
  try { return { result: await sendCarSafeCard(actor, bookingId) }; }
  catch (e) { return { error: thai((e as Error).message) }; }
}

export async function rotateTvLink(_: ActionResult): Promise<ActionResult> {
  return run('admin_rotate_tv_token', {}, 'สร้างลิงก์จอ TV ใหม่แล้ว ลิงก์เก่าใช้ไม่ได้ทันที', ['/admin/settings']);
}

export async function setTripBags(_: ActionResult, f: FormData): Promise<ActionResult> {
  return run('admin_set_trip_bags', { p_trip_id: str(f, 'id'), p_large: num(f, 'large_bags'), p_small: num(f, 'small_bags') },
    'บันทึกจำนวนกระเป๋าแล้ว', ['/admin/trips', '/admin', '/driver']);
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
  try { actor = (await staffForAction(['admin', 'ops'])).uid; } catch { return { error: ERR.not_allowed }; }
  const { data, error } = await db().rpc('admin_use_coupon', { p_actor: actor, p_code: str(f, 'code') });
  if (error) return { error: thai(error.message) };
  revalidatePath('/admin/members');
  revalidatePath('/ops/m');
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
    str(f, 'tier') ? 'กำหนดระดับให้ลูกค้าแล้ว' : 'กลับไปใช้ระดับตามยอดใช้จ่าย', [...(bid ? [`/admin/bookings/${bid}`] : []), '/admin/campaigns', '/admin/members']);
}

// 'YYYY-MM-DD' (start of day, or end of day for an end date) or 'YYYY-MM-DDTHH:MM', Bangkok time
const bkkInput = (v: string, endOfDay = false) => {
  if (!v) return null;
  const t = /^\d{4}-\d{2}-\d{2}$/.test(v) ? `${v}T${endOfDay ? '23:59:59' : '00:00:00'}` : `${v}:00`;
  return new Date(`${t}+07:00`).toISOString();
};

export async function saveCampaign(_: ActionResult, f: FormData): Promise<ActionResult> {
  return run('admin_save_campaign', {
    p_id: str(f, 'id') || null, p_name: str(f, 'name'), p_description: str(f, 'description'),
    p_business: str(f, 'business'), p_tiers: f.getAll('tiers').map(String), p_kind: str(f, 'kind'),
    p_multiplier: num(f, 'multiplier') || 1, p_bonus: num(f, 'bonus') || 0,
    p_starts: bkkInput(str(f, 'starts')), p_ends: bkkInput(str(f, 'ends'), true), p_active: f.get('active') === 'on',
    p_min_days: num(f, 'min_days') || 0, p_free_days: num(f, 'free_days') || 0, p_amount_off: num(f, 'amount_off') || 0,
    p_stackable: f.get('stackable') === 'on',
    p_stay_from: str(f, 'stay_from') || null, p_stay_to: str(f, 'stay_to') || null, p_percent_off: num(f, 'percent_off') || 0,
  }, 'บันทึกแคมเปญแล้ว', ['/admin/campaigns']);
}

export async function recordPurchase(_: ActionResult, f: FormData): Promise<ActionResult> {
  let actor: string;
  try { actor = (await staffForAction(['admin', 'ops'])).uid; } catch { return { error: ERR.not_allowed }; }
  const { data, error } = await db().rpc('admin_record_purchase', {
    p_actor: actor, p_who: str(f, 'who'), p_business: str(f, 'business'), p_amount: num(f, 'amount'), p_note: str(f, 'note'),
  });
  if (error) return { error: thai(error.message) };
  revalidatePath('/admin/campaigns'); revalidatePath('/ops/m');
  const r = (Array.isArray(data) ? data[0] : data) as { customer_name: string; points: number; tier: string };
  return { ok: `บันทึกแล้ว · ${r.customer_name} ได้ ${r.points} แต้ม (ระดับ ${r.tier})` };
}

export async function setMemberDiscountRules(_: ActionResult, f: FormData): Promise<ActionResult> {
  return run('admin_set_member_discount_rules', { p_min_days: num(f, 'min_days'), p_needs_shuttle: f.get('needs_shuttle') === 'on' },
    'บันทึกเงื่อนไขแล้ว', ['/admin/members']);
}

// ---------- on-site staff (ops) ----------
export async function opsSetStatus(_: ActionResult, f: FormData): Promise<ActionResult> {
  const id = str(f, 'id');
  const status = str(f, 'status');
  const labels: Record<string, string> = { checked_in: 'บันทึกรถเข้าแล้ว', checked_out: 'บันทึกรับรถแล้ว', confirmed: 'ย้อนกลับเป็นยังไม่เข้าแล้ว' };
  return run('admin_set_booking_status', { p_id: id, p_status: status }, labels[status] ?? 'บันทึกแล้ว',
    ['/ops', `/ops/b`, `/admin/bookings/${id}`, '/admin', '/admin/bookings'], ['admin', 'ops']);
}

export async function givePoints(_: ActionResult, f: FormData): Promise<ActionResult> {
  let actor: string;
  try { actor = (await staffForAction(['admin', 'ops'])).uid; } catch { return { error: ERR.not_allowed }; }
  const who = str(f, 'who');
  let customer = str(f, 'customer_id');
  if (!customer && who) {
    const digits = who.replace(/\D/g, '');
    const { data } = await db().from('customers').select('id, phone, member_no, created_at')
      .or(`member_no.eq.${who.toUpperCase().replace(/[^A-Z0-9]/g, '')}${digits.length >= 9 ? `,phone.ilike.%${digits.slice(-9)}` : ''}`)
      .order('created_at', { ascending: false }).limit(1);
    customer = data?.[0]?.id ?? '';
  }
  if (!customer) return { error: 'ไม่พบสมาชิกจากเบอร์หรือเลขสมาชิกนี้' };
  const pts = Math.trunc(num(f, 'points'));
  const { data, error } = await db().rpc('staff_give_points', { p_actor: actor, p_customer: customer, p_points: pts, p_note: str(f, 'note') });
  if (error) return { error: thai(error.message) };
  revalidatePath('/ops'); revalidatePath('/admin/members');
  return { ok: `${pts > 0 ? 'เพิ่ม' : 'หัก'} ${Math.abs(pts)} แต้มแล้ว · ลูกค้ามี ${data} แต้ม` };
}

export async function setContact(_: ActionResult, f: FormData): Promise<ActionResult> {
  return run('admin_set_contact', { p_phone: str(f, 'phone'), p_hours: str(f, 'hours') }, 'บันทึกเบอร์โทรและเวลาติดต่อแล้ว · มีผลกับทุกข้อความทันที', ['/admin/settings']);
}

// ---------- vehicles ----------
export async function saveVehicle(_: ActionResult, f: FormData): Promise<ActionResult> {
  const id = str(f, 'id') || null;
  return run('admin_save_vehicle', {
    p_id: id, p_name: str(f, 'name'), p_plate: str(f, 'plate'), p_model: str(f, 'model'), p_seats: num(f, 'seats'),
    p_active: f.get('active') === 'on', p_note: str(f, 'note'),
    // one number on screen: large bags; stored as units (2 per large bag) + max bags
    p_luggage_units: 2 * num(f, 'large_cap'), p_max_bags: num(f, 'large_cap'), p_priority: num(f, 'priority') || 1,
    p_reserve: f.get('reserve') === 'on',
  }, id ? 'บันทึกข้อมูลรถแล้ว' : 'เพิ่มรถแล้ว', ['/admin/settings', '/admin/trips', '/admin/users', '/driver']);
}

export async function deleteVehicle(_: ActionResult, f: FormData): Promise<ActionResult> {
  let actor: string;
  try { actor = (await staffForAction(['admin'])).uid; } catch { return { error: ERR.not_allowed }; }
  const { data, error } = await db().rpc('admin_delete_vehicle', { p_actor: actor, p_id: str(f, 'id') });
  if (error) return { error: thai(error.message) };
  ['/admin/settings', '/admin/trips', '/admin/users', '/driver'].forEach((p) => revalidatePath(p));
  return { ok: data === 'retired' ? 'ลบรถแล้ว (ประวัติงานเดิมของคันนี้ยังอยู่ในรายงาน)' : 'ลบรถแล้ว' };
}
