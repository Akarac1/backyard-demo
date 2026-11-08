import Link from 'next/link';
import { db } from '@/lib/supabase';
import { requireStaff } from '@/lib/auth';
import { addDays, bkkDay, thDate, thTime, todayBkk } from '@/lib/format';
import { NoteForm, StepForm } from './StepForm';

export const dynamic = 'force-dynamic';

type Trip = {
  id: string; direction: 'to_airport' | 'from_airport'; pax: number; pickup_at: string | null; flight_number: string | null; status: string;
  drop_door: string | null; departed_at: string | null; arrived_at: string | null; completed_at: string | null; driver_note: string | null;
  vehicle_id: string | null; vehicles: { name: string } | null;
  bookings: { code: string; plate: string; plate_province: string; customers: { name: string; phone: string; line_user_id: string } | null } | null;
};

const STEPS = {
  to_airport: [
    { key: 'arrived', label: 'พร้อมรับที่ลาน', col: 'arrived_at' },
    { key: 'en_route', label: 'ออกเดินทาง', col: 'departed_at' },
    { key: 'done', label: 'ส่งถึงสนามบิน', col: 'completed_at' },
  ],
  from_airport: [
    { key: 'en_route', label: 'ออกไปรับ', col: 'departed_at' },
    { key: 'arrived', label: 'ถึงจุดนัดรับ', col: 'arrived_at' },
    { key: 'done', label: 'ส่งถึงลาน', col: 'completed_at' },
  ],
} as const;

export default async function DriverPage({ searchParams }: { searchParams: Promise<{ d?: string; v?: string }> }) {
  const me = await requireStaff(['admin', 'driver']);
  const sp = await searchParams;
  const today = todayBkk();
  const day = sp.d === 'tomorrow' ? addDays(today, 1) : today;
  const sb = db();
  const [{ data: meRow }, { data: vehicles }, { data: st }] = await Promise.all([
    sb.from('staff_users').select('vehicle_id').eq('id', me.uid).single(),
    sb.from('vehicles').select('id, name').eq('active', true).order('seats'),
    sb.from('settings').select('pickup_meeting_point').eq('id', 1).single(),
  ]);
  const vehicleId = me.role === 'driver' ? meRow?.vehicle_id : sp.v || null;
  const myVehicle = vehicles?.find((v) => v.id === vehicleId);

  let q = sb.from('shuttle_trips')
    .select('id, direction, pax, pickup_at, flight_number, status, drop_door, departed_at, arrived_at, completed_at, driver_note, vehicle_id, vehicles(name), bookings(code, plate, plate_province, customers(name, phone, line_user_id))')
    .gte('pickup_at', `${day}T00:00:00+07:00`).lt('pickup_at', `${addDays(day, 1)}T00:00:00+07:00`)
    .neq('status', 'cancelled').order('pickup_at');
  if (vehicleId) q = q.eq('vehicle_id', vehicleId);
  const { data } = me.role === 'driver' && !vehicleId ? { data: [] } : await q;
  const trips = (data ?? []) as unknown as Trip[];
  const open = trips.filter((t) => t.status !== 'done');
  const done = trips.filter((t) => t.status === 'done');
  const href = (d: string | undefined, v: string | undefined) => {
    const u = new URLSearchParams();
    if (d) u.set('d', d);
    if (v) u.set('v', v);
    return `/driver${u.size ? `?${u}` : ''}`;
  };

  const card = (t: Trip) => {
    const steps = STEPS[t.direction].map((s) => ({ key: s.key, label: s.label, at: t[s.col] ? thTime(t[s.col]) : null }));
    const next = steps.find((s) => !s.at)?.key ?? null;
    const c = t.bookings?.customers;
    const hasLine = !!c?.line_user_id && !c.line_user_id.startsWith('demo-');
    const to = t.direction === 'to_airport';
    return (
      <section key={t.id} className={`panel job ${t.status === 'done' ? 'job-done' : ''}`}>
        <div className="job-top">
          <time>{t.pickup_at ? thTime(t.pickup_at) : '—'}</time>
          <div>
            <b>{to ? 'ส่งไปสนามบิน' : 'รับกลับจากสนามบิน'} · {t.pax} คน</b>
            <small>{to ? `รับที่ลาน → ส่งชั้น 4 ขาออก${t.drop_door ? ` ประตู ${t.drop_door}` : ''}` : `รับที่${st?.pickup_meeting_point ?? 'ชั้น 2 ประตู 4'} → ลาน`}</small>
          </div>
          {me.role === 'admin' && <span className="st st-ok">{t.vehicles?.name ?? 'ยังไม่มีรถ'}</span>}
        </div>
        <div className="job-who">
          <div><b>{c?.name}</b><small>{t.bookings?.plate} {t.bookings?.plate_province} · {t.bookings?.code}{t.flight_number ? ` · ไฟลต์ ${t.flight_number}` : ''}</small></div>
          <a className="b b-primary call" href={`tel:${c?.phone}`}>โทร</a>
        </div>
        {t.driver_note && <p className="note">หมายเหตุล่าสุด: {t.driver_note}</p>}
        <StepForm tripId={t.id} direction={t.direction} steps={steps} next={next} hasLine={hasLine} />
        <NoteForm tripId={t.id} hasLine={hasLine} />
      </section>
    );
  };

  return (
    <main className="page narrow driver-page">
      <header className="page-head">
        <div>
          <h1>งานรับส่ง</h1>
          <p>{thDate(day)} · {myVehicle ? myVehicle.name : me.role === 'admin' ? 'ทุกคัน' : 'ยังไม่ได้ผูกรถ'} · เหลือ {open.length} งาน</p>
        </div>
      </header>
      <nav className="seg">
        <Link href={href(undefined, sp.v)} className={day === today ? 'on' : ''}>วันนี้</Link>
        <Link href={href('tomorrow', sp.v)} className={day !== today ? 'on' : ''}>พรุ่งนี้</Link>
        {me.role === 'admin' && <>
          <span className="seg-gap" />
          <Link href={href(sp.d, undefined)} className={!sp.v ? 'on' : ''}>ทุกคัน</Link>
          {(vehicles ?? []).map((v) => <Link key={v.id} href={href(sp.d, v.id)} className={sp.v === v.id ? 'on' : ''}>{v.name}</Link>)}
        </>}
      </nav>

      {me.role === 'driver' && !vehicleId && <section className="panel"><p className="empty">บัญชีนี้ยังไม่ได้ผูกกับรถ ให้แอดมินเลือกรถให้ที่เมนู “ผู้ใช้”</p></section>}
      {(vehicleId || me.role === 'admin') && !trips.length && <section className="panel"><p className="empty">ไม่มีงาน{day === today ? 'วันนี้' : 'พรุ่งนี้'}</p></section>}
      {/* one keyed list, so a card keeps its message when it moves to "done" */}
      {[...open.map(card), ...(done.length ? [<h2 key="done-head" className="sec">เสร็จแล้ว ({done.length})</h2>] : []), ...done.map(card)]}
      <p className="hint" style={{ textAlign: 'center' }}>{thDate(bkkDay(new Date().toISOString()))} · ดึงหน้าลงเพื่อรีเฟรช</p>
    </main>
  );
}
