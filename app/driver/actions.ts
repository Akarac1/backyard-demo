'use server';
import { revalidatePath } from 'next/cache';
import { db } from '@/lib/supabase';
import { staffForAction } from '@/lib/auth';
import { noteMessage, sendToCustomer, statusMessage, tripContext, welcomeMessage, type TripStep } from '@/lib/tripMessages';
import type { ActionResult } from '@/app/admin/actions';

const ERR: Record<string, string> = {
  not_allowed: 'ไม่มีสิทธิ์ ลองออกจากระบบแล้วเข้าใหม่',
  not_found: 'ไม่พบงานนี้',
  bad_status: 'สถานะไม่ถูกต้อง',
  trip_cancelled: 'งานนี้ถูกยกเลิกแล้ว',
  empty_note: 'พิมพ์ข้อความก่อนส่ง',
  not_return_trip: 'ใช้ได้กับรถรับขากลับเท่านั้น',
  trip_closed: 'งานนี้เสร็จหรือถูกยกเลิกแล้ว',
};
const LABEL: Record<string, Record<string, string>> = {
  to_airport: { arrived: 'บันทึกว่าพร้อมรับที่ลาน', en_route: 'บันทึกว่าออกเดินทางไปสนามบิน', done: 'บันทึกว่าส่งถึงสนามบินแล้ว' },
  from_airport: { en_route: 'บันทึกว่ากำลังไปรับ', arrived: 'บันทึกว่าถึงจุดนัดรับ', done: 'บันทึกว่าส่งถึงลานแล้ว' },
};
const SENT: Record<string, string> = { sent: 'ส่งข้อความหาลูกค้าแล้ว', no_line: 'ลูกค้าไม่ได้จองผ่าน LINE ไม่ได้ส่งข้อความ', failed: 'ส่งข้อความไม่สำเร็จ โทรแจ้งลูกค้าแทน' };

export async function setTripStatus(_: ActionResult, f: FormData): Promise<ActionResult> {
  let me;
  try { me = await staffForAction(['driver', 'admin', 'ops']); } catch { return { error: ERR.not_allowed }; }
  const tripId = String(f.get('id'));
  const step = String(f.get('status')) as TripStep;
  const { error } = await db().rpc('driver_set_trip_status', { p_actor: me.uid, p_trip_id: tripId, p_status: step, p_takeover: f.get('takeover') === 'on' });
  if (error) {
    if (error.message.startsWith('taken_by:')) return { error: `${error.message.slice(9)} ดูแลงานนี้อยู่ ถ้าจะขับแทน ให้ติ๊ก “รับงานแทน” แล้วกดอีกครั้ง` };
    return { error: ERR[error.message] ?? 'บันทึกไม่สำเร็จ ลองใหม่อีกครั้ง' };
  }

  let label = LABEL[String(f.get('direction'))]?.[step] ?? 'บันทึกแล้ว';
  // dropped at the airport: the system may have given this vehicle a return customer waiting there
  if (step === 'done' && f.get('direction') === 'to_airport') {
    const { data: me2 } = await db().from('shuttle_trips').select('vehicle_id').eq('id', tripId).single();
    if (me2?.vehicle_id) {
      const { data: next } = await db().from('shuttle_trips')
        .select('pax, large_bags, called_at, pickup_at, bookings(code, customers(name))')
        .eq('vehicle_id', me2.vehicle_id).eq('direction', 'from_airport').eq('status', 'assigned')
        .gte('dispatched_at', new Date(Date.now() - 120_000).toISOString()).limit(1).maybeSingle();
      const n = next as unknown as { pax: number; large_bags: number; called_at: string | null; pickup_at: string | null; bookings: { code: string; customers: { name: string } | null } | null } | null;
      if (n) {
        const when = n.called_at ? 'ลูกค้าเรียกรถแล้ว' : `ลูกค้าน่าจะพร้อม ${new Date(n.pickup_at ?? Date.now()).toLocaleTimeString('th-TH', { hour: '2-digit', minute: '2-digit', timeZone: 'Asia/Bangkok' })} น.`;
        label += ` · 🛬 มีงานรับกลับต่อ: ${n.bookings?.customers?.name ?? ''} (${n.bookings?.code ?? ''}) ${n.pax} คน${n.large_bags ? ` กระเป๋าใหญ่ ${n.large_bags}` : ''} · ${when} รอที่สนามบินได้เลย`;
      }
    }
  }
  let result: ActionResult = { ok: label };
  if (f.get('notify') === 'on') {
    const ctx = await tripContext(tripId, me.uid, me.name);
    if (ctx) {
      const r = await sendToCustomer(ctx, statusMessage(ctx, step));
      if (r === 'sent') {
        const { data: ev } = await db().rpc('trip_last_event', { p_trip_id: tripId });
        if (ev) await db().rpc('trip_event_notified', { p_event_id: ev });
      }
      // a failed message is shown in red so the driver calls the customer instead
      result = r === 'failed' ? { error: `${label} แต่${SENT.failed}` } : { ok: `${label} · ${SENT[r]}` };
    }
  }
  revalidatePath('/driver'); revalidatePath('/admin/trips'); revalidatePath('/admin');
  return result;
}

export async function addTripNote(_: ActionResult, f: FormData): Promise<ActionResult> {
  let me;
  try { me = await staffForAction(['driver', 'admin', 'ops']); } catch { return { error: ERR.not_allowed }; }
  const tripId = String(f.get('id'));
  const note = String(f.get('note') ?? '').trim();
  const { data: evId, error } = await db().rpc('driver_add_note', { p_actor: me.uid, p_trip_id: tripId, p_note: note });
  if (error) return { error: ERR[error.message] ?? 'บันทึกไม่สำเร็จ ลองใหม่อีกครั้ง' };

  let result: ActionResult = { ok: 'บันทึกหมายเหตุและแจ้งแอดมินแล้ว' };
  if (f.get('notify') === 'on') {
    const ctx = await tripContext(tripId, me.uid, me.name);
    if (ctx) {
      const r = await sendToCustomer(ctx, noteMessage(ctx, note));
      if (r === 'sent' && evId) await db().rpc('trip_event_notified', { p_event_id: evId });
      result = r === 'failed' ? { error: `แจ้งแอดมินแล้ว แต่${SENT.failed}` } : { ok: `บันทึกหมายเหตุและแจ้งแอดมินแล้ว · ${SENT[r]}` };
    }
  }
  revalidatePath('/driver'); revalidatePath('/admin/trips'); revalidatePath('/admin');
  return result;
}

export async function sendWelcome(_: ActionResult, f: FormData): Promise<ActionResult> {
  let me;
  try { me = await staffForAction(['driver', 'admin', 'ops']); } catch { return { error: ERR.not_allowed }; }
  const tripId = String(f.get('id'));
  const { error } = await db().rpc('staff_mark_welcome', { p_actor: me.uid, p_trip_id: tripId });
  if (error) return { error: ERR[error.message] ?? 'ส่งไม่สำเร็จ ลองใหม่อีกครั้ง' };
  const ctx = await tripContext(tripId, '', 'ทีมงาน Backyard');
  const r = ctx ? await sendToCustomer(ctx, welcomeMessage(ctx)) : 'failed';
  revalidatePath('/driver');
  return r === 'sent' ? { ok: 'ส่งข้อความต้อนรับแล้ว' } : { error: SENT[r] };
}

export async function recordCall(_: ActionResult, f: FormData): Promise<ActionResult> {
  let me;
  try { me = await staffForAction(['driver', 'admin', 'ops']); } catch { return { error: ERR.not_allowed }; }
  const { error } = await db().rpc('staff_call_trip', { p_actor: me.uid, p_trip_id: String(f.get('id')) });
  if (error) return { error: ERR[error.message] ?? 'บันทึกไม่สำเร็จ ลองใหม่อีกครั้ง' };
  revalidatePath('/driver'); revalidatePath('/admin');
  return { ok: 'บันทึกแล้ว ลูกค้าพร้อมให้ไปรับ' };
}
