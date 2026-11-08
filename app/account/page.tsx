import { requireStaff } from '@/lib/auth';
import { ActionForm, Submit } from '@/components/ActionForm';
import { changeOwnPassword } from '@/app/admin/actions';

export default async function AccountPage() {
  const s = await requireStaff(['admin', 'exec', 'driver']);
  return (
    <main className="page narrow">
      <header className="page-head"><div><h1>บัญชีของฉัน</h1><p>{s.name} · {s.username} · {s.role === 'admin' ? 'แอดมิน' : s.role === 'driver' ? 'คนขับ' : 'ผู้บริหาร'}</p></div></header>
      <section className="panel">
        <h2>เปลี่ยนรหัสผ่าน</h2>
        <ActionForm action={changeOwnPassword} resetOnOk className="form">
          <label>รหัสผ่านเดิม<input name="old" type="password" autoComplete="current-password" required /></label>
          <label>รหัสผ่านใหม่ (อย่างน้อย 10 ตัว)<input name="new" type="password" autoComplete="new-password" minLength={10} required /></label>
          <label>ยืนยันรหัสผ่านใหม่<input name="confirm" type="password" autoComplete="new-password" minLength={10} required /></label>
          <div className="form-actions"><Submit>เปลี่ยนรหัสผ่าน</Submit></div>
        </ActionForm>
      </section>
    </main>
  );
}
