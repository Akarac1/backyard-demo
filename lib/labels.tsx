export const STATUS: Record<string, { label: string; tone: 'wait' | 'ok' | 'in' | 'done' | 'off' }> = {
  pending_payment: { label: 'รอชำระ', tone: 'wait' },
  confirmed: { label: 'ยืนยันแล้ว', tone: 'ok' },
  checked_in: { label: 'อยู่ในลาน', tone: 'in' },
  checked_out: { label: 'รับรถแล้ว', tone: 'done' },
  cancelled: { label: 'ยกเลิก', tone: 'off' },
  expired: { label: 'หมดเวลาชำระ', tone: 'off' },
  no_show: { label: 'ไม่มาตามนัด', tone: 'off' },
};

export function StatusTag({ status }: { status: string }) {
  const s = STATUS[status] ?? { label: status, tone: 'off' as const };
  return <span className={`st st-${s.tone}`}>{s.label}</span>;
}

export const DIRECTION: Record<string, string> = { to_airport: 'ส่งสนามบิน', from_airport: 'รับกลับ' };
