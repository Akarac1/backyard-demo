'use client';
import { use, useCallback, useEffect, useState } from 'react';
import { authHeaders, useLiff } from '../../useLiff';

type Info = {
  code: string; name: string; pax: number; flight: string | null; status: string; calledAt: string | null; eta: string | null;
  meetingPoint: string; isReturn: boolean; driver: { name: string; phone: string | null } | null; shopPhone: string;
};
const time = (ts: string) => new Date(ts).toLocaleTimeString('th-TH', { timeZone: 'Asia/Bangkok', hour: '2-digit', minute: '2-digit' });
const fmtPhone = (p: string) => p.replace(/^(\d{3})(\d{3})(\d{4})$/, '$1-$2-$3');

export default function CallPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = use(params);
  const liff = useLiff();
  const [info, setInfo] = useState<Info | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [asking, setAsking] = useState(false);
  const [busy, setBusy] = useState(false);

  const load = useCallback(async () => {
    const r = await fetch(`/api/trips/${id}/call`, { headers: authHeaders(liff.idToken) });
    if (r.ok) setInfo(await r.json()); else setError('ไม่พบการจองนี้ หรือเปิดลิงก์จากบัญชี LINE อื่น');
  }, [id, liff.idToken]);
  useEffect(() => { if (liff.ready) load(); }, [liff.ready, load]);
  // keep the status fresh while the customer waits
  useEffect(() => {
    if (!info?.calledAt || info.status === 'done') return;
    const t = setInterval(load, 20_000);
    return () => clearInterval(t);
  }, [info?.calledAt, info?.status, load]);

  async function call() {
    setBusy(true); setError(null);
    const r = await fetch(`/api/trips/${id}/call`, { method: 'POST', headers: authHeaders(liff.idToken) });
    const j = await r.json().catch(() => ({}));
    setBusy(false); setAsking(false);
    if (r.ok) setInfo(j); else setError(j.error ?? 'เรียกรถไม่สำเร็จ กรุณาโทรหาร้าน');
  }

  const phone = info?.driver?.phone ?? info?.shopPhone;
  const state = !info ? null : info.status === 'done' ? 'done' : info.status === 'arrived' ? 'arrived' : info.status === 'en_route' ? 'coming' : info.calledAt ? 'called' : 'ready';

  return (
    <main>
      <div className="hero">
        <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}><img src="/logo.png" alt="Backyard Airport The Hangar" width={48} height={46} /><span className="chip">รถรับขากลับ</span></div>
        <h1>ยินดีต้อนรับสู่สุวรรณภูมิ</h1>
        <p>{info ? `คุณ${/^[A-Za-z]/.test(info.name) ? ' ' : ''}${info.name} · ${info.pax} ท่าน · ${info.code}` : 'กำลังโหลด…'}</p>
      </div>
      <div className="wrap">
        {error && <div className="alert bad">{error}</div>}
        {info && !info.isReturn && <div className="alert info">ปุ่มนี้ใช้สำหรับรถรับขากลับ</div>}

        {state === 'ready' && info && (
          <div className="card call-card">
            <h2>ได้กระเป๋าแล้วหรือยัง?</h2>
            <p className="small">กดเรียกรถเมื่อรับกระเป๋าเรียบร้อยและพร้อมออกจากโถงผู้โดยสาร คนขับจะไปถึงจุดนัดภายในประมาณ <b>15 นาที</b></p>
            <div className="meet"><span>จุดนัดรับ</span><b>{info.meetingPoint}</b></div>
            <button className="btn primary big" onClick={() => setAsking(true)}>เรียกรถมารับ</button>
            <p className="small" style={{ textAlign: 'center' }}>ยังรอกระเป๋าอยู่? ไม่ต้องรีบ เปิดหน้านี้จากการ์ดในแชทได้ตลอด</p>
          </div>
        )}

        {(state === 'called' || state === 'coming' || state === 'arrived') && info && (
          <div className="card call-card">
            <div className={`call-status s-${state}`}>
              <b>{state === 'called' ? 'เรียกรถแล้ว รอคนขับรับทราบ' : state === 'coming' ? 'คนขับกำลังไปจุดนัดรับ' : 'รถถึงจุดนัดรับแล้ว'}</b>
              {state !== 'arrived' && info.eta && <span>ถึงประมาณ {time(info.eta)} น.</span>}
            </div>
            <div className="meet"><span>จุดนัดรับ</span><b>{info.meetingPoint}</b></div>
            {info.driver && <div className="meet"><span>คนขับ</span><b>{info.driver.name}</b></div>}
            <p className="small">เรียกรถเมื่อ {info.calledAt && time(info.calledAt)} น. · หน้านี้อัปเดตเองทุก 20 วินาที</p>
          </div>
        )}

        {state === 'done' && <div className="card"><h2>ถึงลาน Backyard แล้ว</h2><p className="small">ขอบคุณที่ใช้บริการ หวังว่าจะได้ดูแลอีกในทริปหน้า</p></div>}

        {phone && <a className="btn" style={{ width: '100%', marginTop: 14 }} href={`tel:${phone}`}>โทรหา{info?.driver?.phone ? 'คนขับ' : 'ร้าน'} {fmtPhone(phone)}</a>}
      </div>

      {asking && info && (
        <div className="modal-bg" role="dialog" aria-modal="true" aria-labelledby="confirm-title">
          <div className="modal">
            <h2 id="confirm-title">ยืนยันเรียกรถ?</h2>
            <p>คนขับจะออกเดินทางมารับที่ <b>{info.meetingPoint}</b> ทันที และถึงภายในประมาณ 15 นาที</p>
            <p className="small">กดเมื่อได้กระเป๋าครบและพร้อมออกจากโถงแล้วเท่านั้น</p>
            <div className="modal-actions">
              <button className="btn" onClick={() => setAsking(false)} disabled={busy}>ยังไม่พร้อม</button>
              <button className="btn primary" style={{ marginTop: 0 }} onClick={call} disabled={busy}>{busy ? 'กำลังเรียก…' : 'ยืนยัน เรียกรถ'}</button>
            </div>
          </div>
        </div>
      )}
    </main>
  );
}
