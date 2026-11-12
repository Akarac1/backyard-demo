-- 0039: Black Diamond becomes a card held by a MEMBER (customer). Only an admin can grant it.
-- The member's plates are what the plate reader lets in. Replaces the plate-only version from 0038.

create table if not exists black_diamond (
  customer_id  uuid primary key references customers(id) on delete cascade,
  note         text,
  active       boolean not null default true,
  granted_by   uuid references staff_users(id),
  created_at   timestamptz not null default now()
);
alter table black_diamond enable row level security;

-- plates from the plate-only version belong to nobody now: queue their removal and clear them
alter table vip_plates add column if not exists customer_id uuid references customers(id) on delete cascade;
insert into lpr_vip_sync (vip_id, plate, plate_province, action)
select null, plate, plate_province, 'remove' from vip_plates where customer_id is null and active;
delete from vip_plates where customer_id is null;
alter table vip_plates alter column customer_id set not null;

drop function if exists admin_vip_add(uuid, text, text, text, text);
drop function if exists admin_vip_set_active(uuid, uuid, boolean);

create or replace function admin_bd_grant(p_actor uuid, p_customer uuid, p_note text) returns black_diamond
language plpgsql set search_path = public as $$
declare a staff_users; b black_diamond;
begin
  a := staff_require_admin(p_actor);
  if not exists (select 1 from customers where id = p_customer) then raise exception 'member_not_found'; end if;
  insert into black_diamond (customer_id, note, granted_by) values (p_customer, nullif(trim(p_note), ''), a.id)
  on conflict (customer_id) do update set active = true, note = coalesce(nullif(trim(p_note), ''), black_diamond.note)
  returning * into b;
  insert into lpr_vip_sync (vip_id, plate, plate_province, action)
  select v.id, v.plate, v.plate_province, 'add' from vip_plates v where v.customer_id = p_customer;
  perform audit(a, 'bd_grant', 'black_diamond', p_customer::text, null);
  return b;
end $$;

create or replace function admin_bd_set_active(p_actor uuid, p_customer uuid, p_active boolean) returns black_diamond
language plpgsql set search_path = public as $$
declare a staff_users; b black_diamond;
begin
  a := staff_require_admin(p_actor);
  update black_diamond set active = p_active where customer_id = p_customer returning * into b;
  if not found then raise exception 'not_found'; end if;
  insert into lpr_vip_sync (vip_id, plate, plate_province, action)
  select v.id, v.plate, v.plate_province, case when p_active then 'add' else 'remove' end from vip_plates v where v.customer_id = p_customer;
  perform audit(a, case when p_active then 'bd_enable' else 'bd_disable' end, 'black_diamond', p_customer::text, null);
  return b;
end $$;

create or replace function admin_bd_revoke(p_actor uuid, p_customer uuid) returns void
language plpgsql set search_path = public as $$
declare a staff_users;
begin
  a := staff_require_admin(p_actor);
  if not exists (select 1 from black_diamond where customer_id = p_customer) then raise exception 'not_found'; end if;
  insert into lpr_vip_sync (vip_id, plate, plate_province, action)
  select null, v.plate, v.plate_province, 'remove' from vip_plates v where v.customer_id = p_customer;
  delete from black_diamond where customer_id = p_customer;
  delete from vip_plates where customer_id = p_customer;
  perform audit(a, 'bd_revoke', 'black_diamond', p_customer::text, null);
end $$;

create or replace function admin_bd_add_plate(p_actor uuid, p_customer uuid, p_plate text, p_province text) returns vip_plates
language plpgsql set search_path = public as $$
declare a staff_users; v vip_plates; b black_diamond; pl text := regexp_replace(coalesce(p_plate, ''), '\s', '', 'g');
begin
  a := staff_require_admin(p_actor);
  select * into b from black_diamond where customer_id = p_customer;
  if not found then raise exception 'not_found'; end if;
  if length(pl) < 2 or length(pl) > 12 then raise exception 'invalid_plate'; end if;
  begin
    insert into vip_plates (customer_id, plate, plate_province, created_by) values (p_customer, pl, coalesce(trim(p_province), ''), a.id) returning * into v;
  exception when unique_violation then raise exception 'plate_exists'; end;
  if b.active then insert into lpr_vip_sync (vip_id, plate, plate_province, action) values (v.id, v.plate, v.plate_province, 'add'); end if;
  perform audit(a, 'bd_add_plate', 'black_diamond', p_customer::text, jsonb_build_object('plate', v.plate));
  return v;
end $$;

-- admin_vip_remove (0038) stays: removes one plate and queues its removal
revoke all on function admin_bd_grant(uuid, uuid, text), admin_bd_set_active(uuid, uuid, boolean), admin_bd_revoke(uuid, uuid), admin_bd_add_plate(uuid, uuid, text, text) from public, anon, authenticated;
grant execute on function admin_bd_grant(uuid, uuid, text), admin_bd_set_active(uuid, uuid, boolean), admin_bd_revoke(uuid, uuid), admin_bd_add_plate(uuid, uuid, text, text) to service_role;
grant select, insert, update, delete on black_diamond to service_role;
notify pgrst, 'reload schema';
