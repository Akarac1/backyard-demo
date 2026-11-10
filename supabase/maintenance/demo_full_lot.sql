-- =====================================================================
-- DEMO: ทำให้ลานจอดเต็มวันที่ 11 และ 13 พ.ย. 2026 (ไว้โชว์ว่าวันเต็มแล้วจองไม่ได้)
--
-- * ใส่การจองตัวอย่าง (ยืนยันแล้ว, ไม่ใช้รถรับส่ง) จนวันที่ 11 และ 13 เต็มพอดี
-- * วันที่ 12 ยังว่างอยู่ ไว้โชว์เทียบว่าวันว่างยังจองได้
-- * ทุกแถวมีป้าย DEMO-FULL: ลบออกได้หมดด้วยไฟล์ demo_full_lot_remove.sql
-- * ไม่ส่งทะเบียนไปที่ระบบอ่านป้าย ไม่ส่งข้อความ LINE และไม่ใช้เลขสมาชิกจริง
-- * รันซ้ำได้: ลบชุด DEMO เดิมก่อน แล้วคำนวณจำนวนใหม่ตามที่จองจริงอยู่ ณ ตอนนั้น
-- =====================================================================
do $$
declare
  d11 constant date := date '2026-11-11';
  d13 constant date := date '2026-11-13';
  cap int;
  price int;
  n_both int;      -- จอดยาว 10–14 (กินทั้งวัน 11, 12, 13)
  n11 int;         -- เฉพาะช่วงวันที่ 11
  n13 int;         -- เฉพาะช่วงวันที่ 13
  i int := 0;
  k int;
  s date; e date;
  cid uuid;
  names text[] := array['สมชาย','สมหญิง','วิชัย','อรุณี','ประเสริฐ','กาญจนา','ธนพล','นภัส','ศักดิ์ชัย','พิมพ์ชนก',
                        'อนุชา','จิราพร','ธีรวัฒน์','สุภาวดี','ณัฐพล','วรรณา','กิตติ','ปวีณา','เอกชัย','ศิริพร'];
  letters text[] := array['กข','กค','ขก','ฆต','งจ','ชบ','ฌร','ญล','ฐท','ถน','บม','ผย','พร','ภว','มส','รห','ลอ','วฮ','สก','หข'];
  provs text[] := array['กรุงเทพมหานคร','นนทบุรี','ปทุมธานี','สมุทรปราการ','ชลบุรี'];
begin
  -- ลบชุด DEMO เดิม (ถ้ามี)
  delete from lpr_sync  where booking_id in (select id from bookings where admin_note = 'DEMO-FULL');
  delete from bookings  where admin_note = 'DEMO-FULL';
  delete from customers where line_user_id like 'demo-full-%';

  select total_spots - reserve_spots, price_per_day into cap, price from settings where id = 1;

  -- จอดยาวครอบทั้ง 11–13: ใช้ราว 55% ของที่ว่าง วันที่ 12 จึงยังว่างอยู่
  n_both := greatest(0, least(cap - spots_used(d11), cap - spots_used(d13), (cap * 55) / 100));
  n11 := greatest(0, cap - spots_used(d11) - n_both);
  n13 := greatest(0, cap - spots_used(d13) - n_both);

  for k in 1 .. n_both + n11 + n13 loop
    i := i + 1;
    if k <= n_both then
      s := date '2026-11-10' + (k % 2); e := date '2026-11-13' + (k % 2);          -- 10–13 / 11–14
    elsif k <= n_both + n11 then
      s := d11 - (k % 3); e := d11;                                                -- 9–11 / 10–11 / 11
    else
      s := d13; e := d13 + (k % 3);                                                -- 13 / 13–14 / 13–15
    end if;

    insert into customers (line_user_id, name, phone, member_no)
    values ('demo-full-' || i, names[1 + (i % 20)] || ' (ตัวอย่าง)', '09' || lpad((10000000 + i)::text, 8, '0'), 'DEMO' || lpad(i::text, 3, '0'))
    returning id into cid;

    insert into bookings (customer_id, plate, plate_province, start_date, end_date, parking_amount, shuttle, status, admin_note)
    values (cid, letters[1 + (i % 20)] || ' ' || (1000 + (i * 37) % 9000), provs[1 + (i % 5)], s, e,
            (e - s + 1) * price, false, 'confirmed', 'DEMO-FULL');
  end loop;

  -- กันไว้อีกชั้น: ไม่ให้ทะเบียนตัวอย่างไปถึงระบบอ่านป้าย
  delete from lpr_sync where booking_id in (select id from bookings where admin_note = 'DEMO-FULL');

  raise notice 'ใส่การจองตัวอย่าง % รายการ', i;
end $$;

-- ตรวจผล: วันที่ 11 และ 13 ต้องเต็ม (ว่าง = 0) วันที่ 12 ยังว่าง
select d::date as วันที่,
       spots_used(d::date) as จองแล้ว,
       (select total_spots - reserve_spots from settings where id = 1) - spots_used(d::date) as ว่าง
from generate_series(date '2026-11-10', date '2026-11-14', interval '1 day') d
order by 1;
