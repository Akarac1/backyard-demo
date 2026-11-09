import { headers } from 'next/headers';
import { ActionForm, Submit } from '@/components/ActionForm';
import { rotateTvLink } from '../actions';

/** The secret link for the driver TV board (no login, never logs out). */
export async function TvLink({ token }: { token: string | null }) {
  const h = await headers();
  const base = process.env.NEXT_PUBLIC_BASE_URL || `https://${h.get('x-forwarded-host') ?? h.get('host')}`;
  const url = token ? `${base}/tv/${token}` : null;
  return (
    <section className="panel">
      <h2>จอ TV คนขับ</h2>
      <p className="hint">เปิดลิงก์นี้บนจอ TV ที่ลาน (ไม่ต้องล็อกอิน) จอแสดงงานรับส่ง 6 ชั่วโมงข้างหน้า และส่งเสียงเตือนเมื่อถึงเวลาแล้วยังไม่มีคนรับงาน · เปิดแล้วแตะหน้าจอ 1 ครั้งเพื่อเปิดเสียง · ใครมีลิงก์ก็ดูได้ อย่าส่งต่อ ถ้าหลุดให้กดสร้างลิงก์ใหม่</p>
      {url ? <p className="tv-link"><a href={url} target="_blank" rel="noreferrer">{url}</a></p> : <p className="hint">ยังไม่มีลิงก์ กดปุ่มด้านล่างเพื่อสร้าง</p>}
      <ActionForm action={rotateTvLink} confirm={url ? 'สร้างลิงก์ใหม่? จอที่เปิดลิงก์เก่าอยู่จะใช้ไม่ได้ ต้องเปิดลิงก์ใหม่' : undefined}>
        <Submit small>{url ? 'สร้างลิงก์ใหม่ (ยกเลิกลิงก์เก่า)' : 'สร้างลิงก์จอ TV'}</Submit>
      </ActionForm>
    </section>
  );
}
