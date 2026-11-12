import Link from 'next/link';
import { db } from '@/lib/supabase';
import { thDate } from '@/lib/format';
import { StatusTag } from '@/lib/labels';
import { ActionButton } from '@/components/ActionForm';
import { setStatus } from '../actions';

export const dynamic = 'force-dynamic';

const TABS = [
  { key: '', label: 'ทั้งหมด', statuses: null, empty: 'ยังไม่มีการจอง' },
  { key: 'pending', label: 'รอชำระ', statuses: ['pending_payment'], empty: 'ไม่มีการจองที่รอชำระเงิน' },
  { key: 'confirmed', label: 'ยืนยันแล้ว', statuses: ['confirmed'], empty: 'ไม่มีการจองที่จ่ายแล้วและรอรถเข้า' },
  { key: 'in', label: 'อยู่ในลาน', statuses: ['checked_in'], empty: 'ยังไม่มีรถในลาน · รถจะย้ายมาแท็บนี้เมื่อกด “รถเข้าแล้ว” ในแท็บ “ยืนยันแล้ว” หรือที่หน้าภาพรวม' },
  { key: 'done', label: 'รับรถแล้ว', statuses: ['checked_out'], empty: 'ยังไม่มีรถที่รับคืนแล้ว · กด “รับรถแล้ว” ในแท็บ “อยู่ในลาน” เมื่อลูกค้ามารับรถ' },
  { key: 'off', label: 'ยกเลิก / หมดเวลา', statuses: ['cancelled', 'expired', 'no_show'], empty: 'ไม่มีการจองที่ยกเลิก หมดเวลาชำระ หรือไม่มาตามนัด' },
];
const PAGE = 50;

type Row = { id: string; code: string; plate: string; plate_province: string; status: string; start_date: string; end_date: string; days: number; total_amount: number; shuttle: boolean; pax: number | null; group_id?: string | null; source?: string; customers: { name: string; phone: string } | null };

export default async function BookingsPage({ searchParams }: { searchParams: Promise<{ q?: string; s?: string; from?: string; p?: string }> }) {
  const sp = await searchParams;
  const q = (sp.q ?? '').replace(/[,()*%\\]/g, ' ').trim().slice(0, 40);
  const tab = TABS.find((t) => t.key === (sp.s ?? '')) ?? TABS[0];
  const page = Math.max(0, Number(sp.p ?? 0) || 0);
  const sb = db();
  // mark unpaid holds as expired now (also runs every 2 minutes when pg_cron is on)
  await sb.rpc('expire_holds').then(() => null, () => null);
  // how many in each tab
  const counts = await Promise.all(TABS.map(async (t) => {
    let c = sb.from('bookings').select('id', { count: 'exact', head: true });
    if (t.statuses) c = c.in('status', t.statuses);
    return (await c).count ?? 0;
  }));

  let query = sb.from('bookings')
    .select('id, code, plate, plate_province, status, start_date, end_date, days, total_amount, shuttle, pax, group_id, source, customers(name, phone)', { count: 'exact' });
  if (tab.statuses) query = query.in('status', tab.statuses);
  if (sp.from) query = query.gte('start_date', sp.from);
  if (q) {
    const { data: custs } = await sb.from('customers').select('id').or(`name.ilike.%${q}%,phone.ilike.%${q.replace(/\D/g, '') || q}%`).limit(200);
    const ors = [`code.ilike.%${q}%`, `plate.ilike.%${q.replace(/\s+/g, '')}%`];
    if (custs?.length) ors.push(`customer_id.in.(${custs.map((c) => c.id).join(',')})`);
    query = query.or(ors.join(','));
  }
  const { data, count } = await query.order(tab.key === 'in' || tab.key === 'confirmed' ? 'start_date' : 'created_at', { ascending: tab.key === 'confirmed' })
    .range(page * PAGE, page * PAGE + PAGE - 1);
  const rows = (data ?? []) as unknown as Row[];
  const link = (o: Record<string, string | number | undefined>) => {
    const u = new URLSearchParams();
    const m: Record<string, string | number | undefined> = { q: sp.q, s: sp.s, from: sp.from, ...o };
    Object.entries(m).forEach(([k, v]) => { if (v !== undefined && v !== '' && !(k === 'p' && Number(v) === 0)) u.set(k, String(v)); });
    return `/admin/bookings${u.size ? `?${u}` : ''}`;
  };

  return (
    <main className="page">
      <header className="page-head">
        <div><h1>การจอง</h1><p>{count ?? 0} รายการ{q ? ` ที่ตรงกับ “${q}”` : ''}</p></div>
        <Link href="/admin/bookings/new" className="b b-primary">+ จองให้ลูกค้า (Walk-in)</Link>
        <form className="search" action="/admin/bookings">
          {sp.s && <input type="hidden" name="s" value={sp.s} />}
          <input name="q" defaultValue={sp.q} placeholder="รหัส / ทะเบียน / ชื่อ / เบอร์" aria-label="ค้นหา" />
          <input name="from" type="date" defaultValue={sp.from} aria-label="เข้าจอดตั้งแต่วันที่" title="เข้าจอดตั้งแต่วันที่" />
          <button className="b b-primary">ค้นหา</button>
        </form>
      </header>

      <nav className="seg" aria-label="กรองตามสถานะ">
        {TABS.map((t, i) => <Link key={t.key} href={link({ s: t.key, p: 0 })} className={t === tab ? 'on' : ''}>{t.label} <span className="seg-n">{counts[i].toLocaleString('th-TH')}</span></Link>)}
      </nav>

      <section className="panel flush">
        {!rows.length ? <p className="empty pad">{q || sp.from ? 'ไม่พบการจองที่ตรงกับการค้นหา' : tab.empty}</p> : (
          <div className="table-wrap">
            <table className="tbl">
              <thead><tr><th>รหัส</th><th>ทะเบียน</th><th>ลูกค้า</th><th>วันที่จอด</th><th>รถรับส่ง</th><th className="r">ยอด</th><th>สถานะ</th><th></th></tr></thead>
              <tbody>
                {rows.map((r) => (
                  <tr key={r.id}>
                    <td><Link href={`/admin/bookings/${r.id}`} className="code">{r.code}</Link></td>
                    <td><b>{r.plate}</b><small>{r.plate_province}{r.group_id ? ' · กลุ่ม' : ''}{r.source === 'walkin' ? ' · walk-in' : ''}</small></td>
                    <td>{r.customers?.name}<small>{r.customers?.phone}</small></td>
                    <td>{thDate(r.start_date)} – {thDate(r.end_date)}<small>{r.days} วัน</small></td>
                    <td>{r.shuttle ? `${r.pax} คน` : '–'}</td>
                    <td className="r">{r.total_amount.toLocaleString('th-TH')}</td>
                    <td><StatusTag status={r.status} /></td>
                    <td className="r">
                      {r.status === 'confirmed' && <ActionButton action={setStatus} fields={{ id: r.id, status: 'checked_in' }} label="รถเข้าแล้ว" variant="primary" />}
                      {r.status === 'checked_in' && <ActionButton action={setStatus} fields={{ id: r.id, status: 'checked_out' }} label="รับรถแล้ว" variant="primary" confirm={`ลูกค้ามารับรถ ${r.plate} แล้ว?`} />}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>
      {(count ?? 0) > PAGE && (
        <nav className="pager">
          {page > 0 ? <Link className="b b-plain b-sm" href={link({ p: page - 1 })}>← ก่อนหน้า</Link> : <span />}
          <span className="hint">หน้า {page + 1} / {Math.ceil((count ?? 0) / PAGE)}</span>
          {(page + 1) * PAGE < (count ?? 0) ? <Link className="b b-plain b-sm" href={link({ p: page + 1 })}>ถัดไป →</Link> : <span />}
        </nav>
      )}
    </main>
  );
}
