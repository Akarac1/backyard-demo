-- =====================================================================
-- Backyard: "call the van" for the return trip
--   1. At the landing time the customer gets a "Welcome to Suvarnabhumi" card in LINE
--   2. With their bags in hand they press "call the van" (and confirm)
--   3. The driver board shows the call; the driver acknowledges and sets off (about 15 minutes)
-- Run after 0001–0007. Safe to re-run.
-- =====================================================================

alter table shuttle_trips add column if not exists landing_at      timestamptz;  -- flight landing time the customer entered
alter table shuttle_trips add column if not exists welcome_sent_at timestamptz;
alter table shuttle_trips add column if not exists called_at       timestamptz;  -- customer is ready to be picked up
alter table shuttle_trips add column if not exists called_by       text;         -- 'customer' (button) or 'staff' (phone call)

-- Return trips whose welcome card is due: landing time reached (or 45 minutes before the planned pickup
-- when no landing time was saved), not sent yet, nobody on the way, and not older than 12 hours.
create or replace function trips_due_welcome() returns table (id uuid)
language sql stable set search_path = public as $$
  select t.id
  from shuttle_trips t
  join bookings b on b.id = t.booking_id
  where t.direction = 'from_airport'
    and t.welcome_sent_at is null
    and t.called_at is null
    and t.status::text in ('unassigned', 'assigned')
    and b.status in ('confirmed', 'checked_in')
    and coalesce(t.landing_at, t.pickup_at - interval '45 minutes') <= now()
    and coalesce(t.landing_at, t.pickup_at) > now() - interval '12 hours'
  order by t.pickup_at
  limit 50
$$;

-- Mark the welcome card as sent. Returns true only for the first caller, so a card is never sent twice
-- by overlapping scheduler runs.
create or replace function trip_mark_welcome(p_trip_id uuid) returns boolean
language plpgsql set search_path = public as $$
begin
  update shuttle_trips set welcome_sent_at = now(), updated_at = now()
  where id = p_trip_id and welcome_sent_at is null;
  return found;
end $$;

-- Driver/admin sends (or re-sends) the welcome card by hand
create or replace function staff_mark_welcome(p_actor uuid, p_trip_id uuid) returns void
language plpgsql set search_path = public as $$
declare
  u staff_users;
  t shuttle_trips;
begin
  u := staff_actor(p_actor);
  t := driver_trip_for(p_actor, p_trip_id);
  if t.direction <> 'from_airport' then raise exception 'not_return_trip'; end if;
  update shuttle_trips set welcome_sent_at = now(), updated_at = now() where id = t.id;
  insert into trip_events (trip_id, staff_id, staff_name, note) values (t.id, u.id, u.display_name, 'ส่งข้อความต้อนรับ');
end $$;

-- The customer presses "call the van" in LINE. Pressing again does not move the time.
-- error: not_found | not_your_trip | not_return_trip | trip_closed
create or replace function customer_call_trip(p_line_user_id text, p_trip_id uuid) returns timestamptz
language plpgsql set search_path = public as $$
declare
  t shuttle_trips;
  owner text;
begin
  select * into t from shuttle_trips where id = p_trip_id for update;
  if not found then raise exception 'not_found'; end if;
  select c.line_user_id into owner from bookings b join customers c on c.id = b.customer_id where b.id = t.booking_id;
  if owner is distinct from p_line_user_id then raise exception 'not_your_trip'; end if;
  if t.direction <> 'from_airport' then raise exception 'not_return_trip'; end if;
  if t.status::text in ('done', 'cancelled') then raise exception 'trip_closed'; end if;
  if t.called_at is not null then return t.called_at; end if;

  update shuttle_trips set called_at = now(), called_by = 'customer', updated_at = now() where id = t.id returning called_at into t.called_at;
  insert into trip_events (trip_id, staff_name, note) values (t.id, 'ลูกค้า', 'ลูกค้ากดเรียกรถ');
  return t.called_at;
end $$;

-- A driver/admin records that the customer phoned to ask for the van
create or replace function staff_call_trip(p_actor uuid, p_trip_id uuid) returns timestamptz
language plpgsql set search_path = public as $$
declare
  u staff_users;
  t shuttle_trips;
begin
  u := staff_actor(p_actor);
  t := driver_trip_for(p_actor, p_trip_id);
  if t.direction <> 'from_airport' then raise exception 'not_return_trip'; end if;
  if t.status::text in ('done', 'cancelled') then raise exception 'trip_closed'; end if;
  update shuttle_trips set called_at = coalesce(called_at, now()), called_by = coalesce(called_by, 'staff'), updated_at = now()
  where id = t.id returning * into t;
  insert into trip_events (trip_id, staff_id, staff_name, note) values (t.id, u.id, u.display_name, 'ลูกค้าโทรเรียกรถ');
  return t.called_at;
end $$;

do $$
declare fn text;
begin
  foreach fn in array array[
    'trips_due_welcome()', 'trip_mark_welcome(uuid)', 'staff_mark_welcome(uuid,uuid)',
    'customer_call_trip(text,uuid)', 'staff_call_trip(uuid,uuid)'
  ] loop
    execute format('revoke execute on function %s from public', fn);
    if exists (select 1 from pg_roles where rolname = 'anon') then
      execute format('revoke execute on function %s from anon, authenticated', fn);
    end if;
  end loop;
end $$;
