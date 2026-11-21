'use client';
import { useEffect, useState } from 'react';

const STEP = 30; // minutes between choices
const TIMES: string[] = [];
for (let m = 0; m < 24 * 60; m += STEP) TIMES.push(`${String(Math.floor(m / 60)).padStart(2, '0')}:${String(m % 60).padStart(2, '0')}`);

/**
 * Date + time chooser; time comes from a fixed list (every 15 min), unlike datetime-local.
 * value / onChange use 'YYYY-MM-DDTHH:mm' ('' while incomplete). defaultDate pre-fills the date only.
 * lockDate: the date is fixed to defaultDate and shown as plain text — only the time is pickable
 * (used so the outbound/landing date can never drift from the parking start/end date).
 */
export default function DateTimeSlots({
  id, value, onChange, defaultDate = '', placeholder = 'เลือกเวลา', invalid, lockDate = false,
}: { id?: string; value: string; onChange: (v: string) => void; defaultDate?: string; placeholder?: string; invalid?: boolean; lockDate?: boolean }) {
  const [date, setDate] = useState(value.slice(0, 10) || defaultDate);
  const [time, setTime] = useState(value.slice(11, 16));

  // follow outside changes (e.g. a suggested free slot was tapped)
  useEffect(() => {
    if (value) { setDate(value.slice(0, 10)); setTime(value.slice(11, 16)); }
    else { setTime(''); }
  }, [value]);
  // keep the pre-filled date in step with the stay dates until the customer picks one
  useEffect(() => { if (!value && defaultDate) setDate(defaultDate); }, [defaultDate, value]);
  // locked: the date always follows defaultDate (the parking start/end date), never a separate pick —
  // if the customer changes the parking dates after already picking a time, carry the time over to the new date
  useEffect(() => {
    if (lockDate && defaultDate && date !== defaultDate) {
      setDate(defaultDate);
      if (time) onChange(`${defaultDate}T${time}`);
    }
  }, [lockDate, defaultDate]); // eslint-disable-line react-hooks/exhaustive-deps

  const emit = (d: string, t: string) => onChange(d && t ? `${d}T${t}` : '');
  const options = time && !TIMES.includes(time) ? [...TIMES, time].sort() : TIMES; // keep an off-grid time (older data) selectable

  return (
    <div style={{ display: 'flex', gap: 8 }}>
      {lockDate ? (
        <span style={{ flex: '1.3 1 0', display: 'flex', alignItems: 'center', padding: '0 10px', background: 'var(--surface-2, #f2f2f2)', borderRadius: 8, fontSize: 14 }}>
          {date || defaultDate}
        </span>
      ) : (
        <input id={id} type="date" value={date} aria-invalid={invalid} style={{ flex: '1.3 1 0' }}
          onChange={(e) => { setDate(e.target.value); emit(e.target.value, time); }} />
      )}
      <select aria-label={placeholder} value={time} aria-invalid={invalid} style={{ flex: '1 1 0' }}
        onChange={(e) => { setTime(e.target.value); emit(lockDate ? defaultDate : date, e.target.value); }}>
        <option value="">{placeholder}</option>
        {options.map((x) => <option key={x} value={x}>{x}</option>)}
      </select>
    </div>
  );
}
