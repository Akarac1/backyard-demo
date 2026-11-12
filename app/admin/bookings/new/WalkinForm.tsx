'use client';
import { useState } from 'react';
import { ActionForm, Submit } from '@/components/ActionForm';
import { walkinBooking } from '../../actions';

const money = (n: number) => `${n.toLocaleString('th-TH')} บาท`;

export function WalkinForm({ today, price, shuttlePrice, maxCars }: { today: string; price: number; shuttlePrice: number; maxCars: number }) {
  const [cars, setCars] = useState([{ plate: '', province: 'กรุงเทพมหานคร' }]);
  const [start, setStart] = useState(today);
  const [end, setEnd] = useState(today);
  const [shuttle, setShuttle] = useState(false);
  const days = end >= start ? Math.round((Date.parse(end) - Date.parse(start)) / 864e5) + 1 : 0;
  const total = days * price * cars.length + (shuttle ? shuttlePrice : 0);
  const upd = (i: number, k: 'plate' | 'province', v: string) => setCars(cars.map((c, j) => (j === i ? { ...c, [k]: v } : c)));
  return (
    <ActionForm action={walkinBooking} className="stack">
      <section className="panel">
        <h2>ลูกค้า</h2>
        <div className="form grid2">
          <label>ชื่อลูกค้า<input name="name" placeholder="เว้นว่างได้ ถ้าเป็นสมาชิกเดิมที่ใส่เบอร์" /><small>จำเป็นสำหรับลูกค้าใหม่</small></label>
          <label>เบอร์โทร<input name="phone" type="tel" inputMode="tel" placeholder="0812345678 (ไม่มีก็เว้นว่างได้)" /><small>ถ้าตรงกับสมาชิกเดิม ระบบใช้บัญชีเดิม</small></label>
        </div>
      </section>
      <section className="panel">
        <h2>รถ{cars.length > 1 ? ` (${cars.length} คัน · จ่ายรวม ใช้รถรับส่งเที่ยวเดียวกัน)` : ''}</h2>
        {cars.map((c, i) => (
          <div className="form grid2" key={i} style={{ marginBottom: 8 }}>
            <label>ทะเบียนรถ{cars.length > 1 ? ` คันที่ ${i + 1}` : ''}<input name="plate" value={c.plate} onChange={(e) => upd(i, 'plate', e.target.value)} placeholder="1กข 1234" required={i === 0} /></label>
            <label>จังหวัด<span className="with-unit"><input name="province" value={c.province} onChange={(e) => upd(i, 'province', e.target.value)} />
              {cars.length > 1 && <button type="button" className="b b-plain b-sm" onClick={() => setCars(cars.filter((_, j) => j !== i))} aria-label="ลบรถคันนี้">✕</button>}</span></label>
          </div>
        ))}
        {cars.length < maxCars && <button type="button" className="b b-plain b-sm" onClick={() => setCars([...cars, { plate: '', province: cars[0].province }])}>＋ เพิ่มรถอีกคัน (สูงสุด {maxCars} คัน)</button>}
      </section>
      <section className="panel">
        <h2>วันที่จอด</h2>
        <div className="form grid2">
          <label>วันเข้าจอด<input name="start" type="date" value={start} min={today} onChange={(e) => setStart(e.target.value)} required /></label>
          <label>วันรับรถคืน<input name="end" type="date" value={end} min={start} onChange={(e) => setEnd(e.target.value)} required /></label>
        </div>
      </section>
      <section className="panel">
        <h2>รถรับส่งสนามบิน</h2>
        <label className="check"><input type="checkbox" checked={shuttle} onChange={(e) => setShuttle(e.target.checked)} /> ใช้รถรับส่งไป-กลับ (+{money(shuttlePrice)})</label>
        {shuttle && (
          <>
            <input type="hidden" name="shuttle" value="1" />
            <div className="form grid2" style={{ marginTop: 10 }}>
              <label>ผู้โดยสาร{cars.length > 1 ? 'ทั้งกลุ่ม' : ''}<span className="with-unit"><input name="pax" type="number" min={1} max={7} defaultValue={2} required /><em>คน</em></span></label>
              <label>กระเป๋าใบใหญ่<span className="with-unit"><input name="large" type="number" min={0} max={20} defaultValue={0} /><em>ใบ</em></span></label>
              <label>ขาไป: เวลามาถึงลาน<input name="out" type="datetime-local" required /></label>
              <label>ขากลับ: เวลาเครื่องลง<input name="land" type="datetime-local" /><small>ไม่ทราบก็เว้นว่างได้ ตั้งเวลาทีหลังที่หน้ารถรับส่ง</small></label>
              <label>เลขไฟลต์ขากลับ<input name="flight" placeholder="TG 629" /></label>
              <label>เที่ยวบิน<select name="ftype" defaultValue="international"><option value="international">ต่างประเทศ</option><option value="domestic">ในประเทศ</option></select></label>
            </div>
          </>
        )}
      </section>
      <section className="panel">
        <h2>การรับเงิน</h2>
        <div className="form grid2">
          <label>รับเงินแบบ<select name="method" defaultValue="cash"><option value="cash">เงินสด (ยืนยันทันที)</option><option value="transfer">โอน ตรวจสลิปแล้ว (ยืนยันทันที)</option><option value="unpaid">ยังไม่รับเงิน (กันที่ไว้ 1 ชั่วโมง)</option></select></label>
          <label className="check" style={{ alignSelf: 'end' }}><input type="checkbox" name="checkin" /> รถมาถึงลานแล้ว เช็กอินเลย</label>
          <label className="span2">หมายเหตุ<input name="note" placeholder="เช่น มากับลูกหลาน / ลูกค้าฝากรถไว้ที่ร้าน" /></label>
        </div>
        <p className="hint" style={{ marginTop: 8 }}>ยอดโดยประมาณ <b>{days > 0 ? money(total) : '-'}</b> ({days} วัน × {cars.length} คัน{shuttle ? ' + รถรับส่ง' : ''}) · ยังไม่หักส่วนลดลูกค้าเก่า/แคมเปญ ระบบคิดยอดจริงตอนบันทึก</p>
        <div className="form-actions"><Submit>บันทึกการจอง</Submit></div>
      </section>
    </ActionForm>
  );
}
