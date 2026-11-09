import Link from 'next/link';
import { db } from '@/lib/supabase';
import { todayBkk, thDate } from '@/lib/format';
import { LotCheck, type LotCar } from './LotCheck';

export const dynamic = 'force-dynamic';

/** Cars in the lot right now (checked in, not yet picked up): a list to walk the lot with and tick off. */
export default async function LotPage() {
  const today = todayBkk();
  const { data } = await db().from('bookings')
    .select('id, code, plate, plate_province, start_date, end_date, days, shuttle, pax, checked_in_at, admin_note, customers(name, phone, member_no)')
    .eq('status', 'checked_in').order('plate').limit(1000);
  const cars = ((data ?? []) as unknown as LotCar[])
    .sort((a, b) => a.plate.localeCompare(b.plate, 'th'));

  return (
    <main className="page lot-page">
      <header className="page-head">
        <div>
          <h1>รถในลานตอนนี้ · {thDate(today)}</h1>
          <p>รายการรถที่เช็กอินแล้วยังไม่รับรถ ใช้เดินตรวจลาน: กด “พบ” หรือ “ไม่พบ” ทีละคัน ผลการตรวจเก็บไว้ในเครื่องนี้เฉพาะวันนี้</p>
        </div>
        <div className="lot-head-act no-print"><Link href="/ops" className="b b-plain">← หน้างาน</Link></div>
      </header>
      <LotCheck cars={cars} today={today} />
    </main>
  );
}
