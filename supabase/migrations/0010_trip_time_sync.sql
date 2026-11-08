-- 0010: return trips — the admin can edit the landing time the customer entered.
-- The "welcome to Suvarnabhumi" card goes out at exactly that landing time.
--   * landing time changed, pickup left as it was -> pickup moves by the same amount
--     (keeps the customer's bag-collection gap)
--   * only the pickup time changed               -> landing time stays as entered
--   * landing time moved to the future and the customer hasn't called yet
--     -> the welcome card is armed again, so it goes out at the new time

drop function if exists admin_update_trip(uuid, uuid, uuid, timestamptz);

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

  -- the form always sends both fields, so compare to the minute
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
    select * into v from vehicles where id = p_vehicle_id;
    if not found then raise exception 'not_found'; end if;
    if v.seats < t.pax then raise exception 'too_many_pax'; end if;
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

revoke execute on function admin_update_trip(uuid, uuid, uuid, timestamptz, timestamptz) from public;
do $$ begin
  if exists (select 1 from pg_roles where rolname = 'anon') then
    revoke execute on function admin_update_trip(uuid, uuid, uuid, timestamptz, timestamptz) from anon, authenticated;
  end if;
end $$;
