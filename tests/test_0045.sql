-- run: psql -d <db> -v ON_ERROR_STOP=1 -f tests/test_0045.sql  (rolls back)
begin;
do $$
declare a uuid; p promo_codes; c1 customers; c2 customers; c3 customers; cp coupons; n int; ok boolean;
begin
  select id into a from staff_users where role = 'admin' limit 1;
  insert into customers (line_user_id, name, phone) values ('T45a','A','0811111111') returning * into c1;
  insert into customers (line_user_id, name, phone) values ('T45b','B','0822222222') returning * into c2;
  insert into customers (line_user_id, name, phone) values ('T45c','C','0833333333') returning * into c3;

  p := admin_save_promo(a, null, '', '100 บาท', 100, 2, 1, null, null, 30, 'FB', true);
  assert p.code ~ '^BY[A-Z0-9]{6}$', 'generated code';
  p := admin_save_promo(a, null, 'new100', 'Limited', 100, 2, 1, null, null, 30, null, true);
  assert p.code = 'NEW100', 'custom code uppercased';
  begin perform admin_save_promo(a, null, 'NEW100', 'x', 100, null, 1, null, null, 30, null, true); assert false; exception when others then assert sqlerrm = 'promo_exists'; end;
  begin perform admin_save_promo(a, null, 'a b', 'x', 100, null, 1, null, null, 30, null, true); assert false; exception when others then assert sqlerrm = 'invalid_promo'; end;

  cp := redeem_promo_code('T45a', ' new100 ');
  assert cp.kind = 'parking_discount' and cp.value_baht = 100 and cp.status = 'active' and cp.promo_id = p.id, 'coupon made';
  begin perform redeem_promo_code('T45a', 'NEW100'); assert false; exception when others then assert sqlerrm = 'promo_already', sqlerrm; end;
  perform redeem_promo_code('T45b', 'NEW100');
  begin perform redeem_promo_code('T45c', 'NEW100'); assert false; exception when others then assert sqlerrm = 'promo_used_up', sqlerrm; end;
  -- cancelling gives the slot back
  perform admin_cancel_coupon(a, cp.code);
  perform redeem_promo_code('T45c', 'NEW100');
  select used_count into n from promo_codes where id = p.id; assert n = 2, 'used_count ' || n;
  -- unlimited + disabled + expired
  p := admin_save_promo(a, null, 'ALL50', 'All', 50, null, 1, null, null, 7, null, true);
  perform redeem_promo_code('T45a', 'ALL50'); perform redeem_promo_code('T45b', 'ALL50'); perform redeem_promo_code('T45c', 'ALL50');
  perform admin_save_promo(a, p.id, 'ignored', 'All', 50, null, 1, null, null, 7, null, false);
  assert (select code from promo_codes where id = p.id) = 'ALL50', 'code immutable';
  begin perform redeem_promo_code('T45a', 'ALL50'); assert false; exception when others then assert sqlerrm = 'promo_invalid'; end;
  perform admin_save_promo(a, p.id, '', 'All', 50, null, 1, now() - interval '2 day', now() - interval '1 day', 7, null, true);
  begin perform redeem_promo_code('T45a', 'ALL50'); assert false; exception when others then assert sqlerrm = 'promo_invalid'; end;
  begin perform redeem_promo_code('T45a', 'NOPE'); assert false; exception when others then assert sqlerrm = 'promo_invalid'; end;
  raise notice 'test_0045 OK';
end $$;
rollback;
