'use client';
import { use, useCallback, useEffect, useState } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { authHeaders, closeLiff, useLiff } from '../../useLiff';
import { useT } from '@/components/Lang';

type PayInfo = {
  booking: { code: string; plate: string; start_date: string; end_date: string; days: number; total_amount: number; status: string; hold_expires_at: string | null; shuttle: boolean; pax: number | null };
  qr: string | null;
  payable: number;
  group: { leadId: string; total: number; cars: { id: string; plate: string; province: string; amount: number }[] } | null;
  promptpayName: string;
};


export default function PayPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = use(params);
  const liff = useLiff();
  const router = useRouter();
  const { t, day: thDay, money } = useT();
  const [info, setInfo] = useState<PayInfo | null>(null);
  const [file, setFile] = useState<File | null>(null);
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<{ kind: 'ok' | 'bad' | 'info'; text: string } | null>(null);
  const [left, setLeft] = useState<number | null>(null);

  const load = useCallback(async () => {
    const r = await fetch(`/api/bookings/${id}`, { headers: authHeaders(liff.idToken) });
    if (r.ok) {
      const j = (await r.json()) as PayInfo;
      // group booking: the one payment lives on the lead car
      if (j.group && j.group.leadId !== id) { router.replace(`/liff/pay/${j.group.leadId}`); return; }
      setInfo(j);
    }
    else setMsg({ kind: 'bad', text: t('ไม่พบการจองนี้') });
  }, [id, liff.idToken]); // eslint-disable-line react-hooks/exhaustive-deps

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

  if (!info) return <main className="wrap">{msg ? <div className={`alert ${msg.kind}`}>{msg.text}</div> : <p className="small">{t('กำลังโหลด…')}</p>}</main>;
  const b = info.booking;
  const paid = b.status === 'confirmed' || b.status === 'checked_in';
  const amount = info.payable ?? b.total_amount;
  const plates = info.group ? info.group.cars.map((c) => c.plate).join(', ') : b.plate;

  return (
    <main>
      <div className="hero">
        <span className="chip">{t('รหัสการจอง')} {b.code}</span>
        <h1>{paid ? t('จองสำเร็จ') : t('ชำระเงิน')}</h1>
        <p>{plates} · {thDay(b.start_date)} – {thDay(b.end_date)} ({t('{n} วัน', { n: b.days })})</p>
      </div>
      <div className="wrap">
        {paid ? (
          <div className="card">
            <div className="alert ok">{t('ยืนยันการจองแล้ว ส่งรายละเอียดไปในแชท LINE ของคุณแล้ว')}</div>
            {info.group && <p>{t('รถทุกคัน: {p}', { p: plates })}</p>}
            {b.shuttle && <p>{t('รถรับส่งไป-กลับ {n} คน · คนขับจะทักแชทก่อนออกรถ', { n: b.pax ?? 0 })}</p>}
            <button className="primary" onClick={closeLiff}>{t('กลับไปที่แชท')}</button>
            <Link className="btn" style={{ width: '100%', marginTop: 10 }} href="/liff/my">{t('สมาชิก & การจอง')}</Link>
          </div>
        ) : b.status === 'expired' ? (
          <div className="card"><div className="alert bad">{t('หมดเวลาชำระเงิน กรุณาจองใหม่')}</div><Link className="btn primary" href="/liff/book">{t('จองใหม่')}</Link></div>
        ) : (
          <>
            {info.group && (
              <div className="card">
                <h2>{t('จองหลายคัน · {n} คัน · จ่ายครั้งเดียว', { n: info.group.cars.length })}</h2>
                {info.group.cars.map((c) => <div key={c.id} className="price"><span>{c.plate} {c.province}</span><span>{money(c.amount)}</span></div>)}
                <div className="price total"><span>{t('ยอดชำระรวม')}</span><span>{money(info.group.total)}</span></div>
              </div>
            )}
            <div className="card" style={{ textAlign: 'center' }}>
              <div className="small">{t('สแกนจ่ายด้วยแอปธนาคาร · ยอดเงินขึ้นให้อัตโนมัติ')}</div>
              {info.qr ? <img className="qr" src={info.qr} alt={`QR PromptPay ${money(amount)}`} /> : <div className="alert bad">{t('ยังสร้าง QR ไม่ได้ ติดต่อแอดมิน')}</div>}
              <div style={{ fontSize: 26, fontWeight: 700 }}>{money(amount)}</div>
              <div className="small">PromptPay · {info.promptpayName}</div>
              <p className="small" style={{ margin: '8px 0 0' }}>{t('บนมือถือ: กดค้างที่ QR เพื่อบันทึกรูป แล้วเปิดในแอปธนาคาร')}</p>
              {left != null && <div className="alert info">{t('กันที่ไว้ให้อีก {t} นาที', { t: `${Math.floor(left / 60)}:${String(left % 60).padStart(2, '0')}` })}</div>}
            </div>
            <div className="card">
              <h2>{t('ส่งสลิป')}</h2>
              <label htmlFor="slip">{t('รูปสลิปโอนเงิน (ต้องเห็น QR มุมขวาล่าง)')}</label>
              <input id="slip" type="file" accept="image/*" onChange={(e) => setFile(e.target.files?.[0] ?? null)} />
              <button className="primary" disabled={!file || busy} onClick={upload}>{busy ? t('กำลังตรวจสลิป…') : t('ส่งสลิป')}</button>
              <p className="small">{t('ระบบตรวจสลิปอัตโนมัติตลอด 24 ชั่วโมง')}</p>
            </div>
          </>
        )}
        {msg && <div className={`alert ${msg.kind}`}>{msg.text}</div>}
      </div>
    </main>
  );
}
