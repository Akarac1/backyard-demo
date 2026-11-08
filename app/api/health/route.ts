import { db } from '@/lib/supabase';

export const dynamic = 'force-dynamic';

/** Public health check for uptime monitors (UptimeRobot, n8n ...). Says only ok / not ok. */
export async function GET() {
  const t0 = Date.now();
  const { error } = await db().from('settings').select('id').eq('id', 1).single();
  const body = { ok: !error, db: error ? 'down' : 'up', ms: Date.now() - t0, at: new Date().toISOString() };
  return new Response(JSON.stringify(body), { status: error ? 503 : 200, headers: { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' } });
}
