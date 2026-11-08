import { requireStaff } from '@/lib/auth';
import { StaffShell } from '@/components/StaffShell';

export const dynamic = 'force-dynamic';

export default async function AccountLayout({ children }: { children: React.ReactNode }) {
  const staff = await requireStaff(['admin', 'exec']);
  return <StaffShell staff={staff}>{children}</StaffShell>;
}
