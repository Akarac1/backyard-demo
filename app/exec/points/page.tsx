import Link from 'next/link';
import { KINDS, byWho, detail, getLog, kindLabel, logFilters, type LogRow, type LogTotal } from '@/lib/pointsLog';
import { ReportTabs } from '../ReportTabs';

export const dynamic = 'force-dynamic';

const n = (v: number) => v.toLocaleString('th-TH');
const when = (ts: string) => new Date(ts).toLocaleString('th-TH', { timeZone: 'Asia/Bangkok', day: 'numeric', month: 'short', year: '2-digit', hour: '2-digit', minute: '2-digit' });

export default async function PointsLogPage({ searchParams }: { searchParams: Promise<Record<string, string | undefined>> }) {
  const sp = await searchParams;
  const f = logFilters(sp);
  let rows: LogRow[] = [];
  let totals: LogTotal[] = [];
  let error: string | null = null;
  try { ({ rows, totals } = await getLog(f)); } catch (e) { error = String(e); }

  const sumOf = (keys: string[]) => totals.filter((t) => keys.includes(t.kind)).reduce((a, t) => ({ entries: a.entries + t.entries, points: a.points + t.points }), { entries: 0, points: 0 });
  const bought = sumOf(['payment', 'purchase']);
  const staffAdd = sumOf(['admin_add']);
  const referral = sumOf(['referral']);
  const used = sumOf(['admin_take', 'redeem', 'booking']);
  const qs = new URLSearchParams({ from: f.from, to: f.to, k: f.k, q: f.q }).toString();

  return (
    <main className="page">
      <header className="page-head">
        <div><h1>รายงานผู้บริหาร</h1><p>บันทึกแต้มของลูกค้า: ได้จากการซื้อ ทีมงานเพิ่มให้ แนะนำเพื่อน และการใช้แต้ม</p></div>
        <a className="btn" href={`/exec/points/export?${qs}`}>ดาวน์โหลด CSV</a>
      </header>
      <ReportTabs active="points" grain="month" />

      <form className="card log-filter" method="get">
        <div><label htmlFor="from">ตั้งแต่</label><input id="from" name="from" type="date" defaultValue={f.from} /></div>
        <div><label htmlFor="to">ถึง</label><input id="to" name="to" type="date" defaultValue={f.to} /></div>
        <div>
          <label htmlFor="k">ประเภท</label>
          <select id="k" name="k" defaultValue={f.k}>
            <option value="earn">แต้มที่ได้รับทั้งหมด</option>
            <option value="spend">แต้มที่ใช้/ถูกหักทั้งหมด</option>
            <option value="">ทุกรายการ</option>
            <optgroup label="ได้รับ">{KINDS.filter((x) => x.earn).map((x) => <option key={x.key} value={x.key}>{x.label}</option>)}</optgroup>
            <optgroup label="ใช้/หัก">{KINDS.filter((x) => !x.earn).map((x) => <option key={x.key} value={x.key}>{x.label}</option>)}</optgroup>
          </select>
        </div>
        <div className="grow"><label htmlFor="q">ค้นหา</label><input id="q" name="q" defaultValue={f.q} placeholder="ชื่อ เบอร์ เลขสมาชิก รหัสการจอง หรือชื่อทีมงาน" /></div>
        <button className="primary" type="submit">ดูรายการ</button>
      </form>

      {error && <div className="alert bad">โหลดบันทึกแต้มไม่สำเร็จ: {error}<br />ตรวจว่ารัน supabase/migrations/0024_points_log.sql แล้ว</div>}

      <div className="kpis">
        <div className="kpi"><span>ได้จากการซื้อ</span><b>{n(bought.points)}<small> แต้ม</small></b><em>{n(bought.entries)} รายการ (ค่าจอด คาเฟ่ ที่พัก)</em></div>
        <div className="kpi"><span>ทีมงานเพิ่มให้</span><b>{n(staffAdd.points)}<small> แต้ม</small></b><em>{n(staffAdd.entries)} รายการ</em></div>
        <div className="kpi"><span>แนะนำเพื่อน</span><b>{n(referral.points)}<small> แต้ม</small></b><em>{n(referral.entries)} รายการ</em></div>
        <div className="kpi"><span>ใช้/ถูกหัก</span><b>{n(-used.points)}<small> แต้ม</small></b><em>{n(used.entries)} รายการ</em></div>
      </div>

      <div className="card">
        <h2>รายการ <span className="small">{n(rows.length)} รายการ{rows.length >= 1000 ? ' (แสดง 1,000 รายการล่าสุด ดาวน์โหลด CSV เพื่อดูทั้งหมด)' : ''}</span></h2>
        {rows.length === 0 ? <p className="small">ไม่มีรายการในช่วงนี้</p> : (
          <div className="table-wrap">
            <table className="report log-table">
              <thead><tr><th>วันเวลา</th><th>ลูกค้า</th><th>ประเภท</th><th className="r">แต้ม</th><th>ที่มา</th><th>หมายเหตุ</th><th>ทำโดย</th></tr></thead>
              <tbody>
                {rows.map((r, i) => (
                  <tr key={i} className={r.returned ? 'muted-row' : ''}>
                    <td>{when(r.at)}</td>
                    <td className="l">
                      <b>{r.customer_name ?? '—'}</b>
                      <small>{[r.member_no, r.phone].filter(Boolean).join(' · ') || (r.customer_id ? '' : 'รอผูกเบอร์')}</small>
                    </td>
                    <td className="l"><span className={`kind kind-${r.kind}`}>{kindLabel(r.kind)}</span>{r.returned && <small>คืนแต้มแล้ว</small>}</td>
                    <td className={r.points > 0 ? 'pos' : 'neg'}>{r.points > 0 ? '+' : '−'}{n(Math.abs(r.points))}</td>
                    <td className="l">{detail(r) || '—'}</td>
                    <td className="l wrap">{r.note ?? '—'}</td>
                    <td className="l">{r.by_name ?? <span className="small">{byWho(r)}</span>}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
        <p className="small">“ทำโดย” คือทีมงานที่กดในระบบ เช่น เพิ่ม/หักแต้ม บันทึกยอดซื้อคาเฟ่ หรือยืนยันสลิปเอง · “ลูกค้า” คือลูกค้าแลกหรือใช้แต้มเอง · “ระบบ” คือรายการอัตโนมัติ เช่น ตรวจสลิปผ่าน · รายการก่อนอัปเดตนี้ที่หาผู้ทำไม่ได้จะแสดงเป็น “ระบบ”</p>
      </div>
      <p className="small"><Link href="/exec">กลับไปรายงานรายได้</Link></p>
    </main>
  );
}
