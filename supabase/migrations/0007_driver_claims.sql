-- =====================================================================
-- Backyard: drivers are not tied to a vehicle. The driver who presses the first
-- status of a trip takes it; another driver can take it over on purpose.
-- Run after 0006. Safe to re-run.
-- =====================================================================

alter table staff_users   add column if not exists phone text;
alter table shuttle_trips add column if not exists driver_staff_id uuid references staff_users(id);

-- admin sets a staff member's phone (shown to customers for drivers)
create or replace function staff_set_phone(p_actor uuid, p_id uuid, p_phone text) returns void
language plpgsql set search_path = public as $$
declare a staff_users;
begin
  a := staff_require_admin(p_actor);
  update staff_users set phone = nullif(regexp_replace(coalesce(p_phone, ''), '[^0-9]', '', 'g'), '') where id = p_id;
  if not found then raise exception 'not_found'; end if;
end $$;

-- any driver (or admin) may work on any trip
create or replace function driver_trip_for(p_actor uuid, p_trip_id uuid) returns shuttle_trips
language plpgsql set search_path = public as $$
declare
  u staff_users;
  t shuttle_trips;
begin
  u := staff_actor(p_actor);
  if u.role::text not in ('admin', 'driver') then raise exception 'not_allowed'; end if;
  select * into t from shuttle_trips where id = p_trip_id for update;
  if not found then raise exception 'not_found'; end if;
  return t;
end $$;

-- p_status: 'en_route' | 'arrived' | 'done'
-- The first driver to press a status takes the trip. If another driver already has it:
--   error taken_by:<name>, unless p_takeover is true (then this driver takes it over).
drop function if exists driver_set_trip_status(uuid, uuid, text);
create or replace function driver_set_trip_status(p_actor uuid, p_trip_id uuid, p_status text, p_takeover boolean default false)
returns shuttle_trips
language plpgsql set search_path = public as $$
declare
  u staff_users;
  t shuttle_trips;
  holder text;
begin
  u := staff_actor(p_actor);
  t := driver_trip_for(p_actor, p_trip_id);
  if p_status not in ('en_route', 'arrived', 'done') then raise exception 'bad_status'; end if;
  if t.status::text = 'cancelled' then raise exception 'trip_cancelled'; end if;
  if u.role::text = 'driver' and t.driver_staff_id is not null and t.driver_staff_id <> u.id and not p_takeover then
    select display_name into holder from staff_users where id = t.driver_staff_id;
    raise exception 'taken_by:%', coalesce(holder, '-');
  end if;

  update shuttle_trips set
    status          = p_status::trip_status,
    driver_staff_id = case when u.role::text = 'driver' then u.id else coalesce(driver_staff_id, u.id) end,
    departed_at     = case when p_status = 'en_route' then now() else departed_at end,
    arrived_at      = case when p_status = 'arrived'  then now() else arrived_at end,
    completed_at    = case when p_status = 'done'     then now() else completed_at end,
    updated_at      = now()
  where id = t.id returning * into t;

  insert into trip_events (trip_id, staff_id, staff_name, status, note)
  values (t.id, u.id, u.display_name, p_status, case when p_takeover then 'รับงานแทน' end);
  return t;
end $$;

do $$
declare fn text;
begin
  foreach fn in array array['staff_set_phone(uuid,uuid,text)', 'driver_trip_for(uuid,uuid)', 'driver_set_trip_status(uuid,uuid,text,boolean)'] loop
    execute format('revoke execute on function %s from public', fn);
    if exists (select 1 from pg_roles where rolname = 'anon') then
      execute format('revoke execute on function %s from anon, authenticated', fn);
    end if;
  end loop;
end $$;
