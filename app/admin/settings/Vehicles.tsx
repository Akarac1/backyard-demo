import { db } from '@/lib/supabase';
import { ActionForm, Submit } from '@/components/ActionForm';
import { deleteVehicle, saveVehicle } from '../actions';

type V = { id: string; name: string; plate: string | null; model: string | null; seats: number; active: boolean; note: string | null };

function Fields({ v }: { v?: V }) {
  return (
    <>
      {v && <input type="hidden" name="id" value={v.id} />}
      <div className="form veh-grid">
        <label>ชื่อเรียก<input name="name" defaultValue={v?.name ?? ''} placeholder="คันที่ 3" maxLength={40} required /></label>
        <label>ทะเบียนรถ<input name="plate" defaultValue={v?.plate ?? ''} placeholder="ฮห 1234 กรุงเทพมหานคร" maxLength={30} /><small>แสดงในการ์ดที่ส่งให้ลูกค้า</small></label>
        <label>รุ่น / สี<input name="model" defaultValue={v?.model ?? ''} placeholder="Toyota Commuter สีขาว" maxLength={60} /><small>ช่วยให้ลูกค้าหารถเจอ</small></label>
        <label>รองรับผู้โดยสาร<span className="with-unit"><input name="seats" type="number" min={1} max={30} defaultValue={v?.seats ?? 7} required /><em>คน</em></span></label>
        <label className="veh-note">หมายเหตุ (เห็นเฉพาะทีมงาน)<input name="note" defaultValue={v?.note ?? ''} placeholder="เช่น ต่อภาษีเดือน มี.ค." maxLength={120} /></label>
        <label className="check veh-active"><input type="checkbox" name="active" defaultChecked={v?.active ?? true} /> ใช้งาน (จัดงานรับส่งให้คันนี้ได้)</label>
      </div>
    </>
  );
}

/** Shuttle vehicles: edit, add, remove. */
export async function Vehicles() {
  const sb = db();
  const { data } = await sb.from('vehicles').select('id, name, plate, model, seats, active, note').is('deleted_at', null).order('created_at').order('name');
  const list = (data ?? []) as V[];
  const counts = await Promise.all(list.map((v) => sb.rpc('vehicle_open_trips', { p_vehicle: v.id }).then((r) => Number(r.data ?? 0))));
  return (
    <section className="panel">
      <h2>รถรับส่ง</h2>
      <p className="hint">ทะเบียนและรุ่นจะแสดงในการ์ดที่ส่งให้ลูกค้าตอนคนขับออกรถ · จำนวนที่นั่งใช้จัดงานให้รถอัตโนมัติ (ระบบเลือกคันที่นั่งพอ)</p>
      <div className="veh-list">
        {list.map((v, i) => (
          <div key={v.id} className={`veh-card${v.active ? '' : ' off'}`}>
            <div className="veh-head">
              <div>
                <b>{v.name}</b>{!v.active && <span className="st">ปิดใช้งาน</span>}
                <span className="veh-sub">{[v.model, v.plate ?? 'ยังไม่ใส่ทะเบียน'].filter(Boolean).join(' · ')} · {v.seats} ที่นั่ง{counts[i] ? ` · งานที่รออยู่ ${counts[i]} งาน` : ''}</span>
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
