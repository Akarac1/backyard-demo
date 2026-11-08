import 'server-only';
import { createClient, type SupabaseClient } from '@supabase/supabase-js';

let client: SupabaseClient | null = null;

/** Service-role client: server code only. RLS is on with no policies, so this is the only way in. */
export function db(): SupabaseClient {
  if (!client) {
    const url = process.env.SUPABASE_URL;
    const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
    if (!url || !key) throw new Error('SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY not set');
    client = createClient(url, key, { auth: { persistSession: false } });
  }
  return client;
}

export type Booking = {
  id: string;
  code: string;
  customer_id: string;
  plate: string;
  plate_province: string;
  start_date: string;
  end_date: string;
  days: number;
  parking_amount: number;
  shuttle: boolean;
  pax: number | null;
  shuttle_amount: number;
  total_amount: number;
  discount_amount: number;
  coupon_id: string | null;
  coupon_amount: number;
  campaign_id: string | null;
  campaign_amount: number;
  discount_reason: string | null;
  referrer_phone: string | null;
  extra_amount_due: number;
  status: string;
  hold_expires_at: string | null;
  booked_at: string;
  rescheduled_at: string | null;
};
