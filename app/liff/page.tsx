'use client';
import { useEffect } from 'react';
import { useRouter } from 'next/navigation';
import { useT } from '@/components/Lang';

/**
 * LIFF endpoint (https://<domain>/liff). liff.line.me/<id>/my arrives here as ?liff.state=/my;
 * liff.init() then moves to /liff/my. With no liff.state we open the booking form.
 */
export default function LiffRoot() {
  const router = useRouter();
  const { t } = useT();
  useEffect(() => {
    const state = new URLSearchParams(window.location.search).get('liff.state');
    const liffId = process.env.NEXT_PUBLIC_LIFF_ID;
    if (state && liffId) {
      import('@line/liff').then(({ default: liff }) => liff.init({ liffId })).catch(() => router.replace('/liff/book'));
    } else {
      router.replace('/liff/book');
    }
  }, [router]);
  return <main className="wrap"><p className="small">{t('กำลังเปิด…')}</p></main>;
}
