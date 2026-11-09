import { thDate } from '@/lib/format';

export type DensityRow = { day: string; cars: number; arrivals: number; departures: number; cap: number; total: number };

const MONTHS = ['ม.ค.', 'ก.พ.', 'มี.ค.', 'เม.ย.', 'พ.ค.', 'มิ.ย.', 'ก.ค.', 'ส.ค.', 'ก.ย.', 'ต.ค.', 'พ.ย.', 'ธ.ค.'];
const C = { ok: '#3E7D5C', low: '#D9A23B', full: '#C2413A', grid: '#E3E9E5', axis: '#9AA7A0', ink: '#1E2A23', quiet: '#66756C' };

/** Cars in the lot per day: one bar per day, the bookable capacity as a dashed line. */
export function DensityChart({ rows, today }: { rows: DensityRow[]; today: string }) {
  if (!rows.length) return <p className="small">ไม่มีข้อมูลในช่วงนี้</p>;
  const W = 960, H = 284, L = 40, R = 16, T = 28, B = 60;
  const pw = W - L - R, ph = H - T - B;
  const cap = rows[0].cap, total = rows[0].total;
  const top = Math.max(total, ...rows.map((r) => r.cars));
  const y = (v: number) => T + ph - (v / top) * ph;
  const step = pw / rows.length, bw = Math.max(4, step - 4);
  const tone = (r: DensityRow) => (r.cars >= r.cap ? 'full' : r.cars >= r.cap * 0.8 ? 'low' : 'ok');
  const every = rows.length > 21 ? 3 : rows.length > 12 ? 2 : 1;
  const peak = rows.reduce((a, r) => (r.cars > a.cars ? r : a), rows[0]);
  return (
    <svg viewBox={`0 0 ${W} ${H}`} className="density" role="img" aria-label={`รถในลานต่อวัน ${thDate(rows[0].day)} ถึง ${thDate(rows[rows.length - 1].day)}`}>
      {[0, Math.round(top / 2), top].map((v) => (
        <g key={v}>
          <line x1={L} x2={W - R} y1={y(v)} y2={y(v)} stroke={C.grid} />
          <text x={L - 8} y={y(v) + 4} textAnchor="end" fontSize="11" fill={C.quiet}>{v}</text>
        </g>
      ))}
      {rows.map((r, i) => {
        const x = L + i * step + (step - bw) / 2;
        const isToday = r.day === today;
        const d = Number(r.day.slice(8)), m = Number(r.day.slice(5, 7));
        const showMonth = i === 0 || d === 1;
        return (
          <g key={r.day}>
            <title>{`${thDate(r.day)} · รถในลาน ${r.cars}/${r.cap} คัน · ว่าง ${Math.max(0, r.cap - r.cars)} · เข้า ${r.arrivals} · ออก ${r.departures}`}</title>
            <rect x={L + i * step} y={T} width={step} height={ph} fill="transparent" />
            <rect x={x} y={y(r.cars)} width={bw} height={Math.max(0, T + ph - y(r.cars))} rx="3" fill={C[tone(r)]} opacity={r.day < today ? 0.55 : 1} />
            {isToday && <rect x={x - 2} y={y(r.cars) - 2} width={bw + 4} height={T + ph - y(r.cars) + 2} rx="4" fill="none" stroke={C.ink} strokeWidth="1.5" />}
            {(i % every === 0 || isToday) && (
              <text x={x + bw / 2} y={T + ph + 16} textAnchor="middle" fontSize="11" fontWeight={isToday ? 700 : 400} fill={isToday ? C.ink : C.quiet}>{d}</text>
            )}
            {showMonth && <text x={x} y={T + ph + 32} fontSize="11" fill={C.quiet}>{MONTHS[m - 1]}</text>}
            {isToday && <text x={x + bw / 2} y={T + ph + 48} textAnchor="middle" fontSize="11" fontWeight="700" fill={C.ink}>วันนี้</text>}
            {(r === peak || isToday) && r.cars > 0 && (
              <text x={x + bw / 2} y={y(r.cars) - 6} textAnchor="middle" fontSize="11" fontWeight="600" fill={C.ink}>{r.cars}</text>
            )}
          </g>
        );
      })}
      <line x1={L} x2={W - R} y1={y(cap)} y2={y(cap)} stroke={C.ink} strokeDasharray="5 4" strokeWidth="1.2" />
      <text x={W - R} y={y(cap) - 6} textAnchor="end" fontSize="11" fill={C.ink}>เปิดจอง {cap} ช่อง</text>
      <line x1={L} x2={W - R} y1={T + ph} y2={T + ph} stroke={C.axis} />
    </svg>
  );
}

export function DensityLegend() {
  return (
    <div className="density-legend">
      <span><i style={{ background: C.ok }} />ว่างพอ</span>
      <span><i style={{ background: C.low }} />ใกล้เต็ม (80% ขึ้นไป)</span>
      <span><i style={{ background: C.full }} />เต็ม</span>
      <span><i className="dash" />จำนวนช่องที่เปิดให้จอง</span>
      <span><i style={{ background: C.ok, opacity: 0.55 }} />วันที่ผ่านมาแล้ว</span>
    </div>
  );
}
