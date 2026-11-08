import { db } from '@/lib/supabase';
import { json } from '@/lib/request';

export async function POST(req: Request) {
  const { start, end } = (await req.json()) as { start?: string; end?: string };
  if (!start || !end || end < start) return json({ error: 'invalid_range' }, 400);
  const { data, error } = await db().rpc('check_availability', { p_start: start, p_end: end });
  if (error) return json({ error: error.message }, 500);
  return json(data);
}
