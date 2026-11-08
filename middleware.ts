import { NextResponse, type NextRequest } from 'next/server';
import { homeFor, readSession, rolesFor, SESSION_COOKIE } from '@/lib/session';

// Staff pages need a signed-in user with the right role.
//   /admin, /api/admin : admin
//   /exec              : admin or exec
//   /ops               : admin or ops (on-site staff)
//   /driver            : admin, driver or ops
//   /account           : any staff
export async function middleware(req: NextRequest) {
  const path = req.nextUrl.pathname;
  const roles = rolesFor(path);
  if (!roles) return NextResponse.next();

  const s = await readSession(req.cookies.get(SESSION_COOKIE)?.value);
  if (s && roles.includes(s.role)) return NextResponse.next();

  if (path.startsWith('/api/')) return NextResponse.json({ error: 'not_allowed' }, { status: 401 });
  const url = req.nextUrl.clone();
  if (s) { url.pathname = homeFor(s.role); url.search = ''; return NextResponse.redirect(url); }
  url.pathname = '/login';
  url.search = `?next=${encodeURIComponent(path + req.nextUrl.search)}`;
  return NextResponse.redirect(url);
}

export const config = { matcher: ['/admin/:path*', '/api/admin/:path*', '/exec/:path*', '/driver/:path*', '/ops/:path*', '/account/:path*'] };
