-- 0053: late-night arrival / early-morning return = that parking day is HALF price (was: free in 0052).
-- Works whether or not 0052 has been run. The API still passes the number of such days in p_free_days
-- (the parameter name is kept so the functions from 0052 stay as they are); only the charge changes.
--   parking_amount = (days - n) x price_per_day + n x round(price_per_day / 2)

do $$ begin
  if exists (select 1 from information_schema.columns where table_name = 'bookings' and column_name = 'free_days') then
    alter table bookings rename column free_days to half_days;
  end if;
end $$;
alter table bookings add column if not exists half_days int not null default 0 check (half_days >= 0);
comment on column bookings.half_days is 'parking days charged at half price (late-night arrival / early return)';

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
  new.parking_amount := (v_days - v_half) * s.price_per_day + v_half * round(s.price_per_day / 2.0)::int;
  v_gross := new.parking_amount + new.shuttle_amount;
  new.discount_amount := least(new.discount_amount, v_gross);
  if new.discount_amount = 0 then new.discount_reason := null; new.referrer_phone := null; end if;
  new.coupon_amount := least(new.coupon_amount, v_gross - new.discount_amount);
  return new;
end $$;
