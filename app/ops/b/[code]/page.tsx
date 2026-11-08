import Link from 'next/link';
import { notFound } from 'next/navigation';
import { db } from '@/lib/supabase';
import { thDate } from '@/lib/format';
import { ActionForm, Submit, ActionButton } from '@/components/ActionForm';
import { givePoints, opsSetStatus } from '@/app/admin/actions';
import { StatusTag } from '@/lib/labels';
import { OPS_SELECT, type OpsBooking } from '../../OpsRow';

export const dynamic = 'force-dynamic';

/** Opened by scanning the QR on the customer's booking: one booking, big buttons. */
export default async function OpsBooking({ params }: { params: Promise<{ code: string }> }) {
  const { code } = await params;
  if (!/^[A-Z0-9]{4,10}$/i.test(code)) notFound();
  const sb = db();
  const { data } = await sb.from('bookings').select(`${OPS_SELECT}, customer_id`).eq('code', code.toUpperCase()).maybeSingle();
  if (!data) notFound();
  const b = data as unknown as OpsBooking & { customer_id: string };
  const [{ data: bal }, { data: st }] = await Promise.all([
    sb.rpc('points_balance', { p_customer: b.customer_id }),
    sb.from('settings').select('ops_points_max').eq('id', 1).single(),
  ]);

  return (
    <main className="page narrow">
      <p><Link href="/ops">← หน้างาน</Link></p>
      <section className="panel ops-one">
        <div className="ops-one-head">
          <div><span className="hint">ทะเบียน</span><b className="big-plate">{b.plate}</b><small>{b.plate_province}</small></div>
          <StatusTag status={b.status} />
        </div>
        <dl className="ops-dl">
          <dt>รหัสการจอง</dt><dd>{b.code}</dd>
          <dt>ลูกค้า</dt><dd>{b.customers?.name} · <a href={`tel:${b.customers?.phone}`}>{b.customers?.phone}</a>{b.customers?.member_no ? ` · ${b.customers.member_no}` : ''}</dd>
          <dt>วันที่จอด</dt><dd>{thDate(b.start_date)} – {thDate(b.end_date)} ({b.days} วัน)</dd>
          <dt>รถรับส่ง</dt><dd>{b.shuttle ? `${b.pax} คน (บันทึกเข้า-ออกเองจากคนขับ)` : 'ไม่ใช้'}</dd>
          {b.checked_in_at && <><dt>เข้า</dt><dd>{new Date(b.checked_in_at).toLocaleString('th-TH', { timeZone: 'Asia/Bangkok' })}{b.checked_in_by ? ` · ${b.checked_in_by}` : ''}</dd></>}
          {b.checked_out_at && <><dt>ออก</dt><dd>{new Date(b.checked_out_at).toLocaleString('th-TH', { timeZone: 'Asia/Bangkok' })}{b.checked_out_by ? ` · ${b.checked_out_by}` : ''}</dd></>}
        </dl>
        <div className="ops-big">
          {b.status === 'confirmed' && <ActionButton action={opsSetStatus} fields={{ id: b.id, status: 'checked_in' }} label="✓ บันทึกรถเข้าแล้ว" variant="primary" />}
          {b.status === 'checked_in' && <ActionButton action={opsSetStatus} fields={{ id: b.id, status: 'checked_out' }} label="✓ ลูกค้ารับรถแล้ว" variant="primary" confirm={`ลูกค้ามารับรถ ${b.plate} แล้ว?`} />}
          {b.status === 'checked_in' && <ActionButton action={opsSetStatus} fields={{ id: b.id, status: 'confirmed' }} label="ย้อน: ยังไม่เข้า" confirm="ย้อนสถานะรถเข้า?" />}
          {!['confirmed', 'checked_in'].includes(b.status) && <p className="hint">การจองนี้{b.status === 'checked_out' ? 'รับรถไปแล้ว' : 'ไม่อยู่ในสถานะที่บันทึกเข้า-ออกได้'}</p>}
        </div>
      </section>

      <section className="panel">
        <h2>ให้แต้มชดเชย · ลูกค้ามี {Number(bal ?? 0).toLocaleString('th-TH')} แต้ม</h2>
        <ActionForm action={givePoints} className="form grid2" resetOnOk>
          <input type="hidden" name="customer_id" value={b.customer_id} />
          <label>จำนวนแต้ม<span className="with-unit"><input name="points" type="number" min={1} max={st?.ops_points_max ?? 50} required /><em>แต้ม</em></span><small>ไม่เกิน {st?.ops_points_max ?? 50} แต้มต่อครั้ง (แอดมินให้ได้มากกว่า)</small></label>
          <label>เหตุผล<input name="note" placeholder="เช่น รอรถรับส่งนาน" required /></label>
          <div className="form-actions span2"><Submit>ให้แต้ม</Submit></div>
        </ActionForm>
      </section>
    </main>
  );
}
