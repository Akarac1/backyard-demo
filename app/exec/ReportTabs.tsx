import Link from 'next/link';

/** Switch between the two executive reports, keeping the chosen period. */
export function ReportTabs({ active, grain }: { active: 'money' | 'shuttle'; grain: string }) {
  return (
    <nav className="seg report-tabs" aria-label="เลือกรายงาน">
      <Link href={`/exec?p=${grain}`} className={active === 'money' ? 'on' : ''}>รายได้และลูกค้า</Link>
      <Link href={`/exec/shuttle?p=${grain}`} className={active === 'shuttle' ? 'on' : ''}>รถรับส่ง</Link>
    </nav>
  );
}
