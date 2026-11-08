-- 0019: front-of-house staff role + car in / out from the driver's buttons
--   * new staff role 'ops' (หัวหน้าหน้างาน): sees the on-site screen only — cars in / out today,
--     things to check, check a car in / out, give compensation points (capped)
--   * shuttle customers: the car is marked IN when the driver presses "พร้อมรับที่ลาน" or "ออกเดินทาง"
--     on the trip to the airport, and OUT when the driver presses "ส่งถึงลาน" on the trip back
--   * who / what changed the status is kept in checked_in_by / checked_out_by
-- Run after 0018.

alter type staff_role add value if not exists 'ops';

alter table bookings add column if not exists checked_in_by  text;
alter table bookings add column if not exists checked_out_by text;
alter table settings add column if not exists ops_points_max int not null default 50;

create or replace function staff_require_role(p_actor uuid, p_roles text[]) returns staff_users
language plpgsql stable set search_path = public as $$
declare u staff_users;
begin
  u := staff_actor(p_actor);
  if not (u.role::text = any(p_roles)) then raise exception 'not_allowed'; end if;
  return u;
end $$;

-- ---------------------------------------------------------------------
-- car in / out from the shuttle steps
-- ---------------------------------------------------------------------
create or replace function trips_car_status_trg() returns trigger
language plpgsql set search_path = public as $$
declare
  who text;
begin
  if new.status::text = old.status::text then return new; end if;
  select 'คนขับ ' || display_name into who from staff_users where id = new.driver_staff_id;
  who := coalesce(who, 'คนขับ');
  if new.direction = 'to_airport' and new.status::text in ('arrived', 'en_route', 'done') then
    update bookings set status = 'checked_in', checked_in_at = now(), checked_in_by = who, updated_at = now()
    where id = new.booking_id and status = 'confirmed';
  elsif new.direction = 'from_airport' and new.status::text = 'done' then
    update bookings set status = 'checked_out',
      checked_in_at = coalesce(checked_in_at, now()), checked_in_by = coalesce(checked_in_by, who),
      checked_out_at = now(), checked_out_by = who, updated_at = now()
    where id = new.booking_id and status in ('confirmed', 'checked_in');
  end if;
  return new;
end $$;

drop trigger if exists trips_car_status on shuttle_trips;
create trigger trips_car_status after update of status on shuttle_trips
  for each row execute function trips_car_status_trg();

-- ---------------------------------------------------------------------
-- status changes by staff: admin as before; ops only car in / out (and undo a check-in)
-- ---------------------------------------------------------------------
create or replace function admin_set_booking_status(p_actor uuid, p_id uuid, p_status booking_status)
returns bookings
language plpgsql set search_path = public as $$
declare
  a staff_users;
  b bookings;
  v_old booking_status;
begin
  a := staff_require_role(p_actor, array['admin', 'ops']);
  select * into b from bookings where id = p_id for update;
  if not found then raise exception 'not_found'; end if;
  v_old := b.status;
  if a.role::text = 'ops' and p_status::text not in ('checked_in', 'checked_out', 'confirmed') then
    raise exception 'not_allowed';
  end if;
  if not (
       (v_old = 'confirmed' and p_status in ('checked_in', 'cancelled', 'no_show'))
    or (v_old = 'checked_in' and p_status in ('checked_out', 'confirmed'))
    or (v_old in ('pending_payment', 'expired') and p_status = 'cancelled')
  ) then raise exception 'bad_status_change'; end if;

  update bookings set
    status = p_status,
    checked_in_at  = case when p_status = 'checked_in' then now() when p_status = 'confirmed' then null else checked_in_at end,
    checked_in_by  = case when p_status = 'checked_in' then a.display_name when p_status = 'confirmed' then null else checked_in_by end,
    checked_out_at = case when p_status = 'checked_out' then now() else checked_out_at end,
    checked_out_by = case when p_status = 'checked_out' then a.display_name else checked_out_by end,
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
-- compensation points: admin any amount (+/-), ops add up to settings.ops_points_max per entry
-- error: invalid_points | points_over_limit | not_found
-- ---------------------------------------------------------------------
create or replace function staff_give_points(p_actor uuid, p_customer uuid, p_points int, p_note text)
returns int
language plpgsql set search_path = public as $$
declare a staff_users; lim int;
begin
  a := staff_require_role(p_actor, array['admin', 'ops']);
  if p_points is null or p_points = 0 or abs(p_points) > 100000 or nullif(trim(p_note), '') is null then raise exception 'invalid_points'; end if;
  if a.role::text = 'ops' then
    select ops_points_max into lim from settings where id = 1;
    if p_points < 0 or p_points > lim then raise exception 'points_over_limit'; end if;
  end if;
  if not exists (select 1 from customers where id = p_customer) then raise exception 'not_found'; end if;
  if p_points > 0 then
    perform points_add(p_customer, null, p_points, 'admin', null, null, 'ชดเชย: ' || trim(p_note) || ' (' || a.display_name || ')');
  else
    perform points_take(p_customer, -p_points, 'admin', null, trim(p_note) || ' (' || a.display_name || ')');
  end if;
  perform audit(a, 'points', 'customer', p_customer::text, jsonb_build_object('points', p_points, 'note', p_note));
  return points_balance(p_customer);
end $$;

-- on-site staff can also press the shuttle buttons for a driver (e.g. a driver's phone is flat)
create or replace function driver_trip_for(p_actor uuid, p_trip_id uuid) returns shuttle_trips
language plpgsql set search_path = public as $$
declare
  u staff_users;
  t shuttle_trips;
begin
  u := staff_actor(p_actor);
  if u.role::text not in ('admin', 'driver', 'ops') then raise exception 'not_allowed'; end if;
  select * into t from shuttle_trips where id = p_trip_id for update;
  if not found then raise exception 'not_found'; end if;
  return t;
end $$;

do $$ declare fn text; begin
  foreach fn in array array['staff_require_role(uuid,text[])', 'staff_give_points(uuid,uuid,int,text)'] loop
    execute format('revoke execute on function %s from public', fn);
    if exists (select 1 from pg_roles where rolname = 'anon') then
      execute format('revoke execute on function %s from anon, authenticated', fn);
    end if;
    if exists (select 1 from pg_roles where rolname = 'service_role') then
      execute format('grant execute on function %s to service_role', fn);
    end if;
  end loop;
end $$;

notify pgrst, 'reload schema';
