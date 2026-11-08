-- 0018: the admin pages mark unpaid holds as expired on load, so the server key must be able to call expire_holds()
-- (pg_cron also does it every 2 minutes when enabled — see 0002)
do $$ begin
  if exists (select 1 from pg_roles where rolname = 'service_role') then
    grant execute on function expire_holds() to service_role;
  end if;
end $$;
