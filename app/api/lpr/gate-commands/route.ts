import { json } from '@/lib/request';
import { bridgeAuthorized } from '@/lib/lprBridgeAuth';
import { db } from '@/lib/supabase';

export const dynamic = 'force-dynamic';

/**
 * Emergency barrier-open button on /ops writes a row into gate_commands via the
 * request_gate_open RPC. The on-site bridge polls this route fast (every few seconds,
 * much faster than the main plate-sync loop) and fires the camera's strobe output for
 * each pending command, then reports back with POST so it's never fired twice.
 */
export async function GET(req: Request) {
  if (!bridgeAuthorized(req)) return json({ error: 'unauthorized' }, 401);
  const { data, error } = await db()
    .from('gate_commands')
    .select('id, which, note, requested_at')
    .is('fired_at', null)
    .order('requested_at')
    .limit(10);
  if (error) return json({ error: 'failed' }, 500);
  return json({ commands: data ?? [] });
}

export async function POST(req: Request) {
  if (!bridgeAuthorized(req)) return json({ error: 'unauthorized' }, 401);
  const b = (await req.json().catch(() => null)) as { id?: number; result?: string; error?: string } | null;
  if (!b || !Number.isInteger(b.id) || (b.result !== 'ok' && b.result !== 'error')) return json({ error: 'bad_request' }, 400);
  const { error } = await db()
    .from('gate_commands')
    .update({ fired_at: new Date().toISOString(), result: b.result, error: b.result === 'error' ? String(b.error ?? 'unknown').slice(0, 300) : null })
    .eq('id', b.id)
    .is('fired_at', null);
  if (error) return json({ error: 'failed' }, 500);
  return json({ ok: true });
}
