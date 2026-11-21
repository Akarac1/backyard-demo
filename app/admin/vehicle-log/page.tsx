import { db } from '@/lib/supabase';
import { thDate, thTime, todayBkk, addDays } from '@/lib/format';

export const dynamic = 'force-dynamic';

type ArrivalRow = {
  booking_id: string; code: string; plate: string; start_date: string; end_date: string;
  status: string; checked_in_at: string | null; seen: boolean; first_seen_at: string | null;
};
type VehicleEvent = {
  id: number; plate: string; event_time: string; channel: number | null;
  vehicle_color: string | null; vehicle_brand: string | null; vehicle_category: string | null;
};

const STATUS_TH: Record<string, string> = {
  pending_payment: 'รอชำระ', confirmed: 'ยืนยันแล้ว', checked_in: 'เข้าลานแล้ว', checked_out: 'ออกแล้ว', cancelled: 'ยกเลิก',
};

export default async function VehicleLogPage({ searchParams }: { searchParams: Promise<{ d?: string }> }) {
  const { d } = await searchParams;
  const today = todayBkk();
  const day = d && /^\d{4}-\d{2}-\d{2}$/.test(d) ? d : today;
  const sb = db();

  const [{ data: report }, { data: log }] = await Promise.all([
    sb.rpc('booking_arrival_report', { p_start: day, p_end: day }),
    sb
      .from('vehicle_events')
      .select('id, plate, event_time, channel, vehicle_color, vehicle_brand, vehicle_category')
      .gte('event_time', `${day}T00:00:00+07:00`)
      .lt('event_time', `${addDays(day, 1)}T00:00:00+07:00`)
      .order('event_time', { ascending: false }),
  ]);

  const rows = (report ?? []) as ArrivalRow[];
  const events = (log ?? []) as VehicleEvent[];
  const missing = rows.filter((r) => !r.seen && r.start_date <= today); // only flag past/today — a future booking just hasn't arrived yet
  const tabs = [-1, 0, 1].map((i) => addDays(today, i));
  const tabLabel = (x: string, i: number) => (i === 0 ? 'เมื่อวาน' : i === 1 ? 'วันนี้' : i === 2 ? 'พรุ่งนี้' : thDate(x));

  return (
    <main className="page">
      <header className="page-head">
        <div>
          <h1>รถเข้า-ออกจากกล้อง NVR</h1>
          <p>{thDate(day)} · จองขับเองไม่มี shuttle {rows.length} รายการ · เข้าแล้ว {rows.length - missing.length} · {missing.length ? <b>ยังไม่พบรถเข้า {missing.length} รายการ</b> : 'ครบทุกคัน'} · ข้อมูลมาจากการตรวจจับป้ายทะเบียนจริงของ NVR ไม่ใช่การเช็กอินด้วยมือ</p>
        </div>
        <form className="search" action="/admin/vehicle-log"><input type="date" name="d" defaultValue={day} aria-label="เลือกวัน" /><button className="b b-plain">ไปวันที่</button></form>
      </header>
      <nav className="seg" aria-label="เลือกวัน">
        {tabs.map((x, i) => <a key={x} href={`/admin/vehicle-log?d=${x}`} className={x === day ? 'on' : ''}>{tabLabel(x, i)}</a>)}
      </nav>

      <section className="panel">
        <h2>เช็กรถจองเข้าจริงตรงเวลาหรือไม่ (เฉพาะจองขับเองไม่ใช้ shuttle)</h2>
        {!rows.length && <p className="empty">ไม่มีการจองขับเองในวันนี้</p>}
        {!!rows.length && (
          <table className="tbl">
            <thead><tr><th>รหัสจอง</th><th>ทะเบียน</th><th>สถานะการจอง</th><th>เช็กอินโดยพนักงาน</th><th>กล้องเจอรถ</th><th>เวลาที่เจอ</th></tr></thead>
            <tbody>
              {rows.map((r) => (
                <tr key={r.booking_id} className={!r.seen && r.start_date <= today ? 'warn' : ''}>
                  <td>{r.code}</td>
                  <td>{r.plate}</td>
                  <td>{STATUS_TH[r.status] ?? r.status}</td>
                  <td>{r.checked_in_at ? thTime(r.checked_in_at) : '—'}</td>
                  <td>{r.seen ? '✓ เจอ' : r.start_date <= today ? '✕ ยังไม่เจอ' : 'ยังไม่ถึงวัน'}</td>
                  <td>{r.first_seen_at ? thTime(r.first_seen_at) : '—'}</td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </section>

      <section className="panel">
        <h2>บันทึกรถผ่านกล้องทั้งหมด (ดิบ)</h2>
        {!events.length && <p className="empty">ไม่มีรถผ่านกล้องในวันนี้ (หรือ bridge ยังไม่ได้ส่งข้อมูลมา)</p>}
        {!!events.length && (
          <table className="tbl">
            <thead><tr><th>เวลา</th><th>ทะเบียน</th><th>สี</th><th>ยี่ห้อ</th><th>ประเภท</th><th>กล้อง</th></tr></thead>
            <tbody>
              {events.map((e) => (
                <tr key={e.id}>
                  <td>{thTime(e.event_time)}</td>
                  <td>{e.plate}</td>
                  <td>{e.vehicle_color ?? '—'}</td>
                  <td>{e.vehicle_brand ?? '—'}</td>
                  <td>{e.vehicle_category ?? '—'}</td>
                  <td>{e.channel ?? '—'}</td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </section>
    </main>
  );
}
