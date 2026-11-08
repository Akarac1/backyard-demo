import { db } from '@/lib/supabase';
import { requireStaff } from '@/lib/auth';
import { thDate, thTime } from '@/lib/format';
import { ActionForm, Submit } from '@/components/ActionForm';
import { createStaff, updateStaff } from '../actions';

export const dynamic = 'force-dynamic';

type U = { id: string; username: string; display_name: string; role: 'admin' | 'exec' | 'driver'; active: boolean; last_login_at: string | null; locked_until: string | null; vehicle_id: string | null };
const ROLE = { admin: ['แอดมิน', 'st-in'], exec: ['ผู้บริหาร', 'st-ok'], driver: ['คนขับ', 'st-done'] } as const;
const when = (ts: string) => `${thDate(new Date(ts).toLocaleDateString('en-CA', { timeZone: 'Asia/Bangkok' }))} ${thTime(ts)}`;

export default async function UsersPage() {
  const me = await requireStaff(['admin']);
  const [{ data }, { data: vehicles }] = await Promise.all([
    db().from('staff_users').select('id, username, display_name, role, active, last_login_at, locked_until, vehicle_id').order('created_at'),
    db().from('vehicles').select('id, name, seats').eq('active', true).order('seats'),
  ]);
  const vname = (id: string | null) => vehicles?.find((v) => v.id === id)?.name;
  const users = (data ?? []) as U[];
  return (
    <main className="page">
      <header className="page-head"><div><h1>ผู้ใช้หลังบ้าน</h1><p>แอดมินแก้ไขได้ทุกอย่าง · ผู้บริหารดูรายงาน · คนขับเห็นเฉพาะงานของรถตัวเอง</p></div></header>
      <div className="cols wide-left">
        <section className="panel flush">
          <ul className="users">
            {users.map((u) => (
              <li key={u.id}>
                <details>
                  <summary>
                    <span className="avatar" aria-hidden>{u.display_name.slice(0, 1)}</span>
                    <div><b>{u.display_name}{u.id === me.uid ? ' (คุณ)' : ''}</b><small>{u.username} · {u.last_login_at ? `เข้าล่าสุด ${when(u.last_login_at)}` : 'ยังไม่เคยเข้า'}</small></div>
                    <span className={`st ${ROLE[u.role][1]}`}>{ROLE[u.role][0]}{u.role === 'driver' ? ` · ${vname(u.vehicle_id) ?? 'ยังไม่ผูกรถ'}` : ''}</span>
                    {!u.active && <span className="st st-off">ปิดใช้งาน</span>}
                    {u.locked_until && Date.parse(u.locked_until) > Date.now() && <span className="st st-wait">ถูกล็อก</span>}
                  </summary>
                  <ActionForm action={updateStaff} className="form grid2 user-edit">
                    <input type="hidden" name="id" value={u.id} />
                    <label>ชื่อที่แสดง<input name="name" defaultValue={u.display_name} required /></label>
                    <label>สิทธิ์<select name="role" defaultValue={u.role}><option value="admin">แอดมิน</option><option value="exec">ผู้บริหาร</option><option value="driver">คนขับ</option></select></label>
                    <label>รถที่ขับ (สำหรับคนขับ)<select name="vehicle_id" defaultValue={u.vehicle_id ?? ''}><option value="">— ไม่ระบุ —</option>{(vehicles ?? []).map((v) => <option key={v.id} value={v.id}>{v.name} · {v.seats} ที่</option>)}</select></label>
                    <label>ตั้งรหัสผ่านใหม่ (เว้นว่างถ้าไม่เปลี่ยน)<input name="password" type="password" minLength={10} autoComplete="new-password" /></label>
                    <label className="check"><input name="active" type="checkbox" defaultChecked={u.active} /> เปิดใช้งาน</label>
                    <div className="form-actions span2"><Submit small>บันทึก</Submit></div>
                  </ActionForm>
                </details>
              </li>
            ))}
          </ul>
        </section>
        <section className="panel">
          <h2>เพิ่มผู้ใช้</h2>
          <ActionForm action={createStaff} className="form" resetOnOk>
            <label>ชื่อผู้ใช้ (ใช้ตอนเข้าระบบ)<input name="username" pattern="[a-zA-Z0-9._\-]{3,32}" autoCapitalize="none" required /><small>a-z 0-9 . _ - ยาว 3–32 ตัว</small></label>
            <label>ชื่อที่แสดง<input name="name" required /></label>
            <label>สิทธิ์<select name="role" defaultValue="exec"><option value="exec">ผู้บริหาร (ดูรายงาน)</option><option value="driver">คนขับ (งานรถรับส่ง)</option><option value="admin">แอดมิน (แก้ไขได้ทั้งหมด)</option></select></label>
            <label>รถที่ขับ (เฉพาะคนขับ)<select name="vehicle_id" defaultValue=""><option value="">— ไม่ระบุ —</option>{(vehicles ?? []).map((v) => <option key={v.id} value={v.id}>{v.name} · {v.seats} ที่</option>)}</select></label>
            <label>รหัสผ่านเริ่มต้น<input name="password" type="password" minLength={10} autoComplete="new-password" required /><small>อย่างน้อย 10 ตัว ให้ผู้ใช้เปลี่ยนเองที่ “บัญชีของฉัน”</small></label>
            <div className="form-actions"><Submit>เพิ่มผู้ใช้</Submit></div>
          </ActionForm>
        </section>
      </div>
    </main>
  );
}
