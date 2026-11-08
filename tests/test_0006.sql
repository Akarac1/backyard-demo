-- Tests for 0006_drivers.sql (fresh database after 0001–0006)
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
select staff_create('drv1', 'คนขับคันที่ 1', 'driver', 'driver-pass-1', (select id from staff_users where username='owner')) is not null as ok;
select staff_create('drv2', 'คนขับคันที่ 2', 'driver', 'driver-pass-2', (select id from staff_users where username='owner')) is not null as ok;
select staff_set_vehicle((select id from staff_users where username='owner'), (select id from staff_users where username='drv1'), (select id from vehicles where name='คันที่ 1'));
select staff_set_vehicle((select id from staff_users where username='owner'), (select id from staff_users where username='drv2'), (select id from vehicles where name='คันที่ 2'));
select role = 'driver' as ok from staff_login('drv1', 'driver-pass-1');

\echo '--- booking with 2 pax -> car 1'
select code is not null as ok from create_booking('U1','สมชาย','0811111111','1กข 1234','กทม', today_bkk()+1, today_bkk()+3, true, 2, null, now() + interval '1 day', null, now() + interval '3 days');
select status from confirm_payment((select id from payments limit 1), 'test');
do $$ declare r record; begin for r in select id from shuttle_trips loop perform assign_vehicle(r.id); end loop; end $$;
select count(*) = 2 as ok from shuttle_trips t join vehicles v on v.id = t.vehicle_id where v.name = 'คันที่ 1';

\echo '--- driver of car 2 cannot touch car 1 trip'
select pg_temp.expect_error($$select driver_set_trip_status((select id from staff_users where username='drv2'), (select id from shuttle_trips where direction='to_airport'), 'arrived')$$, 'not_your_trip');
select pg_temp.expect_error($$select driver_set_trip_status((select id from staff_users where username='drv1'), (select id from shuttle_trips where direction='to_airport'), 'picked_up')$$, 'bad_status');

\echo '--- driver of car 1: arrived -> en_route -> done with timestamps'
select status = 'arrived' and arrived_at is not null as ok from driver_set_trip_status((select id from staff_users where username='drv1'), (select id from shuttle_trips where direction='to_airport'), 'arrived');
select status = 'en_route' and departed_at is not null as ok from driver_set_trip_status((select id from staff_users where username='drv1'), (select id from shuttle_trips where direction='to_airport'), 'en_route');
select status = 'done' and completed_at is not null as ok from driver_set_trip_status((select id from staff_users where username='drv1'), (select id from shuttle_trips where direction='to_airport'), 'done');
select count(*) = 3 as ok from trip_events where status is not null;

\echo '--- notes: driver note stays open until admin acks; admin note is already resolved'
select driver_add_note((select id from staff_users where username='drv1'), (select id from shuttle_trips where direction='from_airport'), 'รถติดหนัก ถึงช้า 15 นาที') > 0 as ok;
select note_resolved = false and driver_note like 'รถติด%' as ok from shuttle_trips where direction='from_airport';
select pg_temp.expect_error($$select driver_add_note((select id from staff_users where username='drv1'), (select id from shuttle_trips where direction='from_airport'), '   ')$$, 'empty_note');
select pg_temp.expect_error($$select admin_ack_trip_note((select id from staff_users where username='drv1'), (select id from shuttle_trips where direction='from_airport'))$$, 'not_allowed');
select admin_ack_trip_note((select id from staff_users where username='owner'), (select id from shuttle_trips where direction='from_airport'));
select note_resolved as ok from shuttle_trips where direction='from_airport';
select trip_event_notified(trip_last_event((select id from shuttle_trips where direction='from_airport')));
select notified as ok from trip_events order by id desc limit 1;

\echo '--- deactivated driver is blocked; drivers cannot use admin functions'
select pg_temp.expect_error($$select admin_update_trip((select id from staff_users where username='drv1'), (select id from shuttle_trips limit 1), null, null)$$, 'not_allowed');
select staff_update((select id from staff_users where username='owner'), (select id from staff_users where username='drv1'), 'คนขับคันที่ 1', 'driver', false, null);
select pg_temp.expect_error($$select driver_set_trip_status((select id from staff_users where username='drv1'), (select id from shuttle_trips where direction='from_airport'), 'en_route')$$, 'not_allowed');
\echo 'ALL DONE'
