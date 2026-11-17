#!/usr/bin/env node
// Import ALL bookings of the old shop sheet: past (history), in the lot now (checked in) and upcoming (confirmed). Needs migration 0050.
//   node scripts/import-all-bookings.mjs tests/all-bookings.json                 -> summary only
//   SUPABASE_URL=... SUPABASE_SERVICE_ROLE_KEY=... node scripts/import-all-bookings.mjs tests/all-bookings.json --commit --actor <admin-staff-uuid>
import fs from 'node:fs';
const file = process.argv[2]; const commit = process.argv.includes('--commit');
const actor = process.argv[process.argv.indexOf('--actor') + 1];
const rows = JSON.parse(fs.readFileSync(file, 'utf8'));
const baht = rows.reduce((a, r) => a + r.price, 0);
const phones = new Set(rows.filter((r) => r.phone).map((r) => r.phone));
console.log(`${rows.length} การจอง · ${phones.size} เบอร์ · รวม ${baht.toLocaleString()} บาท · ไม่มีเบอร์ ${rows.filter((r) => !r.phone).length} · ไม่มีราคา ${rows.filter((r) => !r.price).length}`);
if (!commit) { console.log('(โหมดทดลอง เพิ่ม --commit --actor <uuid> เพื่อนำเข้าจริง)'); process.exit(0); }
const url = process.env.SUPABASE_URL, key = process.env.SUPABASE_SERVICE_ROLE_KEY;
if (!url || !key || !actor) { console.error('ต้องตั้ง SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY และ --actor'); process.exit(1); }
rows.sort((a, b) => a.start.localeCompare(b.start) || a.ref - b.ref); // oldest first, so member tiers grow in order
let n = 0, s = 0, p = 0;
for (let i = 0; i < rows.length; i += 100) {
  const res = await fetch(`${url}/rest/v1/rpc/admin_import_past_bookings`, {
    method: 'POST', headers: { apikey: key, Authorization: `Bearer ${key}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ p_actor: actor, p_rows: rows.slice(i, i + 100) }),
  });
  if (!res.ok) { console.error(`ล้มเหลวที่แถวชุด ${i}:`, (await res.text()).slice(0, 300), '\nรันซ้ำได้ ระบบข้ามรายการที่นำเข้าแล้ว'); process.exit(1); }
  const [o] = await res.json(); n += o.n_imported; s += o.n_skipped; p += Number(o.n_points);
  console.log(`  ชุด ${i / 100 + 1}: นำเข้า ${o.n_imported} ข้าม ${o.n_skipped}`);
}
console.log(`เสร็จ: นำเข้า ${n} การจอง · ข้าม ${s} · แต้มที่ได้รับ ${p}`);
