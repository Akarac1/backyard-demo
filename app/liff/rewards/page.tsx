'use client';
import { useCallback, useEffect, useState } from 'react';
import Link from 'next/link';
import { authHeaders, useLiff } from '../useLiff';
import { useT } from '@/components/Lang';

type Reward = { id: string; title: string; description: string | null; business: string; kind: string; value_baht: number; points_cost: number; valid_days: number; stock: number | null };
type Coupon = { id: string; code: string; title: string; business: string; kind: string; status: string; expires_at: string; used_at: string | null };
type Data = { points: number; enabled: boolean; rewards: Reward[]; coupons: Coupon[] };

const BUSINESS: Record<string, string> = { parking: 'ที่จอดรถ', cafe: 'คาเฟ่', stay: 'ที่พัก' };
const COUPON_STATUS: Record<string, string> = { active: 'ใช้ได้', used: 'ใช้แล้ว', expired: 'หมดอายุ', cancelled: 'ยกเลิก' };

export default function Rewards() {
  const liff = useLiff();
  const { t, short: thShort, num } = useT();
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
    if (!r.ok) { setMsg({ error: j.error ?? t('แลกไม่สำเร็จ') }); return; }
    setMsg({ ok: t('แลก “{x}” แล้ว · รหัสคูปอง {c}', { x: j.title, c: j.code }) });
    setTab('coupons');
    load();
  }

  const groups = Object.entries((d?.rewards ?? []).reduce<Record<string, Reward[]>>((a, r) => { (a[r.business] ??= []).push(r); return a; }, {}));
  const active = (d?.coupons ?? []).filter((c) => c.status === 'active');
  const past = (d?.coupons ?? []).filter((c) => c.status !== 'active');

  return (
    <main>
      <div className="hero">
        <span className="chip">Backyard Member</span>
        <h1>{t('แลกของรางวัล')}</h1>
        <p>{t('แต้มของคุณ')} <b style={{ color: '#E0B04A', fontSize: 22 }}>{num(d?.points ?? 0)}</b> {t('แต้ม')}</p>
      </div>
      <div className="wrap">
        {denied && <div className="alert bad">{t('ยืนยันตัวตนกับ LINE ไม่สำเร็จ กรุณาเปิดหน้านี้จากเมนูใน LINE อีกครั้ง')}</div>}
        {!d && !denied && <p className="small">{t('กำลังโหลด…')}</p>}
        {msg?.ok && <div className="alert ok">{msg.ok}</div>}
        {msg?.error && <div className="alert bad">{msg.error}</div>}
        {d && !d.enabled && <div className="alert info">{t('ระบบแลกของรางวัลปิดชั่วคราว')}</div>}

        {d && (
          <div className="toggle" style={{ marginBottom: 12 }}>
            <button type="button" className={tab === 'rewards' ? 'on' : ''} onClick={() => setTab('rewards')}>{t('ของรางวัล')}</button>
            <button type="button" className={tab === 'coupons' ? 'on' : ''} onClick={() => setTab('coupons')}>{t('คูปองของฉัน')}{active.length ? ` (${active.length})` : ''}</button>
          </div>
        )}

        {d && tab === 'rewards' && (
          <>
            {!groups.length && <div className="card">{t('ยังไม่มีของรางวัล')}</div>}
            {groups.map(([biz, list]) => (
              <div key={biz}>
                <h2 className="reward-group">{t(BUSINESS[biz] ?? biz)}</h2>
                {list.map((r) => {
                  const enough = d.points >= r.points_cost;
                  return (
                    <div className="card reward" key={r.id}>
                      <div className="reward-main">
                        <b>{r.title}</b>
                        {r.description && <span className="small">{r.description}</span>}
                        <span className="small">{t('ใช้ได้ {n} วันหลังแลก', { n: r.valid_days })}{r.stock != null ? t(' · เหลือ {n}', { n: r.stock }) : ''}</span>
                      </div>
                      <div className="reward-side">
                        <span className="cost">{num(r.points_cost)}<small> {t('แต้ม')}</small></span>
                        <button type="button" className="btn primary btn-sm" disabled={!enough || !d.enabled} onClick={() => setPick(r)}>{enough ? t('แลก') : t('ขาด {n}', { n: r.points_cost - d.points })}</button>
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
            {!active.length && <div className="card">{t('ยังไม่มีคูปองที่ใช้ได้')} <button type="button" className="link-btn" onClick={() => setTab('rewards')}>{t('ไปแลกของรางวัล')}</button></div>}
            {active.map((c) => (
              <div className="card coupon" key={c.id}>
                <div className="coupon-code">{c.code}</div>
                <b>{c.title}</b>
                <span className="small">{t('ใช้ได้ถึง {d}', { d: thShort(c.expires_at) })}</span>
                <span className="small">{c.kind === 'parking_discount' ? t('เลือกใช้ได้ในหน้ายืนยันการจองที่จอดรถ') : t('แสดงรหัสนี้ให้พนักงานเมื่อใช้สิทธิ์')}</span>
              </div>
            ))}
            {past.length > 0 && <h2 className="reward-group">{t('ประวัติคูปอง')}</h2>}
            {past.map((c) => (
              <div className="card coupon past" key={c.id}>
                <div style={{ display: 'flex', justifyContent: 'space-between' }}><b>{c.title}</b><span className="tag">{t(COUPON_STATUS[c.status] ?? c.status)}</span></div>
                <span className="small">{c.code}{c.used_at ? ` · ${thShort(c.used_at)}` : t(' · หมดอายุ {d}', { d: thShort(c.expires_at) })}</span>
              </div>
            ))}
          </>
        )}

        <Link href="/liff/my" className="btn back-btn">{t('กลับไปหน้าสมาชิก & การจอง')}</Link>
      </div>

      {pick && (
        <div className="modal-bg" role="dialog" aria-modal="true">
          <div className="modal">
            <h2>{t('แลก “{x}”?', { x: pick.title })}</h2>
            <p>{t('ใช้ {a} แต้ม · เหลือ {b} แต้ม', { a: num(pick.points_cost), b: num((d?.points ?? 0) - pick.points_cost) })}</p>
            <p className="small">{t('คูปองใช้ได้ {n} วัน แลกแล้วเปลี่ยนคืนเป็นแต้มเองไม่ได้', { n: pick.valid_days })}</p>
            <div className="modal-actions">
              <button type="button" className="btn" onClick={() => setPick(null)} disabled={busy}>{t('ยกเลิก')}</button>
              <button type="button" className="btn primary" onClick={redeem} disabled={busy}>{busy ? t('กำลังแลก…') : t('ยืนยันแลก')}</button>
            </div>
          </div>
        </div>
      )}
    </main>
  );
}
