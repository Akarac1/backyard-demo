import { db } from '@/lib/supabase';
import { requireStaff } from '@/lib/auth';
import { ActionButton, ActionForm, Submit } from '@/components/ActionForm';
import { addVipPlate, grantBlackDiamond, removeVipPlate, revokeBlackDiamond, setBlackDiamondActive } from '../../actions';
import { thDate, bkkDay } from '@/lib/format';
import { MemberCard } from '@/components/MemberCard';

export const dynamic = 'force-dynamic';

type Card = { customer_id: string; note: string | null; active: boolean; created_at: string; customers: { name: string; phone: string; member_no: string | null } | null };
type Plate = { id: string; customer_id: string; plate: string; plate_province: string };
type Found = { id: string; name: string; phone: string; member_no: string | null };
const fmtPhone = (p: string) => p.length === 10 ? `${p.slice(0, 3)}-${p.slice(3, 6)}-${p.slice(6)}` : p;

/** Secret page, admins only: the Black Diamond card is held by a member; their plates are let in by the plate reader. */
export default async function BlackDiamondPage({ searchParams }: { searchParams: Promise<{ m?: string }> }) {
  await requireStaff(['admin']);
  const { m } = await searchParams;
  const mq = (m ?? '').replace(/[%,()\\]/g, ' ').trim().slice(0, 40);
  const sb = db();
  const [{ data: cards }, { data: plates }, { data: s }, { count: pending }, found] = await Promise.all([
    sb.from('black_diamond').select('customer_id, note, active, created_at, customers(name, phone, member_no)').order('created_at', { ascending: false }),
    sb.from('vip_plates').select('id, customer_id, plate, plate_province').order('created_at'),
    sb.from('settings').select('reserve_spots').eq('id', 1).single(),
    sb.from('lpr_vip_sync').select('id', { count: 'exact', head: true }).neq('status', 'done'),
    mq ? sb.rpc('customer_lookup', { p_q: mq, p_only_manual: false }) : Promise.resolve({ data: [] as Found[] }),
  ]);
  const list = (cards ?? []) as unknown as Card[];
  const byCustomer = new Map<string, Plate[]>();
  for (const p of (plates ?? []) as Plate[]) byCustomer.set(p.customer_id, [...(byCustomer.get(p.customer_id) ?? []), p]);
  const have = new Set(list.map((c) => c.customer_id));
  const hits = ((found.data ?? []) as Found[]).slice(0, 10);
  const activePlates = list.filter((c) => c.active).reduce((a, c) => a + (byCustomer.get(c.customer_id)?.length ?? 0), 0);
  const reserve = s?.reserve_spots ?? 0;

  return (
    <main className="page">
      <header className="page-head">
        <div>
          <h1>Black Diamond</h1>
          <p>บัตรสำหรับครอบครัวและบุคคลพิเศษ ผูกกับสมาชิก และมีแอดมินเท่านั้นที่มอบบัตรได้ เมื่อเชื่อมกล้องอ่านป้ายทะเบียนแล้ว รถของสมาชิกที่เพิ่มป้ายไว้เข้าลานได้เลยโดยไม่ต้องจอง ไม่จำกัดวัน ใช้ช่องสำรอง</p>
        </div>
      </header>

      <section className="tiles">
        <div className="tile"><span>สมาชิกที่มีบัตร</span><b>{list.filter((c) => c.active).length}<small> คน</small></b><em>ทั้งหมด {list.length} บัตร</em></div>
        <div className={`tile ${activePlates > reserve ? 'tile-warn' : ''}`}><span>ป้ายที่เปิดสิทธิ์ / ช่องสำรอง</span><b>{activePlates}<small> / {reserve}</small></b><em>{activePlates > reserve ? 'ป้ายมากกว่าช่องสำรอง ถ้าเข้าพร้อมกันอาจไม่พอ' : 'ใช้ร่วมกับรถที่จอดเกินวัน'}</em></div>
        <div className="tile"><span>รอส่งให้ระบบกล้อง</span><b>{pending ?? 0}<small> รายการ</small></b><em>ส่งอัตโนมัติเมื่อเชื่อมกล้องแล้ว</em></div>
      </section>

      <section className="panel">
        <div className="panel-head">
          <h2>มอบบัตรให้สมาชิก</h2>
          <form className="search" action="/admin/members/black-diamond"><input name="m" defaultValue={m ?? ''} placeholder="ชื่อ / เบอร์โทร / เลขสมาชิก (BY…)" aria-label="ค้นหาสมาชิก" /><button className="b b-primary">ค้นหา</button></form>
        </div>
        {!mq ? <p className="hint">ค้นหาสมาชิกก่อน แล้วกด “มอบบัตร” · ต้องเป็นลูกค้าที่มีในระบบแล้ว</p> : !hits.length ? <p className="empty">ไม่พบสมาชิกที่ตรงกับ “{mq}”</p> : (
          <table className="tbl">
            <thead><tr><th>สมาชิก</th><th>เลขสมาชิก</th><th></th></tr></thead>
            <tbody>
              {hits.map((h) => (
                <tr key={h.id}>
                  <td><b>{h.name}</b><small>{fmtPhone(h.phone)}</small></td>
                  <td>{h.member_no ?? '—'}</td>
                  <td>{have.has(h.id) ? <small>มีบัตรแล้ว</small> : (
                    <ActionForm action={grantBlackDiamond} className="tier-row" confirm={`มอบบัตร Black Diamond ให้ ${h.name}?`}>
                      <input type="hidden" name="customer_id" value={h.id} />
                      <input name="note" placeholder="หมายเหตุ (ไม่บังคับ)" aria-label="หมายเหตุ" />
                      <Submit small>มอบบัตร</Submit>
                    </ActionForm>
                  )}</td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </section>

      <section className="panel">
        <h2>บัตรที่มอบแล้ว</h2>
        {!list.length ? <p className="empty">ยังไม่มีสมาชิกที่ได้รับบัตร</p> : list.map((c) => {
          const ps = byCustomer.get(c.customer_id) ?? [];
          return (
            <div key={c.customer_id} className="bd-card">
              <div className="bd-head">
                <div><b>◆ {c.customers?.name ?? '-'}</b><small>{c.customers?.phone ? fmtPhone(c.customers.phone) : ''}{c.customers?.member_no ? ` · ${c.customers.member_no}` : ''} · มอบเมื่อ {thDate(bkkDay(c.created_at))}{c.note ? ` · ${c.note}` : ''}</small></div>
                <div style={{ display: 'flex', gap: 6, alignItems: 'center' }}>
                  <span className={`tag ${c.active ? '' : 'tag-warn'}`}>{c.active ? 'เปิดสิทธิ์' : 'พักสิทธิ์'}</span>
                  <ActionButton action={setBlackDiamondActive} fields={{ customer_id: c.customer_id, active: c.active ? '0' : '1' }} label={c.active ? 'พักสิทธิ์' : 'เปิดสิทธิ์'} />
                  <ActionButton action={revokeBlackDiamond} fields={{ customer_id: c.customer_id }} label="ยกเลิกบัตร" variant="danger" confirm={`ยกเลิกบัตรของ ${c.customers?.name ?? ''} และลบป้ายทะเบียนทั้งหมดของบัตรนี้?`} />
                </div>
              </div>
              <div className="bd-preview"><MemberCard tier="blackdiamond" tierName="Black Diamond" name={c.customers?.name} memberNo={c.customers?.member_no} /></div>
              <div className="bd-plates">
                {ps.length === 0 && <small>ยังไม่มีป้ายทะเบียน</small>}
                {ps.map((p) => (
                  <span key={p.id} className="bd-plate"><b>{p.plate}</b>{p.plate_province && <small>{p.plate_province}</small>}
                    <ActionButton action={removeVipPlate} fields={{ id: p.id }} label="✕" variant="plain" confirm={`ลบป้าย ${p.plate}?`} />
                  </span>
                ))}
              </div>
              <ActionForm action={addVipPlate} className="tier-row" resetOnOk>
                <input type="hidden" name="customer_id" value={c.customer_id} />
                <input name="plate" placeholder="ทะเบียน เช่น กข 1234" required maxLength={14} aria-label="ทะเบียน" />
                <input name="province" placeholder="จังหวัด (ไม่บังคับ)" aria-label="จังหวัด" />
                <Submit small>เพิ่มป้าย</Submit>
              </ActionForm>
            </div>
          );
        })}
        <p className="hint">ยังไม่ได้เชื่อมกล้องอ่านป้ายทะเบียน การเพิ่ม/พัก/ลบจะเข้าคิวแล้วส่งให้กล้องเมื่อเชื่อมต่อ · ทุกการเปลี่ยนแปลงมีบันทึกประวัติ</p>
      </section>
    </main>
  );
}
