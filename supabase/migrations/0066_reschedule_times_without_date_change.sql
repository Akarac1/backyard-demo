-- 0066: fix a real bug in the "เลื่อนวันจอง" panel — if the admin left "วันเข้าจอดใหม่"/"วันรับรถคืนใหม่"
--       as the current dates (no date change) and only filled in the new shuttle times, the function
--       returned early ("nothing changed") BEFORE ever reaching the code that applies those times — so
--       the times silently never got set, even though the panel reported success.
--
--       Now the date-change part (capacity check, charge, reset+reassign trips to the new dates) and the
--       shuttle-time part (apply whatever pickup_to/landing_from/pickup_from the admin gave) are independent:
--       either can happen without the other. When dates don't change, trip rows are left alone (not reset)
--       and the new times are simply applied on top of whatever is already there.
-- error: not_found | bad_status | invalid_range | full:<date> | landing_after_pickup | not_allowed

drop function if exists admin_reschedule_booking(uuid, uuid, date, date, boolean, timestamptz, timestamptz, timestamptz);

create or replace function admin_reschedule_booking(
  p_actor uuid, p_id uuid, p_new_start date, p_new_end date, p_paid boolean default false,
  p_pickup_to timestamptz default null, p_pickup_from timestamptz default null, p_landing_from timestamptz default null)
returns bookings
language plpgsql set search_path = public as $$
declare
  a staff_users;
  b bookings;
  s settings;
  v_full date;
  v_dates_changed boolean;
  v_old_start date;
  v_old_end date;
  v_old_days int;
  v_new_days int;
  v_rate int;
  v_extra int;
  v_to_trip uuid;
  v_old_gap interval;
  v_pickup_from timestamptz;
begin
  a := staff_require_admin(p_actor);
  if p_new_end < p_new_start then raise exception 'invalid_range'; end if;
  if p_landing_from is not null and p_pickup_from is not null and p_landing_from > p_pickup_from then
    raise exception 'landing_after_pickup';
  end if;
  perform pg_advisory_xact_lock(hashtext('backyard_capacity'));
  select * into b from bookings where id = p_id for update;
  if not found then raise exception 'not_found'; end if;
  if b.status not in ('confirmed', 'checked_in') then raise exception 'bad_status'; end if;

  select * into s from settings where id = 1;
  v_dates_changed := (p_new_start, p_new_end) is distinct from (b.start_date, b.end_date);

  if v_dates_changed then
    v_full := admin_first_full_day(p_new_start, p_new_end, b.id);
    if v_full is not null then raise exception 'full:%', v_full; end if;

    v_old_start := b.start_date; v_old_end := b.end_date;
    v_old_days  := v_old_end - v_old_start + 1;
    v_new_days  := p_new_end - p_new_start + 1;
    -- still before the original start date: normal daily rate. already past it (mid-stay / overstay): the higher rate.
    v_rate      := case when today_bkk() < v_old_start then s.price_per_day else s.extra_price_per_day end;
    v_extra     := greatest(0, v_new_days - v_old_days) * v_rate;

    update bookings set
      original_start_date = coalesce(original_start_date, start_date),
      original_end_date   = coalesce(original_end_date, end_date),
      start_date       = p_new_start,
      end_date         = p_new_end,
      rescheduled_at   = now(),
      extra_amount_due = extra_amount_due + case when p_paid then 0 else v_extra end,
      updated_at       = now()
    where id = b.id returning * into b;

    -- old trip times belong to the old dates: clear them so admin/trips assigns fresh ones,
    -- then (below) fill in whatever new times the admin already gave us in this same step.
    update shuttle_trips set
      flight_date       = case direction when 'to_airport' then p_new_start else p_new_end end,
      flight_number     = null, flight_id = null, customer_time = null, pickup_at = null, landing_at = null,
      vehicle_id        = null, assignment_locked = false, drop_door = null, status = 'unassigned',
      called_at         = null, welcome_sent_at = null,
      updated_at        = now()
    where booking_id = b.id and status not in ('done', 'cancelled');

    if v_extra > 0 then
      insert into payments (booking_id, kind, amount, status, verified_by, paid_at)
      values (b.id, 'reschedule_extra', v_extra,
              case when p_paid then 'verified'::payment_status else 'pending'::payment_status end,
              case when p_paid then 'admin:' || a.username end,
              case when p_paid then now() end);
    end if;

    perform audit(a, 'reschedule', 'booking', b.id::text, jsonb_build_object(
      'old_start', v_old_start, 'old_end', v_old_end,
      'new_start', p_new_start, 'new_end', p_new_end, 'extra_amount', v_extra, 'rate', v_rate));
  end if;

  -- the trip's current landing->pickup gap (whether just reset above, or whatever's already there when
  -- dates didn't change), so a new landing time alone can still carry the same gap forward
  select pickup_at - landing_at into v_old_gap
  from shuttle_trips
  where booking_id = b.id and direction = 'from_airport' and status not in ('done', 'cancelled')
    and pickup_at is not null and landing_at is not null;

  -- shuttle times: applied whether or not the dates changed, so filling these in alone (same dates) works
  if p_pickup_to is not null then
    update shuttle_trips set pickup_at = p_pickup_to, customer_time = p_pickup_to, updated_at = now()
    where booking_id = b.id and direction = 'to_airport' and status not in ('done', 'cancelled')
    returning id into v_to_trip;
    if v_to_trip is not null then perform assign_vehicle(v_to_trip); end if;
  end if;

  if p_pickup_from is not null or p_landing_from is not null then
    v_pickup_from := coalesce(p_pickup_from,
      case when p_landing_from is not null then p_landing_from + coalesce(v_old_gap, make_interval(mins => s.exit_minutes_international)) end);
    update shuttle_trips set
      landing_at    = coalesce(p_landing_from, landing_at),
      pickup_at     = coalesce(v_pickup_from, pickup_at),
      customer_time = coalesce(v_pickup_from, customer_time),
      updated_at    = now()
    where booking_id = b.id and direction = 'from_airport' and status not in ('done', 'cancelled');
  end if;

  if not v_dates_changed and (p_pickup_to is not null or p_pickup_from is not null or p_landing_from is not null) then
    select * into b from bookings where id = p_id; -- unchanged, but re-read for a consistent return value
  end if;

  return b;
end $$;

revoke all on function admin_reschedule_booking(uuid, uuid, date, date, boolean, timestamptz, timestamptz, timestamptz) from public, anon, authenticated;
do $$ begin
  if exists (select 1 from pg_roles where rolname = 'service_role') then
    grant execute on function admin_reschedule_booking(uuid, uuid, date, date, boolean, timestamptz, timestamptz, timestamptz) to service_role;
  end if;
end $$;
notify pgrst, 'reload schema';
