import Link from 'next/link';
import { notFound } from 'next/navigation';
import { db } from '@/lib/supabase';
import { MemberCard } from '@/components/MemberCard';
import { ActionButton, ActionForm, Submit } from '@/components/ActionForm';
import { givePoints, recordPurchase, takeCoupon } from '@/app/admin/actions';
import { checkMemberQr } from '@/lib/memberQr';
import { thDate } from '@/lib/format';

export const dynamic = 'force-dynamic';

const BIZ: Record<string, string> = { parking: 'ที่จอดรถ', cafe: 'คาเฟ่', stay: 'ที่พัก' };

/** Opened by scanning a member's QR (or typing their member number): who they are, coupons, add spend. */
export default async function MemberScan({ params, searchParams }: {
  params: Promise<{ no: string }>; searchParams: Promise<{ tier?: string; exp?: string; sig?: string }>;
}) {
  const { no: raw } = await params;
  const { tier, exp, sig } = await searchParams;
  const no = decodeURIComponent(raw).toUpperCase();
  if (!/^BY\d{3,10}$/.test(no)) notFound();
  const sb = db();
  const { data: c } = await sb.from('customers').select('id, name, phone, member_no').eq('member_no', no).maybeSingle();
  if (!c) notFound();
  const qr = checkMemberQr(no, tier, exp, sig);
  const [{ data: bdRow }, { data: tr }, { data: spend }, { data: pts }, { data: coupons }, { data: buys }, { data: st }] = await Promise.all([
    sb.from('black_diamond').select('customer_id').eq('customer_id', c.id).eq('active', true).maybeSingle(),
    sb.rpc('customer_tier', { p_customer: c.id }),
    sb.rpc('customer_spend', { p_customer: c.id }),
    sb.rpc('points_balance', { p_customer: c.id }),
    sb.from('coupons').select('code, title, business, kind, expires_at').eq('customer_id', c.id).eq('status', 'active').gt('expires_at', new Date().toISOString()).order('expires_at'),
    sb.from('member_purchases').select('id, business, amount, note, staff, created_at').eq('customer_id', c.id).order('created_at', { ascending: false }).limit(5),
    sb.from('settings').select('ops_points_max').eq('id', 1).single(),
  ]);
  const t = (Array.isArray(tr) ? tr[0] : tr) as { code: string; name: string; multiplier: number } | null;
  const phoneMasked = c.phone ? c.phone.replace(/^(\d{3})\d+(\d{3})$/, '$1-xxx-$2') : '';

  return (
    <main className="page narrow">
      <p><Link href="/ops">← หน้างาน</Link></p>
      {qr === 'ok' && <div className="alert-ok-strip">✓ QR ถูกต้อง สร้างจากแอปของลูกค้า</div>}
      {qr === 'expired' && <div className="alert-strip">QR หมดอายุแล้ว ขอให้ลูกค้าเปิดบัตรใหม่อีกครั้ง (ข้อมูลด้านล่างยังเป็นปัจจุบัน)</div>}
      {qr === 'bad' && <div className="alert-strip alert-bad">QR ไม่ถูกต้อง อาจถูกแก้ไข ตรวจสอบตัวตนลูกค้าก่อนให้สิทธิ์</div>}
      {qr === 'missing' && <div className="alert-strip">เปิดจากเลขสมาชิก (ไม่ได้สแกน QR) ตรวจสอบชื่อหรือเบอร์กับลูกค้าก่อน</div>}

      <section className="panel">
        <div className="scan-head">
          <div style={{ maxWidth: 340, flex: '1 1 300px' }}><MemberCard tier={bdRow ? 'blackdiamond' : (t?.code ?? 'bronze')} tierName={bdRow ? 'Black Diamond' : (t?.name ?? 'Bronze')} name={c.name} memberNo={c.member_no} points={Number(pts ?? 0)} multiplier={Number(t?.multiplier ?? 1)} /></div>
          <dl className="ops-dl" style={{ flex: '1 1 220px' }}>
            <dt>ชื่อ</dt><dd>{c.name}</dd>
            <dt>เบอร์</dt><dd>{phoneMasked}</dd>
            <dt>ระดับ</dt><dd>{t?.name} · แต้ม x{Number(t?.multiplier ?? 1)}</dd>
            <dt>ยอด 12 เดือน</dt><dd>{Number(spend ?? 0).toLocaleString('th-TH')} บาท</dd>
            <dt>แต้ม</dt><dd>{Number(pts ?? 0).toLocaleString('th-TH')} แต้ม</dd>
          </dl>
        </div>
      </section>

      <section className="panel">
        <h2>คูปองที่ใช้ได้ ({coupons?.length ?? 0})</h2>
        {!coupons?.length ? <p className="empty">ไม่มีคูปอง</p> : (
          <ul className="ops-list">{coupons.map((cp) => (
            <li key={cp.code} className="ops-row">
              <div className="ops-plate"><b>{cp.code}</b><small>{BIZ[cp.business] ?? cp.business}</small></div>
              <div className="ops-main"><div>{cp.title}</div><small>ใช้ได้ถึง {thDate(cp.expires_at.slice(0, 10))}</small></div>
              <div className="ops-act">
                {cp.kind === 'parking_discount' ? <small className="hint">ใช้ในหน้าจองของลูกค้า</small>
                  : <ActionButton action={takeCoupon} fields={{ code: cp.code }} label="ใช้คูปองนี้" variant="primary" confirm={`ใช้คูปอง “${cp.title}”?`} />}
              </div>
            </li>
          ))}</ul>
        )}
      </section>

      <section className="panel">
        <h2>บันทึกยอดใช้จ่าย (คาเฟ่ / ที่พัก)</h2>
        <p className="hint">ลูกค้าได้แต้มตามระดับและแคมเปญ และนับเข้ายอดเลื่อนระดับ</p>
        <ActionForm action={recordPurchase} className="form grid2" resetOnOk>
          <input type="hidden" name="who" value={c.member_no ?? ''} />
          <label>ธุรกิจ<select name="business" defaultValue="cafe"><option value="cafe">คาเฟ่</option><option value="stay">ที่พัก</option></select></label>
          <label>ยอดที่จ่าย<span className="with-unit"><input name="amount" type="number" min={1} required /><em>บาท</em></span></label>
          <label className="span2">หมายเหตุ<input name="note" placeholder="เช่น เลขบิล" /></label>
          <div className="form-actions span2"><Submit>บันทึกและให้แต้ม</Submit></div>
        </ActionForm>
        {!!buys?.length && (
          <ul className="sys-events" style={{ marginTop: 10 }}>{buys.map((b) => (
            <li key={b.id}><span>{thDate(b.created_at.slice(0, 10))}</span><b>{BIZ[b.business] ?? b.business}</b>{b.amount.toLocaleString('th-TH')} บาท{b.note ? ` · ${b.note}` : ''}{b.staff ? ` · ${b.staff}` : ''}</li>
          ))}</ul>
        )}
      </section>

      <section className="panel">
        <h2>ให้แต้มชดเชย</h2>
        <ActionForm action={givePoints} className="form grid2" resetOnOk>
          <input type="hidden" name="customer_id" value={c.id} />
          <label>จำนวนแต้ม<span className="with-unit"><input name="points" type="number" min={1} max={st?.ops_points_max ?? 50} required /><em>แต้ม</em></span></label>
          <label>เหตุผล<input name="note" required /></label>
          <div className="form-actions span2"><Submit variant="plain">ให้แต้ม</Submit></div>
        </ActionForm>
      </section>
    </main>
  );
}
