import { json } from '@/lib/request';
import { shuttleCheck } from '@/lib/shuttle';

/** Booking page: is a van free for the outbound trip at this time? */
export async function POST(req: Request) {
  const { at, pax } = (await req.json().catch(() => ({}))) as { at?: string; pax?: number };
  if (!at) return json({ error: 'invalid' }, 400);
  return json(await shuttleCheck(at, Number(pax)));
}
