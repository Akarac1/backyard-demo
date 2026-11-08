-- 0011: 100 baht off for returning customers and for new customers referred by one.
--   * a "known customer phone" = a phone in member_phones (old customers imported by the admin)
--     or the phone of a customer who has a paid booking in the system
--   * the discount applies when the customer's own phone is known, or the referral phone
--     they enter is known (and is not their own number)
--   * the amount is settings.member_discount (0 = switched off)

-- ---------------------------------------------------------------------
-- phone helper: keep digits, +66 / 66 -> 0
-- ---------------------------------------------------------------------
create or replace function norm_phone(p text) returns text
language sql immutable as $$
  select case
    when d like '66%' and length(d) in (11, 12) then '0' || substr(d, 3)
    else d end
  from (select regexp_replace(coalesce(p, ''), '\D', '', 'g') as d) x
$$;

create table if not exists member_phones (
  phone      text primary key,          -- normalised
  name       text,
  note       text,
  added_by   uuid references staff_users(id),
  created_at timestamptz not null default now()
);
alter table member_phones enable row level security;

alter table settings add column if not exists member_discount int not null default 100;

alter table bookings add column if not exists discount_amount int  not null default 0;
alter table bookings add column if not exists discount_reason text;           -- 'member' | 'referral'
alter table bookings add column if not exists referrer_phone  text;

-- total = parking + shuttle - discount (payments already store what was really paid)
alter table bookings drop column total_amount;
alter table bookings add column total_amount int
  generated always as (parking_amount + shuttle_amount - discount_amount) stored;

create index if not exists customers_phone_norm_idx on customers (norm_phone(phone));

-- ---------------------------------------------------------------------
-- is this phone a known customer?
-- ---------------------------------------------------------------------
create or replace function phone_is_member(p_phone text) returns boolean
language sql stable set search_path = public as $$
  select norm_phone(p_phone) <> '' and (
    exists (select 1 from member_phones m where m.phone = norm_phone(p_phone))
    or exists (
      select 1 from customers c join bookings b on b.customer_id = c.id
      where norm_phone(c.phone) = norm_phone(p_phone)
        and b.status in ('confirmed', 'checked_in', 'checked_out', 'no_show'))
  )
$$;

-- ---------------------------------------------------------------------
-- discount for a booking about to be made: (amount, reason)
-- ---------------------------------------------------------------------
create or replace function booking_discount(p_phone text, p_ref_phone text)
returns table (amount int, reason text)
language plpgsql stable set search_path = public as $$
declare
  d int;
begin
  select member_discount into d from settings where id = 1;
  if coalesce(d, 0) <= 0 then return query select 0, null::text; return; end if;
  if phone_is_member(p_phone) then return query select d, 'member'::text; return; end if;
  if norm_phone(p_ref_phone) <> '' and norm_phone(p_ref_phone) <> norm_phone(p_phone)
     and phone_is_member(p_ref_phone) then
    return query select d, 'referral'::text; return;
  end if;
  return query select 0, null::text;
end $$;

-- ---------------------------------------------------------------------
-- create_booking: same as before + p_ref_phone, applies the discount
-- ---------------------------------------------------------------------
drop function if exists create_booking(text, text, text, text, text, date, date, boolean, int, text, timestamptz, text, timestamptz);

create or replace function create_booking(
  p_line_user_id      text,
  p_name              text,
  p_phone             text,
  p_plate             text,
  p_province          text,
  p_start             date,
  p_end               date,
  p_shuttle           boolean     default false,
  p_pax               int         default null,
  p_outbound_flight   text        default null,
  p_outbound_time     timestamptz default null,
  p_return_flight     text        default null,
  p_return_time       timestamptz default null,
  p_ref_phone         text        default null
) returns bookings
language plpgsql set search_path = public, extensions as $$
declare
  s          settings;
  v_customer uuid;
  v_full     date;
  v_disc     int;
  v_reason   text;
  b          bookings;
begin
  select * into s from settings where id = 1;

  if p_start < today_bkk() then raise exception 'start_date_in_past'; end if;
  if p_end < p_start       then raise exception 'invalid_range'; end if;
  if p_shuttle and (p_pax is null or p_pax < 1 or p_pax > s.shuttle_max_pax) then
    raise exception 'invalid_pax';
  end if;

  perform pg_advisory_xact_lock(hashtext('backyard_booking'));

  select a.day into v_full
  from check_availability(p_start, p_end) a
  where not a.available
  order by a.day limit 1;
  if v_full is not null then raise exception 'full:%', v_full; end if;

  -- decide the discount before this booking exists
  select bd.amount, bd.reason into v_disc, v_reason from booking_discount(p_phone, p_ref_phone) bd;
  v_disc := least(coalesce(v_disc, 0),
                  (p_end - p_start + 1) * s.price_per_day + case when p_shuttle then s.shuttle_price else 0 end);

  insert into customers (line_user_id, name, phone)
  values (p_line_user_id, p_name, p_phone)
  on conflict (line_user_id) do update set name = excluded.name, phone = excluded.phone
  returning id into v_customer;

  insert into bookings (customer_id, plate, plate_province, start_date, end_date,
                        parking_amount, shuttle, pax, shuttle_amount, hold_expires_at,
                        discount_amount, discount_reason, referrer_phone)
  values (v_customer,
          upper(regexp_replace(p_plate, '\s+', '', 'g')),
          p_province, p_start, p_end,
          (p_end - p_start + 1) * s.price_per_day,
          p_shuttle,
          case when p_shuttle then p_pax end,
          case when p_shuttle then s.shuttle_price else 0 end,
          now() + make_interval(mins => s.hold_minutes),
          v_disc,
          case when v_disc > 0 then v_reason end,
          case when v_disc > 0 and v_reason = 'referral' then norm_phone(p_ref_phone) end)
  returning * into b;

  if p_shuttle then
    insert into shuttle_trips (booking_id, direction, pax, flight_number, flight_date, customer_time, pickup_at)
    values (b.id, 'to_airport',   p_pax, nullif(upper(p_outbound_flight), ''), p_start, p_outbound_time, p_outbound_time),
           (b.id, 'from_airport', p_pax, nullif(upper(p_return_flight), ''),   p_end,   p_return_time,   p_return_time);
  end if;

  insert into payments (booking_id, kind, amount) values (b.id, 'booking', b.total_amount);

  return b;
end $$;

-- ---------------------------------------------------------------------
-- admin: old-customer phone list and the discount amount
-- ---------------------------------------------------------------------
-- p_lines: one customer per line, "phone" or "phone name"; returns how many were new
create or replace function admin_import_members(p_actor uuid, p_lines text)
returns int
language plpgsql set search_path = public as $$
declare
  a staff_users;
  line text;
  ph text;
  nm text;
  n int := 0;
  k int;
begin
  a := staff_require_admin(p_actor);
  foreach line in array regexp_split_to_array(coalesce(p_lines, ''), '\r?\n') loop
    line := trim(line);
    continue when line = '';
    ph := norm_phone(substring(line from '^[+0-9][0-9 \-]{7,15}'));
    continue when ph !~ '^0\d{8,9}$';
    nm := nullif(trim(regexp_replace(line, '^[+0-9][0-9 \-]{7,15}[\s,;]*', '')), '');
    insert into member_phones (phone, name, added_by) values (ph, nm, a.id)
    on conflict (phone) do nothing;
    get diagnostics k = row_count;
    n := n + k;
  end loop;
  perform audit(a, 'import', 'member_phones', null, jsonb_build_object('added', n));
  return n;
end $$;

create or replace function admin_remove_member(p_actor uuid, p_phone text)
returns void
language plpgsql set search_path = public as $$
declare a staff_users;
begin
  a := staff_require_admin(p_actor);
  delete from member_phones where phone = norm_phone(p_phone);
  perform audit(a, 'delete', 'member_phones', norm_phone(p_phone), null);
end $$;

create or replace function admin_set_member_discount(p_actor uuid, p_amount int)
returns void
language plpgsql set search_path = public as $$
declare a staff_users;
begin
  a := staff_require_admin(p_actor);
  if p_amount is null or p_amount < 0 or p_amount > 10000 then raise exception 'invalid_settings'; end if;
  update settings set member_discount = p_amount where id = 1;
  perform audit(a, 'update', 'settings', '1', jsonb_build_object('member_discount', p_amount));
end $$;

do $$ declare fn text; begin
  foreach fn in array array[
    'create_booking(text,text,text,text,text,date,date,boolean,int,text,timestamptz,text,timestamptz,text)',
    'booking_discount(text,text)', 'phone_is_member(text)',
    'admin_import_members(uuid,text)', 'admin_remove_member(uuid,text)', 'admin_set_member_discount(uuid,int)'
  ] loop
    execute format('revoke execute on function %s from public', fn);
    if exists (select 1 from pg_roles where rolname = 'anon') then
      execute format('revoke execute on function %s from anon, authenticated', fn);
    end if;
    if exists (select 1 from pg_roles where rolname = 'service_role') then
      execute format('grant execute on function %s to service_role', fn);
    end if;
  end loop;
end $$;

notify pgrst, 'reload schema';
