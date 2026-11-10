-- 0035: live dispatch — vehicles follow what is really happening, not only the plan made at payment
--  1) return trips (airport -> lot) get a vehicle when the customer calls, in call order: the vehicle that
--     reaches the airport first; a vehicle already at the airport first; among ones arriving within
--     cheaper_slack_minutes of the fastest, the smallest that fits (cheaper to run)
--  2) a driver who has just dropped customers at the airport takes a return customer who has called, or
--     whose bags should be ready within airport_wait_minutes (landing + exit time)
--     (released again if that customer has not called airport_wait_minutes after the expected time)
--  3) whenever a trip ends / is cancelled / moves, and every 5 minutes: upcoming outbound trips that have
--     not started get the best free vehicle again (priority, then smallest that fits) — never a trip a
--     driver has taken, a vehicle staff picked by hand, or one starting within freeze_minutes
-- No GPS: where a vehicle is comes from the drivers' status buttons.

alter table settings add column if not exists drive_minutes         int not null default 15;  -- lot <-> airport
alter table settings add column if not exists load_minutes          int not null default 5;   -- getting people + bags in/out
alter table settings add column if not exists airport_wait_minutes  int not null default 15;  -- a driver at the airport waits this long for the next customer
alter table settings add column if not exists cheaper_slack_minutes int not null default 10;  -- a cheaper vehicle may arrive this much later than the fastest
alter table settings add column if not exists freeze_minutes        int not null default 10;  -- no vehicle swap this close to pickup

alter table shuttle_trips add column if not exists dispatched_at timestamptz;  -- vehicle given live (call / at the airport): kept

-- where a vehicle can be at the airport pickup point, and from when; at_airport = it is there / heading there anyway
create or replace function vehicle_airport_eta(v vehicles, p_exclude uuid default null, out eta timestamptz, out at_airport boolean)
language plpgsql stable set search_path = public as $$
declare
  s settings; drive interval; load interval; base timestamptz := now();
  cur shuttle_trips; last shuttle_trips; free_lot timestamptz;
begin
  select * into s from settings where id = 1;
  drive := make_interval(mins => s.drive_minutes); load := make_interval(mins => s.load_minutes);
  select o.* into cur from shuttle_trips o
  where o.vehicle_id = v.id and o.id is distinct from p_exclude and o.status::text in ('en_route', 'arrived', 'picked_up')
  order by coalesce(o.departed_at, o.arrived_at, o.pickup_at) desc limit 1;
  if found then
    if cur.direction::text = 'to_airport' then
      at_airport := true;
      if cur.status::text = 'arrived' then          -- ready at the lot, leaves at pickup time at the earliest
        eta := greatest(base, coalesce(cur.pickup_at, base)) + drive + load;
      else
        eta := greatest(base, coalesce(cur.departed_at, base) + drive + load);
      end if;
      return;
    end if;
    -- bringing customers back to the lot, then out again
    free_lot := case when cur.status::text = 'en_route' then coalesce(cur.departed_at, base) + drive + load + drive
                     else coalesce(cur.arrived_at, base) + load + drive end;
    eta := greatest(base, free_lot) + drive; at_airport := false;
    return;
  end if;
  select o.* into last from shuttle_trips o
  where o.vehicle_id = v.id and o.status::text = 'done' and o.completed_at is not null
  order by o.completed_at desc limit 1;
  if found and last.direction::text = 'to_airport' and last.completed_at > base - make_interval(mins => s.airport_wait_minutes) then
    eta := base + make_interval(mins => 5); at_airport := true;   -- just dropped someone off: still there / close by
    return;
  end if;
  eta := base + drive; at_airport := false;                       -- waiting at the lot
end $$;

-- is the vehicle free for a return job from p_eta until it is back at the lot? (other jobs it already holds)
create or replace function vehicle_free_for_return(v vehicles, p_trip uuid, p_eta timestamptz) returns boolean
language sql stable set search_path = public as $$
  select not exists (
    select 1 from shuttle_trips o, settings s
    where s.id = 1 and o.vehicle_id = v.id and o.id <> p_trip and o.status::text in ('unassigned', 'assigned') and trip_is_live(o)
      and (
        -- another return job it already holds live
        (o.direction::text = 'from_airport' and o.dispatched_at is not null)
        -- an outbound job at the lot before this one would be back
        or (o.direction::text = 'to_airport' and o.pickup_at < p_eta + make_interval(mins => s.load_minutes + s.drive_minutes)
            and o.pickup_at > now() - make_interval(mins => s.trip_minutes))
      ));
$$;

-- (1) give a called return trip its vehicle
create or replace function dispatch_return(p_trip uuid) returns uuid
language plpgsql set search_path = public as $$
declare
  s settings; t shuttle_trips; pick record; r record;
  best_eta timestamptz; any_airport boolean := false;
begin
  select * into s from settings where id = 1;
  perform pg_advisory_xact_lock(hashtext('backyard_shuttle'));
  select * into t from shuttle_trips where id = p_trip for update;
  if not found or t.direction::text <> 'from_airport' or t.status::text not in ('unassigned', 'assigned') then return t.vehicle_id; end if;
  if t.vehicle_id is not null and (t.dispatched_at is not null or t.assignment_locked) then return t.vehicle_id; end if;

  create temp table if not exists _cand (vid uuid, eta timestamptz, at_airport boolean, pri int, seats int, units int, name text) on commit drop;
  truncate _cand;
  for r in select v.*, (vehicle_airport_eta(v, t.id)).* from vehicles_regular() v where vehicle_fits(v, t.pax, t.large_bags, t.small_bags) loop
    if vehicle_free_for_return((select x from vehicles x where x.id = r.id), t.id, r.eta) then
      insert into _cand values (r.id, r.eta, r.at_airport, r.priority, r.seats, r.luggage_units, r.name);
    end if;
  end loop;

  -- a vehicle at / heading to the airport anyway (within the wait time) beats one driving out from the lot
  select bool_or(at_airport and eta <= now() + make_interval(mins => s.airport_wait_minutes)) into any_airport from _cand;
  if coalesce(any_airport, false) then
    select * into pick from _cand where at_airport and eta <= now() + make_interval(mins => s.airport_wait_minutes)
    order by pri, seats, units, eta, name limit 1;
  else
    select min(eta) into best_eta from _cand;
    select * into pick from _cand where eta <= best_eta + make_interval(mins => s.cheaper_slack_minutes)
    order by pri, seats, units, eta, name limit 1;
  end if;

  if pick.vid is null then
    update shuttle_trips set vehicle_id = null, status = 'unassigned', dispatched_at = null where id = t.id;
    return null;
  end if;
  update shuttle_trips set vehicle_id = pick.vid, status = 'assigned', dispatched_at = now(),
    pickup_at = greatest(pick.eta, now()), updated_at = now()
  where id = t.id;
  return pick.vid;
end $$;

-- (2) a vehicle just dropped customers at the airport: a return customer for it?
create or replace function chain_at_airport(p_done_trip uuid) returns uuid
language plpgsql set search_path = public as $$
declare
  s settings; d shuttle_trips; v vehicles; r shuttle_trips; wait interval;
begin
  select * into s from settings where id = 1;
  wait := make_interval(mins => s.airport_wait_minutes);
  select * into d from shuttle_trips where id = p_done_trip;
  if not found or d.vehicle_id is null or d.direction::text <> 'to_airport' then return null; end if;
  select * into v from vehicles where id = d.vehicle_id;
  if not v.active or v.reserve then return null; end if;           -- emergency vehicles: staff decide
  perform pg_advisory_xact_lock(hashtext('backyard_shuttle'));

  select o.* into r from shuttle_trips o
  where o.direction::text = 'from_airport' and o.status::text in ('unassigned', 'assigned') and trip_is_live(o)
    and not o.assignment_locked and vehicle_fits(v, o.pax, o.large_bags, o.small_bags)
    and (o.vehicle_id is null or o.vehicle_id = v.id or (o.called_at is not null))   -- a called one may move here: this vehicle is closer
    and (o.called_at is not null or o.pickup_at between now() - wait and now() + wait)
    and vehicle_free_for_return(v, o.id, greatest(now(), coalesce(o.pickup_at, now())))
  order by (o.called_at is null), o.called_at, o.pickup_at
  limit 1;
  if not found then return null; end if;

  update shuttle_trips set vehicle_id = v.id, status = 'assigned', dispatched_at = now(),
    pickup_at = case when called_at is not null then now() + interval '5 minutes' else pickup_at end, updated_at = now()
  where id = r.id;
  insert into trip_events (trip_id, staff_name, note)
  values (r.id, 'ระบบ', format('รถ %s ส่งลูกค้าที่สนามบินแล้ว รับงานนี้ต่อ', v.name));
  return r.id;
end $$;

-- (3) re-plan: upcoming outbound trips get the best free vehicle; stale airport waits are released;
--     called return trips still without a vehicle get another try
create or replace function shuttle_rebalance_inner() returns int
language plpgsql set search_path = public as $$
declare s settings; r record; old uuid; got uuid; n int := 0;
begin
  select * into s from settings where id = 1;
  -- a driver waited at the airport but the customer never called: release
  update shuttle_trips set vehicle_id = null, status = 'unassigned', dispatched_at = null, updated_at = now()
  where direction::text = 'from_airport' and called_at is null and dispatched_at is not null and status::text = 'assigned'
    and not assignment_locked
    and now() > greatest(dispatched_at, coalesce(pickup_at, dispatched_at)) + make_interval(mins => s.airport_wait_minutes);

  for r in
    select t.id, t.vehicle_id from shuttle_trips t
    where t.direction::text = 'to_airport' and t.status::text in ('unassigned', 'assigned') and not t.assignment_locked
      and t.driver_staff_id is null and trip_is_live(t)
      and (t.pickup_at between now() + make_interval(mins => s.freeze_minutes) and now() + interval '8 hours'
           or (t.vehicle_id is null and t.pickup_at > now() - interval '1 hour'))   -- still waiting for a vehicle: any time
    order by t.pickup_at
  loop
    old := r.vehicle_id;
    update shuttle_trips set vehicle_id = null, status = 'unassigned' where id = r.id;
    got := assign_vehicle(r.id);
    if got is null and old is not null then   -- nothing better was free: keep what it had
      update shuttle_trips set vehicle_id = old, status = 'assigned' where id = r.id;
    elsif got is distinct from old then n := n + 1;
    end if;
  end loop;

  for r in
    select t.id from shuttle_trips t
    where t.direction::text = 'from_airport' and t.called_at is not null and t.vehicle_id is null
      and t.status::text = 'unassigned' and trip_is_live(t)
    order by t.called_at
  loop
    if dispatch_return(r.id) is not null then n := n + 1; end if;
  end loop;
  return n;
end $$;

create or replace function shuttle_rebalance() returns int
language plpgsql set search_path = public as $$
declare n int;
begin
  if coalesce(current_setting('backyard.reassigning', true), '') = '1' then return 0; end if;
  perform set_config('backyard.reassigning', '1', true);
  n := shuttle_rebalance_inner();
  perform set_config('backyard.reassigning', '0', true);
  return n;
end $$;

-- auto-assign: outbound as before (regular vehicles, people + bags fit, not busy, priority then smallest);
-- return trips get a vehicle only live (customer call / vehicle at the airport)
create or replace function assign_vehicle(p_trip_id uuid) returns uuid
language plpgsql set search_path = public as $$
declare s settings; t shuttle_trips; vid uuid; win interval;
begin
  select * into s from settings where id = 1;
  win := make_interval(mins => s.trip_minutes);
  perform pg_advisory_xact_lock(hashtext('backyard_shuttle'));
  select * into t from shuttle_trips where id = p_trip_id for update;
  if not found then raise exception 'trip_not_found'; end if;
  if t.assignment_locked then return t.vehicle_id; end if;
  if t.direction::text = 'from_airport' then
    if t.called_at is not null then return dispatch_return(t.id); end if;
    return t.vehicle_id;   -- not called yet: waits for the call (or a vehicle at the airport)
  end if;
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

-- the trigger that keeps it live
create or replace function shuttle_trips_reassign_trg() returns trigger
language plpgsql set search_path = public as $$
begin
  if coalesce(current_setting('backyard.reassigning', true), '') = '1' then return null; end if;
  perform set_config('backyard.reassigning', '1', true);
  -- the customer called the van
  if new.direction::text = 'from_airport' and old.called_at is null and new.called_at is not null then
    perform dispatch_return(new.id);
  end if;
  -- dropped at the airport: take a return customer from there
  if new.direction::text = 'to_airport' and new.status::text = 'done' and old.status::text <> 'done' then
    perform chain_at_airport(new.id);
  end if;
  if old.status is distinct from new.status
     or old.pickup_at is distinct from new.pickup_at
     or (old.vehicle_id is not null and new.vehicle_id is distinct from old.vehicle_id) then
    perform shuttle_rebalance_inner();
  end if;
  perform set_config('backyard.reassigning', '0', true);
  return null;
end $$;

-- arrival time for the customer who called: the vehicle given to the trip, or the soonest that fits
create or replace function shuttle_eta(p_trip uuid) returns timestamptz
language plpgsql stable set search_path = public as $$
declare t shuttle_trips; v vehicles; e record; best timestamptz;
begin
  select * into t from shuttle_trips where id = p_trip;
  if not found then return null; end if;
  if t.departed_at is not null and (t.called_at is null or t.departed_at >= t.called_at) then
    return t.departed_at + interval '15 minutes';
  end if;
  if t.vehicle_id is not null then
    select * into v from vehicles where id = t.vehicle_id;
    e := vehicle_airport_eta(v, t.id);
    return e.eta;
  end if;
  select min((vehicle_airport_eta(x, t.id)).eta) into best from vehicles_regular() x where vehicle_fits(x, t.pax, t.large_bags, t.small_bags);
  return coalesce(best, now() + interval '30 minutes');
end $$;

-- trips of one booking that need staff now: outbound without a vehicle, or a return trip whose
-- planned time has no capacity left (it gets its vehicle at the call)
create or replace function booking_shuttle_problems(p_booking uuid) returns setof uuid
language sql stable set search_path = public as $$
  select t.id from shuttle_trips t
  where t.booking_id = p_booking and t.status::text not in ('done', 'cancelled')
    and ((t.direction::text = 'to_airport' and t.vehicle_id is null)
      or (t.direction::text = 'from_airport' and t.vehicle_id is null and t.called_at is null and t.pickup_at is not null
          and not shuttle_capacity_ok(t.pickup_at, t.pax, t.large_bags, t.small_bags, t.id))
      or (t.direction::text = 'from_airport' and t.vehicle_id is null and t.called_at is not null));
$$;

-- customer changes the bags of a return trip before calling: no vehicle yet is normal, only a full plan is a problem
create or replace function customer_set_trip_bags(p_line_user_id text, p_trip_id uuid, p_large int, p_small int)
returns jsonb
language plpgsql set search_path = public as $$
declare t shuttle_trips; v vehicles; owner text; old_vehicle uuid; late boolean := false; waiting boolean;
begin
  if coalesce(p_large, -1) not between 0 and 20 or coalesce(p_small, -1) not between 0 and 20 then raise exception 'invalid_bags'; end if;
  select * into t from shuttle_trips where id = p_trip_id for update;
  if not found then raise exception 'not_found'; end if;
  select c.line_user_id into owner from bookings b join customers c on c.id = b.customer_id where b.id = t.booking_id;
  if owner is distinct from p_line_user_id then raise exception 'not_your_trip'; end if;
  if t.status::text in ('done', 'cancelled', 'picked_up') then raise exception 'trip_closed'; end if;
  old_vehicle := t.vehicle_id;
  if t.large_bags <> p_large or t.small_bags <> p_small then
    update shuttle_trips set large_bags = p_large, small_bags = p_small, updated_at = now() where id = t.id returning * into t;
    insert into trip_events (trip_id, staff_name, note) values (t.id, 'ลูกค้า', format('ลูกค้าแจ้งกระเป๋าใหญ่ %s ใบ', p_large));
    select * into v from vehicles where id = t.vehicle_id;
    if t.vehicle_id is not null and not vehicle_fits(v, t.pax, t.large_bags, t.small_bags) then
      if t.status::text in ('unassigned', 'assigned') then
        update shuttle_trips set vehicle_id = null, status = 'unassigned', assignment_locked = false, dispatched_at = null where id = t.id;
        perform assign_vehicle(t.id);
      else
        late := true;
      end if;
    elsif t.vehicle_id is null and t.status::text = 'unassigned' then
      perform assign_vehicle(t.id);
    end if;
  end if;
  select * into t from shuttle_trips where id = t.id;
  select * into v from vehicles where id = t.vehicle_id;
  waiting := t.direction::text = 'from_airport' and t.called_at is null and t.dispatched_at is null;
  return jsonb_build_object(
    'vehicle', v.name,
    'changed', t.vehicle_id is distinct from old_vehicle,
    'no_vehicle', case when waiting then t.pickup_at is not null and not shuttle_capacity_ok(t.pickup_at, t.pax, t.large_bags, t.small_bags, t.id)
                       else t.vehicle_id is null end,
    'too_big', not exists (select 1 from vehicles_regular() r where vehicle_fits(r, t.pax, t.large_bags, t.small_bags)),
    'late', late);
end $$;

-- staff settings for the dispatch numbers
create or replace function admin_set_dispatch(p_actor uuid, p_drive int, p_wait int, p_slack int, p_freeze int) returns settings
language plpgsql set search_path = public as $$
declare a staff_users; s settings;
begin
  a := staff_require_admin(p_actor);
  if coalesce(p_drive, 0) not between 5 and 90 or coalesce(p_wait, -1) not between 0 and 60
     or coalesce(p_slack, -1) not between 0 and 60 or coalesce(p_freeze, -1) not between 0 and 60 then
    raise exception 'invalid_dispatch';
  end if;
  update settings set drive_minutes = p_drive, airport_wait_minutes = p_wait, cheaper_slack_minutes = p_slack, freeze_minutes = p_freeze
  where id = 1 returning * into s;
  perform audit(a, 'dispatch_settings', 'settings', '1', jsonb_build_object('drive', p_drive, 'wait', p_wait, 'slack', p_slack, 'freeze', p_freeze));
  return s;
end $$;

-- return trips planned before this change: the vehicle comes at the call now (hand-picked ones stay)
update shuttle_trips set vehicle_id = null, status = 'unassigned'
where direction::text = 'from_airport' and called_at is null and not assignment_locked
  and status::text = 'assigned' and driver_staff_id is null and dispatched_at is null;

do $$
declare f text;
begin
  foreach f in array array[
    'vehicle_airport_eta(vehicles, uuid)', 'vehicle_free_for_return(vehicles, uuid, timestamptz)', 'dispatch_return(uuid)',
    'chain_at_airport(uuid)', 'shuttle_rebalance_inner()', 'shuttle_rebalance()', 'assign_vehicle(uuid)', 'shuttle_eta(uuid)',
    'booking_shuttle_problems(uuid)', 'customer_set_trip_bags(text, uuid, int, int)', 'admin_set_dispatch(uuid, int, int, int, int)']
  loop
    execute format('revoke all on function %s from public', f);
    if exists (select 1 from pg_roles where rolname = 'anon') then execute format('revoke all on function %s from anon, authenticated', f); end if;
    if exists (select 1 from pg_roles where rolname = 'service_role') then execute format('grant execute on function %s to service_role', f); end if;
  end loop;
end $$;
