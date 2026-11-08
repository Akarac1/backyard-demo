import { db } from '@/lib/supabase';
import { currentUser, json } from '@/lib/request';

export async function GET(req: Request) {
  const uid = await currentUser(req);
  if (!uid) return json([], 401);
  const { data } = await db().from('bookings')
    .select('id, code, plate, start_date, end_date, days, total_amount, status, shuttle, pax, rescheduled_at, customers!inner(line_user_id)')
    .eq('customers.line_user_id', uid)
    .order('start_date', { ascending: false })
    .limit(20);
  return json(data ?? []);
}
