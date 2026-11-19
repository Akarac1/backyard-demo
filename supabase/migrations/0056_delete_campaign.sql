-- 0056: admins can delete a campaign (until now it could only be switched off).
-- Past bookings keep the discount they already got (bookings.campaign_amount); only the link to the campaign is cleared
-- (bookings.campaign_id is "on delete set null"). The deleted row is kept in the audit log.
-- error: not_found | not_allowed
create or replace function admin_delete_campaign(p_actor uuid, p_id uuid) returns void
language plpgsql set search_path = public as $$
declare a staff_users; c campaigns;
begin
  a := staff_require_admin(p_actor);
  delete from campaigns where id = p_id returning * into c;
  if not found then raise exception 'not_found'; end if;
  perform audit(a, 'delete', 'campaign', c.id::text, to_jsonb(c));
end $$;
revoke all on function admin_delete_campaign(uuid, uuid) from public, anon, authenticated;
grant execute on function admin_delete_campaign(uuid, uuid) to service_role;
