import { bucketLabel, getReport, grainOf } from '@/lib/report';

export const dynamic = 'force-dynamic';

export async function GET(req: Request) {
  const g = grainOf(new URL(req.url).searchParams.get('p') ?? undefined);
  const rows = await getReport(g.key, g.periods);
  const head = ['ช่วง', 'เริ่ม', 'ถึง', 'รายได้รวม', 'ค่าจอด', 'รถรับส่ง', 'จอดเพิ่ม/เกินวัน', 'การจองที่ชำระ', 'รถเข้าใช้บริการ', 'ลูกค้า', 'ลูกค้าใหม่', 'การจองที่ใช้รถรับส่ง', 'ผู้โดยสาร', 'วันจอดรวม', 'อัตราการใช้ลาน %'];
  const lines = rows.map((r) => [
    bucketLabel(g.key, r.bucket, r.bucket_end), r.bucket, r.bucket_end, r.revenue_total, r.revenue_parking, r.revenue_shuttle, r.revenue_extra,
    r.bookings_paid, r.cars_in, r.customers, r.new_customers, r.shuttle_bookings, r.shuttle_pax, r.car_days, r.occupancy_pct ?? 0,
  ]);
  const csv = [head, ...lines].map((l) => l.map((v) => `"${String(v).replace(/"/g, '""')}"`).join(',')).join('\r\n');
  // BOM so Excel opens Thai text correctly
  return new Response('﻿' + csv, {
    headers: {
      'Content-Type': 'text/csv; charset=utf-8',
      'Content-Disposition': `attachment; filename="backyard-report-${g.key}.csv"`,
    },
  });
}
