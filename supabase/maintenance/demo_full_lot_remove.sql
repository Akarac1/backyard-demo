-- ลบการจองตัวอย่างจาก demo_full_lot.sql ออกทั้งหมด (ข้อมูลจริงไม่ถูกแตะ)
do $$
declare n int;
begin
  delete from lpr_sync where booking_id in (select id from bookings where admin_note = 'DEMO-FULL');
  delete from point_lots   where booking_id in (select id from bookings where admin_note = 'DEMO-FULL');
  delete from point_spends where booking_id in (select id from bookings where admin_note = 'DEMO-FULL');
  delete from bookings where admin_note = 'DEMO-FULL';
  get diagnostics n = row_count;
  delete from customers where line_user_id like 'demo-full-%';
  raise notice 'ลบการจองตัวอย่าง % รายการ', n;
end $$;

-- ตรวจผล: ต้องเป็น 0 ทั้งสองแถว
select 'bookings' t, count(*) from bookings where admin_note = 'DEMO-FULL'
union all select 'customers', count(*) from customers where line_user_id like 'demo-full-%';
