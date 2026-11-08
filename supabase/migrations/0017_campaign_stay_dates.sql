-- 0017: campaigns tied to parking dates (New Year, Songkran ...) and a percent-off discount
--   stay_from / stay_to : the campaign only counts when the check-in date (start_date) is inside these dates
--                         (starts_at / ends_at still say when customers can BOOK it)
--   percent_off         : new discount kind, N% off the parking charge (book at least min_days)
-- Points campaigns (multiplier / bonus) follow the same check-in dates for parking payments.
-- Run after 0016.

alter table campaigns drop constraint if exists campaigns_kind_check;
alter table campaigns add constraint campaigns_kind_check
  check (kind in ('multiplier', 'bonus', 'announce', 'free_days', 'amount_off', 'percent_off'));
alter table campaigns add column if not exists stay_from   date;
alter table campaigns add column if not exists stay_to     date;
alter table campaigns add column if not exists percent_off int not null default 0 check (percent_off between 0 and 100);

-- is a check-in date inside the campaign's parking dates (no dates = always)
create or replace function campaign_stay_ok(c campaigns, p_start date) returns boolean
language sql immutable as $$
  select (c.stay_from is null and c.stay_to is null)
      or (p_start is not null and (c.stay_from is null or p_start >= c.stay_from) and (c.stay_to is null or p_start <= c.stay_to))
$$;

drop function if exists booking_campaign(text, int, int);
create or replace function booking_campaign(p_tier text, p_days int, p_price_per_day int, p_start date default null)
returns table (id uuid, name text, amount int, stackable boolean)
language sql stable set search_path = public as $$
  select c.id, c.name,
         case c.kind
           when 'free_days'   then least(c.free_days, p_days) * p_price_per_day
           when 'percent_off' then (p_days * p_price_per_day * c.percent_off / 100)
           else c.amount_off end,
         c.stackable
  from active_campaigns(p_tier, 'parking') c
  where c.kind in ('free_days', 'amount_off', 'percent_off') and p_days >= greatest(c.min_days, 1)
    and campaign_stay_ok(c, p_start)
  order by 3 desc limit 1
$$;

create or replace function bookings_promo_trg() returns trigger
language plpgsql set search_path = public as $$
declare
  s settings;
  t member_tiers;
  c record;
  days int := new.end_date - new.start_date + 1;
  amt int;
begin
  select * into s from settings where id = 1;
  t := customer_tier(new.customer_id);
  select * into c from booking_campaign(t.code, days, s.price_per_day, new.start_date);
  if c.id is null or c.amount <= 0 then return new; end if;
  amt := c.amount;
  if not c.stackable and new.discount_amount > 0 then
    if amt <= new.discount_amount then return new; end if;
    new.discount_amount := 0; new.discount_reason := null; new.referrer_phone := null;
  end if;
  amt := least(amt, new.parking_amount + new.shuttle_amount - new.discount_amount - new.coupon_amount);
  if amt <= 0 then return new; end if;
  new.campaign_id := c.id;
  new.campaign_amount := amt;
  return new;
end $$;

drop function if exists booking_campaign_preview(text, int);
create or replace function booking_campaign_preview(p_line_user_id text, p_days int, p_start date default null)
returns table (id uuid, name text, amount int, stackable boolean)
language plpgsql stable set search_path = public as $$
declare
  cid uuid;
  tier text;
begin
  select cu.id into cid from customers cu where cu.line_user_id = p_line_user_id;
  if cid is not null then tier := (customer_tier(cid)).code;
  else select code into tier from member_tiers order by sort limit 1; end if;
  return query select * from booking_campaign(tier, p_days, (select price_per_day from settings where settings.id = 1), p_start);
end $$;

-- points: campaigns with parking dates only count for bookings that check in on those dates
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
  v_start date;
begin
  select * into s from settings where id = 1;
  if not s.points_enabled or coalesce(p_amount, 0) <= 0 then return 0; end if;
  t := customer_tier(p_customer);
  if p_booking is not null then select start_date into v_start from bookings where id = p_booking; end if;
  for c in select * from active_campaigns(t.code, p_business) ac
           where ac.kind in ('multiplier', 'bonus')
             and campaign_stay_ok(ac, coalesce(v_start, (now() at time zone 'Asia/Bangkok')::date)) loop
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

drop function if exists admin_save_campaign(uuid, uuid, text, text, text, text[], text, numeric, int, timestamptz, timestamptz, boolean, int, int, int, boolean);
create or replace function admin_save_campaign(p_actor uuid, p_id uuid, p_name text, p_description text,
  p_business text, p_tiers text[], p_kind text, p_multiplier numeric, p_bonus int,
  p_starts timestamptz, p_ends timestamptz, p_active boolean,
  p_min_days int default 0, p_free_days int default 0, p_amount_off int default 0, p_stackable boolean default true,
  p_stay_from date default null, p_stay_to date default null, p_percent_off int default 0)
returns campaigns
language plpgsql set search_path = public as $$
declare a staff_users; c campaigns; biz text; disc boolean := p_kind in ('free_days', 'amount_off', 'percent_off');
begin
  a := staff_require_admin(p_actor);
  biz := case when disc then 'parking' else coalesce(nullif(p_business, ''), 'all') end;
  if nullif(trim(p_name), '') is null
     or p_kind not in ('multiplier', 'bonus', 'announce', 'free_days', 'amount_off', 'percent_off')
     or (p_kind = 'multiplier' and (p_multiplier is null or p_multiplier <= 1 or p_multiplier > 10))
     or (p_kind = 'bonus' and (p_bonus is null or p_bonus < 1))
     or (p_kind = 'free_days' and (coalesce(p_free_days, 0) < 1 or coalesce(p_min_days, 0) <= p_free_days))
     or (p_kind = 'amount_off' and (coalesce(p_amount_off, 0) < 1 or coalesce(p_min_days, 0) < 1))
     or (p_kind = 'percent_off' and (coalesce(p_percent_off, 0) < 1 or p_percent_off > 100 or coalesce(p_min_days, 0) < 1))
     or (p_ends is not null and p_starts is not null and p_ends <= p_starts)
     or (p_stay_from is not null and p_stay_to is not null and p_stay_to < p_stay_from) then
    raise exception 'invalid_campaign';
  end if;
  if p_id is null then
    insert into campaigns (name, description, business, tiers, kind, multiplier, bonus_points, starts_at, ends_at, active,
                           min_days, free_days, amount_off, percent_off, stackable, stay_from, stay_to)
    values (trim(p_name), nullif(trim(p_description), ''), biz, nullif(p_tiers, '{}'),
            p_kind, case when p_kind = 'multiplier' then p_multiplier else 1 end,
            case when p_kind = 'bonus' then p_bonus else 0 end, coalesce(p_starts, now()), p_ends, coalesce(p_active, true),
            case when disc then p_min_days else 0 end,
            case when p_kind = 'free_days' then p_free_days else 0 end,
            case when p_kind = 'amount_off' then p_amount_off else 0 end,
            case when p_kind = 'percent_off' then p_percent_off else 0 end,
            coalesce(p_stackable, true), p_stay_from, p_stay_to)
    returning * into c;
  else
    update campaigns set name = trim(p_name), description = nullif(trim(p_description), ''),
      business = biz, tiers = nullif(p_tiers, '{}'), kind = p_kind,
      multiplier = case when p_kind = 'multiplier' then p_multiplier else 1 end,
      bonus_points = case when p_kind = 'bonus' then p_bonus else 0 end,
      starts_at = coalesce(p_starts, starts_at), ends_at = p_ends, active = coalesce(p_active, true),
      min_days = case when disc then p_min_days else 0 end,
      free_days = case when p_kind = 'free_days' then p_free_days else 0 end,
      amount_off = case when p_kind = 'amount_off' then p_amount_off else 0 end,
      percent_off = case when p_kind = 'percent_off' then p_percent_off else 0 end,
      stackable = coalesce(p_stackable, true), stay_from = p_stay_from, stay_to = p_stay_to
    where id = p_id returning * into c;
    if not found then raise exception 'not_found'; end if;
  end if;
  perform audit(a, 'save', 'campaign', c.id::text, to_jsonb(c));
  return c;
end $$;

do $$ declare fn text; begin
  foreach fn in array array[
    'booking_campaign(text,int,int,date)', 'booking_campaign_preview(text,int,date)',
    'earn_points(uuid,text,int,text,uuid,uuid,bigint)',
    'admin_save_campaign(uuid,uuid,text,text,text,text[],text,numeric,int,timestamptz,timestamptz,boolean,int,int,int,boolean,date,date,int)'
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
