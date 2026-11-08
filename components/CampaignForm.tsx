'use client';
import { useState } from 'react';
import { ActionForm, Submit } from './ActionForm';
import type { ActionResult } from '@/app/admin/actions';

type Action = (prev: ActionResult, f: FormData) => Promise<ActionResult>;
export type CampaignInit = {
  id?: string; name?: string; description?: string | null; business?: string; tiers?: string[] | null; kind?: string;
  multiplier?: number; bonus_points?: number; starts_at?: string | null; ends_at?: string | null; active?: boolean;
  min_days?: number; free_days?: number; amount_off?: number; percent_off?: number; stackable?: boolean;
  stay_from?: string | null; stay_to?: string | null;
};
type Tier = { code: string; name: string };

const TYPES = [
  { kind: 'free_days', icon: '🅿️', title: 'จอดครบ ฟรีวัน', hint: 'เช่น จอด 10 วัน ฟรี 1 วัน' },
  { kind: 'amount_off', icon: '💸', title: 'จอดครบ ลดเงิน', hint: 'เช่น จอด 30 วัน ลด 500 บาท' },
  { kind: 'percent_off', icon: '🏷️', title: 'ลดค่าจอด %', hint: 'เช่น ปีใหม่ลด 20%' },
  { kind: 'multiplier', icon: '✨', title: 'แต้มคูณ', hint: 'เช่น สงกรานต์แต้ม x2' },
  { kind: 'bonus', icon: '🎁', title: 'แต้มโบนัส', hint: 'เช่น +5 แต้มทุกการจอง' },
  { kind: 'announce', icon: '📣', title: 'ประกาศ', hint: 'ข้อความบนบัตรสมาชิก' },
] as const;

const PRESETS: { label: string; v: CampaignInit }[] = [
  { label: 'จอด 10 วัน ฟรี 1 วัน', v: { kind: 'free_days', name: 'จอด 10 วัน ฟรี 1 วัน', min_days: 10, free_days: 1 } },
  { label: 'จอด 1 เดือน ลด 500', v: { kind: 'amount_off', name: 'จอด 1 เดือน ลด 500 บาท', min_days: 30, amount_off: 500, stackable: false } },
  { label: 'ปีใหม่ ลด 20%', v: { kind: 'percent_off', name: 'ปีใหม่ ลดค่าจอด 20%', min_days: 2, percent_off: 20, stay_from: `${new Date().getFullYear()}-12-28`, stay_to: `${new Date().getFullYear() + 1}-01-03` } },
  { label: 'สงกรานต์แต้ม x2', v: { kind: 'multiplier', name: 'สงกรานต์แต้ม x2', multiplier: 2, business: 'parking', stay_from: `${new Date().getFullYear() + 1}-04-10`, stay_to: `${new Date().getFullYear() + 1}-04-17` } },
];

const day = (ts?: string | null) => (ts ? new Date(ts).toLocaleDateString('en-CA', { timeZone: 'Asia/Bangkok' }) : '');
const thD = (d: string) => new Date(`${d}T00:00:00+07:00`).toLocaleDateString('th-TH', { day: 'numeric', month: 'short', year: '2-digit' });

export function CampaignForm({ action, tiers, init }: { action: Action; tiers: Tier[]; init?: CampaignInit }) {
  const [v, setV] = useState<CampaignInit>({
    kind: 'free_days', min_days: 10, free_days: 1, amount_off: 500, percent_off: 10, multiplier: 2, bonus_points: 5,
    business: 'all', stackable: true, active: true, tiers: [], ...init,
  });
  const [more, setMore] = useState(!!(init?.id && (init.tiers?.length || init.starts_at || init.ends_at)));
  const set = (k: keyof CampaignInit, val: unknown) => setV((x) => ({ ...x, [k]: val }));
  const num = (k: keyof CampaignInit) => (e: React.ChangeEvent<HTMLInputElement>) => set(k, e.target.value === '' ? '' : Number(e.target.value));
  const isDisc = ['free_days', 'amount_off', 'percent_off'].includes(v.kind!);
  const isPoints = ['multiplier', 'bonus'].includes(v.kind!);

  // one sentence that says what the customer gets
  const who = v.tiers?.length ? `สมาชิก ${v.tiers.map((c) => tiers.find((t) => t.code === c)?.name ?? c).join(', ')}` : 'ลูกค้าทุกคน';
  const when = v.stay_from || v.stay_to ? ` ที่เข้าจอด${v.stay_from ? ` ${thD(v.stay_from)}` : ''}${v.stay_to ? ` – ${thD(v.stay_to)}` : ''}` : '';
  const what = v.kind === 'free_days' ? `จอด ${v.min_days || '?'} วันขึ้นไป ฟรี ${v.free_days || '?'} วัน`
    : v.kind === 'amount_off' ? `จอด ${v.min_days || '?'} วันขึ้นไป ลด ${Number(v.amount_off || 0).toLocaleString('th-TH')} บาท`
    : v.kind === 'percent_off' ? `ลดค่าจอด ${v.percent_off || '?'}%${Number(v.min_days) > 1 ? ` เมื่อจอด ${v.min_days} วันขึ้นไป` : ''}`
    : v.kind === 'multiplier' ? `ได้แต้ม x${v.multiplier || '?'}` : v.kind === 'bonus' ? `ได้แต้มเพิ่ม +${v.bonus_points || '?'} ต่อครั้ง` : 'เห็นประกาศนี้บนบัตรสมาชิก';
  const extra = isDisc && !v.stackable ? ' (ไม่ใช้ร่วมกับส่วนลดลูกค้าเก่า)' : '';
  const period = v.ends_at ? ` · จองได้ถึง ${thD(day(v.ends_at) || String(v.ends_at))}` : '';

  return (
    <ActionForm action={action} className="cform" resetOnOk={!init?.id}>
      {v.id && <input type="hidden" name="id" value={v.id} />}
      <input type="hidden" name="kind" value={v.kind} />
      <input type="hidden" name="business" value={isDisc ? 'parking' : v.business} />
      <input type="hidden" name="min_days" value={isDisc ? v.min_days ?? 0 : 0} />
      <input type="hidden" name="free_days" value={v.kind === 'free_days' ? v.free_days ?? 0 : 0} />
      <input type="hidden" name="amount_off" value={v.kind === 'amount_off' ? v.amount_off ?? 0 : 0} />
      <input type="hidden" name="percent_off" value={v.kind === 'percent_off' ? v.percent_off ?? 0 : 0} />
      <input type="hidden" name="multiplier" value={v.kind === 'multiplier' ? v.multiplier ?? 1 : 1} />
      <input type="hidden" name="bonus" value={v.kind === 'bonus' ? v.bonus_points ?? 0 : 0} />
      {isDisc && v.stackable && <input type="hidden" name="stackable" value="on" />}
      {v.active && <input type="hidden" name="active" value="on" />}
      {(v.tiers ?? []).map((t) => <input key={t} type="hidden" name="tiers" value={t} />)}

      {!init?.id && (
        <div className="cform-presets"><span>เริ่มจากตัวอย่าง:</span>
          {PRESETS.map((p) => <button key={p.label} type="button" className="chip-btn" onClick={() => setV((x) => ({ ...x, stackable: true, stay_from: '', stay_to: '', ...p.v }))}>{p.label}</button>)}
        </div>
      )}

      <div className="cform-step"><b>1</b> เลือกประเภท</div>
      <div className="cform-types">
        {TYPES.map((t) => (
          <button key={t.kind} type="button" className={v.kind === t.kind ? 'on' : ''} onClick={() => set('kind', t.kind)}>
            <span>{t.icon}</span><b>{t.title}</b><small>{t.hint}</small>
          </button>
        ))}
      </div>

      <div className="cform-step"><b>2</b> รายละเอียด</div>
      <div className="cform-grid">
        <label className="cf-wide">ชื่อแคมเปญ<input name="name" value={v.name ?? ''} onChange={(e) => set('name', e.target.value)} placeholder="ลูกค้าจะเห็นชื่อนี้" required /></label>
        {v.kind === 'free_days' && <>
          <label>จองอย่างน้อย<span className="with-unit"><input type="number" min={2} value={v.min_days ?? ''} onChange={num('min_days')} required /><em>วัน</em></span></label>
          <label>ฟรี<span className="with-unit"><input type="number" min={1} value={v.free_days ?? ''} onChange={num('free_days')} required /><em>วัน</em></span></label>
        </>}
        {v.kind === 'amount_off' && <>
          <label>จองอย่างน้อย<span className="with-unit"><input type="number" min={1} value={v.min_days ?? ''} onChange={num('min_days')} required /><em>วัน</em></span></label>
          <label>ลด<span className="with-unit"><input type="number" min={1} value={v.amount_off ?? ''} onChange={num('amount_off')} required /><em>บาท</em></span></label>
        </>}
        {v.kind === 'percent_off' && <>
          <label>ลดค่าจอด<span className="with-unit"><input type="number" min={1} max={100} value={v.percent_off ?? ''} onChange={num('percent_off')} required /><em>%</em></span></label>
          <label>จองอย่างน้อย<span className="with-unit"><input type="number" min={1} value={v.min_days ?? ''} onChange={num('min_days')} required /><em>วัน</em></span></label>
        </>}
        {v.kind === 'multiplier' && <label>คูณแต้ม<span className="with-unit"><em>x</em><input type="number" step="0.5" min={1.5} max={10} value={v.multiplier ?? ''} onChange={num('multiplier')} required /></span></label>}
        {v.kind === 'bonus' && <label>แต้มเพิ่ม<span className="with-unit"><input type="number" min={1} value={v.bonus_points ?? ''} onChange={num('bonus_points')} required /><em>แต้ม/ครั้ง</em></span></label>}
        {!isDisc && (
          <label>ใช้กับ
            <select value={v.business} onChange={(e) => set('business', e.target.value)}>
              <option value="all">ทุกธุรกิจ</option><option value="parking">ที่จอดรถ</option><option value="cafe">คาเฟ่</option><option value="stay">ที่พัก</option>
            </select>
          </label>
        )}
        <label className="cf-wide">ข้อความถึงลูกค้า (ไม่บังคับ)<input name="description" value={v.description ?? ''} onChange={(e) => set('description', e.target.value)} placeholder="แสดงบนบัตรสมาชิกใน LINE" /></label>
      </div>

      <div className="cform-step"><b>3</b> ช่วงวันเข้าจอด <small>(ไม่ใส่ = ทุกวัน)</small></div>
      <div className="cform-grid">
        <label>ตั้งแต่<input type="date" name="stay_from" value={v.stay_from ?? ''} onChange={(e) => set('stay_from', e.target.value)} /></label>
        <label>ถึง<input type="date" name="stay_to" value={v.stay_to ?? ''} onChange={(e) => set('stay_to', e.target.value)} /></label>
      </div>

      <button type="button" className="link-btn cform-more" onClick={() => setMore(!more)}>{more ? '▾' : '▸'} ตั้งค่าเพิ่มเติม (ระดับสมาชิก · ช่วงเปิดรับจอง{isDisc ? ' · ใช้ร่วมกับส่วนลด' : ''})</button>
      {more && (
        <div className="cform-grid cform-extra">
          <div className="cf-wide">เฉพาะระดับ <small className="hint">(ไม่เลือก = ทุกระดับ)</small>
            <div className="tier-pills">
              {tiers.map((t) => {
                const on = v.tiers?.includes(t.code);
                return <button key={t.code} type="button" className={`pill pill-${t.code} ${on ? 'on' : ''}`}
                  onClick={() => set('tiers', on ? v.tiers!.filter((x) => x !== t.code) : [...(v.tiers ?? []), t.code])}>{t.name}</button>;
              })}
            </div>
          </div>
          <label>เปิดให้จองตั้งแต่<input type="date" name="starts" defaultValue={day(v.starts_at)} /></label>
          <label>ปิดรับจอง<input type="date" name="ends" value={day(v.ends_at) || (v.ends_at ?? '')} onChange={(e) => set('ends_at', e.target.value)} /><small>ไม่ใส่ = ไม่มีวันปิด</small></label>
          {isDisc && <label className="check cf-wide"><input type="checkbox" checked={!!v.stackable} onChange={(e) => set('stackable', e.target.checked)} /> ใช้ร่วมกับส่วนลดลูกค้าเก่า 100 บาทได้</label>}
          <label className="check cf-wide"><input type="checkbox" checked={!!v.active} onChange={(e) => set('active', e.target.checked)} /> เปิดใช้แคมเปญ</label>
        </div>
      )}

      <div className="cform-preview">
        <span>ลูกค้าจะได้</span>
        <b>{who}{when} {what}{extra}{period}</b>
        {isPoints && v.business !== 'all' && <small>เฉพาะ{v.business === 'parking' ? 'ที่จอดรถ' : v.business === 'cafe' ? 'คาเฟ่' : 'ที่พัก'}</small>}
      </div>
      <div className="form-actions"><Submit>{init?.id ? 'บันทึกการแก้ไข' : 'สร้างแคมเปญ'}</Submit></div>
    </ActionForm>
  );
}
