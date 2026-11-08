-- =====================================================================
-- Backyard: staff login (admin / exec), audit log, and admin edit functions
-- Run after 0001–0004. Safe to re-run.
--
-- Create the first admin once, in the SQL Editor (choose your own password, 10+ characters):
--   select staff_create('admin', 'ผู้ดูแลระบบ', 'admin', 'your-long-password', null);
-- =====================================================================

do $$ begin
  create type staff_role as enum ('admin', 'exec');
exception when duplicate_object then null; end $$;

create table if not exists staff_users (
  id               uuid primary key default gen_random_uuid(),
  username         text unique not null check (username ~ '^[a-z0-9._-]{3,32}$'),
  display_name     text not null,
  role             staff_role not null,
  password_hash    text not null,
  active           boolean not null default true,
  failed_attempts  int not null default 0,
  locked_until     timestamptz,
  last_login_at    timestamptz,
  created_at       timestamptz not null default now()
);

create table if not exists admin_audit (
  id          bigserial primary key,
  staff_id    uuid references staff_users(id),
  staff_name  text,
  action      text not null,
  entity      text not null,
  entity_id   text,
  detail      jsonb,
  at          timestamptz not null default now()
);
create index if not exists admin_audit_entity_idx on admin_audit (entity, entity_id, at desc);

alter table bookings add column if not exists admin_note text;

alter table staff_users enable row level security;
alter table admin_audit enable row level security;

-- ---------------------------------------------------------------------
-- helpers
-- ---------------------------------------------------------------------
create or replace function staff_actor(p_actor uuid) returns staff_users
language plpgsql stable set search_path = public as $$
declare u staff_users;
begin
  select * into u from staff_users where id = p_actor and active;
  if not found then raise exception 'not_allowed'; end if;
  return u;
end $$;

create or replace function staff_require_admin(p_actor uuid) returns staff_users
language plpgsql stable set search_path = public as $$
declare u staff_users;
begin
  u := staff_actor(p_actor);
  if u.role <> 'admin' then raise exception 'not_allowed'; end if;
  return u;
end $$;

create or replace function audit(p_actor staff_users, p_action text, p_entity text, p_entity_id text, p_detail jsonb)
returns void language sql set search_path = public as $$
  insert into admin_audit (staff_id, staff_name, action, entity, entity_id, detail)
  values (p_actor.id, p_actor.display_name, p_action, p_entity, p_entity_id, p_detail);
$$;

-- ---------------------------------------------------------------------
-- staff accounts
-- error: weak_password | username_taken | invalid_username | last_admin | not_allowed
-- ---------------------------------------------------------------------
create or replace function staff_create(p_username text, p_name text, p_role staff_role, p_password text, p_actor uuid)
returns uuid
language plpgsql set search_path = public, extensions as $$
declare
  a staff_users;
  v_id uuid;
begin
  -- the very first account may be created without an actor (from the SQL Editor)
  if exists (select 1 from staff_users) then a := staff_require_admin(p_actor); end if;
  if length(coalesce(p_password, '')) < 10 then raise exception 'weak_password'; end if;
  if lower(p_username) !~ '^[a-z0-9._-]{3,32}$' then raise exception 'invalid_username'; end if;
  if exists (select 1 from staff_users where username = lower(p_username)) then raise exception 'username_taken'; end if;
  insert into staff_users (username, display_name, role, password_hash)
  values (lower(p_username), trim(p_name), p_role, crypt(p_password, gen_salt('bf', 10)))
  returning id into v_id;
  if a.id is not null then
    perform audit(a, 'create', 'staff', v_id::text, jsonb_build_object('username', lower(p_username), 'role', p_role));
  end if;
  return v_id;
end $$;

-- Returns the user on success, nothing on a wrong password. 5 wrong tries lock the account for 15 minutes.
-- error: locked
create or replace function staff_login(p_username text, p_password text)
returns table (id uuid, username text, display_name text, role staff_role)
language plpgsql set search_path = public, extensions as $$
declare u staff_users;
begin
  select * into u from staff_users s where s.username = lower(trim(p_username)) and s.active for update;
  if not found then
    perform crypt(coalesce(p_password, ''), gen_salt('bf', 10));   -- same work as a real check
    return;
  end if;
  if u.locked_until is not null and u.locked_until > now() then raise exception 'locked'; end if;
  if u.password_hash = crypt(coalesce(p_password, ''), u.password_hash) then
    update staff_users s set failed_attempts = 0, locked_until = null, last_login_at = now() where s.id = u.id;
    return query select u.id, u.username, u.display_name, u.role;
  else
    update staff_users s
       set failed_attempts = case when s.failed_attempts + 1 >= 5 then 0 else s.failed_attempts + 1 end,
           locked_until    = case when s.failed_attempts + 1 >= 5 then now() + interval '15 minutes' else s.locked_until end
     where s.id = u.id;
  end if;
end $$;

create or replace function staff_change_own_password(p_actor uuid, p_old text, p_new text)
returns void language plpgsql set search_path = public, extensions as $$
declare u staff_users;
begin
  u := staff_actor(p_actor);
  if u.password_hash <> crypt(coalesce(p_old, ''), u.password_hash) then raise exception 'wrong_password'; end if;
  if length(coalesce(p_new, '')) < 10 then raise exception 'weak_password'; end if;
  update staff_users set password_hash = crypt(p_new, gen_salt('bf', 10)) where id = u.id;
  perform audit(u, 'change_password', 'staff', u.id::text, null);
end $$;

create or replace function staff_update(p_actor uuid, p_id uuid, p_name text, p_role staff_role, p_active boolean, p_new_password text)
returns void language plpgsql set search_path = public, extensions as $$
declare
  a staff_users;
  u staff_users;
begin
  a := staff_require_admin(p_actor);
  select * into u from staff_users where id = p_id for update;
  if not found then raise exception 'not_found'; end if;
  -- never leave the system without an active admin
  if u.role = 'admin' and u.active and (p_role <> 'admin' or not p_active)
     and (select count(*) from staff_users where role = 'admin' and active) <= 1 then
    raise exception 'last_admin';
  end if;
  if p_new_password is not null and p_new_password <> '' and length(p_new_password) < 10 then raise exception 'weak_password'; end if;
  update staff_users set
    display_name = coalesce(nullif(trim(p_name), ''), display_name),
    role = p_role,
    active = p_active,
    failed_attempts = 0, locked_until = null,
    password_hash = case when coalesce(p_new_password, '') <> '' then crypt(p_new_password, gen_salt('bf', 10)) else password_hash end
  where id = p_id;
  perform audit(a, 'update', 'staff', p_id::text,
    jsonb_build_object('role', p_role, 'active', p_active, 'password_reset', coalesce(p_new_password, '') <> ''));
end $$;

-- ---------------------------------------------------------------------
-- plate reader queue: also follow plate changes and edits while the car is in the lot
-- ---------------------------------------------------------------------
create or replace function enqueue_lpr_sync() returns trigger
language plpgsql as $$
declare
  was_active boolean := old.status in ('confirmed', 'checked_in');
  is_active  boolean := new.status in ('confirmed', 'checked_in');
begin
  if is_active and not was_active and old.status in ('pending_payment', 'expired') then
    insert into lpr_sync (booking_id, plate, plate_province, action, valid_from, valid_to)
    values (new.id, new.plate, new.plate_province, 'add', new.start_date, new.end_date);

  elsif is_active and was_active
        and (new.start_date, new.end_date, new.plate, new.plate_province)
            is distinct from (old.start_date, old.end_date, old.plate, old.plate_province) then
    insert into lpr_sync (booking_id, plate, plate_province, action, valid_from, valid_to)
    values (new.id, old.plate, old.plate_province, 'remove', old.start_date, old.end_date),
           (new.id, new.plate, new.plate_province, 'add',    new.start_date, new.end_date);

  elsif was_active and new.status in ('cancelled', 'no_show') then
    insert into lpr_sync (booking_id, plate, plate_province, action, valid_from, valid_to)
    values (new.id, old.plate, old.plate_province, 'remove', old.start_date, old.end_date);
  end if;
  return new;
end $$;

drop trigger if exists bookings_lpr_sync on bookings;
create trigger bookings_lpr_sync
after update of status, start_date, end_date, plate, plate_province on bookings
for each row execute function enqueue_lpr_sync();

-- ---------------------------------------------------------------------
-- capacity check for admin edits: admins may use the reserve spots
-- ---------------------------------------------------------------------
create or replace function admin_first_full_day(p_start date, p_end date, p_exclude uuid) returns date
language sql stable set search_path = public as $$
  select d::date
  from generate_series(p_start, p_end, interval '1 day') d, settings s
  where s.id = 1 and spots_used(d::date, p_exclude) >= s.total_spots
  order by d limit 1
$$;

-- ---------------------------------------------------------------------
-- edit a booking (customer, car, dates, passengers, note). Prices are not recalculated.
-- error: not_found | invalid_range | invalid_pax | full:<date> | not_allowed
-- ---------------------------------------------------------------------
create or replace function admin_update_booking(
  p_actor uuid, p_id uuid, p_name text, p_phone text, p_plate text, p_province text,
  p_start date, p_end date, p_pax int, p_note text)
returns bookings
language plpgsql set search_path = public as $$
declare
  a staff_users;
  b bookings;
  v_full date;
  v_before jsonb;
begin
  a := staff_require_admin(p_actor);
  perform pg_advisory_xact_lock(hashtext('backyard_capacity'));
  select * into b from bookings where id = p_id for update;
  if not found then raise exception 'not_found'; end if;
  if p_end < p_start then raise exception 'invalid_range'; end if;
  if b.shuttle and (p_pax is null or p_pax < 1 or p_pax > 7) then raise exception 'invalid_pax'; end if;

  if b.status in ('confirmed', 'checked_in', 'pending_payment') and (p_start, p_end) is distinct from (b.start_date, b.end_date) then
    v_full := admin_first_full_day(p_start, p_end, b.id);
    if v_full is not null then raise exception 'full:%', v_full; end if;
  end if;

  v_before := jsonb_build_object('plate', b.plate, 'province', b.plate_province, 'start', b.start_date, 'end', b.end_date, 'pax', b.pax);

  update customers set name = coalesce(nullif(trim(p_name), ''), name), phone = coalesce(nullif(trim(p_phone), ''), phone)
  where id = b.customer_id;

  update bookings set
    plate = upper(regexp_replace(coalesce(nullif(trim(p_plate), ''), plate), '\s+', '', 'g')),   -- same format as create_booking
    plate_province = coalesce(nullif(trim(p_province), ''), plate_province),
    start_date = p_start, end_date = p_end,
    pax = case when shuttle then p_pax else null end,
    admin_note = nullif(trim(p_note), ''),
    updated_at = now()
  where id = b.id returning * into b;

  if b.shuttle then update shuttle_trips set pax = p_pax where booking_id = b.id; end if;

  perform audit(a, 'update', 'booking', b.id::text, jsonb_build_object('before', v_before,
    'after', jsonb_build_object('plate', b.plate, 'province', b.plate_province, 'start', b.start_date, 'end', b.end_date, 'pax', b.pax)));
  return b;
end $$;

-- ---------------------------------------------------------------------
-- change a booking's status
-- allowed: confirmed -> checked_in | cancelled | no_show
--          checked_in -> checked_out | confirmed (undo check-in)
--          pending_payment / expired -> cancelled
-- error: not_found | bad_status_change | not_allowed
-- ---------------------------------------------------------------------
create or replace function admin_set_booking_status(p_actor uuid, p_id uuid, p_status booking_status)
returns bookings
language plpgsql set search_path = public as $$
declare
  a staff_users;
  b bookings;
  v_old booking_status;
begin
  a := staff_require_admin(p_actor);
  select * into b from bookings where id = p_id for update;
  if not found then raise exception 'not_found'; end if;
  v_old := b.status;
  if not (
       (v_old = 'confirmed' and p_status in ('checked_in', 'cancelled', 'no_show'))
    or (v_old = 'checked_in' and p_status in ('checked_out', 'confirmed'))
    or (v_old in ('pending_payment', 'expired') and p_status = 'cancelled')
  ) then raise exception 'bad_status_change'; end if;

  update bookings set
    status = p_status,
    checked_in_at  = case when p_status = 'checked_in' then now() when p_status = 'confirmed' then null else checked_in_at end,
    checked_out_at = case when p_status = 'checked_out' then now() else checked_out_at end,
    hold_expires_at = case when p_status = 'cancelled' then null else hold_expires_at end,
    updated_at = now()
  where id = b.id returning * into b;

  if p_status in ('cancelled', 'no_show') then
    update shuttle_trips set status = 'cancelled' where booking_id = b.id and status <> 'done';
    update payments set status = 'rejected' where booking_id = b.id and status = 'pending';
  end if;

  perform audit(a, 'status', 'booking', b.id::text, jsonb_build_object('from', v_old, 'to', p_status));
  return b;
end $$;

-- ---------------------------------------------------------------------
-- record money received by the admin (cash or a transfer checked by eye)
-- error: not_found | payment_not_pending | full_after_hold_expired:<date> | not_allowed
-- ---------------------------------------------------------------------
create or replace function admin_mark_paid(p_actor uuid, p_booking_id uuid, p_method text)
returns bookings
language plpgsql set search_path = public as $$
declare
  a staff_users;
  p payments;
  b bookings;
begin
  a := staff_require_admin(p_actor);
  select * into p from payments where booking_id = p_booking_id and kind = 'booking' and status = 'pending'
  order by created_at desc limit 1;
  if not found then raise exception 'payment_not_pending'; end if;
  b := confirm_payment(p.id, 'admin:' || a.username || ':' || coalesce(nullif(p_method, ''), 'manual'));
  perform audit(a, 'mark_paid', 'booking', p_booking_id::text, jsonb_build_object('amount', p.amount, 'method', p_method));
  return b;
end $$;

-- ---------------------------------------------------------------------
-- extra days: extend the stay and record the money (extra_price_per_day per day)
-- error: not_found | bad_status | invalid_days | full:<date> | not_allowed
-- ---------------------------------------------------------------------
create or replace function admin_add_extra_days(p_actor uuid, p_booking_id uuid, p_days int, p_paid boolean)
returns bookings
language plpgsql set search_path = public as $$
declare
  a staff_users;
  b bookings;
  s settings;
  v_full date;
  v_amount int;
begin
  a := staff_require_admin(p_actor);
  if p_days is null or p_days < 1 or p_days > 60 then raise exception 'invalid_days'; end if;
  perform pg_advisory_xact_lock(hashtext('backyard_capacity'));
  select * into b from bookings where id = p_booking_id for update;
  if not found then raise exception 'not_found'; end if;
  if b.status not in ('confirmed', 'checked_in') then raise exception 'bad_status'; end if;
  select * into s from settings where id = 1;

  v_full := admin_first_full_day(b.end_date + 1, b.end_date + p_days, b.id);
  if v_full is not null then raise exception 'full:%', v_full; end if;

  v_amount := p_days * s.extra_price_per_day;
  update bookings set end_date = end_date + p_days, updated_at = now() where id = b.id returning * into b;
  insert into payments (booking_id, kind, amount, status, verified_by, paid_at)
  values (b.id, 'overstay', v_amount,
          case when p_paid then 'verified'::payment_status else 'pending'::payment_status end,
          case when p_paid then 'admin:' || a.username end,
          case when p_paid then now() end);

  perform audit(a, 'extra_days', 'booking', b.id::text, jsonb_build_object('days', p_days, 'amount', v_amount, 'paid', p_paid));
  return b;
end $$;

-- ---------------------------------------------------------------------
-- edit a shuttle trip: vehicle and/or pickup time. A vehicle chosen by hand is locked.
-- error: not_found | vehicle_busy | too_many_pax | not_allowed
-- ---------------------------------------------------------------------
create or replace function admin_update_trip(p_actor uuid, p_trip_id uuid, p_vehicle_id uuid, p_pickup_at timestamptz)
returns shuttle_trips
language plpgsql set search_path = public as $$
declare
  a staff_users;
  t shuttle_trips;
  v vehicles;
  s settings;
begin
  a := staff_require_admin(p_actor);
  select * into t from shuttle_trips where id = p_trip_id for update;
  if not found then raise exception 'not_found'; end if;
  select * into s from settings where id = 1;
  if p_vehicle_id is not null then
    select * into v from vehicles where id = p_vehicle_id;
    if not found then raise exception 'not_found'; end if;
    if v.seats < t.pax then raise exception 'too_many_pax'; end if;
    if exists (
      select 1 from shuttle_trips o
      where o.vehicle_id = p_vehicle_id and o.id <> t.id and o.status not in ('done', 'cancelled')
        and abs(extract(epoch from (o.pickup_at - coalesce(p_pickup_at, t.pickup_at)))) < s.trip_minutes * 60
    ) then raise exception 'vehicle_busy'; end if;
  end if;

  update shuttle_trips set
    pickup_at = coalesce(p_pickup_at, pickup_at),
    vehicle_id = p_vehicle_id,
    assignment_locked = p_vehicle_id is not null,
    status = case when p_vehicle_id is null then 'unassigned'::trip_status
                  when status = 'unassigned' then 'assigned'::trip_status else status end,
    updated_at = now()
  where id = t.id returning * into t;

  perform audit(a, 'update', 'trip', t.id::text, jsonb_build_object('vehicle', p_vehicle_id, 'pickup_at', t.pickup_at));
  return t;
end $$;

-- ---------------------------------------------------------------------
-- settings
-- error: invalid_settings | not_allowed
-- ---------------------------------------------------------------------
create or replace function admin_update_settings(
  p_actor uuid, p_total int, p_reserve int, p_price int, p_extra int, p_shuttle int,
  p_hold int, p_reschedule_days int, p_meeting text)
returns settings
language plpgsql set search_path = public as $$
declare
  a staff_users;
  s settings;
  v_before settings;
begin
  a := staff_require_admin(p_actor);
  if p_total < 1 or p_reserve < 0 or p_reserve >= p_total or p_price < 0 or p_extra < 0 or p_shuttle < 0
     or p_hold < 5 or p_hold > 120 or p_reschedule_days < 0 then
    raise exception 'invalid_settings';
  end if;
  select * into v_before from settings where id = 1;
  update settings set total_spots = p_total, reserve_spots = p_reserve, price_per_day = p_price,
    extra_price_per_day = p_extra, shuttle_price = p_shuttle, hold_minutes = p_hold,
    reschedule_min_days = p_reschedule_days, pickup_meeting_point = coalesce(nullif(trim(p_meeting), ''), pickup_meeting_point)
  where id = 1 returning * into s;
  perform audit(a, 'update', 'settings', '1', jsonb_build_object('before', to_jsonb(v_before) - 'updated_at', 'after', to_jsonb(s) - 'updated_at'));
  return s;
end $$;

-- ---------------------------------------------------------------------
-- plate reader queue item done / payment slip confirmed, with audit
-- ---------------------------------------------------------------------
create or replace function admin_lpr_done(p_actor uuid, p_id bigint) returns void
language plpgsql set search_path = public as $$
declare a staff_users;
begin
  a := staff_require_admin(p_actor);
  update lpr_sync set status = 'done', done_at = now() where id = p_id;
  perform audit(a, 'done', 'lpr', p_id::text, null);
end $$;

create or replace function admin_confirm_slip(p_actor uuid, p_payment_id uuid) returns bookings
language plpgsql set search_path = public as $$
declare
  a staff_users;
  b bookings;
begin
  a := staff_require_admin(p_actor);
  b := confirm_payment(p_payment_id, 'admin:' || a.username || ':slip');
  perform audit(a, 'confirm_slip', 'booking', b.id::text, jsonb_build_object('payment', p_payment_id));
  return b;
end $$;

-- ---------------------------------------------------------------------
-- lock everything down: only the server (service role) may call these
-- ---------------------------------------------------------------------
do $$
declare fn text;
begin
  foreach fn in array array[
    'staff_actor(uuid)', 'staff_require_admin(uuid)', 'audit(staff_users,text,text,text,jsonb)',
    'staff_create(text,text,staff_role,text,uuid)', 'staff_login(text,text)',
    'staff_change_own_password(uuid,text,text)', 'staff_update(uuid,uuid,text,staff_role,boolean,text)',
    'admin_first_full_day(date,date,uuid)',
    'admin_update_booking(uuid,uuid,text,text,text,text,date,date,int,text)',
    'admin_set_booking_status(uuid,uuid,booking_status)', 'admin_mark_paid(uuid,uuid,text)',
    'admin_add_extra_days(uuid,uuid,int,boolean)', 'admin_update_trip(uuid,uuid,uuid,timestamptz)',
    'admin_update_settings(uuid,int,int,int,int,int,int,int,text)',
    'admin_lpr_done(uuid,bigint)', 'admin_confirm_slip(uuid,uuid)'
  ] loop
    execute format('revoke execute on function %s from public', fn);
    if exists (select 1 from pg_roles where rolname = 'anon') then
      execute format('revoke execute on function %s from anon, authenticated', fn);
    end if;
  end loop;
end $$;
