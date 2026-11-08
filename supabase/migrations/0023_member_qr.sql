-- 0023: member QR — the customer taps their card to show a QR; staff (cafe, hotel, lot) scan it
-- to see the member, take their coupons and record what they spent. On-site staff (ops) may now
-- take coupons and record cafe / hotel spend, not only admins. Run after 0022.

create or replace function admin_use_coupon(p_actor uuid, p_code text)
returns coupons
language plpgsql set search_path = public as $$
declare a staff_users; cp coupons;
begin
  a := staff_require_role(p_actor, array['admin', 'ops']);
  select * into cp from coupons where code = upper(trim(p_code)) for update;
  if not found then raise exception 'coupon_not_found'; end if;
  if cp.status <> 'active' then raise exception 'coupon_used'; end if;
  if cp.expires_at <= now() then raise exception 'coupon_expired'; end if;
  if cp.kind = 'parking_discount' then raise exception 'coupon_parking'; end if;
  update coupons set status = 'used', used_at = now(), used_by = a.username where id = cp.id returning * into cp;
  perform audit(a, 'use', 'coupon', cp.code, jsonb_build_object('title', cp.title));
  return cp;
end $$;

create or replace function admin_record_purchase(p_actor uuid, p_who text, p_business text, p_amount int, p_note text)
returns table (customer_name text, points int, tier text)
language plpgsql set search_path = public as $$
declare
  a staff_users;
  c customers;
  pid bigint;
  pts int;
begin
  a := staff_require_role(p_actor, array['admin', 'ops']);
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

notify pgrst, 'reload schema';
