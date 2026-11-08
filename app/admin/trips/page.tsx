import Link from 'next/link';
import { db } from '@/lib/supabase';
import { addDays, thDate, thTime, todayBkk } from '@/lib/format';
import { DIRECTION } from '@/lib/labels';
import { ActionButton, ActionForm, Submit } from '@/components/ActionForm';
import { autoAssign, updateTrip } from '../actions';

export const dynamic = 'force-dynamic';

type Trip = {
  id: string; direction: string; pax: number; pickup_at: string | null; flight_number: string | null; status: string;
  vehicle_id: string | null; assignment_locked: boolean;
  bookings: { id: string; code: string; plate: string; status: string; customers: { name: string; phone: string } | null } | null;
};

/** 'YYYY-MM-DDTHH:MM' in Bangkok time, for <input type="datetime-local"> */
const localInput = (ts: string | null) => ts ? new Date(ts).toLocaleString('sv-SE', { timeZone: 'Asia/Bangkok' }).slice(0, 16).replace(' ', 'T') : '';

export default async function TripsPage({ searchParams }: { searchParams: Promise<{ d?: string }> }) {
  const { d } = await searchParams;
  const today = todayBkk();
  const day = d && /^\d{4}-\d{2}-\d{2}$/.test(d) ? d : today;
  const sb = db();
  const [{ data }, { data: vehicles }] = await Promise.all([
    sb.from('shuttle_trips')
      .select('id, direction, pax, pickup_at, flight_number, status, vehicle_id, assignment_locked, bookings(id, code, plate, status, customers(name, phone))')
      .gte('pickup_at', `${day}T00:00:00+07:00`).lt('pickup_at', `${addDays(day, 1)}T00:00:00+07:00`)
      .neq('status', 'cancelled').order('pickup_at'),
    sb.from('vehicles').select('id, name, seats').eq('active', true).order('seats'),
  ]);
  const trips = (data ?? []) as unknown as Trip[];
  const tabs = [0, 1, 2, 3, 4, 5, 6].map((i) => addDays(today, i));
  const label = (x: string, i: number) => (i === 0 ? 'วันนี้' : i === 1 ? 'พรุ่งนี้' : thDate(x));

  return (
    <main className="page">
      <header className="page-head">
        <div><h1>รถรับส่ง</h1><p>{thDate(day)} · {trips.length} เที่ยว · ยังไม่มีรถ {trips.filter((t) => !t.vehicle_id).length} เที่ยว</p></div>
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
                <b>{DIRECTION[t.direction]} · {t.pax} คน</b>
                <small><Link href={`/admin/bookings/${t.bookings?.id}`}>{t.bookings?.code}</Link> · {t.bookings?.customers?.name} · <a href={`tel:${t.bookings?.customers?.phone}`}>{t.bookings?.customers?.phone}</a>{t.flight_number ? ` · ไฟลต์ ${t.flight_number}` : ''}</small>
              </div>
            </div>
            <ActionForm action={updateTrip} className="form trip-form">
              <input type="hidden" name="id" value={t.id} />
              <label>รถ
                <select name="vehicle_id" defaultValue={t.vehicle_id ?? ''}>
                  <option value="">— ยังไม่เลือก —</option>
                  {(vehicles ?? []).map((v) => <option key={v.id} value={v.id} disabled={v.seats < t.pax}>{v.name} · {v.seats} ที่{v.seats < t.pax ? ' (ไม่พอ)' : ''}</option>)}
                </select>
              </label>
              <label>เวลารับ<input type="datetime-local" name="pickup_at" defaultValue={localInput(t.pickup_at)} /></label>
              <div className="form-actions"><Submit small>บันทึก</Submit></div>
            </ActionForm>
            <div className="trip-foot">
              {t.assignment_locked ? <span className="hint">เลือกรถเองแล้ว ระบบจะไม่ย้าย</span> : <span className="hint">ระบบจัดรถให้</span>}
              {!t.vehicle_id && <ActionButton action={autoAssign} fields={{ id: t.id }} label="จัดรถอัตโนมัติ" />}
            </div>
          </section>
        ))}
      </div>
    </main>
  );
}
