import { db } from '@/lib/supabase';
import { addDays, bkkDay, thDate, thTime, todayBkk } from '@/lib/format';

export const dynamic = 'force-dynamic';

type Trip = {
  id: string; direction: 'to_airport' | 'from_airport'; pax: number; pickup_at: string; flight_number: string | null;
  vehicles: { name: string } | null; bookings: { code: string; plate: string; customers: { name: string; phone: string } | null } | null;
};

// Phone page for the drivers: today's and tomorrow's trips, grouped by vehicle. /driver?key=DRIVER_KEY
export default async function DriverPage({ searchParams }: { searchParams: Promise<{ key?: string }> }) {
  const { key } = await searchParams;
  if (!process.env.DRIVER_KEY || key !== process.env.DRIVER_KEY) {
    return <main className="wrap"><div className="alert bad">ลิงก์ไม่ถูกต้อง ขอลิงก์จากแอดมิน</div></main>;
  }
  const today = todayBkk();
  const { data } = await db().from('shuttle_trips')
    .select('id, direction, pax, pickup_at, flight_number, vehicles(name), bookings(code, plate, customers(name, phone))')
    .gte('pickup_at', `${today}T00:00:00+07:00`).lt('pickup_at', `${addDays(today, 2)}T00:00:00+07:00`)
    .not('status', 'in', '(done,cancelled)').order('pickup_at');
  const trips = (data ?? []) as unknown as Trip[];
  const groups = new Map<string, Trip[]>();
  for (const t of trips) {
    const k = t.vehicles?.name ?? 'ยังไม่จัดรถ';
    groups.set(k, [...(groups.get(k) ?? []), t]);
  }

  return (
    <main>
      <div className="hero"><span className="chip">คนขับ</span><h1>งานวันนี้และพรุ่งนี้</h1><p>{thDate(today)} · รีเฟรชหน้าเพื่อดูงานล่าสุด</p></div>
      <div className="wrap">
        {!trips.length && <div className="card">ยังไม่มีงาน</div>}
        {[...groups.entries()].map(([name, list]) => (
          <div key={name} className="card">
            <h2>{name}</h2>
            {list.map((t) => (
              <div key={t.id} className="trip">
                <div style={{ display: 'flex', justifyContent: 'space-between' }}>
                  <b>{thTime(t.pickup_at)} · {t.direction === 'to_airport' ? 'รับที่ลาน → ส่งชั้น 4' : 'รับชั้น 2 ประตู 4 → ลาน'}</b>
                  <span className="small">{thDate(bkkDay(t.pickup_at))}</span>
                </div>
                <div>{t.bookings?.customers?.name} · {t.pax} คน · {t.bookings?.plate}</div>
                {t.flight_number && <div className="small">ไฟลต์ {t.flight_number} · ทักถามลูกค้าก่อนออกรถ</div>}
                <a className="btn" style={{ marginTop: 8 }} href={`tel:${t.bookings?.customers?.phone}`}>โทรหาลูกค้า</a>
              </div>
            ))}
          </div>
        ))}
      </div>
    </main>
  );
}
