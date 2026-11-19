-- 0052: late-night arrival / early-morning return = that parking day is free (shuttle customers only).
--   * arrive after 22:00 on the first day  -> the first day is not charged
--   * back by 02:00 on the return day      -> the return day is not charged
-- The booking form / API works out how many days are free (0..2) and passes p_free_days; this stores it in
-- bookings.free_days and charges (days - free_days) x price_per_day. Discounts and the coupon are capped to the
-- smaller gross. Run after 0051.

alter table bookings add column if not exists free_days int not null default 0 check (free_days >= 0);

create or replace function bookings_free_days_trg() returns trigger
language plpgsql set search_path = public as $$
declare
  s settings;
  v_free int := coalesce(nullif(current_setting('backyard.free_days', true), ''), '0')::int;
  v_days int := new.end_date - new.start_date + 1;
  v_gross int;
begin
  if v_free <= 0 then return new; end if;
  select * into s from settings where id = 1;
  v_free := least(v_free, v_days);
  new.free_days := v_free;
  new.parking_amount := (v_days - v_free) * s.price_per_day;
  v_gross := new.parking_amount + new.shuttle_amount;
  new.discount_amount := least(new.discount_amount, v_gross);
  if new.discount_amount = 0 then new.discount_reason := null; new.referrer_phone := null; end if;
  new.coupon_amount := least(new.coupon_amount, v_gross - new.discount_amount);
  return new;
end $$;

-- the name sorts first, so it runs before the campaign / promo triggers that read parking_amount
drop trigger if exists bookings_0_free_days on bookings;
create trigger bookings_0_free_days before insert on bookings
  for each row execute function bookings_free_days_trg();

-- same functions with one more optional argument (p_free_days); drop the old signatures so calls stay unambiguous
drop function if exists create_booking_group(text, text, text, jsonb, date, date, boolean, int, text, timestamptz, text, timestamptz, text, uuid, int);
drop function if exists create_booking_bags(text, text, text, text, text, date, date, boolean, int, text, timestamptz, text, timestamptz, text, uuid, uuid, int, int);

create or replace function create_booking_bags(
  p_line_user_id text, p_name text, p_phone text, p_plate text, p_province text, p_start date, p_end date,
  p_shuttle boolean default false, p_pax int default null, p_outbound_flight text default null,
  p_outbound_time timestamptz default null, p_return_flight text default null, p_return_time timestamptz default null,
  p_ref_phone text default null, p_coupon uuid default null, p_reward uuid default null,
  p_large int default 0, p_small int default 0, p_free_days int default 0)
returns bookings
language plpgsql set search_path = public, extensions as $$
begin
  if coalesce(p_large, 0) not between 0 and 20 or coalesce(p_small, 0) not between 0 and 20 then raise exception 'invalid_bags'; end if;
  perform set_config('backyard.bags', coalesce(p_large, 0) || ',' || coalesce(p_small, 0), true);
  perform set_config('backyard.free_days', greatest(coalesce(p_free_days, 0), 0)::text, true);
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

create or replace function create_booking_group(
  p_line_user_id text, p_name text, p_phone text, p_cars jsonb, p_start date, p_end date,
  p_shuttle boolean default false, p_pax int default null, p_outbound_flight text default null,
  p_outbound_time timestamptz default null, p_return_flight text default null, p_return_time timestamptz default null,
  p_ref_phone text default null, p_coupon uuid default null, p_large int default 0, p_free_days int default 0)
returns bookings
language plpgsql set search_path = public, extensions as $$
declare
  s settings; n int; i int; pl text; plates text[] := '{}';
  v_cust uuid; units int; g uuid; lead bookings; b bookings; v_total int;
begin
  select * into s from settings where id = 1;
  n := case when jsonb_typeof(p_cars) = 'array' then jsonb_array_length(p_cars) else 0 end;
  if n < 2 or n > s.group_max_cars then raise exception 'invalid_group_size'; end if;
  for i in 0..n - 1 loop
    pl := upper(regexp_replace(coalesce(p_cars -> i ->> 'plate', ''), '\s+', '', 'g'));
    if pl = '' or pl = any(plates) then raise exception 'invalid_group_plates'; end if;
    plates := plates || pl;
  end loop;

  select id into v_cust from customers where line_user_id = p_line_user_id;
  if v_cust is not null then
    perform pg_advisory_xact_lock(hashtext('hold:' || v_cust::text));
    select count(distinct coalesce(group_id, id)) into units from bookings
    where customer_id = v_cust and status = 'pending_payment' and (hold_expires_at is null or hold_expires_at > now());
    if units >= 2 then raise exception 'too_many_holds'; end if;
  end if;

  perform set_config('backyard.in_group', '1', true);
  -- the lead car carries the shuttle, the coupon and the returning-customer discount
  lead := create_booking_bags(p_line_user_id => p_line_user_id, p_name => p_name, p_phone => p_phone,
    p_plate => p_cars -> 0 ->> 'plate', p_province => coalesce(p_cars -> 0 ->> 'province', ''), p_start => p_start, p_end => p_end,
    p_shuttle => p_shuttle, p_pax => p_pax, p_outbound_flight => p_outbound_flight, p_outbound_time => p_outbound_time,
    p_return_flight => p_return_flight, p_return_time => p_return_time, p_ref_phone => p_ref_phone, p_coupon => p_coupon,
    p_large => p_large, p_small => 0, p_free_days => p_free_days);
  insert into booking_groups (customer_id, lead_booking_id) values (lead.customer_id, lead.id) returning id into g;
  update bookings set group_id = g where id = lead.id;

  for i in 1..n - 1 loop
    b := create_booking(p_line_user_id => p_line_user_id, p_name => p_name, p_phone => p_phone,
      p_plate => p_cars -> i ->> 'plate', p_province => coalesce(p_cars -> i ->> 'province', ''), p_start => p_start, p_end => p_end,
      p_shuttle => false);
    -- the returning-customer discount is once per group (the lead)
    update bookings set group_id = g, discount_amount = 0, discount_reason = null, referrer_phone = null where id = b.id;
  end loop;

  -- one payment for the whole group, on the lead
  select coalesce(sum(total_amount), 0) into v_total from bookings where group_id = g;
  delete from payments where kind = 'booking' and status = 'pending' and booking_id in (select id from bookings where group_id = g);
  if v_total > 0 then
    update bookings set status = 'pending_payment', hold_expires_at = now() + make_interval(mins => s.hold_minutes) where group_id = g;
    insert into payments (booking_id, kind, amount) values (lead.id, 'booking', v_total);
  else
    update bookings set status = 'confirmed', hold_expires_at = null where group_id = g;
  end if;
  select * into lead from bookings where id = lead.id;
  return lead;
end $$;

do $$
declare f text;
begin
  foreach f in array array[
    'create_booking_bags(text, text, text, text, text, date, date, boolean, int, text, timestamptz, text, timestamptz, text, uuid, uuid, int, int, int)',
    'create_booking_group(text, text, text, jsonb, date, date, boolean, int, text, timestamptz, text, timestamptz, text, uuid, int, int)']
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
