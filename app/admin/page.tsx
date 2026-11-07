import { db } from '@/lib/supabase';
import { addDays, baht, thDate, thTime, todayBkk } from '@/lib/format';
import { ActionButton } from './ActionButton';

export const dynamic = 'force-dynamic';

type Occ = { day: string; used: number; total_spots: number; reserve_spots: number; free_total: number };
type Trip = {
  id: string; direction: 'to_airport' | 'from_airport'; pax: number; pickup_at: string | null; status: string; flight_number: string | null;
  vehicles: { name: string } | null; bookings: { code: string; plate: string; customers: { name: string; phone: string } | null } | null;
};

export default async function AdminPage() {
  const today = todayBkk();
  const sb = db();
  const [occ, arrivals, departures, payments, lpr, trips] = await Promise.all([
    sb.from('v_occupancy_30d').select('*'),
    sb.from('bookings').select('id, code, plate, plate_province, shuttle, pax, status, customers(name, phone)').eq('start_date', today).in('status', ['confirmed', 'checked_in']),
    sb.from('bookings').select('id, code, plate, status, end_date').eq('end_date', today).in('status', ['confirmed', 'checked_in']),
    sb.from('payments').select('id, amount, kind, slip_path, created_at, bookings(code, plate, status)').eq('status', 'pending').not('slip_path', 'is', null).order('created_at'),
    sb.from('lpr_sync').select('id, plate, plate_province, action, valid_from, valid_to, created_at').neq('status', 'done').order('created_at'),
    sb.from('shuttle_trips').select('id, direction, pax, pickup_at, status, flight_number, vehicles(name), bookings(code, plate, customers(name, phone))')
      .gte('pickup_at', `${today}T00:00:00+07:00`).lt('pickup_at', `${addDays(today, 3)}T00:00:00+07:00`)
      .neq('status', 'cancelled').order('pickup_at'),
  ]);

  const days = (occ.data ?? []) as Occ[];
  const todayOcc = days[0];
  const unassigned = ((trips.data ?? []) as unknown as Trip[]).filter((t) => !t.vehicles).length;

  // Signed links so the admin can open a slip image.
  const slipLinks: Record<string, string> = {};
  for (const p of payments.data ?? []) {
    if (p.slip_path) {
      const { data } = await sb.storage.from('slips').createSignedUrl(p.slip_path, 3600);
      if (data) slipLinks[p.id] = data.signedUrl;
    }
  }

  return (
    <main className="wide">
      <h1 style={{ margin: '0 0 4px' }}>Backyard · หน้าแอดมิน</h1>
      <p className="small" style={{ marginTop: 0 }}>{thDate(today)} · ข้อมูลล่าสุดทุกครั้งที่เปิดหน้า</p>

      <div className="stats">
        <div className="stat">จอดอยู่วันนี้<b>{todayOcc ? `${todayOcc.used}/${todayOcc.total_spots}` : '-'}</b></div>
        <div className="stat">รถเข้าวันนี้<b>{arrivals.data?.length ?? 0}</b></div>
        <div className="stat">รถออกวันนี้<b>{departures.data?.length ?? 0}</b></div>
        <div className="stat">สลิปรอตรวจ<b>{payments.data?.length ?? 0}</b></div>
        <div className="stat">เที่ยวรถยังไม่มีรถ<b>{unassigned}</b></div>
      </div>

      <div className="card">
        <h2>ที่ว่าง 30 วันข้างหน้า</h2>
        <div className="cal">
          {days.map((d) => {
            const cap = d.total_spots - d.reserve_spots;
            const cls = d.used >= cap ? 'full' : d.used >= cap * 0.8 ? 'mid' : '';
            return <div key={d.day} className={`day ${cls}`}>{thDate(d.day)}<b>{Math.max(0, cap - d.used)}</b>ว่าง</div>;
          })}
        </div>
        <p className="small">นับเฉพาะช่องที่เปิดให้จองล่วงหน้า ({days[0] ? days[0].total_spots - days[0].reserve_spots : 55} ช่อง) ไม่รวมช่องสำรอง</p>
      </div>

      <div className="grid">
        <div className="card">
          <h2>เที่ยวรถรับส่ง 3 วัน</h2>
          <table>
            <thead><tr><th>เวลา</th><th>งาน</th><th>ลูกค้า</th><th>รถ</th></tr></thead>
            <tbody>
              {((trips.data ?? []) as unknown as Trip[]).map((t) => (
                <tr key={t.id}>
                  <td>{thDate(t.pickup_at!.slice(0, 10))}<br />{thTime(t.pickup_at)}</td>
                  <td>{t.direction === 'to_airport' ? 'ส่งสนามบิน' : 'รับกลับ'} · {t.pax} คน{t.flight_number ? <><br /><span className="small">{t.flight_number}</span></> : null}</td>
                  <td>{t.bookings?.customers?.name}<br /><span className="small">{t.bookings?.plate}</span></td>
                  <td>{t.vehicles ? <span className="tag navy">{t.vehicles.name}</span> : <ActionButton url={`/api/admin/trips/${t.id}/assign`} label="จัดรถ" />}</td>
                </tr>
              ))}
              {!trips.data?.length && <tr><td colSpan={4} className="small">ไม่มีเที่ยวรถ</td></tr>}
            </tbody>
          </table>
        </div>

        <div className="card">
          <h2>ทะเบียนที่ต้องเพิ่ม/ลบในระบบไม้กั้น</h2>
          <table>
            <thead><tr><th>ทะเบียน</th><th>งาน</th><th>ช่วงวันที่</th><th></th></tr></thead>
            <tbody>
              {(lpr.data ?? []).map((r) => (
                <tr key={r.id}>
                  <td>{r.plate}<br /><span className="small">{r.plate_province}</span></td>
                  <td><span className={`tag ${r.action === 'add' ? 'amber' : ''}`}>{r.action === 'add' ? 'เพิ่ม' : 'ลบ'}</span></td>
                  <td>{r.valid_from && thDate(r.valid_from)} – {r.valid_to && thDate(r.valid_to)}</td>
                  <td><ActionButton url={`/api/admin/lpr/${r.id}/done`} label="ทำแล้ว" /></td>
                </tr>
              ))}
              {!lpr.data?.length && <tr><td colSpan={4} className="small">ไม่มีงานค้าง</td></tr>}
            </tbody>
          </table>
        </div>

        <div className="card">
          <h2>สลิปที่ระบบตรวจไม่ผ่าน</h2>
          <table>
            <thead><tr><th>การจอง</th><th>ยอด</th><th>สลิป</th><th></th></tr></thead>
            <tbody>
              {(payments.data ?? []).map((p) => {
                const bk = p.bookings as unknown as { code: string; plate: string } | null;
                return (
                  <tr key={p.id}>
                    <td>{bk?.code}<br /><span className="small">{bk?.plate}</span></td>
                    <td>{baht(p.amount)}</td>
                    <td>{slipLinks[p.id] ? <a href={slipLinks[p.id]} target="_blank">ดูสลิป</a> : '-'}</td>
                    <td><ActionButton url={`/api/admin/payments/${p.id}/confirm`} label="ยืนยัน" confirm="ยืนยันว่าได้รับเงินแล้ว?" /></td>
                  </tr>
                );
              })}
              {!payments.data?.length && <tr><td colSpan={4} className="small">ไม่มีสลิปรอตรวจ</td></tr>}
            </tbody>
          </table>
        </div>

        <div className="card">
          <h2>รถเข้าวันนี้</h2>
          <table>
            <thead><tr><th>รหัส</th><th>ทะเบียน</th><th>ลูกค้า</th></tr></thead>
            <tbody>
              {(arrivals.data ?? []).map((a) => {
                const c = a.customers as unknown as { name: string; phone: string } | null;
                return <tr key={a.id}><td>{a.code}</td><td>{a.plate}</td><td>{c?.name}<br /><a className="small" href={`tel:${c?.phone}`}>{c?.phone}</a></td></tr>;
              })}
              {!arrivals.data?.length && <tr><td colSpan={3} className="small">ไม่มี</td></tr>}
            </tbody>
          </table>
        </div>
      </div>
    </main>
  );
}
