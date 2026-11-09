'use client';
import { useT } from '@/components/Lang';

/** Two steppers: large (28-29") and medium/small checked bags. */
export function BagPicker({ large, small, onChange }: { large: number; small: number; onChange: (large: number, small: number) => void }) {
  const { t } = useT();
  const row = (label: string, v: number, set: (n: number) => void) => (
    <div className="bag-row">
      <span>{label}</span>
      <div className="bag-step">
        <button type="button" aria-label={t('ลด')} onClick={() => set(Math.max(0, v - 1))} disabled={v <= 0}>−</button>
        <b aria-live="polite">{v}</b>
        <button type="button" aria-label={t('เพิ่ม')} onClick={() => set(Math.min(20, v + 1))} disabled={v >= 20}>+</button>
      </div>
    </div>
  );
  return (
    <div className="bag-picker">
      {row(t('กระเป๋าใบใหญ่ (28–29 นิ้ว)'), large, (n) => onChange(n, small))}
      {row(t('กระเป๋าใบกลาง/เล็ก'), small, (n) => onChange(large, n))}
    </div>
  );
}
