import { db } from '@/lib/supabase';
import { ActionForm, Submit } from '@/components/ActionForm';
import { thDate } from '@/lib/format';
import { setBlackout, clearBlackout } from '../actions';

type Row = { day: string; note: string | null };

/** group consecutive days with the same note into one range, for a shorter list */
function group(rows: Row[]) {
  const out: { from: string; to: string; note: string | null }[] = [];
  for (const r of rows) {
    const last = out[out.length - 1];
    const nextDay = last && new Date(Date.parse(last.to) + 864e5).toISOString().slice(0, 10);
    if (last && last.note === r.note && nextDay === r.day) last.to = r.day;
    else out.push({ from: r.day, to: r.day, note: r.note });
  }
  return out;
}

/** Days the lot is closed to new bookings (e.g. no one on site). Existing confirmed bookings are not affected. */
export async function Blackout() {
  const today = new Date().toLocaleDateString('en-CA', { timeZone: 'Asia/Bangkok' });
  const { data } = await db().from('blackout_dates').select('day, note').gte('day', today).order('day');
  const ranges = group((data ?? []) as Row[]);
  return (
    <section className="panel">
      <h2>ปิดลาน (ไม่ให้จองวันนี้)</h2>
      <p className="hint">เลือกวันที่ไม่มีคนอยู่ลาน ลูกค้าจะจองวันนั้นไม่ได้ (เลื่อนวันเข้าก็เลือกวันนี้ไม่ได้เหมือนกัน) · ไม่กระทบการจองที่ยืนยันแล้วอยู่ก่อนหน้า ต้องจัดการเองถ้าจำเป็น</p>
      {ranges.length > 0 && (
        <div className="veh-list">
          {ranges.map((r) => (
            <div key={r.from} className="veh-card">
              <div className="veh-head">
                <div>
                  <b>{r.from === r.to ? thDate(r.from) : `${thDate(r.from)} – ${thDate(r.to)}`}</b>
                  {r.note && <span className="veh-sub">{r.note}</span>}
                </div>
                {r.from === r.to ? (
                  <ActionForm action={clearBlackout} className="veh-del">
                    <input type="hidden" name="day" value={r.from} />
                    <Submit variant="danger" small>เปิดวันนี้</Submit>
                  </ActionForm>
                ) : (
                  <p className="small" style={{ margin: 0 }}>เปิดทีละวันด้านล่าง</p>
                )}
              </div>
              {r.from !== r.to && (
                <div className="form-actions" style={{ flexWrap: 'wrap', gap: 6 }}>
                  {Array.from({ length: (Date.parse(r.to) - Date.parse(r.from)) / 864e5 + 1 }, (_, i) => {
                    const d = new Date(Date.parse(r.from) + i * 864e5).toISOString().slice(0, 10);
                    return (
                      <ActionForm key={d} action={clearBlackout}>
                        <input type="hidden" name="day" value={d} />
                        <Submit variant="danger" small>เปิด {thDate(d)}</Submit>
                      </ActionForm>
                    );
                  })}
                </div>
              )}
            </div>
          ))}
        </div>
      )}
      <details className="veh-add" open={ranges.length === 0}>
        <summary>+ ปิดลานวันที่เลือก</summary>
        <ActionForm action={setBlackout} className="form grid2" resetOnOk>
          <label>วันที่ปิด (เริ่ม)<input name="start" type="date" min={today} required /></label>
          <label>ถึงวันที่<input name="end" type="date" min={today} /><small>ไม่กรอก = ปิดวันเดียว</small></label>
          <label className="span2">หมายเหตุ (เห็นเฉพาะทีมงาน)<input name="note" placeholder="เช่น ปีใหม่ ไม่มีคนเฝ้าลาน" maxLength={120} /></label>
          <div className="form-actions span2"><Submit>ปิดลานวันนี้</Submit></div>
        </ActionForm>
      </details>
    </section>
  );
}
