-- =====================================================================
-- Backyard: booking codes that never clash
-- Run after 0001–0003. Safe to re-run. Existing codes are not changed.
--
-- Before: 6 random hex characters (about 16 million codes). With a few thousand
-- bookings two could get the same code and the second booking would fail.
-- Now: 6 characters from 31 easy-to-read letters and digits (no 0/O, 1/I/L),
-- about 887 million codes, and the function picks again if the code is taken.
-- =====================================================================

create or replace function gen_booking_code() returns text
language plpgsql volatile
set search_path = public, extensions
as $$
declare
  alphabet constant text := 'ABCDEFGHJKMNPQRSTUVWXYZ23456789';
  c text;
begin
  loop
    select string_agg(substr(alphabet, 1 + (get_byte(b, i) % length(alphabet)), 1), '' order by i)
      into c
      from (select gen_random_bytes(6) as b) r, generate_series(0, 5) i;
    exit when not exists (select 1 from bookings where code = c);
  end loop;
  return c;
end $$;

alter table bookings alter column code set default gen_booking_code();

revoke execute on function gen_booking_code() from public;
do $$ begin
  if exists (select 1 from pg_roles where rolname = 'anon') then
    revoke execute on function gen_booking_code() from anon, authenticated;
  end if;
end $$;
