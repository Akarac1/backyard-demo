-- 0026: customers rate the shuttle (1–5 stars + optional comment) from the "arrived at the
-- airport" and "back at Backyard" cards. Ratings are kept per trip, credited to the driver who
-- ran it, and shown in the reports. Rating is optional; a customer can change it for 7 days.

create table if not exists trip_ratings (
  id              bigserial primary key,
  trip_id         uuid not null unique references shuttle_trips(id) on delete cascade,
  booking_id      uuid references bookings(id) on delete set null,
  customer_id     uuid references customers(id) on delete set null,
  driver_staff_id uuid references staff_users(id) on delete set null,
  driver_name     text,                       -- kept even if the staff account is removed later
  vehicle_id      uuid references vehicles(id) on delete set null,
  direction       trip_direction not null,
  stars           int  not null check (stars between 1 and 5),
  comment         text check (length(comment) <= 1000),
  created_at      timestamptz not null default now(),
  updated_at      timestamptz not null default now()
);
create index if not exists trip_ratings_driver_idx on trip_ratings (driver_staff_id, created_at desc);
create index if not exists trip_ratings_created_idx on trip_ratings (created_at desc);
alter table trip_ratings enable row level security;

-- the customer's own trip, finished. errors: not_found | trip_not_done | invalid_rating | rating_closed
create or replace function customer_rate_trip(p_line_user_id text, p_trip uuid, p_stars int, p_comment text)
returns trip_ratings
language plpgsql set search_path = public as $$
declare t shuttle_trips; b bookings; c customers; r trip_ratings; dname text;
begin
  if p_stars is null or p_stars < 1 or p_stars > 5 or length(coalesce(p_comment, '')) > 1000 then raise exception 'invalid_rating'; end if;
  select * into t from shuttle_trips where id = p_trip;
  if not found then raise exception 'not_found'; end if;
  select * into b from bookings where id = t.booking_id;
  select * into c from customers where id = b.customer_id;
  if c.line_user_id is distinct from p_line_user_id then raise exception 'not_found'; end if;
  if t.status <> 'done' then raise exception 'trip_not_done'; end if;
  select * into r from trip_ratings where trip_id = p_trip;
  if found then
    if r.created_at < now() - interval '7 days' then raise exception 'rating_closed'; end if;
    update trip_ratings set stars = p_stars, comment = nullif(trim(p_comment), ''), updated_at = now()
    where id = r.id returning * into r;
  else
    select display_name into dname from staff_users where id = t.driver_staff_id;
    insert into trip_ratings (trip_id, booking_id, customer_id, driver_staff_id, driver_name, vehicle_id, direction, stars, comment)
    values (t.id, b.id, c.id, t.driver_staff_id, regexp_replace(coalesce(dname, ''), '\s*\(.*\)$', ''), t.vehicle_id,
            t.direction, p_stars, nullif(trim(p_comment), ''))
    returning * into r;
  end if;
  return r;
end $$;

-- per driver for a period (Bangkok days, inclusive)
create or replace function rating_by_driver(p_from date, p_to date)
returns table (driver_staff_id uuid, driver_name text, ratings bigint, avg_stars numeric,
               s1 bigint, s2 bigint, s3 bigint, s4 bigint, s5 bigint, comments bigint, trips_done bigint)
language sql stable set search_path = public as $$
  with r as (
    select * from trip_ratings where (created_at at time zone 'Asia/Bangkok')::date between p_from and p_to
  ), d as (
    select driver_staff_id, count(*) as trips_done from shuttle_trips
    where status = 'done' and driver_staff_id is not null
      and (coalesce(completed_at, updated_at) at time zone 'Asia/Bangkok')::date between p_from and p_to
    group by 1
  )
  select coalesce(r.driver_staff_id, d.driver_staff_id),
         coalesce(max(su.display_name), max(r.driver_name), 'ไม่ระบุคนขับ'),
         count(r.id), round(avg(r.stars), 2),
         count(*) filter (where r.stars = 1), count(*) filter (where r.stars = 2), count(*) filter (where r.stars = 3),
         count(*) filter (where r.stars = 4), count(*) filter (where r.stars = 5),
         count(*) filter (where r.comment is not null),
         coalesce(max(d.trips_done), 0)
  from r full join d on d.driver_staff_id = r.driver_staff_id
  left join staff_users su on su.id = coalesce(r.driver_staff_id, d.driver_staff_id)
  group by coalesce(r.driver_staff_id, d.driver_staff_id)
  order by count(r.id) = 0, avg(r.stars) desc nulls last;
$$;

-- the ratings themselves, newest first
create or replace function rating_list(p_from date, p_to date, p_driver uuid default null, p_stars int default null,
  p_with_comment boolean default false, p_limit int default 500)
returns table (created_at timestamptz, updated_at timestamptz, stars int, comment text, direction trip_direction,
               driver_staff_id uuid, driver_name text, customer_name text, phone text, booking_code text, vehicle text)
language sql stable set search_path = public as $$
  select r.created_at, r.updated_at, r.stars, r.comment, r.direction, r.driver_staff_id,
         coalesce(su.display_name, r.driver_name), c.name, c.phone, b.code,
         nullif(concat_ws(' · ', v.name, v.plate), '')
  from trip_ratings r
  left join staff_users su on su.id = r.driver_staff_id
  left join customers c on c.id = r.customer_id
  left join bookings b on b.id = r.booking_id
  left join vehicles v on v.id = r.vehicle_id
  where (r.created_at at time zone 'Asia/Bangkok')::date between p_from and p_to
    and (p_driver is null or r.driver_staff_id = p_driver)
    and (p_stars is null or r.stars = p_stars)
    and (not coalesce(p_with_comment, false) or r.comment is not null)
  order by r.created_at desc
  limit least(greatest(coalesce(p_limit, 500), 1), 100000);
$$;

revoke all on table trip_ratings from public, anon, authenticated;
grant select, insert, update on table trip_ratings to service_role;
grant usage, select on sequence trip_ratings_id_seq to service_role;
revoke all on function customer_rate_trip(text, uuid, int, text) from public, anon, authenticated;
revoke all on function rating_by_driver(date, date) from public, anon, authenticated;
revoke all on function rating_list(date, date, uuid, int, boolean, int) from public, anon, authenticated;
grant execute on function customer_rate_trip(text, uuid, int, text) to service_role;
grant execute on function rating_by_driver(date, date) to service_role;
grant execute on function rating_list(date, date, uuid, int, boolean, int) to service_role;
