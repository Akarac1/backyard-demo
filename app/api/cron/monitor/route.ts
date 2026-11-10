import { json } from '@/lib/request';
import { runChecks, saveChecks } from '@/lib/monitor';
import { push } from '@/lib/line';
import { db } from '@/lib/supabase';
import { sendDueWelcomes } from '@/lib/welcome';

export const dynamic = 'force-dynamic';

/**
 * Called every 5 minutes by Supabase (see monitor_schedule in 0020). Runs every check, saves the result
 * for the status page, and, when a check turns red, sends a LINE message to ALERT_LINE_USER_IDS
 * (comma separated LINE user ids of the dev / owner; each alert is one push message).
 */
export async function GET(req: Request) {
  const secret = process.env.CRON_SECRET;
  if (!secret || req.headers.get('authorization') !== `Bearer ${secret}`) return json({ error: 'unauthorized' }, 401);
  // every 5 minutes: re-plan vehicles (early finishes, airport waits that ran out, called trips still waiting)
  await db().rpc('shuttle_rebalance').then(({ error }) => error && console.error('shuttle_rebalance', error.message));
  // every 5 minutes: welcome cards for return trips whose landing time has come
  await sendDueWelcomes().then((r) => r.error && console.error('welcome cards', r.error)).catch((e) => console.error('welcome cards', e));
  const checks = await runChecks();
  const worse = await saveChecks(checks);
  const to = (process.env.ALERT_LINE_USER_IDS ?? '').split(',').map((s) => s.trim()).filter(Boolean);
  if (worse.length && to.length) {
    const text = `⚠️ Backyard ระบบมีปัญหา\n${worse.map((c) => `• ${c.label}: ${c.summary}`).join('\n')}\n\nดูที่ หลังบ้าน → สถานะระบบ`;
    for (const id of to) await push(id, [{ type: 'text', text: text.slice(0, 4900) }]);
  }
  return json({ ok: true, checks: checks.map((c) => ({ key: c.key, level: c.level })) });
}
