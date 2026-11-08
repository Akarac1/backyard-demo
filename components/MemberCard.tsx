/** Backyard member card (Bronze / Silver / Gold). Pure markup: usable in LINE pages and in the admin. */
export type CardProps = { tier: string; tierName: string; name?: string | null; memberNo?: string | null; points?: number; multiplier?: number };

export function MemberCard({ tier, tierName, name, memberNo, points, multiplier }: CardProps) {
  return (
    <div className={`mcard mcard-${tier}`} role="img" aria-label={`บัตรสมาชิก Backyard ระดับ ${tierName}`}>
      <div className="mcard-shine" />
      <div className="mcard-top">
        <img src="/logo.png" alt="" width={44} height={42} />
        <div className="mcard-brand"><b>BACKYARD</b><span>MEMBER</span></div>
        <div className="mcard-tier">{tierName.toUpperCase()}</div>
      </div>
      <div className="mcard-chip" aria-hidden="true" />
      <div className="mcard-bottom">
        <div>
          <div className="mcard-name">{name || 'BACKYARD MEMBER'}</div>
          <div className="mcard-no">{memberNo ?? 'BY000000'}</div>
        </div>
        <div className="mcard-pts">
          {points != null && <><b>{points.toLocaleString('th-TH')}</b><span>POINTS</span></>}
          {multiplier != null && <em>x{Number(multiplier).toString()} แต้ม</em>}
        </div>
      </div>
      <div className="mcard-foot">AIRPORT · THE HANGAR</div>
    </div>
  );
}
