'use client';
import { useEffect, useRef, useState } from 'react';

const STEP = 30; // minutes between choices
const TIMES: string[] = [];
for (let m = 0; m < 24 * 60; m += STEP) TIMES.push(`${String(Math.floor(m / 60)).padStart(2, '0')}:${String(m % 60).padStart(2, '0')}`);

/**
 * Time-only dropdown for a plain <form> (admin ActionForm), for use where the DATE is already picked by
 * another field in the same form (e.g. the "เลื่อนวันจอง" panel's "วันเข้าจอดใหม่"/"วันรับรถคืนใหม่").
 * Reading that sibling field live (by name) means the admin only has to pick a time here — no second,
 * easy-to-miss date picker to fill in, which is what silently dropped the time before (date stayed blank,
 * so the combined 'YYYY-MM-DDTHH:mm' value never formed and the trip time never got set).
 */
export default function TimeOnlyInput({
  name, dateFieldName, defaultValue = '', placeholder = 'เลือกเวลา',
}: { name: string; dateFieldName: string; defaultValue?: string; placeholder?: string }) {
  const [time, setTime] = useState(defaultValue.slice(11, 16));
  const [date, setDate] = useState(defaultValue.slice(0, 10));
  const hiddenRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    const form = hiddenRef.current?.form;
    const dateInput = form?.elements.namedItem(dateFieldName) as HTMLInputElement | null;
    if (!dateInput) return;
    setDate(dateInput.value);
    const onInput = () => setDate(dateInput.value);
    dateInput.addEventListener('input', onInput);
    return () => dateInput.removeEventListener('input', onInput);
  }, [dateFieldName]);

  const combined = date && time ? `${date}T${time}` : '';
  const options = time && !TIMES.includes(time) ? [...TIMES, time].sort() : TIMES; // keep an off-grid existing value selectable

  return (
    <>
      <select aria-label={placeholder} value={time} onChange={(e) => setTime(e.target.value)}>
        <option value="">{placeholder}</option>
        {options.map((x) => <option key={x} value={x}>{x}</option>)}
      </select>
      <input ref={hiddenRef} type="hidden" name={name} value={combined} />
    </>
  );
}
