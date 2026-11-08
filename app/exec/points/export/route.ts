import { requireStaff } from '@/lib/auth';
import { getLog, logFilters, kindLabel, detail, byWho } from '@/lib/pointsLog';

export const dynamic = 'force-dynamic';

export async function GET(req: Request) {
  await requireStaff(['admin', 'exec']);
  const sp = Object.fromEntries(new URL(req.url).searchParams) as Record<string, string>;
  const f = logFilters(sp);
  const { rows } = await getLog(f, 100000);
  const fmt = (ts: string) => new Date(ts).toLocaleString('sv-SE', { timeZone: 'Asia/Bangkok' }).slice(0, 16);
  const head = ['วันเวลา', 'ประเภท', 'แต้ม', 'ลูกค้า', 'เลขสมาชิก', 'เบอร์โทร', 'ที่มา', 'หมายเหตุ', 'ทำโดย', 'หมดอายุ', 'คืนแต้มแล้ว'];
  const lines = rows.map((r) => [
    fmt(r.at), kindLabel(r.kind), r.points, r.customer_name ?? '', r.member_no ?? '', r.phone ?? '', detail(r), r.note ?? '',
    byWho(r), r.expires_at ? r.expires_at.slice(0, 10) : '', r.returned ? 'ใช่' : '',
  ]);
  const csv = [head, ...lines].map((l) => l.map((v) => `"${String(v).replace(/"/g, '""')}"`).join(',')).join('\r\n');
  return new Response('﻿' + csv, {
    headers: { 'Content-Type': 'text/csv; charset=utf-8', 'Content-Disposition': `attachment; filename="backyard-points-${f.from}_${f.to}.csv"` },
  });
}
