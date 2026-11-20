#!/usr/bin/env node
// Backyard LPR bridge: keeps the NVR plate allow list in step with confirmed bookings.
// Runs on a computer on the same LAN as the NVR. It only makes outbound HTTPS calls to the web app.
//   node bridge.mjs probe            read-only check of the NVR API (no changes)
//   node bridge.mjs selftest         add/change/remove ONE test row to prove write access
//   node bridge.mjs once             show what would change (dry run)
//   node bridge.mjs once --apply     make the changes once
//   node bridge.mjs run --apply      keep doing it every POLL_SECONDS
// Needs Node 20+. No packages to install.
import { createHash, randomBytes } from 'node:crypto';
import { readFileSync, existsSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));
const envFile = join(here, '.env');
if (existsSync(envFile)) {
  for (const line of readFileSync(envFile, 'utf8').split(/\r?\n/)) {
    const m = line.match(/^\s*([A-Z_]+)\s*=\s*(.*?)\s*$/);
    if (m && !(m[1] in process.env)) process.env[m[1]] = m[2].replace(/\s+#.*$/, '').trim().replace(/^["']|["']$/g, ''); // an inline "  # comment" is not part of the value
  }
}
const cfg = {
  site: (process.env.SITE_URL ?? '').replace(/\/$/, ''),
  key: process.env.LPR_BRIDGE_KEY ?? '',
  nvr: (process.env.NVR_URL ?? 'http://192.168.1.100').replace(/\/$/, ''),
  user: process.env.NVR_USER ?? '',
  pass: process.env.NVR_PASS ?? '',
  list: process.env.NVR_LIST_NAME ?? 'TrafficRedList',
  poll: Number(process.env.POLL_SECONDS ?? 120),
  maxChanges: Number(process.env.MAX_CHANGES ?? 10),
  maxDeletes: Number(process.env.MAX_DELETES ?? 5),
};
const TAG = 'BY-';
const log = (...a) => console.log(new Date().toLocaleString('sv-SE'), ...a);

// ---------- Digest auth (Dahua uses it on /cgi-bin) ----------
const md5 = (s) => createHash('md5').update(s).digest('hex');
async function nvrFetch(path) {
  const url = `${cfg.nvr}${path}`;
  const first = await fetch(url, { signal: AbortSignal.timeout(10000) });
  if (first.status !== 401) return first;
  const h = first.headers.get('www-authenticate') ?? '';
  const p = Object.fromEntries([...h.matchAll(/(\w+)="?([^",]+)"?/g)].map((m) => [m[1], m[2]]));
  const uri = new URL(url).pathname + new URL(url).search;
  const nc = '00000001', cnonce = randomBytes(8).toString('hex');
  const ha1 = md5(`${cfg.user}:${p.realm}:${cfg.pass}`);
  const ha2 = md5(`GET:${uri}`);
  const response = p.qop ? md5(`${ha1}:${p.nonce}:${nc}:${cnonce}:auth:${ha2}`) : md5(`${ha1}:${p.nonce}:${ha2}`);
  const auth = `Digest username="${cfg.user}", realm="${p.realm}", nonce="${p.nonce}", uri="${uri}", response="${response}"` +
    (p.qop ? `, qop=auth, nc=${nc}, cnonce="${cnonce}"` : '') + (p.opaque ? `, opaque="${p.opaque}"` : '');
  return fetch(url, { headers: { Authorization: auth }, signal: AbortSignal.timeout(10000) });
}
const q = (o) => Object.entries(o).map(([k, v]) => `${k}=${encodeURIComponent(v)}`).join('&');

// ---------- NVR adapter (Dahua HTTP API). Confirm with `probe` before using --apply. ----------
const dahuaTime = (d, end) => `${d} ${end ? '23:59:59' : '00:00:00'}`;
let lastKeys = [];
let lastInsert = '';
const nvr = {
  async list() {
    const r = await nvrFetch(`/cgi-bin/recordFinder.cgi?${q({ action: 'find', name: cfg.list, count: 5000 })}`);
    const t = await r.text();
    if (r.status !== 200) throw new Error(`NVR list HTTP ${r.status}`);
    const rows = new Map();
    for (const m of t.matchAll(/^records\[(\d+)\]\.(\w+)=(.*)$/gm)) {
      const row = rows.get(m[1]) ?? {};
      row[m[2]] = m[3].trim();
      rows.set(m[1], row);
    }
    lastKeys = [...new Set([...rows.values()].flatMap((x) => Object.keys(x)))];
    return [...rows.values()].map((x) => ({
      recno: x.RecNo, plate: x.PlateNumber ?? '', owner: x.MasterOfCar ?? '', begin: x.BeginTime ?? '', end: x.CancelTime ?? '',
    }));
  },
  async insert(p) {
    const r = await nvrFetch(`/cgi-bin/recordUpdater.cgi?${q({ action: 'insert', name: cfg.list, PlateNumber: p.plate, PlateType: 'white', MasterOfCar: p.owner, BeginTime: dahuaTime(p.from), CancelTime: dahuaTime(p.to, true) })}`);
    const t = await r.text();
    lastInsert = `HTTP ${r.status} ${t.trim().slice(0, 200)}`;
    if (r.status !== 200 || /error/i.test(t)) throw new Error(`insert ${p.plate}: ${lastInsert}`);
  },
  // The NVR ignores 'update' (it answers OK and changes nothing), so a change is remove + insert.
  async update(recno, p) {
    await this.remove(recno, p.plate);
    await this.insert(p);
  },
  async remove(recno, plate) {
    const r = await nvrFetch(`/cgi-bin/recordUpdater.cgi?${q({ action: 'remove', name: cfg.list, recno })}`);
    const t = await r.text();
    if (r.status !== 200 || /error/i.test(t)) throw new Error(`remove ${plate}: HTTP ${r.status} ${t.slice(0, 80)}`);
  },
};

// ---------- web app ----------
async function site(path, init) {
  const r = await fetch(`${cfg.site}${path}`, { ...init, headers: { Authorization: `Bearer ${cfg.key}`, 'content-type': 'application/json' }, signal: AbortSignal.timeout(20000) });
  if (!r.ok) throw new Error(`${path} HTTP ${r.status}`);
  return r.json();
}

// ---------- the sync ----------
const norm = (t) => (t ?? '').slice(0, 10); // "2026-11-20 00:00:00" -> "2026-11-20"
async function sync(apply) {
  const { snapshot_at, plates, invalid = [] } = await site('/api/lpr/desired');
  for (const p of plates) while (Buffer.byteLength(p.owner) > 15) p.owner = p.owner.slice(0, -1); // the NVR API rejects an Owner over 15 bytes
  const rows = await nvr.list();
  const mine = rows.filter((r) => r.owner.startsWith(TAG));
  const others = new Map(rows.filter((r) => !r.owner.startsWith(TAG)).map((r) => [r.plate, r]));
  const have = new Map(mine.map((r) => [r.plate, r]));
  const want = new Map(plates.map((p) => [p.plate, p]));
  const today = new Date().toLocaleDateString('sv-SE', { timeZone: 'Asia/Bangkok' });

  const add = [], upd = [], del = [], skipped = [];
  for (const p of plates) {
    if (others.has(p.plate)) { skipped.push(p.plate); continue; } // a row the team made: never touch it
    const cur = have.get(p.plate);
    if (!cur) add.push(p);
    else if (cur.owner !== p.owner || norm(cur.begin) !== p.from || norm(cur.end) !== p.to) upd.push([cur, p]);
  }
  for (const r of mine) {
    // gone from the desired list: remove, but keep rows that ended less than 2 days ago (cheap safety margin)
    if (!want.has(r.plate) && norm(r.end) < new Date(Date.parse(today) - 2 * 86400000).toISOString().slice(0, 10)) del.push(r);
    else if (!want.has(r.plate) && norm(r.end) >= today) del.push(r); // cancelled before it ended
  }
  const summary = { desired: plates.length, nvr_rows: rows.length, nvr_mine: mine.length, add: add.length, update: upd.length, remove: del.length, skipped_manual: skipped.length, invalid_plates: invalid.length };
  log('plan', JSON.stringify(summary));
  for (const p of add) log(' + add', p.plate, p.from, '->', p.to, p.owner);
  for (const [, p] of upd) log(' ~ update', p.plate, p.from, '->', p.to);
  for (const r of del) log(' - remove', r.plate, r.begin, '->', r.end);
  for (const s of skipped) log(' ! skip (team-managed row exists)', s);
  for (const i of invalid) log(' ? not a Thai plate, not sent to the NVR: booking', i.code, JSON.stringify(i.plate));

  if (!apply) { log('dry run: nothing changed. Add --apply to do it.'); return { ok: true, summary, snapshot_at, dry: true }; }
  if (add.length + upd.length + del.length > cfg.maxChanges) throw new Error(`too many changes (${add.length + upd.length + del.length} > MAX_CHANGES=${cfg.maxChanges}); raise MAX_CHANGES in .env after checking the plan`);
  if (del.length > cfg.maxDeletes) throw new Error(`too many removals (${del.length} > MAX_DELETES=${cfg.maxDeletes}); check the plan, then raise MAX_DELETES`);
  const errors = [];
  const step = async (fn) => { try { await fn(); } catch (e) { errors.push(String(e.message ?? e)); } };
  for (const p of add) await step(() => nvr.insert(p));
  for (const [cur, p] of upd) await step(() => nvr.update(cur.recno, p));
  for (const r of del) await step(() => nvr.remove(r.recno, r.plate));
  if (errors.length) throw new Error(errors.slice(0, 3).join(' | '));
  return { ok: true, summary, snapshot_at };
}

async function report(body) {
  try { await site('/api/lpr/report', { method: 'POST', body: JSON.stringify(body) }); } catch (e) { log('report failed:', e.message); }
}

async function probe() {
  log('NVR', cfg.nvr, 'list name', cfg.list);
  const a = await nvrFetch('/cgi-bin/magicBox.cgi?action=getDeviceType');
  log('getDeviceType ->', a.status, (await a.text()).trim().slice(0, 60));
  try { const rows = await nvr.list(); log('list ->', rows.length, 'rows,', rows.filter((r) => r.owner.startsWith(TAG)).length, 'made by this system'); }
  catch (e) { log('list failed:', e.message); }
  log('If list failed, the list name or API differs on this NVR: tell Claude the HTTP status above.');
}

// Write test on ONE throw-away row (owner BY-SELFTEST): add, read back, change, remove. Touches nothing else.
async function selftest() {
  const t = { plate: 'ทดสอบ9999', owner: 'BY-SELFTEST', from: new Date().toLocaleDateString('sv-SE', { timeZone: 'Asia/Bangkok' }), to: '2030-01-01' };
  const find = async () => (await nvr.list()).find((r) => r.plate === t.plate);
  // the NVR list can take a few seconds to show a write: look every second for up to 15 s
  const until = async (ok) => { let r; for (let i = 0; i < 15; i++) { r = await find(); if (ok(r)) return r; await new Promise((x) => setTimeout(x, 1000)); } return r; };
  let before = await nvr.list();
  log('fields the NVR returns:', lastKeys.join(', '));
  const wait = () => new Promise((r) => setTimeout(r, 2500)); // the NVR list can lag a moment behind a write
  for (const old of before.filter((r) => r.plate === t.plate)) {
    if (old.owner !== t.owner) throw new Error('a row with the test plate exists but is not BY-SELFTEST: not touching it');
    await nvr.remove(old.recno, t.plate); log('removed leftover test row recno', old.recno);
  }
  await wait();
  before = await nvr.list();
  let row;
  try {
    await nvr.insert(t); row = await until((r) => !!r);
    log('insert reply:', lastInsert, '| rows now:', (await nvr.list()).length);
    if (!row) { const r = await nvrFetch(`/cgi-bin/recordFinder.cgi?${q({ action: 'find', name: cfg.list, 'condition.PlateNumber': t.plate })}`); log('find by plate ->', r.status, (await r.text()).replace(/\s+/g, ' ').slice(0, 300)); }
    log('1 insert ->', row ? `ok (recno ${row.recno}, owner ${row.owner}, ${row.begin} -> ${row.end})` : 'NOT FOUND');
    if (!row) throw new Error('insert did not appear in list');
    await nvr.update(row.recno, { ...t, to: '2030-01-02' }); row = await until((r) => !!r && norm(r.end) === '2030-01-02');
    log('2 update ->', row && norm(row.end) === '2030-01-02' ? 'ok' : `unexpected ${row?.end}`);
  } finally {
    const r = await until((x) => !!x);
    if (r) { await nvr.remove(r.recno, t.plate); log('3 remove ->', (await until((x) => !x)) ? 'STILL THERE: delete BY-SELFTEST in the NVR by hand' : 'ok'); }
  }
  const after = await nvr.list();
  log('rows before/after:', before.length, after.length, before.length === after.length ? '(unchanged, good)' : '(DIFFERENT: check the NVR)');
}

// Shows how the NVR formats one existing row (plate and owner left out) so insert can copy it.
async function sample() {
  const r = await nvrFetch(`/cgi-bin/recordFinder.cgi?${q({ action: 'find', name: cfg.list, count: 3 })}`);
  const t = await r.text();
  const out = t.split(/\r?\n/).filter((l) => !/\.(PlateNumber|MasterOfCar)=/.test(l)).slice(0, 20);
  log('HTTP', r.status); console.log(out.join('\n'));
}

// Which Owner texts does the NVR accept? Tries several on ONE throw-away plate and removes it each time.
async function ownertest() {
  const base = { plate: 'ทดสอบ9998', from: new Date().toLocaleDateString('sv-SE', { timeZone: 'Asia/Bangkok' }), to: '2030-01-01' };
  const find = async () => (await nvr.list()).filter((r) => r.plate === base.plate);
  const until = async (ok) => { let r; for (let i = 0; i < 15; i++) { r = await find(); if (ok(r)) return r; await new Promise((x) => setTimeout(x, 1000)); } return r; };
  const cands = ['BY-AAAAAA 1234', 'BY-AAAAAA 12345', 'BY-AAAAAA 123456', 'BY-AAAAAA 1234567', 'BY-AAAAAA 12345678', 'BY-AAAAAA 123456789', 'BY-AAAAAA ก', 'BY-AAAAAA กข'];
  for (const owner of cands) {
    try { await nvr.insert({ ...base, owner }); log('OK     ', JSON.stringify(owner), `(${[...owner].length} chars, ${Buffer.byteLength(owner)} bytes)`); }
    catch (e) { log('FAILED ', JSON.stringify(owner), `(${[...owner].length} chars, ${Buffer.byteLength(owner)} bytes)`, e.message.split('\n')[0]); continue; }
    for (const r of await until((x) => x.length > 0)) await nvr.remove(r.recno, base.plate);
    await until((x) => x.length === 0);
  }
  log('done; if a row for ทดสอบ9998 is left in the NVR, delete it by hand');
}

const [cmd = 'once', ...flags] = process.argv.slice(2);
const apply = flags.includes('--apply');
for (const [k, v] of Object.entries({ SITE_URL: cfg.site, NVR_USER: cfg.user, NVR_PASS: cfg.pass, ...(cmd === 'probe' ? {} : { LPR_BRIDGE_KEY: cfg.key }) })) {
  if (!v) { console.error(`missing ${k} in .env`); process.exit(1); }
}
if (cmd === 'probe') await probe();
else if (cmd === 'ownertest') { try { await ownertest(); } catch (e) { log('ERROR', e.message); process.exitCode = 1; } }
else if (cmd === 'sample') await sample();
else if (cmd === 'selftest') { try { await selftest(); } catch (e) { log('ERROR', e.message); process.exitCode = 1; } }
else if (cmd === 'once') {
  try { const r = await sync(apply); if (apply) await report(r); } catch (e) { log('ERROR', e.message); if (apply) await report({ ok: false, error: e.message }); process.exitCode = 1; }
} else if (cmd === 'run') {
  for (;;) {
    try { const r = await sync(apply); if (apply) await report(r); } catch (e) { log('ERROR', e.message); if (apply) await report({ ok: false, error: e.message }); }
    await new Promise((r) => setTimeout(r, cfg.poll * 1000));
  }
} else { console.error('usage: node bridge.mjs probe | selftest | ownertest | once [--apply] | run --apply'); process.exit(1); }
