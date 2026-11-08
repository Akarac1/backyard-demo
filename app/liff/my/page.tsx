'use client';
import { useEffect, useState } from 'react';
import Link from 'next/link';
import { authHeaders, useLiff } from '../useLiff';

type Row = { id: string; code: string; plate: string; start_date: string; end_date: string; days: number; total_amount: number; status: string; shuttle: boolean; pax: number | null; rescheduled_at: string | null };

type Points = { points: number; pointValue: number; enabled: boolean; expiring: number; expiringAt: string | null; moves: { at: string; points: number; label: string }[]; perBaht: number; referral: number; months: number };
const thShort = (ts: string) => new Date(ts).toLocaleDateString('th-TH', { timeZone: 'Asia/Bangkok', day: 'numeric', month: 'short', year: '2-digit' });

const STATUS: Record<string, [string, string]> = {
  pending_payment: ['รอชำระเงิน', 'amber'], confirmed: ['ยืนยันแล้ว', 'navy'], checked_in: ['รถอยู่ในลาน', 'navy'],
  checked_out: ['เสร็จสิ้น', ''], cancelled: ['ยกเลิก', ''], expired: ['หมดเวลาชำระ', ''], no_show: ['ไม่มาตามนัด', ''],
};

export default function MyBookings() {
  const liff = useLiff();
  const [rows, setRows] = useState<Row[] | null>(null);
  const [denied, setDenied] = useState(false);
  const [pts, setPts] = useState<Points | null>(null);
  const [showMoves, setShowMoves] = useState(false);
  useEffect(() => {
    if (!liff.ready) return;
    fetch('/api/my', { headers: authHeaders(liff.idToken) })
      .then(async (r) => {
        if (r.status === 401) { setDenied(true); setRows([]); return; }
        setRows(r.ok ? await r.json() : []);
      })
      .catch(() => setRows([]));
    fetch('/api/points', { headers: authHeaders(liff.idToken) })
      .then((r) => (r.ok ? r.json() : null)).then((j) => j && setPts(j)).catch(() => {});
  }, [liff.ready, liff.idToken]);

  return (
    <main>
      <div className="hero"><span className="chip">Backyard Airport</span><h1>การจองของฉัน</h1></div>
      <div className="wrap">
        {pts?.enabled && (
          <div className="card points-card">
            <div className="points-top">
              <div><span>แต้มสะสม</span><b>{pts.points.toLocaleString('th-TH')}<small> แต้ม</small></b></div>
            </div>
            <div className="points-actions"><Link href="/liff/rewards">แลกของรางวัล / คูปองของฉัน</Link></div>
            {pts.expiring > 0 && pts.expiringAt && <p className="small warn-text">{pts.expiring} แต้มจะหมดอายุ {thShort(pts.expiringAt)}</p>}
            <p className="small" style={{ margin: '6px 0 0' }}>ทุก {pts.perBaht} บาทที่ชำระได้ 1 แต้ม{pts.referral > 0 ? ` · แนะนำเพื่อนให้ใส่เบอร์คุณตอนจอง รับ ${pts.referral} แต้ม` : ''} · แต้มมีอายุ {pts.months % 12 === 0 ? `${pts.months / 12} ปี` : `${pts.months} เดือน`}</p>
            {pts.moves.length > 0 && <button type="button" className="link-btn" onClick={() => setShowMoves(!showMoves)}>{showMoves ? 'ซ่อนประวัติแต้ม' : 'ดูประวัติแต้ม'}</button>}
            {showMoves && (
              <ul className="moves">
                {pts.moves.map((m, i) => <li key={i}><span>{thShort(m.at)} · {m.label}</span><b className={m.points < 0 ? 'neg' : 'pos'}>{m.points > 0 ? '+' : ''}{m.points}</b></li>)}
              </ul>
            )}
          </div>
        )}
        {!rows && <p className="small">กำลังโหลด…</p>}
        {denied && <div className="alert bad">ยืนยันตัวตนกับ LINE ไม่สำเร็จ กรุณาปิดหน้านี้แล้วกด “การจองของฉัน” จากเมนูใน LINE อีกครั้ง</div>}
        {!denied && rows?.length === 0 && <div className="card">ยังไม่มีการจอง <Link className="btn primary" href="/liff/book">จองที่จอดรถ</Link></div>}
        {rows?.map((r) => {
          const [label, tone] = STATUS[r.status] ?? [r.status, ''];
          return (
            <div className="card" key={r.id}>
              <div style={{ display: 'flex', justifyContent: 'space-between' }}><b>{r.code}</b><span className={`tag ${tone}`}>{label}</span></div>
              <p style={{ margin: '6px 0' }}>{r.plate} · {r.start_date} ถึง {r.end_date} ({r.days} วัน)</p>
              <p className="small" style={{ margin: 0 }}>{r.shuttle ? `รถรับส่ง ${r.pax} คน · ` : ''}{r.total_amount.toLocaleString('th-TH')} บาท{r.rescheduled_at ? ' · ใช้สิทธิ์เลื่อนแล้ว' : ''}</p>
              {r.status === 'pending_payment' && <Link className="btn primary" href={`/liff/pay/${r.id}`}>ชำระเงิน / ส่งสลิป</Link>}
            </div>
          );
        })}
        <p className="small">ต้องการเลื่อนวัน? ทักแอดมินในแชท (08:00–20:00) ต้องเลื่อนล่วงหน้าอย่างน้อย 7 วัน</p>
      </div>
    </main>
  );
}
