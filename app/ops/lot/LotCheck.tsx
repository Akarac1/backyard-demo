'use client';
import Link from 'next/link';
import { useEffect, useMemo, useState } from 'react';
import { bkkDay, thDate, thTime } from '@/lib/format';
import { markCarFound } from '@/app/admin/actions';

export type LotCar = {
  id: string; code: string; plate: string; plate_province: string; start_date: string; end_date: string; days: number;
  shuttle: boolean; pax: number | null; late_grace: boolean; checked_in_at: string | null; admin_note: string | null;
  customers: { name: string; phone: string; member_no: string | null } | null;
};
type Mark = 'ok' | 'miss';
type Filter = 'all' | 'todo' | 'miss' | 'due' | 'over';

const effEnd = (c: LotCar) => c.late_grace ? new Date(Date.parse(`${c.end_date}T00:00:00Z`) + 86400000).toISOString().slice(0, 10) : c.end_date;
const NOTE: Record<string, string> = { sent: 'ส่งการ์ด “รถปลอดภัย” ให้ลูกค้าแล้ว', already: 'วันนี้ส่งการ์ดให้ลูกค้าไปแล้ว', no_line: 'ลูกค้าไม่ได้ผูก LINE ไม่ได้ส่งการ์ด', failed: 'ส่งการ์ดไม่สำเร็จ กดพบอีกครั้งเพื่อส่งใหม่' };

const load = (key: string): Record<string, Mark> => {
  try { return JSON.parse(localStorage.getItem(key) ?? '{}') ?? {}; } catch { return {}; }
};

export function LotCheck({ cars, today }: { cars: LotCar[]; today: string }) {
  const key = `lotcheck:${today}`;
  const [marks, setMarks] = useState<Record<string, Mark>>({});
  const [q, setQ] = useState('');
  const [f, setF] = useState<Filter>('all');
  const [sent, setSent] = useState<Record<string, string>>({});
  useEffect(() => { setMarks(load(key)); }, [key]);
  const save = (next: Record<string, Mark>) => {
    setMarks(next);
    try { localStorage.setItem(key, JSON.stringify(next)); } catch { /* storage off: keep in memory */ }
  };
  const mark = (id: string, m: Mark) => {
    const next = { ...marks };
    if (next[id] === m) delete next[id]; else next[id] = m;
    save(next);
    if (m === 'ok' && next[id] === 'ok') {
      // found: tell the customer their car is safe (the server sends it once per booking per day)
      markCarFound(id).then((r) => setSent((s) => ({ ...s, [id]: r.error ?? NOTE[r.result ?? 'failed'] })), () => setSent((s) => ({ ...s, [id]: NOTE.failed })));
    }
  };

  const ids = new Set(cars.map((c) => c.id));
  const ok = cars.filter((c) => marks[c.id] === 'ok').length;
  const miss = cars.filter((c) => marks[c.id] === 'miss').length;
  const over = cars.filter((c) => effEnd(c) < today).length;
  const due = cars.filter((c) => effEnd(c) === today).length;
  const done = ok + miss;

  const shown = useMemo(() => {
    const s = q.replace(/\s+/g, '').toLowerCase();
    return cars.filter((c) => {
      if (f === 'todo' && marks[c.id]) return false;
      if (f === 'miss' && marks[c.id] !== 'miss') return false;
      if (f === 'due' && effEnd(c) !== today) return false;
      if (f === 'over' && !(effEnd(c) < today)) return false;
      if (!s) return true;
      return [c.plate, c.plate_province, c.code, c.customers?.name ?? '', c.customers?.phone ?? '']
        .some((v) => v.replace(/\s+/g, '').toLowerCase().includes(s));
    });
  }, [cars, marks, q, f, today]);

  const tabs: [Filter, string, number][] = [
    ['all', 'ทั้งหมด', cars.length], ['todo', 'ยังไม่ตรวจ', cars.length - done], ['miss', 'ไม่พบ', miss],
    ['due', 'ออกวันนี้', due], ['over', 'เกินกำหนด', over],
  ];

  return (
    <>
      <section className="tiles">
        <div className="tile"><span>รถในลาน</span><b>{cars.length}<small> คัน</small></b><em>ตามระบบ ณ ตอนเปิดหน้านี้</em></div>
        <div className="tile">
          <span>ตรวจแล้ว</span><b>{done}<small>/{cars.length}</small></b>
          <div className="meter" role="img" aria-label={`ตรวจแล้ว ${done} จาก ${cars.length}`}><i style={{ width: `${cars.length ? (done / cars.length) * 100 : 0}%` }} /></div>
          <em>พบ {ok} · ไม่พบ {miss}</em>
        </div>
        <div className={`tile ${miss ? 'tile-warn' : ''}`}><span>ไม่พบในลาน</span><b>{miss}<small> คัน</small></b><em>{miss ? 'แจ้งหัวหน้างาน / ตรวจกล้อง' : 'ยังไม่มี'}</em></div>
        <div className={`tile ${over ? 'tile-warn' : ''}`}><span>เกินกำหนดออก</span><b>{over}<small> คัน</small></b><em>ออกวันนี้ {due} คัน</em></div>
      </section>

      <section className="panel">
        <div className="lot-tools no-print">
          <input type="search" value={q} onChange={(e) => setQ(e.target.value)} placeholder="ค้นทะเบียน / รหัส / ชื่อ / เบอร์" aria-label="ค้นหารถในลาน" />
          <div className="lot-tabs" role="tablist" aria-label="กรองรายการ">
            {tabs.map(([k, label, c]) => (
              <button key={k} type="button" role="tab" aria-selected={f === k} className={`chip-btn ${f === k ? 'on' : ''}`} onClick={() => setF(k)}>{label} {c}</button>
            ))}
          </div>
          <div className="lot-btns">
            <button type="button" className="b b-plain" onClick={() => window.print()}>พิมพ์รายการ</button>
            <button type="button" className="b b-plain" disabled={!done}
              onClick={() => { if (done && window.confirm('ล้างผลการตรวจของวันนี้ทั้งหมด?')) save({}); }}>เริ่มตรวจใหม่</button>
          </div>
        </div>

        {shown.length === 0 ? <p className="lot-muted">{cars.length ? 'ไม่มีรถตามเงื่อนไขนี้' : 'ตอนนี้ไม่มีรถอยู่ในลาน'}</p> : (
          <ul className="lot-list">
            {shown.map((c) => {
              const m = marks[c.id];
              const late = effEnd(c) < today;
              return (
                <li key={c.id} className={`lot-row ${m ? `is-${m}` : ''}`}>
                  <div className="lot-plate"><b>{c.plate}</b><small>{c.plate_province}</small></div>
                  <div className="lot-main">
                    <div>
                      <Link href={`/ops/b/${c.code}`} className="code">{c.code}</Link> · {c.customers?.name ?? '-'}
                      {c.customers?.phone && <> · <a href={`tel:${c.customers.phone}`}>{c.customers.phone}</a></>}
                    </div>
                    <small>
                      เข้า {c.checked_in_at ? `${thDate(bkkDay(c.checked_in_at))} ${thTime(c.checked_in_at)}` : thDate(c.start_date)}
                      {' · '}กำหนดออก {thDate(c.end_date)}
                      {late && <span className="tag tag-warn"> เกินกำหนด</span>}
                      {effEnd(c) === today && <span className="tag"> ออกวันนี้</span>}
                      {c.late_grace && <span className="tag"> ผ่อนผันรอบดึก +1 วัน</span>}
                      {' · '}{c.shuttle ? `รถรับส่ง ${c.pax ?? ''} คน` : 'ไม่ใช้รถรับส่ง'}
                    </small>
                    {c.admin_note && <small className="ops-note">หมายเหตุ: {c.admin_note}</small>}
                    {sent[c.id] && <small className="ops-note no-print" role="status">{sent[c.id]}</small>}
                  </div>
                  <div className="lot-act no-print" role="group" aria-label={`ผลตรวจ ${c.plate}`}>
                    <button type="button" className={`lot-b ok ${m === 'ok' ? 'on' : ''}`} aria-pressed={m === 'ok'} onClick={() => mark(c.id, 'ok')}>✓ พบ</button>
                    <button type="button" className={`lot-b miss ${m === 'miss' ? 'on' : ''}`} aria-pressed={m === 'miss'} onClick={() => mark(c.id, 'miss')}>✗ ไม่พบ</button>
                  </div>
                  <div className="lot-print-box print-only" aria-hidden>☐ พบ &nbsp; ☐ ไม่พบ</div>
                </li>
              );
            })}
          </ul>
        )}
        {Object.keys(marks).some((id) => !ids.has(id)) && <p className="lot-muted no-print" style={{ marginTop: 8 }}>มีบางคันรับรถออกไปแล้วตั้งแต่เริ่มตรวจ รายการนี้แสดงเฉพาะรถที่ยังอยู่ในลาน</p>}
      </section>
    </>
  );
}
