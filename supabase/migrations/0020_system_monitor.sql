-- 0020: system monitor for the admin "สถานะระบบ" page
--   system_events : things that went wrong (LINE push failed, slip service errors ...) + slip checks used
--   uptime_pings  : every 5 minutes Supabase (pg_cron + pg_net) calls /api/cron/monitor on Vercel;
--                   the answer (or no answer) is kept here, so the page shows when the website was down
--   system_status : the latest result of every check, written by /api/cron/monitor
-- After running this file, start the schedule once (needs pg_cron and pg_net enabled):
--   select monitor_schedule('https://<your domain>', '<CRON_SECRET>');
-- Run after 0019.

create table if not exists system_events (
  id      bigserial primary key,
  at      timestamptz not null default now(),
  kind    text not null,             -- 'line' | 'slip' | 'cron' | 'monitor' ...
  level   text not null default 'info' check (level in ('info', 'warn', 'error')),
  message text not null,
  detail  jsonb
);
create index if not exists system_events_at_idx on system_events (at desc);
create index if not exists system_events_kind_idx on system_events (kind, at desc);
alter table system_events enable row level security;

create table if not exists uptime_pings (
  id         bigserial primary key,
  at         timestamptz not null default now(),
  request_id bigint,
  status     int,
  ms         int,
  ok         boolean,
  error      text,
  done       boolean not null default false
);
create index if not exists uptime_pings_at_idx on uptime_pings (at desc);
alter table uptime_pings enable row level security;

create table if not exists system_status (
  key        text primary key,
  level      text not null,            -- 'ok' | 'warn' | 'error'
  summary    text not null,
  detail     jsonb,
  checked_at timestamptz not null default now(),
  changed_at timestamptz not null default now()
);
alter table system_status enable row level security;

-- read the answers pg_net received for earlier pings
create or replace function uptime_collect() returns int
language plpgsql security definer set search_path = public as $$
declare n int := 0;
begin
  if to_regclass('net._http_response') is null then return 0; end if;
  execute $q$
    update public.uptime_pings p set
      status = r.status_code,
      ms = greatest(0, (extract(epoch from (r.created - p.at)) * 1000)::int),
      ok = (r.status_code between 200 and 299) and not coalesce(r.timed_out, false),
      error = case when r.timed_out then 'timeout' else left(r.error_msg, 300) end,
      done = true
    from net._http_response r
    where r.id = p.request_id and not p.done
  $q$;
  get diagnostics n = row_count;
  -- no answer after 2 minutes: count as down
  update uptime_pings set ok = false, error = coalesce(error, 'no response'), done = true
  where not done and at < now() - interval '2 minutes';
  delete from uptime_pings where at < now() - interval '30 days';
  delete from system_events where at < now() - interval '90 days';
  return n;
end $$;

-- start (or restart) the 5-minute schedule
create or replace function monitor_schedule(p_base_url text, p_secret text) returns text
language plpgsql security definer set search_path = public as $$
begin
  if to_regnamespace('cron') is null or to_regnamespace('net') is null then
    raise exception 'enable the pg_cron and pg_net extensions first (Database > Extensions)';
  end if;
  perform cron.unschedule(jobid) from cron.job where jobname = 'backyard_monitor';
  perform cron.schedule('backyard_monitor', '*/5 * * * *', format($job$
    select public.uptime_collect();
    insert into public.uptime_pings (request_id)
    select net.http_get(url := %L, headers := jsonb_build_object('Authorization', %L), timeout_milliseconds := 15000);
  $job$, rtrim(p_base_url, '/') || '/api/cron/monitor', 'Bearer ' || p_secret));
  return 'scheduled every 5 minutes';
end $$;

-- database facts for the page
create or replace function monitor_db_stats()
returns table (db_bytes bigint, bookings bigint, customers bigint, pending_overdue bigint, cron_jobs jsonb)
language plpgsql stable security definer set search_path = public as $$
declare jobs jsonb := '[]'::jsonb;
begin
  if to_regclass('cron.job') is not null then
    execute $q$
      select coalesce(jsonb_agg(jsonb_build_object(
        'name', j.jobname, 'schedule', j.schedule, 'active', j.active,
        'last_run', (select max(d.start_time) from cron.job_run_details d where d.jobid = j.jobid),
        'last_status', (select d.status from cron.job_run_details d where d.jobid = j.jobid order by d.start_time desc limit 1),
        'last_error', (select left(d.return_message, 200) from cron.job_run_details d where d.jobid = j.jobid and d.status <> 'succeeded' order by d.start_time desc limit 1)
      ) order by j.jobname), '[]'::jsonb) from cron.job j
    $q$ into jobs;
  end if;
  return query select pg_database_size(current_database()),
    (select count(*) from bookings), (select count(*) from customers),
    (select count(*) from bookings where status = 'pending_payment' and hold_expires_at < now() - interval '10 minutes'),
    jobs;
end $$;

do $$ declare fn text; begin
  foreach fn in array array['uptime_collect()', 'monitor_schedule(text,text)', 'monitor_db_stats()'] loop
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
