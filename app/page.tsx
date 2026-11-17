import Image from 'next/image';
import Link from 'next/link';
import QRCode from 'qrcode';
import { db } from '@/lib/supabase';
import s from './home.module.css';

export const dynamic = 'force-dynamic';

const LINE_ID = '@backyardairport';
const ADD_FRIEND = 'https://line.me/R/ti/p/%40backyardairport';
const FONTS = 'https://fonts.googleapis.com/css2?family=JetBrains+Mono:wght@400;500&family=Space+Grotesk:wght@300;400;500;600;700&display=swap';

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

export default async function Home() {
  const info = await loadInfo();
  const svg = await QRCode.toString(ADD_FRIEND, { type: 'svg', margin: 1, width: 220, color: { dark: '#0a0a0a', light: '#FFFFFF' } });
  const qr = `data:image/svg+xml;utf8,${encodeURIComponent(svg)}`;
  const liffId = process.env.NEXT_PUBLIC_LIFF_ID;
  const bookHref = liffId ? `https://liff.line.me/${liffId}` : '/liff/book';

  // price bars: simple per-day price x number of days (computed from the real setting)
  const days = [1, 3, 5, 7, 10, 14];
  const maxPrice = days[days.length - 1] * info.perDay;

  return (
    <main className={s.stage}>
      <link rel="stylesheet" href={FONTS} precedence="default" />
      <div className={s.shell}>
        <div className={s.gridBg} aria-hidden="true" />
        <div className={s.noise} aria-hidden="true" />
        <div className={`${s.glow} ${s.glowA}`} aria-hidden="true" />
        <div className={`${s.glow} ${s.glowB}`} aria-hidden="true" />

        {/* ---------- nav ---------- */}
        <nav className={s.nav}>
          <a className={s.brand} href="#top" aria-label="Backyard Airport">
            <span className={s.brandMark}>B</span>
            <span className={s.brandText}>Backyard<br /><small>Airport</small></span>
          </a>
          <div className={s.pill}>
            <a href="#steps">ขั้นตอนจอง</a>
            <a href="#pricing">ราคา</a>
            <a href="#pickup">จุดรอรถ</a>
          </div>
          <div className={s.navRight}>
            <span className={`${s.status} ${s.hideSm}`}><i />Online booking</span>
            <a className={s.whiteBtn} href={ADD_FRIEND} target="_blank" rel="noopener noreferrer">เพิ่มเพื่อน LINE</a>
          </div>
        </nav>

        {/* ---------- hero ---------- */}
        <header id="top" className={s.hero}>
          <div className={s.heroCopy}>
            <span className={s.label}>{'//'} Airport parking · Suvarnabhumi</span>
            <h1>
              จอดรถใกล้สนามบิน
              <span className={s.grad}>พร้อมรถรับส่ง</span>
            </h1>
            <p className={s.lead}>จองที่จอดรถผ่าน LINE ได้ในไม่กี่นาที ไม่ต้องโหลดแอป ระบบอ่านป้ายทะเบียนให้อัตโนมัติ และมีรถรับส่งไป-กลับสนามบิน</p>
            <div className={s.ctaRow}>
              <a className={s.neon} href={ADD_FRIEND} target="_blank" rel="noopener noreferrer">
                <LineIcon /> เพิ่มเพื่อน LINE {LINE_ID}
              </a>
              <a className={s.textLink} href="#steps">ดูวิธีจอง →</a>
            </div>
            <p className={s.hint}>เพิ่มเพื่อนแล้วกดเมนู “จองที่จอดรถ” ได้ทันที</p>
          </div>

          <div className={s.heroArt}>
            <div className={s.mock}>
              <div className={s.mockBar}><i /><i /><i /><span>backyardairport.com</span></div>
              <div className={s.mockBody}>
                <Image className={s.mockLogo} src="/logo.png" alt="Backyard Airport · The Hangar" width={190} height={183} priority />
                <div className={`${s.card} ${s.f1}`}>
                  <span className={s.tick}>✓</span>
                  <div><b>ยืนยันการจองแล้ว</b><small>ที่จอดรถ {baht(info.perDay)} บาท/วัน</small></div>
                </div>
                <div className={`${s.card} ${s.f2}`}>
                  <span className={s.dot} />
                  <div><b>รถรับส่งกำลังมารับ</b><small>แจ้งสถานะผ่าน LINE</small></div>
                </div>
                <div className={`${s.card} ${s.qrCard} ${s.f3}`}>
                  {/* eslint-disable-next-line @next/next/no-img-element */}
                  <img src={qr} alt={`QR Code เพิ่มเพื่อน LINE ${LINE_ID}`} width={116} height={116} />
                  <small>สแกนเพิ่มเพื่อน</small>
                </div>
                <span className={s.cursor}>{LINE_ID}</span>
              </div>
            </div>
          </div>
        </header>

        {/* ---------- bento ---------- */}
        <section id="pricing" className={s.section}>
          <span className={s.label}>{'//'} Why Backyard</span>
          <h2 className={s.h2}>ทุกอย่างจบในแชต LINE เดียว</h2>
          <div className={s.bento}>
            <article className={`${s.tile} ${s.big}`}>
              <div>
                <span className={s.label}>Parking</span>
                <h3>ที่จอดรถ {baht(info.perDay)} บาท/วัน</h3>
                <p>จองล่วงหน้า ยืนยันทันทีเมื่อชำระเงิน จอดนานกี่วันก็คิดตามจริง</p>
              </div>
              <div className={s.bars} role="img" aria-label={`ราคาที่จอดรถตามจำนวนวัน ${days.map((d) => `${d} วัน ${baht(d * info.perDay)} บาท`).join(', ')}`}>
                {days.map((d, i) => (
                  <div key={d} className={s.bar}>
                    <em>{baht(d * info.perDay)}</em>
                    <span style={{ height: `${Math.max(8, Math.round((d * info.perDay / maxPrice) * 100))}%` }} className={i === days.length - 1 ? s.barHi : ''} />
                    <small>{d} วัน</small>
                  </div>
                ))}
              </div>
            </article>

            <article className={`${s.tile} ${s.tall}`}>
              <span className={s.label}>Shuttle</span>
              <h3>รถรับส่ง {baht(info.shuttle)} บาท<br /><small>ไป-กลับ</small></h3>
              <ul className={s.flow}>
                <li><i>01</i><div><b>ขาไป</b><span>ระบบจัดรถให้อัตโนมัติ</span></div></li>
                <li><i>02</i><div><b>ลงเครื่องแล้ว</b><span>กดเรียกรถใน LINE</span></div></li>
                <li><i>03</i><div><b>กลับถึงลาน</b><span>รับรถคืนได้เลย</span></div></li>
              </ul>
            </article>

            <article className={`${s.tile} ${s.accent}`}>
              <div className={s.noiseSoft} aria-hidden="true" />
              <span className={s.labelDark}>Rewards</span>
              <h3>สะสมแต้มทุกการจอง</h3>
              <p>นำแต้มไปเป็นส่วนลดครั้งถัดไป</p>
            </article>

            <article className={`${s.tile} ${s.notify}`}>
              <span className={s.label}>Notify</span>
              <h3>แจ้งเตือนผ่าน LINE</h3>
              <p>ยืนยันการจอง เวลารถมารับ และสถานะรถ</p>
            </article>
          </div>
        </section>

        {/* ---------- light contrast section ---------- */}
        <section id="steps" className={s.light}>
          <div className={s.lightInner}>
            <div>
              <span className={s.labelDark}>{'//'} How it works</span>
              <h2 className={s.h2Dark}>จองง่ายใน 3 ขั้นตอน</h2>
              <ol className={s.steps}>
                <li><i>01</i><div><b>เพิ่มเพื่อน LINE</b><span>{LINE_ID} แล้วกดเมนูจองที่จอดรถ</span></div></li>
                <li><i>02</i><div><b>เลือกวันและชำระเงิน</b><span>เลือกวันเข้า-ออก ใส่ทะเบียน ชำระผ่าน QR หรือโอนบัญชี</span></div></li>
                <li><i>03</i><div><b>มาถึงแล้วจอดได้เลย</b><span>ระบบอ่านป้ายทะเบียนอัตโนมัติ และมีรถรับส่งไป-กลับ</span></div></li>
              </ol>
            </div>
            <div id="pickup" className={s.pickup}>
              <Image src="/pickup-point-hero.jpg" alt="แผนที่จุดรอรถรับส่ง Backyard อาคารผู้โดยสารชั้น 2 ขาเข้า ประตู 7" width={1080} height={787} />
              <div className={`${s.card} ${s.pickupCard}`}>
                <b>จุดรอรถรับส่ง Backyard</b>
                <small>อาคารผู้โดยสารชั้น 2 (ขาเข้า) · ประตู 7</small>
              </div>
            </div>
          </div>
        </section>

        {/* ---------- footer ---------- */}
        <footer className={s.footer}>
          <div className={s.watermark} aria-hidden="true">BACKYARD</div>
          <div className={s.footTop}>
            <span className={s.label}>{'//'} Ready?</span>
            <h2 className={s.h2}>พร้อมจองแล้วหรือยัง</h2>
            <a className={s.mega} href={ADD_FRIEND} target="_blank" rel="noopener noreferrer">
              <span><LineIcon size={26} /> เพิ่มเพื่อน LINE {LINE_ID}</span>
            </a>
            <Link className={s.textLink} href={bookHref}>เป็นเพื่อนแล้ว? เปิดหน้าจอง →</Link>
          </div>
          <div className={s.footCols}>
            <div>
              <span className={s.label}>Contact</span>
              <a href={`tel:${info.phone}`}>โทร {fmtPhone(info.phone)}</a>
              <a href={ADD_FRIEND} target="_blank" rel="noopener noreferrer">LINE {LINE_ID}</a>
            </div>
            <div>
              <span className={s.label}>Quick links</span>
              <a href="#steps">ขั้นตอนจอง</a>
              <a href="#pickup">จุดรอรถ</a>
            </div>
            <div className={s.social}>
              <span className={s.label}>Follow</span>
              <a className={s.circle} href={ADD_FRIEND} target="_blank" rel="noopener noreferrer" aria-label="LINE"><LineIcon size={18} /></a>
              <a className={s.circle} href={`tel:${info.phone}`} aria-label="โทรหาร้าน">☎</a>
            </div>
          </div>
          <div className={s.copy}>
            <span>© {new Date().getFullYear()} Backyard Airport · The Hangar</span>
            <Link href="/login" className={s.staff} rel="nofollow">staff</Link>
          </div>
        </footer>
      </div>
    </main>
  );
}
