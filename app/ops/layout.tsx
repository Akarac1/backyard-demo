import { requireStaff } from '@/lib/auth';
import { StaffShell } from '@/components/StaffShell';

export const dynamic = 'force-dynamic';

export default async function OpsLayout({ children }: { children: React.ReactNode }) {
  const staff = await requireStaff(['admin', 'ops']);
  return <StaffShell staff={staff}>{children}</StaffShell>;
}
