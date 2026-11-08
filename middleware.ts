import { NextResponse, type NextRequest } from 'next/server';

// Basic auth.
//   /admin, /api/admin : user "admin", password ADMIN_PASSWORD
//   /exec              : user "exec",  password EXEC_PASSWORD (the admin login also works)
export function middleware(req: NextRequest) {
  const header = req.headers.get('authorization') ?? '';
  const isExec = req.nextUrl.pathname.startsWith('/exec');
  if (header.startsWith('Basic ')) {
    const [user, pwd] = atob(header.slice(6)).split(':');
    const admin = process.env.ADMIN_PASSWORD;
    const exec = process.env.EXEC_PASSWORD;
    if (admin && user === 'admin' && pwd === admin) return NextResponse.next();
    if (isExec && exec && user === 'exec' && pwd === exec) return NextResponse.next();
  }
  const realm = isExec ? 'Backyard Executive' : 'Backyard Admin';
  return new NextResponse('ต้องเข้าสู่ระบบ', { status: 401, headers: { 'WWW-Authenticate': `Basic realm="${realm}"` } });
}

export const config = { matcher: ['/admin/:path*', '/api/admin/:path*', '/exec/:path*', '/exec'] };
