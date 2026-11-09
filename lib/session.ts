// Signed session cookie for staff. Works in middleware (edge) and on the server.
// Value: base64url(JSON payload) + "." + base64url(HMAC-SHA256(payload, SESSION_SECRET))

export type Role = 'admin' | 'exec' | 'driver' | 'ops';
export type Session = { uid: string; role: Role; name: string; username: string; exp: number };

export const SESSION_COOKIE = 'by_session';
export const SESSION_HOURS = 12;

const enc = new TextEncoder();

function b64url(bytes: Uint8Array): string {
  let s = '';
  for (const b of bytes) s += String.fromCharCode(b);
  return btoa(s).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}
function fromB64url(s: string): Uint8Array<ArrayBuffer> {
  const b = atob(s.replace(/-/g, '+').replace(/_/g, '/') + '==='.slice((s.length + 3) % 4));
  const out = new Uint8Array(new ArrayBuffer(b.length));
  for (let i = 0; i < b.length; i++) out[i] = b.charCodeAt(i);
  return out;
}

async function key(): Promise<CryptoKey> {
  const secret = process.env.SESSION_SECRET;
  if (!secret || secret.length < 32) throw new Error('SESSION_SECRET must be set (32+ characters)');
  return crypto.subtle.importKey('raw', enc.encode(secret), { name: 'HMAC', hash: 'SHA-256' }, false, ['sign', 'verify']);
}

export async function signSession(s: Omit<Session, 'exp'>): Promise<string> {
  const payload: Session = { ...s, exp: Math.floor(Date.now() / 1000) + SESSION_HOURS * 3600 };
  const body = b64url(enc.encode(JSON.stringify(payload)));
  const sig = new Uint8Array(await crypto.subtle.sign('HMAC', await key(), enc.encode(body)));
  return `${body}.${b64url(sig)}`;
}

export async function readSession(value: string | undefined | null): Promise<Session | null> {
  if (!value) return null;
  const [body, sig] = value.split('.');
  if (!body || !sig) return null;
  try {
    const ok = await crypto.subtle.verify('HMAC', await key(), fromB64url(sig), enc.encode(body));
    if (!ok) return null;
    const s = JSON.parse(new TextDecoder().decode(fromB64url(body))) as Session;
    if (!s.exp || s.exp < Date.now() / 1000) return null;
    return s;
  } catch {
    return null;
  }
}

/** Which roles may open a path. */
export function rolesFor(path: string): Role[] | null {
  if (path.startsWith('/api/admin')) return ['admin'];
  // overview: the site lead too; every admin page: the executive too (view only — actions still need admin)
  if (path === '/admin' || path === '/admin/') return ['admin', 'ops', 'exec'];
  if (path.startsWith('/admin')) return ['admin', 'exec'];
  if (path.startsWith('/exec')) return ['admin', 'exec'];
  if (path.startsWith('/ops')) return ['admin', 'ops', 'exec'];
  if (path.startsWith('/driver')) return ['admin', 'driver', 'ops', 'exec'];
  if (path.startsWith('/account')) return ['admin', 'exec', 'driver', 'ops'];
  return null;
}

export const homeFor = (role: Role) => (role === 'admin' ? '/admin' : role === 'driver' ? '/driver' : role === 'ops' ? '/ops' : '/exec');
