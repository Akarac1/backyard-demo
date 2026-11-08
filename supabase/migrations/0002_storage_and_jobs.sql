-- Backyard: storage bucket for slips + scheduled job to release unpaid holds.
-- Run after 0001_init.sql (Supabase SQL Editor).

-- Private bucket for slip images (only the service role reads/writes it).
insert into storage.buckets (id, name, public)
values ('slips', 'slips', false)
on conflict (id) do nothing;

-- Release holds that were not paid in time, every 2 minutes.
-- Needs the pg_cron extension: Database > Extensions > pg_cron (enable), then run this block.
do $$
begin
  if exists (select 1 from pg_extension where extname = 'pg_cron') then
    perform cron.unschedule(jobid) from cron.job where jobname = 'backyard_expire_holds';
    perform cron.schedule('backyard_expire_holds', '*/2 * * * *', 'select public.expire_holds()');
  else
    raise notice 'pg_cron not enabled: holds are still checked on every booking, but enable pg_cron to mark them expired';
  end if;
end $$;
