'use client';
import { useEffect, useMemo, useRef, useState } from 'react';
import { useRouter } from 'next/navigation';

export type BoardTrip = {
  id: string; direction: 'to_airport' | 'from_airport'; pax: number; large_bags: number; pickup_at: string | null; landing_at: string | null;
  called_at: string | null; status: string; departed_at: string | null; arrived_at: string | null; driver_staff_id: string | null;
  flight_number: string | null; drop_door: string | null; vehicles: { name: string } | null; driver: { display_name: string } | null;
  bookings: { code: string; status: string; customers: { name: string } | null } | null;
};

type Kind = 'alarm' | 'soon' | 'moving' | 'later' | 'wait_call';
const REFRESH_MS = 15_000;
const SOON_MIN = 15;
const MAX_ROWS = 4;   // big rows for what needs attention now (3 while the red banner shows); the rest of the 24 hours go in compact cards below

const dayKey = (ms: number) => new Date(ms).toLocaleDateString('en-CA', { timeZone: 'Asia/Bangkok' });
const hm = (ms: number) => new Date(ms).toLocaleTimeString('th-TH', { hour: '2-digit', minute: '2-digit', timeZone: 'Asia/Bangkok' });
const mins = (ms: number) => Math.round(ms / 60_000);
const name = (s: string | undefined | null) => (s ?? '').replace(/\s*\(.*\)$/, '');

/** taken = a driver pressed the first step (or is shown on the trip) */
const taken = (t: BoardTrip) => !!t.driver_staff_id || ['en_route', 'arrived', 'picked_up'].includes(t.status);

function classify(t: BoardTrip, now: number): { kind: Kind; at: number; text: string } {
  const pick = t.pickup_at ? Date.parse(t.pickup_at) : now;
  if (t.direction === 'from_airport') {
    if (t.called_at) {
      const c = Date.parse(t.called_at);
      if (!taken(t)) return { kind: 'alarm', at: c, text: `ลูกค้าเรียกรถแล้ว รอมา ${Math.max(0, mins(now - c))} นาที` };
      return { kind: 'moving', at: c, text: t.status === 'arrived' ? 'ถึงจุดนัดรับแล้ว' : 'กำลังไปรับ' };
    }
    if (taken(t)) return { kind: 'moving', at: pick, text: t.status === 'arrived' ? 'ถึงจุดนัดรับแล้ว' : 'กำลังไปรับ' };
    const land = t.landing_at ? Date.parse(t.landing_at) : pick;
    return { kind: 'wait_call', at: land, text: now < land ? `เครื่องลง ${hm(land)}` : `เครื่องลงแล้ว ${hm(land)} · รอลูกค้าเรียก` };
  }
  if (taken(t)) return { kind: 'moving', at: pick, text: t.status === 'en_route' ? 'กำลังไปสนามบิน' : 'พร้อมรับที่ลาน' };
  if (now >= pick) return { kind: 'alarm', at: pick, text: `เลยเวลามา ${mins(now - pick)} นาที · ยังไม่มีคนรับงาน` };
  if (pick - now <= SOON_MIN * 60_000) return { kind: 'soon', at: pick, text: `อีก ${Math.max(1, mins(pick - now))} นาที` };
  return { kind: 'later', at: pick, text: `อีก ${mins(pick - now) >= 60 ? `${Math.floor(mins(pick - now) / 60)} ชม. ${mins(pick - now) % 60} นาที` : `${mins(pick - now)} นาที`}` };
}

// ---- sound (Web Audio, no file): browsers allow it only after one tap on the screen ----
function beep(ctx: AudioContext, pattern: [number, number][]) {
  let t = ctx.currentTime;
  for (const [freq, dur] of pattern) {
    const o = ctx.createOscillator(); const g = ctx.createGain();
    o.type = 'square'; o.frequency.value = freq;
    g.gain.setValueAtTime(0.0001, t); g.gain.exponentialRampToValueAtTime(0.35, t + 0.02); g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
    o.connect(g).connect(ctx.destination); o.start(t); o.stop(t + dur + 0.02);
    t += dur + 0.08;
  }
}
const ALARM: [number, number][] = [[880, 0.25], [660, 0.25], [880, 0.25], [660, 0.25]];
const CHIME: [number, number][] = [[1046, 0.15], [1318, 0.25]];

export function Board({ trips, serverNow, meetingPoint }: { trips: BoardTrip[]; serverNow: number; meetingPoint: string }) {
  const router = useRouter();
  const [now, setNow] = useState(serverNow);
  const [started, setStarted] = useState(false);
  const [snoozeUntil, setSnoozeUntil] = useState(0);
  const ctx = useRef<AudioContext | null>(null);
  const known = useRef<Set<string> | null>(null);
  const lastData = useRef(serverNow);

  useEffect(() => { lastData.current = serverNow; }, [serverNow]);
  useEffect(() => { const t = setInterval(() => setNow(Date.now()), 1000); return () => clearInterval(t); }, []);
  useEffect(() => { const t = setInterval(() => router.refresh(), REFRESH_MS); return () => clearInterval(t); }, [router]);

  const rows = useMemo(() => {
    const order: Record<Kind, number> = { alarm: 0, soon: 1, moving: 2, later: 3, wait_call: 4 };
    return trips.map((t) => ({ t, ...classify(t, now) })).sort((a, b) => order[a.kind] - order[b.kind] || a.at - b.at);
  }, [trips, now]);
  const alarms = rows.filter((r) => r.kind === 'alarm');
  const stale = now - lastData.current > 75_000;
  const max = alarms.length || stale ? MAX_ROWS - 1 : MAX_ROWS;

  // alarm: repeat every 4 s while something is late (unless snoozed); chime once for a new trip on the board
  useEffect(() => {
    if (!started || !ctx.current) return;
    if (alarms.length && now >= snoozeUntil && Math.floor(now / 1000) % 4 === 0) beep(ctx.current, ALARM);
  }, [now, started, alarms.length, snoozeUntil]);
  useEffect(() => {
    const ids = new Set(trips.map((t) => t.id));
    if (known.current && started && ctx.current && [...ids].some((id) => !known.current!.has(id))) beep(ctx.current, CHIME);
    known.current = ids;
  }, [trips, started]);

  async function start() {
    try { ctx.current = new (window.AudioContext || (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext)(); beep(ctx.current, CHIME); } catch { /* no sound */ }
    try { await document.documentElement.requestFullscreen?.(); } catch { /* not allowed */ }
    try { await (navigator as unknown as { wakeLock?: { request: (t: string) => Promise<unknown> } }).wakeLock?.request('screen'); } catch { /* screen may sleep */ }
    setStarted(true);
  }

  const date = new Date(now).toLocaleDateString('th-TH', { weekday: 'long', day: 'numeric', month: 'long', timeZone: 'Asia/Bangkok' });
  const clock = new Date(now).toLocaleTimeString('th-TH', { hour: '2-digit', minute: '2-digit', second: '2-digit', timeZone: 'Asia/Bangkok' });
  const snoozed = now < snoozeUntil;

  return (
    <div className={`tv ${alarms.length ? 'tv-alarm' : ''}`}>
      <header className="tv-head">
        <div className="tv-clock">{clock}</div>
        <div className="tv-date">{date}<span>จุดนัดรับขากลับ: {meetingPoint}</span></div>
        <div className="tv-sum">
          <span className="n-alarm">{alarms.length}<small>ต้องรีบ</small></span>
          <span className="n-soon">{rows.filter((r) => r.kind === 'soon').length}<small>ใกล้ถึงเวลา</small></span>
          <span className="n-moving">{rows.filter((r) => r.kind === 'moving').length}<small>กำลังวิ่ง</small></span>
        </div>
        {started && alarms.length > 0 && (
          <button type="button" className="tv-snooze" onClick={() => setSnoozeUntil(snoozed ? 0 : Date.now() + 2 * 60_000)}>
            {snoozed ? `🔇 ปิดเสียงอยู่ (${Math.ceil((snoozeUntil - now) / 1000)} วิ) · แตะเพื่อเปิด` : '🔇 ปิดเสียง 2 นาที'}
          </button>
        )}
      </header>

      {stale && <div className="tv-stale">⚠️ ข้อมูลไม่อัปเดตมากกว่า 1 นาที ตรวจอินเทอร์เน็ตของจอนี้</div>}

      {alarms.length > 0 && <div className="tv-banner">⚠️ ถึงเวลาแล้ว ยังไม่มีคนรับงาน {alarms.length} งาน · กดรับงานในมือถือ</div>}

      <main className="tv-list">
        {rows.length === 0 && <div className="tv-empty">✓ ไม่มีงานรับส่งใน 24 ชั่วโมงข้างหน้า</div>}
        {rows.slice(0, max).map(({ t, kind, text }) => {
          const to = t.direction === 'to_airport';
          const time = to ? (t.pickup_at ? hm(Date.parse(t.pickup_at)) : '--:--') : t.called_at ? hm(Date.parse(t.called_at)) : t.landing_at ? hm(Date.parse(t.landing_at)) : t.pickup_at ? hm(Date.parse(t.pickup_at)) : '--:--';
          return (
            <section key={t.id} className={`tv-row k-${kind}`}>
              <div className="tv-time">{time}<small>{to ? 'เวลารับที่ลาน' : t.called_at ? 'เวลาเรียกรถ' : t.landing_at ? 'เวลาเครื่องลง' : 'เวลารับ'}</small></div>
              <div className="tv-dir">{to ? '🛫' : '🛬'}<small>{to ? 'ส่งสนามบิน' : 'รับกลับ'}</small></div>
              <div className="tv-who">
                <b>{t.bookings?.customers?.name ?? '-'}</b> <span className="tv-code">{t.bookings?.code}</span>
                <div className="tv-meta">👤 {t.pax} คน{t.large_bags ? ` · 🧳 ${t.large_bags} ใบ` : ''}{t.flight_number ? ` · ✈ ${t.flight_number}` : ''}{to && t.drop_door ? ` · ประตู ${t.drop_door}` : ''}</div>
              </div>
              <div className="tv-car">
                {t.vehicles?.name ? <b>{t.vehicles.name}</b> : <b className="no-car">ยังไม่มีรถ</b>}
                <small>{t.driver?.display_name ? `คนขับ: ${name(t.driver.display_name)}` : 'ยังไม่มีคนรับงาน'}</small>
              </div>
              <div className="tv-state">{text}</div>
            </section>
          );
        })}
        {rows.length > max && (() => {
          // everything after the big rows: compact cards in time order, so the team can get ready for the day ahead
          const rest = rows.slice(max).sort((a, b) => a.at - b.at);
          const today = dayKey(now);
          return (
            <div className="tv-ahead">
              <div className="tv-ahead-head">งานถัดไปใน 24 ชั่วโมง <b>{rest.length} งาน</b>
                <span>ส่งสนามบิน {rest.filter((r) => r.t.direction === 'to_airport').length} · รับกลับ {rest.filter((r) => r.t.direction === 'from_airport').length}</span></div>
              <div className="tv-ahead-grid">
                {rest.map(({ t, kind, at }) => (
                  <div key={t.id} className={`tv-mini k-${kind}`}>
                    <span className="m-time">{dayKey(at) > today ? <em>พรุ่งนี้</em> : dayKey(at) < today ? <em>เมื่อวาน</em> : null}{hm(at)}</span>
                    <span className="m-dir">{t.direction === 'to_airport' ? '🛫 ส่ง' : '🛬 รับ'}</span>
                    <span className="m-who">{t.bookings?.customers?.name ?? '-'}</span>
                    <span className="m-meta">{t.pax} คน{t.large_bags ? ` · 🧳${t.large_bags}` : ''} · {t.vehicles?.name ?? <b className="no-car">ไม่มีรถ</b>}</span>
                  </div>
                ))}
              </div>
            </div>
          );
        })()}
      </main>

      <footer className="tv-foot">อัปเดตอัตโนมัติทุก 15 วินาที · {started ? (ctx.current ? '🔔 เปิดเสียงแจ้งเตือนแล้ว' : 'อุปกรณ์นี้ไม่รองรับเสียง') : 'ยังไม่เปิดเสียง'}</footer>

      {!started && (
        <button type="button" className="tv-start" onClick={start}>
          <span>▶</span>
          <b>แตะเพื่อเริ่มจองานรับส่ง</b>
          <small>เปิดเสียงแจ้งเตือน และขยายเต็มจอ (ต้องแตะ 1 ครั้งทุกครั้งที่เปิดหน้านี้)</small>
        </button>
      )}
    </div>
  );
}
