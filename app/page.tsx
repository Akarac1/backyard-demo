import Link from 'next/link';

export default function Home() {
  return (
    <main>
      <div className="hero">
        <span className="chip">Backyard Airport · สุวรรณภูมิ</span>
        <h1>เดโมระบบจองที่จอดรถ</h1>
        <p>เปิดแต่ละหน้าเพื่อทดลอง</p>
      </div>
      <div className="wrap">
        <div className="card">
          <h2>ฝั่งลูกค้า (เปิดจาก LINE)</h2>
          <Link className="btn primary" href="/liff/book">จองที่จอดรถ</Link>
          <Link className="btn" style={{ width: '100%', marginTop: 10 }} href="/liff/my">สมาชิก &amp; การจอง</Link>
        </div>
        <div className="card">
          <h2>ฝั่งทีมงาน</h2>
          <Link className="btn" style={{ width: '100%' }} href="/admin">หน้าแอดมิน</Link>
          <p className="small">หน้าคนขับ: /driver?key=…</p>
        </div>
      </div>
    </main>
  );
}
