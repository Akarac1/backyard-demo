import { db } from '@/lib/supabase';
import { currentUser, json } from '@/lib/request';
import { paymentQr } from '@/lib/qr';

/** One extra payment (extra parking days etc.) of the signed-in customer's booking, with its QR. */
export async function GET(req: Request, { params }: { params: Promise<{ pid: string }> }) {
  const { pid } = await params;
  const uid = await currentUser(req);
  if (!uid) return json({ error: 'unauthorized' }, 401);
  if (!/^[0-9a-f-]{36}$/.test(pid)) return json({ error: 'not_found' }, 404);
  const { data: p } = await db().from('payments')
    .select('id, kind, amount, status, bookings!inner(code, plate, start_date, end_date, customers!inner(line_user_id))')
    .eq('id', pid).eq('bookings.customers.line_user_id', uid).neq('kind', 'booking').maybeSingle();
  if (!p) return json({ error: 'not_found' }, 404);
  const qr = p.status === 'pending' ? (await paymentQr(p.amount))?.image ?? null : null;
  const b = p.bookings as unknown as { code: string; plate: string; start_date: string; end_date: string };
  return json({ payment: { id: p.id, kind: p.kind, amount: p.amount, status: p.status }, booking: { code: b.code, plate: b.plate, start_date: b.start_date, end_date: b.end_date }, qr, promptpayName: process.env.PROMPTPAY_NAME ?? 'Backyard Airport' });
}
