'use client';
import { useState } from 'react';
import { useT } from '@/components/Lang';

/** Draws the QR on a white card with the amount and the payee, as a PNG blob (what the customer keeps in the gallery). */
async function composeCard(qr: string, amount: string, payee: string): Promise<Blob> {
  const img = new Image();
  img.src = qr;
  await img.decode();
  const W = 720, QR = 560, H = 900;
  const c = document.createElement('canvas');
  c.width = W; c.height = H;
  const g = c.getContext('2d')!;
  g.fillStyle = '#fff'; g.fillRect(0, 0, W, H);
  g.imageSmoothingEnabled = false;                         // keep the QR modules sharp
  g.drawImage(img, (W - QR) / 2, 70, QR, QR);
  g.fillStyle = '#0E3320'; g.textAlign = 'center';
  g.font = 'bold 40px sans-serif'; g.fillText('PromptPay', W / 2, 52);
  g.font = 'bold 64px sans-serif'; g.fillText(amount, W / 2, 750);
  g.font = '32px sans-serif'; g.fillStyle = '#5B6678'; g.fillText(payee, W / 2, 810);
  return await new Promise<Blob>((res, rej) => c.toBlob((b) => (b ? res(b) : rej(new Error('png'))), 'image/png'));
}

/**
 * "Save QR" for the payment pages. Order of tries: the phone's share sheet (has "Save image"), a plain download,
 * and finally the picture shown full-screen to press and hold (always works, also inside the LINE browser).
 */
export function SaveQr({ qr, amount, payee, name }: { qr: string; amount: string; payee: string; name: string }) {
  const { t } = useT();
  const [shown, setShown] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  async function save() {
    setBusy(true);
    try {
      const blob = await composeCard(qr, amount, payee);
      const file = new File([blob], `${name}.png`, { type: 'image/png' });
      const nav = navigator as Navigator & { canShare?: (d: ShareData) => boolean };
      if (nav.canShare?.({ files: [file] })) {
        try { await nav.share({ files: [file] }); return; } catch (e) { if ((e as Error).name === 'AbortError') return; }
      }
      const url = URL.createObjectURL(blob);
      // downloads work in normal browsers; the LINE browser ignores them, so the picture is shown as well
      const a = document.createElement('a'); a.href = url; a.download = `${name}.png`; document.body.appendChild(a); a.click(); a.remove();
      setShown(url);
    } catch {
      setShown(qr);
    } finally { setBusy(false); }
  }

  return (
    <>
      <button type="button" className="btn" style={{ width: '100%', marginTop: 10 }} disabled={busy} onClick={save}>{busy ? t('กำลังเตรียมรูป…') : t('บันทึก QR ลงเครื่อง')}</button>
      {shown && (
        <div role="dialog" aria-label="QR" onClick={() => setShown(null)}
          style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,.85)', zIndex: 50, display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', padding: 16 }}>
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img src={shown} alt="QR PromptPay" style={{ maxWidth: '100%', maxHeight: '70vh', background: '#fff', borderRadius: 12 }} />
          <p style={{ color: '#fff', textAlign: 'center', margin: '14px 0 0' }}>{t('กดค้างที่รูปแล้วเลือก “บันทึกรูป” จากนั้นเปิดแอปธนาคาร เลือกสแกนจากรูปในอัลบั้ม')}</p>
          <button type="button" className="btn" style={{ marginTop: 12 }} onClick={() => setShown(null)}>{t('ปิด')}</button>
        </div>
      )}
    </>
  );
}
