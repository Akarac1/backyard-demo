'use client';
import { useState } from 'react';
import { useRouter } from 'next/navigation';

export function ActionButton({ url, label, confirm: ask }: { url: string; label: string; confirm?: string }) {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  return (
    <button
      className="btn-sm"
      disabled={busy}
      onClick={async () => {
        if (ask && !window.confirm(ask)) return;
        setBusy(true);
        const r = await fetch(url, { method: 'POST' });
        const j = await r.json().catch(() => ({}));
        setBusy(false);
        if (!r.ok || j.error) window.alert(j.error ?? 'ไม่สำเร็จ');
        router.refresh();
      }}
    >
      {busy ? '…' : label}
    </button>
  );
}
