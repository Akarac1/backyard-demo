-- 0046 Promo-code conditions: minimum parking days, shuttle required, can combine with the returning-customer/referral discount.
-- Enforced on every new booking by a trigger (like campaigns), so no booking path can skip it.
-- Errors (new): promo_conditions, promo_not_stackable

alter table promo_codes add column if not exists min_days      int     not null default 1 check (min_days between 1 and 365);
alter table promo_codes add column if not exists needs_shuttle boolean not null default false;
alter table promo_codes add column if not exists stackable     boolean not null default true;

drop function if exists admin_save_promo(uuid, uuid, text, text, int, int, int, timestamptz, timestamptz, int, text, boolean);
create or replace function admin_save_promo(p_actor uuid, p_id uuid, p_code text, p_title text, p_value int,
  p_max_uses int, p_per_customer int, p_valid_from timestamptz, p_valid_until timestamptz, p_coupon_days int,
  p_channel text, p_active boolean, p_min_days int default 1, p_needs_shuttle boolean default false, p_stackable boolean default true)
returns promo_codes
language plpgsql set search_path = public as $$
declare a staff_users; r promo_codes; v_code text;
begin
  a := staff_require_admin(p_actor);
  v_code := upper(regexp_replace(coalesce(p_code, ''), '\s', '', 'g'));
  if nullif(trim(p_title), '') is null or coalesce(p_value, 0) < 1 or (p_max_uses is not null and p_max_uses < 1)
     or coalesce(p_per_customer, 1) < 1 or coalesce(p_coupon_days, 30) < 1 or coalesce(p_coupon_days, 30) > 1095
     or coalesce(p_min_days, 1) < 1 or coalesce(p_min_days, 1) > 365
     or (v_code <> '' and v_code !~ '^[A-Z0-9_-]{3,24}$')
     or (p_valid_from is not null and p_valid_until is not null and p_valid_until <= p_valid_from) then
    raise exception 'invalid_promo';
  end if;
  if p_id is null then
    if v_code = '' then v_code := gen_promo_code(); end if;
    if exists (select 1 from promo_codes where code = v_code) then raise exception 'promo_exists'; end if;
    insert into promo_codes (code, title, value_baht, max_uses, per_customer, valid_from, valid_until, coupon_days, channel, active,
                             min_days, needs_shuttle, stackable)
    values (v_code, trim(p_title), p_value, p_max_uses, coalesce(p_per_customer, 1), p_valid_from, p_valid_until,
            coalesce(p_coupon_days, 30), nullif(trim(p_channel), ''), coalesce(p_active, true),
            coalesce(p_min_days, 1), coalesce(p_needs_shuttle, false), coalesce(p_stackable, true))
    returning * into r;
  else
    update promo_codes set title = trim(p_title), value_baht = p_value, max_uses = p_max_uses,
      per_customer = coalesce(p_per_customer, 1), valid_from = p_valid_from, valid_until = p_valid_until,
      coupon_days = coalesce(p_coupon_days, 30), channel = nullif(trim(p_channel), ''), active = coalesce(p_active, true),
      min_days = coalesce(p_min_days, 1), needs_shuttle = coalesce(p_needs_shuttle, false), stackable = coalesce(p_stackable, true)
    where id = p_id returning * into r;
    if not found then raise exception 'not_found'; end if;
  end if;
  perform audit(a, 'save', 'promo', r.id::text, to_jsonb(r));
  return r;
end $$;

-- the conditions are read live from the code, so editing a code also applies to coupons already handed out
create or replace function bookings_promo_coupon_trg() returns trigger
language plpgsql set search_path = public as $$
declare pr promo_codes;
begin
  if new.coupon_id is null then return new; end if;
  select p.* into pr from coupons c join promo_codes p on p.id = c.promo_id where c.id = new.coupon_id;
  if not found then return new; end if;
  if (new.end_date - new.start_date + 1) < pr.min_days or (pr.needs_shuttle and not new.shuttle) then
    raise exception 'promo_conditions';
  end if;
  if not pr.stackable and new.discount_amount > 0 then raise exception 'promo_not_stackable'; end if;
  return new;
end $$;

drop trigger if exists bookings_promo_coupon on bookings;
create trigger bookings_promo_coupon before insert on bookings
  for each row execute function bookings_promo_coupon_trg();

do $$ declare fn text; begin
  foreach fn in array array[
    'admin_save_promo(uuid,uuid,text,text,int,int,int,timestamptz,timestamptz,int,text,boolean,int,boolean,boolean)'
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
