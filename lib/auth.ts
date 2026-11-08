import 'server-only';
import { cookies } from 'next/headers';
import { redirect } from 'next/navigation';
import { db } from './supabase';
import { homeFor, readSession, SESSION_COOKIE, type Role, type Session } from './session';

/** The signed-in staff member, re-checked against the database (deactivated users are out at once). */
export async function getStaff(): Promise<Session | null> {
  const s = await readSession((await cookies()).get(SESSION_COOKIE)?.value);
  if (!s) return null;
  const { data } = await db().from('staff_users').select('active, role, display_name').eq('id', s.uid).maybeSingle();
  if (!data?.active) return null;
  return { ...s, role: data.role as Role, name: data.display_name };
}

/** For pages: send to /login when not allowed. */
export async function requireStaff(roles: Role[]): Promise<Session> {
  const s = await getStaff();
  if (!s) redirect('/login');
  if (!roles.includes(s.role)) redirect(homeFor(s.role));
  return s;
}

/** For server actions: throw instead of redirecting. */
export async function staffForAction(roles: Role[]): Promise<Session> {
  const s = await getStaff();
  if (!s || !roles.includes(s.role)) throw new Error('not_allowed');
  return s;
}
