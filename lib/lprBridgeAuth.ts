import 'server-only';
import { timingSafeEqual } from 'crypto';

/** Bearer <LPR_BRIDGE_KEY>. Constant-time compare; no key configured means every request is refused. */
export function bridgeAuthorized(req: Request): boolean {
  const key = process.env.LPR_BRIDGE_KEY;
  if (!key || key.length < 24) return false;
  const got = (req.headers.get('authorization') ?? '').replace(/^Bearer /, '');
  const a = Buffer.from(got), b = Buffer.from(key);
  return a.length === b.length && timingSafeEqual(a, b);
}
