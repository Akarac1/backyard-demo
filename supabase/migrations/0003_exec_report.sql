-- =====================================================================
-- Backyard: executive report (revenue + customers by day / week / month / year)
-- Run after 0001 and 0002. Safe to re-run.
--
-- Rules used for the numbers:
--   * Revenue   = verified payments, counted on the day the money was received (paid_at, Bangkok time).
--                 A booking payment is split into parking and shuttle using that booking's amounts.
--                 Reschedule extra days and overstay are reported as "extra".
--   * The current day/week/month/year is counted up to today only (future bookings are not counted yet).
--   * Customers = paid bookings whose car comes in (start_date) inside the period.
--                 "New" = that customer's first ever paid booking.
--   * Occupancy = car-days parked in the period / (total spots x days in the period).
-- =====================================================================

create or replace function exec_report(p_grain text, p_periods int default 12)
returns table (
  bucket            date,     -- first day of the day/week/month/year
  bucket_end        date,     -- last day counted (today for the current bucket)
  revenue_total     bigint,
  revenue_parking   bigint,
  revenue_shuttle   bigint,
  revenue_extra     bigint,
  bookings_paid     bigint,   -- bookings that were paid in the period
  cars_in           bigint,   -- cars arriving in the period
  customers         bigint,   -- distinct customers arriving in the period
  new_customers     bigint,
  shuttle_bookings  bigint,
  shuttle_pax       bigint,
  car_days          bigint,
  occupancy_pct     numeric
)
language plpgsql stable
set search_path = public
as $$
declare
  v_unit  text;
  v_step  interval;
  v_today date := today_bkk();
  v_first date;
  v_spots int;
begin
  if p_grain not in ('day', 'week', 'month', 'year') then
    raise exception 'invalid_grain';
  end if;
  p_periods := least(greatest(coalesce(p_periods, 12), 1), 400);
  v_unit := p_grain;
  v_step := ('1 ' || p_grain)::interval;
  v_first := (date_trunc(v_unit, v_today::timestamp) - v_step * (p_periods - 1))::date;
  select total_spots into v_spots from settings where id = 1;

  return query
  with buckets as (
    -- e = last day counted: the bucket's last day, or today for the current bucket
    select g::date as b, least((g + v_step - interval '1 day')::date, v_today) as e
    from generate_series(v_first::timestamp, date_trunc(v_unit, v_today::timestamp), v_step) g
  ),
  paid_bookings as (            -- bookings with a verified booking payment
    select bk.*, cu.id as cust
    from bookings bk
    join customers cu on cu.id = bk.customer_id
    where bk.status in ('confirmed', 'checked_in', 'checked_out')
  ),
  first_booking as (
    select cust, min(start_date) as first_start from paid_bookings group by cust
  ),
  money as (
    select (p.paid_at at time zone 'Asia/Bangkok')::date as d,
           p.kind, p.amount, bk.parking_amount, bk.shuttle_amount
    from payments p
    join bookings bk on bk.id = p.booking_id
    where p.status = 'verified' and p.paid_at is not null
      and (p.paid_at at time zone 'Asia/Bangkok')::date >= v_first
  ),
  rev as (
    select bu.b,
      coalesce(sum(m.amount), 0)::bigint as total,
      coalesce(sum(case when m.kind = 'booking' then
        round(m.amount::numeric * m.parking_amount / nullif(m.parking_amount + m.shuttle_amount, 0)) end), 0)::bigint as parking,
      coalesce(sum(case when m.kind = 'booking' then
        m.amount - round(m.amount::numeric * m.parking_amount / nullif(m.parking_amount + m.shuttle_amount, 0)) end), 0)::bigint as shuttle,
      coalesce(sum(case when m.kind <> 'booking' then m.amount end), 0)::bigint as extra,
      count(*) filter (where m.kind = 'booking')::bigint as paid_count
    from buckets bu
    left join money m on m.d between bu.b and bu.e
    group by bu.b
  ),
  arrivals as (
    select bu.b,
      count(pb.id)::bigint as cars,
      count(distinct pb.cust)::bigint as custs,
      count(distinct pb.cust) filter (where fb.first_start = pb.start_date)::bigint as news,
      count(pb.id) filter (where pb.shuttle)::bigint as sh,
      coalesce(sum(pb.pax) filter (where pb.shuttle), 0)::bigint as pax
    from buckets bu
    left join paid_bookings pb on pb.start_date between bu.b and bu.e
    left join first_booking fb on fb.cust = pb.cust
    group by bu.b
  ),
  parked as (
    select bu.b,
      coalesce(sum(least(pb.end_date, bu.e) - greatest(pb.start_date, bu.b) + 1) filter (where pb.id is not null), 0)::bigint as cd
    from buckets bu
    left join paid_bookings pb on pb.start_date <= bu.e and pb.end_date >= bu.b
    group by bu.b
  )
  select bu.b, bu.e,
    r.total, r.parking, r.shuttle, r.extra, r.paid_count,
    a.cars, a.custs, a.news, a.sh, a.pax,
    pk.cd,
    round(100.0 * pk.cd / nullif(v_spots * (bu.e - bu.b + 1), 0), 1)
  from buckets bu
  join rev r on r.b = bu.b
  join arrivals a on a.b = bu.b
  join parked pk on pk.b = bu.b
  order by bu.b;
end $$;

revoke execute on function exec_report(text, int) from public;
do $$ begin
  if exists (select 1 from pg_roles where rolname = 'anon') then
    revoke execute on function exec_report(text, int) from anon, authenticated;
  end if;
end $$;
