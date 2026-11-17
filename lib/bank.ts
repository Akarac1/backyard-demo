import 'server-only';

/** Bank account shown to customers when there is no PromptPay QR (PROMPTPAY_ID empty). */
export function bankInfo(): { bank: string; account: string; name: string } | null {
  const account = (process.env.SHOP_BANK_ACCOUNT ?? '').trim();
  if (!account) return null;
  return {
    bank: process.env.SHOP_BANK_NAME ?? '',
    account,
    name: process.env.SHOP_BANK_ACCOUNT_NAME ?? process.env.PROMPTPAY_NAME ?? 'Backyard Airport',
  };
}
