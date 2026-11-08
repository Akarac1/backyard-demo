import 'server-only';
import { NextResponse } from 'next/server';
import { db, type Booking } from './supabase';
import { userIdFromAccessToken, userIdFromToken } from './line';

export const json = (data: unknown, status = 200) => NextResponse.json(data, { status });

/** The LINE user behind a LIFF request: ID token first, then the access token (lasts longer). */
export async function currentUser(req: Request): Promise<string | null> {
  const idToken = req.headers.get('x-id-token');
  const accessToken = req.headers.get('x-access-token');
  try { return await userIdFromToken(idToken); } catch (e) {
    if (accessToken) {
      try { return await userIdFromAccessToken(accessToken); } catch (e2) { console.warn('liff auth', String(e), String(e2)); return null; }
    }
    if (idToken) console.warn('liff auth', String(e));
    return null;
  }
}

/** Load a booking only if it belongs to this LINE user. */
export async function ownBooking(id: string, uid: string): Promise<Booking | null> {
  const { data } = await db()
    .from('bookings')
    .select('*, customers!inner(line_user_id)')
    .eq('id', id)
    .eq('customers.line_user_id', uid)
    .maybeSingle();
  return (data as Booking | null) ?? null;
}

/** '2026-11-20T08:00' typed in Thailand -> ISO with +07:00. */
export function bkkLocalToIso(local: string | undefined | null): string | null {
  if (!local) return null;
  return local.length === 16 ? `${local}:00+07:00` : `${local}+07:00`;
}
