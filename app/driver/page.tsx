import Link from 'next/link';
import { db } from '@/lib/supabase';
import { requireStaff } from '@/lib/auth';
import { addDays, bkkDay, thDate, thTime, todayBkk } from '@/lib/format';
import { AutoRefresh, CallTools, Countdown, NoteForm, StepForm } from './StepForm';

export const dynamic = 'force-dynamic';

type Trip = {
  id: string; direction: 'to_airport' | 'from_airport'; pax: number; pickup_at: string | null; flight_number: string | null; status: string;
  drop_door: string | null; departed_at: string | null; arrived_at: string | null; completed_at: string | null; driver_note: string | null;
  vehicle_id: string | null; driver_staff_id: string | null;
  landing_at: string | null; welcome_sent_at: string | null; called_at: string | null; called_by: string | null; vehicles: { name: string } | null; driver: { display_name: string } | null;
  bookings: { code: string; plate: string; plate_province: string; customers: { name: string; phone: string; line_user_id: string } | null } | null;
};

// label = button, preview = title of the card the customer gets
const STEPS = {
  to_airport: [
    { key: 'arrived', label: 'พร้อมรับที่ลาน', col: 'arrived_at', preview: 'รถรับส่งพร้อมแล้ว' },
    { key: 'en_route', label: 'ออกเดินทาง', col: 'departed_at', preview: 'กำลังไปสนามบิน' },
    { key: 'done', label: 'ส่งถึงสนามบิน', col: 'completed_at', preview: 'ถึงสนามบินเรียบร้อย + นัดรับวันกลับ' },
  ],
  from_airport: [
    { key: 'en_route', label: 'ออกไปรับ', col: 'departed_at', preview: 'คนขับออกไปรับแล้ว' },
    { key: 'arrived', label: 'ถึงจุดนัดรับ', col: 'arrived_at', preview: 'รถถึงจุดนัดรับแล้ว' },
    { key: 'done', label: 'ส่งถึงลาน', col: 'completed_at', preview: 'ยินดีต้อนรับกลับ' },
  ],
} as const;
const waiting = (t: { direction: string; called_at: string | null; status: string }) =>
  t.direction === 'from_airport' && !!t.called_at && !['en_route', 'arrived', 'done'].includes(t.status);

export default async function DriverPage({ searchParams }: { searchParams: Promise<{ d?: string; v?: string }> }) {
  const me = await requireStaff(['admin', 'driver']);
  const sp = await searchParams;
  const today = todayBkk();
  const day = sp.d === 'tomorrow' ? addDays(today, 1) : today;
  const sb = db();
  const [{ data: vehicles }, { data: st }] = await Promise.all([
    sb.from('vehicles').select('id, name').eq('active', true).order('seats'),
    sb.from('settings').select('pickup_meeting_point').eq('id', 1).single(),
  ]);
  const vehicleId = sp.v || null;
  const myVehicle = vehicles?.find((v) => v.id === vehicleId);

  let q = sb.from('shuttle_trips')
    .select('id, direction, pax, pickup_at, flight_number, status, drop_door, departed_at, arrived_at, completed_at, driver_note, vehicle_id, driver_staff_id, landing_at, welcome_sent_at, called_at, called_by, vehicles(name), driver:staff_users!shuttle_trips_driver_staff_id_fkey(display_name), bookings(code, plate, plate_province, customers(name, phone, line_user_id))')
    .gte('pickup_at', `${day}T00:00:00+07:00`).lt('pickup_at', `${addDays(day, 1)}T00:00:00+07:00`)
    .neq('status', 'cancelled').order('pickup_at');
  if (vehicleId) q = q.eq('vehicle_id', vehicleId);
  const { data } = await q;
  const trips = (data ?? []) as unknown as Trip[];
  // customers who called and nobody is on the way yet come first
  const open = trips.filter((t) => t.status !== 'done').sort((a, b) => Number(waiting(b)) - Number(waiting(a)));
  const urgent = open.filter(waiting).length;
  const done = trips.filter((t) => t.status === 'done');
  const href = (d: string | undefined, v: string | undefined) => {
    const u = new URLSearchParams();
    if (d) u.set('d', d);
    if (v) u.set('v', v);
    return `/driver${u.size ? `?${u}` : ''}`;
  };

  const card = (t: Trip) => {
    const steps = STEPS[t.direction].map((s) => ({
      key: s.key, at: t[s.col] ? thTime(t[s.col]) : null,
      label: t.direction === 'from_airport' && s.key === 'en_route' && t.called_at ? 'รับทราบ · กำลังไป' : s.label,
      preview: t.direction === 'from_airport' && s.key === 'en_route' && t.called_at ? 'คนขับรับทราบแล้ว (ถึงในประมาณ 15 นาที)' : s.preview,
    }));
    const next = steps.find((s) => !s.at)?.key ?? null;
    const c = t.bookings?.customers;
    const hasLine = !!c?.line_user_id && !c.line_user_id.startsWith('demo-');
    const to = t.direction === 'to_airport';
    return (
      <section key={t.id} className={`panel job ${t.status === 'done' ? 'job-done' : ''} ${waiting(t) ? 'job-urgent' : ''}`}>
        {waiting(t) && t.called_at && (
          <div className="call-alert">
            <span>ลูกค้าเรียกรถแล้ว {thTime(t.called_at)} {t.called_by === 'staff' ? '(โทรมา)' : ''} · ควรถึงจุดนัด {thTime(new Date(Date.parse(t.called_at) + 15 * 60_000).toISOString())}</span>
            <Countdown deadline={new Date(Date.parse(t.called_at) + 15 * 60_000).toISOString()} />
          </div>
        )}
        <div className="job-top">
          <time>{t.pickup_at ? thTime(t.pickup_at) : '—'}</time>
          <div>
            <b>{to ? 'ส่งไปสนามบิน' : 'รับกลับจากสนามบิน'} · {t.pax} คน</b>
            <small>{to ? `รับที่ลาน → ส่งชั้น 4 ขาออก${t.drop_door ? ` ประตู ${t.drop_door}` : ''}` : `รับที่${st?.pickup_meeting_point ?? 'ชั้น 2 ประตู 4'} → ลาน`}</small>
          </div>
          <span className="st st-ok">{t.vehicles?.name ?? 'ยังไม่จัดรถ'}</span>
        </div>
        <div className="job-who">
          <div><b>{c?.name}</b><small>{t.bookings?.plate} {t.bookings?.plate_province} · {t.bookings?.code}{t.flight_number ? ` · ไฟลต์ ${t.flight_number}` : ''}</small></div>
          <a className="b b-primary call" href={`tel:${c?.phone}`}>โทร</a>
        </div>
        {!to && t.status !== 'done' && !waiting(t) && !['en_route', 'arrived'].includes(t.status) && (
          <div className="call-wait">
            <span>{t.welcome_sent_at
              ? `รอลูกค้ากดเรียกรถ · ส่งข้อความต้อนรับแล้ว ${thTime(t.welcome_sent_at)}`
              : `ระบบจะส่งข้อความต้อนรับเวลา ${thTime(t.landing_at ?? (t.pickup_at ? new Date(Date.parse(t.pickup_at) - 45 * 60_000).toISOString() : null))}${t.landing_at ? ' (เครื่องลง)' : ''}`}</span>
            <CallTools tripId={t.id} hasLine={hasLine} welcomed={!!t.welcome_sent_at} called={!!t.called_at} customer={c?.name ?? 'ลูกค้า'} />
          </div>
        )}
        {t.driver && <p className={`handler ${t.driver_staff_id === me.uid ? 'mine' : ''}`}>{t.driver_staff_id === me.uid ? 'งานของคุณ' : `คนขับ: ${t.driver.display_name}`}</p>}
        {t.driver_note && <p className="note">หมายเหตุล่าสุด: {t.driver_note}</p>}
        <StepForm tripId={t.id} direction={t.direction} steps={steps} next={next} hasLine={hasLine} customer={`${c?.name ?? 'ลูกค้า'} · ${t.pax} คน`}
          takenBy={me.role === 'driver' && t.driver_staff_id && t.driver_staff_id !== me.uid ? t.driver?.display_name ?? 'คนขับอื่น' : null} />
        <NoteForm tripId={t.id} hasLine={hasLine} customer={c?.name ?? 'ลูกค้า'} />
      </section>
    );
  };

  return (
    <main className="page narrow driver-page">
      <AutoRefresh urgent={urgent} />
      <header className="page-head">
        <div>
          <h1>งานรับส่ง</h1>
          <p>{thDate(day)} · {myVehicle ? myVehicle.name : 'ทุกคัน'} · เหลือ {open.length} งาน{urgent ? ` · ลูกค้าเรียกรถ ${urgent} งาน` : ''} · อัปเดตเองทุก 30 วินาที</p>
        </div>
      </header>
      <nav className="seg">
        <Link href={href(undefined, sp.v)} className={day === today ? 'on' : ''}>วันนี้</Link>
        <Link href={href('tomorrow', sp.v)} className={day !== today ? 'on' : ''}>พรุ่งนี้</Link>
        {<>
          <span className="seg-gap" />
          <Link href={href(sp.d, undefined)} className={!sp.v ? 'on' : ''}>ทุกคัน</Link>
          {(vehicles ?? []).map((v) => <Link key={v.id} href={href(sp.d, v.id)} className={sp.v === v.id ? 'on' : ''}>{v.name}</Link>)}
        </>}
      </nav>

      {!trips.length && <section className="panel"><p className="empty">ไม่มีงาน{day === today ? 'วันนี้' : 'พรุ่งนี้'}</p></section>}
      {/* one keyed list, so a card keeps its message when it moves to "done" */}
      {[...open.map(card), ...(done.length ? [<h2 key="done-head" className="sec">เสร็จแล้ว ({done.length})</h2>] : []), ...done.map(card)]}
      <p className="hint" style={{ textAlign: 'center' }}>{thDate(bkkDay(new Date().toISOString()))} · ดึงหน้าลงเพื่อรีเฟรช</p>
    </main>
  );
}
