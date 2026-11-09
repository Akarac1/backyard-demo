-- 0030: shuttle capacity
--  1) check a free van when the customer books (outbound trip: refuse when full, suggest nearby times)
--  2) (alert to staff when a trip has no van: done in the app, lib/confirm.ts)
--  3) re-assign waiting trips automatically when a trip is cancelled, moved or loses its van
--  4) realistic arrival time when the customer calls the van (nearest van to become free)
--  + trips of an expired / cancelled / no-show booking are cancelled, so they stop holding a van

-- a trip that still needs (or holds) a van: not done/cancelled, and its booking is live
-- (confirmed, in the lot, or an unpaid hold that has not run out)
create or replace function trip_is_live(t shuttle_trips) returns boolean
language sql stable set search_path = public as $$
  select t.status::text not in ('done', 'cancelled') and t.pickup_at is not null and exists (
    select 1 from bookings b where b.id = t.booking_id
      and (b.status::text in ('confirmed', 'checked_in')
           or (b.status::text = 'pending_payment' and b.hold_expires_at > now())));
$$;

-- can one more trip of p_pax people start at p_at?
-- A trip keeps a van busy for settings.trip_minutes. At every moment of the new trip, the trips running
-- then (plus the new one) must fit the vans: for each group size q, the trips of q+ people must not
-- outnumber the vans with q+ seats (a 2-seat van can take only groups of 1-2).
create or replace function shuttle_capacity_ok(p_at timestamptz, p_pax int, p_exclude uuid default null)
returns boolean
language plpgsql stable set search_path = public as $$
declare
  win interval;
  x timestamptz;
  ok boolean;
begin
  select make_interval(mins => trip_minutes) into win from settings where id = 1;
  if not exists (select 1 from vehicles where active and seats >= p_pax) then return false; end if;
  for x in
    select p_at
    union
    select o.pickup_at from shuttle_trips o
    where o.pickup_at > p_at and o.pickup_at < p_at + win and o.id is distinct from p_exclude and trip_is_live(o)
  loop
    with s as (
      select o.pax from shuttle_trips o
      where o.id is distinct from p_exclude and o.pickup_at <= x and x < o.pickup_at + win and trip_is_live(o)
      union all select p_pax
    ), q as (select distinct pax from s)
    select bool_and((select count(*) from s where s.pax >= q.pax)
                    <= (select count(*) from vehicles v where v.active and v.seats >= q.pax))
      into ok from q;
    if not ok then return false; end if;
  end loop;
  return true;
end $$;

-- free start times near p_at on the same day (10-minute steps, up to 90 minutes either way),
-- nearest first, at least 30 minutes from now
create or replace function shuttle_suggest(p_at timestamptz, p_pax int, p_n int default 4)
returns setof timestamptz
language sql stable set search_path = public as $$
  select c from (
    select p_at + make_interval(mins => i * 10) c, i from generate_series(-9, 9) i where i <> 0
  ) z
  where c > now() + interval '30 minutes'
    and (c at time zone 'Asia/Bangkok')::date = (p_at at time zone 'Asia/Bangkok')::date
    and shuttle_capacity_ok(c, p_pax)
  order by abs(i), i
  limit p_n;
$$;

-- for the booking page: {"ok": bool, "suggestions": ["...", ...]}
create or replace function shuttle_check(p_at timestamptz, p_pax int)
returns jsonb
language plpgsql stable set search_path = public as $$
begin
  if shuttle_capacity_ok(p_at, p_pax) then return jsonb_build_object('ok', true, 'suggestions', '[]'::jsonb); end if;
  return jsonb_build_object('ok', false, 'suggestions',
    coalesce((select jsonb_agg(t) from shuttle_suggest(p_at, p_pax) t), '[]'::jsonb));
end $$;

-- (1) the outbound trip of a new customer booking must have a free van; the return trip is
-- allowed (the customer calls the van when ready and flights run late) and staff are alerted instead
create or replace function shuttle_trips_capacity_trg() returns trigger
language plpgsql set search_path = public as $$
begin
  if new.direction::text <> 'to_airport' or new.pickup_at is null then return new; end if;
  if not exists (select 1 from bookings where id = new.booking_id and status::text = 'pending_payment') then return new; end if;
  perform pg_advisory_xact_lock(hashtext('backyard_shuttle'));   -- two bookings for the same slot: one waits
  if not shuttle_capacity_ok(new.pickup_at, new.pax) then raise exception 'shuttle_full'; end if;
  return new;
end $$;

drop trigger if exists shuttle_trips_capacity on shuttle_trips;
create trigger shuttle_trips_capacity before insert on shuttle_trips
  for each row execute function shuttle_trips_capacity_trg();

-- try to give a van to every waiting trip near a time (nearest pickup first)
create or replace function shuttle_reassign_near(p_a timestamptz, p_b timestamptz, p_skip uuid default null)
returns int
language plpgsql set search_path = public as $$
declare
  win interval;
  r record;
  n int := 0;
begin
  select make_interval(mins => trip_minutes) into win from settings where id = 1;
  perform set_config('backyard.reassigning', '1', true);
  for r in
    select t.id from shuttle_trips t join bookings b on b.id = t.booking_id
    where t.vehicle_id is null and not t.assignment_locked and t.status::text = 'unassigned'
      and t.pickup_at is not null and t.pickup_at > now() - interval '1 hour'
      and t.pickup_at between least(p_a, p_b) - 2 * win and greatest(p_a, p_b) + 2 * win
      and b.status::text in ('confirmed', 'checked_in')
      and t.id is distinct from p_skip
    order by t.pickup_at
  loop
    if assign_vehicle(r.id) is not null then n := n + 1; end if;
  end loop;
  perform set_config('backyard.reassigning', '0', true);
  return n;
end $$;

-- (3) a trip was cancelled, moved, or gave up its van: the van may now be free for a waiting trip
create or replace function shuttle_trips_reassign_trg() returns trigger
language plpgsql set search_path = public as $$
begin
  if coalesce(current_setting('backyard.reassigning', true), '') = '1' then return null; end if;   -- our own assign_vehicle updates
  if (new.status::text = 'cancelled' and old.status::text <> 'cancelled')
     or (old.pickup_at is distinct from new.pickup_at)
     or (old.vehicle_id is not null and new.vehicle_id is distinct from old.vehicle_id) then
    perform shuttle_reassign_near(coalesce(old.pickup_at, new.pickup_at), coalesce(new.pickup_at, old.pickup_at), new.id);
  end if;
  return null;
end $$;

drop trigger if exists shuttle_trips_reassign on shuttle_trips;
create trigger shuttle_trips_reassign after update on shuttle_trips
  for each row execute function shuttle_trips_reassign_trg();

-- a booking that ran out, was cancelled or was a no-show: its trips stop holding a van
create or replace function bookings_cancel_trips_trg() returns trigger
language plpgsql set search_path = public as $$
begin
  if new.status::text in ('expired', 'cancelled', 'no_show') and old.status::text is distinct from new.status::text then
    update shuttle_trips set status = 'cancelled', updated_at = now()
    where booking_id = new.id and status::text not in ('done', 'cancelled');
  end if;
  return null;
end $$;

drop trigger if exists bookings_cancel_trips on bookings;
create trigger bookings_cancel_trips after update of status on bookings
  for each row execute function bookings_cancel_trips_trg();

-- (4) when will a van reach the customer who called?
-- a driver already on the way: set-off time + 15 minutes. Otherwise the van (with enough seats) that is
-- free soonest: a van out on a trip is busy until that trip's start + trip_minutes; then 15 minutes' drive.
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
  from vehicles v
  left join lateral (
    select max(coalesce(o.departed_at, o.pickup_at, base) + win) as until
    from shuttle_trips o
    where o.vehicle_id = v.id and o.id <> t.id and trip_is_live(o)
      and (o.status::text in ('en_route', 'arrived', 'picked_up')
           or (o.status::text = 'assigned' and o.pickup_at <= base + interval '10 minutes' and o.pickup_at + win > base))
  ) busy on true
  where v.active and v.seats >= t.pax;
  return coalesce(free_at, base) + interval '15 minutes';
end $$;

do $$ begin
  if exists (select 1 from pg_roles where rolname = 'service_role') then
    grant execute on function trip_is_live(shuttle_trips), shuttle_capacity_ok(timestamptz, int, uuid),
      shuttle_suggest(timestamptz, int, int), shuttle_check(timestamptz, int),
      shuttle_reassign_near(timestamptz, timestamptz, uuid), shuttle_eta(uuid) to service_role;
  end if;
end $$;

-- clean up: trips left behind by bookings that already ran out or were cancelled
update shuttle_trips t set status = 'cancelled', updated_at = now()
from bookings b
where b.id = t.booking_id and b.status::text in ('expired', 'cancelled', 'no_show') and t.status::text not in ('done', 'cancelled');
