import { NextResponse, type NextRequest } from 'next/server';
import { homeFor, readSession, rolesFor, SESSION_COOKIE } from '@/lib/session';

/**
 * Content Security Policy with a fresh nonce per request: only scripts that carry this page
 * load's nonce run (Next.js adds it to its own scripts), plus scripts those load ('strict-dynamic').
 * Injected or inline scripts from an attacker do not run.
 */
function csp(nonce: string) {
  const dev = process.env.NODE_ENV !== 'production';
  return [
    `script-src 'self' 'nonce-${nonce}' 'strict-dynamic'${dev ? " 'unsafe-eval'" : ''}`,
    "object-src 'none'",
    "base-uri 'self'",
    "form-action 'self'",
    "frame-ancestors 'none'",
  ].join('; ');
}

// Staff pages need a signed-in user with the right role.
//   /admin, /api/admin : admin
//   /exec              : admin or exec
//   /ops               : admin or ops (on-site staff)
//   /driver            : admin, driver or ops
//   /account           : any staff
async function guard(req: NextRequest): Promise<NextResponse | null> {
  const path = req.nextUrl.pathname;
  const roles = rolesFor(path);
  if (!roles) return null;

  const s = await readSession(req.cookies.get(SESSION_COOKIE)?.value);
  if (s && roles.includes(s.role)) return null;

  if (path.startsWith('/api/')) return NextResponse.json({ error: 'not_allowed' }, { status: 401 });
  const url = req.nextUrl.clone();
  if (s) { url.pathname = homeFor(s.role); url.search = ''; return NextResponse.redirect(url); }
  url.pathname = '/login';
  url.search = `?next=${encodeURIComponent(path + req.nextUrl.search)}`;
  return NextResponse.redirect(url);
}

export async function middleware(req: NextRequest) {
  const blocked = await guard(req);
  if (blocked) return blocked;

  const nonce = btoa(crypto.randomUUID());
  const policy = csp(nonce);
  // Next.js reads the nonce from the request's CSP header and puts it on its scripts
  const headers = new Headers(req.headers);
  headers.set('x-nonce', nonce);
  headers.set('Content-Security-Policy', policy);
  const res = NextResponse.next({ request: { headers } });
  res.headers.set('Content-Security-Policy', policy);
  return res;
}

export const config = {
  matcher: [
    // every page and API route, but not static files or prefetches (they need no CSP)
    {
      source: '/((?!_next/static|_next/image|favicon.ico|.*\\.(?:png|jpg|jpeg|svg|webp|ico|css|js|map|txt|woff2?)$).*)',
      missing: [{ type: 'header', key: 'next-router-prefetch' }, { type: 'header', key: 'purpose', value: 'prefetch' }],
    },
  ],
};
