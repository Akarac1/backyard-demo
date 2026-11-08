import Link from 'next/link';
import type { Session } from '@/lib/session';
import { StaffNav } from './StaffNav';

const ADMIN_ITEMS = [
  { href: '/admin', label: 'ภาพรวม' },
  { href: '/admin/bookings', label: 'การจอง' },
  { href: '/admin/trips', label: 'รถรับส่ง' },
  { href: '/admin/members', label: 'สมาชิก' },
  { href: '/admin/campaigns', label: 'แคมเปญ' },
  { href: '/driver', label: 'หน้าคนขับ' },
  { href: '/exec', label: 'รายงาน' },
  { href: '/admin/settings', label: 'ตั้งค่า' },
  { href: '/admin/users', label: 'ผู้ใช้' },
];
const EXEC_ITEMS = [{ href: '/exec', label: 'รายงาน' }];
const DRIVER_ITEMS = [{ href: '/driver', label: 'งานของฉัน' }];
const ROLE_LABEL = { admin: 'แอดมิน', exec: 'ผู้บริหาร', driver: 'คนขับ' } as const;

export function StaffShell({ staff, children }: { staff: Session; children: React.ReactNode }) {
  return (
    <div className="staff">
      <header className="staff-top">
        <div className="staff-top-in">
          <Link href={staff.role === 'admin' ? '/admin' : staff.role === 'driver' ? '/driver' : '/exec'} className="staff-brand">
            <img src="/logo.png" alt="" width={36} height={35} />
            <span>Backyard<small>หลังบ้าน</small></span>
          </Link>
          <StaffNav items={staff.role === 'admin' ? ADMIN_ITEMS : staff.role === 'driver' ? DRIVER_ITEMS : EXEC_ITEMS} />
          <div className="staff-user">
            <Link href="/account" title="บัญชีของฉัน">{staff.name}<small>{ROLE_LABEL[staff.role]}</small></Link>
            <form action="/api/auth/logout" method="post"><button className="btn-ghost">ออกจากระบบ</button></form>
          </div>
        </div>
      </header>
      <div className="staff-body">{children}</div>
    </div>
  );
}
