import Image from 'next/image';
import Link from 'next/link';
import QRCode from 'qrcode';
import { db } from '@/lib/supabase';
import s from './home.module.css';

export const dynamic = 'force-dynamic';

const LINE_ID = '@backyardairport';
const ADD_FRIEND = 'https://line.me/R/ti/p/%40backyardairport';
const FONTS = 'https://fonts.googleapis.com/css2?family=Playfair+Display:ital,wght@0,500;0,600;1,500&family=Kanit:wght@200;300;400;500&display=swap';

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
const baht = (n: number) => n.toLocaleString('th-TH');

function LineIcon({ size = 20 }: { size?: number }) {
  return (
    <svg viewBox="0 0 24 24" width={size} height={size} aria-hidden="true">
      <path fill="currentColor" d="M12 2C6.48 2 2 5.58 2 9.99c0 3.95 3.55 7.26 8.35 7.88.33.07.77.22.88.5.1.26.07.66.03.92l-.14.85c-.04.26-.2 1.02.9.56 1.1-.46 5.92-3.49 8.08-5.97C21.5 12.8 22 11.45 22 9.99 22 5.58 17.52 2 12 2Z" />
    </svg>
  );
}

const ico = { fill: 'none', stroke: 'currentColor', strokeWidth: 1.4, strokeLinecap: 'round', strokeLinejoin: 'round' } as const;

export default async function Home() {
  const info = await loadInfo();
  const svg = await QRCode.toString(ADD_FRIEND, { type: 'svg', margin: 1, width: 220, color: { dark: '#0B3B26', light: '#FFFFFF' } });
  const qr = `data:image/svg+xml;utf8,${encodeURIComponent(svg)}`;
  const liffId = process.env.NEXT_PUBLIC_LIFF_ID;
  const bookHref = liffId ? `https://liff.line.me/${liffId}` : '/liff/book';
  const example = 3 * info.perDay + info.shuttle;

  return (
    <main className={s.page}>
      <link rel="stylesheet" href={FONTS} precedence="default" />

      {/* ================= HERO ================= */}
      <header id="top" className={s.hero}>
        <svg className={s.arcs} viewBox="0 0 1200 800" preserveAspectRatio="xMinYMin slice" aria-hidden="true">
          <defs>
            <linearGradient id="gold" x1="0" y1="0" x2="1" y2="1">
              <stop offset="0" stopColor="#F3DC8C" /><stop offset=".5" stopColor="#C9A24B" /><stop offset="1" stopColor="#8F6F25" />
            </linearGradient>
          </defs>
          <path d="M-40 150 C 60 90, 170 30, 330 -30" stroke="url(#gold)" strokeWidth="20" fill="none" opacity=".9" />
          <path d="M-40 190 C 50 134, 160 76, 320 12" stroke="url(#gold)" strokeWidth="2" fill="none" opacity=".7" />
          <path d="M-80 880 C 220 790, 520 800, 760 640" stroke="url(#gold)" strokeWidth="14" fill="none" opacity=".55" />
        </svg>

        <nav className={s.nav}>
          <a className={s.brand} href="#top" aria-label="Backyard Airport · The Hangar">
            <Image src="/logo.png" alt="" width={44} height={42} priority />
            <span>Backyard Airport<small>The Hangar</small></span>
          </a>
          <div className={s.links}>
            <a href="#why">จุดเด่น</a>
            <a href="#steps">ขั้นตอนจอง</a>
            <a href="#pricing">ราคา</a>
            <a href="#pickup">จุดรอรถ</a>
          </div>
          <a className={s.navBtn} href={ADD_FRIEND} target="_blank" rel="noopener noreferrer">เพิ่มเพื่อน LINE</a>
        </nav>

        <div className={s.heroGrid}>
          <div className={s.heroCopy}>
            <span className={s.eyebrow}>Airport Parking · Suvarnabhumi</span>
            <h1>
              ที่จอดรถใกล้สนามบิน
              <em>สุวรรณภูมิ</em>
            </h1>
            <p className={s.tag}><span>จอดสะดวก</span><i /><span>ปลอดภัย</span><i /><span>บริการครบ</span></p>

            <div className={s.priceBar}>
              <div>
                <span className={s.pIcon}>P</span>
                <p>ที่จอดรถรายวัน<b>{baht(info.perDay)} <small>บาท/วัน</small></b></p>
              </div>
              <hr />
              <div>
                <span className={s.pIcon}>
                  <svg viewBox="0 0 24 24" width="22" height="22" aria-hidden="true"><path {...ico} d="M5 16V11l1.7-4.2A2 2 0 0 1 8.6 5.5h6.8a2 2 0 0 1 1.9 1.3L19 11v5M5 16h14M5 16v2.5M19 16v2.5M7.5 13.5h.01M16.5 13.5h.01" /></svg>
                </span>
                <p>บริการรับ-ส่งสนามบิน<b>{baht(info.shuttle)} <small>บาท/เที่ยว</small></b></p>
              </div>
            </div>

            <div className={s.ctaRow}>
              <a className={s.gold} href={ADD_FRIEND} target="_blank" rel="noopener noreferrer"><LineIcon /> เพิ่มเพื่อน LINE {LINE_ID}</a>
              <a className={s.ghost} href="#steps">ดูวิธีจอง</a>
            </div>
            <p className={s.hint}>เพิ่มเพื่อนแล้วกดเมนู “จองที่จอดรถ” ได้ทันที</p>
          </div>

          <div className={s.heroArt}>
            <div className={s.frame}>
              <Image src="/hero-airport.jpg" alt="ที่จอดรถมีหลังคาข้างอาคารท่าอากาศยานสุวรรณภูมิ ยามเย็น" width={1200} height={1248} priority sizes="(min-width: 900px) 460px, 90vw" />
              <div className={s.qrBadge}>
                {/* eslint-disable-next-line @next/next/no-img-element */}
                <img src={qr} alt={`QR Code เพิ่มเพื่อน LINE ${LINE_ID}`} width={92} height={92} />
                <span>สแกนเพิ่มเพื่อน<b>{LINE_ID}</b></span>
              </div>
            </div>
          </div>
        </div>
      </header>

      {/* ================= WHY ================= */}
      <section id="why" className={s.section}>
        <div className={s.head}>
          <span className={s.eyebrowDark}>Why Backyard</span>
          <h2>ทุกอย่างเรียบง่าย จบในแชต LINE เดียว</h2>
        </div>
        <div className={s.features}>
          <article>
            <svg viewBox="0 0 24 24" aria-hidden="true"><path {...ico} d="M12 21s7-5.6 7-11a7 7 0 1 0-14 0c0 5.4 7 11 7 11Z" /><circle {...ico} cx="12" cy="10" r="2.6" /></svg>
            <h3>ใกล้สนามบิน</h3>
            <p>ที่จอดรถใกล้สุวรรณภูมิ เดินทางไป-กลับสะดวก</p>
          </article>
          <article>
            <svg viewBox="0 0 24 24" aria-hidden="true"><path {...ico} d="M12 3 5 6v5.5c0 4.3 2.9 8 7 9.5 4.1-1.5 7-5.2 7-9.5V6l-7-3Z" /><path {...ico} d="m9 12 2.2 2.2L15.5 10" /></svg>
            <h3>ปลอดภัย</h3>
            <p>ระบบอ่านป้ายทะเบียนอัตโนมัติ ทราบรถเข้า-ออกทุกคัน</p>
          </article>
          <article>
            <svg viewBox="0 0 24 24" aria-hidden="true"><path {...ico} d="M4 16V8.5A1.5 1.5 0 0 1 5.5 7h8A1.5 1.5 0 0 1 15 8.5V16M15 10h3l2 3v3M4 16h16M7.5 18.5a1.5 1.5 0 1 0 0-.01M16.5 18.5a1.5 1.5 0 1 0 0-.01" /></svg>
            <h3>รถรับส่ง ไป-กลับ</h3>
            <p>ขาไปจัดรถให้อัตโนมัติ ขากลับกดเรียกผ่าน LINE</p>
          </article>
          <article>
            <svg viewBox="0 0 24 24" aria-hidden="true"><path {...ico} d="m12 3.5 2.6 5.3 5.9.9-4.2 4.1 1 5.8L12 16.8 6.7 19.6l1-5.8-4.2-4.1 5.9-.9L12 3.5Z" /></svg>
            <h3>สะสมแต้ม</h3>
            <p>ทุกการจองได้แต้ม นำไปเป็นส่วนลดครั้งถัดไป</p>
          </article>
        </div>
      </section>

      {/* ================= STEPS ================= */}
      <section id="steps" className={`${s.section} ${s.stepsSec}`}>
        <div className={s.stepsGrid}>
          <div>
            <span className={s.eyebrowDark}>How it works</span>
            <h2>จองง่ายใน 3 ขั้นตอน</h2>
            <ol className={s.steps}>
              <li><span>01</span><div><b>เพิ่มเพื่อน LINE</b><p>{LINE_ID} แล้วกดเมนู “จองที่จอดรถ”</p></div></li>
              <li><span>02</span><div><b>เลือกวันและชำระเงิน</b><p>เลือกวันเข้า-ออก ใส่ทะเบียนรถ ชำระผ่าน QR หรือโอนบัญชี</p></div></li>
              <li><span>03</span><div><b>มาถึงแล้วจอดได้เลย</b><p>ระบบอ่านป้ายทะเบียนอัตโนมัติ พร้อมรถรับส่งไป-กลับสนามบิน</p></div></li>
            </ol>
          </div>
          <div id="pickup" className={s.pickup}>
            <Image src="/pickup-point-hero.jpg" alt="แผนที่จุดรอรถรับส่ง Backyard อาคารผู้โดยสารชั้น 2 ขาเข้า ประตู 7" width={1080} height={787} />
            <p><b>จุดรอรถรับส่ง Backyard</b><span>อาคารผู้โดยสารชั้น 2 (ขาเข้า) · ประตู 7</span></p>
          </div>
        </div>
      </section>

      {/* ================= PRICING ================= */}
      <section id="pricing" className={`${s.section} ${s.pricing}`}>
        <div className={s.head}>
          <span className={s.eyebrow}>Pricing</span>
          <h2>ราคาชัดเจน ไม่มีค่าใช้จ่ายแอบแฝง</h2>
        </div>
        <div className={s.priceCards}>
          <article>
            <span className={s.pIcon}>P</span>
            <h3>ที่จอดรถรายวัน</h3>
            <b>{baht(info.perDay)}<small> บาท/วัน</small></b>
            <p>จองล่วงหน้า ยืนยันทันทีเมื่อชำระเงิน</p>
          </article>
          <article>
            <span className={s.pIcon}>
              <svg viewBox="0 0 24 24" width="22" height="22" aria-hidden="true"><path {...ico} d="M5 16V11l1.7-4.2A2 2 0 0 1 8.6 5.5h6.8a2 2 0 0 1 1.9 1.3L19 11v5M5 16h14M5 16v2.5M19 16v2.5M7.5 13.5h.01M16.5 13.5h.01" /></svg>
            </span>
            <h3>บริการรับ-ส่งสนามบิน</h3>
            <b>{baht(info.shuttle)}<small> บาท/เที่ยว</small></b>
            <p>ไป-กลับต่อการจอง ขากลับกดเรียกเมื่อพร้อม</p>
          </article>
        </div>
        <p className={s.example}>ตัวอย่าง จอด 3 วัน พร้อมรถรับส่งไป-กลับ รวม <b>{baht(example)} บาท</b></p>
      </section>

      {/* ================= CTA ================= */}
      <section className={s.cta}>
        <div className={s.ctaInner}>
          <div>
            <span className={s.eyebrow}>Ready to book</span>
            <h2>พร้อมจองแล้วหรือยัง</h2>
            <p>เพิ่มเพื่อน LINE {LINE_ID} แล้วจองได้ทันที</p>
            <a className={s.gold} href={ADD_FRIEND} target="_blank" rel="noopener noreferrer"><LineIcon /> เพิ่มเพื่อน LINE {LINE_ID}</a>
            <Link className={s.textLink} href={bookHref}>เป็นเพื่อนแล้ว? เปิดหน้าจอง →</Link>
          </div>
          <div className={s.ctaQr}>
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img src={qr} alt={`QR Code เพิ่มเพื่อน LINE ${LINE_ID}`} width={150} height={150} />
            <span>สแกนด้วย LINE</span>
          </div>
        </div>
      </section>

      {/* ================= FOOTER ================= */}
      <footer className={s.footer}>
        <div className={s.footBrand}>
          <Image src="/logo.png" alt="" width={40} height={39} />
          <span>Backyard Airport<small>The Hangar</small></span>
        </div>
        <div className={s.footLinks}>
          <a href={`tel:${info.phone}`}>โทร {fmtPhone(info.phone)}</a>
          <a href={ADD_FRIEND} target="_blank" rel="noopener noreferrer">LINE {LINE_ID}</a>
        </div>
        <div className={s.copy}>
          <span>© {new Date().getFullYear()} Backyard Airport · The Hangar</span>
          <Link href="/login" className={s.staff} rel="nofollow">staff</Link>
        </div>
      </footer>
    </main>
  );
}
