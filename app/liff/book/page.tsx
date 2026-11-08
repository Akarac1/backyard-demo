'use client';
import { useEffect, useMemo, useState } from 'react';
import { useRouter } from 'next/navigation';
import { authHeaders, useLiff } from '../useLiff';
import { useT } from '@/components/Lang';

type Prices = { price_per_day: number; shuttle_price: number; hold_minutes: number; reschedule_min_days: number; pickup_meeting_point: string; member_discount?: number; member_discount_min_days?: number; member_discount_needs_shuttle?: boolean };
const DEFAULT_PRICES: Prices = { price_per_day: 100, shuttle_price: 300, hold_minutes: 15, reschedule_min_days: 7, pickup_meeting_point: 'ชั้น 2 ประตู 4' };

function todayBkk() {
  return new Date().toLocaleDateString('en-CA', { timeZone: 'Asia/Bangkok' });
}
function daysBetween(a: string, b: string) {
  return Math.round((Date.parse(b) - Date.parse(a)) / 864e5) + 1;
}

type Avail = { day: string; used: number; cap: number; available: boolean };


const r_waste = (value: number, payable: number) => value > payable;

export default function BookPage() {
  const liff = useLiff();
  const router = useRouter();
  const { t, day: thDay, dayTime: thDayTime, money } = useT();
  const today = todayBkk();
  const [f, setF] = useState({
    start: today, end: today, name: '', phone: '', plate: '', province: 'กรุงเทพมหานคร',
    shuttle: true, pax: 2, outboundTime: '', returnFlight: '', returnLanding: '', flightType: 'international', refPhone: '',
  });
  const [avail, setAvail] = useState<Avail[] | null>(null);
  const [pr, setPr] = useState<Prices>(DEFAULT_PRICES);
  useEffect(() => { fetch('/api/prices').then((r) => (r.ok ? r.json() : null)).then((p) => p && setPr(p)).catch(() => {}); }, []);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [review, setReview] = useState(false);
  const [agree, setAgree] = useState(false);
  type Coupon = { id: string; code: string; title: string; value: number; expiresAt: string };
  type Reward = { id: string; title: string; value: number; cost: number };
  const [disc, setDisc] = useState<{ amount: number; reason: string | null; coupons?: Coupon[]; campaign?: { name: string; amount: number; stackable: boolean } | null; points?: number; rewards?: Reward[] } | null>(null);
  // '' = none, 'c:<coupon id>' = a coupon already redeemed, 'r:<reward id>' = spend points now
  const [pick, setPick] = useState<string>('');

  useEffect(() => { if (liff.name && !f.name) setF((x) => ({ ...x, name: liff.name! })); }, [liff.name]); // eslint-disable-line

  const days = f.end >= f.start ? daysBetween(f.start, f.end) : 0;
  const subtotal = days * pr.price_per_day + (f.shuttle ? pr.shuttle_price : 0);
  // campaign (e.g. 10 days, 1 day free) and the returning-customer discount; a non-stackable campaign
  // replaces the member discount when it is bigger (the server applies the same rule)
  const camp = disc?.campaign ?? null;
  let discount = Math.min(disc?.amount ?? 0, subtotal);
  let campAmount = camp?.amount ?? 0;
  if (camp && !camp.stackable && discount > 0) { if (campAmount > discount) discount = 0; else campAmount = 0; }
  // a parking-discount coupon (the server checks it again)
  const coupons = disc?.coupons ?? [];
  const rewards = disc?.rewards ?? [];
  const points = disc?.points ?? 0;
  const coupon = pick.startsWith('c:') ? coupons.find((c) => c.id === pick.slice(2)) : undefined;
  const reward = pick.startsWith('r:') ? rewards.find((r) => r.id === pick.slice(2) && r.cost <= points) : undefined;
  const pickValue = coupon?.value ?? reward?.value ?? 0;
  const couponAmount = Math.max(0, Math.min(pickValue, subtotal - discount));
  campAmount = Math.max(0, Math.min(campAmount, subtotal - discount - couponAmount));
  const total = subtotal - discount - couponAmount - campAmount;

  useEffect(() => {
    if (!f.start || !f.end || f.end < f.start) { setAvail(null); return; }
    const t = setTimeout(async () => {
      const r = await fetch('/api/availability', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ start: f.start, end: f.end }) });
      if (r.ok) setAvail(await r.json());
    }, 300);
    return () => clearTimeout(t);
  }, [f.start, f.end]);

  const full = useMemo(() => avail?.find((a) => !a.available), [avail]);
  const minLeft = useMemo(() => (avail?.length ? Math.min(...avail.map((a) => a.cap - a.used)) : null), [avail]);

  const set = (k: keyof typeof f) => (e: React.ChangeEvent<HTMLInputElement | HTMLSelectElement>) =>
    setF({ ...f, [k]: e.target.value });

  // step 1: check the form, then show the summary (nothing is booked yet, the hold starts on confirm)
  function toReview(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    if (f.shuttle && (!f.outboundTime || !f.returnLanding)) { setError(t('กรุณาใส่เวลามาถึงลาน และเวลาเครื่องลงขากลับ')); return; }
    if (!/^0\d{8,9}$/.test(f.phone.replace(/\D/g, ''))) { setError(t('เบอร์โทรไม่ถูกต้อง')); return; }
    if (f.refPhone.trim() && !/^0\d{8,9}$/.test(f.refPhone.replace(/\D/g, '').replace(/^66/, '0'))) { setError(t('เบอร์ลูกค้าที่แนะนำไม่ถูกต้อง')); return; }
    setAgree(false);
    setDisc(null);
    setReview(true);
    window.scrollTo({ top: 0 });
    // the final price is decided by the server when booking; this only shows it ahead
    fetch('/api/discount', {
      method: 'POST', headers: { 'Content-Type': 'application/json', ...authHeaders(liff.idToken) },
      body: JSON.stringify({ phone: f.phone, refPhone: f.refPhone, days, shuttle: f.shuttle, start: f.start }),
    }).then((r) => (r.ok ? r.json() : null)).then((j) => { setDisc(j ?? { amount: 0, reason: null }); setPick(j?.coupons?.[0]?.id ? `c:${j.coupons[0].id}` : ''); }).catch(() => setDisc({ amount: 0, reason: null }));
  }

  // dates entered for the shuttle that do not match the parking dates: show as a warning on the summary
  const warnings = [
    f.shuttle && f.outboundTime && f.outboundTime.slice(0, 10) !== f.start && t('เวลามาถึงลาน ({t}) ไม่ใช่วันเข้าจอด', { t: thDayTime(f.outboundTime) }),
    f.shuttle && f.returnLanding && f.returnLanding.slice(0, 10) !== f.end && f.returnLanding.slice(0, 10) !== f.start && t('เวลาเครื่องลงขากลับ ({t}) ไม่ใช่วันรับรถคืน', { t: thDayTime(f.returnLanding) }),
    f.shuttle && f.outboundTime && f.returnLanding && f.returnLanding <= f.outboundTime && t('เวลาเครื่องลงขากลับต้องหลังเวลาขาไป'),
  ].filter(Boolean) as string[];

  // step 2: confirmed -> create the booking and go to payment
  async function submit() {
    setError(null);
    setBusy(true);
    const r = await fetch('/api/bookings', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', ...authHeaders(liff.idToken) },
      body: JSON.stringify({ ...f, couponId: coupon?.id ?? null, rewardId: reward?.id ?? null }),
    });
    const j = await r.json();
    setBusy(false);
    if (!r.ok) { setError(j.error ?? t('จองไม่สำเร็จ')); return; }
    router.push(`/liff/pay/${j.id}`);
  }

  if (review) {
    const Row = ({ k, v }: { k: string; v: React.ReactNode }) => <div className="sum-row"><span>{k}</span><b>{v}</b></div>;
    return (
      <main>
        <div className="hero">
          <span className="chip">{t('ขั้นตอน 2 จาก 3 · ตรวจสอบข้อมูล')}</span>
          <h1>{t('ยืนยันการจอง')}</h1>
          <p>{t('ตรวจสอบให้ถูกต้องก่อนชำระเงิน ข้อมูลผิดกด “แก้ไข” ได้')}</p>
        </div>
        <div className="wrap">
          <div className="card">
            <div className="sum-head"><h2>{t('วันที่จอด')}</h2><button type="button" className="link-btn" onClick={() => setReview(false)}>{t('แก้ไข')}</button></div>
            <Row k={t('วันเข้าจอด')} v={thDay(f.start)} />
            <Row k={t('วันรับรถคืน')} v={thDay(f.end)} />
            <Row k={t('จำนวนวัน')} v={t('{n} วัน', { n: days })} />
          </div>
          <div className="card">
            <div className="sum-head"><h2>{t('รถและผู้จอง')}</h2><button type="button" className="link-btn" onClick={() => setReview(false)}>{t('แก้ไข')}</button></div>
            <Row k={t('ทะเบียนรถ')} v={`${f.plate} ${f.province}`} />
            <Row k={t('ชื่อผู้จอง')} v={f.name} />
            <Row k={t('เบอร์โทร')} v={f.phone} />
            {f.refPhone.trim() && <Row k={t('ลูกค้าที่แนะนำ')} v={f.refPhone} />}
          </div>
          <div className="card">
            <div className="sum-head"><h2>{t('รถรับส่ง')}</h2><button type="button" className="link-btn" onClick={() => setReview(false)}>{t('แก้ไข')}</button></div>
            {f.shuttle ? <>
              <Row k={t('ผู้โดยสาร')} v={t('{n} คน', { n: f.pax })} />
              <Row k={t('ขาไป: มาถึงลาน')} v={thDayTime(f.outboundTime)} />
              <Row k={t('ขากลับ: เครื่องลง')} v={thDayTime(f.returnLanding)} />
              <Row k={t('เที่ยวบินขากลับ')} v={`${f.returnFlight || t('ไม่ระบุ')} · ${f.flightType === 'domestic' ? t('ในประเทศ') : t('ต่างประเทศ')}`} />
              <Row k={t('จุดนัดรับขากลับ')} v={t(pr.pickup_meeting_point)} />
            </> : <p className="small" style={{ margin: 0 }}>{t('ไม่ใช้รถรับส่ง')}</p>}
          </div>
          {warnings.map((w) => <div key={w} className="alert info">{t('โปรดตรวจสอบ:')} {w}</div>)}
          <div className="card">
            <div className="price"><span>{t('ที่จอด {n} วัน × {p}', { n: days, p: pr.price_per_day })}</span><span>{money(days * pr.price_per_day)}</span></div>
            {f.shuttle && <div className="price"><span>{t('รถรับส่งไป-กลับ')}</span><span>{money(pr.shuttle_price)}</span></div>}
            {discount > 0 && <div className="price discount"><span>{disc?.reason === 'referral' ? t('ส่วนลดเพื่อนแนะนำ') : t('ส่วนลดลูกค้าเก่า')}</span><span>−{money(discount)}</span></div>}
            {campAmount > 0 && <div className="price discount"><span>{t('แคมเปญ')} {camp?.name}</span><span>−{money(campAmount)}</span></div>}
            {(coupons.length > 0 || rewards.length > 0) && subtotal - discount > 0 && (
              <fieldset className="use-points">
                <legend>{t('ใช้แต้ม / คูปองลดค่าบริการ')} {disc?.points != null && <span className="pts-bal">{t('มี {n} แต้ม', { n: points })}</span>}</legend>
                <label className={`up-opt${pick === '' ? ' on' : ''}`}>
                  <input type="radio" name="use" checked={pick === ''} onChange={() => setPick('')} />
                  <span className="up-main">{t('ไม่ใช้')}</span>
                </label>
                {coupons.map((c) => (
                  <label key={c.id} className={`up-opt${pick === `c:${c.id}` ? ' on' : ''}`}>
                    <input type="radio" name="use" checked={pick === `c:${c.id}`} onChange={() => setPick(`c:${c.id}`)} />
                    <span className="up-main">{t('คูปองที่แลกไว้แล้ว')} · {t(c.title)}<small>{c.code} · {t('ใช้ได้ถึง {d}', { d: thDay(c.expiresAt) })}</small></span>
                    <b>−{money(Math.min(c.value, subtotal - discount))}</b>
                  </label>
                ))}
                {rewards.map((r) => {
                  const can = r.cost <= points;
                  return (
                    <label key={r.id} className={`up-opt${pick === `r:${r.id}` ? ' on' : ''}${can ? '' : ' off'}`}>
                      <input type="radio" name="use" disabled={!can} checked={pick === `r:${r.id}`} onChange={() => setPick(`r:${r.id}`)} />
                      <span className="up-main">{t('ใช้ {a} แต้ม ลด {b}', { a: r.cost, b: money(r.value) })}
                        <small>{can ? t('เหลือ {n} แต้มหลังจอง', { n: points - r.cost }) : t('ขาดอีก {n} แต้ม', { n: r.cost - points })}</small></span>
                      {can && <b>−{money(Math.min(r.value, subtotal - discount))}</b>}
                    </label>
                  );
                })}
                {reward && r_waste(reward.value, subtotal - discount) && <p className="small up-warn">{t('ส่วนลดมากกว่ายอดที่ต้องจ่าย ส่วนที่เกินจะไม่ได้คืนเป็นแต้ม')}</p>}
              </fieldset>
            )}
            {couponAmount > 0 && <div className="price discount"><span>{coupon ? `${t('คูปอง')} ${coupon.code}` : t('ใช้ {n} แต้ม', { n: reward?.cost ?? 0 })}</span><span>−{money(couponAmount)}</span></div>}
            <div className="price total"><span>{t('ยอดชำระ')}</span><span>{disc ? money(total) : t('กำลังคำนวณ…')}</span></div>
            {disc && !discount && (pr.member_discount ?? 0) > 0 && (days < (pr.member_discount_min_days ?? 3) || ((pr.member_discount_needs_shuttle ?? true) && !f.shuttle))
              ? <p className="small" style={{ margin: '4px 0 0' }}>{t('ส่วนลดลูกค้าเก่า/เพื่อนแนะนำ ใช้ได้เมื่อจอง {n} วันขึ้นไป', { n: pr.member_discount_min_days ?? 3 })}{(pr.member_discount_needs_shuttle ?? true) ? t(' และใช้รถรับส่ง') : ''}</p>
              : disc && !discount && f.refPhone.trim() && <p className="small" style={{ margin: '4px 0 0' }}>{t('ไม่พบเบอร์ลูกค้าที่แนะนำในระบบ จึงยังไม่มีส่วนลด กด “แก้ไข” เพื่อตรวจเบอร์ได้')}</p>}
            <label className="agree">
              <input type="checkbox" checked={agree} onChange={(e) => setAgree(e.target.checked)} />
              <span>{t('ข้อมูลถูกต้อง และยอมรับเงื่อนไข: ชำระเต็มจำนวน ไม่คืนเงิน เลื่อนวันได้ 1 ครั้ง (ล่วงหน้า {n} วัน)', { n: pr.reschedule_min_days })}</span>
            </label>
            {error && <div className="alert bad">{error}</div>}
            <button type="button" className="primary" onClick={submit} disabled={!agree || busy || !liff.ready || !disc}>{busy ? t('กำลังจอง…') : disc && total === 0 ? t('ยืนยันการจอง (ไม่มียอดต้องชำระ)') : t('ยืนยันและไปชำระเงิน')}</button>
            <button type="button" className="btn back-btn" onClick={() => setReview(false)} disabled={busy}>{t('กลับไปแก้ไขข้อมูล')}</button>
            <p className="small">{t('กดยืนยันแล้ว ระบบกันที่ให้ {n} นาทีระหว่างชำระเงิน', { n: pr.hold_minutes })}</p>
          </div>
        </div>
      </main>
    );
  }

  return (
    <main>
      <div className="hero">
        <div style={{ display: "flex", alignItems: "center", gap: 12 }}><img src="/logo.png" alt="Backyard Airport The Hangar" width={56} height={54} /><span className="chip">{t('ใกล้สุวรรณภูมิ · ขับ 15 นาที')}</span></div>
        <h1>{t('จองที่จอดรถ')}</h1>
        <p>{t('จอดวันละ {p} บาท · รถรับส่งไป-กลับ {s} บาท', { p: pr.price_per_day, s: pr.shuttle_price })}</p>
      </div>
      <form className="wrap" onSubmit={toReview}>
        <div className="card">
          <h2>{t('วันที่จอด')}</h2>
          <div className="row">
            <div><label htmlFor="start">{t('วันเข้าจอด')}</label><input id="start" type="date" min={today} value={f.start} onChange={set('start')} required /></div>
            <div><label htmlFor="end">{t('วันรับรถคืน')}</label><input id="end" type="date" min={f.start} value={f.end} onChange={set('end')} required /></div>
          </div>
          {full && <div className="alert bad">{t('วันที่ {d} ที่จอดเต็มแล้ว ลองเลือกวันอื่น', { d: thDay(full.day) })}</div>}
          {!full && minLeft != null && <div className="alert ok">{t('ว่าง · เหลืออย่างน้อย {n} ช่องในช่วงนี้', { n: minLeft })}</div>}
        </div>

        <div className="card">
          <h2>{t('ข้อมูลรถและผู้จอง')}</h2>
          <div className="row">
            <div><label htmlFor="plate">{t('ทะเบียนรถ')}</label><input id="plate" placeholder="1กข 1234" value={f.plate} onChange={set('plate')} required /></div>
            <div><label htmlFor="province">{t('จังหวัด')}</label><input id="province" value={f.province} onChange={set('province')} required /></div>
          </div>
          <label htmlFor="name">{t('ชื่อผู้จอง')}</label><input id="name" value={f.name} onChange={set('name')} required />
          <label htmlFor="phone">{t('เบอร์โทร')}</label><input id="phone" type="tel" inputMode="tel" value={f.phone} onChange={set('phone')} required />
          <label htmlFor="ref">{t('เบอร์ลูกค้าเก่าที่แนะนำ (ถ้ามี)')}</label><input id="ref" type="tel" inputMode="tel" placeholder={t('ลูกค้าใหม่ที่เพื่อนแนะนำ ใส่เบอร์เพื่อน')} value={f.refPhone} onChange={set('refPhone')} />
          {(pr.member_discount ?? 0) > 0 && <p className="small" style={{ margin: '6px 0 0' }}>{t('ลูกค้าเก่า หรือลูกค้าที่เพื่อนแนะนำ ลด {d} บาท เมื่อจอง {n} วันขึ้นไป', { d: pr.member_discount ?? 0, n: pr.member_discount_min_days ?? 3 })}{(pr.member_discount_needs_shuttle ?? true) ? t(' และใช้รถรับส่ง') : ''}{t(' · ดูยอดสุดท้ายในหน้าถัดไป')}</p>}
        </div>

        <div className="card">
          <h2>{t('รถรับส่งไป-กลับสนามบิน')}</h2>
          <div className="toggle">
            <button type="button" className={f.shuttle ? 'on' : ''} onClick={() => setF({ ...f, shuttle: true })}>{t('ใช้ (+{n} บาท)', { n: pr.shuttle_price })}</button>
            <button type="button" className={!f.shuttle ? 'on' : ''} onClick={() => setF({ ...f, shuttle: false })}>{t('ไม่ใช้')}</button>
          </div>
          {f.shuttle && (
            <>
              <label htmlFor="pax">{t('จำนวนผู้โดยสาร')}</label>
              <select id="pax" value={f.pax} onChange={(e) => setF({ ...f, pax: Number(e.target.value) })}>
                {[1, 2, 3, 4, 5, 6, 7].map((n) => <option key={n} value={n}>{t('{n} คน', { n })}</option>)}
              </select>
              <label htmlFor="out">{t('ขาไป: เวลาที่จะมาถึงลานจอด')}</label>
              <input id="out" type="datetime-local" value={f.outboundTime} onChange={set('outboundTime')} />
              <label htmlFor="land">{t('ขากลับ: เวลาเครื่องลง')}</label>
              <input id="land" type="datetime-local" value={f.returnLanding} onChange={set('returnLanding')} />
              <div className="row">
                <div><label htmlFor="flight">{t('เลขไฟลต์ขากลับ (ถ้ามี)')}</label><input id="flight" placeholder="TG 629" value={f.returnFlight} onChange={set('returnFlight')} /></div>
                <div><label htmlFor="ftype">{t('เที่ยวบิน')}</label>
                  <select id="ftype" value={f.flightType} onChange={set('flightType')}>
                    <option value="international">{t('ต่างประเทศ')}</option><option value="domestic">{t('ในประเทศ')}</option>
                  </select></div>
              </div>
              <p className="small">{t('คนขับจะรอรับที่{m} หลังเครื่องลง และจะทักแชทหาคุณก่อนออกรถ', { m: t(pr.pickup_meeting_point) })}</p>
            </>
          )}
        </div>

        <div className="card">
          <div className="price"><span>{t('ที่จอด {n} วัน × {p}', { n: days, p: pr.price_per_day })}</span><span>{money(days * pr.price_per_day)}</span></div>
          {f.shuttle && <div className="price"><span>{t('รถรับส่งไป-กลับ')}</span><span>{money(pr.shuttle_price)}</span></div>}
          <div className="price total"><span>{t('รวม')}</span><span>{money(subtotal)}</span></div>
          {error && <div className="alert bad">{error}</div>}
          <button className="primary" disabled={!!full || days < 1}>{t('ถัดไป: ตรวจสอบข้อมูล')}</button>
          <p className="small">{t('ยังไม่ตัดที่จอดจนกว่าจะกดยืนยันในหน้าถัดไป · ไม่คืนเงิน แต่เลื่อนวันได้ 1 ครั้ง (ล่วงหน้า {n} วัน)', { n: pr.reschedule_min_days })}</p>
        </div>
      </form>
    </main>
  );
}
