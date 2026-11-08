-- 0012: loyalty points
--   * earn: every verified payment gives floor(amount / points_per_baht) points (default 100 baht = 1 point)
--   * referral: when a referred customer's booking is paid, the referrer gets referral_points (default 3)
--   * spend: at booking time, points become a discount of point_value baht each (default 10), on top of
--     the returning-customer discount; the whole remaining amount may be paid with points
--   * expiry: each batch of points lasts points_expiry_months (default 36); oldest batch is used first
--   * a booking that expires or is cancelled before payment gives its points back
-- Points belong to a LINE account (customers.id). Referral points for a phone that has no
-- account yet wait on the phone and are attached when that phone first pays a booking.

alter table settings add column if not exists points_per_baht      int not null default 100;
alter table settings add column if not exists point_value          int not null default 10;
alter table settings add column if not exists referral_points      int not null default 3;
alter table settings add column if not exists points_expiry_months int not null default 36;
alter table settings add column if not exists points_enabled       boolean not null default true;

alter table bookings add column if not exists points_used   int not null default 0;
alter table bookings add column if not exists points_amount int not null default 0;   -- baht taken off by points

alter table bookings drop column total_amount;
alter table bookings add column total_amount int
  generated always as (parking_amount + shuttle_amount - discount_amount - points_amount) stored;

-- one row per batch of earned points
create table if not exists point_lots (
  id          bigserial primary key,
  customer_id uuid references customers(id) on delete cascade,
  phone       text,                       -- normalised; used while customer_id is null
  points      int  not null check (points > 0),
  remaining   int  not null check (remaining >= 0),
  source      text not null,              -- 'payment' | 'referral' | 'admin'
  booking_id  uuid references bookings(id) on delete set null,
  payment_id  uuid references payments(id) on delete set null,
  note        text,
  earned_at   timestamptz not null default now(),
  expires_at  timestamptz not null,
  check (customer_id is not null or phone is not null)
);
create index if not exists point_lots_customer_idx on point_lots (customer_id, expires_at) where remaining > 0;
create index if not exists point_lots_phone_idx on point_lots (phone) where customer_id is null;
create unique index if not exists point_lots_payment_uq on point_lots (payment_id, source) where payment_id is not null;
alter table point_lots enable row level security;

-- every use of points, and which batches it came from (so it can be given back)
create table if not exists point_spends (
  id          bigserial primary key,
  customer_id uuid not null references customers(id) on delete cascade,
  booking_id  uuid references bookings(id) on delete set null,
  points      int  not null,
  reason      text not null,              -- 'booking' | 'admin'
  note        text,
  returned_at timestamptz,
  created_at  timestamptz not null default now()
);
create table if not exists point_spend_lots (
  spend_id bigint not null references point_spends(id) on delete cascade,
  lot_id   bigint not null references point_lots(id) on delete cascade,
  points   int    not null,
  primary key (spend_id, lot_id)
);
alter table point_spends enable row level security;
alter table point_spend_lots enable row level security;

-- ---------------------------------------------------------------------
-- balance
-- ---------------------------------------------------------------------
create or replace function points_balance(p_customer uuid) returns int
language sql stable set search_path = public as $$
  select coalesce(sum(remaining), 0)::int from point_lots
  where customer_id = p_customer and remaining > 0 and expires_at > now()
$$;

-- ---------------------------------------------------------------------
-- earn a batch
-- ---------------------------------------------------------------------
create or replace function points_add(
  p_customer uuid, p_phone text, p_points int, p_source text,
  p_booking uuid default null, p_payment uuid default null, p_note text default null)
returns void
language plpgsql set search_path = public as $$
declare s settings;
begin
  if coalesce(p_points, 0) <= 0 then return; end if;
  select * into s from settings where id = 1;
  insert into point_lots (customer_id, phone, points, remaining, source, booking_id, payment_id, note, expires_at)
  values (p_customer, case when p_customer is null then norm_phone(p_phone) end, p_points, p_points, p_source,
          p_booking, p_payment, p_note, now() + make_interval(months => s.points_expiry_months))
  on conflict do nothing;
end $$;

-- ---------------------------------------------------------------------
-- spend points, oldest batch first; error: not_enough_points
-- ---------------------------------------------------------------------
create or replace function points_take(p_customer uuid, p_points int, p_reason text,
  p_booking uuid default null, p_note text default null)
returns void
language plpgsql set search_path = public as $$
declare
  left_ int := p_points;
  l point_lots;
  take int;
  sid bigint;
begin
  if coalesce(p_points, 0) <= 0 then return; end if;
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
end $$;

-- give back the points a booking used (booking expired / cancelled before payment)
create or replace function points_return(p_booking uuid) returns void
language plpgsql set search_path = public as $$
declare sp point_spends;
begin
  for sp in select * from point_spends where booking_id = p_booking and reason = 'booking' and returned_at is null for update loop
    update point_lots l set remaining = l.remaining + x.points
    from point_spend_lots x where x.spend_id = sp.id and x.lot_id = l.id;
    update point_spends set returned_at = now() where id = sp.id;
  end loop;
end $$;

-- ---------------------------------------------------------------------
-- attach referral points that waited on a phone to this customer
-- ---------------------------------------------------------------------
create or replace function points_claim_phone(p_customer uuid, p_phone text) returns void
language sql set search_path = public as $$
  update point_lots set customer_id = p_customer, phone = null
  where customer_id is null and phone = norm_phone(p_phone) and norm_phone(p_phone) <> ''
$$;

-- ---------------------------------------------------------------------
-- triggers
-- ---------------------------------------------------------------------
-- payment verified -> points for the payer (+ referral points for the referrer)
create or replace function payments_points_trg() returns trigger
language plpgsql set search_path = public as $$
declare
  s settings;
  b bookings;
  c customers;
  ref_customer uuid;
begin
  if new.status <> 'verified' or (tg_op = 'UPDATE' and old.status = 'verified') then return new; end if;
  select * into s from settings where id = 1;
  if not s.points_enabled then return new; end if;
  select * into b from bookings where id = new.booking_id;
  select * into c from customers where id = b.customer_id;
  if c.id is null then return new; end if;

  perform points_claim_phone(c.id, c.phone);
  perform points_add(c.id, null, new.amount / greatest(s.points_per_baht, 1), 'payment', b.id, new.id);

  if new.kind = 'booking' and b.referrer_phone is not null and b.discount_reason = 'referral' then
    -- the referrer: the latest account with this phone that has paid before; otherwise wait on the phone
    select cu.id into ref_customer
    from customers cu join bookings bb on bb.customer_id = cu.id
    where norm_phone(cu.phone) = b.referrer_phone and cu.id <> c.id
      and bb.status in ('confirmed', 'checked_in', 'checked_out', 'no_show')
    order by bb.created_at desc limit 1;
    insert into point_lots (customer_id, phone, points, remaining, source, booking_id, payment_id, note, expires_at)
    select ref_customer, case when ref_customer is null then b.referrer_phone end,
           s.referral_points, s.referral_points, 'referral', b.id, new.id, 'แนะนำ ' || c.name,
           now() + make_interval(months => s.points_expiry_months)
    where s.referral_points > 0
    on conflict do nothing;
  end if;
  return new;
end $$;

drop trigger if exists payments_points on payments;
create trigger payments_points after insert or update of status on payments
  for each row execute function payments_points_trg();

-- booking left unpaid -> points back; an expired booking that gets paid late -> take them again
create or replace function bookings_points_trg() returns trigger
language plpgsql set search_path = public as $$
begin
  if new.points_used <= 0 or new.status = old.status then return new; end if;
  if old.status = 'pending_payment' and new.status in ('expired', 'cancelled') then
    perform points_return(new.id);
  elsif old.status in ('expired', 'cancelled') and new.status in ('confirmed', 'pending_payment') then
    begin
      perform points_take(new.customer_id, new.points_used, 'booking', new.id, 'ชำระหลังหมดเวลา');
    exception when others then
      null;  -- points were used elsewhere in the meantime: the booking still stands
    end;
  end if;
  return new;
end $$;

drop trigger if exists bookings_points on bookings;
create trigger bookings_points after update of status on bookings
  for each row execute function bookings_points_trg();

-- ---------------------------------------------------------------------
-- what a customer can use right now (for the booking page)
-- ---------------------------------------------------------------------
create or replace function customer_points(p_line_user_id text)
returns table (points int, point_value int, enabled boolean, expiring int, expiring_at timestamptz)
language sql stable set search_path = public as $$
  with c as (select id from customers where line_user_id = p_line_user_id),
       s as (select * from settings where id = 1),
       soon as (
         select sum(l.remaining)::int as pts, min(l.expires_at) as at from point_lots l, c
         where l.customer_id = c.id and l.remaining > 0 and l.expires_at > now()
           and l.expires_at < now() + interval '60 days')
  select coalesce((select points_balance(c.id) from c), 0), s.point_value, s.points_enabled,
         coalesce(soon.pts, 0), soon.at
  from s, soon
$$;

-- ---------------------------------------------------------------------
-- create_booking: + p_use_points
-- ---------------------------------------------------------------------
drop function if exists create_booking(text, text, text, text, text, date, date, boolean, int, text, timestamptz, text, timestamptz, text);

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
  p_use_points        boolean     default false
) returns bookings
language plpgsql set search_path = public, extensions as $$
declare
  s          settings;
  v_customer uuid;
  v_full     date;
  v_disc     int;
  v_reason   text;
  v_gross    int;
  v_pts      int := 0;
  v_pts_amt  int := 0;
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

  -- points: as many as the remaining amount needs, never more than the customer has
  if p_use_points and s.points_enabled and s.point_value > 0 then
    v_pts := least(points_balance(v_customer), ceil((v_gross - v_disc)::numeric / s.point_value)::int);
    v_pts_amt := least(v_pts * s.point_value, v_gross - v_disc);
  end if;

  insert into bookings (customer_id, plate, plate_province, start_date, end_date,
                        parking_amount, shuttle, pax, shuttle_amount, hold_expires_at,
                        discount_amount, discount_reason, referrer_phone, points_used, points_amount)
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
          v_pts, v_pts_amt)
  returning * into b;

  if v_pts > 0 then perform points_take(v_customer, v_pts, 'booking', b.id); end if;

  if p_shuttle then
    insert into shuttle_trips (booking_id, direction, pax, flight_number, flight_date, customer_time, pickup_at)
    values (b.id, 'to_airport',   p_pax, nullif(upper(p_outbound_flight), ''), p_start, p_outbound_time, p_outbound_time),
           (b.id, 'from_airport', p_pax, nullif(upper(p_return_flight), ''),   p_end,   p_return_time,   p_return_time);
  end if;

  if b.total_amount > 0 then
    insert into payments (booking_id, kind, amount) values (b.id, 'booking', b.total_amount);
  else
    -- fully paid with discount + points: confirmed straight away, nothing to pay
    update bookings set status = 'confirmed', hold_expires_at = null where id = b.id returning * into b;
  end if;

  return b;
end $$;

-- ---------------------------------------------------------------------
-- admin: adjust points, points settings
-- ---------------------------------------------------------------------
create or replace function admin_adjust_points(p_actor uuid, p_customer uuid, p_points int, p_note text)
returns int
language plpgsql set search_path = public as $$
declare a staff_users;
begin
  a := staff_require_admin(p_actor);
  if p_points is null or p_points = 0 or abs(p_points) > 100000 then raise exception 'invalid_points'; end if;
  if not exists (select 1 from customers where id = p_customer) then raise exception 'not_found'; end if;
  if p_points > 0 then
    perform points_add(p_customer, null, p_points, 'admin', null, null, nullif(trim(p_note), ''));
  else
    perform points_take(p_customer, -p_points, 'admin', null, nullif(trim(p_note), ''));
  end if;
  perform audit(a, 'points', 'customer', p_customer::text, jsonb_build_object('points', p_points, 'note', p_note));
  return points_balance(p_customer);
end $$;

create or replace function admin_set_points_settings(p_actor uuid, p_enabled boolean, p_per_baht int,
  p_value int, p_referral int, p_months int)
returns void
language plpgsql set search_path = public as $$
declare a staff_users;
begin
  a := staff_require_admin(p_actor);
  if p_per_baht < 1 or p_value < 0 or p_value > 10000 or p_referral < 0 or p_referral > 1000
     or p_months < 1 or p_months > 120 then raise exception 'invalid_settings'; end if;
  update settings set points_enabled = coalesce(p_enabled, true), points_per_baht = p_per_baht,
    point_value = p_value, referral_points = p_referral, points_expiry_months = p_months where id = 1;
  perform audit(a, 'update', 'settings', '1', jsonb_build_object('points_per_baht', p_per_baht,
    'point_value', p_value, 'referral_points', p_referral, 'months', p_months, 'enabled', p_enabled));
end $$;

do $$ declare fn text; begin
  foreach fn in array array[
    'create_booking(text,text,text,text,text,date,date,boolean,int,text,timestamptz,text,timestamptz,text,boolean)',
    'points_balance(uuid)', 'points_add(uuid,text,int,text,uuid,uuid,text)', 'points_take(uuid,int,text,uuid,text)',
    'points_return(uuid)', 'points_claim_phone(uuid,text)', 'customer_points(text)',
    'admin_adjust_points(uuid,uuid,int,text)', 'admin_set_points_settings(uuid,boolean,int,int,int,int)'
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
