-- 0015: the 100-baht returning-customer / referral discount needs
--   * at least member_discount_min_days parking days (default 3), and
--   * the airport shuttle (member_discount_needs_shuttle, default on)
-- so a 1-day booking cannot become free parking. Run after 0014.

alter table settings add column if not exists member_discount_min_days      int     not null default 3;
alter table settings add column if not exists member_discount_needs_shuttle boolean not null default true;

-- preview for the booking page: same rule, when days / shuttle are given
drop function if exists booking_discount(text, text);
create or replace function booking_discount(p_phone text, p_ref_phone text,
  p_days int default null, p_shuttle boolean default null)
returns table (amount int, reason text)
language plpgsql stable set search_path = public as $$
declare
  s settings;
begin
  select * into s from settings where id = 1;
  if coalesce(s.member_discount, 0) <= 0 then return query select 0, null::text; return; end if;
  if p_days is not null and p_days < s.member_discount_min_days then return query select 0, null::text; return; end if;
  if p_shuttle is not null and s.member_discount_needs_shuttle and not p_shuttle then return query select 0, null::text; return; end if;
  if phone_is_member(p_phone) then return query select s.member_discount, 'member'::text; return; end if;
  if norm_phone(p_ref_phone) <> '' and norm_phone(p_ref_phone) <> norm_phone(p_phone)
     and phone_is_member(p_ref_phone) then
    return query select s.member_discount, 'referral'::text; return;
  end if;
  return query select 0, null::text;
end $$;

-- the rule is also enforced on every new booking, whatever path created it
create or replace function bookings_discount_rule_trg() returns trigger
language plpgsql set search_path = public as $$
declare s settings;
begin
  if new.discount_amount <= 0 then return new; end if;
  select * into s from settings where id = 1;
  if (new.end_date - new.start_date + 1) < s.member_discount_min_days
     or (s.member_discount_needs_shuttle and not new.shuttle) then
    new.discount_amount := 0;
    new.discount_reason := null;
    new.referrer_phone := null;
  end if;
  return new;
end $$;

drop trigger if exists bookings_discount_rule on bookings;
create trigger bookings_discount_rule before insert on bookings
  for each row execute function bookings_discount_rule_trg();

create or replace function admin_set_member_discount_rules(p_actor uuid, p_min_days int, p_needs_shuttle boolean)
returns void
language plpgsql set search_path = public as $$
declare a staff_users;
begin
  a := staff_require_admin(p_actor);
  if p_min_days is null or p_min_days < 1 or p_min_days > 60 then raise exception 'invalid_settings'; end if;
  update settings set member_discount_min_days = p_min_days, member_discount_needs_shuttle = coalesce(p_needs_shuttle, true) where id = 1;
  perform audit(a, 'update', 'settings', '1', jsonb_build_object('member_discount_min_days', p_min_days, 'needs_shuttle', p_needs_shuttle));
end $$;

do $$ declare fn text; begin
  foreach fn in array array['booking_discount(text,text,int,boolean)', 'admin_set_member_discount_rules(uuid,int,boolean)'] loop
    execute format('revoke execute on function %s from public', fn);
    if exists (select 1 from pg_roles where rolname = 'anon') then
      execute format('revoke execute on function %s from anon, authenticated', fn);
    end if;
    if exists (select 1 from pg_roles where rolname = 'service_role') then
      execute format('grant execute on function %s to service_role', fn);
    end if;
  end loop;
end $$;

notify pgrst, 'reload schema';
