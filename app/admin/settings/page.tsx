import { db } from '@/lib/supabase';
import { ActionForm, Submit } from '@/components/ActionForm';
import { setContact, setDispatch, setExitMinutes, updateSettings } from '../actions';
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
      <section className="panel">
        <h2>การจัดรถอัตโนมัติ</h2>
        <p className="hint">ขาไป: จัดรถตอนลูกค้าชำระเงิน และคิดใหม่เองเมื่อรถว่างเร็วกว่าแผน · ขากลับ: จัดรถตอนลูกค้ากดเรียก ตามคิว ให้คันที่ถึงเร็วที่สุด (คันที่อยู่สนามบินก่อน) ถ้าถึงใกล้กันเลือกคันที่เล็กและประหยัดกว่า · รถที่เพิ่งส่งลูกค้าที่สนามบินรับลูกค้าขากลับที่พร้อมใกล้ ๆ ต่อได้เลย · ระบบรู้ตำแหน่งรถจากปุ่มสถานะของคนขับ</p>
        <ActionForm action={setDispatch} className="form grid2">
          <label>เวลาวิ่ง ลาน ↔ สนามบิน<span className="with-unit"><input name="drive" type="number" min={5} max={90} defaultValue={s.drive_minutes ?? 15} required /><em>นาที</em></span><small>ใช้คำนวณเวลาที่รถจะถึง</small></label>
          <label>รอรับต่อที่สนามบินได้ไม่เกิน<span className="with-unit"><input name="wait" type="number" min={0} max={60} defaultValue={s.airport_wait_minutes ?? 15} required /><em>นาที</em></span><small>คนขับที่ส่งลูกค้าแล้วรอรับคนที่พร้อมภายในเวลานี้ (0 = ไม่รอ)</small></label>
          <label>เลือกคันประหยัดกว่าได้ ถ้าช้ากว่าไม่เกิน<span className="with-unit"><input name="slack" type="number" min={0} max={60} defaultValue={s.cheaper_slack_minutes ?? 10} required /><em>นาที</em></span><small>เทียบกับคันที่ถึงเร็วที่สุด (0 = เอาคันเร็วสุดเสมอ)</small></label>
          <label>ไม่เปลี่ยนรถเมื่อเหลือเวลาก่อนรับน้อยกว่า<span className="with-unit"><input name="freeze" type="number" min={0} max={60} defaultValue={s.freeze_minutes ?? 10} required /><em>นาที</em></span><small>กันคนขับสับสนจากรถเปลี่ยนกะทันหัน</small></label>
          <div className="form-actions span2"><Submit>บันทึกการจัดรถ</Submit></div>
        </ActionForm>
      </section>
      <section className="panel">
        <h2>เวลาจากเครื่องลงถึงออกโถง</h2>
        <p className="hint">ลูกค้ากรอกเวลาเครื่องลงตอนจอง ระบบบวกเวลานี้เป็นเวลานัดรับโดยประมาณ ใช้เช็กว่ารถพอไหมและแสดงบนจอ TV/หน้าคนขับ · รถออกจริงเมื่อลูกค้ากดเรียก · มีผลกับการจองใหม่ (การจองเดิมไม่เปลี่ยน)</p>
        <ActionForm action={setExitMinutes} className="form grid2">
          <label>เที่ยวบินในประเทศ<span className="with-unit"><input name="domestic" type="number" min={0} max={180} defaultValue={s.exit_minutes_domestic ?? 30} required /><em>นาที</em></span><small>ลงเครื่อง + รอกระเป๋า</small></label>
          <label>เที่ยวบินต่างประเทศ<span className="with-unit"><input name="international" type="number" min={0} max={180} defaultValue={s.exit_minutes_international ?? 60} required /><em>นาที</em></span><small>ลงเครื่อง + ผ่าน ตม. + รอกระเป๋า</small></label>
          <div className="form-actions span2"><Submit>บันทึกเวลาออกจากโถง</Submit></div>
        </ActionForm>
      </section>
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
