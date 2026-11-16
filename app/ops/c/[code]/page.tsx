import Link from 'next/link';
import { db } from '@/lib/supabase';
import { ActionButton } from '@/components/ActionForm';
import { takeCoupon } from '@/app/admin/actions';
import { thDate } from '@/lib/format';

export const dynamic = 'force-dynamic';

const BIZ: Record<string, string> = { parking: 'ที่จอดรถ', cafe: 'คาเฟ่', stay: 'ที่พัก', all: 'ทุกธุรกิจ' };
const ST: Record<string, string> = { active: 'ใช้ได้', used: 'ใช้แล้ว', cancelled: 'ยกเลิก' };

/** Opened by scanning the QR on a customer's coupon (staff signed in). */
export default async function CouponScan({ params }: { params: Promise<{ code: string }> }) {
  const { code } = await params;
  const { data: cp } = await db().from('coupons')
    .select('code, title, business, kind, value_baht, status, expires_at, used_at, customers(name, member_no, phone)')
    .eq('code', decodeURIComponent(code).toUpperCase()).maybeSingle();
  if (!cp) return <main className="panel"><h1>ไม่พบคูปอง</h1><p className="empty">รหัส {decodeURIComponent(code)} ไม่มีในระบบ</p><Link className="b b-plain" href="/ops">กลับ</Link></main>;
  const cust = cp.customers as unknown as { name: string; member_no: string | null; phone: string } | null;
  const expired = cp.status === 'active' && Date.parse(cp.expires_at) <= Date.now();
  const state = expired ? 'หมดอายุ' : ST[cp.status] ?? cp.status;
  const usable = cp.status === 'active' && !expired && cp.kind !== 'parking_discount';
  return (
    <main className="panel" style={{ maxWidth: 520 }}>
      <h1>{cp.title}</h1>
      <p><b style={{ fontSize: 24, letterSpacing: 2 }}>{cp.code}</b> <span className={`st ${state === 'ใช้ได้' ? 'st-ok' : 'st-off'}`}>{state}</span></p>
      <ul className="sys-events">
        <li><span>ธุรกิจ</span>{BIZ[cp.business] ?? cp.business}</li>
        {cp.kind === 'parking_discount' && <li><span>ส่วนลดค่าจอด</span>{cp.value_baht.toLocaleString('th-TH')} บาท</li>}
        <li><span>ใช้ได้ถึง</span>{thDate(cp.expires_at.slice(0, 10))}</li>
        {cust && <li><span>ลูกค้า</span>{cust.name} {cust.member_no ?? ''} · {cust.phone}</li>}
        {cp.used_at && <li><span>ใช้เมื่อ</span>{thDate(cp.used_at.slice(0, 10))}</li>}
      </ul>
      {usable && <ActionButton action={takeCoupon} fields={{ code: cp.code }} label="ใช้คูปองนี้" variant="primary" confirm={`ใช้คูปอง “${cp.title}”?`} />}
      {cp.status === 'active' && !expired && cp.kind === 'parking_discount' && <p className="hint">คูปองส่วนลดค่าจอด ลูกค้าเลือกใช้เองในหน้าจอง</p>}
    </main>
  );
}
