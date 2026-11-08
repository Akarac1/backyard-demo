'use client';
import { use, useEffect, useState } from 'react';
import { authHeaders, useLiff } from '../../useLiff';
import { useT } from '@/components/Lang';

type Info = { code: string; direction: 'to_airport' | 'from_airport'; done: boolean; driver: string | null; plate: string | null; rating: { stars: number; comment: string } | null; canEdit: boolean };
const WORDS = ['', 'ต้องปรับปรุง', 'พอใช้', 'ดี', 'ดีมาก', 'ยอดเยี่ยม'];

/** Rate the shuttle trip: opened from the stars on the LINE card (?s=1..5 preselects). */
export default function RatePage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = use(params);
  const liff = useLiff();
  const { t } = useT();
  const [info, setInfo] = useState<Info | null>(null);
  const [stars, setStars] = useState(0);
  const [comment, setComment] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [saved, setSaved] = useState(false);

  useEffect(() => {
    const s = Number(new URLSearchParams(window.location.search).get('s'));
    if (s >= 1 && s <= 5) setStars(s);
  }, []);
  useEffect(() => {
    if (!liff.ready) return;
    fetch(`/api/trips/${id}/rate`, { headers: authHeaders(liff.idToken) })
      .then(async (r) => {
        if (!r.ok) { setError(t('ไม่พบการจองนี้ หรือเปิดลิงก์จากบัญชี LINE อื่น')); return; }
        const j = (await r.json()) as Info;
        setInfo(j);
        if (j.rating) {
          setComment(j.rating.comment);
          // a star tapped on the card wins over the earlier rating
          setStars((cur) => cur || j.rating!.stars);
        }
      })
      .catch(() => setError(t('เกิดข้อผิดพลาด ลองใหม่อีกครั้ง')));
  }, [liff.ready, liff.idToken, id]);

  async function send() {
    if (!stars) { setError(t('กรุณาเลือกดาว 1–5 ดวง')); return; }
    setBusy(true); setError(null);
    const r = await fetch(`/api/trips/${id}/rate`, {
      method: 'POST', headers: { 'Content-Type': 'application/json', ...authHeaders(liff.idToken) },
      body: JSON.stringify({ stars, comment }),
    });
    const j = await r.json().catch(() => ({}));
    setBusy(false);
    if (r.ok) setSaved(true); else setError(j.error ?? t('เกิดข้อผิดพลาด ลองใหม่อีกครั้ง'));
  }

  const leg = info?.direction === 'from_airport' ? t('รถรับขากลับ') : t('รถส่งไปสนามบิน');
  return (
    <main>
      <div className="hero">
        <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}><img src="/logo.png" alt="Backyard Airport The Hangar" width={48} height={46} /><span className="chip">{t('ให้คะแนนการเดินทาง')}</span></div>
        <h1>{t('การเดินทางเป็นอย่างไรบ้าง?')}</h1>
        <p>{info ? [leg, info.driver && t('คนขับ {x}', { x: info.driver }), info.code].filter(Boolean).join(' · ') : t('กำลังโหลด…')}</p>
      </div>
      <div className="wrap">
        {error && <div className="alert bad">{error}</div>}
        {saved ? (
          <div className="card rate-done">
            <div className="rate-big" aria-hidden>{'★'.repeat(stars)}</div>
            <h2>{t('ขอบคุณสำหรับคะแนน')}</h2>
            <p className="small">{t('ความเห็นของคุณช่วยให้เราดูแลได้ดีขึ้นในทริปหน้า')}</p>
            <button className="btn primary" onClick={() => import('@line/liff').then(({ default: l }) => (l.isInClient() ? l.closeWindow() : history.back())).catch(() => history.back())}>{t('กลับไปที่แชท')}</button>
          </div>
        ) : info && !info.done ? (
          <div className="alert info">{t('ให้คะแนนได้เมื่อการเดินทางเสร็จแล้ว')}</div>
        ) : info && !info.canEdit ? (
          <div className="card"><div className="rate-big" aria-hidden>{'★'.repeat(info.rating?.stars ?? 0)}</div><p className="small">{t('เลยเวลาแก้ไขคะแนนแล้ว (แก้ได้ภายใน 7 วัน)')}</p></div>
        ) : info && (
          <div className="card">
            <div className="stars" role="radiogroup" aria-label={t('คะแนน')}>
              {[1, 2, 3, 4, 5].map((n) => (
                <button key={n} type="button" role="radio" aria-checked={stars === n} aria-label={t('{n} ดาว', { n })}
                  className={n <= stars ? 'lit' : ''} onClick={() => setStars(n)}>★</button>
              ))}
            </div>
            <p className="rate-word">{stars ? t(WORDS[stars]) : t('แตะดาวเพื่อให้คะแนน')}</p>
            <label htmlFor="cm" className="small">{t('ติชมเพิ่มเติม (ไม่บังคับ)')}</label>
            <textarea id="cm" className="rate-text" rows={4} maxLength={1000} value={comment} onChange={(e) => setComment(e.target.value)}
              placeholder={t('เช่น คนขับสุภาพ รถสะอาด หรือสิ่งที่อยากให้ปรับปรุง')} />
            <button className="btn primary" disabled={busy || !stars} onClick={send}>{busy ? t('กำลังส่ง…') : info.rating ? t('บันทึกคะแนนใหม่') : t('ส่งคะแนน')}</button>
            {info.rating && <p className="small" style={{ textAlign: 'center', marginTop: 8 }}>{t('คุณให้คะแนนไว้แล้ว แก้ไขได้ภายใน 7 วัน')}</p>}
          </div>
        )}
      </div>
    </main>
  );
}
