import { json } from '@/lib/request';
import { sendDueWelcomes } from '@/lib/welcome';

export const dynamic = 'force-dynamic';

/**
 * Sends due welcome cards now. The 5-minute monitor job already does this, so no separate schedule is needed;
 * this route stays for a manual run or an extra scheduler. Authorization: Bearer <CRON_SECRET>
 */
export async function GET(req: Request) {
  const secret = process.env.CRON_SECRET;
  const auth = req.headers.get('authorization') ?? '';
  if (!secret || auth !== `Bearer ${secret}`) return json({ error: 'unauthorized' }, 401);
  const r = await sendDueWelcomes();
  return r.error ? json({ error: r.error }, 500) : json(r);
}
