-- 0045 Promo codes (Gen Code): one shareable code (Facebook / other platforms) -> personal coupon per customer.
-- A code can be unlimited (max_uses null) or limited to N redemptions; each customer redeems it at most per_customer times.
-- Redeeming creates a normal coupon (kind parking_discount) so the booking-review step, cancel/refund and QR flow all work as before.
-- Errors (new): promo_invalid, promo_used_up, promo_already, invalid_promo, promo_exists

create table if not exists promo_codes (
  id           uuid primary key default gen_random_uuid(),
  code         text not null unique,
  title        text not null,
  value_baht   int  not null check (value_baht >= 1),
  max_uses     int  check (max_uses is null or max_uses >= 1),
  per_customer int  not null default 1 check (per_customer >= 1),
  used_count   int  not null default 0,
  valid_from   timestamptz,
  valid_until  timestamptz,
  coupon_days  int  not null default 30 check (coupon_days between 1 and 1095),
  channel      text,
  active       boolean not null default true,
  created_at   timestamptz not null default now()
);
alter table promo_codes enable row level security;

alter table coupons add column if not exists promo_id uuid references promo_codes(id) on delete set null;
create index if not exists coupons_promo_idx on coupons (promo_id, customer_id);

create or replace function gen_promo_code() returns text
language plpgsql volatile set search_path = public, extensions as $$
declare
  alphabet constant text := 'ABCDEFGHJKMNPQRSTUVWXYZ23456789';
  c text;
begin
  loop
    select 'BY' || string_agg(substr(alphabet, 1 + (get_byte(b, i) % length(alphabet)), 1), '' order by i)
      into c from (select gen_random_bytes(6) as b) r, generate_series(0, 5) i;
    exit when not exists (select 1 from promo_codes where code = c);
  end loop;
  return c;
end $$;

create or replace function admin_save_promo(p_actor uuid, p_id uuid, p_code text, p_title text, p_value int,
  p_max_uses int, p_per_customer int, p_valid_from timestamptz, p_valid_until timestamptz, p_coupon_days int,
  p_channel text, p_active boolean)
returns promo_codes
language plpgsql set search_path = public as $$
declare a staff_users; r promo_codes; v_code text;
begin
  a := staff_require_admin(p_actor);
  v_code := upper(regexp_replace(coalesce(p_code, ''), '\s', '', 'g'));
  if nullif(trim(p_title), '') is null or coalesce(p_value, 0) < 1 or (p_max_uses is not null and p_max_uses < 1)
     or coalesce(p_per_customer, 1) < 1 or coalesce(p_coupon_days, 30) < 1 or coalesce(p_coupon_days, 30) > 1095
     or (v_code <> '' and v_code !~ '^[A-Z0-9_-]{3,24}$')
     or (p_valid_from is not null and p_valid_until is not null and p_valid_until <= p_valid_from) then
    raise exception 'invalid_promo';
  end if;
  if p_id is null then
    if v_code = '' then v_code := gen_promo_code(); end if;
    if exists (select 1 from promo_codes where code = v_code) then raise exception 'promo_exists'; end if;
    insert into promo_codes (code, title, value_baht, max_uses, per_customer, valid_from, valid_until, coupon_days, channel, active)
    values (v_code, trim(p_title), p_value, p_max_uses, coalesce(p_per_customer, 1), p_valid_from, p_valid_until,
            coalesce(p_coupon_days, 30), nullif(trim(p_channel), ''), coalesce(p_active, true))
    returning * into r;
  else
    -- the code itself never changes after creation (it may already be posted somewhere)
    update promo_codes set title = trim(p_title), value_baht = p_value, max_uses = p_max_uses,
      per_customer = coalesce(p_per_customer, 1), valid_from = p_valid_from, valid_until = p_valid_until,
      coupon_days = coalesce(p_coupon_days, 30), channel = nullif(trim(p_channel), ''), active = coalesce(p_active, true)
    where id = p_id returning * into r;
    if not found then raise exception 'not_found'; end if;
  end if;
  perform audit(a, 'save', 'promo', r.id::text, to_jsonb(r));
  return r;
end $$;

create or replace function redeem_promo_code(p_line_user_id text, p_code text)
returns coupons
language plpgsql set search_path = public, extensions as $$
declare c customers; pr promo_codes; cp coupons; mine int;
begin
  select * into c from customers where line_user_id = p_line_user_id;
  if not found then raise exception 'promo_invalid'; end if;
  select * into pr from promo_codes where code = upper(regexp_replace(coalesce(p_code, ''), '\s', '', 'g')) for update;
  if not found or not pr.active or (pr.valid_from is not null and pr.valid_from > now())
     or (pr.valid_until is not null and pr.valid_until <= now()) then
    raise exception 'promo_invalid';
  end if;
  if pr.max_uses is not null and pr.used_count >= pr.max_uses then raise exception 'promo_used_up'; end if;
  select count(*) into mine from coupons where promo_id = pr.id and customer_id = c.id and status <> 'cancelled';
  if mine >= pr.per_customer then raise exception 'promo_already'; end if;

  update promo_codes set used_count = used_count + 1 where id = pr.id;
  insert into coupons (code, customer_id, promo_id, title, business, kind, value_baht, points_spent, expires_at)
  values (gen_coupon_code(), c.id, pr.id, pr.title, 'parking', 'parking_discount', pr.value_baht, 0,
          now() + make_interval(days => pr.coupon_days))
  returning * into cp;
  return cp;
end $$;

-- when staff cancel a promo coupon, give the slot back to the code (points refund only applies to reward coupons)
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
  if cp.promo_id is not null then update promo_codes set used_count = greatest(used_count - 1, 0) where id = cp.promo_id; end if;
  update coupons set status = 'cancelled', used_at = now(), used_by = a.username where id = cp.id returning * into cp;
  perform audit(a, 'cancel', 'coupon', cp.code, jsonb_build_object('points', cp.points_spent));
  return cp;
end $$;

do $$ declare fn text; begin
  foreach fn in array array[
    'gen_promo_code()', 'redeem_promo_code(text,text)',
    'admin_save_promo(uuid,uuid,text,text,int,int,int,timestamptz,timestamptz,int,text,boolean)',
    'admin_cancel_coupon(uuid,text)'
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
