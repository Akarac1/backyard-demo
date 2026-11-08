-- Tests for 0008_call_the_van.sql (fresh database after 0001–0008)
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
-- return pickup in 30 minutes -> welcome is due (no landing time saved: due 45 min before pickup)
select code is not null as ok from create_booking('U1','สมชาย','0811111111','1กข 1234','กทม', today_bkk(), today_bkk(), true, 2, null, now() - interval '2 days', null, now() + interval '30 minutes');
select status from confirm_payment((select id from payments limit 1), 'test');
\echo '--- welcome due once'
select count(*) = 1 as ok from trips_due_welcome();
select trip_mark_welcome((select id from trips_due_welcome() limit 1)) as first_ok;
select trip_mark_welcome((select id from shuttle_trips where direction='from_airport')) = false as second_is_noop;
select count(*) = 0 as ok from trips_due_welcome();
\echo '--- landing time in the future: not due yet'
update shuttle_trips set welcome_sent_at = null, landing_at = now() + interval '1 hour' where direction='from_airport';
select count(*) = 0 as ok from trips_due_welcome();
update shuttle_trips set landing_at = now() - interval '5 minutes' where direction='from_airport';
select count(*) = 1 as ok from trips_due_welcome();
\echo '--- customer call: only the owner, only return trip, idempotent'
select pg_temp.expect_error($$select customer_call_trip('U999', (select id from shuttle_trips where direction='from_airport'))$$, 'not_your_trip');
select pg_temp.expect_error($$select customer_call_trip('U1', (select id from shuttle_trips where direction='to_airport'))$$, 'not_return_trip');
select customer_call_trip('U1', (select id from shuttle_trips where direction='from_airport')) is not null as ok;
select called_by = 'customer' as ok from shuttle_trips where direction='from_airport';
create temp table first_call as select called_at from shuttle_trips where direction='from_airport';
select pg_sleep(0.05);
select customer_call_trip('U1', (select id from shuttle_trips where direction='from_airport')) = (select called_at from first_call) as same_time;
select count(*) = 0 as called_trip_not_due_for_welcome from trips_due_welcome();
\echo '--- driver acknowledges, finishes; closed trip cannot be called'
select status = 'en_route' as ok from driver_set_trip_status((select id from staff_users where username='drva'), (select id from shuttle_trips where direction='from_airport'), 'en_route');
select status = 'done' as ok from driver_set_trip_status((select id from staff_users where username='drva'), (select id from shuttle_trips where direction='from_airport'), 'done');
update shuttle_trips set called_at = null where direction='from_airport';
select pg_temp.expect_error($$select customer_call_trip('U1', (select id from shuttle_trips where direction='from_airport'))$$, 'trip_closed');
\echo '--- staff records a phone call; staff re-sends welcome'
select pg_temp.expect_error($$select staff_call_trip((select id from staff_users where username='drva'), (select id from shuttle_trips where direction='to_airport'))$$, 'not_return_trip');
select staff_mark_welcome((select id from staff_users where username='drva'), (select id from shuttle_trips where direction='from_airport'));
select welcome_sent_at is not null as ok from shuttle_trips where direction='from_airport';
\echo 'ALL DONE'
