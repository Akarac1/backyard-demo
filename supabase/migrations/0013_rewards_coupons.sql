-- 0013: points are exchanged for coupons from a reward catalog (instead of being a discount directly)
--   * earning points stays as in 0012 (100 baht paid = 1 point, referral = 3 points, 3-year expiry)
--   * the customer picks a reward and spends points -> gets a coupon with a code
--   * coupon kinds:
--       parking_discount : used on the booking page, takes value_baht off a parking booking
--       item             : anything else (a coffee, a room night ...): staff enter the code to mark it used
--   * a coupon used on a booking that expires / is cancelled before payment becomes usable again
-- Run after 0012.

-- ---------------------------------------------------------------------
-- catalog and coupons
-- ---------------------------------------------------------------------
create table if not exists rewards (
  id           uuid primary key default gen_random_uuid(),
  title        text not null,
  description  text,
  business     text not null default 'parking',   -- 'parking' | 'cafe' | 'stay' | anything
  kind         text not null default 'item' check (kind in ('parking_discount', 'item')),
  value_baht   int  not null default 0,            -- parking_discount: baht off
  points_cost  int  not null check (points_cost > 0),
  valid_days   int  not null default 90 check (valid_days between 1 and 1095),
  stock        int,                                -- null = unlimited
  active       boolean not null default true,
  sort         int  not null default 0,
  created_at   timestamptz not null default now()
);
alter table rewards enable row level security;

create table if not exists coupons (
  id            uuid primary key default gen_random_uuid(),
  code          text unique not null,
  customer_id   uuid not null references customers(id) on delete cascade,
  reward_id     uuid references rewards(id) on delete set null,
  title         text not null,                   -- copied from the reward at the time
  business      text not null,
  kind          text not null,
  value_baht    int  not null default 0,
  points_spent  int  not null,
  spend_id      bigint references point_spends(id) on delete set null,
  status        text not null default 'active' check (status in ('active', 'used', 'cancelled')),
  expires_at    timestamptz not null,
  used_at       timestamptz,
  used_booking  uuid references bookings(id) on delete set null,
  used_by       text,
  created_at    timestamptz not null default now()
);
create index if not exists coupons_customer_idx on coupons (customer_id, status);
alter table coupons enable row level security;

-- default catalog (the admin can edit / add more; cafe and room rewards start switched off)
insert into rewards (title, description, business, kind, value_baht, points_cost, valid_days, active, sort)
select * from (values
  ('ส่วนลดค่าจอด 50 บาท',  'ใช้ตอนจองที่จอดรถในหน้าจอง', 'parking', 'parking_discount', 50,  5,  180, true,  10),
  ('ส่วนลดค่าจอด 100 บาท', 'ใช้ตอนจองที่จอดรถในหน้าจอง', 'parking', 'parking_discount', 100, 10, 180, true,  20),
  ('กาแฟ 1 แก้ว',          'แสดงรหัสคูปองที่คาเฟ่',       'cafe',    'item',             0,   8,  90,  false, 30),
  ('ห้องพัก 1 คืน',         'แจ้งรหัสคูปองตอนจองห้องพัก',  'stay',    'item',             0,   80, 365, false, 40)
) v(title, description, business, kind, value_baht, points_cost, valid_days, active, sort)
where not exists (select 1 from rewards);

-- ---------------------------------------------------------------------
-- bookings: coupon instead of points
-- ---------------------------------------------------------------------
alter table bookings add column if not exists coupon_id     uuid references coupons(id) on delete set null;
alter table bookings add column if not exists coupon_amount int not null default 0;

-- bookings already made with points (0012) keep their price: move the baht into coupon_amount
do $$ begin
  if exists (select 1 from information_schema.columns where table_name = 'bookings' and column_name = 'points_amount') then
    execute 'update bookings set coupon_amount = points_amount where points_amount > 0';
  end if;
end $$;

alter table bookings drop column total_amount;
alter table bookings drop column if exists points_used;
alter table bookings drop column if exists points_amount;
alter table bookings add column total_amount int
  generated always as (parking_amount + shuttle_amount - discount_amount - coupon_amount) stored;

-- ---------------------------------------------------------------------
-- points helpers: spending returns its id; a spend can be refunded
-- ---------------------------------------------------------------------
drop function if exists points_take(uuid, int, text, uuid, text);
create or replace function points_take(p_customer uuid, p_points int, p_reason text,
  p_booking uuid default null, p_note text default null)
returns bigint
language plpgsql set search_path = public as $$
declare
  left_ int := p_points;
  l point_lots;
  take int;
  sid bigint;
begin
  if coalesce(p_points, 0) <= 0 then return null; end if;
  perform pg_advisory_xact_lock(hashtext('points:' || p_customer::text));
  if points_balance(p_customer) < p_points then raise exception 'not_enough_points'; end if;
  insert into point_spends (customer_id, booking_id, points, reason, note)
  values (p_customer, p_booking, p_points, p_reason, p_note) returning id into sid;
  for l in select * from point_lots
           where customer_id = p_customer and remaining > 0 and expires_at > now()
           order by expires_at, id for update loop
    exit when left_ = 0;
    take := least(l.remaining, left_);
    update point_lots set remaining = remaining - take where id = l.id;
    insert into point_spend_lots (spend_id, lot_id, points) values (sid, l.id, take);
    left_ := left_ - take;
  end loop;
  return sid;
end $$;

create or replace function points_refund(p_spend bigint) returns void
language plpgsql set search_path = public as $$
begin
  update point_lots l set remaining = l.remaining + x.points
  from point_spend_lots x
  where x.spend_id = p_spend and x.lot_id = l.id
    and exists (select 1 from point_spends s where s.id = p_spend and s.returned_at is null);
  update point_spends set returned_at = now() where id = p_spend and returned_at is null;
end $$;

drop function if exists points_return(uuid);

create or replace function gen_coupon_code() returns text
language plpgsql volatile set search_path = public, extensions as $$
declare
  alphabet constant text := 'ABCDEFGHJKMNPQRSTUVWXYZ23456789';
  c text;
begin
  loop
    select 'C' || string_agg(substr(alphabet, 1 + (get_byte(b, i) % length(alphabet)), 1), '' order by i)
      into c from (select gen_random_bytes(7) as b) r, generate_series(0, 6) i;
    exit when not exists (select 1 from coupons where code = c);
  end loop;
  return c;
end $$;

-- ---------------------------------------------------------------------
-- customer: exchange points for a reward
-- error: not_found | reward_closed | out_of_stock | not_enough_points
-- ---------------------------------------------------------------------
create or replace function redeem_reward(p_line_user_id text, p_reward uuid)
returns coupons
language plpgsql set search_path = public, extensions as $$
declare
  c customers;
  r rewards;
  sid bigint;
  cp coupons;
begin
  select * into c from customers where line_user_id = p_line_user_id;
  if not found then raise exception 'not_enough_points'; end if;
  select * into r from rewards where id = p_reward for update;
  if not found then raise exception 'not_found'; end if;
  if not r.active or not (select points_enabled from settings where id = 1) then raise exception 'reward_closed'; end if;
  if r.stock is not null and r.stock <= 0 then raise exception 'out_of_stock'; end if;

  sid := points_take(c.id, r.points_cost, 'coupon', null, r.title);
  if r.stock is not null then update rewards set stock = stock - 1 where id = r.id; end if;

  insert into coupons (code, customer_id, reward_id, title, business, kind, value_baht, points_spent, spend_id, expires_at)
  values (gen_coupon_code(), c.id, r.id, r.title, r.business, r.kind, r.value_baht, r.points_cost, sid,
          now() + make_interval(days => r.valid_days))
  returning * into cp;
  return cp;
end $$;

-- ---------------------------------------------------------------------
-- create_booking: p_use_points -> p_coupon
-- error (new): coupon_invalid
-- ---------------------------------------------------------------------
drop function if exists create_booking(text, text, text, text, text, date, date, boolean, int, text, timestamptz, text, timestamptz, text, boolean);

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
  p_ref_phone         text        default null,
  p_coupon            uuid        default null
) returns bookings
language plpgsql set search_path = public, extensions as $$
declare
  s          settings;
  v_customer uuid;
  v_full     date;
  v_disc     int;
  v_reason   text;
  v_gross    int;
  v_cp       coupons;
  v_cp_amt   int := 0;
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

  v_gross := (p_end - p_start + 1) * s.price_per_day + case when p_shuttle then s.shuttle_price else 0 end;
  select bd.amount, bd.reason into v_disc, v_reason from booking_discount(p_phone, p_ref_phone) bd;
  v_disc := least(coalesce(v_disc, 0), v_gross);

  insert into customers (line_user_id, name, phone)
  values (p_line_user_id, p_name, p_phone)
  on conflict (line_user_id) do update set name = excluded.name, phone = excluded.phone
  returning id into v_customer;

  if p_coupon is not null then
    select * into v_cp from coupons where id = p_coupon for update;
    if not found or v_cp.customer_id <> v_customer or v_cp.status <> 'active'
       or v_cp.kind <> 'parking_discount' or v_cp.expires_at <= now() then
      raise exception 'coupon_invalid';
    end if;
    v_cp_amt := least(v_cp.value_baht, v_gross - v_disc);
  end if;

  insert into bookings (customer_id, plate, plate_province, start_date, end_date,
                        parking_amount, shuttle, pax, shuttle_amount, hold_expires_at,
                        discount_amount, discount_reason, referrer_phone, coupon_id, coupon_amount)
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
          case when v_disc > 0 and v_reason = 'referral' then norm_phone(p_ref_phone) end,
          v_cp.id, v_cp_amt)
  returning * into b;

  if v_cp.id is not null then
    update coupons set status = 'used', used_at = now(), used_booking = b.id, used_by = 'booking' where id = v_cp.id;
  end if;

  if p_shuttle then
    insert into shuttle_trips (booking_id, direction, pax, flight_number, flight_date, customer_time, pickup_at)
    values (b.id, 'to_airport',   p_pax, nullif(upper(p_outbound_flight), ''), p_start, p_outbound_time, p_outbound_time),
           (b.id, 'from_airport', p_pax, nullif(upper(p_return_flight), ''),   p_end,   p_return_time,   p_return_time);
  end if;

  if b.total_amount > 0 then
    insert into payments (booking_id, kind, amount) values (b.id, 'booking', b.total_amount);
  else
    update bookings set status = 'confirmed', hold_expires_at = null where id = b.id returning * into b;
  end if;

  return b;
end $$;

-- booking left unpaid -> coupon usable again; an expired booking paid late -> coupon used again (if still free)
create or replace function bookings_points_trg() returns trigger
language plpgsql set search_path = public as $$
begin
  if new.coupon_id is null or new.status = old.status then return new; end if;
  if old.status = 'pending_payment' and new.status in ('expired', 'cancelled') then
    update coupons set status = 'active', used_at = null, used_booking = null, used_by = null
    where id = new.coupon_id and used_booking = new.id;
  elsif old.status in ('expired', 'cancelled') and new.status in ('confirmed', 'pending_payment') then
    update coupons set status = 'used', used_at = now(), used_booking = new.id, used_by = 'booking'
    where id = new.coupon_id and status = 'active';
  end if;
  return new;
end $$;

-- ---------------------------------------------------------------------
-- admin: catalog, use / cancel a coupon, adjust points (uses new points_take)
-- ---------------------------------------------------------------------
create or replace function admin_save_reward(p_actor uuid, p_id uuid, p_title text, p_description text,
  p_business text, p_kind text, p_value int, p_cost int, p_valid_days int, p_stock int, p_active boolean, p_sort int)
returns rewards
language plpgsql set search_path = public as $$
declare a staff_users; r rewards;
begin
  a := staff_require_admin(p_actor);
  if nullif(trim(p_title), '') is null or p_cost is null or p_cost < 1 or p_valid_days is null or p_valid_days < 1
     or p_valid_days > 1095 or p_kind not in ('parking_discount', 'item')
     or (p_kind = 'parking_discount' and coalesce(p_value, 0) < 1) or (p_stock is not null and p_stock < 0) then
    raise exception 'invalid_reward';
  end if;
  if p_id is null then
    insert into rewards (title, description, business, kind, value_baht, points_cost, valid_days, stock, active, sort)
    values (trim(p_title), nullif(trim(p_description), ''), coalesce(nullif(trim(p_business), ''), 'parking'), p_kind,
            case when p_kind = 'parking_discount' then p_value else 0 end, p_cost, p_valid_days, p_stock, coalesce(p_active, true), coalesce(p_sort, 0))
    returning * into r;
  else
    update rewards set title = trim(p_title), description = nullif(trim(p_description), ''),
      business = coalesce(nullif(trim(p_business), ''), 'parking'), kind = p_kind,
      value_baht = case when p_kind = 'parking_discount' then p_value else 0 end,
      points_cost = p_cost, valid_days = p_valid_days, stock = p_stock, active = coalesce(p_active, true), sort = coalesce(p_sort, 0)
    where id = p_id returning * into r;
    if not found then raise exception 'not_found'; end if;
  end if;
  perform audit(a, 'save', 'reward', r.id::text, to_jsonb(r));
  return r;
end $$;

-- staff take a coupon at the cafe / front desk. error: coupon_not_found | coupon_used | coupon_expired | coupon_parking
create or replace function admin_use_coupon(p_actor uuid, p_code text)
returns coupons
language plpgsql set search_path = public as $$
declare a staff_users; cp coupons;
begin
  a := staff_require_admin(p_actor);
  select * into cp from coupons where code = upper(trim(p_code)) for update;
  if not found then raise exception 'coupon_not_found'; end if;
  if cp.status <> 'active' then raise exception 'coupon_used'; end if;
  if cp.expires_at <= now() then raise exception 'coupon_expired'; end if;
  if cp.kind = 'parking_discount' then raise exception 'coupon_parking'; end if;
  update coupons set status = 'used', used_at = now(), used_by = a.username where id = cp.id returning * into cp;
  perform audit(a, 'use', 'coupon', cp.code, jsonb_build_object('title', cp.title));
  return cp;
end $$;

-- cancel an unused coupon and give the points back. error: coupon_not_found | coupon_used
create or replace function admin_cancel_coupon(p_actor uuid, p_code text)
returns coupons
language plpgsql set search_path = public as $$
declare a staff_users; cp coupons;
begin
  a := staff_require_admin(p_actor);
  select * into cp from coupons where code = upper(trim(p_code)) for update;
  if not found then raise exception 'coupon_not_found'; end if;
  if cp.status <> 'active' then raise exception 'coupon_used'; end if;
  if cp.spend_id is not null then perform points_refund(cp.spend_id); end if;
  update coupons set status = 'cancelled', used_at = now(), used_by = a.username where id = cp.id returning * into cp;
  perform audit(a, 'cancel', 'coupon', cp.code, jsonb_build_object('points', cp.points_spent));
  return cp;
end $$;

do $$ declare fn text; begin
  foreach fn in array array[
    'create_booking(text,text,text,text,text,date,date,boolean,int,text,timestamptz,text,timestamptz,text,uuid)',
    'points_take(uuid,int,text,uuid,text)', 'points_refund(bigint)', 'gen_coupon_code()',
    'redeem_reward(text,uuid)',
    'admin_save_reward(uuid,uuid,text,text,text,text,int,int,int,int,boolean,int)',
    'admin_use_coupon(uuid,text)', 'admin_cancel_coupon(uuid,text)'
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
