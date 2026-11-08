import 'server-only';
import { db } from './supabase';

export type Contact = { phone: string; display: string; hours: string };

export const fmtPhone = (p: string) =>
  p.length === 10 ? p.replace(/^(\d{3})(\d{3})(\d{4})$/, '$1-$2-$3') : p.replace(/^(\d{2})(\d{3})(\d{4})$/, '$1-$2-$3');

/** Shop phone and chat hours from หลังบ้าน → ตั้งค่า (falls back to SHOP_PHONE, then the original number). */
export async function getContact(): Promise<Contact> {
  const { data } = await db().from('settings').select('shop_phone, admin_hours').eq('id', 1).maybeSingle();
  const phone = (data?.shop_phone || process.env.SHOP_PHONE || '0888101089').replace(/\D/g, '');
  return { phone, display: fmtPhone(phone), hours: data?.admin_hours || '08:00–20:00' };
}
