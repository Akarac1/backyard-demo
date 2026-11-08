import { db } from '@/lib/supabase';
import { json } from '@/lib/request';
import { afterConfirmed } from '@/lib/confirm';
import { dbErrorToThai } from '@/lib/format';

export async function POST(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const { data, error } = await db().rpc('confirm_payment', { p_payment_id: id, p_verified_by: 'admin' });
  if (error) return json({ error: dbErrorToThai(error.message) }, 409);
  await afterConfirmed((data as { id: string }).id);
  return json({ ok: true });
}
