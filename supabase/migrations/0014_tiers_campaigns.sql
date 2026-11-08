-- 0014: member tiers (Bronze / Silver / Gold) and campaigns
--   * tier = what the customer spent in the last 12 months (all businesses), or a tier the admin set by hand
--   * earned points = floor(amount / points_per_baht) x tier multiplier x best campaign multiplier + campaign bonus
--   * campaigns: per business (all / parking / cafe / stay), per tier, with dates
--       multiplier : points x N while it runs        bonus    : + N points per paid purchase
--       announce   : a message shown on the member card (no effect on points)
--   * member_purchases: spend at the cafe / hotel entered by staff (counts toward tier and earns points)
-- Run after 0013.

create table if not exists member_tiers (
  code       text primary key,
  name       text not null,
  min_spend  int  not null check (min_spend >= 0),
  multiplier numeric(4,2) not null check (multiplier > 0 and multiplier <= 10),
  color      text not null,
  sort       int  not null
);
alter table member_tiers enable row level security;
insert into member_tiers (code, name, min_spend, multiplier, color, sort) values
  ('bronze', 'Bronze', 0,    1.0, '#A86A3D', 1),
  ('silver', 'Silver', 3000, 1.2, '#9AA4AE', 2),
  ('gold',   'Gold',   8000, 1.5, '#D4A63A', 3)
on conflict (code) do nothing;

alter table settings add column if not exists tier_window_months int not null default 12;

create sequence if not exists member_no_seq start 1001;
alter table customers add column if not exists member_no text;
update customers set member_no = 'BY' || lpad(nextval('member_no_seq')::text, 6, '0') where member_no is null;
alter table customers alter column member_no set default 'BY' || lpad(nextval('member_no_seq')::text, 6, '0');
create unique index if not exists customers_member_no_uq on customers (member_no);
alter table customers add column if not exists tier_override text references member_tiers(code) on delete set null;

create table if not exists member_purchases (
  id          bigserial primary key,
  customer_id uuid not null references customers(id) on delete cascade,
  business    text not null,                 -- 'cafe' | 'stay' | ...
  amount      int  not null check (amount > 0),
  note        text,
  staff       text,
  created_at  timestamptz not null default now()
);
create index if not exists member_purchases_customer_idx on member_purchases (customer_id, created_at);
alter table member_purchases enable row level security;

create table if not exists campaigns (
  id            uuid primary key default gen_random_uuid(),
  name          text not null,
  description   text,
  business      text not null default 'all',  -- 'all' | 'parking' | 'cafe' | 'stay'
  tiers         text[],                        -- null / empty = every tier
  kind          text not null check (kind in ('multiplier', 'bonus', 'announce')),
  multiplier    numeric(4,2) not null default 1 check (multiplier > 0 and multiplier <= 10),
  bonus_points  int not null default 0 check (bonus_points >= 0),
  starts_at     timestamptz not null default now(),
  ends_at       timestamptz,
  active        boolean not null default true,
  created_at    timestamptz not null default now()
);
alter table campaigns enable row level security;

alter table point_lots add column if not exists purchase_id bigint references member_purchases(id) on delete set null;

-- ---------------------------------------------------------------------
-- spend and tier
-- ---------------------------------------------------------------------
create or replace function customer_spend(p_customer uuid) returns int
language sql stable set search_path = public as $$
  with s as (select tier_window_months m from settings where id = 1)
  select (
    coalesce((select sum(p.amount) from payments p join bookings b on b.id = p.booking_id, s
              where b.customer_id = p_customer and p.status = 'verified'
                and p.paid_at > now() - make_interval(months => s.m)), 0)
  + coalesce((select sum(mp.amount) from member_purchases mp, s
              where mp.customer_id = p_customer and mp.created_at > now() - make_interval(months => s.m)), 0)
  )::int
$$;

create or replace function customer_tier(p_customer uuid) returns member_tiers
language sql stable set search_path = public as $$
  select t.* from member_tiers t
  where t.code = (select tier_override from customers where id = p_customer)
     or (not exists (select 1 from customers c where c.id = p_customer and c.tier_override is not null)
         and t.min_spend <= customer_spend(p_customer))
  order by t.sort desc limit 1
$$;

-- campaigns that apply right now to this tier and business
create or replace function active_campaigns(p_tier text, p_business text)
returns setof campaigns
language sql stable set search_path = public as $$
  select * from campaigns
  where active and starts_at <= now() and (ends_at is null or ends_at > now())
    and (business = 'all' or business = p_business or p_business is null)
    and (tiers is null or cardinality(tiers) = 0 or p_tier = any(tiers))
  order by starts_at desc
$$;

-- ---------------------------------------------------------------------
-- earn points for a paid amount (parking payment or cafe / hotel purchase)
-- returns the points given
-- ---------------------------------------------------------------------
create or replace function earn_points(p_customer uuid, p_business text, p_amount int, p_source text,
  p_booking uuid default null, p_payment uuid default null, p_purchase bigint default null)
returns int
language plpgsql set search_path = public as $$
declare
  s settings;
  t member_tiers;
  best numeric := 1;
  bonus int := 0;
  base int;
  pts int;
  names text := '';
  c record;
begin
  select * into s from settings where id = 1;
  if not s.points_enabled or coalesce(p_amount, 0) <= 0 then return 0; end if;
  t := customer_tier(p_customer);
  for c in select * from active_campaigns(t.code, p_business) where kind in ('multiplier', 'bonus') loop
    if c.kind = 'multiplier' and c.multiplier > best then best := c.multiplier; end if;
    if c.kind = 'bonus' then bonus := bonus + c.bonus_points; end if;
    names := names || case when names = '' then '' else ', ' end || c.name;
  end loop;
  base := p_amount / greatest(s.points_per_baht, 1);
  pts := floor(base * coalesce(t.multiplier, 1) * best)::int + bonus;
  if pts <= 0 then return 0; end if;
  insert into point_lots (customer_id, points, remaining, source, booking_id, payment_id, purchase_id, note, expires_at)
  values (p_customer, pts, pts, p_source, p_booking, p_payment, p_purchase,
          t.name || ' x' || regexp_replace(t.multiplier::text, '\.?0+$', '') || case when names <> '' then ' · ' || names else '' end,
          now() + make_interval(months => s.points_expiry_months))
  on conflict do nothing;
  return pts;
end $$;

-- payment verified -> points (tier + campaigns) for the payer, referral points for the referrer
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
  perform earn_points(c.id, 'parking', new.amount, 'payment', b.id, new.id);

  if new.kind = 'booking' and b.referrer_phone is not null and b.discount_reason = 'referral' then
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

-- ---------------------------------------------------------------------
-- the member card for the LINE pages
-- ---------------------------------------------------------------------
create or replace function customer_member(p_line_user_id text)
returns table (member_no text, name text, tier text, tier_name text, color text, multiplier numeric,
               spend int, window_months int, next_tier_name text, next_min int, points int, manual boolean)
language plpgsql stable set search_path = public as $$
declare
  c customers;
  t member_tiers;
  n member_tiers;
  sp int;
begin
  select * into c from customers where line_user_id = p_line_user_id;
  if not found then
    select * into t from member_tiers order by sort limit 1;
    select * into n from member_tiers where sort > t.sort order by sort limit 1;
    return query select null::text, null::text, t.code, t.name, t.color, t.multiplier, 0,
      (select tier_window_months from settings where id = 1), n.name, n.min_spend, 0, false;
    return;
  end if;
  sp := customer_spend(c.id);
  t := customer_tier(c.id);
  select * into n from member_tiers where sort > t.sort order by sort limit 1;
  return query select c.member_no, c.name, t.code, t.name, t.color, t.multiplier, sp,
    (select tier_window_months from settings where id = 1), n.name, n.min_spend, points_balance(c.id),
    c.tier_override is not null;
end $$;

-- ---------------------------------------------------------------------
-- admin
-- ---------------------------------------------------------------------
create or replace function admin_save_tier(p_actor uuid, p_code text, p_name text, p_min int, p_mult numeric)
returns void
language plpgsql set search_path = public as $$
declare a staff_users;
begin
  a := staff_require_admin(p_actor);
  if p_min is null or p_min < 0 or p_mult is null or p_mult <= 0 or p_mult > 10 or nullif(trim(p_name), '') is null then
    raise exception 'invalid_tier';
  end if;
  if p_code = (select code from member_tiers order by sort limit 1) and p_min <> 0 then raise exception 'invalid_tier'; end if;
  update member_tiers set name = trim(p_name), min_spend = p_min, multiplier = p_mult where code = p_code;
  if not found then raise exception 'not_found'; end if;
  -- higher tiers must need more spend
  if exists (select 1 from member_tiers a1 join member_tiers a2 on a2.sort > a1.sort where a2.min_spend <= a1.min_spend) then
    raise exception 'invalid_tier_order';
  end if;
  perform audit(a, 'update', 'member_tier', p_code, jsonb_build_object('min', p_min, 'multiplier', p_mult));
end $$;

create or replace function admin_set_tier_override(p_actor uuid, p_customer uuid, p_tier text)
returns void
language plpgsql set search_path = public as $$
declare a staff_users;
begin
  a := staff_require_admin(p_actor);
  update customers set tier_override = nullif(p_tier, '') where id = p_customer;
  if not found then raise exception 'not_found'; end if;
  perform audit(a, 'tier_override', 'customer', p_customer::text, jsonb_build_object('tier', p_tier));
end $$;

create or replace function admin_save_campaign(p_actor uuid, p_id uuid, p_name text, p_description text,
  p_business text, p_tiers text[], p_kind text, p_multiplier numeric, p_bonus int,
  p_starts timestamptz, p_ends timestamptz, p_active boolean)
returns campaigns
language plpgsql set search_path = public as $$
declare a staff_users; c campaigns;
begin
  a := staff_require_admin(p_actor);
  if nullif(trim(p_name), '') is null or p_kind not in ('multiplier', 'bonus', 'announce')
     or (p_kind = 'multiplier' and (p_multiplier is null or p_multiplier <= 1 or p_multiplier > 10))
     or (p_kind = 'bonus' and (p_bonus is null or p_bonus < 1))
     or (p_ends is not null and p_starts is not null and p_ends <= p_starts) then
    raise exception 'invalid_campaign';
  end if;
  if p_id is null then
    insert into campaigns (name, description, business, tiers, kind, multiplier, bonus_points, starts_at, ends_at, active)
    values (trim(p_name), nullif(trim(p_description), ''), coalesce(nullif(p_business, ''), 'all'), nullif(p_tiers, '{}'),
            p_kind, case when p_kind = 'multiplier' then p_multiplier else 1 end,
            case when p_kind = 'bonus' then p_bonus else 0 end, coalesce(p_starts, now()), p_ends, coalesce(p_active, true))
    returning * into c;
  else
    update campaigns set name = trim(p_name), description = nullif(trim(p_description), ''),
      business = coalesce(nullif(p_business, ''), 'all'), tiers = nullif(p_tiers, '{}'), kind = p_kind,
      multiplier = case when p_kind = 'multiplier' then p_multiplier else 1 end,
      bonus_points = case when p_kind = 'bonus' then p_bonus else 0 end,
      starts_at = coalesce(p_starts, starts_at), ends_at = p_ends, active = coalesce(p_active, true)
    where id = p_id returning * into c;
    if not found then raise exception 'not_found'; end if;
  end if;
  perform audit(a, 'save', 'campaign', c.id::text, to_jsonb(c));
  return c;
end $$;

-- cafe / hotel: staff enter what a member spent (found by phone or member number). error: member_not_found
create or replace function admin_record_purchase(p_actor uuid, p_who text, p_business text, p_amount int, p_note text)
returns table (customer_name text, points int, tier text)
language plpgsql set search_path = public as $$
declare
  a staff_users;
  c customers;
  pid bigint;
  pts int;
begin
  a := staff_require_admin(p_actor);
  if p_amount is null or p_amount < 1 or p_amount > 1000000 or coalesce(p_business, '') = '' then raise exception 'invalid_purchase'; end if;
  select * into c from customers
  where member_no = upper(trim(p_who)) or (norm_phone(phone) = norm_phone(p_who) and norm_phone(p_who) <> '')
  order by (member_no = upper(trim(p_who))) desc, created_at desc limit 1;
  if not found then raise exception 'member_not_found'; end if;
  insert into member_purchases (customer_id, business, amount, note, staff)
  values (c.id, p_business, p_amount, nullif(trim(p_note), ''), a.username) returning id into pid;
  pts := earn_points(c.id, p_business, p_amount, p_business, null, null, pid);
  perform audit(a, 'purchase', 'customer', c.id::text, jsonb_build_object('business', p_business, 'amount', p_amount, 'points', pts));
  return query select c.name, pts, (customer_tier(c.id)).name;
end $$;

do $$ declare fn text; begin
  foreach fn in array array[
    'customer_spend(uuid)', 'customer_tier(uuid)', 'active_campaigns(text,text)',
    'earn_points(uuid,text,int,text,uuid,uuid,bigint)', 'customer_member(text)',
    'admin_save_tier(uuid,text,text,int,numeric)', 'admin_set_tier_override(uuid,uuid,text)',
    'admin_save_campaign(uuid,uuid,text,text,text,text[],text,numeric,int,timestamptz,timestamptz,boolean)',
    'admin_record_purchase(uuid,text,text,int,text)'
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

-- how many customers are in each tier (admin dashboard)
create or replace function tier_counts() returns table (tier text, n bigint)
language sql stable set search_path = public as $$
  select (customer_tier(c.id)).code, count(*) from customers c group by 1
$$;
revoke execute on function tier_counts() from public;
do $$ begin
  if exists (select 1 from pg_roles where rolname = 'anon') then revoke execute on function tier_counts() from anon, authenticated; end if;
  if exists (select 1 from pg_roles where rolname = 'service_role') then grant execute on function tier_counts() to service_role; end if;
end $$;
notify pgrst, 'reload schema';
