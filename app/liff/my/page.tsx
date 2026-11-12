'use client';
import { useEffect, useState } from 'react';
import Link from 'next/link';
import { authHeaders, useLiff } from '../useLiff';
import { MemberCard } from '@/components/MemberCard';
import { useT } from '@/components/Lang';
import { BagPicker } from '@/components/BagPicker';
import QRCode from 'qrcode';

/** Member card that flips over to show its QR (member number + tier, signed, refreshed every minute). */
function FlipCard({ mem, idToken }: { mem: Member; idToken: string | null }) {
  const { t } = useT();
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
      {/* a div, not a <button>: Safari / LINE on iPhone flattens 3D inside buttons and shows the front through the back */}
      <div role="button" tabIndex={0} className={`flip ${flipped ? 'is-flipped' : ''}`} onClick={() => canFlip && setFlipped(!flipped)}
        onKeyDown={(e) => { if (canFlip && (e.key === 'Enter' || e.key === ' ')) { e.preventDefault(); setFlipped(!flipped); } }}
        aria-label={flipped ? t('ซ่อน QR บัตรสมาชิก') : t('แสดง QR บัตรสมาชิก')} aria-pressed={flipped}>
        <div className="flip-inner">
          <div className="flip-face flip-front" aria-hidden={flipped}>
            <MemberCard tier={mem.tier} tierName={mem.tierName} name={mem.name} memberNo={mem.memberNo} points={mem.points} multiplier={mem.multiplier} pointsWord={t('แต้ม')} label={t('บัตรสมาชิก Backyard ระดับ {x}', { x: mem.tierName })} />
          </div>
          <div className="flip-face flip-back" aria-hidden={!flipped}>
            <div className={`mcard mcard-${mem.tier} mcard-back`}>
              <div className="mcard-shine" />
              <div className="qr-box">
                {qr ? <img src={qr.src} alt={`QR ${mem.memberNo}`} /> : <span>{err ? t('สร้าง QR ไม่สำเร็จ') : t('กำลังสร้าง QR…')}</span>}
              </div>
              <div className="back-info">
                <span className="back-brand">BACKYARD MEMBER</span>
                <b className="back-tier">{mem.tierName.toUpperCase()}</b>
                <span className="back-no">{mem.memberNo}</span>
                <span className="back-name">{mem.name}</span>
                <span className="back-timer">{qr ? t('QR ใช้ได้อีก {t}', { t: `${Math.floor(left / 60000)}:${String(Math.floor((left % 60000) / 1000)).padStart(2, '0')}` }) : ''}</span>
              </div>
            </div>
          </div>
        </div>
      </div>
      {canFlip && <span className="mcard-tap">{flipped ? t('ให้พนักงานคาเฟ่ ที่พัก หรือที่ลานสแกน · แตะอีกครั้งเพื่อพลิกกลับ') : t('แตะบัตรเพื่อพลิกดู QR')}</span>}
    </div>
  );
}

/** QR for staff at the lot: opens the booking on the on-site screen (staff must be signed in). */
function BookingQr({ code }: { code: string }) {
  const { t } = useT();
  const [src, setSrc] = useState<string | null>(null);
  useEffect(() => {
    QRCode.toDataURL(`${window.location.origin}/ops/b/${code}`, { margin: 1, width: 240, color: { dark: '#0E3320' } }).then(setSrc).catch(() => {});
  }, [code]);
  if (!src) return null;
  return <div className="booking-qr"><img src={src} alt={`QR ${code}`} /><p>{t('แสดง QR นี้ให้พนักงานที่ลานจอดเมื่อนำรถเข้าและมารับรถ')}</p></div>;
}

type Trip = { id: string; direction: string; status: string; large_bags: number; small_bags: number; called_at: string | null };
type Row = { id: string; code: string; plate: string; start_date: string; end_date: string; days: number; total_amount: number; status: string; shuttle: boolean; pax: number | null; rescheduled_at: string | null; group_id?: string | null; shuttle_trips?: Trip[] };

type Points = { points: number; pointValue: number; enabled: boolean; expiring: number; expiringAt: string | null; moves: { at: string; points: number; label: string }[]; perBaht: number; referral: number; months: number };
type Member = { memberNo: string | null; name: string | null; tier: string; tierName: string; multiplier: number; spend: number; windowMonths: number; nextTierName: string | null; nextMin: number | null; points: number; manual: boolean; campaigns: { name: string; description: string | null; business: string; effect: string | null; endsAt: string | null; stay: string | null }[] };

/** bookings still in progress; everything else is history */
const ACTIVE = ['pending_payment', 'confirmed', 'checked_in'];

const STATUS: Record<string, [string, string]> = {
  pending_payment: ['รอชำระเงิน', 'amber'], confirmed: ['ยืนยันแล้ว', 'navy'], checked_in: ['รถอยู่ในลาน', 'navy'],
  checked_out: ['เสร็จสิ้น', ''], cancelled: ['ยกเลิก', ''], expired: ['หมดเวลาชำระ', ''], no_show: ['ไม่มาตามนัด', ''],
};

export default function MyBookings() {
  const liff = useLiff();
  const { t, short: thShort, day, money } = useT();
  const [rows, setRows] = useState<Row[] | null>(null);
  const [denied, setDenied] = useState(false);
  const [pts, setPts] = useState<Points | null>(null);
  const [showMoves, setShowMoves] = useState(false);
  const [showPast, setShowPast] = useState(false);
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
      <div className="hero"><span className="chip">Backyard Member</span><h1>{t('สมาชิก & การจอง')}</h1></div>
      <div className="wrap">
        {mem && (
          <div className="member-box">
            <FlipCard mem={mem} idToken={liff.idToken} />
            <div className="member-progress">
              {mem.nextTierName && mem.nextMin != null && !mem.manual ? (
                <>
                  <p>{t('ยอดใช้บริการ {n} เดือนล่าสุด', { n: mem.windowMonths })} <b>{money(mem.spend)}</b></p>
                  <div className="bar"><i style={{ width: `${Math.min(100, Math.round((mem.spend / mem.nextMin) * 100))}%` }} /></div>
                  <p className="small" style={{ margin: 0 }}>{t('ใช้บริการอีก {a} เพื่อเป็น {b}', { a: money(mem.nextMin - mem.spend), b: mem.nextTierName })}</p>
                </>
              ) : <p>{t('ระดับ')} <b>{mem.tierName}</b>{mem.manual ? t(' (มอบโดยร้าน)') : t(' · ระดับสูงสุด')} · {t('ได้แต้ม x{n}', { n: mem.multiplier })}</p>}
            </div>
            {mem.campaigns.map((c) => (
              <div className="camp" key={c.name}>
                <b>{c.name}</b>{c.effect ? ` · ${c.effect}` : ''}
                <small>{c.description ? `${c.description} · ` : ''}{c.business}{c.stay ? ` · ${c.stay}` : ''}{c.endsAt ? t(' · จองได้ถึง {d}', { d: thShort(c.endsAt) }) : ''}</small>
              </div>
            ))}
          </div>
        )}
        {pts?.enabled && (
          <div className="card points-card">
            <div className="points-actions"><Link href="/liff/rewards">{t('แลกของรางวัล / คูปองของฉัน')}</Link></div>
            {pts.expiring > 0 && pts.expiringAt && <p className="small warn-text">{t('{n} แต้มจะหมดอายุ {d}', { n: pts.expiring, d: thShort(pts.expiringAt) })}</p>}
            <p className="small" style={{ margin: '6px 0 0' }}>{t('ทุก {n} บาทที่ชำระได้ 1 แต้ม', { n: pts.perBaht })}{pts.referral > 0 ? t(' · แนะนำเพื่อนให้ใส่เบอร์คุณตอนจอง รับ {n} แต้ม', { n: pts.referral }) : ''} · {pts.months % 12 === 0 ? t('แต้มมีอายุ {n} ปี', { n: pts.months / 12 }) : t('แต้มมีอายุ {n} เดือน', { n: pts.months })}</p>
            {pts.moves.length > 0 && <button type="button" className="link-btn" onClick={() => setShowMoves(!showMoves)}>{showMoves ? t('ซ่อนประวัติแต้ม') : t('ดูประวัติแต้ม')}</button>}
            {showMoves && (
              <ul className="moves">
                {pts.moves.map((m, i) => <li key={i}><span>{thShort(m.at)} · {m.label}</span><b className={m.points < 0 ? 'neg' : 'pos'}>{m.points > 0 ? '+' : ''}{m.points}</b></li>)}
              </ul>
            )}
          </div>
        )}
        {!rows && <p className="small">{t('กำลังโหลด…')}</p>}
        {denied && <div className="alert bad">{t('ยืนยันตัวตนกับ LINE ไม่สำเร็จ กรุณาปิดหน้านี้แล้วกด “สมาชิก & การจอง” จากเมนูใน LINE อีกครั้ง')}</div>}
        {!denied && rows?.length === 0 && <div className="card">{t('ยังไม่มีการจอง')} <Link className="btn primary" href="/liff/book">{t('จองที่จอดรถ')}</Link></div>}
        {(() => {
          // open bookings first; finished ones (picked up, cancelled, expired, no-show) behind a button
          const open = (rows ?? []).filter((r) => ACTIVE.includes(r.status));
          const past = (rows ?? []).filter((r) => !ACTIVE.includes(r.status));
          const card = (r: Row) => {
            const [label, tone] = STATUS[r.status] ?? [r.status, ''];
            return (
              <div className={`card${ACTIVE.includes(r.status) ? '' : ' past'}`} key={r.id}>
                <div style={{ display: 'flex', justifyContent: 'space-between' }}><b>{r.code}{r.group_id ? <span className="small"> · {t('จองหลายคัน')}</span> : null}</b><span className={`tag ${tone}`}>{t(label)}</span></div>
                <p style={{ margin: '6px 0' }}>{r.plate} · {day(r.start_date)} – {day(r.end_date)} ({t('{n} วัน', { n: r.days })})</p>
                <p className="small" style={{ margin: 0 }}>{r.shuttle ? t('รถรับส่ง {n} คน · ', { n: r.pax ?? 0 }) : ''}{money(r.total_amount)}{r.rescheduled_at ? t(' · ใช้สิทธิ์เลื่อนแล้ว') : ''}</p>
                {['confirmed', 'checked_in'].includes(r.status) && !r.shuttle && <BookingQr code={r.code} />}
                {['confirmed', 'checked_in'].includes(r.status) && r.shuttle && (() => {
                  const back = r.shuttle_trips?.find((x) => x.direction === 'from_airport' && !['done', 'cancelled', 'picked_up'].includes(x.status));
                  return back ? <ReturnBags trip={back} idToken={liff.idToken} /> : null;
                })()}
                {r.status === 'pending_payment' && <Link className="btn primary" href={`/liff/pay/${r.id}`}>{t('ชำระเงิน / ส่งสลิป')}</Link>}
              </div>
            );
          };
          if (!rows || rows.length === 0) return null;
          return (
            <>
              {open.length === 0 && <div className="card">{t('ไม่มีการจองที่กำลังดำเนินการ')} <Link className="btn primary" href="/liff/book">{t('จองที่จอดรถ')}</Link></div>}
              {open.map(card)}
              {past.length > 0 && (
                <button type="button" className="btn past-toggle" onClick={() => setShowPast(!showPast)} aria-expanded={showPast}>
                  {showPast ? t('ซ่อนประวัติการจอง') : t('ดูประวัติการจองเพิ่มเติม ({n})', { n: past.length })}
                </button>
              )}
              {showPast && past.map(card)}
            </>
          );
        })()}
        <p className="small">{t('ต้องการเลื่อนวัน? ทักแอดมินในแชท ({h}) ต้องเลื่อนล่วงหน้าอย่างน้อย {n} วัน', { h: t(shop?.admin_hours ?? '08:00–20:00'), n: shop?.reschedule_min_days ?? 7 })}{shop?.shop_phone ? <> · <a href={`tel:${shop.shop_phone}`}>{t('โทร')} {shop.shop_phone.replace(/^(\d{3})(\d{3})(\d{4})$/, '$1-$2-$3')}</a></> : null}</p>
      </div>
    </main>
  );
}

/** "สมาชิก & การจอง": change the return-trip bags ahead of time (more shopping, a box, ...). */
function ReturnBags({ trip, idToken }: { trip: Trip; idToken: string | null }) {
  const { t } = useT();
  const [open, setOpen] = useState(false);
  const [bags, setBags] = useState(trip.large_bags);
  const [saved, setSaved] = useState(trip.large_bags);
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null);
  const [busy, setBusy] = useState(false);
  async function save() {
    setBusy(true); setMsg(null);
    const r = await fetch(`/api/trips/${trip.id}/bags`, {
      method: 'POST', headers: { 'Content-Type': 'application/json', ...authHeaders(idToken) },
      body: JSON.stringify({ large: bags }),
    });
    const j = await r.json().catch(() => ({}));
    setBusy(false);
    if (!r.ok) { setMsg({ ok: false, text: j.error ?? t('บันทึกไม่สำเร็จ กรุณาโทรหาร้าน') }); return; }
    setSaved(bags); setOpen(false);
    setMsg({ ok: true, text: j.no_vehicle || j.too_big ? t('บันทึกแล้ว ร้านได้รับแจ้งและจะจัดรถที่ใส่กระเป๋าได้พอให้') : j.changed ? t('บันทึกแล้ว ระบบเปลี่ยนเป็นรถคันที่ใส่กระเป๋าได้พอ') : t('บันทึกแล้ว') });
  }
  return (
    <div className="return-bags">
      <div className="return-bags-head">
        <span>{t('กระเป๋าขากลับ')}: <b>{saved ? t('ใบใหญ่ {n} ใบ', { n: saved }) : t('ไม่มีใบใหญ่')}</b></span>
        {!open && <button type="button" className="link-btn" onClick={() => { setOpen(true); setMsg(null); }}>{t('แก้ไข')}</button>}
      </div>
      {open && (
        <>
          <BagPicker large={bags} onChange={setBags} />
          <p className="bag-warn" role="note"><span aria-hidden>⚠️</span><span><b>{t('นับเฉพาะใบใหญ่')}</b> {t('ไม่ต้องนับกระเป๋าถือขึ้นเครื่อง เป้ หรือใบเล็ก ซื้อของเพิ่มระหว่างทริป แจ้งไว้ก่อนได้ ระบบจะจัดรถที่ใส่ได้พอ')}</span></p>
          <div style={{ display: 'flex', gap: 8 }}>
            <button type="button" className="btn primary" style={{ marginTop: 0 }} onClick={save} disabled={busy}>{busy ? t('กำลังบันทึก…') : t('บันทึก')}</button>
            <button type="button" className="btn" style={{ marginTop: 0 }} onClick={() => { setOpen(false); setBags(saved); }} disabled={busy}>{t('ยกเลิก')}</button>
          </div>
        </>
      )}
      {msg && <p className={`small ${msg.ok ? 'ok-text' : 'bad-text'}`} style={{ margin: '6px 0 0' }}>{msg.text}</p>}
    </div>
  );
}
