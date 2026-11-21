-- 0067: fix a real bug when a booking's 15-minute hold lapses (status -> 'expired') and then gets paid
--       late — either by the admin, or by the new "ลูกค้าส่งสลิปในแชท" auto-verify.
--
--       There's a trigger (bookings_cancel_trips_trg, migration 0030) that fires whenever a booking's
--       status moves into 'expired'/'cancelled'/'no_show': it cancels every shuttle_trips row for that
--       booking. That's correct for a real cancel/no-show, but it ALSO fires on a plain hold-timeout — and
--       confirm_payment() never un-does it when the booking is later revived back to 'confirmed'. Result:
--       the booking shows confirmed, but "รถรับส่ง" stays stuck on "ยกเลิก" forever.
--
--       Fix: when confirm_payment() revives a booking from 'expired' (for the booking itself, and for
--       every sibling car in a group booking), reset any of its shuttle_trips that are sitting at
--       'cancelled' back to 'unassigned' — same reset shape admin_reschedule_booking() already uses when
--       it resets trips for a date change. A trip already 'done' is left alone (can't happen for a
--       'pending_payment'/'expired' booking anyway, but matches the same guard used elsewhere).
-- error: payment_not_found | payment_not_pending | booking_not_awaiting_payment | full_after_hold_expired:<date>

create or replace function confirm_payment(p_payment_id uuid, p_verified_by text) returns bookings
language plpgsql as $$
declare
  p      payments;
  b      bookings;
  o      bookings;
  v_full date;
begin
  perform pg_advisory_xact_lock(hashtext('backyard_booking'));

  select * into p from payments where id = p_payment_id for update;
  if not found then raise exception 'payment_not_found'; end if;
  if p.status <> 'pending' then raise exception 'payment_not_pending'; end if;

  select * into b from bookings where id = p.booking_id for update;

  if p.kind = 'booking' then
    if b.status not in ('pending_payment', 'expired') then raise exception 'booking_not_awaiting_payment'; end if;
    if b.status = 'expired' or b.hold_expires_at <= now() then
      select a.day into v_full
      from check_availability(b.start_date, b.end_date, b.id) a
      where not a.available order by a.day limit 1;
      if v_full is not null then raise exception 'full_after_hold_expired:%', v_full; end if;
    end if;
    update bookings set status = 'confirmed', hold_expires_at = null
    where id = b.id returning * into b;
    update shuttle_trips set
      flight_date = case direction when 'to_airport' then b.start_date else b.end_date end,
      flight_number = null, flight_id = null, customer_time = null, pickup_at = null, landing_at = null,
      vehicle_id = null, assignment_locked = false, drop_door = null, status = 'unassigned',
      called_at = null, welcome_sent_at = null, updated_at = now()
    where booking_id = b.id and status = 'cancelled';
    if b.group_id is not null then
      for o in select * from bookings where group_id = b.group_id and id <> b.id and status in ('pending_payment', 'expired') order by created_at for update loop
        if o.status = 'expired' or o.hold_expires_at <= now() then
          select a.day into v_full
          from check_availability(o.start_date, o.end_date, o.id) a
          where not a.available order by a.day limit 1;
          if v_full is not null then raise exception 'full_after_hold_expired:%', v_full; end if;
        end if;
        update bookings set status = 'confirmed', hold_expires_at = null where id = o.id;
        update shuttle_trips set
          flight_date = case direction when 'to_airport' then o.start_date else o.end_date end,
          flight_number = null, flight_id = null, customer_time = null, pickup_at = null, landing_at = null,
          vehicle_id = null, assignment_locked = false, drop_door = null, status = 'unassigned',
          called_at = null, welcome_sent_at = null, updated_at = now()
        where booking_id = o.id and status = 'cancelled';
      end loop;
    end if;
  elsif p.kind = 'reschedule_extra' then
    update bookings set extra_amount_due = greatest(0, extra_amount_due - p.amount)
    where id = b.id returning * into b;
  end if;

  update payments set status = 'verified', verified_by = p_verified_by, paid_at = now()
  where id = p.id;

  return b;
end $$;

revoke all on function confirm_payment(uuid, text) from public, anon, authenticated;
do $$ begin
  if exists (select 1 from pg_roles where rolname = 'service_role') then
    grant execute on function confirm_payment(uuid, text) to service_role;
  end if;
end $$;
notify pgrst, 'reload schema';
