import 'server-only';

export type SlipResult =
  | { ok: true; amount: number; transRef: string; provider: string }
  | { ok: false; reason: 'pending' | 'invalid' | 'duplicate' | 'amount_mismatch' | 'error'; message: string };

/**
 * Verify a Thai bank-transfer slip from its image.
 * Providers read the QR code printed on the slip and check it with the bank network.
 * SLIP_PROVIDER=mock accepts any image as the expected amount (demo only).
 */
export async function verifySlip(file: File, expectedAmount: number): Promise<SlipResult> {
  const provider = process.env.SLIP_PROVIDER ?? 'mock';
  try {
    if (provider === 'easyslip') return check(await easyslip(file), expectedAmount);
    if (provider === 'slipok') return check(await slipok(file), expectedAmount);
    return { ok: true, amount: expectedAmount, transRef: `MOCK-${Date.now()}`, provider: 'mock' };
  } catch (e) {
    console.error('slip verify', e);
    return { ok: false, reason: 'error', message: 'ตรวจสลิปไม่สำเร็จ ลองใหม่อีกครั้ง หรือรอแอดมินตรวจ' };
  }
}

function check(r: SlipResult, expected: number): SlipResult {
  if (!r.ok) return r;
  if (r.amount + 0.001 < expected)
    return { ok: false, reason: 'amount_mismatch', message: `ยอดในสลิป ${r.amount} บาท น้อยกว่ายอดที่ต้องชำระ ${expected} บาท` };
  return r;
}

// EasySlip v1 — https://document.easyslip.com (base64 image, checkDuplicate)
async function easyslip(file: File): Promise<SlipResult> {
  const image = Buffer.from(await file.arrayBuffer()).toString('base64');
  const res = await fetch('https://api.easyslip.com/v1/verify', {
    method: 'POST',
    headers: { Authorization: `Bearer ${process.env.EASYSLIP_API_KEY}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ image, checkDuplicate: true }),
  });
  const json = (await res.json()) as { status: number; message?: string; data?: { amount?: { amount: number }; transRef?: string } };
  if (json.status === 200 && json.data?.amount)
    return { ok: true, amount: json.data.amount.amount, transRef: json.data.transRef ?? '', provider: 'easyslip' };
  if (json.message === 'slip_pending') return { ok: false, reason: 'pending', message: 'ธนาคารยังไม่ยืนยันรายการ ระบบจะลองตรวจอีกครั้ง' };
  if (json.message === 'duplicate_slip') return { ok: false, reason: 'duplicate', message: 'สลิปนี้ถูกใช้ไปแล้ว' };
  return { ok: false, reason: 'invalid', message: 'อ่านสลิปไม่ได้ หรือสลิปไม่ถูกต้อง' };
}

// SlipOK — https://api.slipok.com/api/line/apikey/<BRANCH_ID> (multipart "files", log=true checks duplicates + receiving account)
async function slipok(file: File): Promise<SlipResult> {
  const form = new FormData();
  form.append('files', file);
  form.append('log', 'true');
  const res = await fetch(`https://api.slipok.com/api/line/apikey/${process.env.SLIPOK_BRANCH_ID}`, {
    method: 'POST',
    headers: { 'x-authorization': process.env.SLIPOK_API_KEY ?? '' },
    body: form,
  });
  const json = (await res.json()) as { success?: boolean; code?: number; message?: string; data?: { amount?: number; transRef?: string } };
  if (json.success && json.data?.amount != null)
    return { ok: true, amount: Number(json.data.amount), transRef: json.data.transRef ?? '', provider: 'slipok' };
  if (json.code === 1012) return { ok: false, reason: 'duplicate', message: 'สลิปนี้ถูกใช้ไปแล้ว' };
  return { ok: false, reason: 'invalid', message: json.message ?? 'อ่านสลิปไม่ได้ หรือสลิปไม่ถูกต้อง' };
}
