begin;
do $$
declare a uuid; b bookings; n int; d1 date := today_bkk() + 420; cnt int;
begin
  select id into a from staff_users where role='admin' limit 1;
  -- shop-entered booking for a customer with no LINE account
  b := admin_walkin_booking(a, 'ลูกค้านำเข้า', '0866660048', '[{"plate":"1กข4800","province":"กท"}]'::jsonb, d1, d1+2, false, null, null, null, null, 0, 'cash', false, 'import');
  -- wrong phone / wrong plate
  assert claim_imported_bookings('U48', '0866660049', '1กข4800') = -1;
  assert claim_imported_bookings('U48', '0866660048', '9ซซ9999') = -1;
  -- right pair, LINE user has no customer yet
  n := claim_imported_bookings('U48', '086-666-0048', '1 กข 4800');
  assert n = 1, 'one booking';
  assert (select line_user_id from customers where id = b.customer_id) = 'U48', 'customer relinked';
  -- case 2: LINE user already has a customer (e.g. made by a promo code), another imported booking arrives
  b := admin_walkin_booking(a, 'อีกคน', '0866660050', '[{"plate":"2ขค5000","province":"กท"}]'::jsonb, d1+5, d1+6, false, null, null, null, null, 0, 'cash', false, null);
  insert into customers (line_user_id, name, phone) values ('U50', 'สมศรี', '');
  n := claim_imported_bookings('U50', '0866660050', '2ขค5000');
  assert n = 1;
  assert (select c.line_user_id from bookings x join customers c on c.id = x.customer_id where x.id = b.id) = 'U50', 'merged into existing';
  assert (select phone from customers where line_user_id = 'U50') = '0866660050', 'phone filled';
  assert not exists (select 1 from customers where line_user_id like 'demo-walkin-0866660050'), 'placeholder removed';
  -- not claimable twice by someone else
  assert claim_imported_bookings('U99', '0866660050', '2ขค5000') = -1;
  -- lockout after 5 failures
  for i in 1..5 loop perform claim_imported_bookings('UBRUTE', '0800000000', 'X'); end loop;
  begin perform claim_imported_bookings('UBRUTE', '0866660048', '1กข4800'); assert false; exception when others then assert sqlerrm='claim_locked', sqlerrm; end;
  raise notice 'test_0048 OK';
end $$;
rollback;
