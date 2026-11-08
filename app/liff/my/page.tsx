'use client';
import { useEffect, useState } from 'react';
import Link from 'next/link';
import { authHeaders, useLiff } from '../useLiff';
import { MemberCard } from '@/components/MemberCard';
import QRCode from 'qrcode';

/** Member card that flips over to show its QR (member number + tier, signed, refreshed every minute). */
function FlipCard({ mem, idToken }: { mem: Member; idToken: string | null }) {
  const [flipped, setFlipped] = useState(false);
  const [qr, setQr] = useState<{ src: string; exp: number } | null>(null);
  const [err, setErr] = useState(false);
  const [now, setNow] = useState(Date.now());
  useEffect(() => {
    if (!flipped) return;
    let alive = true;
    const load = async () => {
      try {
        const r = await fetch('/api/member/qr', { headers: authHeaders(idToken) });
        if (!r.ok) { setErr(true); return; }
        const j = await r.json();
        const src = await QRCode.toDataURL(j.url, { margin: 1, width: 480, errorCorrectionLevel: 'M', color: { dark: '#0E3320', light: '#FFFFFF' } });
        if (alive) { setQr({ src, exp: j.exp }); setErr(false); }
      } catch { setErr(true); }
    };
    load();
    const refresh = setInterval(load, 60_000);
    const tick = setInterval(() => setNow(Date.now()), 1000);
    return () => { alive = false; clearInterval(refresh); clearInterval(tick); };
  }, [flipped, idToken]);
  const left = qr ? Math.min(600_000, Math.max(0, qr.exp * 1000 - now)) : 0;
  const canFlip = !!mem.memberNo;
  return (
    <div className="flip-wrap">
      <button type="button" className={`flip ${flipped ? 'is-flipped' : ''}`} onClick={() => canFlip && setFlipped(!flipped)}
        aria-label={flipped ? 'ซ่อน QR บัตรสมาชิก' : 'แสดง QR บัตรสมาชิก'} aria-pressed={flipped}>
        <div className="flip-inner">
          <div className="flip-face flip-front">
            <MemberCard tier={mem.tier} tierName={mem.tierName} name={mem.name} memberNo={mem.memberNo} points={mem.points} multiplier={mem.multiplier} />
          </div>
          <div className="flip-face flip-back">
            <div className={`mcard mcard-${mem.tier} mcard-back`}>
              <div className="mcard-shine" />
              <div className="qr-box">
                {qr ? <img src={qr.src} alt={`QR สมาชิก ${mem.memberNo}`} /> : <span>{err ? 'สร้าง QR ไม่สำเร็จ' : 'กำลังสร้าง QR…'}</span>}
              </div>
              <div className="back-info">
                <span className="back-brand">BACKYARD MEMBER</span>
                <b className="back-tier">{mem.tierName.toUpperCase()}</b>
                <span className="back-no">{mem.memberNo}</span>
                <span className="back-name">{mem.name}</span>
                <span className="back-timer">{qr ? `QR ใช้ได้อีก ${Math.floor(left / 60000)}:${String(Math.floor((left % 60000) / 1000)).padStart(2, '0')}` : ''}</span>
              </div>
            </div>
          </div>
        </div>
      </button>
      {canFlip && <span className="mcard-tap">{flipped ? 'ให้พนักงานคาเฟ่ ที่พัก หรือที่ลานสแกน · แตะอีกครั้งเพื่อพลิกกลับ' : 'แตะบัตรเพื่อพลิกดู QR'}</span>}
    </div>
  );
}

/** QR for staff at the lot: opens the booking on the on-site screen (staff must be signed in). */
function BookingQr({ code }: { code: string }) {
  const [src, setSrc] = useState<string | null>(null);
  useEffect(() => {
    QRCode.toDataURL(`${window.location.origin}/ops/b/${code}`, { margin: 1, width: 240, color: { dark: '#0E3320' } }).then(setSrc).catch(() => {});
  }, [code]);
  if (!src) return null;
  return <div className="booking-qr"><img src={src} alt={`QR การจอง ${code}`} /><p>แสดง QR นี้ให้พนักงานที่ลานจอด<br />เมื่อนำรถเข้าและมารับรถ</p></div>;
}

type Row = { id: string; code: string; plate: string; start_date: string; end_date: string; days: number; total_amount: number; status: string; shuttle: boolean; pax: number | null; rescheduled_at: string | null };

type Points = { points: number; pointValue: number; enabled: boolean; expiring: number; expiringAt: string | null; moves: { at: string; points: number; label: string }[]; perBaht: number; referral: number; months: number };
type Member = { memberNo: string | null; name: string | null; tier: string; tierName: string; multiplier: number; spend: number; windowMonths: number; nextTierName: string | null; nextMin: number | null; points: number; manual: boolean; campaigns: { name: string; description: string | null; business: string; effect: string | null; endsAt: string | null; stay: string | null }[] };
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
  const [mem, setMem] = useState<Member | null>(null);
  const [shop, setShop] = useState<{ shop_phone?: string; admin_hours?: string; reschedule_min_days?: number } | null>(null);
  useEffect(() => { fetch('/api/prices').then((r) => (r.ok ? r.json() : null)).then((j) => j && setShop(j)).catch(() => {}); }, []);
  useEffect(() => {
    if (!liff.ready) return;
    fetch('/api/my', { headers: authHeaders(liff.idToken) })
      .then(async (r) => {
        if (r.status === 401) { setDenied(true); setRows([]); return; }
        setRows(r.ok ? await r.json() : []);
      })
      .catch(() => setRows([]));
    fetch('/api/member', { headers: authHeaders(liff.idToken) })
      .then((r) => (r.ok ? r.json() : null)).then((j) => j && setMem(j)).catch(() => {});
    fetch('/api/points', { headers: authHeaders(liff.idToken) })
      .then((r) => (r.ok ? r.json() : null)).then((j) => j && setPts(j)).catch(() => {});
  }, [liff.ready, liff.idToken]);

  return (
    <main>
      <div className="hero"><span className="chip">Backyard Member</span><h1>สมาชิก &amp; การจอง</h1></div>
      <div className="wrap">
        {mem && (
          <div className="member-box">
            <FlipCard mem={mem} idToken={liff.idToken} />
            <div className="member-progress">
              {mem.nextTierName && mem.nextMin != null && !mem.manual ? (
                <>
                  <p>ยอดใช้บริการ {mem.windowMonths} เดือนล่าสุด <b>{mem.spend.toLocaleString('th-TH')}</b> บาท</p>
                  <div className="bar"><i style={{ width: `${Math.min(100, Math.round((mem.spend / mem.nextMin) * 100))}%` }} /></div>
                  <p className="small" style={{ margin: 0 }}>ใช้บริการอีก {(mem.nextMin - mem.spend).toLocaleString('th-TH')} บาท เพื่อเป็น {mem.nextTierName}</p>
                </>
              ) : <p>ระดับ <b>{mem.tierName}</b>{mem.manual ? ' (มอบโดยร้าน)' : ' · ระดับสูงสุด'} · ได้แต้ม x{mem.multiplier}</p>}
            </div>
            {mem.campaigns.map((c) => (
              <div className="camp" key={c.name}>
                <b>{c.name}</b>{c.effect ? ` · ${c.effect}` : ''}
                <small>{c.description ? `${c.description} · ` : ''}{c.business}{c.stay ? ` · ${c.stay}` : ''}{c.endsAt ? ` · จองได้ถึง ${thShort(c.endsAt)}` : ''}</small>
              </div>
            ))}
          </div>
        )}
        {pts?.enabled && (
          <div className="card points-card">
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
        {denied && <div className="alert bad">ยืนยันตัวตนกับ LINE ไม่สำเร็จ กรุณาปิดหน้านี้แล้วกด “สมาชิก & การจอง” จากเมนูใน LINE อีกครั้ง</div>}
        {!denied && rows?.length === 0 && <div className="card">ยังไม่มีการจอง <Link className="btn primary" href="/liff/book">จองที่จอดรถ</Link></div>}
        {rows?.map((r) => {
          const [label, tone] = STATUS[r.status] ?? [r.status, ''];
          return (
            <div className="card" key={r.id}>
              <div style={{ display: 'flex', justifyContent: 'space-between' }}><b>{r.code}</b><span className={`tag ${tone}`}>{label}</span></div>
              <p style={{ margin: '6px 0' }}>{r.plate} · {r.start_date} ถึง {r.end_date} ({r.days} วัน)</p>
              <p className="small" style={{ margin: 0 }}>{r.shuttle ? `รถรับส่ง ${r.pax} คน · ` : ''}{r.total_amount.toLocaleString('th-TH')} บาท{r.rescheduled_at ? ' · ใช้สิทธิ์เลื่อนแล้ว' : ''}</p>
              {['confirmed', 'checked_in'].includes(r.status) && !r.shuttle && <BookingQr code={r.code} />}
              {r.status === 'pending_payment' && <Link className="btn primary" href={`/liff/pay/${r.id}`}>ชำระเงิน / ส่งสลิป</Link>}
            </div>
          );
        })}
        <p className="small">ต้องการเลื่อนวัน? ทักแอดมินในแชท ({shop?.admin_hours ?? '08:00–20:00'}) ต้องเลื่อนล่วงหน้าอย่างน้อย {shop?.reschedule_min_days ?? 7} วัน{shop?.shop_phone ? <> · <a href={`tel:${shop.shop_phone}`}>โทร {shop.shop_phone.replace(/^(\d{3})(\d{3})(\d{4})$/, '$1-$2-$3')}</a></> : null}</p>
      </div>
    </main>
  );
}
