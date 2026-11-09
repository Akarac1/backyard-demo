import Link from 'next/link';
import { db } from '@/lib/supabase';
import { requireStaff } from '@/lib/auth';
import { addDays, bkkDay, thDate, thTime, todayBkk } from '@/lib/format';
import { DIRECTION, StatusTag } from '@/lib/labels';
import { ActionButton } from '@/components/ActionForm';
import { DensityChart, DensityLegend, type DensityRow } from '@/components/DensityChart';
import { ackTripNote, autoAssign, confirmSlip, lprDone, quickSearch, setStatus } from './actions';

export const dynamic = 'force-dynamic';

type Occ = { day: string; used: number; total_spots: number; reserve_spots: number };
type Row = { id: string; code: string; plate: string; plate_province: string; status: string; shuttle: boolean; pax: number | null; start_date: string; end_date: string; customers: { name: string; phone: string } | null };
type Trip = { id: string; direction: string; pax: number; pickup_at: string; flight_number: string | null; status: string; vehicles: { name: string } | null; bookings: { id: string; code: string; plate: string; customers: { name: string; phone: string } | null } | null };

const DAYS = ['อาทิตย์', 'จันทร์', 'อังคาร', 'พุธ', 'พฤหัสบดี', 'ศุกร์', 'เสาร์'];
const n = (v: number) => v.toLocaleString('th-TH');

const sb0 = () => db();

const isDay = (v?: string) => !!v && /^\d{4}-\d{2}-\d{2}$/.test(v);
const span = (a: string, b: string) => Math.round((Date.parse(b) - Date.parse(a)) / 864e5);

export default async function AdminHome({ searchParams }: { searchParams: Promise<Record<string, string | undefined>> }) {
  const staff = await requireStaff(['admin', 'ops', 'exec']);
  const canAct = staff.role === 'admin';
  // buttons on this page change data: admin only (the site lead does the same on the ops page; the executive views)
  const Act = (canAct ? ActionButton : () => null) as typeof ActionButton;
  const today = todayBkk();
  // density range: default the next 30 days, never more than 30 days
  const sp = await searchParams;
  let df = isDay(sp.df) ? sp.df! : today;
  let dt = isDay(sp.dt) ? sp.dt! : addDays(df, 29);
  if (dt < df) [df, dt] = [dt, df];
  if (span(df, dt) > 29) dt = addDays(df, 29);
  const sb = db();
  const sel = 'id, code, plate, plate_province, status, shuttle, pax, start_date, end_date, customers(name, phone)';
  const [{ count: lateIn }, { count: overOut }] = await Promise.all([
    sb0().from('bookings').select('id', { count: 'exact', head: true }).eq('status', 'confirmed').lt('start_date', today),
    sb0().from('bookings').select('id', { count: 'exact', head: true }).eq('status', 'checked_in').lt('end_date', today),
  ]);
  const { data: dens } = await sb.rpc('lot_density', { p_from: df, p_to: dt });
  const density = ((dens ?? []) as DensityRow[]);
  const [occ, arrivals, departures, inLot, slips, lpr, trips, paidToday, owed, notes, calls] = await Promise.all([
    sb.from('v_occupancy_30d').select('day, used, total_spots, reserve_spots').limit(14),
    sb.from('bookings').select(sel).eq('start_date', today).in('status', ['confirmed', 'checked_in']).order('created_at'),
    sb.from('bookings').select(sel).eq('end_date', today).in('status', ['confirmed', 'checked_in', 'checked_out']).order('created_at'),
    sb.from('bookings').select('id', { count: 'exact', head: true }).eq('status', 'checked_in'),
    sb.from('payments').select('id, amount, slip_path, created_at, bookings(id, code, plate)').eq('status', 'pending').eq('kind', 'booking').not('slip_path', 'is', null).order('created_at'),
    sb.from('lpr_sync').select('id, plate, plate_province, action, valid_from, valid_to').neq('status', 'done').order('created_at'),
    sb.from('shuttle_trips').select('id, direction, pax, pickup_at, flight_number, status, vehicles(name), bookings(id, code, plate, customers(name, phone))')
      .gte('pickup_at', `${today}T00:00:00+07:00`).lt('pickup_at', `${addDays(today, 2)}T00:00:00+07:00`).neq('status', 'cancelled').order('pickup_at'),
    sb.from('payments').select('amount').eq('status', 'verified').gte('paid_at', `${today}T00:00:00+07:00`),
    sb.from('payments').select('id, amount, bookings(id, code, plate)').eq('status', 'pending').eq('kind', 'overstay'),
    sb.from('shuttle_trips').select('id, direction, driver_note, note_at, vehicles(name), bookings(id, code)').eq('note_resolved', false).order('note_at'),
    sb.from('shuttle_trips').select('id, pax, called_at, called_by, bookings(id, code, customers(name, phone))').not('called_at', 'is', null).in('status', ['unassigned', 'assigned']).order('called_at'),
  ]);

  const days = (occ.data ?? []) as Occ[];
  const t0 = days[0];
  const total = t0?.total_spots ?? 60;
  const usedToday = t0?.used ?? 0;
  const arr = (arrivals.data ?? []) as unknown as Row[];
  const dep = (departures.data ?? []) as unknown as Row[];
  const tripRows = (trips.data ?? []) as unknown as Trip[];
  const unassigned = tripRows.filter((t) => !t.vehicles);
  const revenueToday = (paidToday.data ?? []).reduce((a, p) => a + p.amount, 0);

  const slipLinks: Record<string, string> = {};
  for (const p of slips.data ?? []) {
    const { data } = await sb.storage.from('slips').createSignedUrl(p.slip_path!, 3600);
    if (data) slipLinks[p.id] = data.signedUrl;
  }
  const todo = (slips.data?.length ?? 0) + (lpr.data?.length ?? 0) + unassigned.length + (owed.data?.length ?? 0) + (notes.data?.length ?? 0) + (calls.data?.length ?? 0);
  const d = new Date(today + 'T00:00:00Z');

  return (
    <main className="page">
      <header className="page-head">
        <div>
          <h1>สวัสดี {staff.name}</h1>
          <p>วัน{DAYS[d.getUTCDay()]}ที่ {thDate(today)} · {todo ? `มี ${todo} เรื่องรอจัดการ` : 'ไม่มีงานค้าง'}</p>
        </div>
        {staff.role !== 'ops' && <form action={quickSearch} className="search">
          <input name="q" placeholder="ค้นหา รหัส / ทะเบียน / ชื่อ / เบอร์" aria-label="ค้นหาการจอง" />
          <button className="b b-primary">ค้นหา</button>
        </form>}
      </header>

      {((lateIn ?? 0) + (overOut ?? 0)) > 0 && (
        <Link href="/ops" className="alert-strip">⚠ ต้องตรวจสอบ: เลยวันเข้าแต่ยังไม่มีบันทึกรถเข้า {lateIn ?? 0} รายการ · เลยวันรับรถแต่รถยังอยู่ในลาน {overOut ?? 0} รายการ → ดูที่หน้างาน</Link>
      )}


      <section className="tiles">
        <div className="tile">
          <span>ที่จอดวันนี้</span>
          <b>{usedToday}<small>/{total} คัน</small></b>
          <div className="meter" role="img" aria-label={`ใช้ไป ${usedToday} จาก ${total}`}><i style={{ width: `${Math.min(100, (usedToday / total) * 100)}%` }} className={usedToday >= total - (t0?.reserve_spots ?? 5) ? 'full' : ''} /></div>
          <em>ว่าง {Math.max(0, total - usedToday)} · สำรอง {t0?.reserve_spots ?? 5} ช่อง</em>
        </div>
        <div className="tile"><span>รถเข้าวันนี้</span><b>{arr.length}<small> คัน</small></b><em>มาแล้ว {arr.filter((r) => r.status === 'checked_in').length} คัน</em></div>
        <div className="tile"><span>รถออกวันนี้</span><b>{dep.length}<small> คัน</small></b><em>รับรถแล้ว {dep.filter((r) => r.status === 'checked_out').length} คัน</em></div>
        <div className="tile"><span>รถอยู่ในลานตอนนี้</span><b>{inLot.count ?? 0}<small> คัน</small></b><em>เช็กอินแล้วยังไม่รับรถ</em></div>
        <div className="tile"><span>รับเงินวันนี้</span><b>{n(revenueToday)}<small> บาท</small></b><em><Link href="/exec">ดูรายงาน →</Link></em></div>
      </section>
      <section className="panel density-panel">
        <div className="density-head">
          <div>
            <h2>ความหนาแน่นของรถในลาน</h2>
            <p className="hint">{thDate(df)} – {thDate(dt)} · เฉลี่ย {density.length ? Math.round(density.reduce((a, r) => a + r.cars, 0) / density.length) : 0} คัน/วัน · เต็ม {density.filter((r) => r.cars >= r.cap).length} วัน · ใกล้เต็ม {density.filter((r) => r.cars < r.cap && r.cars >= r.cap * 0.8).length} วัน</p>
          </div>
          <form method="get" className="density-filter">
            <label>ตั้งแต่<input type="date" name="df" defaultValue={df} /></label>
            <label>ถึง<input type="date" name="dt" defaultValue={dt} /></label>
            <button className="b b-primary b-sm">ดู</button>
          </form>
        </div>
        <nav className="seg seg-sm density-quick" aria-label="ช่วงที่ใช้บ่อย">
          <Link href={`/admin?df=${today}&dt=${addDays(today, 29)}`} className={df === today && dt === addDays(today, 29) ? 'on' : ''}>30 วันข้างหน้า</Link>
          <Link href={`/admin?df=${addDays(today, -7)}&dt=${addDays(today, 7)}`} className={df === addDays(today, -7) && dt === addDays(today, 7) ? 'on' : ''}>สัปดาห์ก่อน–หลัง</Link>
          <Link href={`/admin?df=${addDays(today, -29)}&dt=${today}`} className={df === addDays(today, -29) && dt === today ? 'on' : ''}>30 วันที่ผ่านมา</Link>
        </nav>
        <DensityChart rows={density} today={today} />
        <DensityLegend />
        <p className="hint">ชี้ที่แท่งเพื่อดูจำนวนรถ ที่ว่าง รถเข้า และรถออกของวันนั้น · เลือกได้ครั้งละไม่เกิน 30 วัน</p>
      </section>

      <section className="panel">
        <h2>ต้องจัดการ {todo > 0 && <span className="count">{todo}</span>}</h2>
        {todo === 0 && <p className="empty">ไม่มีงานค้าง เยี่ยมมาก</p>}
        <ul className="todo">
          {(calls.data ?? []).map((t) => {
            const b = t.bookings as unknown as { id: string; code: string; customers: { name: string; phone: string } | null } | null;
            return (
              <li key={`c${t.id}`}>
                <span className="todo-kind k-slip">ลูกค้าเรียกรถ</span>
                <div className="todo-main"><b>{b?.customers?.name} · {t.pax} คน · รอคนขับรับงาน</b><small>เรียกเมื่อ {thTime(t.called_at)}{t.called_by === 'staff' ? ' (โทรมา)' : ''} · ควรถึง {thTime(new Date(Date.parse(t.called_at!) + 15 * 60_000).toISOString())} · <a href={`tel:${b?.customers?.phone}`}>{b?.customers?.phone}</a></small></div>
                <div className="todo-act"><Link className="b b-primary b-sm" href="/driver">เปิดหน้าคนขับ</Link></div>
              </li>
            );
          })}
          {(notes.data ?? []).map((t) => {
            const b = t.bookings as unknown as { id: string; code: string } | null;
            const v = t.vehicles as unknown as { name: string } | null;
            return (
              <li key={`n${t.id}`}>
                <span className="todo-kind k-del">คนขับแจ้ง</span>
                <div className="todo-main"><b>{t.driver_note}</b><small>{v?.name} · {DIRECTION[t.direction]} · <Link href={`/admin/bookings/${b?.id}`}>{b?.code}</Link>{t.note_at ? ` · ${thTime(t.note_at)}` : ''}</small></div>
                <div className="todo-act"><Act action={ackTripNote} fields={{ id: t.id }} label="รับทราบ" /></div>
              </li>
            );
          })}
          {(slips.data ?? []).map((p) => {
            const b = p.bookings as unknown as { id: string; code: string; plate: string } | null;
            return (
              <li key={p.id}>
                <span className="todo-kind k-slip">สลิปรอตรวจ</span>
                <div className="todo-main"><Link href={`/admin/bookings/${b?.id}`}><b>{b?.code}</b> · {b?.plate}</Link><small>{n(p.amount)} บาท · ส่งเมื่อ {thTime(p.created_at)}</small></div>
                <div className="todo-act">
                  {slipLinks[p.id] && <a className="b b-plain b-sm" href={slipLinks[p.id]} target="_blank" rel="noreferrer">ดูสลิป</a>}
                  <Act action={confirmSlip} fields={{ payment_id: p.id }} label="ยืนยันรับเงิน" variant="primary" confirm={`ยืนยันว่าได้รับเงิน ${n(p.amount)} บาทแล้ว?`} />
                </div>
              </li>
            );
          })}
          {(lpr.data ?? []).map((r) => (
            <li key={`l${r.id}`}>
              <span className={`todo-kind ${r.action === 'add' ? 'k-add' : 'k-del'}`}>{r.action === 'add' ? 'เพิ่มทะเบียน' : 'ลบทะเบียน'}</span>
              <div className="todo-main"><b>{r.plate}</b> {r.plate_province}<small>ระบบไม้กั้น · {r.valid_from && thDate(r.valid_from)} – {r.valid_to && thDate(r.valid_to)}</small></div>
              <div className="todo-act"><Act action={lprDone} fields={{ id: r.id }} label="ทำแล้ว" /></div>
            </li>
          ))}
          {unassigned.map((t) => (
            <li key={`t${t.id}`}>
              <span className="todo-kind k-trip">ยังไม่มีรถ</span>
              <div className="todo-main"><b>{thDate(bkkDay(t.pickup_at))} {thTime(t.pickup_at)}</b> · {DIRECTION[t.direction]} {t.pax} คน<small>{t.bookings?.customers?.name} · {t.bookings?.code}</small></div>
              <div className="todo-act">
                <Act action={autoAssign} fields={{ id: t.id }} label="จัดรถอัตโนมัติ" />
                <Link className="b b-plain b-sm" href="/admin/trips">เลือกเอง</Link>
              </div>
            </li>
          ))}
          {(owed.data ?? []).map((p) => {
            const b = p.bookings as unknown as { id: string; code: string; plate: string } | null;
            return (
              <li key={`o${p.id}`}>
                <span className="todo-kind k-slip">ค้างค่าจอดเพิ่ม</span>
                <div className="todo-main"><Link href={`/admin/bookings/${b?.id}`}><b>{b?.code}</b> · {b?.plate}</Link><small>{n(p.amount)} บาท</small></div>
                <div className="todo-act"><Link className="b b-plain b-sm" href={`/admin/bookings/${b?.id}`}>เปิดการจอง</Link></div>
              </li>
            );
          })}
        </ul>
      </section>

      <div className="cols">
        <section className="panel">
          <h2>รถเข้าวันนี้ <span className="count soft">{arr.length}</span></h2>
          {!arr.length && <p className="empty">ไม่มีรถเข้าวันนี้</p>}
          <ul className="list">
            {arr.map((r) => (
              <li key={r.id}>
                <div><Link href={`/admin/bookings/${r.id}`}><b>{r.plate}</b> {r.plate_province}</Link><small>{r.customers?.name} · <a href={`tel:${r.customers?.phone}`}>{r.customers?.phone}</a>{r.shuttle ? ` · รถรับส่ง ${r.pax} คน` : ''}</small></div>
                {r.status === 'confirmed'
                  ? <Act action={setStatus} fields={{ id: r.id, status: 'checked_in' }} label="เช็กอิน" variant="primary" />
                  : <StatusTag status={r.status} />}
              </li>
            ))}
          </ul>
        </section>
        <section className="panel">
          <h2>รถออกวันนี้ <span className="count soft">{dep.length}</span></h2>
          {!dep.length && <p className="empty">ไม่มีรถออกวันนี้</p>}
          <ul className="list">
            {dep.map((r) => (
              <li key={r.id}>
                <div><Link href={`/admin/bookings/${r.id}`}><b>{r.plate}</b> {r.plate_province}</Link><small>{r.customers?.name} · <a href={`tel:${r.customers?.phone}`}>{r.customers?.phone}</a></small></div>
                {r.status === 'checked_in'
                  ? <Act action={setStatus} fields={{ id: r.id, status: 'checked_out' }} label="รับรถแล้ว" variant="primary" />
                  : <StatusTag status={r.status} />}
              </li>
            ))}
          </ul>
        </section>
      </div>

      <div className="cols">
        <section className="panel">
          <div className="panel-head"><h2>รถรับส่ง วันนี้–พรุ่งนี้</h2><Link href="/admin/trips" className="link">ทั้งหมด →</Link></div>
          {!tripRows.length && <p className="empty">ไม่มีเที่ยวรถ</p>}
          <ul className="timeline">
            {tripRows.map((t) => (
              <li key={t.id} className={t.vehicles ? '' : 'warn'}>
                <time>{bkkDay(t.pickup_at) === today ? '' : 'พรุ่งนี้ '}{thTime(t.pickup_at)}</time>
                <div><b>{DIRECTION[t.direction]} · {t.pax} คน</b><small>{t.bookings?.customers?.name}{t.flight_number ? ` · ${t.flight_number}` : ''}</small></div>
                <span className={`st ${t.status === 'done' ? 'st-done' : t.status === 'en_route' || t.status === 'arrived' ? 'st-in' : t.vehicles ? 'st-ok' : 'st-wait'}`}>{t.status === 'done' ? 'เสร็จแล้ว' : t.status === 'en_route' ? 'กำลังเดินทาง' : t.status === 'arrived' ? 'ถึงจุดนัด' : t.vehicles?.name ?? 'ยังไม่มีรถ'}</span>
              </li>
            ))}
          </ul>
        </section>
      </div>
    </main>
  );
}
