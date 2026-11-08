import { requireStaff } from '@/lib/auth';
import { getRatings, legLabel, ratingFilters } from '@/lib/ratings';

export const dynamic = 'force-dynamic';

export async function GET(req: Request) {
  await requireStaff(['admin', 'exec']);
  const f = ratingFilters(Object.fromEntries(new URL(req.url).searchParams) as Record<string, string>);
  const { list } = await getRatings(f, 100000);
  const fmt = (ts: string) => new Date(ts).toLocaleString('sv-SE', { timeZone: 'Asia/Bangkok' }).slice(0, 16);
  const head = ['วันเวลา', 'ดาว', 'ความเห็น', 'คนขับ', 'เที่ยว', 'รถ', 'ลูกค้า', 'เบอร์โทร', 'รหัสการจอง'];
  const lines = list.map((r) => [fmt(r.created_at), r.stars, r.comment ?? '', r.driver_name ?? '', legLabel(r.direction), r.vehicle ?? '', r.customer_name ?? '', r.phone ?? '', r.booking_code ?? '']);
  const csv = [head, ...lines].map((l) => l.map((v) => `"${String(v).replace(/"/g, '""')}"`).join(',')).join('\r\n');
  return new Response('﻿' + csv, {
    headers: { 'Content-Type': 'text/csv; charset=utf-8', 'Content-Disposition': `attachment; filename="backyard-ratings-${f.from}_${f.to}.csv"` },
  });
}
