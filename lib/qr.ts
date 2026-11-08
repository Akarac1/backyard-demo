import 'server-only';
import QRCode from 'qrcode';
import { promptPayPayload } from './promptpay';

/**
 * PromptPay QR with the amount built in: scanning fills in the amount, the customer only confirms.
 * QR_PROVIDER=easyslip asks EasySlip (v1 /qr/generate, does not use slip-check quota);
 * otherwise, or if EasySlip fails, the same standard Thai QR is made here.
 */
export async function paymentQr(amount: number): Promise<{ image: string; provider: string } | null> {
  const id = (process.env.PROMPTPAY_ID ?? '').replace(/\D/g, '');
  if (!id) return null;
  if (process.env.QR_PROVIDER === 'easyslip' && process.env.EASYSLIP_API_KEY) {
    try {
      const target = id.length === 13 ? { natId: id } : id.length >= 15 ? { eWalletId: id } : { msisdn: id };
      const res = await fetch('https://api.easyslip.com/v1/qr/generate', {
        method: 'POST',
        headers: { Authorization: `Bearer ${process.env.EASYSLIP_API_KEY}`, 'Content-Type': 'application/json' },
        body: JSON.stringify({ type: 'PROMPTPAY', ...target, amount: Math.round(amount * 100) / 100 }),
      });
      const j = (await res.json()) as { status: number; message?: string; data?: { image: string; mime: string } };
      if (j.status === 200 && j.data?.image) return { image: `data:${j.data.mime || 'image/png'};base64,${j.data.image}`, provider: 'easyslip' };
      console.warn('easyslip qr', res.status, j.message);
    } catch (e) {
      console.warn('easyslip qr', String(e));
    }
  }
  return { image: await QRCode.toDataURL(promptPayPayload(id, amount), { margin: 1, width: 480 }), provider: 'local' };
}
