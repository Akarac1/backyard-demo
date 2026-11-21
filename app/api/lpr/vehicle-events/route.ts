import { json } from '@/lib/request';
import { bridgeAuthorized } from '@/lib/lprBridgeAuth';
import { db } from '@/lib/supabase';

export const dynamic = 'force-dynamic';

type VehicleEvent = { plate?: string; event_time?: string; channel?: number; vehicle_color?: string; vehicle_brand?: string; vehicle_category?: string };

/**
 * The on-site bridge pushes a batch of newly-seen plate events (from the NVR's own AI plate
 * recognition log, not the allow list) after every poll. The window the bridge queries overlaps
 * on purpose — ingest_vehicle_events() de-dupes on (plate, event_time, channel), so re-sending an
 * event we already have is harmless.
 */
export async function POST(req: Request) {
  if (!bridgeAuthorized(req)) return json({ error: 'unauthorized' }, 401);
  const b = (await req.json().catch(() => null)) as { events?: VehicleEvent[] } | null;
  const events = Array.isArray(b?.events) ? b.events : null;
  if (!events) return json({ error: 'bad_request' }, 400);
  if (events.length === 0) return json({ ok: true, inserted: 0 });
  if (events.length > 500) return json({ error: 'too_many' }, 400);

  const clean = events
    .map((e) => ({
      plate: String(e.plate ?? '').slice(0, 40),
      event_time: e.event_time,
      channel: Number.isInteger(e.channel) ? e.channel : null,
      vehicle_color: e.vehicle_color ? String(e.vehicle_color).slice(0, 40) : null,
      vehicle_brand: e.vehicle_brand ? String(e.vehicle_brand).slice(0, 40) : null,
      vehicle_category: e.vehicle_category ? String(e.vehicle_category).slice(0, 40) : null,
    }))
    .filter((e) => e.plate && e.event_time && !Number.isNaN(Date.parse(e.event_time)));
  if (clean.length === 0) return json({ ok: true, inserted: 0 });

  const { data, error } = await db().rpc('ingest_vehicle_events', { p_events: clean });
  if (error) { console.error('ingest_vehicle_events', error.message); return json({ error: 'failed' }, 500); }
  return json({ ok: true, inserted: data as number });
}
