import { json } from '@/lib/request';
import { runChecks, saveChecks } from '@/lib/monitor';
import { push } from '@/lib/line';

export const dynamic = 'force-dynamic';

/**
 * Called every 5 minutes by Supabase (see monitor_schedule in 0020). Runs every check, saves the result
 * for the status page, and, when a check turns red, sends a LINE message to ALERT_LINE_USER_IDS
 * (comma separated LINE user ids of the dev / owner; each alert is one push message).
 */
export async function GET(req: Request) {
  const secret = process.env.CRON_SECRET;
  if (!secret || req.headers.get('authorization') !== `Bearer ${secret}`) return json({ error: 'unauthorized' }, 401);
  const checks = await runChecks();
  const worse = await saveChecks(checks);
  const to = (process.env.ALERT_LINE_USER_IDS ?? '').split(',').map((s) => s.trim()).filter(Boolean);
  if (worse.length && to.length) {
    const text = `⚠️ Backyard ระบบมีปัญหา\n${worse.map((c) => `• ${c.label}: ${c.summary}`).join('\n')}\n\nดูที่ หลังบ้าน → สถานะระบบ`;
    for (const id of to) await push(id, [{ type: 'text', text: text.slice(0, 4900) }]);
  }
  return json({ ok: true, checks: checks.map((c) => ({ key: c.key, level: c.level })) });
}
