import './globals.css';
import type { Metadata, Viewport } from 'next';

export const metadata: Metadata = { title: 'Backyard Airport · The Hangar', description: 'จองที่จอดรถใกล้สุวรรณภูมิ', icons: { icon: '/logo.png' } };
export const viewport: Viewport = { width: 'device-width', initialScale: 1, themeColor: '#0E3320' };

export default function RootLayout({ children }: { children: React.ReactNode }) {
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
