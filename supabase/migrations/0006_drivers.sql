-- =====================================================================
-- Backyard: driver accounts and trip status updates from the driver's phone
-- Run after 0001–0005. Safe to re-run.
--
-- Trip status flow (shuttle_trips.status):
--   to_airport  : assigned -> arrived (ready at the lot) -> en_route (left for the airport) -> done (dropped at the airport)
--   from_airport: assigned -> en_route (left for the airport) -> arrived (at the meeting point) -> done (back at the lot)
-- =====================================================================

alter type staff_role  add value if not exists 'driver';
alter type trip_status add value if not exists 'arrived' after 'en_route';

alter table staff_users   add column if not exists vehicle_id uuid references vehicles(id);
alter table shuttle_trips add column if not exists departed_at   timestamptz;
alter table shuttle_trips add column if not exists arrived_at    timestamptz;
alter table shuttle_trips add column if not exists completed_at  timestamptz;
alter table shuttle_trips add column if not exists driver_note   text;
alter table shuttle_trips add column if not exists note_at       timestamptz;
alter table shuttle_trips add column if not exists note_resolved boolean not null default true;

create table if not exists trip_events (
  id          bigserial primary key,
  trip_id     uuid not null references shuttle_trips(id) on delete cascade,
  staff_id    uuid references staff_users(id),
  staff_name  text,
  status      text,              -- new status, or null for a note
  note        text,
  notified    boolean not null default false,   -- message sent to the customer
  at          timestamptz not null default now()
);
create index if not exists trip_events_trip_idx on trip_events (trip_id, at desc);
alter table trip_events enable row level security;

-- ---------------------------------------------------------------------
-- link a driver account to a vehicle (admin only)
-- ---------------------------------------------------------------------
create or replace function staff_set_vehicle(p_actor uuid, p_id uuid, p_vehicle_id uuid) returns void
language plpgsql set search_path = public as $$
declare a staff_users;
begin
  a := staff_require_admin(p_actor);
  update staff_users set vehicle_id = p_vehicle_id where id = p_id;
  if not found then raise exception 'not_found'; end if;
  perform audit(a, 'set_vehicle', 'staff', p_id::text, jsonb_build_object('vehicle', p_vehicle_id));
end $$;

-- a driver may only touch trips of their own vehicle; admins may touch any trip
create or replace function driver_trip_for(p_actor uuid, p_trip_id uuid) returns shuttle_trips
language plpgsql set search_path = public as $$
declare
  u staff_users;
  t shuttle_trips;
begin
  u := staff_actor(p_actor);
  select * into t from shuttle_trips where id = p_trip_id for update;
  if not found then raise exception 'not_found'; end if;
  if u.role::text = 'admin' then return t; end if;
  if u.role::text <> 'driver' or u.vehicle_id is null or t.vehicle_id is distinct from u.vehicle_id then
    raise exception 'not_your_trip';
  end if;
  return t;
end $$;

-- ---------------------------------------------------------------------
-- driver changes a trip's status
-- p_status: 'en_route' | 'arrived' | 'done'
-- error: not_found | not_your_trip | bad_status | trip_cancelled | not_allowed
-- ---------------------------------------------------------------------
create or replace function driver_set_trip_status(p_actor uuid, p_trip_id uuid, p_status text)
returns shuttle_trips
language plpgsql set search_path = public as $$
declare
  u staff_users;
  t shuttle_trips;
begin
  u := staff_actor(p_actor);
  t := driver_trip_for(p_actor, p_trip_id);
  if p_status not in ('en_route', 'arrived', 'done') then raise exception 'bad_status'; end if;
  if t.status::text = 'cancelled' then raise exception 'trip_cancelled'; end if;

  update shuttle_trips set
    status       = p_status::trip_status,
    departed_at  = case when p_status = 'en_route' then now() else departed_at end,
    arrived_at   = case when p_status = 'arrived'  then now() else arrived_at end,
    completed_at = case when p_status = 'done'     then now() else completed_at end,
    updated_at   = now()
  where id = t.id returning * into t;

  insert into trip_events (trip_id, staff_id, staff_name, status) values (t.id, u.id, u.display_name, p_status);
  return t;
end $$;

-- driver (or admin) writes a note about a problem; admins see it until they mark it as read
-- error: not_found | not_your_trip | empty_note | not_allowed
create or replace function driver_add_note(p_actor uuid, p_trip_id uuid, p_note text)
returns bigint
language plpgsql set search_path = public as $$
declare
  u staff_users;
  t shuttle_trips;
  v_id bigint;
begin
  u := staff_actor(p_actor);
  t := driver_trip_for(p_actor, p_trip_id);
  if coalesce(trim(p_note), '') = '' then raise exception 'empty_note'; end if;
  update shuttle_trips set driver_note = left(trim(p_note), 500), note_at = now(), note_resolved = (u.role::text = 'admin'), updated_at = now()
  where id = t.id;
  insert into trip_events (trip_id, staff_id, staff_name, note) values (t.id, u.id, u.display_name, left(trim(p_note), 500))
  returning id into v_id;
  return v_id;
end $$;

create or replace function trip_event_notified(p_event_id bigint) returns void
language sql set search_path = public as $$
  update trip_events set notified = true where id = p_event_id;
$$;

create or replace function admin_ack_trip_note(p_actor uuid, p_trip_id uuid) returns void
language plpgsql set search_path = public as $$
declare a staff_users;
begin
  a := staff_require_admin(p_actor);
  update shuttle_trips set note_resolved = true where id = p_trip_id;
  perform audit(a, 'ack_note', 'trip', p_trip_id::text, null);
end $$;

-- the latest status event, so the server can attach "message sent" to it
create or replace function trip_last_event(p_trip_id uuid) returns bigint
language sql stable set search_path = public as $$
  select id from trip_events where trip_id = p_trip_id order by id desc limit 1;
$$;

do $$
declare fn text;
begin
  foreach fn in array array[
    'staff_set_vehicle(uuid,uuid,uuid)', 'driver_trip_for(uuid,uuid)', 'driver_set_trip_status(uuid,uuid,text)',
    'driver_add_note(uuid,uuid,text)', 'trip_event_notified(bigint)', 'admin_ack_trip_note(uuid,uuid)', 'trip_last_event(uuid)'
  ] loop
    execute format('revoke execute on function %s from public', fn);
    if exists (select 1 from pg_roles where rolname = 'anon') then
      execute format('revoke execute on function %s from anon, authenticated', fn);
    end if;
  end loop;
end $$;
