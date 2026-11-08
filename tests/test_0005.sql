-- Tests for 0005_staff_and_admin.sql (run on a fresh database after 0001–0005)
\set ON_ERROR_STOP on
create or replace function pg_temp.expect_error(sql text, want text) returns void language plpgsql as $$
begin
  execute sql;
  raise exception 'expected error % but none', want;
exception when others then
  if sqlerrm not like want || '%' then raise exception 'expected % got %', want, sqlerrm; end if;
  raise notice 'ok error %', sqlerrm;
end $$;

\echo '--- 1. first admin without actor, then second needs an admin'
select staff_create('owner', 'เจ้าของ', 'admin', 'correct-horse-1', null) is not null as ok;
select pg_temp.expect_error($$select staff_create('x2', 'x', 'exec', 'long-enough-pw', null)$$, 'not_allowed');
select pg_temp.expect_error($$select staff_create('boss', 'ผู้บริหาร', 'exec', 'short', (select id from staff_users where username='owner'))$$, 'weak_password');
select staff_create('Boss', 'ผู้บริหาร', 'exec', 'exec-password-1', (select id from staff_users where username='owner')) is not null as ok;
select pg_temp.expect_error($$select staff_create('boss', 'dup', 'exec', 'exec-password-1', (select id from staff_users where username='owner'))$$, 'username_taken');

\echo '--- 2. login ok / wrong password / lockout after 5'
select role = 'admin' as ok from staff_login('OWNER', 'correct-horse-1');
select count(*) = 0 as ok from staff_login('owner', 'wrong');
select count(*) = 0 as ok from staff_login('nobody', 'whatever');
do $$ begin for i in 1..5 loop perform staff_login('boss', 'nope'); end loop; end $$;
select pg_temp.expect_error($$select * from staff_login('boss', 'exec-password-1')$$, 'locked');

\echo '--- 3. exec cannot use admin functions; last admin protected'
select pg_temp.expect_error($$select admin_update_settings((select id from staff_users where username='boss'), 60,5,100,120,300,15,7,'x')$$, 'not_allowed');
select pg_temp.expect_error($$select staff_update((select id from staff_users where username='owner'), (select id from staff_users where username='owner'), 'x', 'exec', true, null)$$, 'last_admin');
select staff_update((select id from staff_users where username='owner'), (select id from staff_users where username='boss'), 'ผู้บริหาร', 'exec', true, 'new-exec-pass-2');
select role = 'exec' as ok from staff_login('boss', 'new-exec-pass-2');

\echo '--- 4. booking edit, status flow, LPR queue follows plate change'
select code is not null as ok from create_booking('U1','สมชาย','0811111111','1กข 1234','กรุงเทพมหานคร', today_bkk()+3, today_bkk()+5, true, 2, null, now() + interval '3 days', null, now() + interval '5 days');
select status from confirm_payment((select id from payments limit 1), 'test');
select plate = '2ขค999' and pax = 3 and end_date = today_bkk()+6 as ok
from admin_update_booking((select id from staff_users where username='owner'), (select id from bookings limit 1),
  'สมชาย ใจดี', '0822222222', '2ขค   999', 'นนทบุรี', today_bkk()+3, today_bkk()+6, 3, 'ลูกค้าโทรมาแก้');
select (select name from customers limit 1) = 'สมชาย ใจดี' as name_ok, (select count(*) from shuttle_trips where pax = 3) = 2 as trips_ok;
select array_agg(action || ':' || plate order by id) from lpr_sync;
select pg_temp.expect_error($$select admin_set_booking_status((select id from staff_users where username='owner'), (select id from bookings limit 1), 'checked_out')$$, 'bad_status_change');
select status = 'checked_in' and checked_in_at is not null as ok from admin_set_booking_status((select id from staff_users where username='owner'), (select id from bookings limit 1), 'checked_in');

\echo '--- 5. extra days (uses reserve) + payment recorded'
select end_date = today_bkk()+8 as ok from admin_add_extra_days((select id from staff_users where username='owner'), (select id from bookings limit 1), 2, true);
select amount = 240 and status = 'verified' as ok from payments where kind = 'overstay';

\echo '--- 6. trips: lock vehicle, busy check'
select vehicle_id is not null and assignment_locked as ok from admin_update_trip((select id from staff_users where username='owner'),
  (select id from shuttle_trips where direction='to_airport'), (select id from vehicles where name='คันที่ 2'), null);
select pg_temp.expect_error($$select admin_update_trip((select id from staff_users where username='owner'), (select id from shuttle_trips where direction='to_airport'), (select id from vehicles where name='คันที่ 1'), null)$$, 'too_many_pax');

\echo '--- 7. settings validation + audit trail'
select pg_temp.expect_error($$select admin_update_settings((select id from staff_users where username='owner'), 60,60,100,120,300,15,7,'x')$$, 'invalid_settings');
select price_per_day = 120 as ok from admin_update_settings((select id from staff_users where username='owner'), 60,5,120,150,300,15,7,'ชั้น 2 ประตู 4');
select count(*) >= 6 as ok, array_agg(distinct entity) from admin_audit;

\echo '--- 8. cancel removes plate from barrier'
select status from admin_set_booking_status((select id from staff_users where username='owner'), (select id from bookings limit 1), 'confirmed');
select status from admin_set_booking_status((select id from staff_users where username='owner'), (select id from bookings limit 1), 'cancelled');
select action = 'remove' as ok from lpr_sync order by id desc limit 1;
select count(*) = 0 as ok from shuttle_trips where status <> 'cancelled';
\echo 'ALL DONE'
