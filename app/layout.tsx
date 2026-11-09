import './globals.css';
import type { Metadata, Viewport } from 'next';
import { headers } from 'next/headers';

export const metadata: Metadata = { title: 'Backyard Airport · The Hangar', description: 'จองที่จอดรถใกล้สุวรรณภูมิ', icons: { icon: '/logo.png' } };
export const viewport: Viewport = { width: 'device-width', initialScale: 1, themeColor: '#0E3320' };

// Pages are rendered per request so each gets a fresh CSP nonce (see middleware.ts).
export default async function RootLayout({ children }: { children: React.ReactNode }) {
  await headers();
  return (
    <html lang="th">
      <head>
        <link rel="preconnect" href="https://fonts.googleapis.com" />
        <link rel="stylesheet" href="https://fonts.googleapis.com/css2?family=Kanit:wght@400;500;600;700&display=swap" />
      </head>
      <body>{children}</body>
    </html>
  );
}
