import 'server-only';
import { NextResponse } from 'next/server';
import { db, type Booking } from './supabase';
import { userIdFromToken } from './line';

export const json = (data: unknown, status = 200) => NextResponse.json(data, { status });

export async function currentUser(req: Request): Promise<string | null> {
  try { return await userIdFromToken(req.headers.get('x-id-token')); } catch { return null; }
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
