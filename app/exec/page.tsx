import Link from 'next/link';
import { GRAINS, bucketLabel, getReport, grainOf, type ReportRow } from '@/lib/report';
import { BarChart, LineChart, type Point } from './Charts';
import { ReportTabs } from './ReportTabs';

export const dynamic = 'force-dynamic';

// Validated categorical palette (light surface): parking, shuttle, extra.
const C1 = '#2E7D4F', C2 = '#C9971F', C3 = '#3D7FB8';
const n = (v: number) => v.toLocaleString('th-TH');
const pct = (a: number, b: number) => (b > 0 ? Math.round((a / b) * 100) : 0);

function Kpi({ label, value, unit, prev, prevLabel }: { label: string; value: string; unit?: string; prev?: string; prevLabel: string }) {
  return (
    <div className="kpi">
      <span>{label}</span>
      <b>{value}{unit && <small> {unit}</small>}</b>
      {prev !== undefined && <em>{prevLabel}: {prev}{unit ? ` ${unit}` : ''}</em>}
    </div>
  );
}

export default async function ExecPage({ searchParams }: { searchParams: Promise<{ p?: string }> }) {
  const { p } = await searchParams;
  const g = grainOf(p);
  let rows: ReportRow[] = [];
  let error: string | null = null;
  try { rows = await getReport(g.key, g.periods); } catch (e) { error = String(e); }
  // Hide empty periods from before the business had any data, so averages are not dragged down.
  const firstUsed = rows.findIndex((r) => r.revenue_total > 0 || r.cars_in > 0);
  if (firstUsed > 0) rows = rows.slice(firstUsed);

  const cur = rows[rows.length - 1];
  const prev = rows[rows.length - 2];
  const sum = (k: keyof ReportRow) => rows.reduce((a, r) => a + (Number(r[k]) || 0), 0);
  const totalRevenue = sum('revenue_total');
  const totalCars = sum('cars_in');
  const totalShuttle = sum('shuttle_bookings');
  const totalCarDays = sum('car_days');
  const avgOcc = rows.length ? rows.reduce((a, r) => a + (r.occupancy_pct ?? 0), 0) / rows.length : 0;
  const best = rows.reduce<ReportRow | null>((b, r) => (!b || r.revenue_total > b.revenue_total ? r : b), null);

  const pts = (f: (r: ReportRow) => Record<string, number>): Point[] =>
    rows.map((r, i) => ({ label: bucketLabel(g.key, r.bucket, r.bucket_end), values: f(r), note: i === rows.length - 1 ? ' (ถึงวันนี้)' : '' }));
  const prevLabel = g.key === 'day' ? 'เมื่อวาน' : `${g.label.replace('ราย', '')}ที่แล้ว`;

  return (
    <main className="page">
      <header className="page-head">
        <div><h1>รายงานผู้บริหาร</h1><p>ยอดลูกค้าที่เข้าใช้บริการและรายได้ · {g.span}</p></div>
      </header>
      <ReportTabs active="money" grain={g.key} />
      <nav className="seg" aria-label="เลือกช่วงเวลา">
        {GRAINS.map((x) => (
          <Link key={x.key} href={`/exec?p=${x.key}`} className={x.key === g.key ? 'on' : ''} aria-current={x.key === g.key ? 'page' : undefined}>{x.label}</Link>
        ))}
      </nav>
      <div>
        {error && <div className="alert bad">โหลดรายงานไม่สำเร็จ: {error}<br />ตรวจว่ารัน supabase/migrations/0003_exec_report.sql แล้ว</div>}

        {cur && <>
          <h2 className="sec">{g.current} <span className="small">({bucketLabel(g.key, cur.bucket, cur.bucket_end)} · นับถึงวันนี้)</span></h2>
          <div className="kpis">
            <Kpi label="รายได้" value={n(cur.revenue_total)} unit="บาท" prev={prev ? n(prev.revenue_total) : undefined} prevLabel={prevLabel} />
            <Kpi label="รถเข้าใช้บริการ" value={n(cur.cars_in)} unit="คัน" prev={prev ? n(prev.cars_in) : undefined} prevLabel={prevLabel} />
            <Kpi label="ลูกค้าใหม่" value={n(cur.new_customers)} unit="คน" prev={prev ? n(prev.new_customers) : undefined} prevLabel={prevLabel} />
            <Kpi label="อัตราการใช้ลาน" value={String(cur.occupancy_pct ?? 0)} unit="%" prev={prev ? String(prev.occupancy_pct ?? 0) : undefined} prevLabel={prevLabel} />
          </div>

          <h2 className="sec">สรุป {g.span}</h2>
          <div className="kpis">
            <Kpi label="รายได้รวม" value={n(totalRevenue)} unit="บาท" prevLabel="" />
            <Kpi label={`เฉลี่ยต่อ${g.label.replace('ราย', '')}`} value={n(Math.round(totalRevenue / Math.max(rows.length, 1)))} unit="บาท" prevLabel="" />
            <Kpi label="รถเข้าใช้บริการรวม" value={n(totalCars)} unit="คัน" prevLabel="" />
            <Kpi label="ใช้รถรับส่ง" value={String(pct(totalShuttle, totalCars))} unit="% ของการจอง" prevLabel="" />
            <Kpi label="อัตราการใช้ลานเฉลี่ย" value={avgOcc.toFixed(1)} unit="%" prevLabel="" />
            <Kpi label="จอดเฉลี่ย" value={totalCars ? (totalCarDays / totalCars).toFixed(1) : '0'} unit="วัน/คัน" prevLabel="" />
          </div>

          <div className="card">
            <h2>รายได้{g.label}</h2>
            <p className="small">นับตามวันที่ได้รับเงิน · {best && best.revenue_total > 0 && <>สูงสุด {bucketLabel(g.key, best.bucket, best.bucket_end)} {n(best.revenue_total)} บาท</>}</p>
            <BarChart title={`รายได้${g.label}`} unit=" บาท"
              series={[{ key: 'parking', label: 'ค่าจอด', color: C1 }, { key: 'shuttle', label: 'รถรับส่ง', color: C2 }, { key: 'extra', label: 'จอดเพิ่ม/เกินวัน', color: C3 }]}
              points={pts((r) => ({ parking: r.revenue_parking, shuttle: r.revenue_shuttle, extra: r.revenue_extra }))} />
          </div>

          <div className="grid">
            <div className="card">
              <h2>รถเข้าใช้บริการ{g.label}</h2>
              <p className="small">นับตามวันที่รถเข้าลาน แยกลูกค้าใหม่กับลูกค้าเดิม</p>
              <BarChart title={`รถเข้าใช้บริการ${g.label}`} unit=" คัน"
                series={[{ key: 'old', label: 'ลูกค้าเดิม', color: C1 }, { key: 'new', label: 'ลูกค้าใหม่', color: C2 }]}
                points={pts((r) => ({ old: Math.max(0, r.cars_in - r.new_customers), new: r.new_customers }))} />
            </div>
            <div className="card">
              <h2>อัตราการใช้ลาน{g.label}</h2>
              <p className="small">จำนวนวันที่มีรถจอด เทียบกับลาน 60 ช่อง</p>
              <LineChart title="อัตราการใช้ลาน" unit="%" valueKey="occ" color={C1} max={100}
                points={pts((r) => ({ occ: r.occupancy_pct ?? 0 }))} />
            </div>
          </div>

          <div className="card">
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 12 }}>
              <h2 style={{ margin: 0 }}>ตารางข้อมูล{g.label}</h2>
              <a className="btn btn-sm" href={`/exec/export?p=${g.key}`}>ดาวน์โหลด CSV (เปิดใน Excel)</a>
            </div>
            <div className="table-wrap">
              <table className="report">
                <thead>
                  <tr><th>ช่วง</th><th>รายได้รวม</th><th>ค่าจอด</th><th>รถรับส่ง</th><th>จอดเพิ่ม</th><th>รถเข้า</th><th>ลูกค้า</th><th>ลูกค้าใหม่</th><th>ผู้โดยสาร</th><th>ใช้ลาน</th></tr>
                </thead>
                <tbody>
                  {[...rows].reverse().map((r) => (
                    <tr key={r.bucket}>
                      <td>{bucketLabel(g.key, r.bucket, r.bucket_end)}</td>
                      <td><b>{n(r.revenue_total)}</b></td><td>{n(r.revenue_parking)}</td><td>{n(r.revenue_shuttle)}</td><td>{n(r.revenue_extra)}</td>
                      <td>{n(r.cars_in)}</td><td>{n(r.customers)}</td><td>{n(r.new_customers)}</td><td>{n(r.shuttle_pax)}</td><td>{r.occupancy_pct ?? 0}%</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
          <p className="small">รายได้นับจากสลิปที่ตรวจผ่านแล้ว ตามวันที่ได้รับเงิน · ลูกค้านับจากการจองที่ชำระแล้วตามวันที่รถเข้าลาน · ช่วงปัจจุบันนับถึงวันนี้เท่านั้น</p>
        </>}
      </div>
    </main>
  );
}
