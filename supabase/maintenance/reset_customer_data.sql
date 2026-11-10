-- =====================================================================
-- RESET: ลบข้อมูลลูกค้าและการจองทั้งหมด (ย้อนกลับไม่ได้) — ไม่ใช่ migration อย่ารันซ้ำโดยไม่ตั้งใจ
--
-- ลบ:  ลูกค้า · การจอง · การชำระเงิน/สลิป (ข้อมูลในตาราง) · เที่ยวรถรับส่ง + ประวัติเที่ยว · คะแนนคนขับ
--       คิวทะเบียนไม้กั้น · แต้ม/การใช้แต้ม · คูปองของลูกค้า · ยอดซื้อคาเฟ่/ที่พัก · ข้อมูลเที่ยวบินที่เก็บไว้
--       เลขสมาชิกเริ่มนับใหม่
-- เก็บ: ตั้งค่าร้าน · รถรับส่ง · บัญชีพนักงาน · แคมเปญ · ของรางวัล · ระดับสมาชิก · ข้อมูลสายการบิน/ประตู
--       ลิงก์จอ TV · รายชื่อเบอร์ลูกค้าเก่าที่นำเข้า (member_phones) — ดูตัวเลือกด้านล่าง
--
-- ไฟล์สลิปในที่เก็บไฟล์ (Storage bucket "slips") ไม่ถูกลบด้วยสคริปต์นี้ ให้ลบใน Supabase → Storage
-- =====================================================================

-- ---------- ตัวเลือก (แก้ค่าก่อนรัน) ----------
-- allow_active: ถ้ามีการจองจริงที่ยังไม่จบ (ยืนยันแล้ว/รถอยู่ในลาน) ระบบจะไม่ยอมลบ เว้นแต่ตั้งเป็น true
-- clear_old_member_phones: true = ลบรายชื่อเบอร์ลูกค้าเก่าที่นำเข้าไว้ด้วย
-- clear_staff_logs: true = ลบประวัติการแก้ไขของพนักงาน (admin_audit) และประวัติสถานะระบบด้วย
do $$
declare
  allow_active boolean := false;
  clear_old_member_phones boolean := false;
  clear_staff_logs boolean := false;
  n_active int;
begin
  select count(*) into n_active from bookings
  where status::text in ('confirmed', 'checked_in') and end_date >= (now() at time zone 'Asia/Bangkok')::date;
  if n_active > 0 and not allow_active then
    raise exception 'ยังมีการจองที่ยังไม่จบ % รายการ ถ้าแน่ใจว่าเป็นข้อมูลทดสอบ ให้แก้ allow_active := true แล้วรันใหม่', n_active;
  end if;

  truncate table
    point_spend_lots, point_lots, point_spends, coupons, member_purchases,
    trip_ratings, trip_events, shuttle_trips, flights,
    lpr_events, lpr_sync, payments, bookings, customers
  restart identity;

  perform setval('member_no_seq', 1, false);

  if clear_old_member_phones then truncate table member_phones; end if;
  if clear_staff_logs then truncate table admin_audit, system_events, uptime_pings restart identity; end if;

  raise notice 'ลบข้อมูลลูกค้าและการจองเรียบร้อย';
end $$;

-- ตรวจผล: ทุกแถวควรเป็น 0
select 'customers' t, count(*) from customers union all
select 'bookings', count(*) from bookings union all
select 'payments', count(*) from payments union all
select 'shuttle_trips', count(*) from shuttle_trips union all
select 'point_lots', count(*) from point_lots union all
select 'coupons', count(*) from coupons;
