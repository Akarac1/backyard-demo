'use client';
import { useState } from 'react';
import { useT } from '@/components/Lang';

export type Bank = { bank: string; account: string; name: string };

/** Transfer details with a copy button, used when no QR can be made. */
export default function BankBox({ bank, amount }: { bank: Bank; amount: number }) {
  const { t } = useT();
  const [copied, setCopied] = useState(false);
  const copy = async () => {
    try { await navigator.clipboard.writeText(bank.account.replace(/\D/g, '')); setCopied(true); setTimeout(() => setCopied(false), 2000); } catch { /* ignore */ }
  };
  return (
    <div style={{ margin: '10px 0' }}>
      <div className="small">{t('โอนเงินเข้าบัญชี')}</div>
      {bank.bank && <div style={{ fontWeight: 600 }}>{bank.bank}</div>}
      <div style={{ fontSize: 24, fontWeight: 700, letterSpacing: 1 }}>{bank.account}</div>
      <div className="small">{t('ชื่อบัญชี')} {bank.name}</div>
      <button type="button" className="btn" style={{ marginTop: 8 }} onClick={copy}>{copied ? t('คัดลอกแล้ว') : t('คัดลอกเลขบัญชี')}</button>
      <div className="alert info" style={{ marginTop: 8 }}>{t('กรุณาโอนยอด {a} บาท ให้ตรงตามนี้ แล้วส่งสลิปด้านล่าง', { a: amount.toLocaleString('th-TH') })}</div>
    </div>
  );
}
