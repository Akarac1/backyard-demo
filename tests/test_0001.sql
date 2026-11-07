-- ทดสอบ 0001_init.sql บน Postgres ปกติ
\set ON_ERROR_STOP on
\echo '--- 1. จองปกติ + รถรับส่ง'
select code, days, parking_amount, shuttle_amount, total_amount, status
from create_booking('U1','สมชาย','0811111111','1กข 1234','กรุงเทพมหานคร',
  today_bkk()+10, today_bkk()+12, true, 2, 'TG628', null, 'TG629', null);

\echo '--- 2. ราคา: 3 วัน + รถ = 600'
select total_amount = 600 as ok from bookings where plate = '1กข1234';

\echo '--- 3. ยืนยันจ่าย -> confirmed + คิว LPR add'
select status from confirm_payment((select p.id from payments p join bookings b on b.id=p.booking_id where b.plate='1กข1234'), 'admin');
select action, valid_from = today_bkk()+10 as ok_from from lpr_sync;

\echo '--- 4. เต็ม: เติมให้ครบ 55 คันวันที่ +11 แล้วจองคันที่ 56 ต้อง error'
do $$ begin
  for i in 2..55 loop
    perform create_booking('U'||i,'n','0','P'||i,'กทม', today_bkk()+11, today_bkk()+11);
  end loop;
end $$;
select used, cap, available from check_availability(today_bkk()+11, today_bkk()+11);
do $$ begin
  perform create_booking('U99','n','0','P99','กทม', today_bkk()+11, today_bkk()+11);
  raise exception 'SHOULD HAVE FAILED';
exception when others then
  if sqlerrm like 'full:%' then raise notice 'ok full -> %', sqlerrm; else raise; end if;
end $$;

\echo '--- 5. hold หมดเวลา -> expire_holds คืนที่'
update bookings set hold_expires_at = now() - interval '1 minute' where plate = 'P55';
select expire_holds() as expired;
select used from check_availability(today_bkk()+11, today_bkk()+11);

\echo '--- 6. เลื่อนจอง: เพิ่ม 2 วัน -> extra 240, คิว LPR remove+add, เที่ยวรถรีเซ็ต'
select start_date - today_bkk() as new_start, days, extra_amount_due
from reschedule_booking((select id from bookings where plate='1กข1234'), today_bkk()+30, today_bkk()+34);
select action from lpr_sync order by id;
select direction, status, flight_number is null as reset from shuttle_trips order by direction;
select kind, amount from payments where kind = 'reschedule_extra';

\echo '--- 7. เลื่อนซ้ำต้อง error already_rescheduled'
do $$ begin
  perform reschedule_booking((select id from bookings where plate='1กข1234'), today_bkk()+40, today_bkk()+41);
  raise exception 'SHOULD HAVE FAILED';
exception when others then
  if sqlerrm = 'already_rescheduled' then raise notice 'ok'; else raise; end if;
end $$;

\echo '--- 8. เลื่อนช้ากว่า 7 วันต้อง error too_late'
select status from confirm_payment((select p.id from payments p join bookings b on b.id=p.booking_id where b.plate='P2'), 'admin');
update bookings set start_date = today_bkk()+5, end_date = today_bkk()+5 where plate='P2';
do $$ begin
  perform reschedule_booking((select id from bookings where plate='P2'), today_bkk()+20, today_bkk()+20);
  raise exception 'SHOULD HAVE FAILED';
exception when others then
  if sqlerrm = 'too_late' then raise notice 'ok'; else raise; end if;
end $$;

\echo '--- 9. เกิน 1 ปีจากวันจองต้อง error beyond_one_year'
select status from confirm_payment((select p.id from payments p join bookings b on b.id=p.booking_id where b.plate='P3'), 'admin');
do $$ begin
  perform reschedule_booking((select id from bookings where plate='P3'), today_bkk()+370, today_bkk()+371);
  raise exception 'SHOULD HAVE FAILED';
exception when others then
  if sqlerrm = 'beyond_one_year' then raise notice 'ok'; else raise; end if;
end $$;

\echo '--- 10. จัดรถ: 2 คน -> คันที่ 1, 5 คน -> คันที่ 2, 2 คนเวลาชน -> คันที่ 2, ชนทั้งคู่ -> null'
select (create_booking('A1','a','0','A1','กทม', today_bkk()+50, today_bkk()+52, true, 2, null, (today_bkk()+50)::timestamp + time '08:00', null, null)).code is not null as created;
select (create_booking('A2','a','0','A2','กทม', today_bkk()+50, today_bkk()+52, true, 5, null, (today_bkk()+50)::timestamp + time '10:00', null, null)).code is not null as created;
select (create_booking('A3','a','0','A3','กทม', today_bkk()+50, today_bkk()+52, true, 2, null, (today_bkk()+50)::timestamp + time '08:20', null, null)).code is not null as created;
select (create_booking('A4','a','0','A4','กทม', today_bkk()+50, today_bkk()+52, true, 1, null, (today_bkk()+50)::timestamp + time '08:30', null, null)).code is not null as created;
do $$ declare r record; begin
  for r in select t.id from shuttle_trips t join bookings b on b.id = t.booking_id
           where t.direction = 'to_airport' and b.plate like 'A%' order by t.pickup_at loop
    perform assign_vehicle(r.id);
  end loop;
end $$;
select b.plate, t.pax, to_char(t.pickup_at, 'HH24:MI') as at, coalesce(v.name, '(ไม่มีรถว่าง)') as vehicle, t.status
from shuttle_trips t join bookings b on b.id = t.booking_id
left join vehicles v on v.id = t.vehicle_id
where t.direction = 'to_airport' and b.plate like 'A%'
order by t.pickup_at;

\echo '--- 11. pax เกิน 7 ต้อง error'
do $$ begin
  perform create_booking('X','x','0','X1','กทม', today_bkk()+60, today_bkk()+60, true, 8);
  raise exception 'SHOULD HAVE FAILED';
exception when others then
  if sqlerrm = 'invalid_pax' then raise notice 'ok'; else raise; end if;
end $$;

\echo '--- 12. view occupancy'
select count(*) = 30 as ok from v_occupancy_30d;
\echo 'ALL DONE'
