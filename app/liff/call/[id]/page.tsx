'use client';
import { use, useCallback, useEffect, useState } from 'react';
import { authHeaders, useLiff } from '../../useLiff';
import { useT } from '@/components/Lang';
import { BagPicker } from '@/components/BagPicker';

type Info = {
  code: string; name: string; pax: number; large: number; small: number; bagNote?: string | null; flight: string | null; status: string; calledAt: string | null; eta: string | null;
  meetingPoint: string; isReturn: boolean; driver: { name: string; phone: string | null } | null; shopPhone: string;
};
const fmtPhone = (p: string) => p.replace(/^(\d{3})(\d{3})(\d{4})$/, '$1-$2-$3');

export default function CallPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = use(params);
  const liff = useLiff();
  const { t, time, lang } = useT();
  const [info, setInfo] = useState<Info | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [asking, setAsking] = useState(false);
  const [busy, setBusy] = useState(false);
  const [bags, setBags] = useState(0);
  const [moreBags, setMoreBags] = useState(false);

  const load = useCallback(async () => {
    const r = await fetch(`/api/trips/${id}/call`, { headers: authHeaders(liff.idToken) });
    if (r.ok) setInfo(await r.json()); else setError(t('ไม่พบการจองนี้ หรือเปิดลิงก์จากบัญชี LINE อื่น'));
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
    const r = await fetch(`/api/trips/${id}/call`, {
      method: 'POST', headers: { 'Content-Type': 'application/json', ...authHeaders(liff.idToken) },
      body: JSON.stringify({ large: bags }),
    });
    const j = await r.json().catch(() => ({}));
    setBusy(false); setAsking(false);
    if (r.ok) setInfo(j); else setError(j.error ?? t('เรียกรถไม่สำเร็จ กรุณาโทรหาร้าน'));
  }

  const phone = info?.driver?.phone ?? info?.shopPhone;
  const state = !info ? null : info.status === 'done' ? 'done' : info.status === 'arrived' ? 'arrived' : info.status === 'en_route' ? 'coming' : info.calledAt ? 'called' : 'ready';

  return (
    <main>
      <div className="hero">
        <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}><img src="/logo.png" alt="Backyard Airport The Hangar" width={48} height={46} /><span className="chip">{t('รถรับขากลับ')}</span></div>
        <h1>{t('ยินดีต้อนรับสู่สุวรรณภูมิ')}</h1>
        <p>{info ? `${lang === 'th' ? `คุณ${/^[A-Za-z]/.test(info.name) ? ' ' : ''}` : ''}${info.name} · ${t('{n} ท่าน', { n: info.pax })} · ${info.code}` : t('กำลังโหลด…')}</p>
      </div>
      <div className="wrap">
        {error && <div className="alert bad">{error}</div>}
        {info && !info.isReturn && <div className="alert info">{t('ปุ่มนี้ใช้สำหรับรถรับขากลับ')}</div>}

        {state === 'ready' && info && (
          <div className="card call-card">
            <h2>{t('ได้กระเป๋าแล้วหรือยัง?')}</h2>
            <p className="small">{t('กดเรียกรถเมื่อรับกระเป๋าเรียบร้อยและพร้อมออกจากโถงผู้โดยสาร คนขับจะไปถึงจุดนัดภายในประมาณ 15 นาที')}</p>
            <div className="meet"><span>{t('จุดนัดรับ')}</span><b>{t(info.meetingPoint)}</b></div>
            <button className="btn primary big" onClick={() => { setBags(info.large ?? 0); setMoreBags(false); setAsking(true); }}>{t('เรียกรถมารับ')}</button>
            <p className="small" style={{ textAlign: 'center' }}>{t('ยังรอกระเป๋าอยู่? ไม่ต้องรีบ เปิดหน้านี้จากการ์ดในแชทได้ตลอด')}</p>
          </div>
        )}

        {(state === 'called' || state === 'coming' || state === 'arrived') && info && (
          <div className="card call-card">
            <div className={`call-status s-${state}`}>
              <b>{state === 'called' ? t('เรียกรถแล้ว รอคนขับรับทราบ') : state === 'coming' ? t('คนขับกำลังไปจุดนัดรับ') : t('รถถึงจุดนัดรับแล้ว')}</b>
              {state !== 'arrived' && info.eta && <span>{t('ถึงประมาณ {t} น.', { t: time(info.eta) })}</span>}
            </div>
            {info.bagNote === 'changed' && <p className="small call-busy">{t('ระบบเปลี่ยนเป็นรถคันที่ใส่กระเป๋าได้พอแล้ว เวลาถึงด้านบนเป็นของคันใหม่')}</p>}
            {info.bagNote === 'staff' && <p className="small call-busy">{t('กระเป๋าเยอะกว่ารถที่ว่างตอนนี้ ร้านได้รับแจ้งแล้วและกำลังจัดรถให้ จะติดต่อกลับทางแชทหรือโทรศัพท์')}</p>}
            {state === 'called' && info.eta && info.calledAt && Date.parse(info.eta) - Date.parse(info.calledAt) > 20 * 60_000 && (
              <p className="small call-busy">{t('ตอนนี้รถทุกคันกำลังรับส่งลูกค้าอยู่ คันแรกที่ว่างจะมารับคุณทันที ขออภัยที่ต้องรอเพิ่ม')}</p>
            )}
            <div className="meet"><span>{t('จุดนัดรับ')}</span><b>{t(info.meetingPoint)}</b></div>
            {info.driver && <div className="meet"><span>{t('คนขับ')}</span><b>{info.driver.name}</b></div>}
            <p className="small">{t('เรียกรถเมื่อ {t} น. · หน้านี้อัปเดตเองทุก 20 วินาที', { t: info.calledAt ? time(info.calledAt) : '' })}</p>
          </div>
        )}

        {state === 'done' && <div className="card"><h2>{t('ถึงลาน Backyard แล้ว')}</h2><p className="small">{t('ขอบคุณที่ใช้บริการ หวังว่าจะได้ดูแลอีกในทริปหน้า')}</p></div>}

        {phone && <a className="btn" style={{ width: '100%', marginTop: 14 }} href={`tel:${phone}`}>{info?.driver?.phone ? t('โทรหาคนขับ') : t('โทรหาร้าน')} {fmtPhone(phone)}</a>}
      </div>

      {asking && info && (
        <div className="modal-bg" role="dialog" aria-modal="true" aria-labelledby="confirm-title">
          <div className="modal">
            <h2 id="confirm-title">{t('ยืนยันเรียกรถ?')}</h2>
            <p>{t('คนขับคันที่ว่างก่อนจะออกมารับที่ {m} และหน้านี้จะบอกเวลาที่รถจะถึงหลังกดเรียก', { m: t(info.meetingPoint) })}</p>
            <div className="bag-ask">
              <b>{t('กระเป๋าขากลับ')}</b>
              <span className="small">{info.large ? t('ตอนจองแจ้งไว้: ใบใหญ่ {n} ใบ', { n: info.large }) : t('ตอนจองไม่ได้แจ้งกระเป๋าใบใหญ่')}</span>
              <div className="toggle">
                <button type="button" className={!moreBags ? 'on' : ''} onClick={() => { setMoreBags(false); setBags(info.large ?? 0); }}>{t('เท่าเดิม')}</button>
                <button type="button" className={moreBags ? 'on' : ''} onClick={() => setMoreBags(true)}>{t('มีเพิ่ม / เปลี่ยน')}</button>
              </div>
              {moreBags && <BagPicker large={bags} onChange={setBags} />}
              {moreBags && <span className="small">{t('นับเฉพาะใบใหญ่ ไม่ต้องนับกระเป๋าถือขึ้นเครื่อง เป้ หรือใบเล็ก ถ้าใบใหญ่เพิ่มขึ้น ระบบจะส่งรถคันที่ใส่ได้พอ')}</span>}
            </div>
            <p className="small">{t('กดเมื่อได้กระเป๋าครบและพร้อมออกจากโถงแล้วเท่านั้น')}</p>
            <div className="modal-actions">
              <button className="btn" onClick={() => setAsking(false)} disabled={busy}>{t('ยังไม่พร้อม')}</button>
              <button className="btn primary" style={{ marginTop: 0 }} onClick={call} disabled={busy}>{busy ? t('กำลังเรียก…') : t('ยืนยัน เรียกรถ')}</button>
            </div>
          </div>
        </div>
      )}
    </main>
  );
}
