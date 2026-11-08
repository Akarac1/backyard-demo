'use client';
import { useState } from 'react';

export type Series = { key: string; label: string; color: string };
export type Point = { label: string; values: Record<string, number>; note?: string };

const W = 720, H = 260, L = 56, R = 12, T = 12, B = 34;
const fmt = (n: number) => n.toLocaleString('th-TH');

/** Round tick step (1, 2, 2.5, 5 x 10^n) and the axis top that is a whole number of steps. */
function niceScale(v: number, target = 5) {
  if (v <= 0) return { max: 1, step: 0.25 };
  const raw = v / target;
  const p = Math.pow(10, Math.floor(Math.log10(raw)));
  const step = [1, 2, 2.5, 5, 10].map((m) => m * p).find((x) => x >= raw)!;
  return { max: Math.ceil(v / step) * step, step };
}
const ticksOf = (max: number, step: number) => Array.from({ length: Math.round(max / step) + 1 }, (_, i) => i * step);
function shortNum(n: number) {
  if (n >= 1e6) return `${+(n / 1e6).toFixed(1)}M`;
  if (n >= 1e3) return `${+(n / 1e3).toFixed(n >= 1e4 ? 0 : 1)}k`;
  return String(n);
}
/** Show at most ~10 axis labels so they never collide. */
const labelEvery = (n: number) => Math.max(1, Math.ceil(n / 10));

function Tooltip({ x, title, rows, total, unit }: { x: number; title: string; rows: { label: string; color?: string; value: string }[]; total?: string; unit?: string }) {
  const left = `${Math.min(Math.max((x / W) * 100, 12), 88)}%`;
  return (
    <div className="tip" style={{ left }}>
      <b>{title}</b>
      {rows.map((r) => (
        <div key={r.label} className="tip-row">
          {r.color && <i style={{ background: r.color }} />}<span>{r.label}</span><span>{r.value}{unit}</span>
        </div>
      ))}
      {total && <div className="tip-row tip-total"><span>รวม</span><span>{total}{unit}</span></div>}
    </div>
  );
}

function Legend({ series }: { series: Series[] }) {
  if (series.length < 2) return null;
  return (
    <div className="legend">
      {series.map((s) => <span key={s.key}><i style={{ background: s.color }} />{s.label}</span>)}
    </div>
  );
}

/** Stacked (or single) bar chart with a hover tooltip per bar. */
export function BarChart({ points, series, unit, title }: { points: Point[]; series: Series[]; unit: string; title: string }) {
  const [hover, setHover] = useState<number | null>(null);
  const totals = points.map((p) => series.reduce((a, s) => a + (p.values[s.key] ?? 0), 0));
  const { max, step } = niceScale(Math.max(...totals, 0));
  const pw = W - L - R, ph = H - T - B;
  const slot = pw / Math.max(points.length, 1);
  const bw = Math.max(3, Math.min(36, slot * 0.62));
  const y = (v: number) => T + ph - (v / max) * ph;
  const every = labelEvery(points.length);
  const ticks = ticksOf(max, step);

  return (
    <div className="chart" onMouseLeave={() => setHover(null)}>
      <Legend series={series} />
      <svg viewBox={`0 0 ${W} ${H}`} role="img" aria-label={title}>
        {ticks.map((t) => (
          <g key={t}>
            <line x1={L} x2={W - R} y1={y(t)} y2={y(t)} className="grid-line" />
            <text x={L - 8} y={y(t) + 4} className="axis" textAnchor="end">{shortNum(t)}</text>
          </g>
        ))}
        {points.map((p, i) => {
          const cx = L + slot * i + slot / 2;
          let acc = 0;
          const segs = series.map((s) => {
            const v = p.values[s.key] ?? 0;
            const y0 = y(acc), y1 = y(acc + v);
            acc += v;
            return { s, v, y0, y1 };
          }).filter((g) => g.v > 0);
          return (
            <g key={i} opacity={hover === null || hover === i ? 1 : 0.45}>
              {segs.map((g, j) => {
                const top = j === segs.length - 1;
                const h = Math.max(0, g.y0 - g.y1 - (j > 0 ? 2 : 0)); // 2px gap between stacked parts
                const r = top ? Math.min(4, bw / 2, h) : 0;
                const x0 = cx - bw / 2, yy = g.y1;
                const d = r
                  ? `M${x0},${yy + h} V${yy + r} Q${x0},${yy} ${x0 + r},${yy} H${x0 + bw - r} Q${x0 + bw},${yy} ${x0 + bw},${yy + r} V${yy + h} Z`
                  : `M${x0},${yy + h} V${yy} H${x0 + bw} V${yy + h} Z`;
                return <path key={g.s.key} d={d} fill={g.s.color} />;
              })}
              {i % every === 0 && <text x={cx} y={H - 12} className="axis" textAnchor="middle">{p.label}</text>}
              <rect x={L + slot * i} y={T} width={slot} height={ph} fill="transparent"
                onMouseEnter={() => setHover(i)} onClick={() => setHover(i)} />
            </g>
          );
        })}
        <line x1={L} x2={W - R} y1={y(0)} y2={y(0)} className="base-line" />
      </svg>
      {hover !== null && (
        <Tooltip x={L + slot * hover + slot / 2} title={points[hover].label + (points[hover].note ?? '')} unit={unit}
          rows={series.map((s) => ({ label: s.label, color: series.length > 1 ? s.color : undefined, value: fmt(points[hover].values[s.key] ?? 0) }))}
          total={series.length > 1 ? fmt(totals[hover]) : undefined} />
      )}
    </div>
  );
}

/** Single-series line chart (0–100%) with a crosshair tooltip. */
export function LineChart({ points, valueKey, color, unit, title, max: fixedMax }: { points: Point[]; valueKey: string; color: string; unit: string; title: string; max?: number }) {
  const [hover, setHover] = useState<number | null>(null);
  const sc = fixedMax ? { max: fixedMax, step: fixedMax / 4 } : niceScale(Math.max(...points.map((p) => p.values[valueKey] ?? 0), 0));
  const { max, step } = sc;
  const pw = W - L - R, ph = H - T - B;
  const slot = pw / Math.max(points.length, 1);
  const x = (i: number) => L + slot * i + slot / 2;
  const y = (v: number) => T + ph - (v / max) * ph;
  const every = labelEvery(points.length);
  const ticks = ticksOf(max, step);
  const path = points.map((p, i) => `${i ? 'L' : 'M'}${x(i)},${y(p.values[valueKey] ?? 0)}`).join(' ');

  return (
    <div className="chart" onMouseLeave={() => setHover(null)}>
      <svg viewBox={`0 0 ${W} ${H}`} role="img" aria-label={title}>
        {ticks.map((t) => (
          <g key={t}>
            <line x1={L} x2={W - R} y1={y(t)} y2={y(t)} className="grid-line" />
            <text x={L - 8} y={y(t) + 4} className="axis" textAnchor="end">{Math.round(t)}{unit}</text>
          </g>
        ))}
        <path d={path} fill="none" stroke={color} strokeWidth={2} strokeLinejoin="round" strokeLinecap="round" />
        {points.map((p, i) => (
          <g key={i}>
            {i % every === 0 && <text x={x(i)} y={H - 12} className="axis" textAnchor="middle">{p.label}</text>}
            {hover === i && <>
              <line x1={x(i)} x2={x(i)} y1={T} y2={T + ph} className="cross" />
              <circle cx={x(i)} cy={y(p.values[valueKey] ?? 0)} r={5} fill={color} stroke="#fff" strokeWidth={2} />
            </>}
            <rect x={L + slot * i} y={T} width={slot} height={ph} fill="transparent" onMouseEnter={() => setHover(i)} onClick={() => setHover(i)} />
          </g>
        ))}
        <line x1={L} x2={W - R} y1={y(0)} y2={y(0)} className="base-line" />
      </svg>
      {hover !== null && (
        <Tooltip x={x(hover)} title={points[hover].label + (points[hover].note ?? '')} unit={unit}
          rows={[{ label: title, value: (points[hover].values[valueKey] ?? 0).toLocaleString('th-TH', { maximumFractionDigits: 1 }) }]} />
      )}
    </div>
  );
}
