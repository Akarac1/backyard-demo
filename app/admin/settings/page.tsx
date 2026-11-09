import { db } from '@/lib/supabase';
import { ActionForm, Submit } from '@/components/ActionForm';
import { setContact, updateSettings } from '../actions';
import { Vehicles } from './Vehicles';
import { TvLink } from './TvLink';

export const dynamic = 'force-dynamic';

export default async function SettingsPage() {
  const { data: s } = await db().from('settings').select('*').eq('id', 1).single();
  if (!s) return null;
  const field = (name: string, label: string, hint: string, unit: string, min = 0) => (
    <label>{label}
      <span className="with-unit"><input name={name} type="number" min={min} defaultValue={s[name]} required /><em>{unit}</em></span>
      <small>{hint}</small>
    </label>
  );
  return (
    <main className="page narrow">
      <header className="page-head"><div><h1>ตั้งค่าร้าน</h1><p>มีผลกับการจองใหม่ทันที การจองที่จ่ายแล้วไม่เปลี่ยนราคา</p></div></header>
      <section className="panel">
        <h2>ติดต่อร้าน</h2>
        <p className="hint">ใช้ทุกจุด: ปุ่มโทรในการ์ด LINE ทุกใบ · ข้อความตอบเรื่องราคาและติดต่อแอดมิน · ข้อความต้อนรับเพื่อนใหม่ · หน้าเรียกรถ · หน้าสมาชิก &amp; การจอง</p>
        <ActionForm action={setContact} className="form grid2">
          <label>เบอร์โทรร้าน<input name="phone" type="tel" defaultValue={s.shop_phone ?? ''} placeholder="0812345678" required /><small>ไม่ต้องใส่ขีด ระบบจัดรูปแบบให้</small></label>
          <label>เวลาตอบแชทของแอดมิน<input name="hours" defaultValue={s.admin_hours ?? '08:00–20:00'} required /><small>เช่น 08:00–20:00 หรือ ทุกวัน 07:00–22:00</small></label>
          <div className="form-actions span2"><Submit>บันทึกข้อมูลติดต่อ</Submit></div>
        </ActionForm>
      </section>
      <Vehicles />
      <TvLink token={s.tv_token ?? null} />
      <ActionForm action={updateSettings} className="stack">
        <section className="panel">
          <h2>ที่จอด</h2>
          <div className="form grid2">
            {field('total_spots', 'จำนวนช่องจอดทั้งหมด', 'ช่องทั้งหมดในลาน', 'ช่อง', 1)}
            {field('reserve_spots', 'ช่องสำรอง', 'ไม่เปิดให้จองล่วงหน้า เก็บไว้ให้คนที่จอดเกินวัน', 'ช่อง')}
          </div>
        </section>
        <section className="panel">
          <h2>ราคา</h2>
          <div className="form grid2">
            {field('price_per_day', 'ค่าจอดต่อวัน', 'นับตามวันในปฏิทิน', 'บาท')}
            {field('extra_price_per_day', 'ค่าจอดเพิ่ม/เกินวัน', 'ต่อวัน', 'บาท')}
            {field('shuttle_price', 'รถรับส่งไป-กลับ', 'ต่อการจอง', 'บาท')}
          </div>
        </section>
        <section className="panel">
          <h2>กติกาและรถรับส่ง</h2>
          <div className="form grid2">
            {field('hold_minutes', 'เวลากันที่รอจ่ายเงิน', 'ไม่จ่ายภายในเวลานี้ ระบบคืนที่ให้คนอื่น (5–120)', 'นาที', 5)}
            {field('reschedule_min_days', 'เลื่อนวันได้ล่วงหน้าอย่างน้อย', 'ก่อนวันเข้าจอดเดิม', 'วัน')}
            <label className="span2">จุดนัดรับขากลับ<input name="pickup_meeting_point" defaultValue={s.pickup_meeting_point} required /><small>แสดงให้ลูกค้าในหน้าจองและข้อความยืนยัน</small></label>
          </div>
        </section>
        <div className="form-actions"><Submit>บันทึกการตั้งค่า</Submit></div>
      </ActionForm>
    </main>
  );
}
