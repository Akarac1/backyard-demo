import Image from 'next/image';
import Link from 'next/link';
import QRCode from 'qrcode';
import { db } from '@/lib/supabase';
import s from './home.module.css';

export const dynamic = 'force-dynamic';

const LINE_ID = '@backyardairport';
const ADD_FRIEND = 'https://line.me/R/ti/p/%40backyardairport';

async function loadInfo() {
  const fallback = { perDay: 100, shuttle: 300, phone: '0888101089' };
  try {
    const { data } = await db().from('settings').select('price_per_day, shuttle_price, shop_phone').eq('id', 1).single();
    if (!data) return fallback;
    return {
      perDay: Number(data.price_per_day) || fallback.perDay,
      shuttle: Number(data.shuttle_price) || fallback.shuttle,
      phone: String(data.shop_phone || process.env.SHOP_PHONE || fallback.phone).replace(/\D/g, ''),
    };
  } catch {
    return fallback;
  }
}

const fmtPhone = (p: string) => (p.length === 10 ? `${p.slice(0, 3)}-${p.slice(3, 6)}-${p.slice(6)}` : p);

export default async function Home() {
  const info = await loadInfo();
  const svg = await QRCode.toString(ADD_FRIEND, { type: 'svg', margin: 1, width: 220, color: { dark: '#0E3320', light: '#FFFFFF' } });
  const qr = `data:image/svg+xml;utf8,${encodeURIComponent(svg)}`;
  const liffId = process.env.NEXT_PUBLIC_LIFF_ID;
  const bookHref = liffId ? `https://liff.line.me/${liffId}` : '/liff/book';

  return (
    <main className={s.page}>
      <header className={s.hero}>
        <div className={s.heroInner}>
          <div className={s.copy}>
            <span className={s.chip}>Backyard Airport · สุวรรณภูมิ</span>
            <h1>จอดรถใกล้สนามบิน<br />ปลอดภัย พร้อมรถรับส่ง</h1>
            <p className={s.lead}>จองที่จอดรถผ่าน LINE ได้เลย ไม่ต้องโหลดแอป ไม่ต้องสมัครสมาชิกยุ่งยาก</p>

            <a className={s.lineBtn} href={ADD_FRIEND} target="_blank" rel="noopener noreferrer">
              <svg viewBox="0 0 24 24" width="22" height="22" aria-hidden="true"><path fill="currentColor" d="M12 2C6.48 2 2 5.58 2 9.99c0 3.95 3.55 7.26 8.35 7.88.33.07.77.22.88.5.1.26.07.66.03.92l-.14.85c-.04.26-.2 1.02.9.56 1.1-.46 5.92-3.49 8.08-5.97C21.5 12.8 22 11.45 22 9.99 22 5.58 17.52 2 12 2Z"/></svg>
              เพิ่มเพื่อน LINE {LINE_ID}
            </a>
            <p className={s.hint}>เพิ่มเพื่อนแล้วกดเมนู “จองที่จอดรถ” ได้ทันที</p>
          </div>

          <div className={s.side}>
            <Image className={s.logo} src="/logo.png" alt="Backyard Airport · The Hangar" width={220} height={212} priority />
            <div className={s.qrCard}>
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img src={qr} alt={`QR Code เพิ่มเพื่อน LINE ${LINE_ID}`} width={140} height={140} />
              <span>สแกนเพิ่มเพื่อน<br /><b>{LINE_ID}</b></span>
            </div>
          </div>
        </div>
      </header>

      <section className={s.section}>
        <h2>จองง่ายใน 3 ขั้นตอน</h2>
        <ol className={s.steps}>
          <li><i>1</i><b>เพิ่มเพื่อน LINE</b><span>{LINE_ID} แล้วกดเมนูจองที่จอดรถ</span></li>
          <li><i>2</i><b>เลือกวันและชำระเงิน</b><span>เลือกวันเข้า-ออก ใส่ทะเบียน แล้วชำระผ่าน QR หรือโอนบัญชี</span></li>
          <li><i>3</i><b>มาถึงแล้วจอดได้เลย</b><span>ระบบอ่านป้ายทะเบียนอัตโนมัติ มีรถรับส่งไป-กลับสนามบิน</span></li>
        </ol>
      </section>

      <section className={s.section}>
        <div className={s.perks}>
          <div><b>ที่จอดรถ {info.perDay.toLocaleString('th-TH')} บาท/วัน</b><span>จองล่วงหน้า ยืนยันทันทีเมื่อชำระเงิน</span></div>
          <div><b>รถรับส่ง {info.shuttle.toLocaleString('th-TH')} บาท/ไป-กลับ</b><span>ขาไปจัดรถให้อัตโนมัติ ขากลับกดเรียกเมื่อพร้อม</span></div>
          <div><b>สะสมแต้มทุกการจอง</b><span>นำแต้มไปใช้เป็นส่วนลดครั้งถัดไป</span></div>
          <div><b>แจ้งเตือนผ่าน LINE</b><span>ยืนยันการจอง เวลารถมารับ และสถานะรถของคุณ</span></div>
        </div>
      </section>

      <section className={s.section}>
        <h2>จุดรอรถรับส่งที่สนามบิน</h2>
        <div className={s.pickup}>
          <Image src="/pickup-point-hero.jpg" alt="แผนที่จุดรอรถรับส่ง Backyard อาคารผู้โดยสารชั้น 2 ประตู 7" width={1080} height={787} />
        </div>
      </section>

      <section className={`${s.section} ${s.cta}`}>
        <h2>พร้อมจองแล้วหรือยัง</h2>
        <a className={s.lineBtn} href={ADD_FRIEND} target="_blank" rel="noopener noreferrer">เพิ่มเพื่อน LINE {LINE_ID}</a>
        <Link className={s.ghost} href={bookHref}>เป็นเพื่อนแล้ว? เปิดหน้าจอง</Link>
        <p className={s.small}>สอบถามเพิ่มเติม โทร <a href={`tel:${info.phone}`}>{fmtPhone(info.phone)}</a></p>
      </section>

      <footer className={s.footer}>
        <span>© Backyard Airport · The Hangar</span>
        <Link href="/login" className={s.staff} rel="nofollow">ทีมงาน</Link>
      </footer>
    </main>
  );
}
