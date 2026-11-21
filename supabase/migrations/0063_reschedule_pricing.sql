-- 0063: admin reschedule pricing — charge the normal per-day rate for extra days added
--       while the stay hasn't started yet (still before the original start date), but the
--       higher overstay rate once it's already past the original start date (customer has
--       effectively already arrived / is mid-stay).
-- error: not_found | bad_status | invalid_range | full:<date> | not_allowed

create or replace function admin_reschedule_booking(p_actor uuid, p_id uuid, p_new_start date, p_new_end date, p_paid boolean default false)
returns bookings
language plpgsql set search_path = public as $$
declare
  a staff_users;
  b bookings;
  s settings;
  v_full date;
  v_old_start date;
  v_old_end date;
  v_old_days int;
  v_new_days int;
  v_rate int;
  v_extra int;
begin
  a := staff_require_admin(p_actor);
  if p_new_end < p_new_start then raise exception 'invalid_range'; end if;
  perform pg_advisory_xact_lock(hashtext('backyard_capacity'));
  select * into b from bookings where id = p_id for update;
  if not found then raise exception 'not_found'; end if;
  if b.status not in ('confirmed', 'checked_in') then raise exception 'bad_status'; end if;

  if (p_new_start, p_new_end) is not distinct from (b.start_date, b.end_date) then
    return b;   -- nothing changed: no charge, no shuttle reset
  end if;

  select * into s from settings where id = 1;
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

  -- old trip times belong to the old dates: clear them so admin/trips assigns fresh ones.
  -- a van the customer already called is force-released too, since the whole date moved.
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
  return b;
end $$;

revoke all on function admin_reschedule_booking(uuid, uuid, date, date, boolean) from public, anon, authenticated;
do $$ begin
  if exists (select 1 from pg_roles where rolname = 'service_role') then
    grant execute on function admin_reschedule_booking(uuid, uuid, date, date, boolean) to service_role;
  end if;
end $$;
notify pgrst, 'reload schema';
