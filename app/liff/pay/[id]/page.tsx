'use client';
import { use, useCallback, useEffect, useState } from 'react';
import Link from 'next/link';
import { authHeaders, closeLiff, useLiff } from '../../useLiff';

type PayInfo = {
  booking: { code: string; plate: string; start_date: string; end_date: string; days: number; total_amount: number; status: string; hold_expires_at: string | null; shuttle: boolean; pax: number | null };
  qr: string | null;
  promptpayName: string;
};

export default function PayPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = use(params);
  const liff = useLiff();
  const [info, setInfo] = useState<PayInfo | null>(null);
  const [file, setFile] = useState<File | null>(null);
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<{ kind: 'ok' | 'bad' | 'info'; text: string } | null>(null);
  const [left, setLeft] = useState<number | null>(null);

  const load = useCallback(async () => {
    const r = await fetch(`/api/bookings/${id}`, { headers: authHeaders(liff.idToken) });
    if (r.ok) setInfo(await r.json());
    else setMsg({ kind: 'bad', text: 'ไม่พบการจองนี้' });
  }, [id, liff.idToken]);

  useEffect(() => { if (liff.ready) load(); }, [liff.ready, load]);

  useEffect(() => {
    const exp = info?.booking.hold_expires_at;
    if (!exp || info?.booking.status !== 'pending_payment') { setLeft(null); return; }
    const tick = () => setLeft(Math.max(0, Math.floor((Date.parse(exp) - Date.now()) / 1000)));
    tick();
    const t = setInterval(tick, 1000);
    return () => clearInterval(t);
  }, [info]);

  async function upload() {
    if (!file) return;
    setBusy(true); setMsg(null);
    const fd = new FormData();
    fd.append('slip', file);
    const r = await fetch(`/api/bookings/${id}/slip`, { method: 'POST', headers: authHeaders(liff.idToken), body: fd });
    const j = await r.json();
    setBusy(false);
    setMsg({ kind: j.confirmed ? 'ok' : j.pending ? 'info' : 'bad', text: j.message });
    load();
  }

  if (!info) return <main className="wrap">{msg ? <div className={`alert ${msg.kind}`}>{msg.text}</div> : <p className="small">กำลังโหลด…</p>}</main>;
  const b = info.booking;
  const paid = b.status === 'confirmed' || b.status === 'checked_in';

  return (
    <main>
      <div className="hero">
        <span className="chip">รหัสการจอง {b.code}</span>
        <h1>{paid ? 'จองสำเร็จ' : 'ชำระเงิน'}</h1>
        <p>{b.plate} · {b.start_date} ถึง {b.end_date} ({b.days} วัน)</p>
      </div>
      <div className="wrap">
        {paid ? (
          <div className="card">
            <div className="alert ok">ยืนยันการจองแล้ว ส่งรายละเอียดไปในแชท LINE ของคุณแล้ว</div>
            {b.shuttle && <p>รถรับส่งไป-กลับ {b.pax} คน · คนขับจะทักแชทก่อนออกรถ</p>}
            <button className="primary" onClick={closeLiff}>กลับไปที่แชท</button>
            <Link className="btn" style={{ width: '100%', marginTop: 10 }} href="/liff/my">การจองของฉัน</Link>
          </div>
        ) : b.status === 'expired' ? (
          <div className="card"><div className="alert bad">หมดเวลาชำระเงิน กรุณาจองใหม่</div><Link className="btn primary" href="/liff/book">จองใหม่</Link></div>
        ) : (
          <>
            <div className="card" style={{ textAlign: 'center' }}>
              <div className="small">สแกนจ่ายด้วยแอปธนาคาร</div>
              {info.qr && <img className="qr" src={info.qr} alt="QR PromptPay สำหรับชำระเงิน" />}
              <div style={{ fontSize: 26, fontWeight: 700 }}>{b.total_amount.toLocaleString('th-TH')} บาท</div>
              <div className="small">PromptPay · {info.promptpayName}</div>
              {left != null && <div className="alert info">กันที่ไว้ให้อีก {Math.floor(left / 60)}:{String(left % 60).padStart(2, '0')} นาที</div>}
            </div>
            <div className="card">
              <h2>ส่งสลิป</h2>
              <label htmlFor="slip">รูปสลิปโอนเงิน (ต้องเห็น QR มุมขวาล่าง)</label>
              <input id="slip" type="file" accept="image/*" onChange={(e) => setFile(e.target.files?.[0] ?? null)} />
              <button className="primary" disabled={!file || busy} onClick={upload}>{busy ? 'กำลังตรวจสลิป…' : 'ส่งสลิป'}</button>
              <p className="small">ระบบตรวจสลิปอัตโนมัติตลอด 24 ชั่วโมง</p>
            </div>
          </>
        )}
        {msg && <div className={`alert ${msg.kind}`}>{msg.text}</div>}
      </div>
    </main>
  );
}
