import QRCode from 'qrcode';
import { currentUser, json, ownBooking } from '@/lib/request';
import { promptPayPayload } from '@/lib/promptpay';

export async function GET(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const uid = await currentUser(req);
  if (!uid) return json({ error: 'unauthorized' }, 401);
  const booking = await ownBooking(id, uid);
  if (!booking) return json({ error: 'not_found' }, 404);

  let qr: string | null = null;
  if (booking.status === 'pending_payment' && process.env.PROMPTPAY_ID) {
    qr = await QRCode.toDataURL(promptPayPayload(process.env.PROMPTPAY_ID, booking.total_amount), { margin: 1, width: 480 });
  }
  return json({ booking, qr, promptpayName: process.env.PROMPTPAY_NAME ?? 'Backyard Airport' });
}
