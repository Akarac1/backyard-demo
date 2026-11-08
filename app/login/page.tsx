'use client';
import { Suspense, useState } from 'react';
import { useSearchParams } from 'next/navigation';

function LoginForm() {
  const params = useSearchParams();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function submit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const f = new FormData(e.currentTarget);
    setBusy(true); setError(null);
    const r = await fetch('/api/auth/login', {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ username: f.get('username'), password: f.get('password'), next: params.get('next') }),
    });
    const j = await r.json().catch(() => ({}));
    if (r.ok && j.redirect) { window.location.href = j.redirect; return; }
    setBusy(false);
    setError(j.error ?? 'เข้าสู่ระบบไม่สำเร็จ');
  }

  return (
    <form className="login-card" onSubmit={submit}>
      <img src="/logo.png" alt="Backyard Airport The Hangar" width={72} height={69} />
      <h1>เข้าสู่ระบบหลังบ้าน</h1>
      <p className="small">สำหรับแอดมินและผู้บริหาร Backyard Airport</p>
      <label htmlFor="username">ชื่อผู้ใช้</label>
      <input id="username" name="username" autoComplete="username" autoCapitalize="none" required autoFocus />
      <label htmlFor="password">รหัสผ่าน</label>
      <input id="password" name="password" type="password" autoComplete="current-password" required />
      {error && <div className="alert bad" role="alert">{error}</div>}
      <button className="btn primary" disabled={busy}>{busy ? 'กำลังเข้าสู่ระบบ…' : 'เข้าสู่ระบบ'}</button>
      <p className="small" style={{ textAlign: 'center', marginTop: 14 }}>ลืมรหัสผ่าน? ติดต่อแอดมินให้ตั้งรหัสใหม่</p>
    </form>
  );
}

export default function LoginPage() {
  return (
    <main className="login-page">
      <Suspense><LoginForm /></Suspense>
    </main>
  );
}
