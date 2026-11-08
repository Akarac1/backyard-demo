-- 0025: manage shuttle vehicles from the admin settings page (add / edit / remove),
-- with plate and model, shown to customers on the shuttle cards.
--
-- Removing: a vehicle that never ran a trip is deleted. One with past trips is retired instead
-- (deleted_at set, hidden everywhere) so reports and history keep its name. A vehicle with
-- upcoming trips cannot be removed until those trips are moved to another vehicle.

alter table vehicles add column if not exists plate      text;
alter table vehicles add column if not exists model      text;          -- e.g. "Toyota Commuter สีขาว"
alter table vehicles add column if not exists note       text;
alter table vehicles add column if not exists created_at timestamptz not null default now();
alter table vehicles add column if not exists deleted_at timestamptz;

-- upcoming = not finished/cancelled and (no time yet or pickup from 2 hours ago onward)
create or replace function vehicle_open_trips(p_vehicle uuid) returns bigint
language sql stable set search_path = public as $$
  select count(*) from shuttle_trips
  where vehicle_id = p_vehicle and status not in ('done', 'cancelled')
    and (pickup_at is null or pickup_at > now() - interval '2 hours');
$$;

-- errors: invalid_vehicle | plate_taken | seats_too_few:<pax> | not_found
create or replace function admin_save_vehicle(p_actor uuid, p_id uuid, p_name text, p_plate text,
  p_model text, p_seats int, p_active boolean, p_note text default null)
returns vehicles
language plpgsql set search_path = public as $$
declare a staff_users; v vehicles; v_plate text := nullif(regexp_replace(trim(coalesce(p_plate, '')), '\s+', ' ', 'g'), ''); need int;
begin
  a := staff_require_admin(p_actor);
  if nullif(trim(p_name), '') is null or length(trim(p_name)) > 40 or p_seats is null or p_seats < 1 or p_seats > 30
     or length(coalesce(v_plate, '')) > 30 or length(coalesce(p_model, '')) > 60 then
    raise exception 'invalid_vehicle';
  end if;
  if v_plate is not null and exists (select 1 from vehicles where deleted_at is null and id is distinct from p_id
                                   and lower(replace(vehicles.plate, ' ', '')) = lower(replace(v_plate, ' ', ''))) then
    raise exception 'plate_taken';
  end if;
  if p_id is null then
    insert into vehicles (name, plate, model, seats, active, note)
    values (trim(p_name), v_plate, nullif(trim(p_model), ''), p_seats, coalesce(p_active, true), nullif(trim(p_note), ''))
    returning * into v;
  else
    -- fewer seats than an upcoming trip already on this vehicle needs
    select max(pax) into need from shuttle_trips
    where vehicle_id = p_id and status not in ('done', 'cancelled') and (pickup_at is null or pickup_at > now() - interval '2 hours');
    if need is not null and p_seats < need then raise exception 'seats_too_few:%', need; end if;
    update vehicles set name = trim(p_name), plate = v_plate, model = nullif(trim(p_model), ''), seats = p_seats,
      active = coalesce(p_active, active), note = nullif(trim(p_note), '')
    where id = p_id and deleted_at is null returning * into v;
    if not found then raise exception 'not_found'; end if;
  end if;
  perform audit(a, case when p_id is null then 'vehicle_add' else 'vehicle_edit' end, 'vehicle', v.id::text,
    jsonb_build_object('name', v.name, 'plate', v.plate, 'seats', v.seats, 'active', v.active));
  return v;
end $$;

-- returns 'deleted' or 'retired'. errors: vehicle_has_trips:<n> | last_vehicle | not_found
create or replace function admin_delete_vehicle(p_actor uuid, p_id uuid) returns text
language plpgsql set search_path = public as $$
declare a staff_users; v vehicles; open_n bigint; result text;
begin
  a := staff_require_admin(p_actor);
  select * into v from vehicles where id = p_id and deleted_at is null for update;
  if not found then raise exception 'not_found'; end if;
  open_n := vehicle_open_trips(p_id);
  if open_n > 0 then raise exception 'vehicle_has_trips:%', open_n; end if;
  if not exists (select 1 from vehicles where deleted_at is null and active and id <> p_id) and v.active then
    raise exception 'last_vehicle';
  end if;
  update staff_users set vehicle_id = null where vehicle_id = p_id;   -- drivers who used it pick another
  if exists (select 1 from shuttle_trips where vehicle_id = p_id) then
    update vehicles set deleted_at = now(), active = false where id = p_id;
    result := 'retired';
  else
    delete from vehicles where id = p_id;
    result := 'deleted';
  end if;
  perform audit(a, 'vehicle_delete', 'vehicle', p_id::text, jsonb_build_object('name', v.name, 'plate', v.plate, 'result', result));
  return result;
end $$;

-- retired vehicles never come back as "active"
update vehicles set active = false where deleted_at is not null;

revoke all on function vehicle_open_trips(uuid) from public, anon, authenticated;
revoke all on function admin_save_vehicle(uuid, uuid, text, text, text, int, boolean, text) from public, anon, authenticated;
revoke all on function admin_delete_vehicle(uuid, uuid) from public, anon, authenticated;
grant execute on function vehicle_open_trips(uuid) to service_role;
grant execute on function admin_save_vehicle(uuid, uuid, text, text, text, int, boolean, text) to service_role;
grant execute on function admin_delete_vehicle(uuid, uuid) to service_role;
