/** Backyard member card (Bronze / Silver / Gold, and the invitation-only Black Diamond). Pure markup: usable in LINE pages and in the admin. */
export type CardProps = { tier: string; tierName: string; name?: string | null; memberNo?: string | null; points?: number; multiplier?: number;
  /** the word for points next to the multiplier, and the card's spoken label (customer pages pass their language) */
  pointsWord?: string; label?: string };

export function MemberCard({ tier, tierName, name, memberNo, points, multiplier, pointsWord = 'แต้ม', label }: CardProps) {
  return (
    <div className={`mcard mcard-${tier}`} role="img" aria-label={label ?? `บัตรสมาชิก Backyard ระดับ ${tierName}`}>
      <div className="mcard-shine" />
      <div className="mcard-top">
        <img src="/logo.png" alt="" width={44} height={42} />
        <div className="mcard-brand"><b>BACKYARD</b><span>MEMBER</span></div>
        <div className="mcard-tier">{tier === 'blackdiamond' ? <>BLACK<br />DIAMOND</> : tierName.toUpperCase()}</div>
      </div>
      <div className="mcard-chip" aria-hidden="true" />
      {tier === 'blackdiamond' && (
        <svg className="mcard-gem" viewBox="0 0 54 46" aria-hidden="true">
          <defs>
            <linearGradient id="gemg" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stopColor="#fff3cf" /><stop offset=".5" stopColor="#d3ac55" /><stop offset="1" stopColor="#7d5a1c" /></linearGradient>
          </defs>
          <path d="M14 2h26l13 15-26 27L1 17z" fill="#0c0c0e" stroke="url(#gemg)" strokeWidth="1.6" strokeLinejoin="round" />
          <path d="M1 17h52M14 2l13 15 13-15M27 17v27M14 2L19 17l8 27M40 2l-5 15-8 27" fill="none" stroke="url(#gemg)" strokeWidth=".9" strokeLinejoin="round" opacity=".85" />
        </svg>
      )}
      <div className="mcard-bottom">
        <div>
          <div className="mcard-name">{name || 'BACKYARD MEMBER'}</div>
          <div className="mcard-no">{memberNo ?? 'BY000000'}</div>
        </div>
        <div className="mcard-pts">
          {points != null && <><b>{points.toLocaleString('th-TH')}</b><span>POINTS</span></>}
          {multiplier != null && <em>x{Number(multiplier).toString()} {pointsWord}</em>}
        </div>
      </div>
      <div className="mcard-foot">{tier === 'blackdiamond' ? 'BY INVITATION · THE HANGAR' : 'AIRPORT · THE HANGAR'}</div>
    </div>
  );
}
