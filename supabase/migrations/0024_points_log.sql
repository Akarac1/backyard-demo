-- 0024: points log for the report pages: every earn and every deduction, with who did it.
--
-- Who: each staff function starts with staff_actor() (directly or through staff_require_admin /
-- staff_require_role). staff_actor now also records the staff member for the rest of the
-- transaction, and point_lots / point_spends pick it up as a column default. So points given by
-- an admin, compensation from the site lead, a café purchase recorded by staff and a payment an
-- admin confirmed by hand all carry the name; a slip checked automatically has none (= the system).

alter table point_lots  add column if not exists created_by uuid references staff_users(id) on delete set null;
alter table point_lots  add column if not exists created_by_name text;
alter table point_spends add column if not exists created_by uuid references staff_users(id) on delete set null;
alter table point_spends add column if not exists created_by_name text;

alter table point_lots  alter column created_by      set default nullif(current_setting('backyard.actor_id', true), '')::uuid;
alter table point_lots  alter column created_by_name set default nullif(current_setting('backyard.actor_name', true), '');
alter table point_spends alter column created_by      set default nullif(current_setting('backyard.actor_id', true), '')::uuid;
alter table point_spends alter column created_by_name set default nullif(current_setting('backyard.actor_name', true), '');

create index if not exists point_lots_earned_idx  on point_lots (earned_at desc);
create index if not exists point_spends_created_idx on point_spends (created_at desc);

-- now volatile: it sets the transaction's actor
create or replace function staff_actor(p_actor uuid) returns staff_users
language plpgsql volatile set search_path = public as $$
declare u staff_users;
begin
  select * into u from staff_users where id = p_actor and active;
  if not found then raise exception 'not_allowed'; end if;
  perform set_config('backyard.actor_id', u.id::text, true);
  perform set_config('backyard.actor_name', u.display_name, true);
  return u;
end $$;
alter function staff_require_admin(uuid) volatile;
alter function staff_require_role(uuid, text[]) volatile;

-- Backfill: points changed by staff before this migration, matched to the audit trail
-- (same customer, same points, within 5 seconds).
update point_lots l set created_by = a.staff_id, created_by_name = a.staff_name
from admin_audit a
where l.created_by is null and l.source = 'admin' and a.action = 'points'
  and a.entity_id = l.customer_id::text and (a.detail->>'points')::int = l.points
  and abs(extract(epoch from (a.at - l.earned_at))) < 5;
update point_spends s set created_by = a.staff_id, created_by_name = a.staff_name
from admin_audit a
where s.created_by is null and s.reason = 'admin' and a.action = 'points'
  and a.entity_id = s.customer_id::text and (a.detail->>'points')::int = -s.points
  and abs(extract(epoch from (a.at - s.created_at))) < 5;
update point_lots l set created_by = a.staff_id, created_by_name = a.staff_name
from member_purchases p join admin_audit a on a.action = 'purchase' and a.entity_id = p.customer_id::text
  and abs(extract(epoch from (a.at - p.created_at))) < 5
where l.created_by is null and l.purchase_id = p.id;

-- ---------------------------------------------------------------------
-- the log. kind: payment | purchase | referral | admin_add | admin_take | redeem | booking
-- p_kind: null/'' = everything, 'earn' = all earned, 'spend' = all used/taken, or one kind.
-- dates are Bangkok calendar days, inclusive.
-- ---------------------------------------------------------------------
create or replace function points_log(p_from date, p_to date, p_kind text default null, p_q text default null, p_limit int default 1000)
returns table (
  at timestamptz, kind text, points int, customer_id uuid, customer_name text, phone text, member_no text,
  booking_code text, business text, amount int, note text, by_name text, expires_at timestamptz, returned boolean)
language sql stable set search_path = public as $$
  with rows as (
    select l.earned_at as at,
           case l.source when 'payment' then 'payment' when 'referral' then 'referral' when 'admin' then 'admin_add' else 'purchase' end as kind,
           l.points, l.customer_id, coalesce(l.phone, c.phone) as phone, b.code as booking_code,
           coalesce(p.business, case when l.source = 'payment' then 'parking' end) as business,
           coalesce(p.amount, pay.amount) as amount, l.note, l.created_by_name as by_name, l.expires_at, false as returned
    from point_lots l
    left join customers c on c.id = l.customer_id
    left join bookings b on b.id = l.booking_id
    left join payments pay on pay.id = l.payment_id
    left join member_purchases p on p.id = l.purchase_id
    union all
    select s.created_at,
           case s.reason when 'admin' then 'admin_take' when 'coupon' then 'redeem' else 'booking' end,
           -s.points, s.customer_id, c.phone, b.code, null, null, s.note, s.created_by_name, null, s.returned_at is not null
    from point_spends s
    left join customers c on c.id = s.customer_id
    left join bookings b on b.id = s.booking_id
  )
  select r.at, r.kind, r.points, r.customer_id, c.name, r.phone, c.member_no, r.booking_code, r.business, r.amount,
         r.note, r.by_name, r.expires_at, r.returned
  from rows r
  left join customers c on c.id = r.customer_id
  where (r.at at time zone 'Asia/Bangkok')::date between p_from and p_to
    and (coalesce(p_kind, '') = ''
         or (p_kind = 'earn' and r.points > 0)
         or (p_kind = 'spend' and r.points < 0)
         or r.kind = p_kind)
    and (coalesce(trim(p_q), '') = ''
         or c.name ilike '%' || trim(p_q) || '%'
         or c.member_no ilike '%' || trim(p_q) || '%'
         or r.booking_code ilike '%' || trim(p_q) || '%'
         or coalesce(r.by_name, '') ilike '%' || trim(p_q) || '%'
         or (norm_phone(p_q) <> '' and norm_phone(r.phone) like '%' || norm_phone(p_q) || '%'))
  order by r.at desc
  limit least(greatest(coalesce(p_limit, 1000), 1), 100000);
$$;

-- totals per kind for the same filter (not cut by the row limit)
create or replace function points_log_totals(p_from date, p_to date, p_q text default null)
returns table (kind text, entries bigint, points bigint)
language sql stable set search_path = public as $$
  select kind, count(*), sum(points) from points_log(p_from, p_to, null, p_q, 100000) where not returned group by kind;
$$;

revoke all on function points_log(date, date, text, text, int) from public, anon, authenticated;
revoke all on function points_log_totals(date, date, text) from public, anon, authenticated;
grant execute on function points_log(date, date, text, text, int) to service_role;
grant execute on function points_log_totals(date, date, text) to service_role;
