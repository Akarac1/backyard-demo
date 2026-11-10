import Link from 'next/link';
import { db } from '@/lib/supabase';
import { addDays, thDate, thTime, todayBkk } from '@/lib/format';
import { DIRECTION } from '@/lib/labels';
import { ActionButton, ActionForm, Submit } from '@/components/ActionForm';
import { ackTripNote, autoAssign, setTripBags, updateTrip } from '../actions';

export const dynamic = 'force-dynamic';

type Trip = {
  id: string; direction: string; pax: number; large_bags: number; small_bags: number; pickup_at: string | null; flight_number: string | null; status: string;
  vehicle_id: string | null; assignment_locked: boolean;
  departed_at: string | null; arrived_at: string | null; completed_at: string | null; driver_note: string | null; note_resolved: boolean; called_at: string | null; welcome_sent_at: string | null; landing_at: string | null;
  bookings: { id: string; code: string; plate: string; status: string; customers: { name: string; phone: string } | null } | null;
};

/** 'YYYY-MM-DDTHH:MM' in Bangkok time, for <input type="datetime-local"> */
const TRIP_STATUS: Record<string, string> = { unassigned: 'ยังไม่มีรถ', assigned: 'จัดรถแล้ว', en_route: 'กำลังเดินทาง', arrived: 'ถึงจุดนัดแล้ว', picked_up: 'รับลูกค้าแล้ว', done: 'เสร็จแล้ว' };

type Veh = { id: string; name: string; seats: number; plate: string | null; luggage_units: number; max_bags: number; priority: number; reserve: boolean };
const fits = (v: Veh, t: { pax: number; large_bags: number; small_bags: number }) =>
  v.seats >= t.pax && 2 * t.large_bags + t.small_bags <= v.luggage_units && t.large_bags + t.small_bags <= v.max_bags;
const bagsText = (t: { large_bags: number }) => (t.large_bags ? `กระเป๋าใหญ่ ${t.large_bags} ใบ` : 'ไม่มีกระเป๋าใหญ่');

const localInput = (ts: string | null) => ts ? new Date(ts).toLocaleString('sv-SE', { timeZone: 'Asia/Bangkok' }).slice(0, 16).replace(' ', 'T') : '';

export default async function TripsPage({ searchParams }: { searchParams: Promise<{ d?: string }> }) {
  const { d } = await searchParams;
  const today = todayBkk();
  const day = d && /^\d{4}-\d{2}-\d{2}$/.test(d) ? d : today;
  const sb = db();
  const [{ data }, { data: vehicles }] = await Promise.all([
    sb.from('shuttle_trips')
      .select('id, direction, pax, large_bags, small_bags, pickup_at, flight_number, status, vehicle_id, assignment_locked, departed_at, arrived_at, completed_at, driver_note, note_resolved, called_at, welcome_sent_at, landing_at, bookings(id, code, plate, status, customers(name, phone))')
      .gte('pickup_at', `${day}T00:00:00+07:00`).lt('pickup_at', `${addDays(day, 1)}T00:00:00+07:00`)
      .neq('status', 'cancelled').order('pickup_at'),
    sb.from('vehicles').select('id, name, seats, plate, luggage_units, max_bags, priority, reserve').eq('active', true).is('deleted_at', null).order('reserve').order('priority').order('seats'),
  ]);
  const trips = (data ?? []) as unknown as Trip[];
  const tabs = [0, 1, 2, 3, 4, 5, 6].map((i) => addDays(today, i));
  const label = (x: string, i: number) => (i === 0 ? 'วันนี้' : i === 1 ? 'พรุ่งนี้' : thDate(x));

  return (
    <main className="page">
      <header className="page-head">
        <div><h1>รถรับส่ง</h1><p>{thDate(day)} · {trips.length} เที่ยว · ยังไม่มีรถ {trips.filter((t) => !t.vehicle_id && (t.direction === 'to_airport' || t.called_at)).length} เที่ยว · ขากลับจัดรถตอนลูกค้าเรียก (หรือให้รถที่อยู่สนามบินรับต่อ)</p></div>
        <form className="search" action="/admin/trips"><input type="date" name="d" defaultValue={day} aria-label="เลือกวัน" /><button className="b b-plain">ไปวันที่</button></form>
      </header>
      <nav className="seg" aria-label="เลือกวัน">
        {tabs.map((x, i) => <Link key={x} href={`/admin/trips?d=${x}`} className={x === day ? 'on' : ''}>{label(x, i)}</Link>)}
      </nav>

      {!trips.length && <section className="panel"><p className="empty">ไม่มีเที่ยวรถวันนี้</p></section>}
      <div className="trip-grid">
        {trips.map((t) => (
          <section key={t.id} className={`panel trip-card ${t.vehicle_id ? '' : 'warn'}`}>
            <div className="trip-top">
              <time>{thTime(t.pickup_at)}</time>
              <div>
                <b>{DIRECTION[t.direction]} · {t.pax} คน · {bagsText(t)}</b>
                <small><Link href={`/admin/bookings/${t.bookings?.id}`}>{t.bookings?.code}</Link> · {t.bookings?.customers?.name} · <a href={`tel:${t.bookings?.customers?.phone}`}>{t.bookings?.customers?.phone}</a>{t.flight_number ? ` · ไฟลต์ ${t.flight_number}` : ''}</small>
              </div>
            </div>
            <div className="trip-progress">
              <span className={`st ${t.status === 'done' ? 'st-done' : t.status === 'en_route' || t.status === 'arrived' ? 'st-in' : t.vehicle_id ? 'st-ok' : 'st-wait'}`}>{TRIP_STATUS[t.status] ?? t.status}</span>
              {t.welcome_sent_at ? <small>ส่งข้อความต้อนรับ {thTime(t.welcome_sent_at)}</small>
                : t.landing_at && t.status !== 'done' ? <small>จะส่งข้อความต้อนรับ {thTime(t.landing_at)}</small> : null}
              {t.called_at && <small><b>ลูกค้าเรียกรถ {thTime(t.called_at)}</b></small>}
              {t.departed_at && <small>ออกเดินทาง {thTime(t.departed_at)}</small>}
              {t.arrived_at && <small>ถึงจุดนัด {thTime(t.arrived_at)}</small>}
              {t.completed_at && <small>เสร็จ {thTime(t.completed_at)}</small>}
            </div>
            {t.driver_note && (
              <div className={`note trip-note ${t.note_resolved ? '' : 'open'}`}>
                <span>คนขับแจ้ง: {t.driver_note}</span>
                {!t.note_resolved && <ActionButton action={ackTripNote} fields={{ id: t.id }} label="รับทราบ" />}
              </div>
            )}
            <ActionForm action={updateTrip} className="form trip-form">
              <input type="hidden" name="id" value={t.id} />
              <label>รถ
                <select name="vehicle_id" defaultValue={t.vehicle_id ?? ''}>
                  <option value="">— ยังไม่เลือก —</option>
                  {((vehicles ?? []) as Veh[]).map((v) => {
                    const why = v.seats < t.pax ? 'ที่นั่งไม่พอ' : !fits(v, t) ? 'กระเป๋าไม่พอ' : '';
                    return <option key={v.id} value={v.id} disabled={!!why}>{v.name}{v.plate ? ` (${v.plate})` : ''} · {v.seats} ที่{v.reserve ? ' · สำรองฉุกเฉิน' : ''}{why ? ` (${why})` : ''}</option>;
                  })}
                </select>
              </label>
              {t.direction === 'from_airport' && (
                <label>เวลาเครื่องลง <small>(ส่งข้อความต้อนรับเวลานี้)</small><input type="datetime-local" name="landing_at" defaultValue={localInput(t.landing_at)} /></label>
              )}
              <label>เวลารับ{t.direction === 'from_airport' && <small> (แก้เวลาเครื่องลงอย่างเดียว เวลารับจะเลื่อนตาม)</small>}<input type="datetime-local" name="pickup_at" defaultValue={localInput(t.pickup_at)} /></label>
              <div className="form-actions"><Submit small>บันทึก</Submit></div>
            </ActionForm>
            <details className="trip-bags">
              <summary>แก้จำนวนกระเป๋า</summary>
              <ActionForm action={setTripBags} className="form trip-bags-form">
                <input type="hidden" name="id" value={t.id} />
                <label>กระเป๋าใบใหญ่ (24 นิ้วขึ้นไป)<input type="number" name="large_bags" min={0} max={20} defaultValue={t.large_bags} /></label>
                <input type="hidden" name="small_bags" value="0" />
                <div className="form-actions"><Submit small>บันทึก</Submit></div>
              </ActionForm>
            </details>
            <div className="trip-foot">
              {t.assignment_locked ? <span className="hint">เลือกรถเองแล้ว ระบบจะไม่ย้าย</span> : <span className="hint">ระบบจัดรถให้</span>}
              {!t.vehicle_id && (t.direction === 'to_airport' || t.called_at) && <ActionButton action={autoAssign} fields={{ id: t.id }} label="จัดรถอัตโนมัติ" />}
              {!t.vehicle_id && t.direction === 'from_airport' && !t.called_at && <small className="muted-note">จัดรถให้เองตอนลูกค้ากดเรียก · เลือกรถเองได้ถ้าต้องการล็อกไว้</small>}
            </div>
          </section>
        ))}
      </div>
    </main>
  );
}
