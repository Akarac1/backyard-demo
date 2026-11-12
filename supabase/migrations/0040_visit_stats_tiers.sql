-- 0040: visit statistics show each customer's card level, can be filtered by it, and have counts per card type.
-- Black Diamond (an active card from black_diamond) outranks the spend-based tier in this view.
drop function if exists customer_visit_stats(text, text, int, int);

-- every customer's card level in one pass (same rule as customer_tier(), but set-based so it stays fast on thousands of customers)
create or replace function customer_cards() returns table (customer_id uuid, tier text, tier_name text)
language sql stable set search_path = public as $$
  with s as (select tier_window_months m from settings where id = 1),
  pay as (
    select b.customer_id, sum(p.amount) as a from payments p join bookings b on b.id = p.booking_id, s
    where p.status = 'verified' and p.paid_at > now() - make_interval(months => s.m) group by b.customer_id
  ), buy as (
    select mp.customer_id, sum(mp.amount) as a from member_purchases mp, s
    where mp.created_at > now() - make_interval(months => s.m) group by mp.customer_id
  ), spend as (
    select c.id, c.tier_override, (coalesce(pay.a, 0) + coalesce(buy.a, 0))::int as spend
    from customers c left join pay on pay.customer_id = c.id left join buy on buy.customer_id = c.id
  )
  select sp.id,
         case when bd.customer_id is not null then 'blackdiamond' else t.code end,
         case when bd.customer_id is not null then 'Black Diamond' else t.name end
  from spend sp
  left join black_diamond bd on bd.customer_id = sp.id and bd.active
  left join lateral (
    select mt.code, mt.name from member_tiers mt
    where mt.code = sp.tier_override or (sp.tier_override is null and mt.min_spend <= sp.spend)
    order by mt.sort desc limit 1
  ) t on true
$$;


create or replace function customer_visit_stats(p_q text default null, p_sort text default 'visits', p_limit int default 50, p_offset int default 0, p_tier text default null)
returns table (id uuid, name text, phone text, member_no text, bookings int, visits int, repeats int,
               first_visit date, last_visit date, avg_gap_days numeric, visits_12m int, total_days int, tier text, tier_name text, total_count bigint)
language sql stable set search_path = public as $$
  with v as (
    select b.customer_id, b.start_date, b.days,
           b.start_date - lag(b.start_date) over (partition by b.customer_id order by b.start_date) as gap
    from bookings b where b.status = 'checked_out'
  ), agg as (
    select customer_id, count(*)::int as visits, min(start_date) as first_visit, max(start_date) as last_visit,
           avg(gap) as avg_gap, (count(*) filter (where start_date >= today_bkk() - 365))::int as v12, sum(days)::int as total_days
    from v group by customer_id
  ), bk as (
    select customer_id, count(*)::int as n from bookings where status in ('confirmed', 'checked_in', 'checked_out') group by customer_id
  ), f as (
    select c.id, c.name, c.phone, c.member_no, coalesce(bk.n, 0) as bookings, coalesce(agg.visits, 0) as visits,
           greatest(coalesce(agg.visits, 0) - 1, 0) as repeats, agg.first_visit, agg.last_visit,
           round(agg.avg_gap, 1) as avg_gap_days, coalesce(agg.v12, 0) as visits_12m, coalesce(agg.total_days, 0) as total_days,
           cc.tier, cc.tier_name
    from customers c
    join customer_cards() cc on cc.customer_id = c.id
    left join agg on agg.customer_id = c.id
    left join bk on bk.customer_id = c.id
    where coalesce(bk.n, 0) > 0
      and (coalesce(p_q, '') = ''
           or c.name ilike '%' || replace(replace(p_q, '%', ''), '_', '') || '%'
           or (length(regexp_replace(p_q, '\D', '', 'g')) >= 3 and c.phone like '%' || regexp_replace(p_q, '\D', '', 'g') || '%')
           or c.member_no = upper(p_q))
  )
  select f.id, f.name, f.phone, f.member_no, f.bookings, f.visits, f.repeats, f.first_visit, f.last_visit,
         f.avg_gap_days, f.visits_12m, f.total_days, f.tier, f.tier_name, count(*) over () as total_count
  from f
  where coalesce(p_tier, '') = '' or f.tier = p_tier
  order by case when p_sort = 'last' then f.last_visit end desc nulls last,
           case when p_sort = 'gap' then f.avg_gap_days end asc nulls last,
           case when p_sort = 'recent12' then f.visits_12m end desc nulls last,
           f.visits desc, f.last_visit desc nulls last, f.name
  limit greatest(least(p_limit, 200), 1) offset greatest(p_offset, 0)
$$;

-- customers listed in the visit table, by card type (Black Diamond separate from the spend tiers)
create or replace function visit_tier_counts() returns table (tier text, tier_name text, n bigint)
language sql stable set search_path = public as $$
  select cc.tier, cc.tier_name, count(*)
  from customer_cards() cc
  where exists (select 1 from bookings b where b.customer_id = cc.customer_id and b.status in ('confirmed', 'checked_in', 'checked_out'))
  group by 1, 2
$$;

revoke all on function customer_cards(), customer_visit_stats(text, text, int, int, text), visit_tier_counts() from public, anon, authenticated;
grant execute on function customer_cards(), customer_visit_stats(text, text, int, int, text), visit_tier_counts() to service_role;
notify pgrst, 'reload schema';
