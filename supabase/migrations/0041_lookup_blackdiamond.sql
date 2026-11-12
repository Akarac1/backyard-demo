-- 0041: the "ระดับสมาชิกรายคน" lookup shows Black Diamond holders (tier = blackdiamond, listed with the manual ones). Run after 0040.

create or replace function customer_lookup(p_q text, p_only_manual boolean default false)
returns table (id uuid, name text, phone text, member_no text, tier text, tier_name text, manual boolean,
               spend int, points int, bookings bigint, last_start date)
language sql stable set search_path = public as $$
  with q as (select nullif(trim(coalesce(p_q, '')), '') as t, nullif(regexp_replace(coalesce(p_q, ''), '\D', '', 'g'), '') as d),
  hits as (
    select c.* from customers c, q
    where (p_only_manual and (c.tier_override is not null
             or exists (select 1 from black_diamond b where b.customer_id = c.id and b.active)))
       or (not p_only_manual and q.t is not null and (
             c.name ilike '%' || q.t || '%'
          or c.member_no = upper(q.t)
          or (q.d is not null and length(q.d) >= 4 and norm_phone(c.phone) like '%' || q.d || '%')))
    order by c.created_at desc
    limit 30
  )
  select h.id, h.name, h.phone, h.member_no,
         case when bd.customer_id is not null then 'blackdiamond' else t.code end,
         case when bd.customer_id is not null then 'Black Diamond' else t.name end,
         (h.tier_override is not null or bd.customer_id is not null),
         customer_spend(h.id), points_balance(h.id),
         (select count(*) from bookings b where b.customer_id = h.id and b.status in ('confirmed','checked_in','checked_out','no_show')),
         (select max(b.start_date) from bookings b where b.customer_id = h.id)
  from hits h
  left join black_diamond bd on bd.customer_id = h.id and bd.active
  cross join lateral customer_tier(h.id) t
  where h.line_user_id not like 'demo-hist-%'
$$;

notify pgrst, 'reload schema';
