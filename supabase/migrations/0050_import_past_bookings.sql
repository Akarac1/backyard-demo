-- 0050: bring the old shop sheet's past bookings into the system as history.
-- Each row becomes a finished booking (checked_out) with a verified payment, so it shows in the
-- customer's history, counts for tier / returning-customer rules and earns points like a normal paid
-- booking (amount / points_per_baht, the payments trigger does it). Customers without LINE are
-- placeholders (line_user_id 'demo-walkin-<phone>') that link later with phone + plate.
-- Rows are handled oldest first so tiers grow in the right order. Safe to run twice: a booking with the
-- same phone, plate and start date is skipped. Each booking also gets its two finished shuttle trips
-- (to the airport on the drop-off date/time, from the airport on the pick-up date/time) so the times are kept.
-- A car in the lot today (start before today, return today or later) is checked in; a car that starts today or later is
-- confirmed; both keep their open trips and are queued for the plate reader. Bookings that were already agreed are loaded
-- as they are: the lot / shuttle capacity checks of the self-service flow are not applied.

drop function if exists admin_import_past_bookings(uuid, jsonb);
create function admin_import_past_bookings(p_actor uuid, p_rows jsonb)
returns table (n_imported int, n_skipped int, n_points bigint)
language plpgsql set search_path = public, extensions as $$
declare
  a staff_users; r record; c customers; v_phone text; v_line text; bid uuid;
  v_ship int; v_park int; imp int := 0; skp int := 0; p0 bigint; p1 bigint;
  v_in timestamptz; v_out timestamptz; v_pay uuid; v_today date := (now() at time zone 'Asia/Bangkok')::date; v_act boolean; v_fut boolean;
begin
  a := staff_require_admin(p_actor);
  if jsonb_typeof(p_rows) <> 'array' or jsonb_array_length(p_rows) > 1000 then raise exception 'invalid_rows'; end if;
  select coalesce(sum(l.points), 0) into p0 from point_lots l where l.source = 'payment';

  for r in
    select * from jsonb_to_recordset(p_rows) as x(name text, phone text, plate text, start date, "end" date, price int,
      shuttle boolean, pax int, note text, ref int, out_date date, out_time text, back_time text, large int)
    order by x.start, x.ref
  loop
    v_phone := nullif(norm_phone(r.phone), '');
    if nullif(trim(coalesce(r.plate, '')), '') is null or r.start is null or r."end" is null or r."end" < r.start
       or (v_phone is not null and v_phone !~ '^0[0-9]{8,9}$') then skp := skp + 1; continue; end if;

    c := null;
    if v_phone is not null then
      select * into c from customers where norm_phone(phone) = v_phone
      order by (line_user_id not like 'demo-%') desc, created_at limit 1;
    end if;
    if c.id is null then
      v_line := 'demo-walkin-' || coalesce(v_phone, 'sheet' || coalesce(r.ref::text, replace(gen_random_uuid()::text, '-', '')));
      insert into customers (line_user_id, name, phone)
      values (v_line, coalesce(nullif(trim(r.name), ''), 'ลูกค้า'), coalesce(v_phone, ''))
      on conflict (line_user_id) do update set name = customers.name returning * into c;
    end if;

    if exists (select 1 from bookings b where b.customer_id = c.id and b.plate = trim(r.plate) and b.start_date = r.start) then
      skp := skp + 1; continue;
    end if;

    v_fut := r.start >= v_today;                     -- not arrived yet: confirmed, both trips still to run
    v_act := not v_fut and r."end" >= v_today;      -- in the lot today: checked in, return trip still to run
    v_ship := case when coalesce(r.shuttle, true) then least(300, coalesce(r.price, 0)) else 0 end;
    v_park := coalesce(r.price, 0) - v_ship;
    -- drop-off at the lot / to the airport, and pick-up on return: date + time as written in the sheet
    v_in  := (coalesce(r.out_date, r.start)::text || ' ' || coalesce(nullif(r.out_time, ''), '12:00') || ':00+07')::timestamptz;
    v_out := (r."end"::text || ' ' || coalesce(nullif(r.back_time, ''), '12:00') || ':00+07')::timestamptz;

    insert into bookings (customer_id, plate, plate_province, start_date, end_date, parking_amount, shuttle, pax, shuttle_amount,
                          status, booked_at, created_at, checked_in_at, checked_out_at, checked_in_by, checked_out_by, admin_note, source)
    values (c.id, trim(r.plate), '', r.start, r."end", v_park, coalesce(r.shuttle, true),
            case when coalesce(r.shuttle, true) then least(greatest(coalesce(r.pax, 1), 1), 7) end, v_ship,
            case when v_fut then 'confirmed' when v_act then 'checked_in' else 'checked_out' end::booking_status,
            least(v_in - interval '1 day', now()), least(v_in - interval '1 day', now()), case when v_fut then null else v_in end,
            case when v_act or v_fut then null else v_out end, case when v_fut then null else 'import' end, case when v_act or v_fut then null else 'import' end,
            nullif(trim(coalesce(r.note, '')), ''), 'import')
    returning id into bid;
    -- the insert triggers may add a campaign or discount: the sheet price is the truth
    update bookings set discount_amount = 0, discount_reason = null, referrer_phone = null, coupon_amount = 0, campaign_amount = 0, campaign_id = null
    where id = bid and (discount_amount <> 0 or campaign_amount <> 0);

    if coalesce(r.shuttle, true) then
      insert into shuttle_trips (booking_id, direction, pax, flight_date, customer_time, pickup_at, status, completed_at, large_bags)
      values (bid, 'to_airport',   least(greatest(coalesce(r.pax, 1), 1), 7), coalesce(r.out_date, r.start),
              case when nullif(r.out_time, '') is not null then v_in end,  case when nullif(r.out_time, '') is not null then v_in end,  case when v_fut then 'unassigned' else 'done' end::trip_status, case when v_fut then null else v_in end, greatest(coalesce(r.large, 0), 0)),
             (bid, 'from_airport', least(greatest(coalesce(r.pax, 1), 1), 7), r."end",
              case when nullif(r.back_time, '') is not null then v_out end, case when nullif(r.back_time, '') is not null then v_out end, case when v_act or v_fut then 'unassigned' else 'done' end::trip_status, case when v_act or v_fut then null else v_out end, greatest(coalesce(r.large, 0), 0));
    end if;
    if v_act or v_fut then
      insert into lpr_sync (booking_id, plate, plate_province, action, valid_from, valid_to)
      values (bid, trim(r.plate), '', 'add', r.start, r."end");
    end if;

    if coalesce(r.price, 0) > 0 then
      insert into payments (booking_id, kind, amount, status, verified_by, paid_at)
      values (bid, 'booking', r.price, 'verified', 'import', least(v_in - interval '1 day', now()));
    end if;
    imp := imp + 1;
  end loop;

  select coalesce(sum(l.points), 0) into p1 from point_lots l where l.source = 'payment';
  perform audit(a, 'import', 'bookings', 'past', jsonb_build_object('imported', imp, 'skipped', skp, 'points', p1 - p0));
  return query select imp, skp, p1 - p0;
end $$;

do $$ begin
  revoke execute on function admin_import_past_bookings(uuid, jsonb) from public;
  if exists (select 1 from pg_roles where rolname = 'anon') then
    revoke execute on function admin_import_past_bookings(uuid, jsonb) from anon, authenticated;
  end if;
  if exists (select 1 from pg_roles where rolname = 'service_role') then
    grant execute on function admin_import_past_bookings(uuid, jsonb) to service_role;
  end if;
end $$;
notify pgrst, 'reload schema';
