-- =====================================================================
-- Backyard: shuttle workload report (for deciding when to add a vehicle)
-- Run after 0001–0008. Safe to re-run.
--
-- Counts finished trips (status done), dated by when they were finished (Bangkok time).
--   busy_hours   = hours in which more trips started than there are active vehicles
--   peak_in_hour = most trips that started within one clock hour
--   wait         = return trips: minutes from "customer called" to "van at the meeting point"
-- =====================================================================

create or replace function shuttle_report(p_grain text, p_periods int default 12)
returns table (
  bucket date, bucket_end date,
  trips bigint, trips_to bigint, trips_from bigint, pax bigint,
  avg_wait_min numeric, late_over_15 bigint, called_trips bigint,
  peak_in_hour bigint, busy_hours bigint, vehicles int
)
language plpgsql stable set search_path = public as $$
declare
  v_step interval;
  v_today date := today_bkk();
  v_first date;
  v_veh int;
begin
  if p_grain not in ('day', 'week', 'month', 'year') then raise exception 'invalid_grain'; end if;
  p_periods := least(greatest(coalesce(p_periods, 12), 1), 400);
  v_step := ('1 ' || p_grain)::interval;
  v_first := (date_trunc(p_grain, v_today::timestamp) - v_step * (p_periods - 1))::date;
  select count(*) into v_veh from vehicles where active;

  return query
  with buckets as (
    select g::date as b, least((g + v_step - interval '1 day')::date, v_today) as e
    from generate_series(v_first::timestamp, date_trunc(p_grain, v_today::timestamp), v_step) g
  ),
  done as (
    select t.*,
      (coalesce(t.completed_at, t.pickup_at) at time zone 'Asia/Bangkok')::date as d,
      date_trunc('hour', coalesce(t.departed_at, t.pickup_at) at time zone 'Asia/Bangkok') as hr
    from shuttle_trips t
    where t.status::text = 'done'
      and (coalesce(t.completed_at, t.pickup_at) at time zone 'Asia/Bangkok')::date >= v_first
  ),
  per_hour as (
    select bu.b, dn.hr, count(*) as n
    from buckets bu join done dn on dn.d between bu.b and bu.e
    group by bu.b, dn.hr
  ),
  agg as (
    select bu.b,
      count(dn.id) as trips,
      count(dn.id) filter (where dn.direction = 'to_airport') as trips_to,
      count(dn.id) filter (where dn.direction = 'from_airport') as trips_from,
      coalesce(sum(dn.pax), 0) as pax,
      round(avg(extract(epoch from (dn.arrived_at - dn.called_at)) / 60) filter (where dn.called_at is not null and dn.arrived_at > dn.called_at), 1) as avg_wait,
      count(dn.id) filter (where dn.called_at is not null and dn.arrived_at - dn.called_at > interval '15 minutes') as late,
      count(dn.id) filter (where dn.called_at is not null) as called
    from buckets bu left join done dn on dn.d between bu.b and bu.e
    group by bu.b
  )
  select bu.b, bu.e,
    a.trips, a.trips_to, a.trips_from, a.pax, a.avg_wait, a.late, a.called,
    coalesce((select max(ph.n) from per_hour ph where ph.b = bu.b), 0)::bigint,
    (select count(*) from per_hour ph where ph.b = bu.b and ph.n > v_veh)::bigint,
    v_veh
  from buckets bu join agg a on a.b = bu.b
  order by bu.b;
end $$;

-- Per driver for a date range (Bangkok dates, inclusive)
create or replace function shuttle_driver_stats(p_from date, p_to date)
returns table (driver text, trips bigint, trips_to bigint, trips_from bigint, pax bigint, avg_wait_min numeric, late_over_15 bigint)
language sql stable set search_path = public as $$
  select coalesce(s.display_name, 'ไม่ระบุคนขับ'),
    count(*), count(*) filter (where t.direction = 'to_airport'), count(*) filter (where t.direction = 'from_airport'),
    coalesce(sum(t.pax), 0),
    round(avg(extract(epoch from (t.arrived_at - t.called_at)) / 60) filter (where t.called_at is not null and t.arrived_at > t.called_at), 1),
    count(*) filter (where t.called_at is not null and t.arrived_at - t.called_at > interval '15 minutes')
  from shuttle_trips t
  left join staff_users s on s.id = t.driver_staff_id
  where t.status::text = 'done'
    and (coalesce(t.completed_at, t.pickup_at) at time zone 'Asia/Bangkok')::date between p_from and p_to
  group by 1
  order by 2 desc
$$;

do $$
declare fn text;
begin
  foreach fn in array array['shuttle_report(text,int)', 'shuttle_driver_stats(date,date)'] loop
    execute format('revoke execute on function %s from public', fn);
    if exists (select 1 from pg_roles where rolname = 'anon') then
      execute format('revoke execute on function %s from anon, authenticated', fn);
    end if;
  end loop;
end $$;
