-- 0027: use points right on the booking review page. The customer picks a parking-discount
-- reward there; its coupon is redeemed and applied to the booking in one transaction, so if the
-- booking fails (dates full, bad input) the points are not spent.

create or replace function create_booking_with_reward(
  p_line_user_id text, p_name text, p_phone text, p_plate text, p_province text, p_start date, p_end date,
  p_shuttle boolean default false, p_pax int default null, p_outbound_flight text default null,
  p_outbound_time timestamptz default null, p_return_flight text default null, p_return_time timestamptz default null,
  p_ref_phone text default null, p_reward uuid default null)
returns bookings
language plpgsql set search_path = public, extensions as $$
declare r rewards; cp coupons;
begin
  select * into r from rewards where id = p_reward;
  if not found or r.kind <> 'parking_discount' then raise exception 'not_found'; end if;
  cp := redeem_reward(p_line_user_id, p_reward);          -- raises not_enough_points / reward_closed / out_of_stock
  return create_booking(p_line_user_id => p_line_user_id, p_name => p_name, p_phone => p_phone, p_plate => p_plate,
    p_province => p_province, p_start => p_start, p_end => p_end, p_shuttle => p_shuttle, p_pax => p_pax,
    p_outbound_flight => p_outbound_flight, p_outbound_time => p_outbound_time, p_return_flight => p_return_flight,
    p_return_time => p_return_time, p_ref_phone => p_ref_phone, p_coupon => cp.id);
end $$;

revoke all on function create_booking_with_reward(text, text, text, text, text, date, date, boolean, int, text, timestamptz, text, timestamptz, text, uuid) from public, anon, authenticated;
grant execute on function create_booking_with_reward(text, text, text, text, text, date, date, boolean, int, text, timestamptz, text, timestamptz, text, uuid) to service_role;
