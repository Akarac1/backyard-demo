'use client';
import { useEffect, useMemo, useState } from 'react';
import { useRouter } from 'next/navigation';
import { authHeaders, useLiff } from '../useLiff';

type Prices = { price_per_day: number; shuttle_price: number; hold_minutes: number; reschedule_min_days: number; pickup_meeting_point: string; member_discount?: number; member_discount_min_days?: number; member_discount_needs_shuttle?: boolean };
const DEFAULT_PRICES: Prices = { price_per_day: 100, shuttle_price: 300, hold_minutes: 15, reschedule_min_days: 7, pickup_meeting_point: 'ชั้น 2 ประตู 4' };

function todayBkk() {
  return new Date().toLocaleDateString('en-CA', { timeZone: 'Asia/Bangkok' });
}
function daysBetween(a: string, b: string) {
  return Math.round((Date.parse(b) - Date.parse(a)) / 864e5) + 1;
}

type Avail = { day: string; used: number; cap: number; available: boolean };

const TH_OPT: Intl.DateTimeFormatOptions = { timeZone: 'Asia/Bangkok', weekday: 'short', day: 'numeric', month: 'short', year: '2-digit' };
/** '2026-12-12' -> 'ส. 12 ธ.ค. 69' */
const thDay = (d: string) => new Date(`${d}T12:00:00+07:00`).toLocaleDateString('th-TH', TH_OPT);
/** '2026-12-12T09:30' (Bangkok) -> 'ส. 12 ธ.ค. 69 · 09:30 น.' */
const thDayTime = (dt: string) => (dt ? `${thDay(dt.slice(0, 10))} · ${dt.slice(11, 16)} น.` : '—');

export default function BookPage() {
  const liff = useLiff();
  const router = useRouter();
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
  const [disc, setDisc] = useState<{ amount: number; reason: string | null; coupons?: Coupon[]; campaign?: { name: string; amount: number; stackable: boolean } | null } | null>(null);
  const [couponId, setCouponId] = useState<string>('');

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
  const coupon = coupons.find((c) => c.id === couponId);
  const couponAmount = coupon ? Math.min(coupon.value, subtotal - discount) : 0;
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
    if (f.shuttle && (!f.outboundTime || !f.returnLanding)) { setError('กรุณาใส่เวลามาถึงลาน และเวลาเครื่องลงขากลับ'); return; }
    if (!/^0\d{8,9}$/.test(f.phone.replace(/\D/g, ''))) { setError('เบอร์โทรไม่ถูกต้อง'); return; }
    if (f.refPhone.trim() && !/^0\d{8,9}$/.test(f.refPhone.replace(/\D/g, '').replace(/^66/, '0'))) { setError('เบอร์ลูกค้าที่แนะนำไม่ถูกต้อง'); return; }
    setAgree(false);
    setDisc(null);
    setReview(true);
    window.scrollTo({ top: 0 });
    // the final price is decided by the server when booking; this only shows it ahead
    fetch('/api/discount', {
      method: 'POST', headers: { 'Content-Type': 'application/json', ...authHeaders(liff.idToken) },
      body: JSON.stringify({ phone: f.phone, refPhone: f.refPhone, days, shuttle: f.shuttle, start: f.start }),
    }).then((r) => (r.ok ? r.json() : null)).then((j) => { setDisc(j ?? { amount: 0, reason: null }); setCouponId(j?.coupons?.[0]?.id ?? ''); }).catch(() => setDisc({ amount: 0, reason: null }));
  }

  // dates entered for the shuttle that do not match the parking dates: show as a warning on the summary
  const warnings = [
    f.shuttle && f.outboundTime && f.outboundTime.slice(0, 10) !== f.start && `เวลามาถึงลาน (${thDayTime(f.outboundTime)}) ไม่ใช่วันเข้าจอด`,
    f.shuttle && f.returnLanding && f.returnLanding.slice(0, 10) !== f.end && f.returnLanding.slice(0, 10) !== f.start && `เวลาเครื่องลงขากลับ (${thDayTime(f.returnLanding)}) ไม่ใช่วันรับรถคืน`,
    f.shuttle && f.outboundTime && f.returnLanding && f.returnLanding <= f.outboundTime && 'เวลาเครื่องลงขากลับต้องหลังเวลาขาไป',
  ].filter(Boolean) as string[];

  // step 2: confirmed -> create the booking and go to payment
  async function submit() {
    setError(null);
    setBusy(true);
    const r = await fetch('/api/bookings', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', ...authHeaders(liff.idToken) },
      body: JSON.stringify({ ...f, couponId: coupon?.id ?? null }),
    });
    const j = await r.json();
    setBusy(false);
    if (!r.ok) { setError(j.error ?? 'จองไม่สำเร็จ'); return; }
    router.push(`/liff/pay/${j.id}`);
  }

  if (review) {
    const Row = ({ k, v }: { k: string; v: React.ReactNode }) => <div className="sum-row"><span>{k}</span><b>{v}</b></div>;
    return (
      <main>
        <div className="hero">
          <span className="chip">ขั้นตอน 2 จาก 3 · ตรวจสอบข้อมูล</span>
          <h1>ยืนยันการจอง</h1>
          <p>ตรวจสอบให้ถูกต้องก่อนชำระเงิน ข้อมูลผิดกด “แก้ไข” ได้</p>
        </div>
        <div className="wrap">
          <div className="card">
            <div className="sum-head"><h2>วันที่จอด</h2><button type="button" className="link-btn" onClick={() => setReview(false)}>แก้ไข</button></div>
            <Row k="วันเข้าจอด" v={thDay(f.start)} />
            <Row k="วันรับรถคืน" v={thDay(f.end)} />
            <Row k="จำนวนวัน" v={`${days} วัน`} />
          </div>
          <div className="card">
            <div className="sum-head"><h2>รถและผู้จอง</h2><button type="button" className="link-btn" onClick={() => setReview(false)}>แก้ไข</button></div>
            <Row k="ทะเบียนรถ" v={`${f.plate} ${f.province}`} />
            <Row k="ชื่อผู้จอง" v={f.name} />
            <Row k="เบอร์โทร" v={f.phone} />
            {f.refPhone.trim() && <Row k="ลูกค้าที่แนะนำ" v={f.refPhone} />}
          </div>
          <div className="card">
            <div className="sum-head"><h2>รถรับส่ง</h2><button type="button" className="link-btn" onClick={() => setReview(false)}>แก้ไข</button></div>
            {f.shuttle ? <>
              <Row k="ผู้โดยสาร" v={`${f.pax} คน`} />
              <Row k="ขาไป: มาถึงลาน" v={thDayTime(f.outboundTime)} />
              <Row k="ขากลับ: เครื่องลง" v={thDayTime(f.returnLanding)} />
              <Row k="เที่ยวบินขากลับ" v={`${f.returnFlight || 'ไม่ระบุ'} · ${f.flightType === 'domestic' ? 'ในประเทศ' : 'ต่างประเทศ'}`} />
              <Row k="จุดนัดรับขากลับ" v={pr.pickup_meeting_point} />
            </> : <p className="small" style={{ margin: 0 }}>ไม่ใช้รถรับส่ง</p>}
          </div>
          {warnings.map((w) => <div key={w} className="alert info">โปรดตรวจสอบ: {w}</div>)}
          <div className="card">
            <div className="price"><span>ที่จอด {days} วัน × {pr.price_per_day}</span><span>{(days * pr.price_per_day).toLocaleString('th-TH')} บาท</span></div>
            {f.shuttle && <div className="price"><span>รถรับส่งไป-กลับ</span><span>{pr.shuttle_price} บาท</span></div>}
            {discount > 0 && <div className="price discount"><span>{disc?.reason === 'referral' ? 'ส่วนลดเพื่อนแนะนำ' : 'ส่วนลดลูกค้าเก่า'}</span><span>−{discount.toLocaleString('th-TH')} บาท</span></div>}
            {campAmount > 0 && <div className="price discount"><span>แคมเปญ {camp?.name}</span><span>−{campAmount.toLocaleString('th-TH')} บาท</span></div>}
            {coupons.length > 0 && (
              <label className="coupon-pick">คูปองส่วนลดของคุณ
                <select value={couponId} onChange={(e) => setCouponId(e.target.value)}>
                  <option value="">ไม่ใช้คูปอง</option>
                  {coupons.map((c) => <option key={c.id} value={c.id}>{c.title} · {c.code}</option>)}
                </select>
              </label>
            )}
            {couponAmount > 0 && <div className="price discount"><span>คูปอง {coupon?.code}</span><span>−{couponAmount.toLocaleString('th-TH')} บาท</span></div>}
            <div className="price total"><span>ยอดชำระ</span><span>{disc ? `${total.toLocaleString('th-TH')} บาท` : 'กำลังคำนวณ…'}</span></div>
            {disc && !discount && (pr.member_discount ?? 0) > 0 && (days < (pr.member_discount_min_days ?? 3) || ((pr.member_discount_needs_shuttle ?? true) && !f.shuttle))
              ? <p className="small" style={{ margin: '4px 0 0' }}>ส่วนลดลูกค้าเก่า/เพื่อนแนะนำ ใช้ได้เมื่อจอง {pr.member_discount_min_days ?? 3} วันขึ้นไป{(pr.member_discount_needs_shuttle ?? true) ? ' และใช้รถรับส่ง' : ''}</p>
              : disc && !discount && f.refPhone.trim() && <p className="small" style={{ margin: '4px 0 0' }}>ไม่พบเบอร์ลูกค้าที่แนะนำในระบบ จึงยังไม่มีส่วนลด กด “แก้ไข” เพื่อตรวจเบอร์ได้</p>}
            <label className="agree">
              <input type="checkbox" checked={agree} onChange={(e) => setAgree(e.target.checked)} />
              <span>ข้อมูลถูกต้อง และยอมรับเงื่อนไข: ชำระเต็มจำนวน ไม่คืนเงิน เลื่อนวันได้ 1 ครั้ง (ล่วงหน้า {pr.reschedule_min_days} วัน)</span>
            </label>
            {error && <div className="alert bad">{error}</div>}
            <button type="button" className="primary" onClick={submit} disabled={!agree || busy || !liff.ready || !disc}>{busy ? 'กำลังจอง…' : disc && total === 0 ? 'ยืนยันการจอง (ไม่มียอดต้องชำระ)' : 'ยืนยันและไปชำระเงิน'}</button>
            <button type="button" className="btn back-btn" onClick={() => setReview(false)} disabled={busy}>กลับไปแก้ไขข้อมูล</button>
            <p className="small">กดยืนยันแล้ว ระบบกันที่ให้ {pr.hold_minutes} นาทีระหว่างชำระเงิน</p>
          </div>
        </div>
      </main>
    );
  }

  return (
    <main>
      <div className="hero">
        <div style={{ display: "flex", alignItems: "center", gap: 12 }}><img src="/logo.png" alt="Backyard Airport The Hangar" width={56} height={54} /><span className="chip">ใกล้สุวรรณภูมิ · ขับ 15 นาที</span></div>
        <h1>จองที่จอดรถ</h1>
        <p>จอดวันละ {pr.price_per_day} บาท · รถรับส่งไป-กลับ {pr.shuttle_price} บาท</p>
      </div>
      <form className="wrap" onSubmit={toReview}>
        <div className="card">
          <h2>วันที่จอด</h2>
          <div className="row">
            <div><label htmlFor="start">วันเข้าจอด</label><input id="start" type="date" min={today} value={f.start} onChange={set('start')} required /></div>
            <div><label htmlFor="end">วันรับรถคืน</label><input id="end" type="date" min={f.start} value={f.end} onChange={set('end')} required /></div>
          </div>
          {full && <div className="alert bad">วันที่ {full.day} ที่จอดเต็มแล้ว ลองเลือกวันอื่น</div>}
          {!full && minLeft != null && <div className="alert ok">ว่าง · เหลืออย่างน้อย {minLeft} ช่องในช่วงนี้</div>}
        </div>

        <div className="card">
          <h2>ข้อมูลรถและผู้จอง</h2>
          <div className="row">
            <div><label htmlFor="plate">ทะเบียนรถ</label><input id="plate" placeholder="1กข 1234" value={f.plate} onChange={set('plate')} required /></div>
            <div><label htmlFor="province">จังหวัด</label><input id="province" value={f.province} onChange={set('province')} required /></div>
          </div>
          <label htmlFor="name">ชื่อผู้จอง</label><input id="name" value={f.name} onChange={set('name')} required />
          <label htmlFor="phone">เบอร์โทร</label><input id="phone" type="tel" inputMode="tel" value={f.phone} onChange={set('phone')} required />
          <label htmlFor="ref">เบอร์ลูกค้าเก่าที่แนะนำ (ถ้ามี)</label><input id="ref" type="tel" inputMode="tel" placeholder="ลูกค้าใหม่ที่เพื่อนแนะนำ ใส่เบอร์เพื่อน" value={f.refPhone} onChange={set('refPhone')} />
          {(pr.member_discount ?? 0) > 0 && <p className="small" style={{ margin: '6px 0 0' }}>ลูกค้าเก่า หรือลูกค้าที่เพื่อนแนะนำ ลด {pr.member_discount} บาท เมื่อจอง {pr.member_discount_min_days ?? 3} วันขึ้นไป{(pr.member_discount_needs_shuttle ?? true) ? ' และใช้รถรับส่ง' : ''} · ดูยอดสุดท้ายในหน้าถัดไป</p>}
        </div>

        <div className="card">
          <h2>รถรับส่งไป-กลับสนามบิน</h2>
          <div className="toggle">
            <button type="button" className={f.shuttle ? 'on' : ''} onClick={() => setF({ ...f, shuttle: true })}>ใช้ (+{pr.shuttle_price} บาท)</button>
            <button type="button" className={!f.shuttle ? 'on' : ''} onClick={() => setF({ ...f, shuttle: false })}>ไม่ใช้</button>
          </div>
          {f.shuttle && (
            <>
              <label htmlFor="pax">จำนวนผู้โดยสาร</label>
              <select id="pax" value={f.pax} onChange={(e) => setF({ ...f, pax: Number(e.target.value) })}>
                {[1, 2, 3, 4, 5, 6, 7].map((n) => <option key={n} value={n}>{n} คน</option>)}
              </select>
              <label htmlFor="out">ขาไป: เวลาที่จะมาถึงลานจอด</label>
              <input id="out" type="datetime-local" value={f.outboundTime} onChange={set('outboundTime')} />
              <label htmlFor="land">ขากลับ: เวลาเครื่องลง</label>
              <input id="land" type="datetime-local" value={f.returnLanding} onChange={set('returnLanding')} />
              <div className="row">
                <div><label htmlFor="flight">เลขไฟลต์ขากลับ (ถ้ามี)</label><input id="flight" placeholder="TG 629" value={f.returnFlight} onChange={set('returnFlight')} /></div>
                <div><label htmlFor="ftype">เที่ยวบิน</label>
                  <select id="ftype" value={f.flightType} onChange={set('flightType')}>
                    <option value="international">ต่างประเทศ</option><option value="domestic">ในประเทศ</option>
                  </select></div>
              </div>
              <p className="small">คนขับจะรอรับที่{pr.pickup_meeting_point} หลังเครื่องลง และจะทักแชทหาคุณก่อนออกรถ</p>
            </>
          )}
        </div>

        <div className="card">
          <div className="price"><span>ที่จอด {days} วัน × {pr.price_per_day}</span><span>{days * pr.price_per_day} บาท</span></div>
          {f.shuttle && <div className="price"><span>รถรับส่งไป-กลับ</span><span>{pr.shuttle_price} บาท</span></div>}
          <div className="price total"><span>รวม</span><span>{subtotal.toLocaleString('th-TH')} บาท</span></div>
          {error && <div className="alert bad">{error}</div>}
          <button className="primary" disabled={!!full || days < 1}>ถัดไป: ตรวจสอบข้อมูล</button>
          <p className="small">ยังไม่ตัดที่จอดจนกว่าจะกดยืนยันในหน้าถัดไป · ไม่คืนเงิน แต่เลื่อนวันได้ 1 ครั้ง (ล่วงหน้า {pr.reschedule_min_days} วัน)</p>
        </div>
      </form>
    </main>
  );
}
