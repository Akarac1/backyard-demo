begin;
do $$
declare a uuid; p promo_codes; cp coupons; b bookings; d1 date := today_bkk() + 400; ok boolean;
begin
  select id into a from staff_users where role='admin' limit 1;
  insert into customers (line_user_id,name,phone) values ('T46','T','0899990046');
  p := admin_save_promo(a, null, 'COND', 'cond', 100, null, 1, null, null, 30, null, true, 3, true, false);
  cp := redeem_promo_code('T46','COND');
  begin perform create_booking('T46','T','0899990046','ทด1','กท',d1,d1+1,true,2,null,null,null,null,null,cp.id); assert false; exception when others then assert sqlerrm='promo_conditions', sqlerrm; end;
  begin perform create_booking('T46','T','0899990046','ทด1','กท',d1,d1+3,false,null,null,null,null,null,null,cp.id); assert false; exception when others then assert sqlerrm='promo_conditions', sqlerrm; end;
  b := create_booking('T46','T','0899990046','ทด1','กท',d1,d1+3,true,2,null,null,null,null,null,cp.id);
  assert b.coupon_amount = 100, 'applied';
  raise notice 'test_0046 OK';
end $$;
rollback;
