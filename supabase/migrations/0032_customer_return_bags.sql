-- 0032: the customer updates the bag count of a trip (mostly the return trip: shopping on holiday)
-- from the "call the van" page or "สมาชิก & การจอง". The vehicle is checked again right away:
--  * still fits -> nothing changes
--  * does not fit and the van has not left -> released and re-assigned (smallest regular vehicle that fits)
--  * no regular vehicle free / none big enough / the van already left -> saved, and the app alerts staff
-- returns {"vehicle": name|null, "changed": bool, "no_vehicle": bool, "too_big": bool, "late": bool}
-- error: not_found | not_your_trip | trip_closed | invalid_bags
create or replace function customer_set_trip_bags(p_line_user_id text, p_trip_id uuid, p_large int, p_small int)
returns jsonb
language plpgsql set search_path = public as $$
declare
  t shuttle_trips;
  v vehicles;
  owner text;
  old_vehicle uuid;
  late boolean := false;
begin
  if coalesce(p_large, -1) not between 0 and 20 or coalesce(p_small, -1) not between 0 and 20 then raise exception 'invalid_bags'; end if;
  select * into t from shuttle_trips where id = p_trip_id for update;
  if not found then raise exception 'not_found'; end if;
  select c.line_user_id into owner from bookings b join customers c on c.id = b.customer_id where b.id = t.booking_id;
  if owner is distinct from p_line_user_id then raise exception 'not_your_trip'; end if;
  if t.status::text in ('done', 'cancelled', 'picked_up') then raise exception 'trip_closed'; end if;
  old_vehicle := t.vehicle_id;

  if t.large_bags = p_large and t.small_bags = p_small then
    select * into v from vehicles where id = t.vehicle_id;
    return jsonb_build_object('vehicle', v.name, 'changed', false, 'no_vehicle', t.vehicle_id is null, 'too_big', false, 'late', false);
  end if;

  update shuttle_trips set large_bags = p_large, small_bags = p_small, updated_at = now() where id = t.id returning * into t;
  insert into trip_events (trip_id, staff_name, note)
  values (t.id, 'ลูกค้า', format('ลูกค้าแจ้งกระเป๋า ใหญ่ %s เล็ก %s ใบ', p_large, p_small));

  select * into v from vehicles where id = t.vehicle_id;
  if t.vehicle_id is not null and not vehicle_fits(v, t.pax, t.large_bags, t.small_bags) then
    if t.status::text in ('unassigned', 'assigned') then
      -- the van has not left: give the trip a vehicle that fits (a vehicle staff picked by hand is released too)
      update shuttle_trips set vehicle_id = null, status = 'unassigned', assignment_locked = false where id = t.id;
      perform assign_vehicle(t.id);
    else
      late := true;   -- already on the way in a car that is too small: staff must sort it out
    end if;
  elsif t.vehicle_id is null and t.status::text = 'unassigned' and t.pickup_at is not null then
    perform assign_vehicle(t.id);
  end if;

  select * into t from shuttle_trips where id = t.id;
  select * into v from vehicles where id = t.vehicle_id;
  return jsonb_build_object(
    'vehicle', v.name,
    'changed', t.vehicle_id is distinct from old_vehicle,
    'no_vehicle', t.vehicle_id is null,
    'too_big', not exists (select 1 from vehicles_regular() r where vehicle_fits(r, t.pax, t.large_bags, t.small_bags)),
    'late', late);
end $$;

revoke all on function customer_set_trip_bags(text, uuid, int, int) from public;
do $$ begin
  if exists (select 1 from pg_roles where rolname = 'anon') then
    revoke all on function customer_set_trip_bags(text, uuid, int, int) from anon, authenticated;
  end if;
  if exists (select 1 from pg_roles where rolname = 'service_role') then
    grant execute on function customer_set_trip_bags(text, uuid, int, int) to service_role;
  end if;
end $$;
