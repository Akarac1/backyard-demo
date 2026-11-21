'use client';
import { useState } from 'react';

const STEP = 30; // minutes between choices
const TIMES: string[] = [];
for (let m = 0; m < 24 * 60; m += STEP) TIMES.push(`${String(Math.floor(m / 60)).padStart(2, '0')}:${String(m % 60).padStart(2, '0')}`);

/**
 * Date + time picker for a plain <form> (admin ActionForm): writes a single hidden input
 * named `name` with value 'YYYY-MM-DDTHH:mm', same shape a native <input type="datetime-local">
 * gives — so server actions that already read that field (bkkLocalToIso etc.) need no changes.
 * Unlike the native picker, the time choices are a fixed 30-minute list, so there's no way to
 * end up with an off-grid time by typing or scrolling past it.
 */
export default function TimeSlotInput({
  name, defaultValue = '', required, placeholder = 'เลือกเวลา',
}: { name: string; defaultValue?: string; required?: boolean; placeholder?: string }) {
  const [date, setDate] = useState(defaultValue.slice(0, 10));
  const [time, setTime] = useState(defaultValue.slice(11, 16));
  const combined = date && time ? `${date}T${time}` : '';
  const options = time && !TIMES.includes(time) ? [...TIMES, time].sort() : TIMES; // keep an off-grid existing value selectable

  return (
    <div style={{ display: 'flex', gap: 8 }}>
      <input type="date" value={date} onChange={(e) => setDate(e.target.value)} required={required} style={{ flex: '1.3 1 0' }} />
      <select aria-label={placeholder} value={time} onChange={(e) => setTime(e.target.value)} required={required} style={{ flex: '1 1 0' }}>
        <option value="">{placeholder}</option>
        {options.map((x) => <option key={x} value={x}>{x}</option>)}
      </select>
      <input type="hidden" name={name} value={combined} />
    </div>
  );
}
