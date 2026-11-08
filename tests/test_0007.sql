-- Tests for 0007_driver_claims.sql (fresh database after 0001–0007)
\set ON_ERROR_STOP on
create or replace function pg_temp.expect_error(sql text, want text) returns void language plpgsql as $$
begin
  execute sql;
  raise exception 'expected error % but none', want;
exception when others then
  if sqlerrm not like want || '%' then raise exception 'expected % got %', want, sqlerrm; end if;
  raise notice 'ok error %', sqlerrm;
end $$;
select staff_create('owner', 'เจ้าของ', 'admin', 'correct-horse-1', null) is not null as ok;
select staff_create('drva', 'สมศักดิ์', 'driver', 'driver-pass-1', (select id from staff_users where username='owner')) is not null as ok;
select staff_create('drvb', 'สมพงษ์', 'driver', 'driver-pass-2', (select id from staff_users where username='owner')) is not null as ok;
select staff_set_phone((select id from staff_users where username='owner'), (select id from staff_users where username='drva'), '081-234-5678');
select phone = '0812345678' as ok from staff_users where username='drva';
select code is not null as ok from create_booking('U1','สมชาย','0811111111','1กข 1234','กทม', today_bkk()+1, today_bkk()+3, true, 2, null, now() + interval '1 day', null, now() + interval '3 days');
select status from confirm_payment((select id from payments limit 1), 'test');
\echo '--- first press takes the trip (no vehicle link needed)'
select driver_staff_id = (select id from staff_users where username='drva') as ok from driver_set_trip_status((select id from staff_users where username='drva'), (select id from shuttle_trips where direction='from_airport'), 'en_route');
select pg_temp.expect_error($$select driver_set_trip_status((select id from staff_users where username='drvb'), (select id from shuttle_trips where direction='from_airport'), 'arrived')$$, 'taken_by:สมศักดิ์');
select driver_staff_id = (select id from staff_users where username='drvb') as ok from driver_set_trip_status((select id from staff_users where username='drvb'), (select id from shuttle_trips where direction='from_airport'), 'arrived', true);
select note = 'รับงานแทน' as ok from trip_events order by id desc limit 1;
\echo '--- admin pressing does not steal the trip'
select driver_staff_id = (select id from staff_users where username='drvb') as ok from driver_set_trip_status((select id from staff_users where username='owner'), (select id from shuttle_trips where direction='from_airport'), 'done');
\echo '--- exec cannot use driver functions'
select staff_create('boss', 'ผู้บริหาร', 'exec', 'exec-password-1', (select id from staff_users where username='owner')) is not null as ok;
select pg_temp.expect_error($$select driver_set_trip_status((select id from staff_users where username='boss'), (select id from shuttle_trips where direction='to_airport'), 'arrived')$$, 'not_allowed');
\echo 'ALL DONE'
