import { db } from '@/lib/supabase';
import { ActionForm, Submit } from '@/components/ActionForm';
import { setContact, setDispatch, setExitMinutes, setGroupMax, setLateGraceHour, setMemberDiscount, setMemberDiscountRules, setPointsSettings, updateSettings } from '../actions';
import { Vehicles } from './Vehicles';
import { TvLink } from './TvLink';
import { NotePresets } from './NotePresets';

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
      <section className="panel" id="group">
        <h2>จองหลายคัน (Group)</h2>
        <p className="hint">ลูกค้าจองหลายคันในครั้งเดียว (ทัวร์ ครอบครัวหลายคัน) · ใช้วันเข้า-ออกเดียวกัน จ่ายยอดรวมครั้งเดียว · รถรับส่งไป-กลับ 1 เที่ยวสำหรับทั้งกลุ่ม (คนและกระเป๋ารวมกันต้องพอดีรถ 1 คัน) · ส่วนลดลูกค้าเก่า/เพื่อนแนะนำ ใช้ 1 ครั้งต่อกลุ่ม</p>
        <ActionForm action={setGroupMax} className="form grid2">
          <label>จองพร้อมกันได้สูงสุด<span className="with-unit"><input name="max" type="number" min={2} max={20} defaultValue={s.group_max_cars ?? 5} required /><em>คัน</em></span><small>รวมคันแรก (2–20)</small></label>
          <div className="form-actions span2"><Submit>บันทึก</Submit></div>
        </ActionForm>
      </section>
      <section className="panel">
        <h2>ผ่อนผันรถรอบดึก (ภายใน)</h2>
        <p className="hint">ลูกค้าที่เครื่องลงขากลับตั้งแต่เวลานี้ของวันสุดท้ายเป็นต้นไป ระบบให้จอดต่อได้อีก 1 วันโดยไม่คิดเพิ่ม และไม่ขึ้นเตือนว่าเกินกำหนด · ไม่แจ้งลูกค้า · ใช้ช่องสำรอง · เห็นเฉพาะพนักงาน</p>
        <ActionForm action={setLateGraceHour} className="form grid2">
          <label>เครื่องลงตั้งแต่เวลา<span className="with-unit"><input name="hour" type="number" min={18} max={23} defaultValue={s.late_grace_hour ?? 22} required /><em>น.</em></span><small>เช่น 22 = 22:00 ขึ้นไป (ใส่ได้ 18–23)</small></label>
          <div className="form-actions span2"><Submit>บันทึกเวลาผ่อนผัน</Submit></div>
        </ActionForm>
      </section>
    <section className="panel" id="points">
      <h2>กติกาแต้มสะสม</h2>
      <p className="hint">แต้มได้เมื่อชำระเงินสำเร็จ คิดจากยอดที่จ่ายจริง · ลูกค้าเอาแต้มไปแลกคูปองจากรายการของรางวัล · แต้มเก่าถูกใช้ก่อน</p>
      <ActionForm action={setPointsSettings} className="form grid2">
        <label>ทุกกี่บาทได้ 1 แต้ม<span className="with-unit"><input name="per_baht" type="number" min={1} defaultValue={s?.points_per_baht ?? 100} required /><em>บาท</em></span></label>
        <input type="hidden" name="value" value={s?.point_value ?? 10} />
        <label>แนะนำเพื่อนได้<span className="with-unit"><input name="referral" type="number" min={0} defaultValue={s?.referral_points ?? 3} required /><em>แต้ม</em></span></label>
        <label>อายุแต้ม<span className="with-unit"><input name="months" type="number" min={1} max={120} defaultValue={s?.points_expiry_months ?? 36} required /><em>เดือน</em></span></label>
        <label className="check span2"><input type="checkbox" name="enabled" defaultChecked={s?.points_enabled ?? true} /> เปิดใช้ระบบแต้ม</label>
        <div className="form-actions span2"><Submit>บันทึกกติกา</Submit></div>
      </ActionForm>
      <p className="hint" style={{ marginTop: 8 }}>ตัวอย่าง: จ่าย 600 บาท ได้ {Math.floor(600 / (s?.points_per_baht || 100))} แต้ม</p>
    </section>
    <section className="panel" id="discount">
      <h2>จำนวนส่วนลด</h2>
      <p className="hint">ลดต่อการจองหนึ่งครั้ง ใส่ 0 เพื่อปิดส่วนลด มีผลกับการจองใหม่ทันที</p>
      <ActionForm action={setMemberDiscount} className="form">
        <label>ส่วนลด<span className="with-unit"><input name="amount" type="number" min={0} max={10000} defaultValue={s?.member_discount ?? 100} required /><em>บาท</em></span></label>
        <div className="form-actions"><Submit>บันทึก</Submit></div>
      </ActionForm>
      <h3 style={{ marginTop: 18 }}>เงื่อนไขการจอง</h3>
      <ActionForm action={setMemberDiscountRules} className="form grid2">
        <label>จองอย่างน้อย<span className="with-unit"><input name="min_days" type="number" min={1} max={60} defaultValue={s?.member_discount_min_days ?? 3} required /><em>วัน</em></span></label>
        <label className="check" style={{ alignSelf: 'end' }}><input type="checkbox" name="needs_shuttle" defaultChecked={s?.member_discount_needs_shuttle ?? true} /> ต้องใช้รถรับส่ง</label>
        <div className="form-actions span2"><Submit small variant="plain">บันทึกเงื่อนไข</Submit></div>
      </ActionForm>
      <h3 style={{ marginTop: 18 }}>ใครได้ส่วนลด</h3>
      <ul className="hint" style={{ paddingLeft: 18, margin: 0 }}>
        <li>เบอร์ของผู้จองอยู่ในรายชื่อที่นำเข้า (หน้าสมาชิก) หรือเคยจองและจ่ายเงินในระบบแล้ว</li>
        <li>ลูกค้าใหม่ที่กรอก “เบอร์ลูกค้าเก่าที่แนะนำ” ตรงกับข้อแรก (ใส่เบอร์ตัวเองไม่ได้)</li>
        <li>ลูกค้าที่มาจากเพื่อนแนะนำ จองครั้งต่อไปจะนับเป็นลูกค้าเก่าเอง</li>
      </ul>
    </section>
      <NotePresets initial={(s.driver_note_presets as string[] | null) ?? []} />
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
