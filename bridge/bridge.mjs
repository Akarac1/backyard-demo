#!/usr/bin/env node
// Backyard LPR bridge: keeps the NVR plate allow list in step with confirmed bookings.
// Runs on a computer on the same LAN as the NVR. It only makes outbound HTTPS calls to the web app.
//   node bridge.mjs probe            read-only check of the NVR API (no changes)
//   node bridge.mjs selftest         add/change/remove ONE test row to prove write access
//   node bridge.mjs once             show what would change (dry run)
//   node bridge.mjs once --apply     make the changes once
//   node bridge.mjs run --apply      keep doing it every POLL_SECONDS
//   node bridge.mjs events [minutes] read-only: look for a pass-by (ANPR) log via the old
//                                    cgi-bin API (this NVR turned out not to have one there)
//   node bridge.mjs vehicles [minutes] read-only: same lookup via /RPC2 JSON-RPC, matching
//                                    this NVR's own "AI Search > Motor Vehicle" page — this
//                                    is the one that actually works on this hardware
// Needs Node 20+. No packages to install.
import { createHash, randomBytes } from 'node:crypto';
import { readFileSync, writeFileSync, existsSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { request as httpRequest } from 'node:http';
import { request as httpsRequest } from 'node:https';
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
  camIn: (process.env.CAM_IN_URL ?? 'http://192.168.1.101').replace(/\/$/, ''),
  camOut: (process.env.CAM_OUT_URL ?? 'http://192.168.1.102').replace(/\/$/, ''),
  camUser: process.env.CAM_USER || process.env.NVR_USER || '',
  camPass: process.env.CAM_PASS || process.env.NVR_PASS || '',
  poll: Number(process.env.POLL_SECONDS ?? 120),
  maxChanges: Number(process.env.MAX_CHANGES ?? 10),
  maxDeletes: Number(process.env.MAX_DELETES ?? 5),
};
const TAG = 'BY-';
const log = (...a) => console.log(new Date().toLocaleString('sv-SE'), ...a);

// ---------- Digest auth (Dahua uses it on /cgi-bin) ----------
const md5 = (s) => createHash('md5').update(s).digest('hex');
async function nvrFetch(path, dev = { base: cfg.nvr, user: cfg.user, pass: cfg.pass }) {
  const url = `${dev.base}${path}`;
  const first = await fetch(url, { signal: AbortSignal.timeout(10000) });
  if (first.status !== 401) return first;
  const h = first.headers.get('www-authenticate') ?? '';
  const p = Object.fromEntries([...h.matchAll(/(\w+)="?([^",]+)"?/g)].map((m) => [m[1], m[2]]));
  const uri = new URL(url).pathname + new URL(url).search;
  const nc = '00000001', cnonce = randomBytes(8).toString('hex');
  const ha1 = md5(`${dev.user}:${p.realm}:${dev.pass}`);
  const ha2 = md5(`GET:${uri}`);
  const response = p.qop ? md5(`${ha1}:${p.nonce}:${nc}:${cnonce}:auth:${ha2}`) : md5(`${ha1}:${p.nonce}:${ha2}`);
  const auth = `Digest username="${dev.user}", realm="${p.realm}", nonce="${p.nonce}", uri="${uri}", response="${response}"` +
    (p.qop ? `, qop=auth, nc=${nc}, cnonce="${cnonce}"` : '') + (p.opaque ? `, opaque="${p.opaque}"` : '');
  return fetch(url, { headers: { Authorization: auth }, signal: AbortSignal.timeout(10000) });
}
const q = (o) => Object.entries(o).map(([k, v]) => `${k}=${encodeURIComponent(v)}`).join('&');

// ---------- JSON-RPC (/RPC2) — this NVR's Motor Vehicle AI Search uses this, not the plain
// cgi-bin digest-auth API above. It has its own login handshake (separate from HTTP digest
// auth): call global.login twice (first gets a challenge, second sends a hashed password),
// then every further call carries the returned "session" token in the request body itself.
const up = (s) => createHash('md5').update(s).digest('hex').toUpperCase();
// Node's `fetch` (undici) is strict about HTTP response framing and some embedded devices
// (this NVR included — confirmed, it throws UND_ERR_SOCKET on /RPC2 POSTs) send responses
// that trip that strictness even though curl/a browser reads them fine. Node's older
// node:http/https client is far more lenient, so /RPC2 POSTs go through that instead.
function rawPost(urlStr, body) {
  return new Promise((resolve, reject) => {
    const u = new URL(urlStr);
    const lib = u.protocol === 'https:' ? httpsRequest : httpRequest;
    const data = JSON.stringify(body);
    const req = lib({
      hostname: u.hostname, port: u.port || (u.protocol === 'https:' ? 443 : 80), path: u.pathname + u.search,
      method: 'POST',
      headers: {
        'content-type': 'application/json', 'content-length': Buffer.byteLength(data),
        referer: `${u.origin}/`, origin: u.origin, connection: 'close',
      },
      timeout: 10000,
    }, (res) => {
      const chunks = [];
      res.on('data', (c) => chunks.push(c));
      res.on('end', () => resolve({ status: res.statusCode, text: Buffer.concat(chunks).toString('utf8') }));
      res.on('error', reject);
    });
    req.on('timeout', () => req.destroy(new Error('request timed out')));
    req.on('error', reject);
    req.write(data);
    req.end();
  });
}
async function rpcRaw(base, body) {
  const { status, text } = await rawPost(`${base}/RPC2`, body);
  let json; try { json = JSON.parse(text); } catch { json = null; }
  return { status, text, json };
}
let rpcId = 1000;
async function rpcLogin(dev) {
  // Call 1: no "session" field at all yet — just asks for the challenge.
  const first = await rpcRaw(dev.base, { method: 'global.login', params: { userName: dev.user, password: '', clientType: 'Web3.0' }, id: rpcId++ });
  const p = first.json?.params;
  const loginSession = first.json?.session; // the pre-auth session token to carry into call 2
  if (!p?.realm || !p?.random || !loginSession) return { ok: false, step: 'challenge', raw: first };
  const pass1 = up(`${dev.user}:${p.realm}:${dev.pass}`);
  const passHash = up(`${dev.user}:${p.random}:${pass1}`);
  // Call 2: carries the challenge session from call 1's response, plus the hashed password.
  const second = await rpcRaw(dev.base, {
    method: 'global.login',
    params: { userName: dev.user, password: passHash, clientType: 'Web3.0', authorityType: p.encryption || 'Default', passwordType: p.encryption || 'Default' },
    id: rpcId++, session: loginSession,
  });
  if (!second.json?.result) return { ok: false, step: 'login', raw: second };
  return { ok: true, session: second.json.session, raw: second }; // the NEW session from call 2's response is the real, authenticated one
}
async function rpcCall(dev, session, method, params, object) {
  const body = { method, params: params ?? null, id: rpcId++, session, ...(object !== undefined ? { object } : {}) };
  return rpcRaw(dev.base, body);
}

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

  const add = [], upd = [], del = [], skipped = [], problems = [];
  for (const p of plates) {
    if (others.has(p.plate)) { // a row the team made: never touch it, but say so if it does not cover the booking
      skipped.push(p.plate);
      const t = others.get(p.plate);
      if (norm(t.begin) > p.from || norm(t.end) < p.to) problems.push({ plate: p.plate, code: p.owner.split(' ')[0].replace(/^BY-/, ''), why: `แถวของทีมใน NVR (${norm(t.begin)} ถึง ${norm(t.end)}) ไม่ครอบคลุมการจอง ${p.from} ถึง ${p.to} ระบบไม่แก้แถวของทีม ให้แก้ใน NVR เอง` });
      continue;
    }
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
  if (process.env.VERBOSE) for (const s of skipped) log(' ! skip (team-managed row exists)', s);
  else if (skipped.length) log(` (${skipped.length} plates already in the NVR from the team are left alone; set VERBOSE=1 to list them)`);
  for (const x of problems) log(' ! needs a person:', x.plate, x.why);
  for (const i of invalid) { log(' ? not a Thai plate, not sent to the NVR: booking', i.code, JSON.stringify(i.plate)); problems.push({ plate: i.plate, code: i.code, why: 'ทะเบียนไม่ใช่รูปแบบป้ายไทย ไม่ได้ส่งเข้า NVR ให้แก้ทะเบียนของการจองในหน้าการจอง' }); }

  if (!apply) { log('dry run: nothing changed. Add --apply to do it.'); return { ok: true, summary, snapshot_at, problems, dry: true }; }
  if (add.length + upd.length + del.length > cfg.maxChanges) throw new Error(`too many changes (${add.length + upd.length + del.length} > MAX_CHANGES=${cfg.maxChanges}); raise MAX_CHANGES in .env after checking the plan`);
  if (del.length > cfg.maxDeletes) throw new Error(`too many removals (${del.length} > MAX_DELETES=${cfg.maxDeletes}); check the plan, then raise MAX_DELETES`);
  const errors = [];
  const step = async (fn) => { try { await fn(); } catch (e) { errors.push(String(e.message ?? e)); } };
  for (const p of add) await step(() => nvr.insert(p));
  for (const [cur, p] of upd) await step(() => nvr.update(cur.recno, p));
  for (const r of del) await step(() => nvr.remove(r.recno, r.plate));
  if (errors.length) throw new Error(errors.slice(0, 3).join(' | '));
  return { ok: true, summary, snapshot_at, problems };
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

// Diagnostic, read-only: look for the real ANPR pass-by log (every car the camera actually
// recognized, not just the allow-list) so we can later check bookings against real arrivals.
// This NVR (DHI-NVR5216-EI) has no ITC/ANPR license — confirmed by an earlier run of this
// command — so the pass-by log, if it exists anywhere, is on the plate-reading CAMERAS
// (CAM_IN_URL / CAM_OUT_URL) themselves, not the NVR. Tries both cameras plus the NVR.
async function events(minutes) {
  const end = new Date();
  const start = new Date(end.getTime() - minutes * 60000);
  const fmt = (d) => d.toLocaleString('sv-SE', { timeZone: 'Asia/Bangkok' }).replace(',', '');
  const candidates = ['TrafficCar', 'ITSPlateResult', 'TrafficSnapshot', 'TrafficJunction', 'ANPR', 'TrafficInfo', 'ITSCapture', 'Hybrid_TrafficJunction'];
  const devices = [
    { label: 'NVR', dev: { base: cfg.nvr, user: cfg.user, pass: cfg.pass } },
    { label: 'IN camera', dev: { base: cfg.camIn, user: cfg.camUser, pass: cfg.camPass } },
    { label: 'OUT camera', dev: { base: cfg.camOut, user: cfg.camUser, pass: cfg.camPass } },
  ];

  for (const { label, dev } of devices) {
    log(`=== ${label} (${dev.base}) ===`);
    const ok = [];
    for (const name of candidates) {
      const r = await nvrFetch(`/cgi-bin/recordFinder.cgi?${q({ action: 'find', name, count: 5 })}`, dev);
      const t = await r.text();
      console.log(`\n# ${label}: name=${name}\nHTTP ${r.status}\n${t.split(/\r?\n/).slice(0, 15).join('\n')}`);
      if (r.status === 200 && !/error/i.test(t)) { ok.push(name); log(`-> ${label}: "${name}" looks valid`); }
      if (r.status === 401 || r.status === 403) { log(`-> ${label}: login refused — STOP trying this device, do not retry (Dahua locks accounts after repeated bad logins)`); break; }
    }
    if (ok.length === 0) { log(`-> ${label}: none of the candidate table names worked`); continue; }
    log(`${label}: trying a time filter on: ${ok.join(', ')} ...`);
    for (const name of ok) {
      const r = await nvrFetch(`/cgi-bin/recordFinder.cgi?${q({
        action: 'find', name, count: 20,
        'condition.StartTime': fmt(start),
        'condition.EndTime': fmt(end),
      })}`, dev);
      const t = await r.text();
      console.log(`\n# ${label}: name=${name} + time filter (${fmt(start)} .. ${fmt(end)})\nHTTP ${r.status}\n${t.split(/\r?\n/).slice(0, 30).join('\n')}`);
    }
  }
  log('send me everything above (no password in it). If a camera has a working table name, that is where the real pass-by log lives. If NONE of the three devices has one, this hardware cannot give us arrival events at all and we will need a different approach (e.g. the realtime event stream, or accept we cannot verify exact arrival time).');
}

// Diagnostic, read-only: the NVR's "AI Search > Motor Vehicle" page (confirmed to have real
// plate/time/color/logo data for this NVR) talks JSON-RPC over /RPC2, not the plain cgi-bin
// digest-auth API — reproduces exactly what that page's own browser request does:
// login -> mediaFileFind.factory.create -> findFile(condition) -> findNextFile -> getCount.
async function vehicles(minutes) {
  const dev = { base: cfg.nvr, user: cfg.user, pass: cfg.pass };
  log('logging in over JSON-RPC (separate from the cgi-bin digest auth used elsewhere) ...');
  const login = await rpcLogin(dev);
  if (!login.ok) {
    console.log(`\n# login failed at step: ${login.step}\n${JSON.stringify(login.raw.json ?? login.raw.text, null, 2).slice(0, 1000)}`);
    log('send me the output above — the login handshake did not work the way I expected for this firmware.');
    return;
  }
  log(`logged in, session=${login.session}`);

  const create = await rpcCall(dev, login.session, 'mediaFileFind.factory.create', null);
  const obj = create.json?.result;
  console.log(`\n# mediaFileFind.factory.create\nHTTP ${create.status}\n${create.text.slice(0, 300)}`);
  if (!obj) { log('could not create a mediaFileFind object — send me the output above.'); return; }

  const end = new Date();
  const start = new Date(end.getTime() - minutes * 60000);
  const fmt = (d) => d.toLocaleString('sv-SE', { timeZone: 'Asia/Bangkok' }).replace(',', '');
  const condition = {
    StartTime: fmt(start), EndTime: fmt(end),
    Events: ['VehicleAnalyse', 'TrafficJunction'],
    DB: { TrafficCar: { GroupType: '', Order: 'Desc', PlateNumber: '' } },
    Channel: [0],
  };
  const find = await rpcCall(dev, login.session, 'mediaFileFind.findFile', { condition }, obj);
  console.log(`\n# mediaFileFind.findFile (${fmt(start)} .. ${fmt(end)})\nHTTP ${find.status}\n${find.text.slice(0, 500)}`);

  const count = await rpcCall(dev, login.session, 'mediaFileFind.getCount', null, obj);
  console.log(`\n# mediaFileFind.getCount\nHTTP ${count.status}\n${count.text.slice(0, 300)}`);

  const next = await rpcCall(dev, login.session, 'mediaFileFind.findNextFile', { count: 50 }, obj);
  console.log(`\n# mediaFileFind.findNextFile\nHTTP ${next.status}\n${next.text.slice(0, 4000)}`);

  await rpcCall(dev, login.session, 'mediaFileFind.factory.destroy', null, obj).catch(() => {});
  log('send me everything above (the session id in it is a temporary token, not a password — fine to share). If findNextFile lists cars with plates and times, this is the real source we build the feature on.');
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

// One-off tidy-up: deletes rows NOT made by this system (owner without "BY-") whose end date is before today.
// A CSV backup in the NVR's own import format is written first, so nothing is lost.
async function cleanup(doApply) {
  const today = new Date().toLocaleDateString('sv-SE', { timeZone: 'Asia/Bangkok' });
  const rows = await nvr.list();
  const dead = rows.filter((r) => !r.owner.startsWith(TAG) && /^\d{4}-\d{2}-\d{2}/.test(r.end) && r.end.slice(0, 10) < today && r.recno !== undefined)
    .sort((a, b) => Number(b.recno) - Number(a.recno)); // highest recno first, so a renumbering could never hit the rows still to do
  log(`NVR rows: ${rows.length} | made by this system: ${rows.filter((r) => r.owner.startsWith(TAG)).length} | expired before ${today} and not ours: ${dead.length}`);
  for (const r of dead.slice(0, 10)) log('  e.g.', r.plate, '| ended', r.end.slice(0, 10));
  if (dead.length > 10) log(`  ... and ${dead.length - 10} more`);
  if (!doApply) { log('dry run: nothing deleted. Add --apply to back up and delete them.'); return; }
  if (!dead.length) return;
  const ddmm = (t) => { const m = t.match(/^(\d{4})-(\d{2})-(\d{2}) (\d{2}):(\d{2})/); return m ? `${m[3]}-${m[2]}-${m[1]} ${m[4]}:${m[5]}` : t; };
  const cell = (v) => `"${String(v).replace(/"/g, '""')}"`;
  const csv = '﻿' + [['Plate No.', 'Type', 'Owner Name', 'Valid Start Time(DD-MM-YYYY HH:mm)', 'Valid End Time(DD-MM-YYYY HH:mm)'], ...dead.map((r) => [r.plate, 'Allow List', r.owner, ddmm(r.begin), ddmm(r.end)])].map((l) => l.map(cell).join(',')).join('\r\n') + '\r\n';
  const file = join(here, `backup-expired-${new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19)}.csv`);
  writeFileSync(file, csv);
  log('backup written:', file, `(${dead.length} rows; re-import it in the NVR UI to restore)`);
  const count = async (want) => { let n; for (let i = 0; i < 20; i++) { n = (await nvr.list()).length; if (n === want) return n; await new Promise((x) => setTimeout(x, 1000)); } return n; };
  let left = rows.length;
  for (let i = 0; i < dead.length; i++) {
    const r = dead[i];
    await nvr.remove(r.recno, r.plate);
    left--;
    if (i === 0) { // prove on the first delete that the other record numbers did not move
      const n = await count(left);
      if (n !== left) throw new Error(`stopped after 1 delete: NVR shows ${n} rows, expected ${left}`);
      const now = await nvr.list();
      const moved = dead.slice(1).filter((d) => now.find((x) => x.recno === d.recno)?.plate !== d.plate);
      if (moved.length) throw new Error(`stopped after 1 delete: record numbers changed (${moved.length} rows moved). Nothing more was deleted.`);
      log('first delete verified; continuing');
    }
  }
  const n = await count(rows.length - dead.length);
  const now = await nvr.list();
  const still = now.filter((r) => !r.owner.startsWith(TAG) && /^\d{4}-\d{2}-\d{2}/.test(r.end) && r.end.slice(0, 10) < today).length;
  const ours = now.filter((r) => r.owner.startsWith(TAG)).length;
  log(`done: deleted ${dead.length} | rows now ${n} (expected ${rows.length - dead.length}) | expired left ${still} | BY- rows ${ours}`);
}

// Barrier test. Read-only by default; `fire` sends exactly one open command to the chosen camera.
async function gatetest(which, rest) {
  const base = which === 'out' ? cfg.camOut : cfg.camIn;
  const dev = { base, user: cfg.camUser, pass: cfg.camPass };
  const get = async (path) => {
    try { const r = await nvrFetch(path, dev); return { status: r.status, text: (await r.text()).trim() }; }
    catch (e) { return { status: 0, text: `(${e.message})` }; }
  };
  if (rest[0] === 'fire') {
    const how = rest[1];
    const path = how === 'strobe' ? `/cgi-bin/trafficSnap.cgi?${q({ action: 'openStrobe', channel: 1, 'info.openType': 'Normal' })}`
      : how === 'raw' && rest[2]?.startsWith('/cgi-bin/') ? rest[2] : '';
    if (!path) { console.error('usage: gatetest in|out fire strobe   |   gatetest in|out fire raw "/cgi-bin/..."'); process.exit(1); }
    log(`>>> sending ONE open command to ${which === 'out' ? 'OUT' : 'IN'} camera ${base}: ${path}`);
    const r = await get(path);
    log('reply: HTTP', r.status, r.text.slice(0, 300) || '(empty)');
    log('did the barrier go up? did it come down by itself? tell me both.');
    return;
  }
  log(`camera ${which === 'out' ? 'OUT' : 'IN'} ${base} (read-only)`);
  const probes = [
    '/cgi-bin/magicBox.cgi?action=getDeviceType',
    '/cgi-bin/magicBox.cgi?action=getSoftwareVersion',
    '/cgi-bin/alarm.cgi?action=getOutSlots',
    '/cgi-bin/alarm.cgi?action=getOutState',
    '/cgi-bin/configManager.cgi?action=getConfig&name=AlarmOut',
    '/cgi-bin/configManager.cgi?action=getConfig&name=TrafficStrobe',
    '/cgi-bin/configManager.cgi?action=getConfig&name=TrafficSnapshot',
  ];
  for (const path of probes) {
    const r = await get(path);
    const lines = r.text.split(/\r?\n/).slice(0, 25).map((l) => (/password|passwd|pwd|token/i.test(l) ? l.replace(/=.*/, '=***') : l));
    console.log(`\n# ${path}\nHTTP ${r.status}\n${lines.join('\n')}`);
    if (r.status === 401 || r.status === 403) { // every extra wrong login makes a Dahua camera lock the account for longer
      console.log('\nSTOPPED: the camera refused the login. Do NOT retry yet; wait 10 minutes. Put the camera login in .env (CAM_USER / CAM_PASS) first.');
      break;
    }
  }
}

const [cmd = 'once', ...flags] = process.argv.slice(2);
const apply = flags.includes('--apply');
const needsSite = cmd === 'once' || cmd === 'run'; // only these talk to the web app; the rest only touch the NVR/camera
for (const [k, v] of Object.entries({ NVR_USER: cfg.user, NVR_PASS: cfg.pass, ...(needsSite ? { SITE_URL: cfg.site, LPR_BRIDGE_KEY: cfg.key } : {}) })) {
  if (!v) { console.error(`missing ${k} in .env`); process.exit(1); }
}
if (cmd === 'probe') await probe();
else if (cmd === 'ownertest') { try { await ownertest(); } catch (e) { log('ERROR', e.message); process.exitCode = 1; } }
else if (cmd === 'sample') await sample();
else if (cmd === 'events') { try { await events(Number(flags[0]) > 0 ? Number(flags[0]) : 60); } catch (e) { log('ERROR', e.message); process.exitCode = 1; } }
else if (cmd === 'vehicles') { try { await vehicles(Number(flags[0]) > 0 ? Number(flags[0]) : 1440); } catch (e) { log('ERROR', e.message, e.cause ? `(cause: ${e.cause.code ?? e.cause.message ?? e.cause})` : ''); process.exitCode = 1; } }
else if (cmd === 'gatetest') { try { await gatetest(flags[0] === 'out' ? 'out' : 'in', flags.slice(1)); } catch (e) { log('ERROR', e.message); process.exitCode = 1; } }
else if (cmd === 'cleanup') { try { await cleanup(apply); } catch (e) { log('ERROR', e.message); process.exitCode = 1; } }
else if (cmd === 'selftest') { try { await selftest(); } catch (e) { log('ERROR', e.message); process.exitCode = 1; } }
else if (cmd === 'once') {
  try { const r = await sync(apply); if (apply) await report(r); } catch (e) { log('ERROR', e.message); if (apply) await report({ ok: false, error: e.message }); process.exitCode = 1; }
} else if (cmd === 'run') {
  for (;;) {
    try { const r = await sync(apply); if (apply) await report(r); } catch (e) { log('ERROR', e.message); if (apply) await report({ ok: false, error: e.message }); }
    await new Promise((r) => setTimeout(r, cfg.poll * 1000));
  }
} else { console.error('usage: node bridge.mjs probe | selftest | ownertest | once [--apply] | cleanup [--apply] | gatetest in|out [fire strobe] | events [minutes] | vehicles [minutes] | run --apply'); process.exit(1); }
