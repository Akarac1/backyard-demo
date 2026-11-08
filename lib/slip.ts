import 'server-only';
import { logEvent } from './events';

export type SlipResult =
  | { ok: true; amount: number; transRef: string; provider: string }
  | {
      ok: false;
      reason: 'pending' | 'invalid' | 'duplicate' | 'amount_mismatch' | 'wrong_receiver' | 'too_old' | 'review' | 'error';
      message: string;
    };

type Expect = { amount: number; notBefore: Date; remark?: string };

/**
 * Verify a Thai bank-transfer slip from its image.
 * The provider reads the QR code printed on the slip and checks it with the bank network.
 * We then check: not used before, money went to the shop, amount is enough, and the transfer
 * was made after the booking (so an old transfer to the shop cannot be reused).
 * SLIP_PROVIDER=mock accepts any image (demo only).
 */
export async function verifySlip(file: File, expected: Expect): Promise<SlipResult> {
  const provider = process.env.SLIP_PROVIDER ?? 'mock';
  try {
    if (provider === 'easyslip' || provider === 'slipok') {
      const r = provider === 'slipok' ? await slipok(file)
        : process.env.EASYSLIP_API_VERSION === 'v1' ? await easyslipV1(file) : await easyslipV2(file, expected.amount, expected.remark);
      const out = finalCheck(r, expected);
      // every call counts against the slip service quota; errors show on the status page
      await logEvent('slip', out.ok ? 'info' : out.reason === 'error' ? 'error' : 'warn',
        out.ok ? `ตรวจสลิปผ่าน (${provider})` : `ตรวจสลิปไม่ผ่าน: ${out.reason} · ${out.message}`, { provider });
      return out;
    }
    return { ok: true, amount: expected.amount, transRef: `MOCK-${Date.now()}`, provider: 'mock' };
  } catch (e) {
    console.error('slip verify', e);
    await logEvent('slip', 'error', `เรียกบริการตรวจสลิปไม่สำเร็จ: ${String(e).slice(0, 200)}`, { provider });
    return { ok: false, reason: 'error', message: 'ตรวจสลิปไม่สำเร็จ ลองใหม่อีกครั้ง หรือรอแอดมินตรวจ' };
  }
}

/** What a provider tells us before our own checks. */
type Read =
  | { ok: true; amount: number; transRef: string; provider: string; date?: string; receiver: ReceiverCheck }
  | Extract<SlipResult, { ok: false }>;
type ReceiverCheck = 'match' | 'mismatch' | 'unknown';

function finalCheck(r: Read, x: Expect): SlipResult {
  if (!r.ok) return r;
  if (r.receiver === 'mismatch')
    return { ok: false, reason: 'wrong_receiver', message: 'บัญชีผู้รับในสลิปไม่ใช่บัญชีของร้าน กรุณาโอนผ่าน QR ในหน้านี้' };
  if (r.amount + 0.001 < x.amount)
    return { ok: false, reason: 'amount_mismatch', message: `ยอดในสลิป ${r.amount} บาท น้อยกว่ายอดที่ต้องชำระ ${x.amount} บาท` };
  if (r.date && Date.parse(r.date) < x.notBefore.getTime() - 10 * 60_000)
    return { ok: false, reason: 'too_old', message: 'สลิปนี้โอนก่อนทำการจอง กรุณาใช้สลิปของการโอนครั้งนี้' };
  if (r.receiver === 'unknown')
    return { ok: false, reason: 'review', message: 'ได้รับสลิปแล้ว แอดมินจะตรวจบัญชีผู้รับและยืนยันให้' };
  return { ok: true, amount: r.amount, transRef: r.transRef, provider: r.provider };
}

type Account = { bank?: { type: string; account: string }; proxy?: { type: string; account: string } };

/**
 * Compare the receiver on the slip with our PromptPay ID (PROMPTPAY_ID) or bank account (SHOP_BANK_ACCOUNT).
 * Banks mask most digits ("08xxxxxxxx89", "xxx-x-x5678-x"), so we compare every digit that is shown,
 * lined up from the right. All shown digits must agree, and at least 3 must be shown.
 */
function receiverOf(acc: Account | undefined): ReceiverCheck {
  const ours = [process.env.PROMPTPAY_ID, process.env.SHOP_BANK_ACCOUNT].filter(Boolean).map((s) => s!.replace(/\D/g, ''));
  const shown = [acc?.proxy?.account, acc?.bank?.account].filter(Boolean) as string[];
  if (!ours.length || !shown.length) return 'unknown';
  let anyChecked = false;
  for (const raw of shown) {
    const masked = raw.replace(/[^0-9xX*]/g, '');
    for (const id of ours) {
      const res = compareMasked(masked, id);
      if (res === 'match') return 'match';
      if (res === 'mismatch') anyChecked = true;
    }
  }
  return anyChecked ? 'mismatch' : 'unknown';
}

function compareMasked(masked: string, id: string): ReceiverCheck {
  // PromptPay phone may appear as 0812345678 or 66812345678 / 0066812345678: compare the national part.
  const norm = (s: string) => s.replace(/^0066(?=[0-9xX*]{9}$)/, '0').replace(/^66(?=[0-9xX*]{9}$)/, '0');
  const a = norm(masked), b = norm(id);
  let seen = 0;
  for (let i = 1; i <= Math.min(a.length, b.length); i++) {
    const c = a[a.length - i];
    if (/\d/.test(c)) {
      if (c !== b[b.length - i]) return 'mismatch';
      seen++;
    }
  }
  return seen >= 3 ? 'match' : 'unknown';
}

// EasySlip v2 — https://document.easyslip.com/en/v2/verify/bank/base64
async function easyslipV2(file: File, amount: number, remark?: string): Promise<Read> {
  const base64 = Buffer.from(await file.arrayBuffer()).toString('base64');
  const matchAccount = process.env.EASYSLIP_MATCH_ACCOUNT === 'true'; // shop account registered in EasySlip
  const res = await fetch('https://api.easyslip.com/v2/verify/bank', {
    method: 'POST',
    headers: { Authorization: `Bearer ${process.env.EASYSLIP_API_KEY}`, 'Content-Type': 'application/json' },
    // remark shows in the EasySlip dashboard, so each check can be traced to a booking
    body: JSON.stringify({ base64, checkDuplicate: true, matchAmount: amount, ...(remark ? { remark: remark.slice(0, 255) } : {}), ...(matchAccount ? { matchAccount: true } : {}) }),
  });
  const json = (await res.json()) as {
    success: boolean;
    error?: { code: string; message: string };
    data?: {
      isDuplicate: boolean;
      matchedAccount: unknown | null;
      amountInSlip: number;
      rawSlip: { transRef: string; date: string; amount: { amount: number }; receiver: { account: Account } };
    };
  };
  if (!json.success || !json.data) {
    const code = json.error?.code;
    console.warn('easyslip', res.status, code, json.error?.message);
    if (code === 'SLIP_PENDING') return { ok: false, reason: 'pending', message: 'ธนาคารยังไม่ยืนยันรายการ (กรุงเทพ ใช้เวลาราว 5 นาที) ลองส่งสลิปอีกครั้งในอีกสักครู่' };
    if (code === 'SLIP_NOT_FOUND' || code === 'VALIDATION_ERROR' || code === 'IMAGE_SIZE_TOO_LARGE')
      return { ok: false, reason: 'invalid', message: code === 'IMAGE_SIZE_TOO_LARGE' ? 'รูปใหญ่เกิน 4 MB' : 'อ่านสลิปไม่ได้ หรือสลิปไม่ถูกต้อง ลองส่งรูปที่เห็น QR ชัด ๆ' };
    // quota, auth or server problems: let the admin check by hand
    return { ok: false, reason: 'error', message: 'ระบบตรวจสลิปขัดข้องชั่วคราว แอดมินจะตรวจให้' };
  }
  const d = json.data;
  if (d.isDuplicate) return { ok: false, reason: 'duplicate', message: 'สลิปนี้ถูกใช้ไปแล้ว' };
  let receiver = receiverOf(d.rawSlip.receiver?.account);
  if (matchAccount) receiver = d.matchedAccount ? 'match' : 'mismatch';
  return { ok: true, amount: d.amountInSlip ?? d.rawSlip.amount.amount, transRef: d.rawSlip.transRef, date: d.rawSlip.date, provider: 'easyslip', receiver };
}

// EasySlip v1 — kept as a fallback (EASYSLIP_API_VERSION=v1)
async function easyslipV1(file: File): Promise<Read> {
  const image = Buffer.from(await file.arrayBuffer()).toString('base64');
  const res = await fetch('https://api.easyslip.com/v1/verify', {
    method: 'POST',
    headers: { Authorization: `Bearer ${process.env.EASYSLIP_API_KEY}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ image, checkDuplicate: true }),
  });
  const json = (await res.json()) as {
    status: number; message?: string;
    data?: { amount?: { amount: number }; transRef?: string; date?: string; receiver?: { account?: Account } };
  };
  if (json.status === 200 && json.data?.amount)
    return { ok: true, amount: json.data.amount.amount, transRef: json.data.transRef ?? '', date: json.data.date, provider: 'easyslip', receiver: receiverOf(json.data.receiver?.account) };
  if (json.message === 'slip_pending') return { ok: false, reason: 'pending', message: 'ธนาคารยังไม่ยืนยันรายการ ลองส่งสลิปอีกครั้งในอีกสักครู่' };
  if (json.message === 'duplicate_slip') return { ok: false, reason: 'duplicate', message: 'สลิปนี้ถูกใช้ไปแล้ว' };
  return { ok: false, reason: 'invalid', message: 'อ่านสลิปไม่ได้ หรือสลิปไม่ถูกต้อง' };
}

// SlipOK — https://api.slipok.com/api/line/apikey/<BRANCH_ID> (multipart "files", log=true checks duplicates + receiving account)
async function slipok(file: File): Promise<Read> {
  const form = new FormData();
  form.append('files', file);
  form.append('log', 'true');
  const res = await fetch(`https://api.slipok.com/api/line/apikey/${process.env.SLIPOK_BRANCH_ID}`, {
    method: 'POST',
    headers: { 'x-authorization': process.env.SLIPOK_API_KEY ?? '' },
    body: form,
  });
  const json = (await res.json()) as { success?: boolean; code?: number; message?: string; data?: { amount?: number; transRef?: string; transTimestamp?: string } };
  if (json.success && json.data?.amount != null)
    // SlipOK checks the receiving account against the branch's registered account when log=true
    return { ok: true, amount: Number(json.data.amount), transRef: json.data.transRef ?? '', date: json.data.transTimestamp, provider: 'slipok', receiver: 'match' };
  if (json.code === 1012) return { ok: false, reason: 'duplicate', message: 'สลิปนี้ถูกใช้ไปแล้ว' };
  return { ok: false, reason: 'invalid', message: json.message ?? 'อ่านสลิปไม่ได้ หรือสลิปไม่ถูกต้อง' };
}

/** Exported for tests. */
export const _test = { compareMasked, receiverOf, finalCheck };
