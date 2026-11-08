import { db } from '@/lib/supabase';
import { json } from '@/lib/request';

export async function POST(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const { error } = await db().from('lpr_sync').update({ status: 'done', done_at: new Date().toISOString() }).eq('id', id);
  return error ? json({ error: error.message }, 500) : json({ ok: true });
}
