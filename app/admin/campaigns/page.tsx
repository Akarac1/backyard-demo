import { db } from '@/lib/supabase';
import { ActionForm, Submit } from '@/components/ActionForm';
import { MemberCard } from '@/components/MemberCard';
import { CampaignForm } from '@/components/CampaignForm';
import { recordPurchase, saveCampaign, saveTier } from '../actions';
import { thDate, bkkDay } from '@/lib/format';

export const dynamic = 'force-dynamic';

type Tier = { code: string; name: string; min_spend: number; multiplier: number; color: string; sort: number };
type Campaign = { id: string; name: string; description: string | null; business: string; tiers: string[] | null; kind: string; multiplier: number; bonus_points: number; starts_at: string; ends_at: string | null; active: boolean; min_days: number; free_days: number; amount_off: number; stackable: boolean; percent_off: number; stay_from: string | null; stay_to: string | null };

const BIZ: Record<string, string> = { all: 'ทุกธุรกิจ', parking: 'ที่จอดรถ', cafe: 'คาเฟ่', stay: 'ที่พัก' };
const KIND: Record<string, string> = { free_days: 'ส่วนลด: จอดครบ ฟรีวัน', amount_off: 'ส่วนลด: จอดครบ ลดเงิน', percent_off: 'ส่วนลด: ลดค่าจอด %', multiplier: 'แต้มคูณ', bonus: 'แต้มโบนัส', announce: 'ประกาศ/โปรโมชัน' };
const effect = (c: Campaign) => c.kind === 'multiplier' ? `แต้ม x${Number(c.multiplier)}` : c.kind === 'bonus' ? `+${c.bonus_points} แต้ม`
  : c.kind === 'free_days' ? `จอด ${c.min_days}+ วัน ฟรี ${c.free_days} วัน` : c.kind === 'amount_off' ? `จอด ${c.min_days}+ วัน ลด ${c.amount_off.toLocaleString('th-TH')} บาท`
  : c.kind === 'percent_off' ? `ลดค่าจอด ${c.percent_off}%${c.min_days > 1 ? ` (จอด ${c.min_days}+ วัน)` : ''}` : 'ประกาศ';
const localInput = (ts: string | null) => (ts ? new Date(ts).toLocaleString('sv-SE', { timeZone: 'Asia/Bangkok' }).slice(0, 16).replace(' ', 'T') : '');

function campaignState(c: Campaign): [string, string] {
  const now = Date.now();
  if (!c.active) return ['ปิด', 'st-off'];
  if (Date.parse(c.starts_at) > now) return ['รอเริ่ม', 'st-wait'];
  if (c.ends_at && Date.parse(c.ends_at) <= now) return ['จบแล้ว', 'st-off'];
  return ['กำลังใช้', 'st-ok'];
}

export default async function CampaignsPage() {
  const sb = db();
  const [{ data: tiers }, { data: camps }, { data: st }, { data: tc }, { data: purchases }] = await Promise.all([
    sb.from('member_tiers').select('*').order('sort'),
    sb.from('campaigns').select('*').order('starts_at', { ascending: false }).limit(100),
    sb.from('settings').select('points_per_baht, tier_window_months').eq('id', 1).single(),
    sb.rpc('tier_counts'),
    sb.from('member_purchases').select('id, business, amount, note, staff, created_at, customers(name, member_no)').order('created_at', { ascending: false }).limit(15),
  ]);
  const T = (tiers ?? []) as Tier[];
  // tier per customer (computed in the database)
  const counts: Record<string, number> = {};
  for (const r of (tc ?? []) as { tier: string; n: number }[]) counts[r.tier] = Number(r.n);
  const per = st?.points_per_baht ?? 100;

  const tierList = T.map((t) => ({ code: t.code, name: t.name }));
  const campaignForm = (c?: Campaign) => <CampaignForm action={saveCampaign} tiers={tierList} init={c ? { ...c, multiplier: Number(c.multiplier) } : undefined} />;


  return (
    <main className="page">
      <header className="page-head">
        <div><h1>Backyard Member · ระดับและแคมเปญ</h1><p>ระดับคิดจากยอดใช้บริการ {st?.tier_window_months ?? 12} เดือนล่าสุด รวมที่จอดรถ คาเฟ่ และที่พัก · ทุก {per} บาทได้ 1 แต้ม แล้วคูณตามระดับ</p></div>
      </header>

      <section className="panel">
        <h2>บัตรสมาชิกแต่ละระดับ</h2>
        <div className="cards-row">
          {T.map((t) => (
            <div key={t.code}>
              <MemberCard tier={t.code} tierName={t.name} name="คุณสมชาย ใจดี" memberNo="BY001234" points={t.code === 'gold' ? 1280 : t.code === 'silver' ? 420 : 35} multiplier={Number(t.multiplier)} />
              <p className="hint" style={{ marginTop: 8 }}>{t.min_spend === 0 ? 'เริ่มต้นทุกคน' : `ใช้บริการ ${t.min_spend.toLocaleString('th-TH')} บาทขึ้นไป`} · สมาชิก {(counts[t.code] ?? 0).toLocaleString('th-TH')} คน</p>
            </div>
          ))}
        </div>
      </section>

      <section className="panel">
        <h2>ตั้งค่าระดับ</h2>
        <table className="tbl">
          <thead><tr><th>ระดับ</th><th>ชื่อ</th><th>ยอดใช้บริการขั้นต่ำ ({st?.tier_window_months ?? 12} เดือน)</th><th>ตัวคูณแต้ม</th><th>ตัวอย่าง: จ่าย 600 บาท</th><th></th></tr></thead>
          <tbody>
            {T.map((t, i) => (
              <tr key={t.code}>
                <td><span className="tier-dot" style={{ background: t.color }} /> {t.code}</td>
                <td colSpan={5}>
                  <ActionForm action={saveTier} className="tier-row">
                    <input type="hidden" name="code" value={t.code} />
                    <input name="name" defaultValue={t.name} required aria-label="ชื่อระดับ" />
                    <span className="with-unit"><input name="min" type="number" min={0} defaultValue={t.min_spend} readOnly={i === 0} required aria-label="ยอดขั้นต่ำ" /><em>บาท</em></span>
                    <span className="with-unit"><em>x</em><input name="mult" type="number" step="0.1" min={0.1} max={10} defaultValue={Number(t.multiplier)} required aria-label="ตัวคูณ" /></span>
                    <span className="hint" style={{ margin: 0 }}>ได้ {Math.floor(Math.floor(600 / per) * Number(t.multiplier))} แต้ม</span>
                    <Submit small variant="plain">บันทึก</Submit>
                  </ActionForm>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
        <p className="hint" style={{ marginTop: 8 }}>ระดับขึ้นทันทีที่ยอดถึง และลดลงเองเมื่อยอด {st?.tier_window_months ?? 12} เดือนล่าสุดต่ำกว่าเกณฑ์ · กำหนดระดับให้ลูกค้าเป็นรายคนได้ที่หน้ารายละเอียดการจอง</p>
      </section>

      <section className="panel">
        <div className="panel-head"><h2>แคมเปญ</h2></div>
        <p className="hint">ส่วนลดการจอง (จอดครบ ฟรีวัน / ลดเงิน / ลด %): ระบบหักให้เองตอนจอง กำหนดช่วงวันเข้าจอดได้ เช่น ปีใหม่ สงกรานต์ ถ้าเข้าได้หลายแคมเปญใช้ตัวที่ลดมากที่สุด · แต้มคูณ: ใช้ตัวที่คูณมากที่สุด · แต้มโบนัส: บวกทุกแคมเปญ · ประกาศ: แสดงบนบัตรสมาชิกใน LINE อย่างเดียว</p>
        {!camps?.length ? <p className="empty">ยังไม่มีแคมเปญ</p> : (
          <table className="tbl">
            <thead><tr><th>แคมเปญ</th><th>ธุรกิจ</th><th>ระดับ</th><th>สิทธิ์</th><th>ช่วงเวลา</th><th>สถานะ</th><th></th></tr></thead>
            <tbody>
              {(camps as Campaign[]).map((c) => {
                const [label, cls] = campaignState(c);
                return (
                  <tr key={c.id}>
                    <td><b>{c.name}</b>{c.description && <small className="hint" style={{ display: 'block', margin: 0 }}>{c.description}</small>}</td>
                    <td>{BIZ[c.business] ?? c.business}</td>
                    <td>{c.tiers?.length ? c.tiers.map((x) => T.find((t) => t.code === x)?.name ?? x).join(', ') : 'ทุกระดับ'}</td>
                    <td>{effect(c)}{['free_days', 'amount_off', 'percent_off'].includes(c.kind) && !c.stackable && <small className="hint" style={{ display: 'block', margin: 0 }}>ไม่ใช้ร่วมกับส่วนลดลูกค้าเก่า</small>}</td>
                    <td>จอง {thDate(bkkDay(c.starts_at))} – {c.ends_at ? thDate(bkkDay(c.ends_at)) : 'ไม่กำหนด'}{(c.stay_from || c.stay_to) && <small className="hint" style={{ display: 'block', margin: 0 }}>เข้าจอด {c.stay_from ? thDate(c.stay_from) : '…'} – {c.stay_to ? thDate(c.stay_to) : '…'}</small>}</td>
                    <td><span className={`st ${cls}`}>{label}</span></td>
                    <td className="r"><details className="inline-edit"><summary className="b b-plain b-sm">แก้ไข</summary><div className="inline-edit-body">{campaignForm(c)}</div></details></td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        )}
        <details className="add-reward" style={{ marginTop: 12 }}><summary className="b b-plain b-sm">+ สร้างแคมเปญ</summary><div style={{ marginTop: 10, maxWidth: 760 }}>{campaignForm()}</div></details>
      </section>

      <div className="cols">
        <section className="panel">
          <h2>บันทึกยอดคาเฟ่ / ที่พัก</h2>
          <p className="hint">สำหรับธุรกิจที่ยังไม่มีระบบจองของตัวเอง: พนักงานกรอกเบอร์หรือเลขสมาชิก (BY…) และยอดที่ลูกค้าจ่าย ลูกค้าได้แต้มตามระดับและแคมเปญ และนับเข้ายอดเลื่อนระดับ</p>
          <ActionForm action={recordPurchase} className="form grid2" resetOnOk>
            <label>เบอร์โทร หรือ เลขสมาชิก<input name="who" placeholder="0812345678 / BY001234" required /></label>
            <label>ธุรกิจ<select name="business" defaultValue="cafe"><option value="cafe">คาเฟ่</option><option value="stay">ที่พัก</option></select></label>
            <label>ยอดที่จ่าย<span className="with-unit"><input name="amount" type="number" min={1} required /><em>บาท</em></span></label>
            <label>หมายเหตุ<input name="note" placeholder="เช่น เลขบิล" /></label>
            <div className="form-actions span2"><Submit>บันทึกและให้แต้ม</Submit></div>
          </ActionForm>
        </section>
        <section className="panel">
          <h2>ยอดที่บันทึกล่าสุด</h2>
          {!purchases?.length ? <p className="empty">ยังไม่มี</p> : (
            <table className="tbl">
              <thead><tr><th>วันที่</th><th>สมาชิก</th><th>ธุรกิจ</th><th className="r">ยอด</th></tr></thead>
              <tbody>{(purchases as unknown as { id: number; business: string; amount: number; created_at: string; customers: { name: string; member_no: string } | null }[]).map((p) => (
                <tr key={p.id}><td>{thDate(bkkDay(p.created_at))}</td><td>{p.customers?.name} <small className="hint">{p.customers?.member_no}</small></td><td>{BIZ[p.business] ?? p.business}</td><td className="r">{p.amount.toLocaleString('th-TH')}</td></tr>
              ))}</tbody>
            </table>
          )}
        </section>
      </div>
    </main>
  );
}
