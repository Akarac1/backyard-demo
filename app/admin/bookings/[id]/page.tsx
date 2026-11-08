import Link from 'next/link';
import { notFound } from 'next/navigation';
import { db } from '@/lib/supabase';
import { bkkDay, thDate, thTime } from '@/lib/format';
import { DIRECTION, STATUS, StatusTag } from '@/lib/labels';
import { ActionButton, ActionForm, Submit } from '@/components/ActionForm';
import { addExtraDays, adjustPoints, markPaid, setStatus, setTierOverride, updateBooking } from '../../actions';

export const dynamic = 'force-dynamic';

const KIND: Record<string, string> = { booking: 'ค่าจอง', reschedule_extra: 'ส่วนต่างเลื่อนวัน', overstay: 'จอดเพิ่ม/เกินวัน' };
const PAY: Record<string, string> = { pending: 'รอชำระ', verified: 'ได้รับแล้ว', rejected: 'ยกเลิก' };
const ACTION: Record<string, string> = { update: 'แก้ไขข้อมูล', status: 'เปลี่ยนสถานะ', mark_paid: 'บันทึกรับเงิน', extra_days: 'เพิ่มวันจอด', confirm_slip: 'ยืนยันสลิป' };
const n = (v: number) => v.toLocaleString('th-TH');
const when = (ts: string) => `${thDate(new Date(ts).toLocaleDateString('en-CA', { timeZone: 'Asia/Bangkok' }))} ${thTime(ts)}`;

export default async function BookingDetail({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  if (!/^[0-9a-f-]{36}$/.test(id)) notFound();
  const sb = db();
  const [{ data: b }, { data: pays }, { data: trips }, { data: log }, { data: vehicles }, { data: st }] = await Promise.all([
    sb.from('bookings').select('*, customers(name, phone, line_user_id)').eq('id', id).maybeSingle(),
    sb.from('payments').select('id, kind, amount, status, slip_path, verified_by, paid_at, created_at').eq('booking_id', id).order('created_at'),
    sb.from('shuttle_trips').select('id, direction, pax, pickup_at, flight_number, status, vehicle_id').eq('booking_id', id).order('pickup_at'),
    sb.from('admin_audit').select('id, staff_name, action, detail, at').eq('entity', 'booking').eq('entity_id', id).order('at', { ascending: false }).limit(30),
    sb.from('vehicles').select('id, name'),
    sb.from('settings').select('extra_price_per_day').eq('id', 1).single(),
  ]);
  if (!b) notFound();
  const c = b.customers as { name: string; phone: string; line_user_id: string } | null;
  const [{ data: balance }, { data: tierRow }, { data: spend }, { data: tiers }, { data: cust }] = await Promise.all([
    sb.rpc('points_balance', { p_customer: b.customer_id }),
    sb.rpc('customer_tier', { p_customer: b.customer_id }),
    sb.rpc('customer_spend', { p_customer: b.customer_id }),
    sb.from('member_tiers').select('code, name').order('sort'),
    sb.from('customers').select('member_no, tier_override').eq('id', b.customer_id).single(),
  ]);
  const tier = (Array.isArray(tierRow) ? tierRow[0] : tierRow) as { code: string; name: string; multiplier: number } | null;
  const vname = (vid: string | null) => vehicles?.find((v) => v.id === vid)?.name;
  const paid = (pays ?? []).filter((p) => p.status === 'verified').reduce((a, p) => a + p.amount, 0);
  const pendingBooking = (pays ?? []).find((p) => p.kind === 'booking' && p.status === 'pending');
  const slipLinks: Record<string, string> = {};
  for (const p of pays ?? []) {
    if (p.slip_path) {
      const { data } = await sb.storage.from('slips').createSignedUrl(p.slip_path, 3600);
      if (data) slipLinks[p.id] = data.signedUrl;
    }
  }
  const active = b.status === 'confirmed' || b.status === 'checked_in';

  return (
    <main className="page">
      <Link href="/admin/bookings" className="back">← การจองทั้งหมด</Link>
      <header className="page-head">
        <div>
          <h1>{b.code} <StatusTag status={b.status} /></h1>
          <p>จองเมื่อ {when(b.booked_at)}{b.rescheduled_at ? ' · ใช้สิทธิ์เลื่อนวันแล้ว' : ''}</p>
        </div>
        <div className="head-actions">
          {b.status === 'confirmed' && <>
            <ActionButton action={setStatus} fields={{ id, status: 'checked_in' }} label="เช็กอิน (รถเข้าลาน)" variant="primary" />
            <ActionButton action={setStatus} fields={{ id, status: 'no_show' }} label="ไม่มาตามนัด" confirm="บันทึกว่าลูกค้าไม่มาตามนัด? ทะเบียนจะถูกลบจากไม้กั้น" />
            <ActionButton action={setStatus} fields={{ id, status: 'cancelled' }} label="ยกเลิกการจอง" variant="danger" confirm="ยกเลิกการจองนี้? (ระบบไม่คืนเงินอัตโนมัติ)" />
          </>}
          {b.status === 'checked_in' && <>
            <ActionButton action={setStatus} fields={{ id, status: 'checked_out' }} label="ลูกค้ารับรถแล้ว" variant="primary" />
            <ActionButton action={setStatus} fields={{ id, status: 'confirmed' }} label="ย้อนเช็กอิน" confirm="ย้อนสถานะกลับเป็นยืนยันแล้ว?" />
          </>}
          {(b.status === 'pending_payment' || b.status === 'expired') &&
            <ActionButton action={setStatus} fields={{ id, status: 'cancelled' }} label="ยกเลิกการจอง" variant="danger" confirm="ยกเลิกการจองนี้?" />}
        </div>
      </header>

      <section className="facts">
        <div><span>ลูกค้า</span><b>{c?.name}</b><a href={`tel:${c?.phone}`}>{c?.phone}</a></div>
        <div><span>รถ</span><b>{b.plate}</b><small>{b.plate_province}</small></div>
        <div><span>วันที่จอด</span><b>{thDate(b.start_date)} – {thDate(b.end_date)}</b><small>{b.days} วัน</small></div>
        <div><span>รถรับส่ง</span><b>{b.shuttle ? `${b.pax} คน` : 'ไม่ใช้'}</b></div>
        <div><span>ยอดจอง</span><b>{n(b.total_amount)} บาท</b><small>รับแล้วทั้งหมด {n(paid)} บาท{b.discount_amount > 0 ? ` · ${b.discount_reason === 'referral' ? `ส่วนลดเพื่อนแนะนำ (${b.referrer_phone})` : 'ส่วนลดลูกค้าเก่า'} −${n(b.discount_amount)}` : ''}</small></div>
      </section>
      {b.admin_note && <p className="note">หมายเหตุ: {b.admin_note}</p>}

      <div className="cols wide-left">
        <section className="panel">
          <h2>แก้ไขข้อมูล</h2>
          <ActionForm action={updateBooking} className="form grid2">
            <input type="hidden" name="id" value={id} />
            <label>ชื่อลูกค้า<input name="name" defaultValue={c?.name} required /></label>
            <label>เบอร์โทร<input name="phone" defaultValue={c?.phone} inputMode="tel" required /></label>
            <label>ทะเบียนรถ<input name="plate" defaultValue={b.plate} required /></label>
            <label>จังหวัด<input name="province" defaultValue={b.plate_province} required /></label>
            <label>วันเข้าจอด<input name="start" type="date" defaultValue={b.start_date} required /></label>
            <label>วันรับรถคืน<input name="end" type="date" defaultValue={b.end_date} required /></label>
            {b.shuttle && <label>ผู้โดยสาร (คน)<input name="pax" type="number" min={1} max={7} defaultValue={b.pax ?? 1} required /></label>}
            <label className="span2">หมายเหตุ (เห็นเฉพาะแอดมิน)<textarea name="note" rows={2} defaultValue={b.admin_note ?? ''} /></label>
            <p className="hint span2">เปลี่ยนวันหรือทะเบียนแล้ว ระบบจะเพิ่มงานแก้ทะเบียนในไม้กั้นให้เอง · ราคาไม่คำนวณใหม่ ถ้าลูกค้าจอดเพิ่มให้ใช้ “เพิ่มวันจอด”</p>
            <div className="form-actions span2"><Submit>บันทึกการแก้ไข</Submit></div>
          </ActionForm>
        </section>

        <div className="stack">
          {pendingBooking && (
            <section className="panel">
              <h2>รับเงินเอง</h2>
              <p className="hint">ยอดค้าง {n(pendingBooking.amount)} บาท ใช้เมื่อรับเงินสด หรือตรวจสลิปด้วยตาแล้ว</p>
              <ActionForm action={markPaid} className="form" confirm={`ยืนยันว่าได้รับเงิน ${n(pendingBooking.amount)} บาทแล้ว?`}>
                <input type="hidden" name="id" value={id} />
                <label>วิธีรับเงิน<select name="method" defaultValue="cash"><option value="cash">เงินสด</option><option value="transfer">โอน (ตรวจเอง)</option></select></label>
                <div className="form-actions"><Submit>บันทึกรับเงินและยืนยันการจอง</Submit></div>
              </ActionForm>
            </section>
          )}
          {active && (
            <section className="panel">
              <h2>เพิ่มวันจอด</h2>
              <p className="hint">ต่อวันรับรถออกไป คิดวันละ {st?.extra_price_per_day ?? 120} บาท (ใช้ช่องสำรองได้)</p>
              <ActionForm action={addExtraDays} className="form" resetOnOk>
                <input type="hidden" name="id" value={id} />
                <label>จำนวนวันที่เพิ่ม<input name="days" type="number" min={1} max={60} defaultValue={1} required /></label>
                <label className="check"><input name="paid" type="checkbox" defaultChecked /> ได้รับเงินแล้ว</label>
                <div className="form-actions"><Submit>เพิ่มวันจอด</Submit></div>
              </ActionForm>
            </section>
          )}
        </div>
      </div>

      <div className="cols">
        <section className="panel">
          <h2>การชำระเงิน</h2>
          <ul className="list">
            {(pays ?? []).map((p) => (
              <li key={p.id}>
                <div><b>{KIND[p.kind]} · {n(p.amount)} บาท</b><small>{p.paid_at ? `รับเมื่อ ${when(p.paid_at)}` : `สร้างเมื่อ ${when(p.created_at)}`}{p.verified_by ? ` · ${p.verified_by.split(':').slice(0, 2).join(' ')}` : ''}</small></div>
                <div className="row-act">
                  {slipLinks[p.id] && <a className="b b-plain b-sm" href={slipLinks[p.id]} target="_blank" rel="noreferrer">ดูสลิป</a>}
                  <span className={`st ${p.status === 'verified' ? 'st-ok' : p.status === 'pending' ? 'st-wait' : 'st-off'}`}>{PAY[p.status]}</span>
                </div>
              </li>
            ))}
          </ul>
          {(b.coupon_amount > 0 || b.discount_amount > 0) && (
            <p className="hint" style={{ marginTop: 10 }}>
              ราคาเต็ม {n(b.parking_amount + b.shuttle_amount)} บาท
              {b.discount_amount > 0 ? ` · ส่วนลด${b.discount_reason === 'referral' ? 'เพื่อนแนะนำ' : 'ลูกค้าเก่า'} −${n(b.discount_amount)}` : ''}
              {b.coupon_amount > 0 ? ` · คูปอง −${n(b.coupon_amount)}` : ''}
            </p>
          )}
          <h3 style={{ marginTop: 16 }}>สมาชิก {cust?.member_no} · ระดับ {tier?.name}{cust?.tier_override ? ' (กำหนดเอง)' : ''} · แต้ม {n(Number(balance ?? 0))}</h3>
          <p className="hint" style={{ margin: '0 0 6px' }}>ยอดใช้บริการ 12 เดือน {n(Number(spend ?? 0))} บาท · ได้แต้ม x{Number(tier?.multiplier ?? 1)}</p>
          <ActionForm action={setTierOverride} className="tier-row" >
            <input type="hidden" name="customer_id" value={b.customer_id} />
            <input type="hidden" name="booking_id" value={b.id} />
            <select name="tier" defaultValue={cust?.tier_override ?? ''} aria-label="กำหนดระดับ">
              <option value="">ตามยอดใช้จ่าย (อัตโนมัติ)</option>
              {(tiers ?? []).map((t) => <option key={t.code} value={t.code}>กำหนดเป็น {t.name}</option>)}
            </select>
            <Submit small variant="plain">บันทึกระดับ</Submit>
          </ActionForm>
          <ActionForm action={adjustPoints} className="form grid2" resetOnOk>
            <input type="hidden" name="customer_id" value={b.customer_id} />
            <input type="hidden" name="booking_id" value={b.id} />
            <label>เพิ่ม/ลดแต้ม<input name="points" type="number" step={1} placeholder="เช่น 5 หรือ -5" required /></label>
            <label>เหตุผล<input name="note" placeholder="เช่น ชดเชยรอรถนาน" required /></label>
            <div className="form-actions span2"><Submit small variant="plain">ปรับแต้ม</Submit></div>
          </ActionForm>
        </section>
        <section className="panel">
          <div className="panel-head"><h2>รถรับส่ง</h2>{b.shuttle && <Link href="/admin/trips" className="link">จัดรถ →</Link>}</div>
          {!trips?.length && <p className="empty">ไม่ได้ใช้รถรับส่ง</p>}
          <ul className="list">
            {(trips ?? []).map((t) => (
              <li key={t.id}>
                <div><b>{DIRECTION[t.direction]} · {t.pax} คน</b><small>{t.pickup_at ? `${thDate(bkkDay(t.pickup_at))} ${thTime(t.pickup_at)}` : 'ยังไม่มีเวลา'}{t.flight_number ? ` · ${t.flight_number}` : ''}</small></div>
                <span className={`st ${t.status === 'cancelled' ? 'st-off' : t.vehicle_id ? 'st-ok' : 'st-wait'}`}>{t.status === 'cancelled' ? 'ยกเลิก' : vname(t.vehicle_id) ?? 'ยังไม่มีรถ'}</span>
              </li>
            ))}
          </ul>
        </section>
      </div>

      <section className="panel">
        <h2>ประวัติการแก้ไข</h2>
        {!log?.length && <p className="empty">ยังไม่มีการแก้ไขโดยแอดมิน</p>}
        <ul className="history">
          {(log ?? []).map((l) => (
            <li key={l.id}><time>{when(l.at)}</time><b>{l.staff_name}</b> {ACTION[l.action] ?? l.action}{l.action === 'status' && l.detail ? ` → ${STATUS[(l.detail as { to: string }).to]?.label ?? ''}` : ''}{l.action === 'extra_days' && l.detail ? ` ${(l.detail as { days: number }).days} วัน` : ''}</li>
          ))}
        </ul>
      </section>
    </main>
  );
}
