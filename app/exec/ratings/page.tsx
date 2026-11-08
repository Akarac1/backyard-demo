import Link from 'next/link';
import { getRatings, legLabel, ratingFilters, type DriverRating, type RatingRow } from '@/lib/ratings';
import { ReportTabs } from '../ReportTabs';

export const dynamic = 'force-dynamic';

const n = (v: number) => v.toLocaleString('th-TH');
const when = (ts: string) => new Date(ts).toLocaleString('th-TH', { timeZone: 'Asia/Bangkok', day: 'numeric', month: 'short', year: '2-digit', hour: '2-digit', minute: '2-digit' });
const Stars = ({ v }: { v: number }) => <span className="stars-sm" aria-label={`${v} ดาว`}>{'★'.repeat(v)}<i>{'★'.repeat(5 - v)}</i></span>;

/** 5 → 1 star split as one bar */
function Dist({ d }: { d: DriverRating }) {
  const parts = [d.s5, d.s4, d.s3, d.s2, d.s1];
  if (!d.ratings) return <span className="small">—</span>;
  return (
    <span className="dist" title={parts.map((p, i) => `${5 - i} ดาว: ${p}`).join(' · ')}>
      {parts.map((p, i) => p > 0 && <i key={i} className={`d${5 - i}`} style={{ flexGrow: p }} />)}
    </span>
  );
}

export default async function RatingsPage({ searchParams }: { searchParams: Promise<Record<string, string | undefined>> }) {
  const sp = await searchParams;
  const f = ratingFilters(sp);
  let drivers: DriverRating[] = [];
  let list: RatingRow[] = [];
  let error: string | null = null;
  try { ({ drivers, list } = await getRatings(f)); } catch (e) { error = String(e); }

  const total = drivers.reduce((a, d) => a + d.ratings, 0);
  const sumStars = drivers.reduce((a, d) => a + d.s1 + 2 * d.s2 + 3 * d.s3 + 4 * d.s4 + 5 * d.s5, 0);
  const trips = drivers.reduce((a, d) => a + d.trips_done, 0);
  const low = drivers.reduce((a, d) => a + d.s1 + d.s2, 0);
  const comments = drivers.reduce((a, d) => a + d.comments, 0);
  const q = (o: Record<string, string | number | boolean>) => {
    const p = new URLSearchParams({ from: f.from, to: f.to, ...(f.d ? { d: f.d } : {}), ...(f.s ? { s: String(f.s) } : {}), ...(f.c ? { c: '1' } : {}) });
    for (const [k, v] of Object.entries(o)) { if (v === '' || v === 0 || v === false) p.delete(k); else p.set(k, String(v === true ? 1 : v)); }
    return p.toString();
  };
  const driverName = drivers.find((d) => d.driver_staff_id === f.d)?.driver_name;

  return (
    <main className="page">
      <header className="page-head">
        <div><h1>รายงานผู้บริหาร</h1><p>คะแนนและคำติชมจากลูกค้าหลังจบเที่ยวรถรับส่ง ใช้ประเมินคนขับ</p></div>
        <a className="btn" href={`/exec/ratings/export?${q({})}`}>ดาวน์โหลด CSV</a>
      </header>
      <ReportTabs active="ratings" grain="month" />

      <form className="card log-filter" method="get">
        <div><label htmlFor="from">ตั้งแต่</label><input id="from" name="from" type="date" defaultValue={f.from} /></div>
        <div><label htmlFor="to">ถึง</label><input id="to" name="to" type="date" defaultValue={f.to} /></div>
        {f.d && <input type="hidden" name="d" value={f.d} />}
        <button className="primary" type="submit">ดูรายงาน</button>
      </form>

      {error && <div className="alert bad">โหลดคะแนนไม่สำเร็จ: {error}<br />ตรวจว่ารัน supabase/migrations/0026_trip_ratings.sql แล้ว</div>}

      <div className="kpis">
        <div className="kpi"><span>คะแนนเฉลี่ย</span><b>{total ? (sumStars / total).toFixed(2) : '—'}<small> / 5</small></b><em>จาก {n(total)} คะแนน</em></div>
        <div className="kpi"><span>ลูกค้าที่ให้คะแนน</span><b>{trips ? Math.round((total / trips) * 100) : 0}<small> %</small></b><em>{n(total)} จาก {n(trips)} เที่ยวที่จบ</em></div>
        <div className="kpi"><span>คำติชม</span><b>{n(comments)}<small> ข้อความ</small></b><em><Link href={`/exec/ratings?${q({ c: true })}#list`}>ดูเฉพาะที่มีข้อความ</Link></em></div>
        <div className="kpi"><span>ได้ 1–2 ดาว</span><b>{n(low)}<small> ครั้ง</small></b><em>{total ? `${Math.round((low / total) * 100)}% ของคะแนนทั้งหมด` : '—'}</em></div>
      </div>

      <div className="card">
        <h2>คะแนนของคนขับแต่ละคน</h2>
        {drivers.length === 0 ? <p className="small">ยังไม่มีเที่ยวที่จบในช่วงนี้</p> : (
          <div className="table-wrap">
            <table className="report log-table">
              <thead><tr><th>คนขับ</th><th className="r">เฉลี่ย</th><th>สัดส่วนดาว (5 → 1)</th><th className="r">คะแนน</th><th className="r">เที่ยวที่จบ</th><th className="r">ให้คะแนน</th><th className="r">คำติชม</th><th></th></tr></thead>
              <tbody>
                {drivers.map((d) => (
                  <tr key={d.driver_staff_id ?? d.driver_name} className={d.driver_staff_id === f.d ? 'sel-row' : ''}>
                    <td className="l"><b>{d.driver_name.replace(/\s*\(.*\)$/, '')}</b></td>
                    <td className="pos-n">{d.avg_stars != null ? <><b>{d.avg_stars.toFixed(2)}</b> <span className="star1">★</span></> : '—'}</td>
                    <td className="l"><Dist d={d} /></td>
                    <td>{n(d.ratings)}</td>
                    <td>{n(d.trips_done)}</td>
                    <td>{d.trips_done ? `${Math.round((d.ratings / d.trips_done) * 100)}%` : '—'}</td>
                    <td>{n(d.comments)}</td>
                    <td className="l">{d.driver_staff_id && <Link href={`/exec/ratings?${q({ d: d.driver_staff_id === f.d ? '' : d.driver_staff_id })}#list`}>{d.driver_staff_id === f.d ? 'ดูทุกคน' : 'ดูความเห็น'}</Link>}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
        <p className="small">“ให้คะแนน” = สัดส่วนเที่ยวที่ลูกค้ากดให้ดาว การให้ดาวไม่บังคับ คนขับที่มีคะแนนน้อยควรดูประกอบกับจำนวนเที่ยว</p>
      </div>

      <div className="card" id="list">
        <div className="rate-list-head">
          <h2>คะแนนและคำติชม {driverName && <span className="small">· {driverName.replace(/\s*\(.*\)$/, '')}</span>} <span className="small">{n(list.length)} รายการ</span></h2>
          <nav className="seg seg-sm" aria-label="กรองตามดาว">
            <Link href={`/exec/ratings?${q({ s: 0 })}#list`} className={!f.s ? 'on' : ''}>ทั้งหมด</Link>
            {[5, 4, 3, 2, 1].map((s) => <Link key={s} href={`/exec/ratings?${q({ s })}#list`} className={f.s === s ? 'on' : ''}>{s} ★</Link>)}
            <Link href={`/exec/ratings?${q({ c: !f.c })}#list`} className={f.c ? 'on' : ''}>มีข้อความ</Link>
          </nav>
        </div>
        {list.length === 0 ? <p className="small">ไม่มีรายการ</p> : (
          <ul className="rate-list">
            {list.map((r, i) => (
              <li key={i} className={r.stars <= 2 ? 'low' : ''}>
                <div className="rl-top"><Stars v={r.stars} /><span className="small">{when(r.created_at)}{r.updated_at > r.created_at ? ' · แก้ไขแล้ว' : ''}</span></div>
                {r.comment ? <p className="rl-text">“{r.comment}”</p> : <p className="small">ไม่มีข้อความ</p>}
                <p className="small">คนขับ {r.driver_name?.replace(/\s*\(.*\)$/, '') || '—'} · {legLabel(r.direction)}{r.vehicle ? ` · ${r.vehicle}` : ''} · {r.customer_name ?? '—'}{r.booking_code ? ` · ${r.booking_code}` : ''}</p>
              </li>
            ))}
          </ul>
        )}
      </div>
    </main>
  );
}
