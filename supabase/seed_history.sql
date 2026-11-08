-- Demo history: about 2 years of past bookings and payments (plus the next 30 days already booked),
-- so the executive dashboard has numbers to show. Never more than 55 cars on any day.
-- Run once in the SQL Editor after the migrations (and after seed_demo.sql if you use it).
-- Safe to delete: every row belongs to customers whose line_user_id starts with 'demo-hist-'.
--   delete from bookings where customer_id in (select id from customers where line_user_id like 'demo-hist-%');
--   delete from customers where line_user_id like 'demo-hist-%';

do $$
declare
  names text[] := array['กมล','จิราพร','ธนพล','นภัสสร','ปิยะ','พิมพ์ชนก','วรวุฒิ','ศิริพร','สุรเชษฐ์','อรอุมา','เกียรติศักดิ์','ณัฐวุฒิ','ชไมพร','ภาณุ','รัชนี'];
  d date;
  n int;
  growth numeric;
  season numeric;
  cust uuid;
  len int;
  sh boolean;
  px int;
  bid uuid;
  booked timestamptz;
  pool int := 2500;
  k int;
  seq int := 0;
  st booking_status;
  occ int[] := array_fill(0, array[800]);   -- cars per day, index 1 = today - 730
  i0 int;
  ok boolean;
begin
  insert into customers (line_user_id, name, phone, created_at)
  select 'demo-hist-' || i, names[1 + i % array_length(names, 1)] || ' ' || i,
         '09' || lpad((i * 7919 % 100000000)::text, 8, '0'), now() - interval '2 years'
  from generate_series(1, pool) i
  on conflict (line_user_id) do nothing;

  -- count cars already booked (for example from seed_demo.sql)
  for d in select g::date from bookings b, generate_series(b.start_date, b.end_date, interval '1 day') g
           where b.status in ('confirmed', 'checked_in') and g::date between today_bkk() - 730 and today_bkk() + 30 loop
    occ[d - (today_bkk() - 730) + 1] := occ[d - (today_bkk() - 730) + 1] + 1;
  end loop;

  for d in select g::date from generate_series(today_bkk() - 730, today_bkk() + 30, interval '1 day') g loop
    growth := 0.45 + 0.55 * (730 - (today_bkk() - d))::numeric / 730;          -- business grows over 2 years
    season := case extract(month from d)::int
                when 4 then 1.35 when 10 then 1.2 when 12 then 1.4 when 1 then 1.15
                when 6 then 0.8 when 9 then 0.8 else 1 end;                     -- holidays busier
    if extract(isodow from d) in (5, 6) then season := season * 1.25; end if;   -- Fri/Sat departures
    n := greatest(0, round(11 * growth * season + (random() - 0.5) * 6))::int;
    for i in 1..n loop
      -- returning customers: low ids come back more often
      k := least(pool, 1 + floor(pool * power(random(), 2.2))::int);
      select id into cust from customers where line_user_id = 'demo-hist-' || k;
      len := 1 + floor(power(random(), 1.6) * 9)::int;
      booked := ((d - (1 + floor(random() * 20))::int)::timestamp + make_interval(hours => 7 + floor(random() * 15)::int))
                at time zone 'Asia/Bangkok';
      continue when booked > now();                           -- not booked yet
      i0 := d - (today_bkk() - 730) + 1;
      ok := true;
      for j in 0..len - 1 loop
        if occ[i0 + j] >= 55 then ok := false; end if;
      end loop;
      continue when not ok;                                   -- lot full on one of those days
      for j in 0..len - 1 loop occ[i0 + j] := occ[i0 + j] + 1; end loop;
      st := case when d + len - 1 < today_bkk() then 'checked_out'
                 when d <= today_bkk() then 'checked_in' else 'confirmed' end;
      sh  := random() < 0.62;
      px  := case when sh then 1 + floor(power(random(), 1.5) * 7)::int end;
      seq := seq + 1;
      insert into bookings (code, customer_id, plate, plate_province, start_date, end_date, parking_amount,
                            shuttle, pax, shuttle_amount, status, booked_at, checked_in_at, checked_out_at, created_at)
      values ('H' || lpad(seq::text, 5, '0'), cust, (1 + i % 9)::text || 'กข ' || (1000 + floor(random() * 8999))::int, 'กรุงเทพมหานคร',
              d, d + len - 1, len * 100, sh, px, case when sh then 300 else 0 end,
              st, booked,
              case when st <> 'confirmed' then (d::timestamp + interval '8 hours') at time zone 'Asia/Bangkok' end,
              case when st = 'checked_out' then ((d + len - 1)::timestamp + interval '18 hours') at time zone 'Asia/Bangkok' end, booked)
      returning id into bid;
      insert into payments (booking_id, kind, amount, status, verified_by, paid_at, created_at)
      values (bid, 'booking', len * 100 + case when sh then 300 else 0 end, 'verified', 'slip:demo',
              booked + interval '6 minutes', booked);
      if st = 'checked_out' and random() < 0.05 then   -- some customers stay longer and pay 120/day extra
        insert into payments (booking_id, kind, amount, status, verified_by, paid_at, created_at)
        values (bid, 'overstay', 120 * (1 + floor(random() * 3))::int, 'verified', 'admin',
                ((d + len - 1)::timestamp + interval '19 hours') at time zone 'Asia/Bangkok',
                ((d + len - 1)::timestamp + interval '19 hours') at time zone 'Asia/Bangkok');
      end if;
    end loop;
  end loop;
end $$;

-- history rows are not meant for the plate reader queue
update lpr_sync set status = 'done'
 where status <> 'done'
   and booking_id in (select b.id from bookings b join customers c on c.id = b.customer_id where c.line_user_id like 'demo-hist-%');
