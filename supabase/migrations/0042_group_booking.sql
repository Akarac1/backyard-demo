-- 0042: group booking = several cars booked in one go (tour, family with 2-5 cars).
--  * one booking per car (same dates), linked by bookings.group_id; the first car is the "lead"
--  * ONE payment (on the lead, = sum of all cars) -> paying it confirms every car
--  * ONE shuttle: the trips belong to the lead booking, the whole group rides together in one regular van
--  * the returning-customer discount applies once (on the lead); a campaign / parking per car as usual
--  * a group counts as one unpaid hold for the 2-hold limit
-- Run after 0041.

alter table settings add column if not exists group_max_cars int not null default 5 check (group_max_cars between 2 and 20);

create table if not exists booking_groups (
  id uuid primary key default gen_random_uuid(),
  customer_id uuid references customers(id) on delete set null,
  lead_booking_id uuid,
  created_at timestamptz not null default now()
);
alter table booking_groups enable row level security;
alter table bookings add column if not exists group_id uuid references booking_groups(id) on delete set null;
do $$ begin
  if not exists (select 1 from pg_constraint where conname = 'booking_groups_lead_fk') then
    alter table booking_groups add constraint booking_groups_lead_fk foreign key (lead_booking_id) references bookings(id) on delete set null;
  end if;
end $$;
create index if not exists bookings_group_idx on bookings (group_id) where group_id is not null;
do $$ begin
  if exists (select 1 from pg_roles where rolname = 'service_role') then
    grant select, insert, update, delete on booking_groups to service_role;
  end if;
end $$;

-- hold limit: a group counts as one; cars inside a group insert are not counted one by one
create or replace function bookings_hold_limit_trg() returns trigger
language plpgsql set search_path = public as $$
begin
  if coalesce(current_setting('backyard.in_group', true), '') = '1' then return new; end if;
  if new.status = 'pending_payment' and new.customer_id is not null then
    perform pg_advisory_xact_lock(hashtext('hold:' || new.customer_id::text));
    if (select count(distinct coalesce(group_id, id)) from bookings
        where customer_id = new.customer_id and status = 'pending_payment'
          and (hold_expires_at is null or hold_expires_at > now())) >= 2 then
      raise exception 'too_many_holds';
    end if;
  end if;
  return new;
end $$;

-- p_cars = [{"plate":"1กข1234","province":"กรุงเทพมหานคร"}, ...] (2..group_max_cars cars, unique plates)
-- shuttle (if any) is for the whole group: p_pax people and p_large bags in ONE van
-- errors: invalid_group_size | invalid_group_plates | too_many_holds | full:<date> | shuttle errors as create_booking
create or replace function create_booking_group(
  p_line_user_id text, p_name text, p_phone text, p_cars jsonb, p_start date, p_end date,
  p_shuttle boolean default false, p_pax int default null, p_outbound_flight text default null,
  p_outbound_time timestamptz default null, p_return_flight text default null, p_return_time timestamptz default null,
  p_ref_phone text default null, p_coupon uuid default null, p_large int default 0)
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
    p_large => p_large, p_small => 0);
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

-- paying the lead's payment confirms every car of the group
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
    if b.group_id is not null then
      for o in select * from bookings where group_id = b.group_id and id <> b.id and status in ('pending_payment', 'expired') order by created_at for update loop
        if o.status = 'expired' or o.hold_expires_at <= now() then
          select a.day into v_full
          from check_availability(o.start_date, o.end_date, o.id) a
          where not a.available order by a.day limit 1;
          if v_full is not null then raise exception 'full_after_hold_expired:%', v_full; end if;
        end if;
        update bookings set status = 'confirmed', hold_expires_at = null where id = o.id;
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

-- admin records the money from any car of a group: finds the group's one pending payment
create or replace function admin_mark_paid(p_actor uuid, p_booking_id uuid, p_method text)
returns bookings
language plpgsql set search_path = public as $$
declare
  a staff_users;
  p payments;
  b bookings;
begin
  a := staff_require_admin(p_actor);
  select pm.* into p from payments pm
  where pm.kind = 'booking' and pm.status = 'pending'
    and (pm.booking_id = p_booking_id
         or pm.booking_id in (select x.id from bookings x
                              where x.group_id is not null and x.group_id = (select y.group_id from bookings y where y.id = p_booking_id)))
  order by pm.created_at desc limit 1;
  if not found then raise exception 'payment_not_pending'; end if;
  b := confirm_payment(p.id, 'admin:' || a.username || ':' || coalesce(nullif(p_method, ''), 'manual'));
  perform audit(a, 'mark_paid', 'booking', p_booking_id::text, jsonb_build_object('amount', p.amount, 'method', p_method));
  return b;
end $$;

create or replace function admin_set_group_max(p_actor uuid, p_max int) returns void
language plpgsql set search_path = public as $$
declare a staff_users;
begin
  a := staff_require_admin(p_actor);
  if p_max is null or p_max < 2 or p_max > 20 then raise exception 'invalid_group_max'; end if;
  update settings set group_max_cars = p_max where id = 1;
  perform audit(a, 'update', 'settings', 'group_max_cars', jsonb_build_object('max', p_max));
end $$;

revoke all on function create_booking_group(text, text, text, jsonb, date, date, boolean, int, text, timestamptz, text, timestamptz, text, uuid, int) from public, anon, authenticated;
revoke all on function admin_set_group_max(uuid, int) from public, anon, authenticated;
do $$ begin
  if exists (select 1 from pg_roles where rolname = 'service_role') then
    grant execute on function create_booking_group(text, text, text, jsonb, date, date, boolean, int, text, timestamptz, text, timestamptz, text, uuid, int) to service_role;
    grant execute on function admin_set_group_max(uuid, int) to service_role;
  end if;
end $$;
notify pgrst, 'reload schema';
