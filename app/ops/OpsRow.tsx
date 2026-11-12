import Link from 'next/link';
import { ActionButton } from '@/components/ActionForm';
import { opsSetStatus } from '@/app/admin/actions';
import { thDate, thTime } from '@/lib/format';
import { StatusTag } from '@/lib/labels';

export type OpsBooking = {
  id: string; code: string; plate: string; plate_province: string; status: string; start_date: string; end_date: string; days: number;
  shuttle: boolean; pax: number | null; late_grace?: boolean; checked_in_at: string | null; checked_in_by: string | null; checked_out_at: string | null; checked_out_by: string | null;
  customers: { name: string; phone: string; member_no: string | null } | null;
};
export const OPS_SELECT = 'id, code, plate, plate_province, status, start_date, end_date, days, shuttle, pax, late_grace, checked_in_at, checked_in_by, checked_out_at, checked_out_by, customers(name, phone, member_no)';

/** One booking on the on-site screen, with the next button (car in / car out). */
export function OpsRow({ b, note, only }: { b: OpsBooking; note?: string; only?: 'in' | 'out' }) {
  return (
    <li className="ops-row">
      <div className="ops-plate"><b>{b.plate}</b><small>{b.plate_province}</small></div>
      <div className="ops-main">
        <div><Link href={`/ops/b/${b.code}`} className="code">{b.code}</Link> · {b.customers?.name} · <a href={`tel:${b.customers?.phone}`}>{b.customers?.phone}</a></div>
        <small>
          {thDate(b.start_date)} – {thDate(b.end_date)} ({b.days} วัน) · {b.shuttle ? `รถรับส่ง ${b.pax} คน` : 'ไม่ใช้รถรับส่ง'}
          {b.checked_in_at && ` · เข้า ${thTime(b.checked_in_at)}${b.checked_in_by ? ` (${b.checked_in_by})` : ''}`}
          {b.checked_out_at && ` · ออก ${thTime(b.checked_out_at)}${b.checked_out_by ? ` (${b.checked_out_by})` : ''}`}
        </small>
        {note && <small className="ops-note">{note}</small>}
      </div>
      <div className="ops-act">
        <StatusTag status={b.status} />
        {b.status === 'confirmed' && only !== 'out' && <ActionButton action={opsSetStatus} fields={{ id: b.id, status: 'checked_in' }} label="รถเข้าแล้ว" variant="primary" />}
        {b.status === 'checked_in' && only !== 'in' && <ActionButton action={opsSetStatus} fields={{ id: b.id, status: 'checked_out' }} label="รับรถแล้ว" variant="primary" confirm={`ลูกค้ามารับรถ ${b.plate} แล้ว?`} />}
      </div>
    </li>
  );
}
