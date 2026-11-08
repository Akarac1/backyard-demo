import Link from 'next/link';
import { GRAINS, bucketLabel, getDriverStats, getShuttleReport, grainOf, type ShuttleRow } from '@/lib/report';
import { BarChart, LineChart, type Point } from '../Charts';
import { ReportTabs } from '../ReportTabs';

export const dynamic = 'force-dynamic';

const C1 = '#2E7D4F', C2 = '#C9971F';
const n = (v: number) => v.toLocaleString('th-TH');
const pct = (a: number, b: number) => (b > 0 ? Math.round((a / b) * 100) : 0);

export default async function ShuttleReport({ searchParams }: { searchParams: Promise<{ p?: string }> }) {
  const { p } = await searchParams;
  const g = grainOf(p);
  let rows: ShuttleRow[] = [];
  let error: string | null = null;
  try { rows = await getShuttleReport(g.key, g.periods); } catch (e) { error = String(e); }
  const firstUsed = rows.findIndex((r) => r.trips > 0);
  if (firstUsed > 0) rows = rows.slice(firstUsed);
  const from = rows[0]?.bucket;
  const to = rows[rows.length - 1]?.bucket_end;
  let drivers: Awaited<ReturnType<typeof getDriverStats>> = [];
  if (from && to) { try { drivers = await getDriverStats(from, to); } catch { /* shown as empty */ } }

  const sum = (k: keyof ShuttleRow) => rows.reduce((a, r) => a + (Number(r[k]) || 0), 0);
  const trips = sum('trips'), called = sum('called_trips'), late = sum('late_over_15'), busy = sum('busy_hours');
  const waits = rows.filter((r) => r.avg_wait_min != null);
  const avgWait = waits.length ? waits.reduce((a, r) => a + (r.avg_wait_min ?? 0) * r.called_trips, 0) / Math.max(1, waits.reduce((a, r) => a + r.called_trips, 0)) : 0;
  const peak = rows.reduce((m, r) => Math.max(m, r.peak_in_hour), 0);
  const vehicles = rows[0]?.vehicles ?? 2;
  const latePct = pct(late, called);
  // simple rule of thumb for the owner: frequent rush hours or many late pickups -> consider another vehicle
  const advice = latePct >= 20 || busy >= rows.length
    ? { tone: 'bad', text: `ควรพิจารณาเพิ่มรถ: มี ${n(busy)} ชั่วโมงที่งานเกินจำนวนรถ (${vehicles} คัน) และลูกค้ารอเกิน 15 นาที ${latePct}% ของการเรียกรถ` }
    : latePct >= 10 || busy > 0
      ? { tone: 'info', text: `เริ่มตึงในบางช่วง: ${n(busy)} ชั่วโมงที่งานเกินจำนวนรถ · รอเกิน 15 นาที ${latePct}% ติดตามต่อ หรือเพิ่มรถเฉพาะช่วงเวลาเร่งด่วน` }
      : { tone: 'ok', text: `รถ ${vehicles} คันยังรองรับได้: แทบไม่มีช่วงที่งานเกินจำนวนรถ และลูกค้ารอเกิน 15 นาทีเพียง ${latePct}%` };

  const pts = (f: (r: ShuttleRow) => Record<string, number>): Point[] =>
    rows.map((r, i) => ({ label: bucketLabel(g.key, r.bucket, r.bucket_end), values: f(r), note: i === rows.length - 1 ? ' (ถึงวันนี้)' : '' }));

  return (
    <main className="page">
      <header className="page-head">
        <div><h1>รายงานรถรับส่ง</h1><p>งานที่คนขับทำเสร็จ ใช้ตัดสินใจเรื่องเพิ่มรถ · {g.span}</p></div>
      </header>
      <ReportTabs active="shuttle" grain={g.key} />
      <nav className="seg" aria-label="เลือกช่วงเวลา">
        {GRAINS.map((x) => <Link key={x.key} href={`/exec/shuttle?p=${x.key}`} className={x.key === g.key ? 'on' : ''}>{x.label}</Link>)}
      </nav>
      {error && <div className="alert bad">โหลดรายงานไม่สำเร็จ: {error}<br />ตรวจว่ารัน supabase/migrations/0009_shuttle_report.sql แล้ว</div>}
      {!error && !rows.length && <section className="panel"><p className="empty">ยังไม่มีงานรับส่งที่ทำเสร็จในช่วงนี้</p></section>}

      {rows.length > 0 && <>
        <div className={`alert ${advice.tone} advice`}>{advice.text}</div>
        <div className="kpis">
          <div className="kpi"><span>เที่ยวที่ทำเสร็จ</span><b>{n(trips)}<small> เที่ยว</small></b><em>ขาไป {n(sum('trips_to'))} · ขากลับ {n(sum('trips_from'))}</em></div>
          <div className="kpi"><span>ผู้โดยสาร</span><b>{n(sum('pax'))}<small> คน</small></b><em>เฉลี่ย {(sum('pax') / Math.max(1, trips)).toFixed(1)} คน/เที่ยว</em></div>
          <div className="kpi"><span>ลูกค้ารอรถเฉลี่ย</span><b>{avgWait.toFixed(1)}<small> นาที</small></b><em>จากกดเรียกจนรถถึงจุดนัด</em></div>
          <div className="kpi"><span>รอเกิน 15 นาที</span><b>{latePct}<small> %</small></b><em>{n(late)} จาก {n(called)} ครั้งที่เรียกรถ</em></div>
          <div className="kpi"><span>งานพร้อมกันสูงสุด</span><b>{peak}<small> เที่ยว/ชม.</small></b><em>มีรถ {vehicles} คัน</em></div>
          <div className="kpi"><span>ชั่วโมงที่รถไม่พอ</span><b>{n(busy)}<small> ชม.</small></b><em>งานในชั่วโมงนั้นมากกว่า {vehicles} เที่ยว</em></div>
        </div>

        <div className="card">
          <h2>จำนวนเที่ยว{g.label}</h2>
          <BarChart title={`จำนวนเที่ยว${g.label}`} unit=" เที่ยว"
            series={[{ key: 'to', label: 'ขาไปสนามบิน', color: C1 }, { key: 'from', label: 'ขากลับ', color: C2 }]}
            points={pts((r) => ({ to: r.trips_to, from: r.trips_from }))} />
        </div>
        <div className="grid">
          <div className="card">
            <h2>ชั่วโมงที่รถไม่พอ</h2>
            <p className="small">จำนวนชั่วโมงที่มีงานเริ่มมากกว่าจำนวนรถ</p>
            <BarChart title="ชั่วโมงที่รถไม่พอ" unit=" ชม." series={[{ key: 'busy', label: 'ชั่วโมง', color: C2 }]} points={pts((r) => ({ busy: r.busy_hours }))} />
          </div>
          <div className="card">
            <h2>ลูกค้ารอรถเฉลี่ย (นาที)</h2>
            <p className="small">เป้าหมายไม่เกิน 15 นาที</p>
            <LineChart title="ลูกค้ารอรถเฉลี่ย" unit=" นาที" valueKey="wait" color={C1} points={pts((r) => ({ wait: r.avg_wait_min ?? 0 }))} />
          </div>
        </div>

        <div className="card">
          <h2>งานของคนขับแต่ละคน <span className="small">({bucketLabel(g.key, rows[0].bucket, rows[0].bucket_end)} – {bucketLabel(g.key, rows[rows.length - 1].bucket, rows[rows.length - 1].bucket_end)})</span></h2>
          <div className="table-wrap">
            <table className="report">
              <thead><tr><th>คนขับ</th><th>เที่ยว</th><th>ขาไป</th><th>ขากลับ</th><th>ผู้โดยสาร</th><th>รอเฉลี่ย (นาที)</th><th>รอเกิน 15 นาที</th></tr></thead>
              <tbody>
                {drivers.map((d) => (
                  <tr key={d.driver}><td>{d.driver}</td><td><b>{n(d.trips)}</b></td><td>{n(d.trips_to)}</td><td>{n(d.trips_from)}</td><td>{n(d.pax)}</td><td>{d.avg_wait_min ?? '–'}</td><td>{n(d.late_over_15)}</td></tr>
                ))}
                {!drivers.length && <tr><td colSpan={7} className="small">ยังไม่มีข้อมูล</td></tr>}
              </tbody>
            </table>
          </div>
        </div>

        <div className="card">
          <h2>ตารางข้อมูล{g.label}</h2>
          <div className="table-wrap">
            <table className="report">
              <thead><tr><th>ช่วง</th><th>เที่ยว</th><th>ขาไป</th><th>ขากลับ</th><th>ผู้โดยสาร</th><th>รอเฉลี่ย</th><th>รอเกิน 15 นาที</th><th>สูงสุด/ชม.</th><th>ชม. รถไม่พอ</th></tr></thead>
              <tbody>
                {[...rows].reverse().map((r) => (
                  <tr key={r.bucket}>
                    <td>{bucketLabel(g.key, r.bucket, r.bucket_end)}</td><td><b>{n(r.trips)}</b></td><td>{n(r.trips_to)}</td><td>{n(r.trips_from)}</td><td>{n(r.pax)}</td>
                    <td>{r.avg_wait_min ?? '–'}</td><td>{n(r.late_over_15)}</td><td>{r.peak_in_hour}</td><td>{n(r.busy_hours)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
        <p className="small">นับเฉพาะเที่ยวที่คนขับกด “ส่งเรียบร้อย” แล้ว ตามวันที่ทำเสร็จ · เวลารอนับจากลูกค้ากดเรียกรถจนคนขับกด “ถึงจุดนัดรับ”</p>
      </>}
    </main>
  );
}
