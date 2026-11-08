'use client';
import { useEffect, useMemo, useState } from 'react';
import { useRouter } from 'next/navigation';
import { authHeaders, useLiff } from '../useLiff';

const PRICE_PER_DAY = 100;
const SHUTTLE_PRICE = 300;

function todayBkk() {
  return new Date().toLocaleDateString('en-CA', { timeZone: 'Asia/Bangkok' });
}
function daysBetween(a: string, b: string) {
  return Math.round((Date.parse(b) - Date.parse(a)) / 864e5) + 1;
}

type Avail = { day: string; used: number; cap: number; available: boolean };

export default function BookPage() {
  const liff = useLiff();
  const router = useRouter();
  const today = todayBkk();
  const [f, setF] = useState({
    start: today, end: today, name: '', phone: '', plate: '', province: 'กรุงเทพมหานคร',
    shuttle: true, pax: 2, outboundTime: '', returnFlight: '', returnLanding: '', flightType: 'international',
  });
  const [avail, setAvail] = useState<Avail[] | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => { if (liff.name && !f.name) setF((x) => ({ ...x, name: liff.name! })); }, [liff.name]); // eslint-disable-line

  const days = f.end >= f.start ? daysBetween(f.start, f.end) : 0;
  const total = days * PRICE_PER_DAY + (f.shuttle ? SHUTTLE_PRICE : 0);

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

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    if (f.shuttle && (!f.outboundTime || !f.returnLanding)) { setError('กรุณาใส่เวลามาถึงลาน และเวลาเครื่องลงขากลับ'); return; }
    setBusy(true);
    const r = await fetch('/api/bookings', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', ...authHeaders(liff.idToken) },
      body: JSON.stringify(f),
    });
    const j = await r.json();
    setBusy(false);
    if (!r.ok) { setError(j.error ?? 'จองไม่สำเร็จ'); return; }
    router.push(`/liff/pay/${j.id}`);
  }

  return (
    <main>
      <div className="hero">
        <div style={{ display: "flex", alignItems: "center", gap: 12 }}><img src="/logo.png" alt="Backyard Airport The Hangar" width={56} height={54} /><span className="chip">ใกล้สุวรรณภูมิ · ขับ 15 นาที</span></div>
        <h1>จองที่จอดรถ</h1>
        <p>จอดวันละ 100 บาท · รถรับส่งไป-กลับ 300 บาท</p>
      </div>
      <form className="wrap" onSubmit={submit}>
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
        </div>

        <div className="card">
          <h2>รถรับส่งไป-กลับสนามบิน</h2>
          <div className="toggle">
            <button type="button" className={f.shuttle ? 'on' : ''} onClick={() => setF({ ...f, shuttle: true })}>ใช้ (+300 บาท)</button>
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
              <p className="small">คนขับจะรอรับที่ชั้น 2 ประตู 4 หลังเครื่องลง และจะทักแชทหาคุณก่อนออกรถ</p>
            </>
          )}
        </div>

        <div className="card">
          <div className="price"><span>ที่จอด {days} วัน × 100</span><span>{days * PRICE_PER_DAY} บาท</span></div>
          {f.shuttle && <div className="price"><span>รถรับส่งไป-กลับ</span><span>300 บาท</span></div>}
          <div className="price total"><span>รวม</span><span>{total.toLocaleString('th-TH')} บาท</span></div>
          {error && <div className="alert bad">{error}</div>}
          <button className="primary" disabled={busy || !!full || days < 1 || !liff.ready}>{busy ? 'กำลังจอง…' : 'จองและชำระเงิน'}</button>
          <p className="small">ระบบกันที่ให้ 15 นาทีระหว่างชำระเงิน · ไม่คืนเงิน แต่เลื่อนวันได้ 1 ครั้ง (ล่วงหน้า 7 วัน)</p>
        </div>
      </form>
    </main>
  );
}
