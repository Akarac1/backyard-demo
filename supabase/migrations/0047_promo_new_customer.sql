-- 0047 A brand-new customer (no booking yet) can redeem a promo code on the booking review step:
-- the customer row is created on the spot from the name / phone typed on the form. create_booking updates it later.

drop function if exists redeem_promo_code(text, text);
create or replace function redeem_promo_code(p_line_user_id text, p_code text, p_name text default null, p_phone text default null)
returns coupons
language plpgsql set search_path = public, extensions as $$
declare c customers; pr promo_codes; cp coupons; mine int;
begin
  select * into pr from promo_codes where code = upper(regexp_replace(coalesce(p_code, ''), '\s', '', 'g')) for update;
  if not found or not pr.active or (pr.valid_from is not null and pr.valid_from > now())
     or (pr.valid_until is not null and pr.valid_until <= now()) then
    raise exception 'promo_invalid';
  end if;
  if pr.max_uses is not null and pr.used_count >= pr.max_uses then raise exception 'promo_used_up'; end if;

  select * into c from customers where line_user_id = p_line_user_id;
  if not found then
    insert into customers (line_user_id, name, phone)
    values (p_line_user_id, coalesce(nullif(trim(p_name), ''), 'ลูกค้าใหม่'), coalesce(nullif(trim(p_phone), ''), ''))
    on conflict (line_user_id) do nothing;
    select * into c from customers where line_user_id = p_line_user_id;
  end if;

  select count(*) into mine from coupons where promo_id = pr.id and customer_id = c.id and status <> 'cancelled';
  if mine >= pr.per_customer then raise exception 'promo_already'; end if;

  update promo_codes set used_count = used_count + 1 where id = pr.id;
  insert into coupons (code, customer_id, promo_id, title, business, kind, value_baht, points_spent, expires_at)
  values (gen_coupon_code(), c.id, pr.id, pr.title, 'parking', 'parking_discount', pr.value_baht, 0,
          now() + make_interval(days => pr.coupon_days))
  returning * into cp;
  return cp;
end $$;

do $$ declare fn text; begin
  foreach fn in array array['redeem_promo_code(text,text,text,text)'] loop
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
