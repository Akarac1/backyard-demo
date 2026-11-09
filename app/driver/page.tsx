import Link from 'next/link';
import { db } from '@/lib/supabase';
import { requireStaff } from '@/lib/auth';
import { addDays, bkkDay, thDate, thTime, todayBkk } from '@/lib/format';
import { AutoRefresh, CallTools, Countdown, NoteForm, StepForm } from './StepForm';

export const dynamic = 'force-dynamic';

const bags = (t: { large_bags: number; small_bags: number }) =>
  t.large_bags + t.small_bags ? ` · กระเป๋า${t.large_bags ? ` ใหญ่ ${t.large_bags}` : ''}${t.small_bags ? ` เล็ก ${t.small_bags}` : ''}` : '';

type Trip = {
  id: string; direction: 'to_airport' | 'from_airport'; pax: number; large_bags: number; small_bags: number; pickup_at: string | null; flight_number: string | null; status: string;
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

export default async function DriverPage({ searchParams }: { searchParams: Promise<{ d?: string; v?: string; view?: string }> }) {
  const me = await requireStaff(['admin', 'driver', 'ops', 'exec']);
  const sp = await searchParams;
  const today = todayBkk();
  const day = sp.d === 'tomorrow' ? addDays(today, 1) : sp.d === 'yesterday' ? addDays(today, -1) : sp.d && /^\d{4}-\d{2}-\d{2}$/.test(sp.d) ? sp.d : today;
  const showDone = sp.view === 'done';
  const sb = db();
  const [{ data: vehicles }, { data: st }] = await Promise.all([
    sb.from('vehicles').select('id, name').eq('active', true).order('seats'),
    sb.from('settings').select('pickup_meeting_point').eq('id', 1).single(),
  ]);
  const vehicleId = sp.v || null;
  const myVehicle = vehicles?.find((v) => v.id === vehicleId);

  let q = sb.from('shuttle_trips')
    .select('id, direction, pax, large_bags, small_bags, pickup_at, flight_number, status, drop_door, departed_at, arrived_at, completed_at, driver_note, vehicle_id, driver_staff_id, landing_at, welcome_sent_at, called_at, called_by, vehicles(name), driver:staff_users!shuttle_trips_driver_staff_id_fkey(display_name), bookings(code, plate, plate_province, customers(name, phone, line_user_id))')
    .gte('pickup_at', `${day}T00:00:00+07:00`).lt('pickup_at', `${addDays(day, 1)}T00:00:00+07:00`)
    .neq('status', 'cancelled').order('pickup_at');
  if (vehicleId) q = q.eq('vehicle_id', vehicleId);
  const { data } = await q;
  const trips = (data ?? []) as unknown as Trip[];
  // customers who called and nobody is on the way yet come first
  const open = trips.filter((t) => t.status !== 'done').sort((a, b) => Number(waiting(b)) - Number(waiting(a)));
  const urgent = open.filter(waiting).length;
  const done = trips.filter((t) => t.status === 'done');
  // a just-finished job stays on the to-do list for 3 minutes so the driver sees the result message
  const recent = done.filter((t) => t.completed_at && Date.now() - Date.parse(t.completed_at) < 3 * 60_000);
  const href = (d: string | undefined, v: string | undefined, view = sp.view) => {
    const u = new URLSearchParams();
    if (d) u.set('d', d);
    if (v) u.set('v', v);
    if (view) u.set('view', view);
    return `/driver${u.size ? `?${u}` : ''}`;
  };
  const doneRow = (t: Trip) => {
    const c = t.bookings?.customers;
    return (
      <li key={t.id}>
        <time>{t.pickup_at ? thTime(t.pickup_at) : '—'}</time>
        <div>
          <b>{t.direction === 'to_airport' ? 'ส่งสนามบิน' : 'รับกลับ'} · {c?.name} · {t.pax} คน{bags(t)}</b>
          <small>{t.driver?.display_name ?? 'ไม่ระบุคนขับ'} · {t.vehicles?.name ?? '-'}{t.called_at && t.arrived_at ? ` · ลูกค้ารอ ${Math.max(0, Math.round((Date.parse(t.arrived_at) - Date.parse(t.called_at)) / 60_000))} นาที` : ''}</small>
        </div>
        <span className="st st-done">เสร็จ {t.completed_at ? thTime(t.completed_at) : ''}</span>
      </li>
    );
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
            <b>{to ? 'ส่งไปสนามบิน' : 'รับกลับจากสนามบิน'} · {t.pax} คน{bags(t)}</b>
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
      <nav className="seg view-tabs">
        <Link href={href(sp.d === 'yesterday' ? undefined : sp.d, sp.v, '')} className={!showDone ? 'on' : ''}>งานที่ต้องทำ ({open.length})</Link>
        <Link href={href(sp.d === 'tomorrow' ? undefined : sp.d, sp.v, 'done')} className={showDone ? 'on' : ''}>เสร็จแล้ว ({done.length})</Link>
      </nav>
      <nav className="seg">
        {showDone
          ? <>
              <Link href={href('yesterday', sp.v)} className={day === addDays(today, -1) ? 'on' : ''}>เมื่อวาน</Link>
              <Link href={href(undefined, sp.v)} className={day === today ? 'on' : ''}>วันนี้</Link>
              <form action="/driver" className="day-pick"><input type="hidden" name="view" value="done" />{sp.v && <input type="hidden" name="v" value={sp.v} />}<input type="date" name="d" defaultValue={day} max={today} aria-label="เลือกวัน" /><button className="b b-plain b-sm">ดู</button></form>
            </>
          : <>
              <Link href={href(undefined, sp.v)} className={day === today ? 'on' : ''}>วันนี้</Link>
              <Link href={href('tomorrow', sp.v)} className={day === addDays(today, 1) ? 'on' : ''}>พรุ่งนี้</Link>
            </>}
        {<>
          <span className="seg-gap" />
          <Link href={href(sp.d, undefined)} className={!sp.v ? 'on' : ''}>ทุกคัน</Link>
          {(vehicles ?? []).map((v) => <Link key={v.id} href={href(sp.d, v.id)} className={sp.v === v.id ? 'on' : ''}>{v.name}</Link>)}
        </>}
      </nav>

      {!showDone && <>
        {!open.length && !recent.length && <section className="panel"><p className="empty">{done.length ? `งาน${thDate(day)}เสร็จครบแล้ว ${done.length} งาน` : 'ไม่มีงาน'}</p></section>}
        {/* one keyed list, so a card keeps its message for a moment after it is finished */}
        {[...open.map(card), ...recent.map(card)]}
      </>}
      {showDone && (
        <section className="panel">
          <h2>งานที่เสร็จแล้ว · {thDate(day)} <span className="count soft">{done.length}</span></h2>
          {!done.length && <p className="empty">ยังไม่มีงานที่เสร็จ</p>}
          <ul className="done-list">{done.map(doneRow)}</ul>
          {done.length > 0 && <p className="hint">ผู้โดยสารรวม {done.reduce((a, t) => a + t.pax, 0)} คน · ขาไป {done.filter((t) => t.direction === 'to_airport').length} · ขากลับ {done.filter((t) => t.direction === 'from_airport').length}</p>}
        </section>
      )}
      <p className="hint" style={{ textAlign: 'center' }}>{thDate(bkkDay(new Date().toISOString()))} · ดึงหน้าลงเพื่อรีเฟรช</p>
    </main>
  );
}
