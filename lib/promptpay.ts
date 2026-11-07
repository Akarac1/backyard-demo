// PromptPay QR payload (EMVCo / Thai QR) with amount — no external library.

function tlv(id: string, value: string): string {
  return id + value.length.toString().padStart(2, '0') + value;
}

function crc16(data: string): string {
  let crc = 0xffff;
  for (let i = 0; i < data.length; i++) {
    crc ^= data.charCodeAt(i) << 8;
    for (let j = 0; j < 8; j++) {
      crc = crc & 0x8000 ? (crc << 1) ^ 0x1021 : crc << 1;
      crc &= 0xffff;
    }
  }
  return crc.toString(16).toUpperCase().padStart(4, '0');
}

/** id: mobile (0812345678), national/tax ID (13 digits) or e-wallet (15 digits). */
export function promptPayPayload(id: string, amount?: number): string {
  const digits = id.replace(/\D/g, '');
  let target: string;
  if (digits.length >= 15) target = tlv('03', digits);
  else if (digits.length === 13) target = tlv('02', digits);
  else target = tlv('01', ('0000000000000' + digits.replace(/^0/, '66')).slice(-13));

  const merchant = tlv('00', 'A000000677010111') + target;
  let payload =
    tlv('00', '01') +
    tlv('01', amount ? '12' : '11') +
    tlv('29', merchant) +
    tlv('53', '764') +
    (amount ? tlv('54', amount.toFixed(2)) : '') +
    tlv('58', 'TH');
  payload += '6304';
  return payload + crc16(payload);
}
