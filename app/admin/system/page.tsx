import Link from 'next/link';
import { db } from '@/lib/supabase';
import { runChecks, type Level } from '@/lib/monitor';

export const dynamic = 'force-dynamic';

const LV: Record<Level, [string, string]> = { ok: ['ปกติ', 'sys-ok'], warn: ['ควรดู', 'sys-warn'], error: ['มีปัญหา', 'sys-err'] };
const t = (ts: string) => new Date(ts).toLocaleString('th-TH', { timeZone: 'Asia/Bangkok', day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' });

export default async function SystemPage() {
  const sb = db();
  const checks = await runChecks();
  const since = new Date(Date.now() - 24 * 3600_000).toISOString();
  const [{ data: pings }, { data: events }, { data: status }] = await Promise.all([
    sb.from('uptime_pings').select('at, ok, status, ms, error, done').gte('at', since).order('at'),
    sb.from('system_events').select('id, at, kind, level, message').neq('level', 'info').order('at', { ascending: false }).limit(40),
    sb.from('system_status').select('checked_at').order('checked_at', { ascending: false }).limit(1),
  ]);
  const overall: Level = checks.some((c) => c.level === 'error') ? 'error' : checks.some((c) => c.level === 'warn') ? 'warn' : 'ok';

  // 24 hours in 10-minute slots (a ping every 5 minutes, so a gray slot means no answer at all)
  const slots: { at: number; state: 'ok' | 'down' | 'none' }[] = [];
  const start = Date.now() - 24 * 3600_000;
  for (let i = 0; i < 144; i++) slots.push({ at: start + i * 600_000, state: 'none' });
  for (const p of pings ?? []) {
    if (!p.done) continue;
    const i = Math.floor((Date.parse(p.at) - start) / 600_000);
    if (i >= 0 && i < 144) slots[i].state = p.ok ? (slots[i].state === 'down' ? 'down' : 'ok') : 'down';
  }
  const lineQ = checks.find((c) => c.key === 'line_quota')?.detail as { used?: number; limit?: number; pct?: number } | undefined;
  const slip = checks.find((c) => c.key === 'slip')?.detail as { used?: number; limit?: number } | undefined;

  return (
    <main className="page">
      <header className="page-head">
        <div><h1>สถานะระบบ</h1><p>สำหรับทีม Dev · ตรวจสดทุกครั้งที่เปิดหน้า · ตัวตั้งเวลาตรวจล่าสุด {status?.[0] ? t(status[0].checked_at) : 'ยังไม่เคย'}</p></div>
        <Link href="/admin/system" className="b b-primary">ตรวจอีกครั้ง</Link>
      </header>

      <section className={`sys-banner ${LV[overall][1]}`}>
        <b>{overall === 'ok' ? '✓ ระบบทำงานปกติ' : overall === 'warn' ? '! มีเรื่องที่ควรดู' : '✕ มีปัญหาที่ต้องแก้'}</b>
        <span>{checks.filter((c) => c.level !== 'ok').map((c) => c.label).join(' · ') || 'ทุกส่วนปกติ'}</span>
      </section>

      <section className="sys-grid">
        {checks.map((c) => (
          <div key={c.key} className={`sys-card ${LV[c.level][1]}`}>
            <div className="sys-card-head"><b>{c.label}</b><span className="sys-pill">{LV[c.level][0]}</span></div>
            <p>{c.summary}</p>
            {c.key === 'line_quota' && lineQ?.limit ? <div className="sys-bar"><i style={{ width: `${Math.min(100, lineQ.pct ?? 0)}%` }} /></div> : null}
            {c.key === 'slip' && slip?.limit ? <div className="sys-bar"><i style={{ width: `${Math.min(100, Math.round(((slip.used ?? 0) / slip.limit) * 100))}%` }} /></div> : null}
            {c.key === 'cron' && Array.isArray((c.detail as { jobs?: unknown[] })?.jobs) && (
              <ul className="sys-jobs">{((c.detail as { jobs: { name: string; last_run: string | null; last_status: string | null }[] }).jobs).map((j) => (
                <li key={j.name}><code>{j.name}</code> · {j.last_run ? `รันล่าสุด ${t(j.last_run)}` : 'ยังไม่เคยรัน'}{j.last_status && j.last_status !== 'succeeded' ? ` · ${j.last_status}` : ''}</li>
              ))}</ul>
            )}
            {c.key === 'config' && <small className="hint">{String((c.detail as { env?: string })?.env ?? '')}{(c.detail as { commit?: string })?.commit ? ` · commit ${(c.detail as { commit?: string }).commit}` : ''}</small>}
          </div>
        ))}
      </section>

      <section className="panel">
        <h2>เว็บไซต์ออนไลน์ 24 ชม. ล่าสุด</h2>
        <p className="hint">Supabase เรียกเว็บทุก 5 นาที · เขียว = ตอบปกติ · แดง = เรียกไม่ได้ · เทา = ไม่มีข้อมูล</p>
        <div className="uptime">{slots.map((s, i) => <i key={i} className={`u-${s.state}`} title={`${new Date(s.at).toLocaleTimeString('th-TH', { timeZone: 'Asia/Bangkok', hour: '2-digit', minute: '2-digit' })} ${s.state === 'ok' ? 'ปกติ' : s.state === 'down' ? 'ล่ม' : 'ไม่มีข้อมูล'}`} />)}</div>
        <div className="uptime-axis"><span>24 ชม.ที่แล้ว</span><span>12 ชม.</span><span>ตอนนี้</span></div>
      </section>

      <div className="cols">
        <section className="panel">
          <h2>เหตุการณ์ล่าสุด</h2>
          {!events?.length ? <p className="empty">ไม่มีข้อผิดพลาด</p> : (
            <ul className="sys-events">{events.map((e) => (
              <li key={e.id} className={e.level === 'error' ? 'err' : 'warn'}><span>{t(e.at)}</span><b>{e.kind}</b>{e.message}</li>
            ))}</ul>
          )}
        </section>
        <section className="panel">
          <h2>ตั้งค่าครั้งแรก</h2>
          <ol className="sys-setup">
            <li>Supabase → Database → Extensions เปิด <code>pg_cron</code> และ <code>pg_net</code></li>
            <li>SQL Editor รัน <code>{`select monitor_schedule('https://<โดเมน>', '<CRON_SECRET>');`}</code></li>
            <li>(ไม่บังคับ) ให้ระบบส่ง LINE เตือนเมื่อมีปัญหา: ใส่ <code>ALERT_LINE_USER_IDS</code> ใน Vercel เป็น LINE user id ของ Dev/เจ้าของ คั่นด้วย ,</li>
            <li>แนะนำ: ตั้งตัวตรวจภายนอก (n8n หรือ UptimeRobot) เรียก <code>/api/health</code> ทุก 5 นาที เพื่อให้รู้ทันทีตอนเว็บล่ม เพราะตอน Vercel ล่ม หน้านี้ก็เปิดไม่ได้</li>
          </ol>
        </section>
      </div>
    </main>
  );
}
