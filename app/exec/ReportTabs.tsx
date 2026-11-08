import Link from 'next/link';

/** Switch between the two executive reports, keeping the chosen period. */
export function ReportTabs({ active, grain }: { active: 'money' | 'shuttle' | 'points'; grain: string }) {
  return (
    <nav className="seg report-tabs" aria-label="เลือกรายงาน">
      <Link href={`/exec?p=${grain}`} className={active === 'money' ? 'on' : ''}>รายได้และลูกค้า</Link>
      <Link href={`/exec/shuttle?p=${grain}`} className={active === 'shuttle' ? 'on' : ''}>รถรับส่ง</Link>
      <Link href="/exec/points" className={active === 'points' ? 'on' : ''}>บันทึกแต้มลูกค้า</Link>
    </nav>
  );
}
