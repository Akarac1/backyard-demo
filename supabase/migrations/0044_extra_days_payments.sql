-- 0044: extra parking days follow through to the shuttle, unpaid extra payments can be paid at the desk,
--       and staff can edit the return pickup of a booking.

-- ---------------------------------------------------------------------
-- extra days: also move the return pickup by the same number of days (when it has not been called yet)
-- error: not_found | bad_status | invalid_days | full:<date> | not_allowed
-- ---------------------------------------------------------------------
drop function if exists admin_add_extra_days(uuid, uuid, int, boolean);
create or replace function admin_add_extra_days(p_actor uuid, p_booking_id uuid, p_days int, p_paid boolean, p_shift_return boolean default true)
returns bookings
language plpgsql set search_path = public as $$
declare
  a staff_users;
  b bookings;
  s settings;
  v_full date;
  v_amount int;
  v_shifted int := 0;
begin
  a := staff_require_admin(p_actor);
  if p_days is null or p_days < 1 or p_days > 60 then raise exception 'invalid_days'; end if;
  perform pg_advisory_xact_lock(hashtext('backyard_capacity'));
  select * into b from bookings where id = p_booking_id for update;
  if not found then raise exception 'not_found'; end if;
  if b.status not in ('confirmed', 'checked_in') then raise exception 'bad_status'; end if;
  select * into s from settings where id = 1;

  v_full := admin_first_full_day(b.end_date + 1, b.end_date + p_days, b.id);
  if v_full is not null then raise exception 'full:%', v_full; end if;

  v_amount := p_days * s.extra_price_per_day;
  update bookings set end_date = end_date + p_days, updated_at = now() where id = b.id returning * into b;
  insert into payments (booking_id, kind, amount, status, verified_by, paid_at)
  values (b.id, 'overstay', v_amount,
          case when p_paid then 'verified'::payment_status else 'pending'::payment_status end,
          case when p_paid then 'admin:' || a.username end,
          case when p_paid then now() end);

  -- the van that brings the customer back is booked for the old date: move it too (not once the customer called it)
  if p_shift_return then
    update shuttle_trips set
      pickup_at     = pickup_at + make_interval(days => p_days),
      landing_at    = landing_at + make_interval(days => p_days),
      customer_time = customer_time + make_interval(days => p_days),
      flight_date   = flight_date + p_days,
      welcome_sent_at = case when coalesce(landing_at, pickup_at) + make_interval(days => p_days) > now() then null else welcome_sent_at end,
      updated_at = now()
    where booking_id = b.id and direction = 'from_airport'
      and status not in ('done', 'cancelled') and called_at is null;
    get diagnostics v_shifted = row_count;
  end if;

  perform audit(a, 'extra_days', 'booking', b.id::text,
    jsonb_build_object('days', p_days, 'amount', v_amount, 'paid', p_paid, 'return_moved', v_shifted > 0));
  return b;
end $$;

-- ---------------------------------------------------------------------
-- edit the return pickup of one booking: flight landing time, pickup time, flight number
-- error: not_found | bad_status | invalid_time | landing_after_pickup | not_allowed
-- ---------------------------------------------------------------------
create or replace function admin_update_return_trip(
  p_actor uuid, p_trip_id uuid, p_landing_at timestamptz, p_pickup_at timestamptz, p_flight text)
returns shuttle_trips
language plpgsql set search_path = public as $$
declare
  a staff_users;
  t shuttle_trips;
  v_land timestamptz;
  v_pick timestamptz;
begin
  a := staff_require_admin(p_actor);
  select * into t from shuttle_trips where id = p_trip_id for update;
  if not found or t.direction <> 'from_airport' then raise exception 'not_found'; end if;
  if t.status in ('done', 'cancelled') then raise exception 'bad_status'; end if;

  v_land := coalesce(p_landing_at, t.landing_at);
  v_pick := p_pickup_at;
  -- only the landing time given: keep the same gap between landing and pickup
  if v_pick is null and p_landing_at is not null and t.landing_at is not null and t.pickup_at is not null then
    v_pick := t.pickup_at + (p_landing_at - t.landing_at);
  end if;
  v_pick := coalesce(v_pick, t.pickup_at, v_land);
  if v_pick is null then raise exception 'invalid_time'; end if;
  if v_land is not null and v_land > v_pick then raise exception 'landing_after_pickup'; end if;

  update shuttle_trips set
    landing_at = v_land,
    pickup_at = v_pick,
    customer_time = coalesce(v_land, v_pick),
    flight_date = (coalesce(v_land, v_pick) at time zone 'Asia/Bangkok')::date,
    flight_number = case when p_flight is null then flight_number else nullif(upper(regexp_replace(p_flight, '\s+', '', 'g')), '') end,
    welcome_sent_at = case when called_at is null and coalesce(v_land, v_pick) > now() then null else welcome_sent_at end,
    -- a van picked for the old time may be busy at the new one: release it unless the customer already called it
    vehicle_id = case when called_at is null and v_pick is distinct from t.pickup_at then null else vehicle_id end,
    assignment_locked = case when called_at is null and v_pick is distinct from t.pickup_at then false else assignment_locked end,
    updated_at = now()
  where id = t.id returning * into t;

  perform audit(a, 'update', 'booking', t.booking_id::text,
    jsonb_build_object('return_trip', jsonb_build_object('landing', t.landing_at, 'pickup', t.pickup_at, 'flight', t.flight_number)));
  return t;
end $$;

-- ---------------------------------------------------------------------
-- an admin records money for ANY pending payment (booking, extra days, reschedule difference):
-- cash, a transfer checked by eye, or a transfer whose slip the slip service accepted
-- error: not_found | payment_not_pending | full_after_hold_expired:<date> | not_allowed
-- ---------------------------------------------------------------------
create or replace function admin_pay_payment(p_actor uuid, p_payment_id uuid, p_method text, p_ref text default null)
returns bookings
language plpgsql set search_path = public as $$
declare
  a staff_users;
  p payments;
  b bookings;
begin
  a := staff_require_admin(p_actor);
  select * into p from payments where id = p_payment_id;
  if not found then raise exception 'not_found'; end if;
  if p.status <> 'pending' then raise exception 'payment_not_pending'; end if;
  b := confirm_payment(p.id, 'admin:' || a.username || ':' || coalesce(nullif(p_method, ''), 'manual') || coalesce(':' || nullif(p_ref, ''), ''));
  perform audit(a, 'mark_paid', 'booking', p.booking_id::text,
    jsonb_build_object('amount', p.amount, 'method', p_method, 'kind', p.kind, 'ref', p_ref));
  return b;
end $$;

revoke all on function admin_add_extra_days(uuid, uuid, int, boolean, boolean) from public, anon, authenticated;
revoke all on function admin_update_return_trip(uuid, uuid, timestamptz, timestamptz, text) from public, anon, authenticated;
revoke all on function admin_pay_payment(uuid, uuid, text, text) from public, anon, authenticated;
do $$ begin
  if exists (select 1 from pg_roles where rolname = 'service_role') then
    grant execute on function admin_add_extra_days(uuid, uuid, int, boolean, boolean) to service_role;
    grant execute on function admin_update_return_trip(uuid, uuid, timestamptz, timestamptz, text) to service_role;
    grant execute on function admin_pay_payment(uuid, uuid, text, text) to service_role;
  end if;
end $$;
notify pgrst, 'reload schema';
