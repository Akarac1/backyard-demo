import { currentUser, json } from '@/lib/request';
import { serverT } from '@/lib/i18nDict';
import { customerSetBags } from '@/lib/shuttle';

const MSG: Record<string, string> = {
  not_found: 'ไม่พบการจองนี้', not_your_trip: 'ไม่พบการจองนี้', trip_closed: 'งานรับส่งนี้เสร็จหรือเริ่มไปแล้ว แก้ไม่ได้ กรุณาแจ้งคนขับ',
  invalid_bags: 'จำนวนกระเป๋าต้องอยู่ระหว่าง 0–20 ใบ',
};

/** The customer updates the bag count of their trip (e.g. more bags on the way home). */
export async function POST(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const L = serverT(req);
  const uid = await currentUser(req);
  if (!uid) return json({ error: 'unauthorized' }, 401);
  const { large, small } = (await req.json().catch(() => ({}))) as { large?: number; small?: number };
  const r = await customerSetBags(uid, (await params).id, large, small);
  if (r.error) return json({ error: L(MSG[r.error] ?? 'บันทึกไม่สำเร็จ กรุณาโทรหาร้าน') }, 409);
  return json(r.data);
}
