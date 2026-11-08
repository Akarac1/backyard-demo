import { NextResponse } from 'next/server';
import { db } from '@/lib/supabase';
import { homeFor, signSession, SESSION_COOKIE, SESSION_HOURS, type Role } from '@/lib/session';

export async function POST(req: Request) {
  const { username, password, next } = (await req.json().catch(() => ({}))) as { username?: string; password?: string; next?: string };
  if (!username || !password) return NextResponse.json({ error: 'กรอกชื่อผู้ใช้และรหัสผ่าน' }, { status: 400 });

  const { data, error } = await db().rpc('staff_login', { p_username: username, p_password: password });
  if (error) {
    if (error.message === 'locked') return NextResponse.json({ error: 'ใส่รหัสผิดหลายครั้ง บัญชีถูกล็อก 15 นาที' }, { status: 429 });
    console.error('staff_login', error.message);
    return NextResponse.json({ error: 'เข้าสู่ระบบไม่สำเร็จ ลองใหม่อีกครั้ง' }, { status: 500 });
  }
  const u = (data as { id: string; username: string; display_name: string; role: Role }[] | null)?.[0];
  if (!u) return NextResponse.json({ error: 'ชื่อผู้ใช้หรือรหัสผ่านไม่ถูกต้อง' }, { status: 401 });

  const token = await signSession({ uid: u.id, role: u.role, name: u.display_name, username: u.username });
  // only same-site relative paths, and only ones this role may open
  const safeNext = next && next.startsWith('/') && !next.startsWith('//') &&
    (u.role === 'admin' || next.startsWith('/exec') || next.startsWith('/account')) ? next : homeFor(u.role);
  const res = NextResponse.json({ ok: true, redirect: safeNext });
  res.cookies.set(SESSION_COOKIE, token, {
    httpOnly: true, sameSite: 'lax', path: '/', maxAge: SESSION_HOURS * 3600,
    secure: process.env.NODE_ENV === 'production',
  });
  return res;
}
