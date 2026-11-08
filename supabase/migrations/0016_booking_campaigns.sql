-- 0016: booking-discount campaigns for parking
--   free_days  : book at least min_days days -> free_days days free   (e.g. 10 days, 1 day free)
--   amount_off : book at least min_days days -> amount_off baht off   (e.g. 30 days, 500 baht off)
-- Same tier / date / active rules as the other campaigns. When several fit, the biggest discount wins.
-- stackable = false: the customer gets either this campaign or the returning-customer discount,
-- whichever is bigger. Coupons from points always still apply. Run after 0015.

alter table campaigns drop constraint if exists campaigns_kind_check;
alter table campaigns add constraint campaigns_kind_check
  check (kind in ('multiplier', 'bonus', 'announce', 'free_days', 'amount_off'));
alter table campaigns add column if not exists min_days   int not null default 0 check (min_days >= 0);
alter table campaigns add column if not exists free_days  int not null default 0 check (free_days >= 0);
alter table campaigns add column if not exists amount_off int not null default 0 check (amount_off >= 0);
alter table campaigns add column if not exists stackable  boolean not null default true;

alter table bookings add column if not exists campaign_id     uuid references campaigns(id) on delete set null;
alter table bookings add column if not exists campaign_amount int not null default 0;
alter table bookings drop column total_amount;
alter table bookings add column total_amount int
  generated always as (parking_amount + shuttle_amount - discount_amount - coupon_amount - campaign_amount) stored;

-- the best booking campaign for this tier and number of days: (id, name, amount, stackable)
create or replace function booking_campaign(p_tier text, p_days int, p_price_per_day int)
returns table (id uuid, name text, amount int, stackable boolean)
language sql stable set search_path = public as $$
  select c.id, c.name,
         case when c.kind = 'free_days' then least(c.free_days, p_days) * p_price_per_day else c.amount_off end,
         c.stackable
  from active_campaigns(p_tier, 'parking') c
  where c.kind in ('free_days', 'amount_off') and p_days >= greatest(c.min_days, 1)
  order by 3 desc limit 1
$$;

-- applied to every new booking (after the returning-customer rule, before the price is stored)
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
  select * into c from booking_campaign(t.code, days, s.price_per_day);
  if c.id is null or c.amount <= 0 then return new; end if;
  amt := c.amount;
  if not c.stackable and new.discount_amount > 0 then
    if amt <= new.discount_amount then return new; end if;   -- the member discount is better
    new.discount_amount := 0; new.discount_reason := null; new.referrer_phone := null;
  end if;
  amt := least(amt, new.parking_amount + new.shuttle_amount - new.discount_amount - new.coupon_amount);
  if amt <= 0 then return new; end if;
  new.campaign_id := c.id;
  new.campaign_amount := amt;
  return new;
end $$;

drop trigger if exists bookings_promo on bookings;
create trigger bookings_promo before insert on bookings
  for each row execute function bookings_promo_trg();

-- preview for the booking page
create or replace function booking_campaign_preview(p_line_user_id text, p_days int)
returns table (id uuid, name text, amount int, stackable boolean)
language plpgsql stable set search_path = public as $$
declare
  cid uuid;
  tier text;
begin
  select cu.id into cid from customers cu where cu.line_user_id = p_line_user_id;
  if cid is not null then tier := (customer_tier(cid)).code;
  else select code into tier from member_tiers order by sort limit 1; end if;
  return query select * from booking_campaign(tier, p_days, (select price_per_day from settings where settings.id = 1));
end $$;

-- campaign editor with the new fields
drop function if exists admin_save_campaign(uuid, uuid, text, text, text, text[], text, numeric, int, timestamptz, timestamptz, boolean);
create or replace function admin_save_campaign(p_actor uuid, p_id uuid, p_name text, p_description text,
  p_business text, p_tiers text[], p_kind text, p_multiplier numeric, p_bonus int,
  p_starts timestamptz, p_ends timestamptz, p_active boolean,
  p_min_days int default 0, p_free_days int default 0, p_amount_off int default 0, p_stackable boolean default true)
returns campaigns
language plpgsql set search_path = public as $$
declare a staff_users; c campaigns; biz text;
begin
  a := staff_require_admin(p_actor);
  biz := case when p_kind in ('free_days', 'amount_off') then 'parking' else coalesce(nullif(p_business, ''), 'all') end;
  if nullif(trim(p_name), '') is null
     or p_kind not in ('multiplier', 'bonus', 'announce', 'free_days', 'amount_off')
     or (p_kind = 'multiplier' and (p_multiplier is null or p_multiplier <= 1 or p_multiplier > 10))
     or (p_kind = 'bonus' and (p_bonus is null or p_bonus < 1))
     or (p_kind = 'free_days' and (coalesce(p_free_days, 0) < 1 or coalesce(p_min_days, 0) <= p_free_days))
     or (p_kind = 'amount_off' and (coalesce(p_amount_off, 0) < 1 or coalesce(p_min_days, 0) < 1))
     or (p_ends is not null and p_starts is not null and p_ends <= p_starts) then
    raise exception 'invalid_campaign';
  end if;
  if p_id is null then
    insert into campaigns (name, description, business, tiers, kind, multiplier, bonus_points, starts_at, ends_at, active,
                           min_days, free_days, amount_off, stackable)
    values (trim(p_name), nullif(trim(p_description), ''), biz, nullif(p_tiers, '{}'),
            p_kind, case when p_kind = 'multiplier' then p_multiplier else 1 end,
            case when p_kind = 'bonus' then p_bonus else 0 end, coalesce(p_starts, now()), p_ends, coalesce(p_active, true),
            case when p_kind in ('free_days', 'amount_off') then p_min_days else 0 end,
            case when p_kind = 'free_days' then p_free_days else 0 end,
            case when p_kind = 'amount_off' then p_amount_off else 0 end,
            coalesce(p_stackable, true))
    returning * into c;
  else
    update campaigns set name = trim(p_name), description = nullif(trim(p_description), ''),
      business = biz, tiers = nullif(p_tiers, '{}'), kind = p_kind,
      multiplier = case when p_kind = 'multiplier' then p_multiplier else 1 end,
      bonus_points = case when p_kind = 'bonus' then p_bonus else 0 end,
      starts_at = coalesce(p_starts, starts_at), ends_at = p_ends, active = coalesce(p_active, true),
      min_days = case when p_kind in ('free_days', 'amount_off') then p_min_days else 0 end,
      free_days = case when p_kind = 'free_days' then p_free_days else 0 end,
      amount_off = case when p_kind = 'amount_off' then p_amount_off else 0 end,
      stackable = coalesce(p_stackable, true)
    where id = p_id returning * into c;
    if not found then raise exception 'not_found'; end if;
  end if;
  perform audit(a, 'save', 'campaign', c.id::text, to_jsonb(c));
  return c;
end $$;

do $$ declare fn text; begin
  foreach fn in array array[
    'booking_campaign(text,int,int)', 'booking_campaign_preview(text,int)',
    'admin_save_campaign(uuid,uuid,text,text,text,text[],text,numeric,int,timestamptz,timestamptz,boolean,int,int,int,boolean)'
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
