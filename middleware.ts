import { NextResponse, type NextRequest } from 'next/server';

// Basic auth for the admin pages and admin APIs (user: admin, password: ADMIN_PASSWORD).
export function middleware(req: NextRequest) {
  const pass = process.env.ADMIN_PASSWORD;
  const header = req.headers.get('authorization') ?? '';
  if (pass && header.startsWith('Basic ')) {
    const [user, pwd] = atob(header.slice(6)).split(':');
    if (user === 'admin' && pwd === pass) return NextResponse.next();
  }
  return new NextResponse('ต้องเข้าสู่ระบบ', { status: 401, headers: { 'WWW-Authenticate': 'Basic realm="Backyard Admin"' } });
}

export const config = { matcher: ['/admin/:path*', '/api/admin/:path*'] };
