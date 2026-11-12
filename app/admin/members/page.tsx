import { db } from '@/lib/supabase';
import { ActionButton, ActionForm, Submit } from '@/components/ActionForm';
import { cancelCoupon, importMembers, removeMember, saveReward, setMemberDiscount, setMemberDiscountRules, setPointsSettings, setTierOverride, takeCoupon } from '../actions';
import { thDate, bkkDay } from '@/lib/format';

export const dynamic = 'force-dynamic';

type Member = { phone: string; name: string | null; created_at: string };
type Disc = { id: string; code: string; discount_amount: number; discount_reason: string; referrer_phone: string | null; booked_at: string | null; created_at: string; customers: { name: string; phone: string } | null };

const fmtPhone = (p: string) => p.length === 10 ? `${p.slice(0, 3)}-${p.slice(3, 6)}-${p.slice(6)}` : p;

type Found = { id: string; name: string; phone: string; member_no: string | null; tier: string; tier_name: string; manual: boolean; spend: number; points: number; bookings: number; last_start: string | null };

export default async function MembersPage({ searchParams }: { searchParams: Promise<{ q?: string; c?: string; v?: string; vs?: string; vp?: string }> }) {
  const { q, c, v, vs, vp } = await searchParams;
  const sb = db();
  const digits = (q ?? '').replace(/\D/g, '');
  let list = sb.from('member_phones').select('phone, name, created_at', { count: 'exact' }).order('created_at', { ascending: false }).limit(50);
  if (q?.trim()) list = digits.length >= 3 ? list.like('phone', `%${digits}%`) : list.ilike('name', `%${q.trim()}%`);
  const monthStart = new Date().toLocaleString('sv-SE', { timeZone: 'Asia/Bangkok' }).slice(0, 8) + '01';
  const [{ data: s }, { data: members, count }, { data: used }, { data: lots }, { data: spentMonth }, { data: rewards }, { data: couponsMonth }] = await Promise.all([
    sb.from('settings').select('member_discount, member_discount_min_days, member_discount_needs_shuttle, points_enabled, points_per_baht, point_value, referral_points, points_expiry_months').eq('id', 1).single(),
    list,
    sb.from('bookings').select('id, code, discount_amount, discount_reason, referrer_phone, booked_at, created_at, customers(name, phone)')
      .gt('discount_amount', 0).in('status', ['confirmed', 'checked_in', 'checked_out', 'no_show'])
      .gte('created_at', `${monthStart}T00:00:00+07:00`).order('created_at', { ascending: false }).limit(200),
    sb.from('point_lots').select('remaining, customer_id, customers(name, phone)').gt('remaining', 0).gt('expires_at', new Date().toISOString()).limit(20000),
    sb.from('point_spends').select('points').is('returned_at', null).eq('reason', 'coupon').gte('created_at', `${monthStart}T00:00:00+07:00`).limit(5000),
    sb.from('rewards').select('*').order('sort').order('points_cost'),
    sb.from('coupons').select('code, title, business, status, used_at, used_by, created_at, customers(name, phone)').gte('created_at', `${monthStart}T00:00:00+07:00`).order('created_at', { ascending: false }).limit(300),
  ]);
  const cpm = (couponsMonth ?? []) as unknown as { code: string; title: string; business: string; status: string; used_at: string | null; used_by: string | null; created_at: string; customers: { name: string; phone: string } | null }[];
  const outstanding = (lots ?? []).reduce((a, l) => a + l.remaining, 0);
  const byCustomer = new Map<string, { name: string; phone: string; pts: number }>();
  for (const l of (lots ?? []) as unknown as { remaining: number; customer_id: string | null; customers: { name: string; phone: string } | null }[]) {
    if (!l.customer_id) continue;
    const cur = byCustomer.get(l.customer_id) ?? { name: l.customers?.name ?? '', phone: l.customers?.phone ?? '', pts: 0 };
    cur.pts += l.remaining; byCustomer.set(l.customer_id, cur);
  }
  const top = [...byCustomer.values()].sort((a, b) => b.pts - a.pts).slice(0, 10);
  const usedPtsMonth = (spentMonth ?? []).reduce((a, x) => a + x.points, 0);
  type Reward = { id: string; title: string; description: string | null; business: string; kind: string; value_baht: number; points_cost: number; valid_days: number; stock: number | null; active: boolean; sort: number };
  const BIZ: Record<string, string> = { parking: 'ที่จอดรถ', cafe: 'คาเฟ่', stay: 'ที่พัก' };
  const CST: Record<string, string> = { active: 'ยังไม่ใช้', used: 'ใช้แล้ว', cancelled: 'ยกเลิก' };
  const rewardForm = (r?: Reward) => (
    <ActionForm action={saveReward} className="form grid2" resetOnOk={!r}>
      {r && <input type="hidden" name="id" value={r.id} />}
      <label className="span2">ชื่อของรางวัล<input name="title" defaultValue={r?.title} placeholder="เช่น ส่วนลดค่าจอด 100 บาท / กาแฟ 1 แก้ว" required /></label>
      <label className="span2">รายละเอียด<input name="description" defaultValue={r?.description ?? ''} placeholder="แสดงให้ลูกค้าเห็น" /></label>
      <label>ธุรกิจ
        <select name="business" defaultValue={r?.business ?? 'parking'}><option value="parking">ที่จอดรถ</option><option value="cafe">คาเฟ่</option><option value="stay">ที่พัก</option></select>
      </label>
      <label>ประเภท
        <select name="kind" defaultValue={r?.kind ?? 'parking_discount'}><option value="parking_discount">ส่วนลดค่าจอด (ใช้ในหน้าจอง)</option><option value="item">ของ/บริการ (พนักงานกดใช้)</option></select>
      </label>
      <label>มูลค่าส่วนลด<span className="with-unit"><input name="value" type="number" min={0} defaultValue={r?.value_baht ?? 0} /><em>บาท</em></span><small>เฉพาะส่วนลดค่าจอด</small></label>
      <label>ใช้แต้ม<span className="with-unit"><input name="cost" type="number" min={1} defaultValue={r?.points_cost ?? 10} required /><em>แต้ม</em></span></label>
      <label>คูปองใช้ได้<span className="with-unit"><input name="valid_days" type="number" min={1} max={1095} defaultValue={r?.valid_days ?? 90} required /><em>วัน</em></span></label>
      <label>จำนวนที่แลกได้<input name="stock" type="number" min={0} defaultValue={r?.stock ?? ''} placeholder="เว้นว่าง = ไม่จำกัด" /></label>
      <label>ลำดับ<input name="sort" type="number" defaultValue={r?.sort ?? 0} /></label>
      <label className="check"><input type="checkbox" name="active" defaultChecked={r?.active ?? true} /> เปิดให้แลก</label>
      <div className="form-actions span2"><Submit small>{r ? 'บันทึก' : 'เพิ่มของรางวัล'}</Submit></div>
    </ActionForm>
  );
  const rows = (used ?? []) as unknown as Disc[];
  const cq = (c ?? '').replace(/[%,()\\]/g, ' ').trim().slice(0, 40);
  const [{ data: found }, { data: tierList }] = await Promise.all([
    sb.rpc('customer_lookup', { p_q: cq || null, p_only_manual: !cq }),
    sb.from('member_tiers').select('code, name, min_spend').order('sort'),
  ]);
  const people = (found ?? []) as Found[];

  // visit statistics: how many times each customer used the service and how often they come back
  const vq = (v ?? '').replace(/[%,()\\]/g, ' ').trim().slice(0, 40);
  const sortKey = ['visits', 'last', 'gap', 'recent12'].includes(vs ?? '') ? (vs as string) : 'visits';
  const page = Math.max(0, Math.min(500, Math.trunc(Number(vp) || 0)));
  const PER = 25;
  const [{ data: vsum }, { data: vrows }] = await Promise.all([
    sb.rpc('visit_stats_summary'),
    sb.rpc('customer_visit_stats', { p_q: vq || null, p_sort: sortKey, p_limit: PER, p_offset: page * PER }),
  ]);
  const sum0 = ((vsum ?? []) as { customers_with_visit: number; repeat_customers: number; total_visits: number; avg_gap_days: number | null }[])[0];
  type VRow = { id: string; name: string; phone: string; member_no: string | null; bookings: number; visits: number; repeats: number; first_visit: string | null; last_visit: string | null; avg_gap_days: number | null; visits_12m: number; total_days: number; total_count: number };
  const visitRows = (vrows ?? []) as VRow[];
  const { data: bdRows } = await sb.from('black_diamond').select('customer_id').eq('active', true);
  const bd = new Set((bdRows ?? []).map((x) => x.customer_id));
  const vTotal = visitRows[0]?.total_count ?? 0;
  const freq = (r: VRow) => r.avg_gap_days == null ? (r.visits >= 2 ? '—' : r.visits === 1 ? 'มาครั้งแรก' : 'ยังไม่เคยมาใช้') : r.avg_gap_days <= 10 ? 'บ่อยมาก (ทุก ~' + Math.round(r.avg_gap_days) + ' วัน)' : r.avg_gap_days <= 45 ? 'ทุกเดือน (ทุก ~' + Math.round(r.avg_gap_days) + ' วัน)' : r.avg_gap_days <= 120 ? 'ทุกไตรมาส (ทุก ~' + Math.round(r.avg_gap_days) + ' วัน)' : 'นาน ๆ ครั้ง (ทุก ~' + Math.round(r.avg_gap_days) + ' วัน)';
  const vlink = (o: { s?: string; p?: number }) => `/admin/members?${new URLSearchParams({ ...(vq ? { v: vq } : {}), vs: o.s ?? sortKey, vp: String(o.p ?? 0) })}#visits`;
  const referral = rows.filter((r) => r.discount_reason === 'referral');
  const sum = rows.reduce((a, r) => a + r.discount_amount, 0);

  return (
    <main className="page">
      <header className="page-head">
        <div><h1>สมาชิก แต้ม และส่วนลด</h1><p>ลูกค้าเก่า หรือลูกค้าใหม่ที่กรอกเบอร์ลูกค้าเก่าที่แนะนำ ได้ส่วนลดอัตโนมัติตอนจอง</p></div>
      </header>

      <section className="tiles">
        <div className="tile"><span>ลูกค้าที่เคยมาใช้บริการ</span><b>{(sum0?.customers_with_visit ?? 0).toLocaleString('th-TH')}<small> คน</small></b><em>นับเฉพาะที่รับรถออกแล้ว</em></div>
        <div className="tile"><span>กลับมาใช้ซ้ำ</span><b>{(sum0?.repeat_customers ?? 0).toLocaleString('th-TH')}<small> คน</small></b><em>{sum0?.customers_with_visit ? Math.round((sum0.repeat_customers / sum0.customers_with_visit) * 100) : 0}% ของลูกค้าทั้งหมด</em></div>
        <div className="tile"><span>ครั้งที่ใช้บริการทั้งหมด</span><b>{(sum0?.total_visits ?? 0).toLocaleString('th-TH')}<small> ครั้ง</small></b><em>เฉลี่ย {sum0?.customers_with_visit ? (sum0.total_visits / sum0.customers_with_visit).toFixed(1) : 0} ครั้ง/คน</em></div>
        <div className="tile"><span>ห่างกันเฉลี่ย</span><b>{sum0?.avg_gap_days != null ? Math.round(sum0.avg_gap_days) : '—'}<small> วัน</small></b><em>ระหว่างการมาใช้แต่ละครั้ง</em></div>
      </section>

      <section className="panel" id="visits">
        <div className="panel-head">
          <h2>ลูกค้าทั้งหมดและความถี่การใช้บริการ ({vTotal.toLocaleString('th-TH')})</h2>
          <form className="search" action="/admin/members#visits"><input type="hidden" name="vs" value={sortKey} /><input name="v" defaultValue={v ?? ''} placeholder="ชื่อ / เบอร์โทร / เลขสมาชิก" aria-label="ค้นหาลูกค้า" /><button className="b b-primary">ค้นหา</button></form>
        </div>
        <p className="hint">ครั้งที่ใช้บริการ = การจองที่รับรถออกแล้ว · กลับมาใช้ = ครั้งที่ใช้ลบ 1 · ความถี่ = ระยะห่างเฉลี่ยระหว่างวันเข้าจอดแต่ละครั้ง · เรียงตาม:{' '}
          {([['visits', 'ใช้บ่อยที่สุด'], ['recent12', '12 เดือนล่าสุด'], ['last', 'มาล่าสุด'], ['gap', 'ห่างน้อยสุด']] as const).map(([k, l], i) => <span key={k}>{i > 0 && ' · '}{sortKey === k ? <b>{l}</b> : <a href={vlink({ s: k })}>{l}</a>}</span>)}</p>
        {!visitRows.length ? <p className="empty">{vq ? `ไม่พบลูกค้าที่ตรงกับ “${vq}”` : 'ยังไม่มีข้อมูลการใช้บริการ'}</p> : (
          <>
            <table className="tbl">
              <thead><tr><th>ลูกค้า</th><th className="r">ใช้บริการ</th><th className="r">กลับมาใช้</th><th className="r">12 เดือน</th><th className="r">วันจอดรวม</th><th>ความถี่</th><th>ครั้งแรก</th><th>ล่าสุด</th></tr></thead>
              <tbody>
                {visitRows.map((r) => (
                  <tr key={r.id}>
                    <td><b>{bd.has(r.id) && <span title="Black Diamond">◆ </span>}{r.name}</b><small>{fmtPhone(r.phone)}{r.member_no ? ` · ${r.member_no}` : ''}</small></td>
                    <td className="r">{r.visits}{r.bookings > r.visits && <small>จองอยู่ {r.bookings - r.visits}</small>}</td>
                    <td className="r">{r.repeats}</td>
                    <td className="r">{r.visits_12m}</td>
                    <td className="r">{r.total_days}</td>
                    <td>{freq(r)}</td>
                    <td>{r.first_visit ? thDate(r.first_visit) : '—'}</td>
                    <td>{r.last_visit ? thDate(r.last_visit) : '—'}</td>
                  </tr>
                ))}
              </tbody>
            </table>
            <p className="hint" style={{ display: 'flex', gap: 12, alignItems: 'center' }}>
              {page > 0 && <a className="b b-plain b-sm" href={vlink({ p: page - 1 })}>← ก่อนหน้า</a>}
              <span>แสดง {(page * PER + 1).toLocaleString('th-TH')}–{(page * PER + visitRows.length).toLocaleString('th-TH')} จาก {vTotal.toLocaleString('th-TH')}</span>
              {(page + 1) * PER < vTotal && <a className="b b-plain b-sm" href={vlink({ p: page + 1 })}>ถัดไป →</a>}
            </p>
          </>
        )}
      </section>

      <section className="panel" id="tier">
        <div className="panel-head">
          <h2>ระดับสมาชิกรายคน</h2>
          <form className="search" action="/admin/members#tier"><input name="c" defaultValue={c ?? ''} placeholder="ชื่อ / เบอร์โทร / เลขสมาชิก (BY…)" aria-label="ค้นหาลูกค้า" /><button className="b b-primary">ค้นหา</button></form>
        </div>
        <p className="hint">ปกติระดับคิดจากยอดใช้บริการ 12 เดือนอัตโนมัติ · กำหนดเองได้สำหรับลูกค้า VIP หรือกรณีพิเศษ ระดับที่กำหนดเองจะไม่ขึ้นลงตามยอดจนกว่าจะกด “ตามยอดใช้จ่าย”</p>
        {!cq && <h3 style={{ margin: '4px 0 8px' }}>ลูกค้าที่กำหนดระดับเอง ({people.length})</h3>}
        {!people.length ? <p className="empty">{cq ? `ไม่พบลูกค้าที่ตรงกับ “${cq}”` : 'ยังไม่มีลูกค้าที่กำหนดระดับเอง · ค้นหาด้วยชื่อหรือเบอร์โทรด้านบน'}</p> : (
          <table className="tbl">
            <thead><tr><th>ลูกค้า</th><th>ระดับตอนนี้</th><th className="r">ยอด 12 เดือน</th><th className="r">แต้ม</th><th className="r">จอง</th><th>กำหนดระดับ</th></tr></thead>
            <tbody>
              {people.map((p) => (
                <tr key={p.id}>
                  <td><b>{p.name}</b><small>{p.phone}{p.member_no ? ` · ${p.member_no}` : ''}</small></td>
                  <td><span className={`tier-tag tier-${p.tier}`}>{p.tier_name}</span>{p.manual && <small>กำหนดเอง</small>}</td>
                  <td className="r">{p.spend.toLocaleString('th-TH')}</td>
                  <td className="r">{p.points.toLocaleString('th-TH')}</td>
                  <td className="r">{p.bookings}{p.last_start && <small>ล่าสุด {thDate(p.last_start)}</small>}</td>
                  <td>
                    <ActionForm action={setTierOverride} className="tier-row">
                      <input type="hidden" name="customer_id" value={p.id} />
                      <select name="tier" defaultValue={p.manual ? p.tier : ''} aria-label={`ระดับของ ${p.name}`}>
                        <option value="">ตามยอดใช้จ่าย (อัตโนมัติ)</option>
                        {(tierList ?? []).map((t) => <option key={t.code} value={t.code}>{t.name}</option>)}
                      </select>
                      <Submit small variant="plain">บันทึก</Submit>
                    </ActionForm>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </section>

      <section className="tiles">
        <div className="tile"><span>ส่วนลดตอนนี้</span><b>{(s?.member_discount ?? 0).toLocaleString('th-TH')}<small> บาท/การจอง</small></b><em>{s?.member_discount ? 'เปิดใช้อยู่' : 'ปิดอยู่'}</em></div>
        <div className="tile"><span>ใช้ส่วนลดเดือนนี้</span><b>{rows.length}<small> การจอง</small></b><em>รวม {sum.toLocaleString('th-TH')} บาท</em></div>
        <div className="tile"><span>มาจากเพื่อนแนะนำ</span><b>{referral.length}<small> การจอง</small></b><em>ลูกค้าใหม่ที่กรอกเบอร์ผู้แนะนำ</em></div>
        <div className="tile"><span>เบอร์ลูกค้าเก่าที่นำเข้า</span><b>{(count ?? 0).toLocaleString('th-TH')}<small> เบอร์</small></b><em>ลูกค้าที่เคยจ่ายในระบบนับให้อัตโนมัติ</em></div>
      </section>

      <section className="tiles">
        <div className="tile"><span>แต้มคงค้างทั้งหมด</span><b>{outstanding.toLocaleString('th-TH')}<small> แต้ม</small></b><em>ที่ลูกค้ายังไม่ได้แลก</em></div>
        <div className="tile"><span>แลกคูปองเดือนนี้</span><b>{cpm.filter((c) => c.status !== 'cancelled').length}<small> ใบ</small></b><em>ใช้ไป {usedPtsMonth.toLocaleString('th-TH')} แต้ม · ใช้แล้ว {cpm.filter((c) => c.status === 'used').length} ใบ</em></div>
        <div className="tile"><span>สมาชิกที่มีแต้ม</span><b>{byCustomer.size.toLocaleString('th-TH')}<small> คน</small></b><em>{s?.points_enabled ? 'ระบบแต้มเปิดอยู่' : 'ระบบแต้มปิดอยู่'}</em></div>
      </section>

      <div className="cols">
        <section className="panel">
          <h2>กติกาแต้มสะสม</h2>
          <p className="hint">แต้มได้เมื่อชำระเงินสำเร็จ คิดจากยอดที่จ่ายจริง · ลูกค้าเอาแต้มไปแลกคูปองจากรายการของรางวัล · แต้มเก่าถูกใช้ก่อน</p>
          <ActionForm action={setPointsSettings} className="form grid2">
            <label>ทุกกี่บาทได้ 1 แต้ม<span className="with-unit"><input name="per_baht" type="number" min={1} defaultValue={s?.points_per_baht ?? 100} required /><em>บาท</em></span></label>
            <input type="hidden" name="value" value={s?.point_value ?? 10} />
            <label>แนะนำเพื่อนได้<span className="with-unit"><input name="referral" type="number" min={0} defaultValue={s?.referral_points ?? 3} required /><em>แต้ม</em></span></label>
            <label>อายุแต้ม<span className="with-unit"><input name="months" type="number" min={1} max={120} defaultValue={s?.points_expiry_months ?? 36} required /><em>เดือน</em></span></label>
            <label className="check span2"><input type="checkbox" name="enabled" defaultChecked={s?.points_enabled ?? true} /> เปิดใช้ระบบแต้ม</label>
            <div className="form-actions span2"><Submit>บันทึกกติกา</Submit></div>
          </ActionForm>
          <p className="hint" style={{ marginTop: 8 }}>ตัวอย่าง: จ่าย 600 บาท ได้ {Math.floor(600 / (s?.points_per_baht || 100))} แต้ม</p>
        </section>
        <section className="panel">
          <h2>ลูกค้าที่มีแต้มมากที่สุด</h2>
          {!top.length ? <p className="empty">ยังไม่มี</p> : (
            <table className="tbl">
              <thead><tr><th>ลูกค้า</th><th>เบอร์</th><th className="r">แต้ม</th></tr></thead>
              <tbody>{top.map((t) => <tr key={t.phone + t.name}><td>{t.name}</td><td>{t.phone}</td><td className="r">{t.pts.toLocaleString('th-TH')}</td></tr>)}</tbody>
            </table>
          )}
          <p className="hint" style={{ marginTop: 8 }}>เพิ่มหรือลดแต้มให้ลูกค้าได้ที่หน้ารายละเอียดการจองของลูกค้าคนนั้น</p>
        </section>
      </div>

      <section className="panel">
        <h2>ของรางวัล</h2>
        <p className="hint">ลูกค้าเห็นเฉพาะรายการที่เปิดให้แลก · ส่วนลดค่าจอดลูกค้าเลือกใช้เองในหน้าจอง · ของหรือบริการ (กาแฟ ห้องพัก) ลูกค้าแสดงรหัสคูปอง แล้วพนักงานกด “ใช้คูปอง” ด้านล่าง</p>
        <table className="tbl">
          <thead><tr><th>ของรางวัล</th><th>ธุรกิจ</th><th className="r">แต้ม</th><th className="r">อายุคูปอง</th><th className="r">คงเหลือ</th><th>สถานะ</th><th></th></tr></thead>
          <tbody>
            {((rewards ?? []) as Reward[]).map((r) => (
              <tr key={r.id}>
                <td><b>{r.title}</b>{r.kind === 'parking_discount' && <small className="hint" style={{ display: 'block', margin: 0 }}>ส่วนลดค่าจอด {r.value_baht} บาท</small>}</td>
                <td>{BIZ[r.business] ?? r.business}</td>
                <td className="r">{r.points_cost}</td>
                <td className="r">{r.valid_days} วัน</td>
                <td className="r">{r.stock ?? 'ไม่จำกัด'}</td>
                <td><span className={`st ${r.active ? 'st-ok' : 'st-off'}`}>{r.active ? 'เปิดแลก' : 'ปิด'}</span></td>
                <td className="r"><details className="inline-edit"><summary className="b b-plain b-sm">แก้ไข</summary><div className="inline-edit-body">{rewardForm(r)}</div></details></td>
              </tr>
            ))}
          </tbody>
        </table>
        <details className="add-reward" style={{ marginTop: 12 }}><summary className="b b-plain b-sm">+ เพิ่มของรางวัล</summary><div style={{ marginTop: 10 }}>{rewardForm()}</div></details>
      </section>

      <div className="cols">
        <section className="panel">
          <h2>ใช้คูปองที่หน้าร้าน</h2>
          <p className="hint">ลูกค้าแสดงรหัสคูปองจากหน้า “แลกของรางวัล” ใน LINE (เช่น CABC2345)</p>
          <ActionForm action={takeCoupon} className="form" resetOnOk>
            <label>รหัสคูปอง<input name="code" placeholder="CXXXXXXX" autoCapitalize="characters" required /></label>
            <div className="form-actions"><Submit>ใช้คูปอง</Submit></div>
          </ActionForm>
          <details style={{ marginTop: 10 }}><summary className="hint" style={{ cursor: 'pointer' }}>ยกเลิกคูปองและคืนแต้มให้ลูกค้า</summary>
            <ActionForm action={cancelCoupon} className="form" resetOnOk confirm="ยกเลิกคูปองนี้และคืนแต้มให้ลูกค้า?">
              <label>รหัสคูปอง<input name="code" required /></label>
              <div className="form-actions"><Submit variant="danger" small>ยกเลิกคูปอง</Submit></div>
            </ActionForm>
          </details>
        </section>
        <section className="panel">
          <h2>คูปองที่แลกเดือนนี้</h2>
          {!cpm.length ? <p className="empty">ยังไม่มี</p> : (
            <table className="tbl">
              <thead><tr><th>รหัส</th><th>ของรางวัล</th><th>ลูกค้า</th><th>สถานะ</th></tr></thead>
              <tbody>{cpm.slice(0, 30).map((c) => (
                <tr key={c.code}><td>{c.code}</td><td>{c.title}</td><td>{c.customers?.name}</td><td>{CST[c.status] ?? c.status}{c.used_by && c.status === 'used' && c.used_by !== 'booking' ? ` (${c.used_by})` : ''}</td></tr>
              ))}</tbody>
            </table>
          )}
        </section>
      </div>

      <div className="cols">
        <section className="panel">
          <h2>นำเข้าเบอร์ลูกค้าเก่า</h2>
          <p className="hint">สำหรับลูกค้าก่อนมีระบบ วางทีละบรรทัด: เบอร์โทร ตามด้วยชื่อ (ถ้ามี) เช่น <code>081-234-5678 คุณสมชาย</code> เบอร์ซ้ำจะถูกข้าม</p>
          <ActionForm action={importMembers} className="form" resetOnOk>
            <textarea name="lines" rows={8} placeholder={'0812345678 คุณสมชาย\n089-111-2222 คุณวิภา\n+66 86 555 1234'} />
            <div className="form-actions"><Submit>นำเข้า</Submit></div>
          </ActionForm>
        </section>
        <section className="panel">
          <h2>จำนวนส่วนลด</h2>
          <p className="hint">ลดต่อการจองหนึ่งครั้ง ใส่ 0 เพื่อปิดส่วนลด มีผลกับการจองใหม่ทันที</p>
          <ActionForm action={setMemberDiscount} className="form">
            <label>ส่วนลด<span className="with-unit"><input name="amount" type="number" min={0} max={10000} defaultValue={s?.member_discount ?? 100} required /><em>บาท</em></span></label>
            <div className="form-actions"><Submit>บันทึก</Submit></div>
          </ActionForm>
          <h3 style={{ marginTop: 18 }}>เงื่อนไขการจอง</h3>
          <ActionForm action={setMemberDiscountRules} className="form grid2">
            <label>จองอย่างน้อย<span className="with-unit"><input name="min_days" type="number" min={1} max={60} defaultValue={s?.member_discount_min_days ?? 3} required /><em>วัน</em></span></label>
            <label className="check" style={{ alignSelf: 'end' }}><input type="checkbox" name="needs_shuttle" defaultChecked={s?.member_discount_needs_shuttle ?? true} /> ต้องใช้รถรับส่ง</label>
            <div className="form-actions span2"><Submit small variant="plain">บันทึกเงื่อนไข</Submit></div>
          </ActionForm>
          <h3 style={{ marginTop: 18 }}>ใครได้ส่วนลด</h3>
          <ul className="hint" style={{ paddingLeft: 18, margin: 0 }}>
            <li>เบอร์ของผู้จองอยู่ในรายชื่อด้านล่าง หรือเคยจองและจ่ายเงินในระบบแล้ว</li>
            <li>ลูกค้าใหม่ที่กรอก “เบอร์ลูกค้าเก่าที่แนะนำ” ตรงกับข้อแรก (ใส่เบอร์ตัวเองไม่ได้)</li>
            <li>ลูกค้าที่มาจากเพื่อนแนะนำ จองครั้งต่อไปจะนับเป็นลูกค้าเก่าเอง</li>
          </ul>
        </section>
      </div>

      <section className="panel">
        <div className="panel-head">
          <h2>รายชื่อที่นำเข้า</h2>
          <form className="search" action="/admin/members"><input name="q" defaultValue={q ?? ''} placeholder="ค้นหาเบอร์หรือชื่อ" /><button className="b b-plain">ค้นหา</button></form>
        </div>
        {!members?.length ? <p className="empty">{q ? 'ไม่พบ' : 'ยังไม่มีเบอร์ที่นำเข้า'}</p> : (
          <table className="tbl">
            <thead><tr><th>เบอร์</th><th>ชื่อ</th><th>เพิ่มเมื่อ</th><th></th></tr></thead>
            <tbody>
              {(members as Member[]).map((m) => (
                <tr key={m.phone}>
                  <td>{fmtPhone(m.phone)}</td><td>{m.name ?? '—'}</td><td>{thDate(bkkDay(m.created_at))}</td>
                  <td className="r"><ActionButton action={removeMember} fields={{ phone: m.phone }} label="ลบ" variant="danger" confirm={`ลบเบอร์ ${fmtPhone(m.phone)} ออกจากรายชื่อลูกค้าเก่า?`} /></td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
        {(count ?? 0) > 50 && !q && <p className="hint">แสดง 50 รายการล่าสุด ใช้ช่องค้นหาเพื่อดูเบอร์อื่น</p>}
      </section>

      <section className="panel">
        <h2>การจองที่ได้ส่วนลดเดือนนี้</h2>
        {!rows.length ? <p className="empty">ยังไม่มี</p> : (
          <table className="tbl">
            <thead><tr><th>รหัส</th><th>ลูกค้า</th><th>ประเภท</th><th>ผู้แนะนำ</th><th className="r">ส่วนลด</th></tr></thead>
            <tbody>
              {rows.slice(0, 50).map((r) => (
                <tr key={r.id}>
                  <td><a href={`/admin/bookings/${r.id}`}>{r.code}</a></td>
                  <td>{r.customers?.name} · {r.customers?.phone}</td>
                  <td>{r.discount_reason === 'referral' ? 'เพื่อนแนะนำ' : 'ลูกค้าเก่า'}</td>
                  <td>{r.referrer_phone ? fmtPhone(r.referrer_phone) : '—'}</td>
                  <td className="r">{r.discount_amount.toLocaleString('th-TH')}</td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </section>
      <p className="hint" style={{ textAlign: 'right', opacity: 0.55 }}><a href="/admin/members/black-diamond">◆</a></p>
    </main>
  );
}
