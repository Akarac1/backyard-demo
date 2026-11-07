'use client';
import { useEffect, useState } from 'react';
import Link from 'next/link';
import { authHeaders, useLiff } from '../useLiff';

type Row = { id: string; code: string; plate: string; start_date: string; end_date: string; days: number; total_amount: number; status: string; shuttle: boolean; pax: number | null; rescheduled_at: string | null };

const STATUS: Record<string, [string, string]> = {
  pending_payment: ['รอชำระเงิน', 'amber'], confirmed: ['ยืนยันแล้ว', 'navy'], checked_in: ['รถอยู่ในลาน', 'navy'],
  checked_out: ['เสร็จสิ้น', ''], cancelled: ['ยกเลิก', ''], expired: ['หมดเวลาชำระ', ''], no_show: ['ไม่มาตามนัด', ''],
};

export default function MyBookings() {
  const liff = useLiff();
  const [rows, setRows] = useState<Row[] | null>(null);
  useEffect(() => {
    if (!liff.ready) return;
    fetch('/api/my', { headers: authHeaders(liff.idToken) }).then((r) => r.json()).then(setRows).catch(() => setRows([]));
  }, [liff.ready, liff.idToken]);

  return (
    <main>
      <div className="hero"><span className="chip">Backyard Airport</span><h1>การจองของฉัน</h1></div>
      <div className="wrap">
        {!rows && <p className="small">กำลังโหลด…</p>}
        {rows?.length === 0 && <div className="card">ยังไม่มีการจอง <Link className="btn primary" href="/liff/book">จองที่จอดรถ</Link></div>}
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
