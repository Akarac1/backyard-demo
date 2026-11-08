-- Demo only: finished shuttle trips for the demo history bookings (seed_history.sql), so the
-- shuttle report has numbers. Run after 0009. Never run on real data.
-- Removes nothing; safe to run once. Trips get drivers at random if driver accounts exist.
do $$
declare
  r record;
  drivers uuid[];
  t_out timestamptz; t_back timestamptz; called timestamptz;
begin
  select array_agg(id) into drivers from staff_users where role::text = 'driver' and active;
  for r in
    select b.id, b.start_date, b.end_date, b.pax
    from bookings b join customers c on c.id = b.customer_id
    where c.line_user_id like 'demo-hist-%' and b.shuttle and b.status = 'checked_out'
      and not exists (select 1 from shuttle_trips t where t.booking_id = b.id)
  loop
    -- departures cluster in the morning and evening, arrivals in the afternoon and late night
    t_out  := (r.start_date::timestamp + make_interval(hours => (array[5,6,7,8,9,17,18,19,20,21])[1 + floor(random() * 10)::int], mins => floor(random() * 60)::int)) at time zone 'Asia/Bangkok';
    t_back := (r.end_date::timestamp + make_interval(hours => (array[10,13,14,15,16,22,23])[1 + floor(random() * 7)::int], mins => floor(random() * 60)::int)) at time zone 'Asia/Bangkok';
    called := t_back - make_interval(mins => floor(random() * 10)::int);
    insert into shuttle_trips (booking_id, direction, pax, pickup_at, status, departed_at, arrived_at, completed_at, driver_staff_id)
    values (r.id, 'to_airport', r.pax, t_out, 'done', t_out + interval '3 minutes', t_out - interval '5 minutes', t_out + interval '20 minutes',
            case when drivers is not null then drivers[1 + floor(random() * array_length(drivers, 1))::int] end);
    insert into shuttle_trips (booking_id, direction, pax, pickup_at, status, called_at, called_by, departed_at, arrived_at, completed_at, driver_staff_id)
    values (r.id, 'from_airport', r.pax, t_back, 'done', called, 'customer',
            called + make_interval(mins => 1 + floor(random() * 4)::int),
            called + make_interval(mins => 9 + floor(power(random(), 2) * 16)::int),
            called + interval '45 minutes',
            case when drivers is not null then drivers[1 + floor(random() * array_length(drivers, 1))::int] end);
  end loop;
end $$;
