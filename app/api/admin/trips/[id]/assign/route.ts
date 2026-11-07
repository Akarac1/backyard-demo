import { db } from '@/lib/supabase';
import { json } from '@/lib/request';

export async function POST(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const { data, error } = await db().rpc('assign_vehicle', { p_trip_id: id });
  if (error) return json({ error: error.message === 'no_pickup_time' ? 'ยังไม่มีเวลารับ' : error.message }, 409);
  if (!data) return json({ error: 'ไม่มีรถว่างในช่วงเวลานี้ ต้องย้ายเที่ยวอื่นหรือเลื่อนเวลา' }, 409);
  return json({ ok: true });
}
