-- Demo data: ~40 confirmed bookings over the next 2 weeks so the admin page looks alive.
-- Run once in the SQL Editor after the migrations. Safe to delete: all demo rows use line_user_id 'demo-seed-%'.

insert into drivers (name, phone) values ('สมชาย (คันที่ 1)', '0800000001'), ('สมศักดิ์ (คันที่ 2)', '0800000002');
update vehicles set driver_id = (select id from drivers where name like '%คันที่ 1%') where name = 'คันที่ 1';
update vehicles set driver_id = (select id from drivers where name like '%คันที่ 2%') where name = 'คันที่ 2';

do $$
declare
  names text[] := array['กมล','จิราพร','ธนพล','นภัสสร','ปิยะ','พิมพ์ชนก','วรวุฒิ','ศิริพร','สุรเชษฐ์','อรอุมา','เกียรติศักดิ์','ณัฐวุฒิ'];
  provinces text[] := array['กรุงเทพมหานคร','สมุทรปราการ','นนทบุรี','ปทุมธานี','ชลบุรี'];
  b bookings;
  s date;
  len int;
  sh boolean;
  px int;
  t record;
begin
  for i in 1..40 loop
    s   := today_bkk() + (random() * 13)::int;
    len := 1 + (random() * 5)::int;
    sh  := random() < 0.7;
    px  := 1 + (random() * 5)::int;
    begin
      b := create_booking(
        'demo-seed-' || i, names[1 + (i % array_length(names, 1))], '08' || lpad((10000000 + i * 7919)::text, 8, '0'),
        (1 + i % 9)::text || 'กข ' || (1000 + i * 37)::text, provinces[1 + (i % array_length(provinces, 1))],
        s, s + len - 1, sh, case when sh then px end,
        null, case when sh then ((s::timestamp + make_interval(hours => 5 + (random() * 14)::int)) at time zone 'Asia/Bangkok') end,
        null, case when sh then (((s + len - 1)::timestamp + make_interval(hours => 6 + (random() * 15)::int)) at time zone 'Asia/Bangkok') end
      );
      update payments set status = 'verified', verified_by = 'seed', paid_at = now() where booking_id = b.id;
      update bookings set status = 'confirmed', hold_expires_at = null where id = b.id;
      for t in select id from shuttle_trips where booking_id = b.id and pickup_at is not null loop
        perform assign_vehicle(t.id);
      end loop;
    exception when others then
      raise notice 'skip %: %', i, sqlerrm;   -- e.g. a day already full
    end;
  end loop;
  -- Demo: the plate-reader queue starts mostly done, a few left for the admin to tick.
  update lpr_sync set status = 'done', done_at = now()
  where id in (select id from lpr_sync order by id offset 5);
end $$;

-- To remove the demo data later:
-- delete from bookings where customer_id in (select id from customers where line_user_id like 'demo-seed-%');
-- delete from customers where line_user_id like 'demo-seed-%';
