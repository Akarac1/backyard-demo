'use client';
import { useCallback, useEffect, useState } from 'react';
import Link from 'next/link';
import { authHeaders, useLiff } from '../useLiff';

type Reward = { id: string; title: string; description: string | null; business: string; kind: string; value_baht: number; points_cost: number; valid_days: number; stock: number | null };
type Coupon = { id: string; code: string; title: string; business: string; kind: string; status: string; expires_at: string; used_at: string | null };
type Data = { points: number; enabled: boolean; rewards: Reward[]; coupons: Coupon[] };

const BUSINESS: Record<string, string> = { parking: 'ที่จอดรถ', cafe: 'คาเฟ่', stay: 'ที่พัก' };
const COUPON_STATUS: Record<string, string> = { active: 'ใช้ได้', used: 'ใช้แล้ว', expired: 'หมดอายุ', cancelled: 'ยกเลิก' };
const thShort = (ts: string) => new Date(ts).toLocaleDateString('th-TH', { timeZone: 'Asia/Bangkok', day: 'numeric', month: 'short', year: '2-digit' });

export default function Rewards() {
  const liff = useLiff();
  const [d, setD] = useState<Data | null>(null);
  const [denied, setDenied] = useState(false);
  const [pick, setPick] = useState<Reward | null>(null);
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<{ ok?: string; error?: string } | null>(null);
  const [tab, setTab] = useState<'rewards' | 'coupons'>('rewards');

  const load = useCallback(() => {
    fetch('/api/rewards', { headers: authHeaders(liff.idToken) })
      .then(async (r) => { if (r.status === 401) { setDenied(true); return; } if (r.ok) setD(await r.json()); })
      .catch(() => {});
  }, [liff.idToken]);
  useEffect(() => { if (liff.ready) load(); }, [liff.ready, load]);

  async function redeem() {
    if (!pick) return;
    setBusy(true); setMsg(null);
    const r = await fetch('/api/rewards', { method: 'POST', headers: { 'Content-Type': 'application/json', ...authHeaders(liff.idToken) }, body: JSON.stringify({ rewardId: pick.id }) });
    const j = await r.json().catch(() => ({}));
    setBusy(false); setPick(null);
    if (!r.ok) { setMsg({ error: j.error ?? 'แลกไม่สำเร็จ' }); return; }
    setMsg({ ok: `แลก “${j.title}” แล้ว · รหัสคูปอง ${j.code}` });
    setTab('coupons');
    load();
  }

  const groups = Object.entries((d?.rewards ?? []).reduce<Record<string, Reward[]>>((a, r) => { (a[r.business] ??= []).push(r); return a; }, {}));
  const active = (d?.coupons ?? []).filter((c) => c.status === 'active');
  const past = (d?.coupons ?? []).filter((c) => c.status !== 'active');

  return (
    <main>
      <div className="hero">
        <span className="chip">Backyard Airport · สมาชิก</span>
        <h1>แลกของรางวัล</h1>
        <p>แต้มของคุณ <b style={{ color: '#E0B04A', fontSize: 22 }}>{(d?.points ?? 0).toLocaleString('th-TH')}</b> แต้ม</p>
      </div>
      <div className="wrap">
        {denied && <div className="alert bad">ยืนยันตัวตนกับ LINE ไม่สำเร็จ กรุณาเปิดหน้านี้จากเมนูใน LINE อีกครั้ง</div>}
        {!d && !denied && <p className="small">กำลังโหลด…</p>}
        {msg?.ok && <div className="alert ok">{msg.ok}</div>}
        {msg?.error && <div className="alert bad">{msg.error}</div>}
        {d && !d.enabled && <div className="alert info">ระบบแลกของรางวัลปิดชั่วคราว</div>}

        {d && (
          <div className="toggle" style={{ marginBottom: 12 }}>
            <button type="button" className={tab === 'rewards' ? 'on' : ''} onClick={() => setTab('rewards')}>ของรางวัล</button>
            <button type="button" className={tab === 'coupons' ? 'on' : ''} onClick={() => setTab('coupons')}>คูปองของฉัน{active.length ? ` (${active.length})` : ''}</button>
          </div>
        )}

        {d && tab === 'rewards' && (
          <>
            {!groups.length && <div className="card">ยังไม่มีของรางวัล</div>}
            {groups.map(([biz, list]) => (
              <div key={biz}>
                <h2 className="reward-group">{BUSINESS[biz] ?? biz}</h2>
                {list.map((r) => {
                  const enough = d.points >= r.points_cost;
                  return (
                    <div className="card reward" key={r.id}>
                      <div className="reward-main">
                        <b>{r.title}</b>
                        {r.description && <span className="small">{r.description}</span>}
                        <span className="small">ใช้ได้ {r.valid_days} วันหลังแลก{r.stock != null ? ` · เหลือ ${r.stock}` : ''}</span>
                      </div>
                      <div className="reward-side">
                        <span className="cost">{r.points_cost.toLocaleString('th-TH')}<small> แต้ม</small></span>
                        <button type="button" className="btn primary btn-sm" disabled={!enough || !d.enabled} onClick={() => setPick(r)}>{enough ? 'แลก' : `ขาด ${r.points_cost - d.points}`}</button>
                      </div>
                    </div>
                  );
                })}
              </div>
            ))}
          </>
        )}

        {d && tab === 'coupons' && (
          <>
            {!active.length && <div className="card">ยังไม่มีคูปองที่ใช้ได้ <button type="button" className="link-btn" onClick={() => setTab('rewards')}>ไปแลกของรางวัล</button></div>}
            {active.map((c) => (
              <div className="card coupon" key={c.id}>
                <div className="coupon-code">{c.code}</div>
                <b>{c.title}</b>
                <span className="small">ใช้ได้ถึง {thShort(c.expires_at)}</span>
                <span className="small">{c.kind === 'parking_discount' ? 'เลือกใช้ได้ในหน้ายืนยันการจองที่จอดรถ' : 'แสดงรหัสนี้ให้พนักงานเมื่อใช้สิทธิ์'}</span>
              </div>
            ))}
            {past.length > 0 && <h2 className="reward-group">ประวัติคูปอง</h2>}
            {past.map((c) => (
              <div className="card coupon past" key={c.id}>
                <div style={{ display: 'flex', justifyContent: 'space-between' }}><b>{c.title}</b><span className="tag">{COUPON_STATUS[c.status] ?? c.status}</span></div>
                <span className="small">{c.code}{c.used_at ? ` · ${thShort(c.used_at)}` : ` · หมดอายุ ${thShort(c.expires_at)}`}</span>
              </div>
            ))}
          </>
        )}

        <Link href="/liff/my" className="btn back-btn">กลับไปหน้าสมาชิก &amp; การจอง</Link>
      </div>

      {pick && (
        <div className="modal-bg" role="dialog" aria-modal="true">
          <div className="modal">
            <h2>แลก “{pick.title}”?</h2>
            <p>ใช้ {pick.points_cost.toLocaleString('th-TH')} แต้ม · เหลือ {((d?.points ?? 0) - pick.points_cost).toLocaleString('th-TH')} แต้ม</p>
            <p className="small">คูปองใช้ได้ {pick.valid_days} วัน แลกแล้วเปลี่ยนคืนเป็นแต้มเองไม่ได้</p>
            <div className="modal-actions">
              <button type="button" className="btn" onClick={() => setPick(null)} disabled={busy}>ยกเลิก</button>
              <button type="button" className="btn primary" onClick={redeem} disabled={busy}>{busy ? 'กำลังแลก…' : 'ยืนยันแลก'}</button>
            </div>
          </div>
        </div>
      )}
    </main>
  );
}
