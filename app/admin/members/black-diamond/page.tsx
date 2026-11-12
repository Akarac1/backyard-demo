import { db } from '@/lib/supabase';
import { ActionButton, ActionForm, Submit } from '@/components/ActionForm';
import { addVipPlate, removeVipPlate, setVipActive } from '../../actions';
import { thDate, bkkDay } from '@/lib/format';

export const dynamic = 'force-dynamic';

type Vip = { id: string; plate: string; plate_province: string; holder_name: string | null; note: string | null; active: boolean; created_at: string };

/** Secret page: Black Diamond plates. Plate only, no member account, no end date. */
export default async function BlackDiamondPage() {
  const sb = db();
  const [{ data }, { data: s }, { count: pending }] = await Promise.all([
    sb.from('vip_plates').select('*').order('created_at', { ascending: false }),
    sb.from('settings').select('reserve_spots').eq('id', 1).single(),
    sb.from('lpr_vip_sync').select('id', { count: 'exact', head: true }).neq('status', 'done'),
  ]);
  const list = (data ?? []) as Vip[];
  const active = list.filter((v) => v.active).length;
  const reserve = s?.reserve_spots ?? 0;

  return (
    <main className="page">
      <header className="page-head">
        <div>
          <h1>Black Diamond</h1>
          <p>บัตรสำหรับครอบครัวและบุคคลพิเศษ แยกจากระบบสมาชิก เพิ่มแค่ป้ายทะเบียน เมื่อเชื่อมกล้องอ่านป้ายแล้วรถเข้าลานได้เลยโดยไม่ต้องจอง ไม่จำกัดวัน ใช้ช่องสำรอง</p>
        </div>
      </header>

      <section className="tiles">
        <div className="tile"><span>ป้ายที่เปิดสิทธิ์</span><b>{active}<small> ป้าย</small></b><em>ทั้งหมด {list.length} ป้าย</em></div>
        <div className={`tile ${active > reserve ? 'tile-warn' : ''}`}><span>ช่องสำรองของลาน</span><b>{reserve}<small> ช่อง</small></b><em>{active > reserve ? 'ป้ายมากกว่าช่องสำรอง ถ้าเข้าพร้อมกันอาจไม่พอ' : 'ใช้ร่วมกับรถที่จอดเกินวัน'}</em></div>
        <div className="tile"><span>รอส่งให้ระบบกล้อง</span><b>{pending ?? 0}<small> รายการ</small></b><em>ส่งอัตโนมัติเมื่อเชื่อมกล้องแล้ว</em></div>
      </section>

      <section className="panel">
        <h2>เพิ่มป้ายทะเบียน</h2>
        <ActionForm action={addVipPlate} className="form grid2" resetOnOk>
          <label>ทะเบียน<input name="plate" placeholder="เช่น กข 1234" required maxLength={14} /></label>
          <label>จังหวัด (ไม่บังคับ)<input name="province" placeholder="กรุงเทพมหานคร" /></label>
          <label>ชื่อ/ครอบครัว (ไม่บังคับ)<input name="holder" placeholder="ใช้จำเท่านั้น ไม่แสดงให้ลูกค้า" /></label>
          <label>หมายเหตุ<input name="note" /></label>
          <div className="form-actions span2"><Submit>เพิ่มป้ายทะเบียน</Submit></div>
        </ActionForm>
      </section>

      <section className="panel">
        <h2>รายการป้ายทะเบียน</h2>
        {!list.length ? <p className="empty">ยังไม่มีป้ายทะเบียน</p> : (
          <table className="tbl">
            <thead><tr><th>ทะเบียน</th><th>ชื่อ/ครอบครัว</th><th>หมายเหตุ</th><th>เพิ่มเมื่อ</th><th>สถานะ</th><th></th></tr></thead>
            <tbody>
              {list.map((v) => (
                <tr key={v.id}>
                  <td><b>{v.plate}</b>{v.plate_province && <small>{v.plate_province}</small>}</td>
                  <td>{v.holder_name ?? '—'}</td>
                  <td>{v.note ?? '—'}</td>
                  <td>{thDate(bkkDay(v.created_at))}</td>
                  <td>{v.active ? 'เปิดสิทธิ์' : 'พักสิทธิ์'}</td>
                  <td style={{ display: 'flex', gap: 6 }}>
                    <ActionButton action={setVipActive} fields={{ id: v.id, active: v.active ? '0' : '1' }} label={v.active ? 'พักสิทธิ์' : 'เปิดสิทธิ์'} />
                    <ActionButton action={removeVipPlate} fields={{ id: v.id }} label="ลบ" variant="danger" confirm={`ลบป้าย ${v.plate} ออกจากรายการ?`} />
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
        <p className="hint">ตอนนี้ยังไม่ได้เชื่อมกล้องอ่านป้ายทะเบียน รายการที่เพิ่ม/พัก/ลบจะเข้าคิว แล้วส่งให้กล้องเมื่อเชื่อมต่อแล้ว · การเปลี่ยนแปลงทุกครั้งมีบันทึกประวัติ</p>
      </section>
    </main>
  );
}
