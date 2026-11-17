import { db } from '@/lib/supabase';
import { currentUser, json } from '@/lib/request';

/** Saved details of a signed-in customer for the booking form: name, phone and the plates used before (newest first). */
export async function GET(req: Request) {
  const uid = await currentUser(req);
  if (!uid) return json({ error: 'unauthorized' }, 401);
  const { data: c } = await db().from('customers').select('id, name, phone').eq('line_user_id', uid).maybeSingle();
  if (!c) return json({ name: null, phone: null, plates: [] });

  const { data: rows } = await db().from('bookings')
    .select('plate, plate_province, created_at')
    .eq('customer_id', c.id)
    .order('created_at', { ascending: false })
    .limit(60);

  const seen = new Set<string>();
  const plates: { plate: string; province: string }[] = [];
  for (const r of rows ?? []) {
    const plate = String(r.plate ?? '').trim();
    const key = plate.replace(/\s+/g, '').toUpperCase();
    if (!key || seen.has(key)) continue;
    seen.add(key);
    plates.push({ plate, province: String(r.plate_province ?? '').trim() });
    if (plates.length >= 6) break;
  }
  return json({ name: c.name, phone: c.phone, plates });
}
