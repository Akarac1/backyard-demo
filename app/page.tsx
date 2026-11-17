import Image from 'next/image';
import Link from 'next/link';
import QRCode from 'qrcode';
import { db } from '@/lib/supabase';
import type { Metadata } from 'next';
import s from './home.module.css';

export const dynamic = 'force-dynamic';

const SITE = 'https://www.backyardairport.com';
const TITLE = 'ที่จอดรถใกล้สนามบินสุวรรณภูมิ พร้อมรถรับส่ง 100 บาท/วัน | Backyard Airport';
const DESC = 'ที่จอดรถมีหลังคาใกล้สนามบินสุวรรณภูมิ เริ่มต้น 100 บาท/วัน จองเองผ่าน LINE ไม่ต้องรอแอดมิน จอดเอง เก็บกุญแจเอง มีรถรับ-ส่งสนามบินเป็นบริการเสริม และสะสมแต้มแลกส่วนลด';

export const metadata: Metadata = {
  title: { absolute: TITLE },
  description: DESC,
  keywords: ['ที่จอดรถสุวรรณภูมิ', 'ที่จอดรถใกล้สนามบินสุวรรณภูมิ', 'จอดรถสนามบิน', 'ที่จอดรถรายวัน', 'รถรับส่งสนามบิน', 'จองที่จอดรถออนไลน์', 'Backyard Airport'],
  alternates: { canonical: '/' },
  openGraph: {
    type: 'website', locale: 'th_TH', url: SITE, siteName: 'Backyard Airport · The Hangar', title: TITLE, description: DESC,
    images: [{ url: '/og.jpg', width: 1200, height: 630, alt: 'Backyard Airport · The Hangar ที่จอดรถใกล้สนามบินสุวรรณภูมิ' }],
  },
  twitter: { card: 'summary_large_image', title: TITLE, description: DESC, images: ['/og.jpg'] },
};

const LINE_ID = '@backyardairport';
const ADD_FRIEND = 'https://line.me/R/ti/p/%40backyardairport';
const FONTS = 'https://fonts.googleapis.com/css2?family=Playfair+Display:ital,wght@0,500;0,600;1,500&family=Kanit:wght@200;300;400;500&display=swap';

async function loadInfo() {
  const fallback = { perDay: 100, shuttle: 300, phone: '0888101089', claimBonus: 20, promo: false };
  try {
    const [{ data }, { data: promo }] = await Promise.all([
      db().from('settings').select('price_per_day, shuttle_price, shop_phone, claim_bonus_points').eq('id', 1).single(),
      db().from('promo_codes').select('active, valid_from, valid_until, max_uses, used_count').eq('code', 'WELCOME').maybeSingle(),
    ]);
    if (!data) return fallback;
    const now = Date.now();
    const promoOk = !!promo && promo.active
      && (!promo.valid_from || Date.parse(promo.valid_from) <= now)
      && (!promo.valid_until || Date.parse(promo.valid_until) >= now)
      && (promo.max_uses == null || promo.used_count < promo.max_uses);
    return {
      perDay: Number(data.price_per_day) || fallback.perDay,
      shuttle: Number(data.shuttle_price) || fallback.shuttle,
      phone: String(data.shop_phone || process.env.SHOP_PHONE || fallback.phone).replace(/\D/g, ''),
      claimBonus: Number(data.claim_bonus_points) || 0,
      promo: promoOk,
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

const Car = () => (
  <svg viewBox="0 0 24 24" width="22" height="22" aria-hidden="true"><path {...ico} d="M5 16V11l1.7-4.2A2 2 0 0 1 8.6 5.5h6.8a2 2 0 0 1 1.9 1.3L19 11v5M5 16h14M5 16v2.5M19 16v2.5M7.5 13.5h.01M16.5 13.5h.01" /></svg>
);

/** a content picture in a framed card (these pictures carry their own headlines, so they are shown whole) */
function Photo({ src, w, h, alt, priority = false, className = '' }: { src: string; w: number; h: number; alt: string; priority?: boolean; className?: string }) {
  return (
    <figure className={`${s.photo} ${className}`}>
      <Image src={src} alt={alt} width={w} height={h} priority={priority} sizes="(min-width: 900px) 520px, 92vw" />
    </figure>
  );
}

const TIERS = [
  { key: 'bronze', name: 'Bronze', rule: 'เริ่มต้นสำหรับสมาชิกทุกคน', mult: 'x1' },
  { key: 'silver', name: 'Silver', rule: 'ยอดใช้บริการสะสมตั้งแต่ 5,000 บาท', mult: 'x1.2' },
  { key: 'gold', name: 'Gold', rule: 'ยอดใช้บริการสะสมตั้งแต่ 10,000 บาท', mult: 'x1.5' },
];

const FAQ = [
  { q: 'ต้องส่งกุญแจรถให้ทางร้านไหม?', a: 'ไม่ต้องครับ คุณนำรถเข้าจอดด้วยตัวเอง และเก็บกุญแจไว้กับตัวตลอดการเดินทาง' },
  { q: 'ต้องใช้บริการรถรับ-ส่งสนามบินด้วยหรือเปล่า?', a: 'ไม่จำเป็น รถรับ-ส่งเป็นบริการเสริม มีค่าใช้จ่ายแยกต่างหากจากค่าจอดรถ เลือกเพิ่มได้ตอนจองผ่าน LINE' },
  { q: 'บินกลับมาแล้วเรียกรถอย่างไร?', a: 'เมื่อรับสัมภาระเรียบร้อยและพร้อมออกจากอาคาร กดปุ่ม “เรียกรถมารับ” ผ่าน LINE ระบบจะส่งข้อมูลจุดนัดรับให้ โปรดตรวจสอบจุดนัดรับล่าสุดใน LINE ก่อนเดินไป' },
  { q: 'เคยจองกับร้านมาก่อน ต้องทำอย่างไร?', a: 'เปิดเมนู “สมาชิก & การจอง” ใน LINE แล้วเชื่อมการจองด้วยเบอร์โทรที่ให้ร้านไว้และทะเบียนรถ ดูขั้นตอนด้านบนได้เลย' },
  { q: 'ความปลอดภัยของรถที่จอดทิ้งไว้หลายวัน?', a: 'ลานจอดเป็นระเบียบ มีหลังคาคลุม และมีการดูแลความเรียบร้อยของสถานที่ ก่อนจองสามารถสอบถามรายละเอียดมาตรการรักษาความปลอดภัยกับทางร้านผ่าน LINE ได้โดยตรง' },
];

export default async function Home() {
  const info = await loadInfo();
  const svg = await QRCode.toString(ADD_FRIEND, { type: 'svg', margin: 1, width: 220, color: { dark: '#0B3B26', light: '#FFFFFF' } });
  const qr = `data:image/svg+xml;utf8,${encodeURIComponent(svg)}`;
  const liffId = process.env.NEXT_PUBLIC_LIFF_ID;
  const bookHref = liffId ? `https://liff.line.me/${liffId}` : '/liff/book';
  const example = 3 * info.perDay + info.shuttle;
  const showPromo = info.promo || process.env.NODE_ENV !== 'production';

  // structured data: business + FAQ (street address not added yet: add it once confirmed)
  const jsonLd = {
    '@context': 'https://schema.org',
    '@graph': [
      {
        '@type': ['LocalBusiness', 'ParkingFacility'],
        '@id': `${SITE}/#business`,
        name: 'Backyard Airport · The Hangar',
        description: DESC,
        url: SITE,
        logo: `${SITE}/logo.png`,
        image: `${SITE}/og.jpg`,
        telephone: `+66${info.phone.replace(/^0/, '')}`,
        priceRange: `฿${info.perDay}/วัน`,
        areaServed: 'ท่าอากาศยานสุวรรณภูมิ',
        geo: { '@type': 'GeoCoordinates', latitude: 13.703942, longitude: 100.7354492 },
        hasMap: 'https://maps.app.goo.gl/9s7ZS7NdW4Uayuz17',
        openingHoursSpecification: {
          '@type': 'OpeningHoursSpecification',
          dayOfWeek: ['Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday', 'Sunday'],
          opens: '00:00',
          closes: '23:59',
        },
        sameAs: [ADD_FRIEND],
        makesOffer: [
          { '@type': 'Offer', name: 'ที่จอดรถรายวัน', price: info.perDay, priceCurrency: 'THB', priceSpecification: { '@type': 'UnitPriceSpecification', price: info.perDay, priceCurrency: 'THB', unitText: 'DAY' } },
          { '@type': 'Offer', name: 'บริการรับ-ส่งสนามบิน (บริการเสริม)', price: info.shuttle, priceCurrency: 'THB' },
        ],
      },
      { '@type': 'WebSite', '@id': `${SITE}/#website`, url: SITE, name: 'Backyard Airport · The Hangar', inLanguage: 'th-TH', publisher: { '@id': `${SITE}/#business` } },
      {
        '@type': 'FAQPage',
        mainEntity: FAQ.map((f) => ({ '@type': 'Question', name: f.q, acceptedAnswer: { '@type': 'Answer', text: f.a } })),
      },
    ],
  };

  return (
    <main className={s.page}>
      <link rel="stylesheet" href={FONTS} precedence="default" />
      <script type="application/ld+json" dangerouslySetInnerHTML={{ __html: JSON.stringify(jsonLd).replace(/</g, '\\u003c') }} />

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
            <a href="#why">ทำไมต้อง Backyard</a>
            <a href="#steps">ขั้นตอนจอง</a>
            <a href="#member">สมาชิก</a>
            <a href="#faq">คำถามที่พบบ่อย</a>
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
                <span className={s.pIcon}><Car /></span>
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
        <div className={s.split}>
          <Photo src="/content/p02-why.jpg" w={1000} h={1094} alt="ทำไมถึงควรจองที่จอดรถกับ Backyard Airport" />
          <div>
            <span className={s.eyebrowDark}>Why Backyard</span>
            <h2 className={s.h2}>ทำไมต้องจองที่จอดรถ<br />กับ Backyard Airport?</h2>
            <p className={s.sub}>เพราะการเดินทางที่ดี ควรเริ่มต้นด้วยความสะดวกและสบายใจ</p>
            <ol className={s.reasons}>
              <li>
                <span>01</span>
                <div><b>จองเองได้ง่าย ๆ ไม่ต้องรอแอดมิน</b><p>ระบบจองอัตโนมัติผ่าน LINE เลือกวันจอด ตรวจสอบรายละเอียด และจองได้ด้วยตัวเอง</p></div>
              </li>
              <li>
                <span>02</span>
                <div><b>แจ้งเตือนทุกขั้นตอน อุ่นใจตลอดการเดินทาง</b><p>ติดตามสถานะการจองและบริการรถรับ–ส่งผ่าน LINE ตั้งแต่เริ่มจอง ไปจนถึงกลับมารับรถ</p></div>
              </li>
              <li>
                <span>03</span>
                <div><b>จอดยิ่งบ่อย ยิ่งคุ้ม!</b><p>ระบบสมาชิกสะสมคะแนนจากทุกการใช้บริการที่เข้าเงื่อนไข แลกส่วนลดและสิทธิประโยชน์ได้ง่าย ๆ</p></div>
              </li>
            </ol>
          </div>
        </div>

        <div className={s.features}>
          <article>
            <svg viewBox="0 0 24 24" aria-hidden="true"><path {...ico} d="M3 11 12 4l9 7M5 10v9h14v-9M9 19v-5h6v5" /></svg>
            <h3>ที่จอดในร่ม</h3>
            <p>ลานจอดมีหลังคาคลุม จัดพื้นที่เป็นระเบียบ</p>
          </article>
          <article>
            <svg viewBox="0 0 24 24" aria-hidden="true"><circle {...ico} cx="8" cy="12" r="3.5" /><path {...ico} d="M11.5 12H21M17 12v3M20 12v2" /></svg>
            <h3>จอดเอง เก็บกุญแจเอง</h3>
            <p>ไม่ต้องส่งกุญแจให้ใคร นำรถเข้าจอดด้วยตัวเอง</p>
          </article>
          <article>
            <svg viewBox="0 0 24 24" aria-hidden="true"><path {...ico} d="M4 16V8.5A1.5 1.5 0 0 1 5.5 7h8A1.5 1.5 0 0 1 15 8.5V16M15 10h3l2 3v3M4 16h16M7.5 18.5a1.5 1.5 0 1 0 0-.01M16.5 18.5a1.5 1.5 0 1 0 0-.01" /></svg>
            <h3>รถรับ–ส่งสนามบิน</h3>
            <p>เป็นบริการเสริม จองพร้อมที่จอดผ่าน LINE ได้เลย</p>
          </article>
          <article>
            <svg viewBox="0 0 24 24" aria-hidden="true"><path {...ico} d="M12 3v18M16 7.5c0-1.7-1.8-3-4-3s-4 1.3-4 3 1.8 2.6 4 3 4 1.3 4 3-1.8 3-4 3-4-1.3-4-3" /></svg>
            <h3>{baht(info.perDay)} บาท/วัน</h3>
            <p>วางแผนค่าใช้จ่ายได้ง่าย ตรวจสอบยอดรวมก่อนยืนยันจอง</p>
          </article>
        </div>
      </section>

      {/* ================= STEPS ================= */}
      <section id="steps" className={`${s.band}`}>
        <div className={`${s.section} ${s.bandInner}`}>
          <div className={`${s.split} ${s.reverse}`}>
            <div>
              <span className={s.eyebrowDark}>How it works</span>
              <h2 className={s.h2}>จองง่ายใน 3 ขั้นตอน</h2>
              <p className={s.sub}>ระบบจองรูปแบบใหม่ วางแผนจอดรถก่อนบินได้ง่ายขึ้น</p>
              <ol className={s.steps}>
                <li><span>01</span><div><b>เพิ่มเพื่อน LINE {LINE_ID}</b><p>เปิดแชต แล้วกดเมนู “จองที่จอดรถ”</p></div></li>
                <li><span>02</span><div><b>กรอกข้อมูลการเดินทาง</b><p>เลือกวันเข้า-ออก ใส่ทะเบียนรถ และเลือกรถรับ–ส่งสนามบินหากต้องการ</p></div></li>
                <li><span>03</span><div><b>ยืนยันและชำระเงิน</b><p>ชำระผ่าน QR หรือโอนบัญชี ระบบยืนยันการจองและแจ้งเตือนผ่าน LINE</p></div></li>
              </ol>
              <a className={`${s.gold} ${s.stepBtn}`} href={ADD_FRIEND} target="_blank" rel="noopener noreferrer"><LineIcon /> เริ่มจองผ่าน LINE</a>
            </div>
            <Photo src="/content/p01-steps.jpg" w={1000} h={1250} alt="จองที่จอดรถง่าย ๆ ใน 3 ขั้นตอนผ่าน LINE" />
          </div>
        </div>
      </section>

      {/* ================= JOURNEY ================= */}
      <section id="journey" className={s.section}>
        <div className={s.head}>
          <span className={s.eyebrowDark}>Your journey</span>
          <h2 className={s.h2}>จากลานจอดสู่สนามบิน และกลับมารับรถ</h2>
        </div>
        <div className={s.journey}>
          <article>
            <Photo src="/content/p06-outbound.jpg" w={1000} h={1250} alt="จอดรถแล้วไปสนามบินอย่างไร" />
            <h3>ขาไป: จอดรถแล้วไปสนามบินยังไง?</h3>
            <ol>
              <li><i>1</i>ขับรถเข้าลานและจอดด้วยตัวเอง</li>
              <li><i>2</i>นำสัมภาระไปขึ้นรถรับ–ส่งตามจุดบริการ</li>
              <li><i>3</i>เดินทางต่อไปสนามบินสุวรรณภูมิ</li>
            </ol>
            <p>ไม่ต้องหาที่จอดในสนามบินเอง และเก็บกุญแจรถไว้กับตัวได้</p>
          </article>
          <article>
            <Photo src="/content/p07-return.jpg" w={1000} h={1250} alt="บินกลับมาแล้วเรียกรถอย่างไร" />
            <h3>ขากลับ: บินกลับมาแล้วเรียกรถยังไง?</h3>
            <ol>
              <li><i>1</i>รับสัมภาระให้เรียบร้อย</li>
              <li><i>2</i>เมื่อพร้อมออกจากอาคาร กดปุ่ม “เรียกรถมารับ” ผ่าน LINE</li>
              <li><i>3</i>รับข้อมูลจุดนัดรับและเดินตามแผนที่ที่ระบบส่งให้</li>
              <li><i>4</i>รอรถรับ–ส่งตามรายละเอียดที่แจ้ง</li>
            </ol>
            <p>โปรดตรวจสอบจุดนัดรับล่าสุดใน LINE ก่อนเดินไป</p>
          </article>
        </div>
      </section>

      {/* ================= PRICING ================= */}
      <section id="pricing" className={`${s.section} ${s.pricing}`}>
        <div className={s.head}>
          <span className={s.eyebrow}>Pricing</span>
          <h2 className={s.h2}>จอดรถวันละ {baht(info.perDay)} บาท</h2>
          <p className={s.sub}>วางแผนค่าใช้จ่ายได้ง่าย พร้อมพื้นที่จอดในร่มและตัวเลือกบริการรถรับ–ส่งสนามบิน</p>
        </div>
        <div className={s.priceCards}>
          <article>
            <span className={s.pIcon}>P</span>
            <h3>ที่จอดรถรายวัน</h3>
            <b>{baht(info.perDay)}<small> บาท/วัน</small></b>
            <p>จองล่วงหน้า ยืนยันทันทีเมื่อชำระเงิน</p>
          </article>
          <article>
            <span className={s.pIcon}><Car /></span>
            <h3>บริการรับ-ส่งสนามบิน</h3>
            <b>{baht(info.shuttle)}<small> บาท/เที่ยว</small></b>
            <p>บริการเสริม มีค่าใช้จ่ายแยกต่างหาก</p>
          </article>
        </div>
        <p className={s.example}>ตัวอย่าง จอด 3 วัน พร้อมรถรับส่งไป-กลับ รวม <b>{baht(example)} บาท</b> · ตรวจสอบยอดรวมและเงื่อนไขก่อนยืนยันการจองได้ในระบบ</p>
      </section>

      {/* ================= PROMO ================= */}
      {showPromo && (
        <section id="promo" className={s.band}>
          <div className={`${s.section} ${s.bandInner}`}>
            <div className={s.split}>
              <Photo src="/content/p03-welcome.jpg" w={1000} h={1000} alt="โปรโมชันเปิดระบบใหม่ กรอกโค้ด WELCOME รับส่วนลดทันที 100 บาท" />
              <div>
                <span className={s.eyebrowDark}>Welcome promotion</span>
                <h2 className={s.h2}>ฉลองเปิดตัวระบบจองใหม่<br />รับส่วนลดทันที 100 บาท</h2>
                <p className={s.sub}>จองที่จอดรถพร้อมบริการรับ–ส่งสนามบิน เพียงกรอกโค้ดในขั้นตอนการจองผ่าน LINE</p>
                <div className={s.code}><span>PROMO CODE</span><b>WELCOME</b></div>
                <h3 className={s.h3}>เงื่อนไขโปรโมชัน</h3>
                <ul className={s.checks}>
                  <li>จองที่จอดรถตั้งแต่ 1 วันขึ้นไป</li>
                  <li>ต้องเลือกใช้บริการรถรับ–ส่งสนามบิน</li>
                  <li>ไม่สามารถใช้ร่วมกับส่วนลดสำหรับลูกค้าเก่าได้</li>
                </ul>
              </div>
            </div>
          </div>
        </section>
      )}

      {/* ================= MEMBER ================= */}
      <section id="member" className={s.section}>
        <div className={s.head}>
          <span className={s.eyebrowDark}>Backyard Member</span>
          <h2 className={s.h2}>เป็นสมาชิก Backyard Airport ดียังไง?</h2>
          <p className={s.sub}>ยิ่งจอด ยิ่งคุ้ม สะสมแต้ม แลกรับส่วนลด พร้อมสิทธิพิเศษอีกมากมาย</p>
        </div>
        <div className={s.split}>
          <Photo src="/content/p04-member.jpg" w={1000} h={1000} alt="ระบบสมาชิก Backyard Airport สะสมแต้มและสิทธิประโยชน์ 3 ระดับ" />
          <ul className={s.benefits}>
            <li>
              <b>ทุกการใช้จ่าย มีแต้มสะสม</b>
              <p>ทุกยอดใช้จ่าย 100 บาท รับ 1 Backyard Point<br />10 Points แลกส่วนลด 50 บาท · 20 Points แลกส่วนลด 100 บาท</p>
            </li>
            <li>
              <b>ลูกค้าเก่า รับส่วนลดทันที 100 บาท</b>
              <p>เคยใช้บริการมาก่อน รับสิทธิ์ในการจองครั้งถัดไป เมื่อจองตั้งแต่ 3 วันขึ้นไปและใช้บริการรถรับ–ส่งสนามบิน</p>
            </li>
            <li>
              <b>แนะนำเพื่อน รับฟรี 3 Backyard Points</b>
              <p>เมื่อเพื่อนที่คุณแนะนำทำรายการสำเร็จ รับแต้มเข้าบัญชีสมาชิกทันที</p>
            </li>
            <li>
              <b>ยิ่งใช้มาก ยิ่งได้แต้มมากขึ้น</b>
              <p>ระบบสมาชิก 3 ระดับ ตามยอดใช้บริการสะสม</p>
            </li>
          </ul>
        </div>
        <div className={s.tiers}>
          {TIERS.map((t) => (
            <article key={t.key} className={s[`tier_${t.key}` as keyof typeof s]}>
              <span>{t.name} Member</span>
              <b>{t.mult}</b>
              <p>{t.rule}</p>
            </article>
          ))}
        </div>
        <p className={s.note}>คะแนนสะสมใช้ร่วมกับโปรโมชันลูกค้าเก่าได้</p>
      </section>

      {/* ================= OLD CUSTOMERS ================= */}
      <section id="old" className={s.old}>
        <div className={s.oldInner}>
          <div>
            <span className={s.eyebrow}>Returning customers</span>
            <h2>เคยจองกับร้านมาก่อน?<br />เชื่อมการจองเก่าเข้า LINE</h2>
            <p>ทางร้านบันทึกการจองของคุณไว้ให้แล้ว เพียงเชื่อมกับ LINE เพื่อดูการจองและเรียกรถรับ–ส่งสนามบินได้ผ่าน LINE{info.claimBonus > 0 ? ` เชื่อมสำเร็จรับโบนัส ${info.claimBonus} แต้มทันที (ใช้เป็นส่วนลดค่าจอดครั้งถัดไป)` : ''}</p>
          </div>
          <ol>
            <li><i>1</i><span>เพิ่มเพื่อน LINE {LINE_ID}</span></li>
            <li><i>2</i><span>เปิดเมนู “สมาชิก &amp; การจอง”</span></li>
            <li><i>3</i><span>กด “ร้านบันทึกการจองให้คุณไว้แล้ว? เชื่อมการจองที่นี่”</span></li>
            <li><i>4</i><span>กรอกเบอร์โทรที่ให้ร้านไว้ และทะเบียนรถ แล้วกด “เชื่อมการจอง”</span></li>
          </ol>
        </div>
      </section>

      {/* ================= GALLERY ================= */}
      <section className={s.section}>
        <div className={s.head}>
          <span className={s.eyebrowDark}>Peace of mind</span>
          <h2 className={s.h2}>เที่ยวให้เต็มที่ เรื่องที่จอดรถให้เราดูแล</h2>
        </div>
        <div className={s.gallery}>
          <article>
            <Photo src="/content/p09-keys.jpg" w={1000} h={1250} alt="จอดเอง เก็บกุญแจเอง สบายใจกว่า" />
            <h3>จอดเอง เก็บกุญแจเอง</h3>
            <p>นำรถเข้าจอดด้วยตัวเอง และเก็บกุญแจรถไว้กับตัวตลอดการเดินทาง</p>
          </article>
          <article>
            <Photo src="/content/p08-secure.jpg" w={1000} h={1250} alt="จอดรถทิ้งไว้หลายวัน มั่นใจได้แค่ไหน" />
            <h3>จอดทิ้งไว้หลายวัน มั่นใจได้แค่ไหน?</h3>
            <p>พื้นที่จอดเป็นระเบียบ มีหลังคาคลุม ก่อนจองสอบถามมาตรการรักษาความปลอดภัยกับทางร้านได้โดยตรง</p>
          </article>
          <article>
            <Photo src="/content/p05-trip.jpg" w={1000} h={1250} alt="ไปเที่ยวให้สบายใจ เรื่องที่จอดรถให้เราดูแล" />
            <h3>ไปเที่ยวหลายวัน ก็สบายใจ</h3>
            <p>ไม่ว่าจะเดินทางสั้นหรือหลายวัน เริ่มต้นง่าย ๆ ด้วยการจองล่วงหน้าผ่าน LINE</p>
          </article>
        </div>
      </section>

      {/* ================= TIPS ================= */}
      <section id="tips" className={s.band}>
        <div className={`${s.section} ${s.bandInner}`}>
          <div className={`${s.split} ${s.reverse}`}>
            <div>
              <span className={s.eyebrowDark}>Travel tips</span>
              <h2 className={s.h2}>เช็กลิสต์ก่อนบิน<br />อย่าลืม 5 สิ่งนี้!</h2>
              <ul className={s.todo}>
                <li><b>พาสปอร์ตหรือเอกสารประจำตัว</b></li>
                <li><b>เที่ยวบิน วันและเวลาเดินทาง</b></li>
                <li><b>สัมภาระ น้ำหนัก และของต้องห้าม</b></li>
                <li><b>เวลาเดินทาง</b><span>เผื่อการจราจรและขั้นตอนสนามบิน</span></li>
                <li><b>ที่จอดรถและบริการรับ–ส่ง</b><span>ถ้าขับรถมาเอง จองล่วงหน้าผ่าน LINE</span></li>
              </ul>
            </div>
            <Photo src="/content/p11-checklist.jpg" w={1000} h={1250} alt="Checklist ก่อนบิน 5 สิ่งที่ไม่ควรลืม" />
          </div>
        </div>
      </section>

      {/* ================= FAQ ================= */}
      <section id="faq" className={s.section}>
        <div className={s.head}>
          <span className={s.eyebrowDark}>FAQ</span>
          <h2 className={s.h2}>คำถามที่พบบ่อย</h2>
        </div>
        <div className={s.faq}>
          {FAQ.map((f) => (
            <details key={f.q}>
              <summary>{f.q}</summary>
              <p>{f.a}</p>
            </details>
          ))}
        </div>
      </section>

      {/* ================= CTA ================= */}
      <section className={s.cta}>
        <div className={s.ctaInner}>
          <div className={s.ctaCopy}>
            <span className={s.eyebrow}>Ready to book</span>
            <h2>เที่ยวให้เต็มที่<br />เรื่องที่จอดรถให้เราดูแล</h2>
            <p>จองที่จอดรถและรถรับ–ส่งสนามบินง่าย ๆ ผ่าน LINE</p>
            <a className={s.gold} href={ADD_FRIEND} target="_blank" rel="noopener noreferrer"><LineIcon /> เพิ่มเพื่อน LINE {LINE_ID}</a>
            <Link className={s.textLink} href={bookHref}>เป็นเพื่อนแล้ว? เปิดหน้าจอง →</Link>
            <div className={s.ctaQr}>
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img src={qr} alt={`QR Code เพิ่มเพื่อน LINE ${LINE_ID}`} width={120} height={120} />
              <span>สแกนด้วย LINE<b>{LINE_ID}</b></span>
            </div>
          </div>
          <Photo className={s.ctaPhoto} src="/content/p12-line.jpg" w={1000} h={1250} alt="เที่ยวให้เต็มที่ เรื่องที่จอดรถให้เราดูแล จองผ่าน LINE @backyardairport" />
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
