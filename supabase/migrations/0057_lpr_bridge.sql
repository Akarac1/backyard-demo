-- 0057: status of the on-site bridge that syncs plates into the NVR.
-- One row (id = 1). The bridge reports after every run; /admin and the monitor read it.
create table if not exists lpr_bridge_status (
  id            int primary key check (id = 1),
  last_seen     timestamptz,
  last_ok       boolean,
  last_error    text,
  last_summary  jsonb,
  last_ok_at    timestamptz
);
insert into lpr_bridge_status (id) values (1) on conflict do nothing;
alter table lpr_bridge_status enable row level security;
revoke all on lpr_bridge_status from anon, authenticated;
