'use client';
import { useEffect, useState } from 'react';

const STEP = 15; // minutes between choices
const TIMES: string[] = [];
for (let m = 0; m < 24 * 60; m += STEP) TIMES.push(`${String(Math.floor(m / 60)).padStart(2, '0')}:${String(m % 60).padStart(2, '0')}`);

/**
 * Date + time chooser; time comes from a fixed list (every 15 min), unlike datetime-local.
 * value / onChange use 'YYYY-MM-DDTHH:mm' ('' while incomplete). defaultDate pre-fills the date only.
 */
export default function DateTimeSlots({
  id, value, onChange, defaultDate = '', placeholder = 'เลือกเวลา', invalid,
}: { id?: string; value: string; onChange: (v: string) => void; defaultDate?: string; placeholder?: string; invalid?: boolean }) {
  const [date, setDate] = useState(value.slice(0, 10) || defaultDate);
  const [time, setTime] = useState(value.slice(11, 16));

  // follow outside changes (e.g. a suggested free slot was tapped)
  useEffect(() => {
    if (value) { setDate(value.slice(0, 10)); setTime(value.slice(11, 16)); }
    else { setTime(''); }
  }, [value]);
  // keep the pre-filled date in step with the stay dates until the customer picks one
  useEffect(() => { if (!value && defaultDate) setDate(defaultDate); }, [defaultDate, value]);

  const emit = (d: string, t: string) => onChange(d && t ? `${d}T${t}` : '');
  const options = time && !TIMES.includes(time) ? [...TIMES, time].sort() : TIMES; // keep an off-grid time (older data) selectable

  return (
    <div style={{ display: 'flex', gap: 8 }}>
      <input id={id} type="date" value={date} aria-invalid={invalid} style={{ flex: '1.3 1 0' }}
        onChange={(e) => { setDate(e.target.value); emit(e.target.value, time); }} />
      <select aria-label={placeholder} value={time} aria-invalid={invalid} style={{ flex: '1 1 0' }}
        onChange={(e) => { setTime(e.target.value); emit(date, e.target.value); }}>
        <option value="">{placeholder}</option>
        {options.map((x) => <option key={x} value={x}>{x}</option>)}
      </select>
    </div>
  );
}
