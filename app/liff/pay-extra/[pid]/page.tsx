'use client';
import { use, useCallback, useEffect, useState } from 'react';
import Link from 'next/link';
import { authHeaders, closeLiff, useLiff } from '../../useLiff';
import { useT } from '@/components/Lang';

type Info = {
  payment: { id: string; kind: string; amount: number; status: string };
  booking: { code: string; plate: string; start_date: string; end_date: string };
  qr: string | null; promptpayName: string;
};

export default function PayExtraPage({ params }: { params: Promise<{ pid: string }> }) {
  const { pid } = use(params);
  const liff = useLiff();
  const { t, day: thDay, money } = useT();
  const [info, setInfo] = useState<Info | null>(null);
  const [file, setFile] = useState<File | null>(null);
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<{ kind: 'ok' | 'bad' | 'info'; text: string } | null>(null);

  const load = useCallback(async () => {
    const r = await fetch(`/api/payments/${pid}`, { headers: authHeaders(liff.idToken) });
    if (r.ok) setInfo((await r.json()) as Info);
    else setMsg({ kind: 'bad', text: t('ไม่พบรายการชำระเงิน') });
  }, [pid, liff.idToken]); // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => { if (liff.ready) load(); }, [liff.ready, load]);

  async function upload() {
    if (!file) return;
    setBusy(true); setMsg(null);
    const fd = new FormData(); fd.append('slip', file);
    const r = await fetch(`/api/payments/${pid}/slip`, { method: 'POST', headers: authHeaders(liff.idToken), body: fd });
    const j = await r.json();
    setBusy(false);
    setMsg({ kind: j.confirmed ? 'ok' : j.pending ? 'info' : 'bad', text: j.message });
    load();
  }

  if (!info) return <main className="wrap">{msg ? <div className={`alert ${msg.kind}`}>{msg.text}</div> : <p className="small">{t('กำลังโหลด…')}</p>}</main>;
  const paid = info.payment.status === 'verified';
  return (
    <main>
      <div className="hero">
        <span className="chip">{t('รหัสการจอง')} {info.booking.code}</span>
        <h1>{paid ? t('ชำระเงินสำเร็จ') : t('ชำระเงิน')}</h1>
        <p>{info.booking.plate} · {t('รับรถออก {d}', { d: thDay(info.booking.end_date) })}</p>
      </div>
      <div className="wrap">
        {paid ? (
          <div className="card">
            <div className="alert ok">{t('ได้รับชำระแล้ว ขอบคุณครับ')}</div>
            <button className="primary" onClick={closeLiff}>{t('กลับไปที่แชท')}</button>
            <Link className="btn" style={{ width: '100%', marginTop: 10 }} href="/liff/my">{t('สมาชิก & การจอง')}</Link>
          </div>
        ) : (
          <>
            <div className="card" style={{ textAlign: 'center' }}>
              <div className="small">{t('ค่าจอดเพิ่ม · สแกนจ่ายด้วยแอปธนาคาร')}</div>
              {info.qr ? <img className="qr" src={info.qr} alt={`QR PromptPay ${money(info.payment.amount)}`} /> : <div className="alert bad">{t('ยังสร้าง QR ไม่ได้ ติดต่อแอดมิน')}</div>}
              <div style={{ fontSize: 26, fontWeight: 700 }}>{money(info.payment.amount)}</div>
              <div className="small">PromptPay · {info.promptpayName}</div>
              <p className="small" style={{ margin: '8px 0 0' }}>{t('บนมือถือ: กดค้างที่ QR เพื่อบันทึกรูป แล้วเปิดในแอปธนาคาร')}</p>
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
