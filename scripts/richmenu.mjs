// Create the Backyard rich menu, upload its image and make it the default.
// Usage: npm run richmenu   (reads .env.local; needs LINE_CHANNEL_ACCESS_TOKEN, NEXT_PUBLIC_LIFF_ID, LOT_MAP_URL optional)
import { readFileSync, existsSync } from 'node:fs';

if (existsSync('.env.local')) {
  for (const line of readFileSync('.env.local', 'utf8').split('\n')) {
    const m = line.match(/^\s*([A-Z_]+)\s*=\s*([^#\n]*)/);
    if (m && !process.env[m[1]]) process.env[m[1]] = m[2].trim();
  }
}

const token = process.env.LINE_CHANNEL_ACCESS_TOKEN;
const liffId = process.env.NEXT_PUBLIC_LIFF_ID;
if (!token || !liffId) { console.error('Set LINE_CHANNEL_ACCESS_TOKEN and NEXT_PUBLIC_LIFF_ID'); process.exit(1); }
const mapUrl = process.env.LOT_MAP_URL || 'https://maps.google.com/?q=Suvarnabhumi+Airport';
const auth = { Authorization: `Bearer ${token}` };

// Tap areas match the 2500x1686 design (Backyard LINE Rich Menu canvas).
const menu = {
  size: { width: 2500, height: 1686 },
  selected: true,
  name: 'Backyard main',
  chatBarText: 'จองที่จอดรถ',
  areas: [
    { bounds: { x: 40, y: 40, width: 1580, height: 1046 }, action: { type: 'uri', label: 'จองที่จอดรถ', uri: `https://liff.line.me/${liffId}/book` } },
    { bounds: { x: 1660, y: 40, width: 800, height: 1046 }, action: { type: 'uri', label: 'การจองของฉัน', uri: `https://liff.line.me/${liffId}/my` } },
    { bounds: { x: 40, y: 1126, width: 780, height: 520 }, action: { type: 'message', label: 'ราคา', text: 'ราคาและเงื่อนไข' } },
    { bounds: { x: 860, y: 1126, width: 780, height: 520 }, action: { type: 'uri', label: 'วิธีเดินทาง', uri: mapUrl } },
    { bounds: { x: 1680, y: 1126, width: 780, height: 520 }, action: { type: 'message', label: 'ติดต่อแอดมิน', text: 'ขอคุยกับแอดมิน' } },
  ],
};

const created = await fetch('https://api.line.me/v2/bot/richmenu', {
  method: 'POST', headers: { ...auth, 'Content-Type': 'application/json' }, body: JSON.stringify(menu),
});
if (!created.ok) { console.error('create failed', created.status, await created.text()); process.exit(1); }
const { richMenuId } = await created.json();
console.log('created', richMenuId);

const img = await fetch(`https://api-data.line.me/v2/bot/richmenu/${richMenuId}/content`, {
  method: 'POST', headers: { ...auth, 'Content-Type': 'image/png' }, body: readFileSync('public/richmenu.png'),
});
if (!img.ok) { console.error('image upload failed', img.status, await img.text()); process.exit(1); }

const def = await fetch(`https://api.line.me/v2/bot/user/all/richmenu/${richMenuId}`, { method: 'POST', headers: auth });
console.log(def.ok ? 'set as default ✔' : `set default failed ${def.status}`);
