import { json } from '@/lib/request';
import { bridgeAuthorized } from '@/lib/lprBridgeAuth';
import { db } from '@/lib/supabase';

export const dynamic = 'force-dynamic';

/**
 * The bridge reports after every run: { ok, error?, summary?, snapshot_at }.
 * A fully successful run clears the "plate reader" to-do items created before that snapshot; plates that still need
 * a person come back in `problems` on every run and are listed on /admin until they are fixed.
 */
export async function POST(req: Request) {
  if (!bridgeAuthorized(req)) return json({ error: 'unauthorized' }, 401);
  const b = (await req.json().catch(() => null)) as { ok?: boolean; error?: string; summary?: Record<string, unknown>; snapshot_at?: string; problems?: { plate?: string; code?: string; why?: string }[] } | null;
  if (!b || typeof b.ok !== 'boolean') return json({ error: 'bad_request' }, 400);
  const now = new Date().toISOString();
  const { error } = await db().from('lpr_bridge_status').update({
    last_seen: now,
    last_ok: b.ok,
    last_error: b.ok ? null : String(b.error ?? 'unknown').slice(0, 500),
    // the plates that need a person (bad plate, team row that does not cover the booking) are shown on /admin until fixed
    last_summary: { ...(b.summary ?? {}), problems: (Array.isArray(b.problems) ? b.problems : []).slice(0, 50).map((p) => ({ plate: String(p.plate ?? '').slice(0, 40), code: String(p.code ?? '').slice(0, 12), why: String(p.why ?? '').slice(0, 300) })) },
    ...(b.ok ? { last_ok_at: now } : {}),
  }).eq('id', 1);
  if (error) return json({ error: 'failed' }, 500);
  if (b.ok && b.snapshot_at && !Number.isNaN(Date.parse(b.snapshot_at))) {
    await db().from('lpr_sync').update({ status: 'done', done_at: now }).neq('status', 'done').lte('created_at', b.snapshot_at);
  }
  return json({ ok: true });
}
