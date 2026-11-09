import { requireStaff } from '@/lib/auth';
import { StaffShell } from '@/components/StaffShell';

export const dynamic = 'force-dynamic';

export default async function AdminLayout({ children }: { children: React.ReactNode }) {
  const staff = await requireStaff(['admin', 'ops', 'exec']);
  return <StaffShell staff={staff}>{children}</StaffShell>;
}
