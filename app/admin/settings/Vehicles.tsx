import { db } from '@/lib/supabase';
import { ActionForm, Submit } from '@/components/ActionForm';
import { deleteVehicle, saveVehicle } from '../actions';

type V = { id: string; name: string; plate: string | null; model: string | null; seats: number; active: boolean; note: string | null; luggage_units: number; max_bags: number; priority: number; reserve: boolean };

/** how many 28-29" bags fit, from the luggage units (large = 2 units) */
const largeFit = (v: V) => Math.min(Math.floor(v.luggage_units / 2), v.max_bags);

function Fields({ v }: { v?: V }) {
  return (
    <>
      {v && <input type="hidden" name="id" value={v.id} />}
      <div className="form veh-grid">
        <label>ชื่อเรียก<input name="name" defaultValue={v?.name ?? ''} placeholder="คันที่ 3" maxLength={40} required /></label>
        <label>ทะเบียนรถ<input name="plate" defaultValue={v?.plate ?? ''} placeholder="ฮห 1234 กรุงเทพมหานคร" maxLength={30} /><small>แสดงในการ์ดที่ส่งให้ลูกค้า</small></label>
        <label>รุ่น / สี<input name="model" defaultValue={v?.model ?? ''} placeholder="Toyota Commuter สีขาว" maxLength={60} /><small>ช่วยให้ลูกค้าหารถเจอ</small></label>
        <label>รองรับผู้โดยสาร<span className="with-unit"><input name="seats" type="number" min={1} max={30} defaultValue={v?.seats ?? 7} required /><em>คน</em></span></label>
        <label>ความจุกระเป๋า<span className="with-unit"><input name="luggage_units" type="number" min={0} max={60} defaultValue={v?.luggage_units ?? 6} required /><em>หน่วย</em></span><small>ใบใหญ่ 28–29" = 2 หน่วย · ใบกลาง/เล็ก = 1 หน่วย</small></label>
        <label>ใส่ได้รวมไม่เกิน<span className="with-unit"><input name="max_bags" type="number" min={0} max={30} defaultValue={v?.max_bags ?? 4} required /><em>ใบ</em></span><small>นับทุกขนาด (ไม่นับกระเป๋าถือขึ้นเครื่อง)</small></label>
        <label>ลำดับการใช้<span className="with-unit"><input name="priority" type="number" min={1} max={9} defaultValue={v?.priority ?? 1} required /><em>(1 = ใช้ก่อน)</em></span><small>ลำดับเท่ากัน ระบบเลือกคันที่เล็กที่สุดที่พอ เพื่อเก็บคันใหญ่ไว้ให้กลุ่มใหญ่</small></label>
        <label className="check veh-active"><input type="checkbox" name="reserve" defaultChecked={v?.reserve ?? false} /> รถสำรองฉุกเฉิน (ลูกค้าจองไม่ถึง ระบบไม่จัดให้เอง แอดมินเลือกใช้เองในหน้ารถรับส่ง)</label>
        <label className="veh-note">หมายเหตุ (เห็นเฉพาะทีมงาน)<input name="note" defaultValue={v?.note ?? ''} placeholder="เช่น ต่อภาษีเดือน มี.ค." maxLength={120} /></label>
        <label className="check veh-active"><input type="checkbox" name="active" defaultChecked={v?.active ?? true} /> ใช้งาน (จัดงานรับส่งให้คันนี้ได้)</label>
      </div>
    </>
  );
}

/** Shuttle vehicles: edit, add, remove. */
export async function Vehicles() {
  const sb = db();
  const { data } = await sb.from('vehicles').select('id, name, plate, model, seats, active, note, luggage_units, max_bags, priority, reserve').is('deleted_at', null).order('priority').order('created_at').order('name');
  const list = (data ?? []) as V[];
  const counts = await Promise.all(list.map((v) => sb.rpc('vehicle_open_trips', { p_vehicle: v.id }).then((r) => Number(r.data ?? 0))));
  return (
    <section className="panel">
      <h2>รถรับส่ง</h2>
      <p className="hint">ทะเบียนและรุ่นจะแสดงในการ์ดที่ส่งให้ลูกค้าตอนคนขับออกรถ · ระบบจัดรถให้อัตโนมัติจากจำนวนที่นั่งและกระเป๋า (ต้องพอทั้งสองอย่าง) ใช้รถลำดับ 1 ก่อน · รถสำรองฉุกเฉินไม่นับรวมตอนลูกค้าจอง</p>
      <div className="veh-list">
        {list.map((v, i) => (
          <div key={v.id} className={`veh-card${v.active ? '' : ' off'}`}>
            <div className="veh-head">
              <div>
                <b>{v.name}</b>{!v.active && <span className="st">ปิดใช้งาน</span>}{v.reserve ? <span className="st st-reserve">สำรองฉุกเฉิน</span> : <span className="st st-pri">ใช้ลำดับ {v.priority}</span>}
                <span className="veh-sub">{[v.model, v.plate ?? 'ยังไม่ใส่ทะเบียน'].filter(Boolean).join(' · ')} · {v.seats} ที่นั่ง · กระเป๋าใหญ่ได้ {largeFit(v)} ใบ หรือรวม {v.max_bags} ใบ ({v.luggage_units} หน่วย){counts[i] ? ` · งานที่รออยู่ ${counts[i]} งาน` : ''}</span>
              </div>
              <ActionForm action={deleteVehicle} className="veh-del"
                confirm={`ลบ “${v.name}”${v.plate ? ` (${v.plate})` : ''}? ถ้ามีประวัติงาน ระบบจะเก็บประวัติไว้ในรายงาน แต่รถจะหายจากรายการ`}>
                <input type="hidden" name="id" value={v.id} />
                <Submit variant="danger" small>ลบ</Submit>
              </ActionForm>
            </div>
            <details className="veh-edit">
              <summary>แก้ไข</summary>
              <ActionForm action={saveVehicle}>
                <Fields v={v} />
                <div className="form-actions"><Submit small>บันทึก</Submit></div>
              </ActionForm>
            </details>
          </div>
        ))}
      </div>
      <details className="veh-add">
        <summary>+ เพิ่มรถคันใหม่</summary>
        <ActionForm action={saveVehicle} resetOnOk>
          <Fields />
          <div className="form-actions"><Submit>เพิ่มรถ</Submit></div>
        </ActionForm>
      </details>
    </section>
  );
}
