'use client';
import { useState } from 'react';
import { ActionForm, Submit } from '@/components/ActionForm';
import { setNotePresets } from '../actions';

/** Ready-made phrases for the driver's note box: add, edit, remove, reorder. */
export function NotePresets({ initial }: { initial: string[] }) {
  const [items, setItems] = useState<string[]>(initial.length ? initial : ['']);
  const set = (i: number, v: string) => setItems((a) => a.map((x, j) => (j === i ? v : x)));
  const move = (i: number, d: -1 | 1) => setItems((a) => {
    const b = [...a]; const j = i + d;
    if (j < 0 || j >= b.length) return a;
    [b[i], b[j]] = [b[j], b[i]]; return b;
  });
  return (
    <section className="panel">
      <h2>ข้อความสำเร็จรูปของคนขับ</h2>
      <p className="hint">แสดงเป็นปุ่มในช่อง “แจ้งปัญหา / หมายเหตุ” หน้าคนขับ กดแล้วข้อความลงกล่องให้แก้ต่อได้ · ถ้าคนขับติ๊ก “ส่งให้ลูกค้าด้วย” ข้อความจะถึงลูกค้า จึงควรเขียนแบบสุภาพ · สูงสุด 12 ข้อความ ข้อความละไม่เกิน 200 ตัวอักษร</p>
      <ActionForm action={setNotePresets} className="form">
        <ol className="preset-list">
          {items.map((v, i) => (
            <li key={i}>
              <input name="preset" value={v} maxLength={200} onChange={(e) => set(i, e.target.value)} placeholder="เช่น รถติดหนัก ถึงช้าประมาณ 15 นาที" />
              <button type="button" className="icon-btn" onClick={() => move(i, -1)} disabled={i === 0} aria-label="เลื่อนขึ้น">↑</button>
              <button type="button" className="icon-btn" onClick={() => move(i, 1)} disabled={i === items.length - 1} aria-label="เลื่อนลง">↓</button>
              <button type="button" className="icon-btn del" onClick={() => setItems((a) => a.filter((_, j) => j !== i))} aria-label="ลบ">✕</button>
            </li>
          ))}
        </ol>
        <div className="form-actions">
          <button type="button" className="btn" onClick={() => setItems((a) => [...a, ''])} disabled={items.length >= 12}>+ เพิ่มข้อความ</button>
          <Submit>บันทึกข้อความสำเร็จรูป</Submit>
        </div>
      </ActionForm>
    </section>
  );
}
