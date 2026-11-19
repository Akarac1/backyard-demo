-- 0054: the late-night rule is set by the admin (Settings > Price): on/off, the two times, and the share of
-- the day price still charged (50 = half). Run after 0053. Existing bookings are never recalculated.
alter table settings add column if not exists late_night_enabled boolean not null default true;
alter table settings add column if not exists late_arrival_from text not null default '22:00' check (late_arrival_from ~ '^([01][0-9]|2[0-3]):[0-5][0-9]$');
alter table settings add column if not exists early_return_by text not null default '02:00' check (early_return_by ~ '^([01][0-9]|2[0-3]):[0-5][0-9]$');
alter table settings add column if not exists late_night_percent int not null default 50 check (late_night_percent between 0 and 100);

create or replace function bookings_free_days_trg() returns trigger
language plpgsql set search_path = public as $$
declare
  s settings;
  v_half int := coalesce(nullif(current_setting('backyard.free_days', true), ''), '0')::int;
  v_days int := new.end_date - new.start_date + 1;
  v_gross int;
begin
  if v_half <= 0 then return new; end if;
  select * into s from settings where id = 1;
  v_half := least(v_half, v_days);
  new.half_days := v_half;
  new.parking_amount := (v_days - v_half) * s.price_per_day + v_half * round(s.price_per_day * s.late_night_percent / 100.0)::int;
  v_gross := new.parking_amount + new.shuttle_amount;
  new.discount_amount := least(new.discount_amount, v_gross);
  if new.discount_amount = 0 then new.discount_reason := null; new.referrer_phone := null; end if;
  new.coupon_amount := least(new.coupon_amount, v_gross - new.discount_amount);
  return new;
end $$;

-- error: invalid_late_night_rule | not_allowed
create or replace function admin_set_late_night_rule(p_actor uuid, p_enabled boolean, p_arrival text, p_return text, p_percent int)
returns settings
language plpgsql set search_path = public as $$
declare a staff_users; s settings; v_before settings;
begin
  a := staff_require_admin(p_actor);
  if coalesce(p_arrival, '') !~ '^([01][0-9]|2[0-3]):[0-5][0-9]$' or coalesce(p_return, '') !~ '^([01][0-9]|2[0-3]):[0-5][0-9]$'
     or coalesce(p_percent, -1) not between 0 and 100 then
    raise exception 'invalid_late_night_rule';
  end if;
  select * into v_before from settings where id = 1;
  update settings set late_night_enabled = coalesce(p_enabled, false), late_arrival_from = p_arrival,
    early_return_by = p_return, late_night_percent = p_percent where id = 1 returning * into s;
  perform audit(a, 'late_night_rule', 'settings', '1', jsonb_build_object(
    'before', jsonb_build_object('enabled', v_before.late_night_enabled, 'arrival', v_before.late_arrival_from, 'return', v_before.early_return_by, 'percent', v_before.late_night_percent),
    'after', jsonb_build_object('enabled', s.late_night_enabled, 'arrival', s.late_arrival_from, 'return', s.early_return_by, 'percent', s.late_night_percent)));
  return s;
end $$;
revoke all on function admin_set_late_night_rule(uuid, boolean, text, text, int) from public, anon, authenticated;
grant execute on function admin_set_late_night_rule(uuid, boolean, text, text, int) to service_role;
