-- 0029: cars in the lot per day for any range (past or future), for the overview chart.
-- Past days count bookings that were in the lot (confirmed, checked in or out); future days also
-- count unpaid bookings still holding a space. At most 31 days per call.
create or replace function lot_density(p_from date, p_to date)
returns table (day date, cars int, arrivals int, departures int, cap int, total int)
language sql stable set search_path = public as $$
  select d::date,
         (select count(*)::int from bookings b
           where d::date between b.start_date and b.end_date
             and (b.status in ('confirmed', 'checked_in', 'checked_out')
                  or (b.status = 'pending_payment' and b.hold_expires_at > now()))),
         (select count(*)::int from bookings b where b.start_date = d::date and b.status in ('confirmed', 'checked_in', 'checked_out')),
         (select count(*)::int from bookings b where b.end_date = d::date and b.status in ('confirmed', 'checked_in', 'checked_out')),
         s.total_spots - s.reserve_spots,
         s.total_spots
  from settings s, generate_series(p_from, least(p_to, p_from + 30), interval '1 day') d
  where s.id = 1
  order by 1;
$$;
revoke all on function lot_density(date, date) from public, anon, authenticated;
grant execute on function lot_density(date, date) to service_role;
