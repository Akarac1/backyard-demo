'use client';
import { useT } from '@/components/Lang';

/** Stepper for large bags (checked suitcases, about 24" and up). Small bags and cabin bags are not counted. */
export function BagPicker({ large, onChange }: { large: number; onChange: (large: number) => void }) {
  const { t } = useT();
  return (
    <div className="bag-picker">
      <div className="bag-row">
        <span className="bag-label">🧳 {t('กระเป๋าเดินทางใบใหญ่')}<small>{t('โหลดใต้เครื่อง ประมาณ 24 นิ้วขึ้นไป')}</small></span>
        <div className="bag-step">
          <button type="button" aria-label={t('ลด')} onClick={() => onChange(Math.max(0, large - 1))} disabled={large <= 0}>−</button>
          <b aria-live="polite">{large}</b>
          <button type="button" aria-label={t('เพิ่ม')} onClick={() => onChange(Math.min(20, large + 1))} disabled={large >= 20}>+</button>
        </div>
      </div>
    </div>
  );
}
