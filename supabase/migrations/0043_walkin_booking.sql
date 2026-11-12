-- 0043: walk-in booking made by an admin at the counter (elderly customers, people without LINE).
--  * same rules as the LIFF booking (availability, prices, discounts, shuttle, group of cars)
--  * customer: found by phone (an existing LINE member keeps their record, points and tier);
--    otherwise a no-LINE customer ("demo-walkin-…" id, so no LINE message is ever tried)
--  * payment taken at the counter: cash / transfer -> confirmed at once; unpaid -> held 1 hour
--  * optional check-in right away when the car is at the lot
-- Run after 0042.

alter table bookings add column if not exists source text not null default 'line';

create or replace function admin_walkin_booking(
  p_actor uuid, p_name text, p_phone text, p_cars jsonb, p_start date, p_end date,
  p_shuttle boolean default false, p_pax int default null, p_outbound_time timestamptz default null,
  p_return_flight text default null, p_return_time timestamptz default null, p_large int default 0,
  p_method text default 'cash', p_checkin boolean default false, p_note text default null)
returns bookings
language plpgsql set search_path = public, extensions as $$
declare
  a staff_users; s settings; c customers; lead bookings;
  n int; v_phone text; v_line text; v_name text; v_pay uuid; ids uuid[]; i uuid;
begin
  a := staff_require_admin(p_actor);
  select * into s from settings where id = 1;
  if p_method not in ('cash', 'transfer', 'unpaid') then raise exception 'invalid_method'; end if;
  n := case when jsonb_typeof(p_cars) = 'array' then jsonb_array_length(p_cars) else 0 end;
  if n < 1 or n > s.group_max_cars then raise exception 'invalid_group_size'; end if;
  if nullif(trim(coalesce(p_cars -> 0 ->> 'plate', '')), '') is null then raise exception 'invalid_group_plates'; end if;

  v_phone := nullif(trim(coalesce(p_phone, '')), '');
  if v_phone is not null and norm_phone(v_phone) !~ '^0[0-9]{8,9}$' then raise exception 'invalid_phone'; end if;
  if v_phone is not null then
    select * into c from customers where norm_phone(phone) = norm_phone(v_phone)
    order by (line_user_id not like 'demo-%') desc, created_at limit 1;
  end if;
  if c.id is not null then
    v_line := c.line_user_id; v_name := c.name; v_phone := c.phone;
  else
    if nullif(trim(coalesce(p_name, '')), '') is null then raise exception 'invalid_name'; end if;
    v_line := 'demo-walkin-' || coalesce(nullif(norm_phone(v_phone), ''), replace(gen_random_uuid()::text, '-', ''));
    v_name := trim(p_name);
  end if;

  -- the counter is not limited by the 2-unpaid-holds rule of the self-service flow
  perform set_config('backyard.in_group', '1', true);
  if n = 1 then
    lead := create_booking_bags(p_line_user_id => v_line, p_name => v_name, p_phone => coalesce(v_phone, ''),
      p_plate => p_cars -> 0 ->> 'plate', p_province => coalesce(p_cars -> 0 ->> 'province', ''), p_start => p_start, p_end => p_end,
      p_shuttle => p_shuttle, p_pax => p_pax, p_outbound_time => p_outbound_time, p_return_flight => p_return_flight,
      p_return_time => p_return_time, p_large => p_large, p_small => 0);
  else
    lead := create_booking_group(p_line_user_id => v_line, p_name => v_name, p_phone => coalesce(v_phone, ''), p_cars => p_cars,
      p_start => p_start, p_end => p_end, p_shuttle => p_shuttle, p_pax => p_pax, p_outbound_time => p_outbound_time,
      p_return_flight => p_return_flight, p_return_time => p_return_time, p_large => p_large);
  end if;

  select array_agg(id) into ids from bookings where id = lead.id or (lead.group_id is not null and group_id = lead.group_id);
  update bookings set source = 'walkin', admin_note = nullif(trim(coalesce(p_note, '')), '') where id = any(ids);

  if lead.status = 'pending_payment' then
    if p_method in ('cash', 'transfer') then
      select id into v_pay from payments where booking_id = lead.id and kind = 'booking' and status = 'pending' order by created_at desc limit 1;
      perform confirm_payment(v_pay, 'admin:' || a.username || ':walkin-' || p_method);
    else
      update bookings set hold_expires_at = now() + interval '1 hour' where id = any(ids) and status = 'pending_payment';
    end if;
  end if;

  if p_checkin then
    foreach i in array ids loop
      if (select status from bookings where id = i) = 'confirmed' then perform admin_set_booking_status(p_actor, i, 'checked_in'); end if;
    end loop;
  end if;

  perform audit(a, 'walkin', 'booking', lead.id::text, jsonb_build_object('cars', n, 'method', p_method, 'checkin', p_checkin));
  select * into lead from bookings where id = lead.id;
  return lead;
end $$;

revoke all on function admin_walkin_booking(uuid, text, text, jsonb, date, date, boolean, int, timestamptz, text, timestamptz, int, text, boolean, text) from public, anon, authenticated;
do $$ begin
  if exists (select 1 from pg_roles where rolname = 'service_role') then
    grant execute on function admin_walkin_booking(uuid, text, text, jsonb, date, date, boolean, int, timestamptz, text, timestamptz, int, text, boolean, text) to service_role;
  end if;
end $$;
notify pgrst, 'reload schema';
