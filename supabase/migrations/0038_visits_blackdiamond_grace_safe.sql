-- 0038: four additions
--   A. customer visit statistics for the members page (how many visits, repeats, how often)
--   B. Black Diamond plates: plate-only pass, kept apart from the member system, queued for the plate reader
--   C. late-night return grace: landing at/after 22:00 on the last day gets one more day, not told to the customer
--   D. "car is safe in the lot" card: one per booking per day, claimed when the guard marks the car as found

-- ---------------------------------------------------------------------
-- A. visit statistics (a visit = a booking that was checked out)
-- ---------------------------------------------------------------------
create or replace function customer_visit_stats(p_q text default null, p_sort text default 'visits', p_limit int default 50, p_offset int default 0)
returns table (id uuid, name text, phone text, member_no text, bookings int, visits int, repeats int,
               first_visit date, last_visit date, avg_gap_days numeric, visits_12m int, total_days int, total_count bigint)
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
           round(agg.avg_gap, 1) as avg_gap_days, coalesce(agg.v12, 0) as visits_12m, coalesce(agg.total_days, 0) as total_days
    from customers c
    left join agg on agg.customer_id = c.id
    left join bk on bk.customer_id = c.id
    where coalesce(bk.n, 0) > 0
      and (coalesce(p_q, '') = ''
           or c.name ilike '%' || replace(replace(p_q, '%', ''), '_', '') || '%'
           or (regexp_replace(p_q, '\D', '', 'g') <> '' and length(regexp_replace(p_q, '\D', '', 'g')) >= 3 and c.phone like '%' || regexp_replace(p_q, '\D', '', 'g') || '%')
           or c.member_no = upper(p_q))
  )
  select f.id, f.name, f.phone, f.member_no, f.bookings, f.visits, f.repeats, f.first_visit, f.last_visit,
         f.avg_gap_days, f.visits_12m, f.total_days, count(*) over () as total_count
  from f
  order by case when p_sort = 'last' then f.last_visit end desc nulls last,
           case when p_sort = 'gap' then f.avg_gap_days end asc nulls last,
           case when p_sort = 'recent12' then f.visits_12m end desc nulls last,
           f.visits desc, f.last_visit desc nulls last, f.name
  limit greatest(least(p_limit, 200), 1) offset greatest(p_offset, 0)
$$;

create or replace function visit_stats_summary()
returns table (customers_with_visit int, repeat_customers int, total_visits int, avg_gap_days numeric)
language sql stable set search_path = public as $$
  with v as (
    select b.customer_id, b.start_date,
           b.start_date - lag(b.start_date) over (partition by b.customer_id order by b.start_date) as gap
    from bookings b where b.status = 'checked_out'
  )
  select count(distinct customer_id)::int,
         (select count(*)::int from (select customer_id from v group by customer_id having count(*) > 1) r),
         count(*)::int,
         round(avg(gap), 1)
  from v
$$;

revoke all on function customer_visit_stats(text, text, int, int), visit_stats_summary() from public, anon, authenticated;
grant execute on function customer_visit_stats(text, text, int, int), visit_stats_summary() to service_role;

-- ---------------------------------------------------------------------
-- B. Black Diamond plates (secret admin page). Plate only, no customer, no end date.
--    Changes go on a queue the plate-reader connector will pull, like lpr_sync.
-- ---------------------------------------------------------------------
create table if not exists vip_plates (
  id              uuid primary key default gen_random_uuid(),
  plate           text not null,
  plate_province  text not null default '',
  holder_name     text,
  note            text,
  active          boolean not null default true,
  created_by      uuid references staff_users(id),
  created_at      timestamptz not null default now()
);
create unique index if not exists vip_plates_plate_key on vip_plates (lower(regexp_replace(plate, '\s', '', 'g')));

create table if not exists lpr_vip_sync (
  id              bigserial primary key,
  vip_id          uuid,
  plate           text not null,
  plate_province  text not null default '',
  action          text not null check (action in ('add', 'remove')),
  status          text not null default 'pending' check (status in ('pending', 'done', 'failed')),
  attempts        int  not null default 0,
  last_error      text,
  created_at      timestamptz not null default now(),
  done_at         timestamptz
);
create index if not exists lpr_vip_sync_pending_idx on lpr_vip_sync (created_at) where status <> 'done';
alter table vip_plates enable row level security;
alter table lpr_vip_sync enable row level security;

create or replace function admin_vip_add(p_actor uuid, p_plate text, p_province text, p_holder text, p_note text) returns vip_plates
language plpgsql set search_path = public as $$
declare a staff_users; v vip_plates; pl text := regexp_replace(coalesce(p_plate, ''), '\s', '', 'g');
begin
  a := staff_require_admin(p_actor);
  if length(pl) < 2 or length(pl) > 12 then raise exception 'invalid_plate'; end if;
  begin
    insert into vip_plates (plate, plate_province, holder_name, note, created_by)
    values (pl, coalesce(trim(p_province), ''), nullif(trim(p_holder), ''), nullif(trim(p_note), ''), a.id) returning * into v;
  exception when unique_violation then raise exception 'plate_exists'; end;
  insert into lpr_vip_sync (vip_id, plate, plate_province, action) values (v.id, v.plate, v.plate_province, 'add');
  perform audit(a, 'vip_add', 'vip_plate', v.id::text, jsonb_build_object('plate', v.plate));
  return v;
end $$;

create or replace function admin_vip_set_active(p_actor uuid, p_id uuid, p_active boolean) returns vip_plates
language plpgsql set search_path = public as $$
declare a staff_users; v vip_plates;
begin
  a := staff_require_admin(p_actor);
  update vip_plates set active = p_active where id = p_id returning * into v;
  if not found then raise exception 'not_found'; end if;
  insert into lpr_vip_sync (vip_id, plate, plate_province, action) values (v.id, v.plate, v.plate_province, case when p_active then 'add' else 'remove' end);
  perform audit(a, case when p_active then 'vip_enable' else 'vip_disable' end, 'vip_plate', v.id::text, jsonb_build_object('plate', v.plate));
  return v;
end $$;

create or replace function admin_vip_remove(p_actor uuid, p_id uuid) returns void
language plpgsql set search_path = public as $$
declare a staff_users; v vip_plates;
begin
  a := staff_require_admin(p_actor);
  delete from vip_plates where id = p_id returning * into v;
  if not found then raise exception 'not_found'; end if;
  insert into lpr_vip_sync (vip_id, plate, plate_province, action) values (null, v.plate, v.plate_province, 'remove');
  perform audit(a, 'vip_remove', 'vip_plate', p_id::text, jsonb_build_object('plate', v.plate));
end $$;

revoke all on function admin_vip_add(uuid, text, text, text, text), admin_vip_set_active(uuid, uuid, boolean), admin_vip_remove(uuid, uuid) from public, anon, authenticated;
grant execute on function admin_vip_add(uuid, text, text, text, text), admin_vip_set_active(uuid, uuid, boolean), admin_vip_remove(uuid, uuid) to service_role;

-- ---------------------------------------------------------------------
-- C. late-night return grace
-- ---------------------------------------------------------------------
alter table settings add column if not exists late_grace_hour int not null default 22 check (late_grace_hour between 18 and 23);
alter table bookings add column if not exists late_grace boolean not null default false;

create or replace function compute_late_grace(p_booking uuid) returns boolean
language sql stable set search_path = public as $$
  select exists (
    select 1
    from shuttle_trips t
    join bookings b on b.id = t.booking_id
    join settings s on s.id = 1
    where t.booking_id = p_booking and t.direction = 'from_airport' and t.status <> 'cancelled' and t.landing_at is not null
      and t.landing_at >= (b.end_date::timestamp + make_interval(hours => s.late_grace_hour)) at time zone 'Asia/Bangkok'
      and t.landing_at <  ((b.end_date + 2)::timestamp) at time zone 'Asia/Bangkok'
  )
$$;

create or replace function refresh_late_grace(p_booking uuid) returns void
language plpgsql set search_path = public as $$
declare g boolean := compute_late_grace(p_booking);
begin
  update bookings set late_grace = g where id = p_booking and late_grace is distinct from g;
end $$;

create or replace function trg_trip_late_grace() returns trigger
language plpgsql set search_path = public as $$
begin
  perform refresh_late_grace(new.booking_id);
  return null;
end $$;
drop trigger if exists shuttle_trips_late_grace on shuttle_trips;
create trigger shuttle_trips_late_grace after insert or update of landing_at, status, direction on shuttle_trips
  for each row execute function trg_trip_late_grace();

create or replace function trg_booking_late_grace() returns trigger
language plpgsql set search_path = public as $$
begin
  perform refresh_late_grace(new.id);
  return null;
end $$;
drop trigger if exists bookings_late_grace on bookings;
create trigger bookings_late_grace after update of end_date on bookings
  for each row when (old.end_date is distinct from new.end_date) execute function trg_booking_late_grace();

update bookings b set late_grace = true
where b.status in ('confirmed', 'checked_in') and compute_late_grace(b.id) and not b.late_grace;

create or replace function admin_set_late_grace_hour(p_actor uuid, p_hour int) returns settings
language plpgsql set search_path = public as $$
declare a staff_users; s settings;
begin
  a := staff_require_admin(p_actor);
  if coalesce(p_hour, -1) not between 18 and 23 then raise exception 'invalid_grace_hour'; end if;
  update settings set late_grace_hour = p_hour where id = 1 returning * into s;
  update bookings b set late_grace = compute_late_grace(b.id) where b.status in ('confirmed', 'checked_in');
  perform audit(a, 'late_grace_hour', 'settings', '1', jsonb_build_object('hour', p_hour));
  return s;
end $$;
revoke all on function admin_set_late_grace_hour(uuid, int) from public, anon, authenticated;
grant execute on function admin_set_late_grace_hour(uuid, int) to service_role;

-- ---------------------------------------------------------------------
-- D. "your car is safe in the lot" card, one per booking per day
-- ---------------------------------------------------------------------
create table if not exists car_checks (
  booking_id  uuid not null references bookings(id) on delete cascade,
  day         date not null,
  checked_by  uuid references staff_users(id),
  created_at  timestamptz not null default now(),
  primary key (booking_id, day)
);
alter table car_checks enable row level security;

-- true only for the first "found" of the day: the caller sends the card when it gets true
create or replace function lot_claim_safe_card(p_actor uuid, p_booking uuid) returns boolean
language plpgsql set search_path = public as $$
declare a staff_users;
begin
  a := staff_require_role(p_actor, array['admin', 'ops']);
  if not exists (select 1 from bookings where id = p_booking and status = 'checked_in') then raise exception 'not_in_lot'; end if;
  insert into car_checks (booking_id, day, checked_by) values (p_booking, today_bkk(), a.id) on conflict do nothing;
  return found;
end $$;

create or replace function lot_release_safe_card(p_actor uuid, p_booking uuid) returns void
language plpgsql set search_path = public as $$
declare a staff_users;
begin
  a := staff_require_role(p_actor, array['admin', 'ops']);
  delete from car_checks where booking_id = p_booking and day = today_bkk();
end $$;

revoke all on function lot_claim_safe_card(uuid, uuid), lot_release_safe_card(uuid, uuid) from public, anon, authenticated;
grant execute on function lot_claim_safe_card(uuid, uuid), lot_release_safe_card(uuid, uuid) to service_role;

-- tables are only reached by the server (service role)
grant select, insert, update, delete on vip_plates, lpr_vip_sync, car_checks to service_role;
grant usage, select on sequence lpr_vip_sync_id_seq to service_role;
