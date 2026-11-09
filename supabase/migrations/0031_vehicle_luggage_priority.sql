-- 0031: luggage, vehicle priority and emergency vehicles
--  * customers say how many bags: large (28-29") and medium/small checked bags (cabin bags not counted)
--  * each vehicle: luggage capacity in units (large = 2, medium/small = 1) and a max number of bags,
--    a priority (1 = use first) and an "emergency only" flag
--  * emergency vehicles are never offered to customers or auto-assigned: staff pick them by hand
--  * the free-van check now matches trips to vehicles one by one (seats AND luggage), since a bigger car
--    is not always better at both (BMW: 4 seats / 3 bags, Jaecoo: 3 seats / 5 small bags)

alter table vehicles add column if not exists luggage_units int not null default 6;
alter table vehicles add column if not exists max_bags      int not null default 4;
alter table vehicles add column if not exists priority      int not null default 1;
alter table vehicles add column if not exists reserve       boolean not null default false;
-- sensible starting values for existing vans/cars (staff fine-tune them in settings)
update vehicles set luggage_units = 10, max_bags = 8 where seats >= 7 and luggage_units = 6 and max_bags = 4;
update vehicles set luggage_units = 5, max_bags = 5 where seats < 7 and luggage_units = 6 and max_bags = 4;

alter table shuttle_trips add column if not exists large_bags int not null default 0;
alter table shuttle_trips add column if not exists small_bags int not null default 0;
do $$ begin
  alter table shuttle_trips add constraint shuttle_trips_bags_chk check (large_bags between 0 and 20 and small_bags between 0 and 20);
exception when duplicate_object then null; end $$;

-- does this group (people + bags) fit in one vehicle?
create or replace function vehicle_fits(v vehicles, p_pax int, p_large int, p_small int) returns boolean
language sql immutable as $$
  select v.seats >= coalesce(p_pax, 1)
     and 2 * coalesce(p_large, 0) + coalesce(p_small, 0) <= v.luggage_units
     and coalesce(p_large, 0) + coalesce(p_small, 0) <= v.max_bags;
$$;

-- can every trip (row) get its own vehicle (column)? c is the n x m fit table, row by row
create or replace function shuttle_match(c boolean[], n int, m int, i int default 1, used bigint default 0)
returns boolean
language plpgsql immutable as $$
begin
  if i > n then return true; end if;
  for j in 1..m loop
    if c[(i - 1) * m + j] and (used & (1::bigint << (j - 1))) = 0 then
      if shuttle_match(c, n, m, i + 1, used | (1::bigint << (j - 1))) then return true; end if;
    end if;
  end loop;
  return false;
end $$;

-- the vehicles customers can be booked onto: active, not emergency-only
create or replace function vehicles_regular() returns setof vehicles
language sql stable set search_path = public as $$
  select * from vehicles where active and not reserve and deleted_at is null order by priority, seats, luggage_units, name;
$$;

drop function if exists shuttle_check(timestamptz, int);
drop function if exists shuttle_suggest(timestamptz, int, int);
drop function if exists shuttle_capacity_ok(timestamptz, int, uuid);

-- can one more trip (people + bags) start at p_at, using the regular vehicles only?
-- At every moment of the new trip, the trips running then (plus the new one) must each get a vehicle they fit in.
-- Trips staff already put on an emergency vehicle do not use up a regular one.
create or replace function shuttle_capacity_ok(p_at timestamptz, p_pax int, p_large int default 0, p_small int default 0,
  p_exclude uuid default null)
returns boolean
language plpgsql stable set search_path = public as $$
declare
  win interval;
  vs vehicles[];
  m int;
  x timestamptz;
  r record;
  c boolean[];
  n int;
  k int;
begin
  select make_interval(mins => trip_minutes) into win from settings where id = 1;
  select array_agg(v) into vs from vehicles_regular() v;
  m := coalesce(array_length(vs, 1), 0);
  if m = 0 or m > 60 then return false; end if;
  if not exists (select 1 from unnest(vs) v where vehicle_fits(v, p_pax, p_large, p_small)) then return false; end if;
  for x in
    select p_at
    union
    select o.pickup_at from shuttle_trips o
    where o.pickup_at > p_at and o.pickup_at < p_at + win and o.id is distinct from p_exclude and trip_is_live(o)
  loop
    -- the trips running at x (+ the new one), fewest fitting vehicles first, as a fit table
    -- (a running trip no regular vehicle can take is staff's to handle by hand: it does not block others)
    c := '{}'; n := 0;
    for r in
      select t.pax, t.lg, t.sm, (select count(*) from unnest(vs) v where vehicle_fits(v, t.pax, t.lg, t.sm)) nfit
      from (
        select o.pax, o.large_bags lg, o.small_bags sm from shuttle_trips o
        left join vehicles ov on ov.id = o.vehicle_id
        where o.id is distinct from p_exclude and o.pickup_at <= x and x < o.pickup_at + win and trip_is_live(o)
          and not coalesce(ov.reserve, false)
        union all select p_pax, coalesce(p_large, 0), coalesce(p_small, 0)
      ) t
      order by 4
    loop
      continue when r.nfit = 0;
      n := n + 1;
      for k in 1..m loop c := c || vehicle_fits(vs[k], r.pax, r.lg, r.sm); end loop;
    end loop;
    if n > m then return false; end if;
    if not shuttle_match(c, n, m) then return false; end if;
  end loop;
  return true;
end $$;

-- free start times near p_at on the same day (10-minute steps, up to 90 minutes either way), nearest first
create or replace function shuttle_suggest(p_at timestamptz, p_pax int, p_large int default 0, p_small int default 0, p_n int default 4)
returns setof timestamptz
language sql stable set search_path = public as $$
  select c from (
    select p_at + make_interval(mins => i * 10) c, i from generate_series(-9, 9) i where i <> 0
  ) z
  where c > now() + interval '30 minutes'
    and (c at time zone 'Asia/Bangkok')::date = (p_at at time zone 'Asia/Bangkok')::date
    and shuttle_capacity_ok(c, p_pax, p_large, p_small)
  order by abs(i), i
  limit p_n;
$$;

-- for the booking page: {"ok", "too_big", "suggestions"}; too_big = no regular vehicle takes this group at all
create or replace function shuttle_check(p_at timestamptz, p_pax int, p_large int default 0, p_small int default 0)
returns jsonb
language plpgsql stable set search_path = public as $$
begin
  if not exists (select 1 from vehicles_regular() v where vehicle_fits(v, p_pax, p_large, p_small)) then
    return jsonb_build_object('ok', false, 'too_big', true, 'suggestions', '[]'::jsonb);
  end if;
  if shuttle_capacity_ok(p_at, p_pax, p_large, p_small) then
    return jsonb_build_object('ok', true, 'too_big', false, 'suggestions', '[]'::jsonb);
  end if;
  return jsonb_build_object('ok', false, 'too_big', false, 'suggestions',
    coalesce((select jsonb_agg(t) from shuttle_suggest(p_at, p_pax, p_large, p_small) t), '[]'::jsonb));
end $$;

-- new trips: take the bag counts the booking call handed over, then (outbound of a new customer booking)
-- refuse when no regular vehicle is free
create or replace function shuttle_trips_capacity_trg() returns trigger
language plpgsql set search_path = public as $$
declare bags text := nullif(current_setting('backyard.bags', true), '');
begin
  if bags is not null and new.large_bags = 0 and new.small_bags = 0 then
    new.large_bags := greatest(0, least(20, split_part(bags, ',', 1)::int));
    new.small_bags := greatest(0, least(20, split_part(bags, ',', 2)::int));
  end if;
  if new.direction::text <> 'to_airport' or new.pickup_at is null then return new; end if;
  if not exists (select 1 from bookings where id = new.booking_id and status::text = 'pending_payment') then return new; end if;
  perform pg_advisory_xact_lock(hashtext('backyard_shuttle'));
  if not shuttle_capacity_ok(new.pickup_at, new.pax, new.large_bags, new.small_bags) then raise exception 'shuttle_full'; end if;
  return new;
end $$;

-- booking with bags: same arguments as create_booking (+ p_reward to spend points, + bag counts)
create or replace function create_booking_bags(
  p_line_user_id text, p_name text, p_phone text, p_plate text, p_province text, p_start date, p_end date,
  p_shuttle boolean default false, p_pax int default null, p_outbound_flight text default null,
  p_outbound_time timestamptz default null, p_return_flight text default null, p_return_time timestamptz default null,
  p_ref_phone text default null, p_coupon uuid default null, p_reward uuid default null,
  p_large int default 0, p_small int default 0)
returns bookings
language plpgsql set search_path = public, extensions as $$
begin
  if coalesce(p_large, 0) not between 0 and 20 or coalesce(p_small, 0) not between 0 and 20 then raise exception 'invalid_bags'; end if;
  perform set_config('backyard.bags', coalesce(p_large, 0) || ',' || coalesce(p_small, 0), true);
  if p_reward is not null then
    return create_booking_with_reward(p_line_user_id => p_line_user_id, p_name => p_name, p_phone => p_phone, p_plate => p_plate,
      p_province => p_province, p_start => p_start, p_end => p_end, p_shuttle => p_shuttle, p_pax => p_pax,
      p_outbound_flight => p_outbound_flight, p_outbound_time => p_outbound_time, p_return_flight => p_return_flight,
      p_return_time => p_return_time, p_ref_phone => p_ref_phone, p_reward => p_reward);
  end if;
  return create_booking(p_line_user_id => p_line_user_id, p_name => p_name, p_phone => p_phone, p_plate => p_plate,
    p_province => p_province, p_start => p_start, p_end => p_end, p_shuttle => p_shuttle, p_pax => p_pax,
    p_outbound_flight => p_outbound_flight, p_outbound_time => p_outbound_time, p_return_flight => p_return_flight,
    p_return_time => p_return_time, p_ref_phone => p_ref_phone, p_coupon => p_coupon);
end $$;

-- auto-assign: regular vehicles only, people AND bags must fit, not busy; priority first, then the smallest
-- vehicle that fits (keeps the big van free for big groups)
create or replace function assign_vehicle(p_trip_id uuid) returns uuid
language plpgsql set search_path = public as $$
declare
  s settings;
  t shuttle_trips;
  vid uuid;
  win interval;
begin
  select * into s from settings where id = 1;
  win := make_interval(mins => s.trip_minutes);
  perform pg_advisory_xact_lock(hashtext('backyard_shuttle'));
  select * into t from shuttle_trips where id = p_trip_id for update;
  if not found then raise exception 'trip_not_found'; end if;
  if t.assignment_locked then return t.vehicle_id; end if;
  if t.pickup_at is null then raise exception 'no_pickup_time'; end if;

  select v.id into vid
  from vehicles_regular() v
  where vehicle_fits(v, t.pax, t.large_bags, t.small_bags)
    and not exists (
      select 1 from shuttle_trips o
      where o.vehicle_id = v.id and o.id <> t.id and o.status not in ('done', 'cancelled')
        and o.pickup_at is not null and o.pickup_at < t.pickup_at + win and t.pickup_at < o.pickup_at + win)
  order by v.priority, v.seats, v.luggage_units, v.name
  limit 1;

  update shuttle_trips
  set vehicle_id = vid,
      status = case when vid is null then 'unassigned'::trip_status
                    when status = 'unassigned' then 'assigned'::trip_status else status end
  where id = t.id;
  return vid;
end $$;

-- staff pick a vehicle by hand: any active vehicle incl. emergency ones, people and bags must fit
create or replace function admin_update_trip(
  p_actor uuid, p_trip_id uuid, p_vehicle_id uuid, p_pickup_at timestamptz,
  p_landing_at timestamptz default null)
returns shuttle_trips
language plpgsql set search_path = public as $$
declare
  a staff_users;
  t shuttle_trips;
  v vehicles;
  s settings;
  pickup_changed boolean;
  landing_changed boolean;
  new_pickup timestamptz;
  new_landing timestamptz;
begin
  a := staff_require_admin(p_actor);
  select * into t from shuttle_trips where id = p_trip_id for update;
  if not found then raise exception 'not_found'; end if;
  select * into s from settings where id = 1;

  pickup_changed := p_pickup_at is not null
    and date_trunc('minute', p_pickup_at) is distinct from date_trunc('minute', t.pickup_at);
  landing_changed := t.direction = 'from_airport' and p_landing_at is not null
    and date_trunc('minute', p_landing_at) is distinct from date_trunc('minute', t.landing_at);

  new_pickup := case when pickup_changed then p_pickup_at else t.pickup_at end;
  new_landing := case when landing_changed then p_landing_at else t.landing_at end;
  if landing_changed and not pickup_changed and t.landing_at is not null and t.pickup_at is not null then
    new_pickup := t.pickup_at + (p_landing_at - t.landing_at);
  end if;
  if new_landing is not null and new_pickup is not null and new_landing > new_pickup then
    raise exception 'landing_after_pickup';
  end if;

  if p_vehicle_id is not null then
    select * into v from vehicles where id = p_vehicle_id and deleted_at is null;
    if not found then raise exception 'not_found'; end if;
    if v.seats < t.pax then raise exception 'too_many_pax'; end if;
    if not vehicle_fits(v, t.pax, t.large_bags, t.small_bags) then raise exception 'too_much_luggage'; end if;
    if exists (
      select 1 from shuttle_trips o
      where o.vehicle_id = p_vehicle_id and o.id <> t.id and o.status not in ('done', 'cancelled')
        and abs(extract(epoch from (o.pickup_at - new_pickup))) < s.trip_minutes * 60
    ) then raise exception 'vehicle_busy'; end if;
  end if;

  update shuttle_trips set
    pickup_at = new_pickup,
    landing_at = new_landing,
    welcome_sent_at = case
      when landing_changed and new_landing > now() and called_at is null then null
      else welcome_sent_at end,
    vehicle_id = p_vehicle_id,
    assignment_locked = p_vehicle_id is not null,
    status = case when p_vehicle_id is null then 'unassigned'::trip_status
                  when status = 'unassigned' then 'assigned'::trip_status else status end,
    updated_at = now()
  where id = t.id returning * into t;

  perform audit(a, 'update', 'trip', t.id::text,
    jsonb_build_object('vehicle', p_vehicle_id, 'pickup_at', t.pickup_at, 'landing_at', t.landing_at));
  return t;
end $$;

-- staff correct the bag count of a trip (the customer brought more / fewer); a vehicle that no longer
-- fits is released and the trip is re-assigned; a trip waiting for a vehicle gets another try
-- (a vehicle picked by hand stays)
create or replace function admin_set_trip_bags(p_actor uuid, p_trip_id uuid, p_large int, p_small int)
returns shuttle_trips
language plpgsql set search_path = public as $$
declare a staff_users; t shuttle_trips; v vehicles;
begin
  a := staff_require_admin(p_actor);
  if coalesce(p_large, -1) not between 0 and 20 or coalesce(p_small, -1) not between 0 and 20 then raise exception 'invalid_bags'; end if;
  update shuttle_trips set large_bags = p_large, small_bags = p_small, updated_at = now()
  where id = p_trip_id returning * into t;
  if not found then raise exception 'not_found'; end if;
  if t.vehicle_id is not null and not t.assignment_locked and t.status::text in ('unassigned', 'assigned') then
    select * into v from vehicles where id = t.vehicle_id;
    if not vehicle_fits(v, t.pax, t.large_bags, t.small_bags) then
      update shuttle_trips set vehicle_id = null, status = 'unassigned' where id = t.id;
      perform assign_vehicle(t.id);
      select * into t from shuttle_trips where id = t.id;
    end if;
  elsif t.vehicle_id is null and not t.assignment_locked and t.status::text = 'unassigned' and t.pickup_at is not null then
    perform assign_vehicle(t.id);   -- fewer bags may now fit a free vehicle
    select * into t from shuttle_trips where id = t.id;
  end if;
  perform audit(a, 'update', 'trip', t.id::text, jsonb_build_object('large_bags', p_large, 'small_bags', p_small));
  return t;
end $$;

-- (4) arrival time when the customer calls: regular vehicles that fit the group
create or replace function shuttle_eta(p_trip uuid) returns timestamptz
language plpgsql stable set search_path = public as $$
declare
  t shuttle_trips;
  win interval;
  base timestamptz;
  free_at timestamptz;
begin
  select * into t from shuttle_trips where id = p_trip;
  if not found then return null; end if;
  if t.departed_at is not null and (t.called_at is null or t.departed_at >= t.called_at) then
    return t.departed_at + interval '15 minutes';
  end if;
  select make_interval(mins => trip_minutes) into win from settings where id = 1;
  base := greatest(coalesce(t.called_at, now()), now() - interval '1 hour');
  select min(greatest(base, coalesce(busy.until, base))) into free_at
  from vehicles_regular() v
  left join lateral (
    select max(coalesce(o.departed_at, o.pickup_at, base) + win) as until
    from shuttle_trips o
    where o.vehicle_id = v.id and o.id <> t.id and trip_is_live(o)
      and (o.status::text in ('en_route', 'arrived', 'picked_up')
           or (o.status::text = 'assigned' and o.pickup_at <= base + interval '10 minutes' and o.pickup_at + win > base))
  ) busy on true
  where vehicle_fits(v, t.pax, t.large_bags, t.small_bags);
  return coalesce(free_at, base) + interval '15 minutes';
end $$;

-- vehicle settings: + luggage capacity, priority, emergency-only
drop function if exists admin_save_vehicle(uuid, uuid, text, text, text, int, boolean, text);
create or replace function admin_save_vehicle(p_actor uuid, p_id uuid, p_name text, p_plate text,
  p_model text, p_seats int, p_active boolean, p_note text default null,
  p_luggage_units int default 6, p_max_bags int default 4, p_priority int default 1, p_reserve boolean default false)
returns vehicles
language plpgsql set search_path = public as $$
declare a staff_users; v vehicles; v_plate text := nullif(regexp_replace(trim(coalesce(p_plate, '')), '\s+', ' ', 'g'), ''); need int;
begin
  a := staff_require_admin(p_actor);
  if nullif(trim(p_name), '') is null or length(trim(p_name)) > 40 or p_seats is null or p_seats < 1 or p_seats > 30
     or length(coalesce(v_plate, '')) > 30 or length(coalesce(p_model, '')) > 60
     or coalesce(p_luggage_units, -1) not between 0 and 60 or coalesce(p_max_bags, -1) not between 0 and 30
     or coalesce(p_priority, 0) not between 1 and 9 then
    raise exception 'invalid_vehicle';
  end if;
  if v_plate is not null and exists (select 1 from vehicles where deleted_at is null and id is distinct from p_id
                                   and lower(replace(vehicles.plate, ' ', '')) = lower(replace(v_plate, ' ', ''))) then
    raise exception 'plate_taken';
  end if;
  if p_id is null then
    insert into vehicles (name, plate, model, seats, active, note, luggage_units, max_bags, priority, reserve)
    values (trim(p_name), v_plate, nullif(trim(p_model), ''), p_seats, coalesce(p_active, true), nullif(trim(p_note), ''),
            p_luggage_units, p_max_bags, p_priority, coalesce(p_reserve, false))
    returning * into v;
  else
    select max(pax) into need from shuttle_trips
    where vehicle_id = p_id and status not in ('done', 'cancelled') and (pickup_at is null or pickup_at > now() - interval '2 hours');
    if need is not null and p_seats < need then raise exception 'seats_too_few:%', need; end if;
    update vehicles set name = trim(p_name), plate = v_plate, model = nullif(trim(p_model), ''), seats = p_seats,
      active = coalesce(p_active, active), note = nullif(trim(p_note), ''),
      luggage_units = p_luggage_units, max_bags = p_max_bags, priority = p_priority, reserve = coalesce(p_reserve, false)
    where id = p_id and deleted_at is null returning * into v;
    if not found then raise exception 'not_found'; end if;
  end if;
  perform audit(a, case when p_id is null then 'vehicle_add' else 'vehicle_edit' end, 'vehicle', v.id::text,
    jsonb_build_object('name', v.name, 'plate', v.plate, 'seats', v.seats, 'active', v.active,
      'luggage_units', v.luggage_units, 'max_bags', v.max_bags, 'priority', v.priority, 'reserve', v.reserve));
  return v;
end $$;

-- only the server key may call these (the shuttle functions of 0030 too)
do $$
declare f text;
begin
  foreach f in array array[
    'vehicle_fits(vehicles, int, int, int)', 'shuttle_match(boolean[], int, int, int, bigint)', 'vehicles_regular()',
    'shuttle_capacity_ok(timestamptz, int, int, int, uuid)', 'shuttle_suggest(timestamptz, int, int, int, int)',
    'shuttle_check(timestamptz, int, int, int)',
    'create_booking_bags(text, text, text, text, text, date, date, boolean, int, text, timestamptz, text, timestamptz, text, uuid, uuid, int, int)',
    'assign_vehicle(uuid)', 'admin_update_trip(uuid, uuid, uuid, timestamptz, timestamptz)',
    'admin_set_trip_bags(uuid, uuid, int, int)', 'shuttle_eta(uuid)', 'trip_is_live(shuttle_trips)',
    'shuttle_reassign_near(timestamptz, timestamptz, uuid)',
    'admin_save_vehicle(uuid, uuid, text, text, text, int, boolean, text, int, int, int, boolean)']
  loop
    execute format('revoke all on function %s from public', f);
    if exists (select 1 from pg_roles where rolname = 'anon') then
      execute format('revoke all on function %s from anon, authenticated', f);
    end if;
    if exists (select 1 from pg_roles where rolname = 'service_role') then
      execute format('grant execute on function %s to service_role', f);
    end if;
  end loop;
end $$;
