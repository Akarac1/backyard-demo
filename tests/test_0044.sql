-- 0044: extra days move the return pickup; any pending payment can be paid; return trip can be edited
begin;
do $$
declare
  adm uuid; c uuid; b bookings; t shuttle_trips; p payments; pid uuid; d0 timestamptz; r bookings;
begin
  select id into adm from staff_users where role='admin' and active limit 1;
  insert into customers (line_user_id, name, phone) values ('demo-t44','T44','0812345678') returning id into c;
  insert into bookings (customer_id, code, plate, plate_province, start_date, end_date, status, parking_amount, shuttle, pax)
    values (c, 'T44AAA', 'ทด 4444', 'กรุงเทพฯ', current_date + 30, current_date + 33, 'confirmed', 0, true, 2) returning * into b;
  insert into shuttle_trips (booking_id, direction, pax, pickup_at, landing_at, customer_time, flight_number, flight_date)
    values (b.id, 'from_airport', 2, (current_date + 33)::timestamptz + interval '16 hours', (current_date + 33)::timestamptz + interval '15 hours', (current_date + 33)::timestamptz + interval '15 hours', 'TG1', current_date + 33);
  select pickup_at into d0 from shuttle_trips where booking_id = b.id;

  perform admin_add_extra_days(adm, b.id, 2, false, true);
  select * into t from shuttle_trips where booking_id = b.id;
  assert t.pickup_at = d0 + interval '2 days', 'pickup moved 2 days';
  assert t.flight_date = current_date + 35, 'flight date moved';
  select * into p from payments where booking_id = b.id and kind='overstay';
  assert p.status = 'pending', 'overstay pending';

  perform admin_add_extra_days(adm, b.id, 1, true, false);
  select * into t from shuttle_trips where booking_id = b.id;
  assert t.pickup_at = d0 + interval '2 days', 'not shifted when asked not to';

  r := admin_pay_payment(adm, p.id, 'transfer', 'ref1');
  select * into p from payments where id = p.id;
  assert p.status = 'verified' and p.verified_by like 'admin:%:transfer:ref1', 'paid by transfer';
  begin perform admin_pay_payment(adm, p.id, 'cash'); assert false, 'should fail'; exception when others then assert sqlerrm = 'payment_not_pending'; end;

  t := admin_update_return_trip(adm, t.id, (current_date + 40)::timestamptz + interval '10 hours', null, 'pg 9');
  assert t.pickup_at = d0 + interval '2 days' + ((current_date + 40)::timestamptz + interval '10 hours' - (d0 + interval '2 days' - interval '1 hour')), 'pickup follows landing';
  assert t.flight_number = 'PG9' and t.flight_date = current_date + 40, 'flight updated';
  begin perform admin_update_return_trip(adm, t.id, t.pickup_at + interval '1 hour', t.pickup_at, null); assert false; exception when others then assert sqlerrm = 'landing_after_pickup'; end;
  raise notice 'test_0044 ok';
end $$;
rollback;
