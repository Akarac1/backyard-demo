import 'server-only';
import { db } from './supabase';

export type Level = 'ok' | 'warn' | 'error';
export type Check = { key: string; label: string; level: Level; summary: string; detail?: Record<string, unknown> };

const worst = (...l: Level[]): Level => (l.includes('error') ? 'error' : l.includes('warn') ? 'warn' : 'ok');
const bkkMonthStart = () => `${new Date().toLocaleString('sv-SE', { timeZone: 'Asia/Bangkok' }).slice(0, 8)}01T00:00:00+07:00`;
const minsAgo = (ts: string | null | undefined) => (ts ? Math.round((Date.now() - Date.parse(ts)) / 60000) : null);

async function lineGet(path: string): Promise<Record<string, unknown> | null> {
  const t = process.env.LINE_CHANNEL_ACCESS_TOKEN;
  if (!t) return null;
  const r = await fetch(`https://api.line.me/v2/bot${path}`, { headers: { Authorization: `Bearer ${t}` }, cache: 'no-store' });
  return r.ok ? r.json() : null;
}

/** Every check for the status page. Each one is guarded so one failure never hides the others. */
export async function runChecks(): Promise<Check[]> {
  const sb = db();
  const out: Check[] = [];
  const guard = async (key: string, label: string, fn: () => Promise<Omit<Check, 'key' | 'label'>>) => {
    try { out.push({ key, label, ...(await fn()) }); }
    catch (e) { out.push({ key, label, level: 'error', summary: `ตรวจไม่ได้: ${String(e).slice(0, 160)}` }); }
  };

  // 1. database
  await guard('db', 'ฐานข้อมูล (Supabase)', async () => {
    const t0 = Date.now();
    const { error } = await sb.from('settings').select('id').eq('id', 1).single();
    const ms = Date.now() - t0;
    if (error) return { level: 'error', summary: `เชื่อมต่อไม่ได้: ${error.message}` };
    const { data: st } = await sb.rpc('monitor_db_stats');
    const s = (Array.isArray(st) ? st[0] : st) as { db_bytes: number; bookings: number; customers: number } | undefined;
    const mb = s ? Math.round(Number(s.db_bytes) / 1048576) : null;
    const limit = Number(process.env.SUPABASE_DB_LIMIT_MB ?? 500);
    const pct = mb != null ? Math.round((mb / limit) * 100) : 0;
    return {
      level: worst(ms > 2000 ? 'warn' : 'ok', pct >= 90 ? 'error' : pct >= 75 ? 'warn' : 'ok'),
      summary: `ตอบใน ${ms} ms · ขนาด ${mb ?? '?'} MB จาก ${limit} MB (${pct}%)`,
      detail: { ms, mb, limit, bookings: s?.bookings, customers: s?.customers },
    };
  });

  // 2. LINE OA quota
  await guard('line_quota', 'โควตาข้อความ LINE OA', async () => {
    if (!process.env.LINE_CHANNEL_ACCESS_TOKEN) return { level: 'warn', summary: 'ยังไม่ได้ตั้ง LINE_CHANNEL_ACCESS_TOKEN' };
    const [q, c] = await Promise.all([lineGet('/message/quota'), lineGet('/message/quota/consumption')]);
    if (!q || !c) return { level: 'error', summary: 'เรียก LINE API ไม่สำเร็จ (token อาจหมดอายุหรือผิด)' };
    const used = Number(c.totalUsage ?? 0);
    if (q.type !== 'limited') return { level: 'ok', summary: `ส่งไปแล้ว ${used.toLocaleString('th-TH')} ข้อความเดือนนี้ (ไม่จำกัด)`, detail: { used } };
    const limit = Number(q.value ?? 0);
    const pct = limit ? Math.round((used / limit) * 100) : 0;
    return {
      level: pct >= 100 ? 'error' : pct >= 80 ? 'warn' : 'ok',
      summary: `ใช้ไป ${used.toLocaleString('th-TH')} จาก ${limit.toLocaleString('th-TH')} ข้อความ (${pct}%)`,
      detail: { used, limit, pct },
    };
  });

  // 3. LINE send failures
  await guard('line_fail', 'การส่งข้อความ LINE', async () => {
    const since = new Date(Date.now() - 24 * 3600_000).toISOString();
    const { count } = await sb.from('system_events').select('id', { count: 'exact', head: true }).eq('kind', 'line').eq('level', 'error').gte('at', since);
    const n = count ?? 0;
    return { level: n >= 5 ? 'error' : n > 0 ? 'warn' : 'ok', summary: n ? `ส่งไม่สำเร็จ ${n} ครั้งใน 24 ชม.` : 'ไม่มีข้อความที่ส่งไม่สำเร็จใน 24 ชม.', detail: { failed24h: n } };
  });

  // 4. slip checks used this month
  await guard('slip', 'ตรวจสลิปอัตโนมัติ (EasySlip)', async () => {
    const provider = process.env.SLIP_PROVIDER ?? 'mock';
    if (provider === 'mock') return { level: 'warn', summary: 'โหมดทดลอง (SLIP_PROVIDER=mock) ไม่ได้ตรวจสลิปจริง' };
    const month = bkkMonthStart();
    const since = new Date(Date.now() - 24 * 3600_000).toISOString();
    const [{ count: used }, { count: errs }] = await Promise.all([
      sb.from('system_events').select('id', { count: 'exact', head: true }).eq('kind', 'slip').gte('at', month),
      sb.from('system_events').select('id', { count: 'exact', head: true }).eq('kind', 'slip').eq('level', 'error').gte('at', since),
    ]);
    const limit = Number(process.env.EASYSLIP_MONTHLY_QUOTA ?? 1000);
    const pct = Math.round(((used ?? 0) / limit) * 100);
    return {
      level: worst(pct >= 100 ? 'error' : pct >= 80 ? 'warn' : 'ok', (errs ?? 0) >= 3 ? 'error' : (errs ?? 0) > 0 ? 'warn' : 'ok'),
      summary: `ใช้ไป ${used ?? 0} จาก ${limit} ครั้งเดือนนี้ (${pct}%)${errs ? ` · เรียกบริการผิดพลาด ${errs} ครั้งใน 24 ชม.` : ''}`,
      detail: { used, limit, errors24h: errs },
    };
  });

  // 5. website uptime, seen from Supabase every 5 minutes
  await guard('uptime', 'เว็บไซต์ (Vercel)', async () => {
    await sb.rpc('uptime_collect').then(() => null, () => null);
    const since = new Date(Date.now() - 24 * 3600_000).toISOString();
    const { data } = await sb.from('uptime_pings').select('at, ok, status, ms, error').eq('done', true).gte('at', since).order('at', { ascending: false }).limit(400);
    const rows = data ?? [];
    if (!rows.length) return { level: 'warn', summary: 'ยังไม่มีข้อมูล · ต้องเริ่มตัวตั้งเวลาด้วย monitor_schedule() (ดูวิธีด้านล่าง)' };
    const ok = rows.filter((r) => r.ok).length;
    const pct = Math.round((ok / rows.length) * 1000) / 10;
    const last = rows[0];
    const lastDown = rows.find((r) => !r.ok);
    const age = minsAgo(last.at);
    return {
      level: worst(!last.ok ? 'error' : 'ok', pct < 99 ? 'warn' : 'ok', age != null && age > 15 ? 'warn' : 'ok'),
      summary: `${last.ok ? 'ปกติ' : 'ล่าสุดเรียกไม่ได้'} · ออนไลน์ ${pct}% ใน 24 ชม.${lastDown ? ` · ล่มล่าสุด ${new Date(lastDown.at).toLocaleString('th-TH', { timeZone: 'Asia/Bangkok', dateStyle: 'short', timeStyle: 'short' })}` : ''}${age != null && age > 15 ? ` · ไม่ได้ตรวจมา ${age} นาที` : ''}`,
      detail: { pct, checks: rows.length, lastMs: last.ms },
    };
  });

  // 6. scheduled jobs
  await guard('cron', 'งานตั้งเวลา (pg_cron)', async () => {
    const { data: st } = await sb.rpc('monitor_db_stats');
    const s = (Array.isArray(st) ? st[0] : st) as { pending_overdue: number; cron_jobs: { name: string; active: boolean; last_run: string | null; last_status: string | null; last_error: string | null }[] } | undefined;
    const jobs = s?.cron_jobs ?? [];
    const overdue = Number(s?.pending_overdue ?? 0);
    const want = ['backyard_expire_holds', 'backyard_welcome', 'backyard_monitor'];
    const missing = want.filter((w) => !jobs.some((j) => j.name === w && j.active));
    const failed = jobs.filter((j) => j.last_status && j.last_status !== 'succeeded');
    const stale = jobs.filter((j) => { const m = minsAgo(j.last_run); return j.active && m != null && m > 15; });
    const parts = [
      missing.length ? `ยังไม่ได้ตั้ง: ${missing.join(', ')}` : '',
      failed.length ? `รันล่าสุดผิดพลาด: ${failed.map((j) => j.name).join(', ')}` : '',
      stale.length ? `ไม่ได้รันเกิน 15 นาที: ${stale.map((j) => j.name).join(', ')}` : '',
      overdue ? `มีการจองหมดเวลาแต่ยังไม่ถูกปิด ${overdue} รายการ` : '',
    ].filter(Boolean);
    return {
      level: failed.length || stale.length ? 'error' : missing.length || overdue ? 'warn' : 'ok',
      summary: parts.length ? parts.join(' · ') : `ทำงานปกติ ${jobs.length} งาน`,
      detail: { jobs },
    };
  });

  // 7. work waiting too long
  await guard('queue', 'งานค้าง', async () => {
    const t30 = new Date(Date.now() - 30 * 60_000).toISOString();
    const t15 = new Date(Date.now() - 15 * 60_000).toISOString();
    const [{ count: slips }, { count: calls }, { count: notes }] = await Promise.all([
      sb.from('payments').select('id', { count: 'exact', head: true }).eq('status', 'pending').not('slip_path', 'is', null).lt('created_at', t30),
      sb.from('shuttle_trips').select('id', { count: 'exact', head: true }).not('called_at', 'is', null).lt('called_at', t15).not('status', 'in', '(en_route,arrived,done,cancelled)'),
      sb.from('shuttle_trips').select('id', { count: 'exact', head: true }).not('driver_note', 'is', null).eq('note_resolved', false),
    ]);
    const parts = [slips ? `สลิปรอตรวจเกิน 30 นาที ${slips}` : '', calls ? `ลูกค้าเรียกรถแล้วยังไม่มีคนขับรับเกิน 15 นาที ${calls}` : '', notes ? `คนขับแจ้งปัญหายังไม่รับทราบ ${notes}` : ''].filter(Boolean);
    return { level: calls ? 'error' : parts.length ? 'warn' : 'ok', summary: parts.length ? parts.join(' · ') : 'ไม่มีงานค้าง', detail: { slips, calls, notes } };
  });

  // 8. configuration
  await guard('config', 'การตั้งค่า (Environment)', async () => {
    const need: [string, boolean][] = [
      ['LINE_CHANNEL_ACCESS_TOKEN', true], ['LINE_CHANNEL_SECRET', true], ['NEXT_PUBLIC_LIFF_ID', true], ['LINE_LOGIN_CHANNEL_ID', true],
      ['SESSION_SECRET', true], ['CRON_SECRET', true], ['PROMPTPAY_ID', true], ['NEXT_PUBLIC_BASE_URL', true], ['EASYSLIP_API_KEY', false],
    ];
    const missing = need.filter(([k]) => !process.env[k]).map(([k, req]) => (req ? k : `${k} (ถ้าใช้)`));
    const demo = process.env.DEMO_MODE === 'true';
    return {
      level: demo ? 'error' : missing.length ? 'warn' : 'ok',
      summary: [demo ? 'DEMO_MODE เปิดอยู่ (ห้ามใช้งานจริง)' : '', missing.length ? `ยังไม่ได้ตั้ง: ${missing.join(', ')}` : ''].filter(Boolean).join(' · ') || 'ตั้งค่าครบ',
      detail: { env: process.env.VERCEL_ENV ?? 'local', commit: process.env.VERCEL_GIT_COMMIT_SHA?.slice(0, 7) ?? null, region: process.env.VERCEL_REGION ?? null },
    };
  });

  return out;
}

/** Save results; return the checks that just turned bad (for alerts). */
export async function saveChecks(checks: Check[]): Promise<Check[]> {
  const sb = db();
  const { data: prev } = await sb.from('system_status').select('key, level');
  const before = new Map((prev ?? []).map((p) => [p.key, p.level as Level]));
  const now = new Date().toISOString();
  const worse: Check[] = [];
  for (const c of checks) {
    const old = before.get(c.key);
    const changed = old !== c.level;
    if (changed && c.level === 'error') worse.push(c);
    await sb.from('system_status').upsert({ key: c.key, level: c.level, summary: c.summary, detail: c.detail ?? null, checked_at: now, ...(changed ? { changed_at: now } : {}) });
    if (changed && old) await sb.from('system_events').insert({ kind: 'monitor', level: c.level === 'ok' ? 'info' : c.level, message: `${c.label}: ${c.level === 'ok' ? 'กลับมาปกติ' : c.summary}` });
  }
  return worse;
}
