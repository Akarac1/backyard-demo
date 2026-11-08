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
  return run('admin_update_trip', {
    p_trip_id: str(f, 'id'), p_vehicle_id: vehicle || null, p_pickup_at: time ? bkkLocalToIso(time) : null,
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
  if (str(f, 'role') === 'driver' && str(f, 'vehicle_id')) {
    await db().rpc('staff_set_vehicle', { p_actor: actor, p_id: newId, p_vehicle_id: str(f, 'vehicle_id') });
  }
  revalidatePath('/admin/users');
  return { ok: 'เพิ่มผู้ใช้แล้ว' };
}

export async function updateStaff(_: ActionResult, f: FormData): Promise<ActionResult> {
  const r = await run('staff_update', {
    p_id: str(f, 'id'), p_name: str(f, 'name'), p_role: str(f, 'role'), p_active: f.get('active') === 'on',
    p_new_password: String(f.get('password') ?? '') || null,
  }, 'บันทึกแล้ว', ['/admin/users']);
  if (r?.error) return r;
  const vehicle = str(f, 'role') === 'driver' ? str(f, 'vehicle_id') || null : null;
  return run('staff_set_vehicle', { p_id: str(f, 'id'), p_vehicle_id: vehicle }, 'บันทึกแล้ว', ['/admin/users']);
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
