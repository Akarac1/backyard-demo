-- 0034: driver TV board. The TV opens a secret link (no login, so it never logs out after 12 hours).
-- The link only shows the trip board; admins make a new link in settings to cut off an old one.
alter table settings add column if not exists tv_token text;

create or replace function admin_rotate_tv_token(p_actor uuid) returns text
language plpgsql set search_path = public as $$
declare a staff_users; tok text := replace(gen_random_uuid()::text, '-', '') || replace(gen_random_uuid()::text, '-', '');
begin
  a := staff_require_admin(p_actor);
  update settings set tv_token = tok where id = 1;
  perform audit(a, 'tv_link', 'settings', '1', '{}'::jsonb);
  return tok;
end $$;

revoke all on function admin_rotate_tv_token(uuid) from public;
do $$ begin
  if exists (select 1 from pg_roles where rolname = 'anon') then
    revoke all on function admin_rotate_tv_token(uuid) from anon, authenticated;
  end if;
  if exists (select 1 from pg_roles where rolname = 'service_role') then
    grant execute on function admin_rotate_tv_token(uuid) to service_role;
  end if;
end $$;
