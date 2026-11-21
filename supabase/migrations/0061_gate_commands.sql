-- =====================================================================
-- Backyard: emergency barrier-open button on /ops (0061)
--
-- For when a plate is missed by the reader (faded plate etc.) and there's no
-- one at the lot with the handheld remote. Staff presses "เปิดไม้กั้น" on /ops;
-- this just records the request here. The on-site bridge (same program that
-- syncs the plate allow-list) polls gate_commands fast and fires the camera's
-- strobe output for the chosen barrier (IN or OUT), then reports back so a
-- command is never fired twice. Nothing in this migration talks to the camera
-- directly — it only queues/logs the request.
-- =====================================================================

create table if not exists gate_commands (
  id                bigserial primary key,
  which             text not null check (which in ('in', 'out')),
  requested_by      uuid not null references staff_users(id),
  requested_by_name text not null,
  note              text,
  requested_at      timestamptz not null default now(),
  fired_at          timestamptz,
  result            text check (result in ('ok', 'error')),
  error             text
);
-- the bridge's poll query filters on this; keep it cheap even as the table grows
create index if not exists gate_commands_pending_idx on gate_commands (requested_at) where fired_at is null;

alter table gate_commands enable row level security;
revoke all on gate_commands from anon, authenticated;
grant all on gate_commands to service_role;

create or replace function request_gate_open(p_actor uuid, p_which text, p_note text default null)
returns bigint language plpgsql set search_path = public as $$
declare a staff_users; new_id bigint;
begin
  a := staff_actor(p_actor);
  if p_which not in ('in', 'out') then raise exception 'invalid_which'; end if;
  insert into gate_commands (which, requested_by, requested_by_name, note)
  values (p_which, a.id, a.display_name, p_note)
  returning id into new_id;
  perform audit(a, 'gate_open_request', 'gate', p_which, jsonb_build_object('note', p_note));
  return new_id;
end $$;

revoke all on function request_gate_open(uuid, text, text) from public, anon, authenticated;
grant execute on function request_gate_open(uuid, text, text) to service_role;
