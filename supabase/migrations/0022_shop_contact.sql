-- 0022: shop phone and chat hours set once in the admin, used everywhere
-- (LINE cards, the price / contact replies, the call-the-van page, the customer pages). Run after 0021.

alter table settings add column if not exists shop_phone  text not null default '0888101089';
alter table settings add column if not exists admin_hours text not null default '08:00–20:00';

-- error: invalid_phone | invalid_settings
create or replace function admin_set_contact(p_actor uuid, p_phone text, p_hours text)
returns void
language plpgsql set search_path = public as $$
declare a staff_users; ph text := regexp_replace(coalesce(p_phone, ''), '\D', '', 'g');
begin
  a := staff_require_admin(p_actor);
  if ph !~ '^0\d{8,9}$' then raise exception 'invalid_phone'; end if;
  if nullif(trim(p_hours), '') is null or length(p_hours) > 60 then raise exception 'invalid_settings'; end if;
  update settings set shop_phone = ph, admin_hours = trim(p_hours) where id = 1;
  perform audit(a, 'update', 'settings', '1', jsonb_build_object('shop_phone', ph, 'admin_hours', trim(p_hours)));
end $$;

revoke execute on function admin_set_contact(uuid, text, text) from public;
do $$ begin
  if exists (select 1 from pg_roles where rolname = 'anon') then revoke execute on function admin_set_contact(uuid, text, text) from anon, authenticated; end if;
  if exists (select 1 from pg_roles where rolname = 'service_role') then grant execute on function admin_set_contact(uuid, text, text) to service_role; end if;
end $$;
notify pgrst, 'reload schema';
