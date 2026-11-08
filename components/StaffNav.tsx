'use client';
import Link from 'next/link';
import { usePathname } from 'next/navigation';

type Item = { href: string; label: string };

export function StaffNav({ items }: { items: Item[] }) {
  const path = usePathname();
  const active = (href: string) => (href === '/admin' ? path === '/admin' : path.startsWith(href));
  return (
    <nav className="staff-nav" aria-label="เมนูหลังบ้าน">
      {items.map((i) => (
        <Link key={i.href} href={i.href} className={active(i.href) ? 'on' : ''} aria-current={active(i.href) ? 'page' : undefined}>{i.label}</Link>
      ))}
    </nav>
  );
}
