import Link from 'next/link';
import { db } from '@/lib/supabase';
import { todayBkk, thDate } from '@/lib/format';
import { ActionForm, Submit } from '@/components/ActionForm';
import { givePoints } from '@/app/admin/actions';
import { OpsRow, OPS_SELECT, type OpsBooking } from './OpsRow';

export const dynamic = 'force-dynamic';

const daysBetween = (a: string, b: string) => Math.round((Date.parse(`${b}T00:00:00Z`) - Date.parse(`${a}T00:00:00Z`)) / 86400000);

export default async function OpsPage({ searchParams }: { searchParams: Promise<{ q?: string }> }) {
  const { q: rawQ } = await searchParams;
  const q = (rawQ ?? '').replace(/[,()*%\\]/g, ' ').trim().slice(0, 40);
  const today = todayBkk();
  const sb = db();
  await sb.rpc('expire_holds').then(() => null, () => null);

  const [{ data: arr }, { data: dep }, { count: inLot }, { data: late }, { data: over }, { data: st }] = await Promise.all([
    sb.from('bookings').select(OPS_SELECT).eq('start_date', today).in('status', ['confirmed', 'checked_in']).order('created_at'),
    sb.from('bookings').select(OPS_SELECT).eq('end_date', today).in('status', ['checked_in', 'checked_out']).order('checked_out_at', { ascending: true, nullsFirst: true }),
    sb.from('bookings').select('id', { count: 'exact', head: true }).eq('status', 'checked_in'),
    sb.from('bookings').select(OPS_SELECT).eq('status', 'confirmed').lt('start_date', today).order('start_date').limit(50),
    sb.from('bookings').select(OPS_SELECT).eq('status', 'checked_in').lt('end_date', today).order('end_date').limit(50),
    sb.from('settings').select('ops_points_max, extra_price_per_day').eq('id', 1).single(),
  ]);
  const A = (arr ?? []) as unknown as OpsBooking[];
  const D = (dep ?? []) as unknown as OpsBooking[];
  const L = (late ?? []) as unknown as OpsBooking[];
  const O = (over ?? []) as unknown as OpsBooking[];

  let found: OpsBooking[] = [];
  if (q) {
    const digits = q.replace(/\D/g, '');
    const { data: custs } = await sb.from('customers').select('id')
      .or(`name.ilike.%${q}%,member_no.eq.${q.toUpperCase().replace(/[^A-Z0-9]/g, '') || 'x'}${digits.length >= 4 ? `,phone.ilike.%${digits}%` : ''}`).limit(100);
    const ors = [`code.ilike.%${q}%`, `plate.ilike.%${q.replace(/\s+/g, '')}%`];
    if (custs?.length) ors.push(`customer_id.in.(${custs.map((c) => c.id).join(',')})`);
    const { data } = await sb.from('bookings').select(OPS_SELECT).or(ors.join(',')).in('status', ['confirmed', 'checked_in', 'checked_out'])
      .order('start_date', { ascending: false }).limit(20);
    found = (data ?? []) as unknown as OpsBooking[];
  }

  return (
    <main className="page">
      <header className="page-head">
        <div><h1>หน้างาน · {thDate(today)}</h1><p>ลูกค้าที่ใช้รถรับส่ง: ระบบบันทึกรถเข้า-ออกให้เองจากปุ่มของคนขับ · ลูกค้าไม่ใช้รถรับส่ง: สแกน QR ในการจองของลูกค้า หรือกดที่นี่</p></div>
        <form className="search" action="/ops"><input name="q" defaultValue={rawQ} placeholder="ทะเบียน / รหัส / เบอร์ / เลขสมาชิก" aria-label="ค้นหา" autoFocus /><button className="b b-primary">ค้นหา</button></form>
      </header>

      <section className="tiles">
        <div className="tile"><span>รถอยู่ในลานตอนนี้</span><b>{inLot ?? 0}<small> คัน</small></b></div>
        <div className="tile"><span>รถเข้าวันนี้</span><b>{A.length}<small> คัน</small></b><em>ยังไม่เข้า {A.filter((b) => b.status === 'confirmed').length} คัน</em></div>
        <div className="tile"><span>รถออกวันนี้</span><b>{D.length}<small> คัน</small></b><em>ยังไม่ออก {D.filter((b) => b.status === 'checked_in').length} คัน</em></div>
        <div className={`tile ${L.length + O.length ? 'tile-warn' : ''}`}><span>ต้องตรวจสอบ</span><b>{L.length + O.length}<small> รายการ</small></b><em>เลยวันเข้า {L.length} · เกินกำหนดออก {O.length}</em></div>
      </section>

      {q && (
        <section className="panel">
          <h2>ผลการค้นหา “{q}”</h2>
          {/^BY\d{3,10}$/i.test(q) && <p><Link className="b b-primary b-sm" href={`/ops/m/${q.toUpperCase()}`}>เปิดข้อมูลสมาชิก {q.toUpperCase()} (คูปอง · บันทึกยอดคาเฟ่/ที่พัก)</Link></p>}
          {!found.length ? <p className="empty">ไม่พบการจองที่ยืนยันแล้ว</p> : <ul className="ops-list">{found.map((b) => <OpsRow key={b.id} b={b} />)}</ul>}
          <p className="hint"><Link href="/ops">ล้างการค้นหา</Link></p>
        </section>
      )}

      {(L.length > 0 || O.length > 0) && (
        <section className="panel ops-warn">
          <h2>ต้องตรวจสอบ</h2>
          {L.length > 0 && <>
            <h3>เลยวันเข้าจอดแล้ว แต่ยังไม่มีบันทึกรถเข้า</h3>
            <p className="hint">อาจลืมกด หรือลูกค้าไม่มาตามนัด (แจ้งแอดมินให้บันทึก “ไม่มาตามนัด”)</p>
            <ul className="ops-list">{L.map((b) => <OpsRow key={b.id} b={b} note={`ควรเข้าตั้งแต่ ${thDate(b.start_date)} (${daysBetween(b.start_date, today)} วันที่แล้ว)`} />)}</ul>
          </>}
          {O.length > 0 && <>
            <h3>เลยวันรับรถแล้ว แต่รถยังอยู่ในลาน</h3>
            <p className="hint">อาจลืมกดรับรถ หรือจอดเกินกำหนด (คิดเพิ่มวันละ {st?.extra_price_per_day ?? 120} บาท · แจ้งแอดมินเพิ่มวันจอด)</p>
            <ul className="ops-list">{O.map((b) => <OpsRow key={b.id} b={b} note={`ครบกำหนด ${thDate(b.end_date)} · เกินมา ${daysBetween(b.end_date, today)} วัน`} />)}</ul>
          </>}
        </section>
      )}

      <div className="cols">
        <section className="panel">
          <h2>รถเข้าวันนี้ ({A.length})</h2>
          {!A.length ? <p className="empty">ไม่มีรถเข้าวันนี้</p> : <ul className="ops-list">{A.map((b) => <OpsRow key={b.id} b={b} only="in" note={b.status === 'confirmed' && b.shuttle ? 'ใช้รถรับส่ง: บันทึกเองเมื่อคนขับกด “พร้อมรับที่ลาน”' : undefined} />)}</ul>}
        </section>
        <section className="panel">
          <h2>รถออกวันนี้ ({D.length})</h2>
          {!D.length ? <p className="empty">ไม่มีรถออกวันนี้</p> : <ul className="ops-list">{D.map((b) => <OpsRow key={b.id} b={b} only="out" note={b.status === 'checked_in' && b.shuttle ? 'ใช้รถรับส่ง: บันทึกเองเมื่อคนขับกด “ส่งถึงลาน”' : undefined} />)}</ul>}
        </section>
      </div>

      <section className="panel narrow-panel">
        <h2>ให้แต้มชดเชยลูกค้า</h2>
        <p className="hint">เช่น ลูกค้ารอรถนาน รถรับส่งมาช้า · หัวหน้าหน้างานให้ได้ครั้งละไม่เกิน {st?.ops_points_max ?? 50} แต้ม · ทุกครั้งมีบันทึกชื่อผู้ให้</p>
        <ActionForm action={givePoints} className="form grid2" resetOnOk>
          <label>เบอร์โทร หรือ เลขสมาชิก<input name="who" placeholder="0812345678 / BY001234" required /></label>
          <label>จำนวนแต้ม<span className="with-unit"><input name="points" type="number" min={1} max={st?.ops_points_max ?? 50} required /><em>แต้ม</em></span></label>
          <label className="span2">เหตุผล<input name="note" placeholder="เช่น รอรถรับส่งเกิน 30 นาที" required /></label>
          <div className="form-actions span2"><Submit>ให้แต้ม</Submit></div>
        </ActionForm>
      </section>
    </main>
  );
}
