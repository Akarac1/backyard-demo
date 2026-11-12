import Link from 'next/link';
import { db } from '@/lib/supabase';
import { requireStaff } from '@/lib/auth';
import { WalkinForm } from './WalkinForm';

export const dynamic = 'force-dynamic';

/** Walk-in booking: staff book for a customer at the counter (elderly people, anyone without LINE). */
export default async function NewBookingPage() {
  await requireStaff(['admin']);
  const { data: s } = await db().from('settings').select('price_per_day, shuttle_price, group_max_cars').eq('id', 1).single();
  const today = new Date().toLocaleDateString('en-CA', { timeZone: 'Asia/Bangkok' });
  return (
    <main className="page narrow">
      <Link href="/admin/bookings" className="back">← การจองทั้งหมด</Link>
      <header className="page-head"><div><h1>จองให้ลูกค้า (Walk-in)</h1><p>สำหรับผู้สูงอายุหรือคนที่จองผ่าน LINE ไม่ได้ · ราคา ส่วนลด และที่ว่างใช้กติกาเดียวกับการจองใน LINE · ลูกค้าที่มีเบอร์ตรงกับสมาชิกเดิมจะสะสมแต้มในบัญชีเดิม</p></div></header>
      <WalkinForm today={today} price={s?.price_per_day ?? 100} shuttlePrice={s?.shuttle_price ?? 300} maxCars={s?.group_max_cars ?? 5} />
    </main>
  );
}
