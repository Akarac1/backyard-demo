import { json } from '@/lib/request';
import { bridgeAuthorized } from '@/lib/lprBridgeAuth';
import { lprDesired } from '@/lib/lprDesired';

export const dynamic = 'force-dynamic';

/** The on-site bridge asks for the full list of plates that must be in the NVR (see lib/lprDesired.ts). */
export async function GET(req: Request) {
  if (!bridgeAuthorized(req)) return json({ error: 'unauthorized' }, 401);
  try {
    return json({ snapshot_at: new Date().toISOString(), ...(await lprDesired()) });
  } catch (e) {
    console.error('lpr desired', e);
    return json({ error: 'failed' }, 500);
  }
}
