-- 0036: admins tune "landing → out of the arrivals hall" minutes from the settings page.
-- The booking adds these minutes to the landing time the customer enters to plan the return pickup.
create or replace function admin_set_exit_minutes(p_actor uuid, p_domestic int, p_international int) returns settings
language plpgsql set search_path = public as $$
declare a staff_users; s settings;
begin
  a := staff_require_admin(p_actor);
  if coalesce(p_domestic, -1) not between 0 and 180 or coalesce(p_international, -1) not between 0 and 180 then
    raise exception 'invalid_exit_minutes';
  end if;
  update settings set exit_minutes_domestic = p_domestic, exit_minutes_international = p_international
  where id = 1 returning * into s;
  perform audit(a, 'exit_minutes', 'settings', '1', jsonb_build_object('domestic', p_domestic, 'international', p_international));
  return s;
end $$;

revoke all on function admin_set_exit_minutes(uuid, int, int) from public, anon, authenticated;
grant execute on function admin_set_exit_minutes(uuid, int, int) to service_role;
