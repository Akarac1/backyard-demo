'use client';
import { useState } from 'react';
import { ActionForm, Submit } from '@/components/ActionForm';
import { setLineReplies } from '../actions';

export type LineReply = {
  title: string; answer: string; keywords: string[]; enabled?: boolean; button_label?: string; button_url?: string;
};
type Row = { title: string; answer: string; kw: string; enabled: boolean; label: string; url: string };

const toRow = (r: LineReply): Row => ({
  title: r.title, answer: r.answer, kw: r.keywords.join(', '), enabled: r.enabled !== false, label: r.button_label ?? '', url: r.button_url ?? '',
});
const blank = (): Row => ({ title: '', answer: '', kw: '', enabled: true, label: '', url: '' });

// Display only: what the bot already answers by itself (the matching words live in app/api/line/webhook/route.ts).
const BUILTIN: [string, string][] = [
  ['เชื่อมการจองเก่า', 'เชื่อม · ลูกค้าเก่า · เคยจอง · จองเก่า · การจองเดิม · ย้ายมา'],
  ['เวลาที่กรอกตอนจอง / รอกระเป๋า', 'รอกระเป๋า · รับกระเป๋า · เผื่อเวลา · เวลาเครื่องลง · เครื่องลง'],
  ['เข้าดึก / กลับเช้ามืด', 'เข้าดึก · ดึก · เช้ามืด · ตี 2 · 4 ทุ่ม · ลดค่าจอด'],
  ['เวลาเปิดให้บริการ', 'เปิดกี่โมง · ปิดกี่โมง · เปิดทำการ · เปิด 24 · เปิดตลอด · เปิดไหม · 24 ชม. · เวลาทำการ · เปิดให้บริการ'],
  ['ที่อยู่และแผนที่', 'ที่อยู่ · แผนที่ · พิกัด · ไปยังไง · ไปอย่างไร · เดินทางมา · นำทาง'],
  ['รถรับ–ส่งสนามบิน', 'รถรับ · รถส่ง · รับส่ง · รับ-ส่ง · รถตู้ · shuttle'],
  ['จองและชำระเงินยังไง', 'จองยังไง · จองอย่างไร · วิธีจอง · ขั้นตอนจอง · จ่ายยังไง · จ่ายอย่างไร · ชำระ · โอนเงิน'],
  ['สมาชิกและแต้มสะสม', 'แต้ม · สมาชิก · คะแนน'],
  ['ราคาและเงื่อนไข', 'ราคา · เงื่อนไข'],
  ['ติดต่อแอดมิน', 'แอดมิน · ติดต่อ · โทร'],
  ['การ์ดจองที่จอด (ตัวสุดท้าย)', 'จอง'],
];

/** Admin-defined chat answers: keywords + answer (+ optional button). Order = priority. */
export function LineReplies({ initial }: { initial: LineReply[] }) {
  const [rows, setRows] = useState<Row[]>(initial.map(toRow));
  const set = (i: number, p: Partial<Row>) => setRows((a) => a.map((x, j) => (j === i ? { ...x, ...p } : x)));
  const move = (i: number, d: -1 | 1) => setRows((a) => {
    const b = [...a]; const j = i + d;
    if (j < 0 || j >= b.length) return a;
    [b[i], b[j]] = [b[j], b[i]]; return b;
  });
  const payload = JSON.stringify(rows.map((r) => ({
    title: r.title, answer: r.answer, enabled: r.enabled, button_label: r.label, button_url: r.url,
    keywords: r.kw.split(/[,，\n]/).map((w) => w.trim()).filter(Boolean),
  })));
  return (
    <section className="panel" id="line-replies">
      <h2>คำตอบอัตโนมัติใน LINE</h2>
      <p className="hint">
        เพิ่มคำถามที่อยากให้บอตตอบเอง · ใส่ “คำที่จับ” คั่นด้วยเครื่องหมายจุลภาค (,) ถ้าข้อความของลูกค้ามีคำใดคำหนึ่งอยู่ในประโยค บอตจะตอบด้วยการ์ดนี้ (ไม่สนตัวพิมพ์เล็ก-ใหญ่ และเว้นวรรค) ·
        ตรวจจากบนลงล่าง ข้อแรกที่ตรงจะถูกตอบ และตรวจก่อนคำตอบที่ระบบมีให้ จึงใช้ทับคำตอบเดิมได้ · เลี่ยงคำสั้น/กว้างเกินไป เช่น “จอง” จะดักทุกข้อความที่มีคำนี้ · ข้อความตอบกลับแบบนี้ไม่นับโควต้าข้อความของ LINE OA
      </p>
      <details className="hint" style={{ margin: '0 0 12px' }}>
        <summary>คำถามที่ระบบตอบให้อยู่แล้ว (ดูคำที่จับเพื่อไม่ให้ซ้ำ)</summary>
        <ul style={{ paddingLeft: 18, margin: '8px 0 0' }}>
          {BUILTIN.map(([t, w]) => <li key={t}><b>{t}</b> — {w}</li>)}
        </ul>
      </details>
      <ActionForm action={setLineReplies} className="form">
        <input type="hidden" name="replies" value={payload} />
        <div className="reply-list">
          {rows.length === 0 && <p className="hint">ยังไม่มีคำตอบที่เพิ่มเอง กด “+ เพิ่มคำตอบ” ด้านล่าง</p>}
          {rows.map((r, i) => (
            <div key={i} className={`reply-card${r.enabled ? '' : ' off'}`}>
              <div className="reply-head">
                <label className="check"><input type="checkbox" checked={r.enabled} onChange={(e) => set(i, { enabled: e.target.checked })} /> เปิดใช้ · ข้อ {i + 1}</label>
                <span className="reply-tools">
                  <button type="button" className="icon-btn" onClick={() => move(i, -1)} disabled={i === 0} aria-label="เลื่อนขึ้น">↑</button>
                  <button type="button" className="icon-btn" onClick={() => move(i, 1)} disabled={i === rows.length - 1} aria-label="เลื่อนลง">↓</button>
                  <button type="button" className="icon-btn del" onClick={() => setRows((a) => a.filter((_, j) => j !== i))} aria-label="ลบ">✕</button>
                </span>
              </div>
              <label>คำที่จับ<input value={r.kw} onChange={(e) => set(i, { kw: e.target.value })} placeholder="เช่น ที่จอดรถตู้, จอดรถใหญ่, รถกระบะ" /><small>คำละ 2–40 ตัวอักษร ไม่เกิน 10 คำ</small></label>
              <label>หัวข้อของการ์ด<input value={r.title} maxLength={40} onChange={(e) => set(i, { title: e.target.value })} placeholder="เช่น จอดรถตู้ / รถคันใหญ่ได้ไหม 🚐" /></label>
              <label>คำตอบ<textarea rows={5} value={r.answer} maxLength={1000} onChange={(e) => set(i, { answer: e.target.value })} placeholder={'พิมพ์คำตอบได้เลย ใส่อิโมจิได้\nเว้นบรรทัดว่าง 1 บรรทัดเพื่อแยกเป็นย่อหน้าในการ์ด'} /><small>{r.answer.length}/1000 ตัวอักษร</small></label>
              <div className="grid2">
                <label>ปุ่มใต้การ์ด (ไม่ใส่ก็ได้)<input value={r.label} maxLength={20} onChange={(e) => set(i, { label: e.target.value })} placeholder="เช่น เปิดแผนที่" /></label>
                <label>ลิงก์ของปุ่ม<input value={r.url} onChange={(e) => set(i, { url: e.target.value })} placeholder="https://… หรือ tel:0812345678" /></label>
              </div>
            </div>
          ))}
        </div>
        <div className="form-actions">
          <button type="button" className="btn" onClick={() => setRows((a) => [...a, blank()])} disabled={rows.length >= 30}>+ เพิ่มคำตอบ</button>
          <Submit>บันทึกคำตอบอัตโนมัติ</Submit>
        </div>
      </ActionForm>
    </section>
  );
}
