-- 0060: real pass-by vehicle log from the NVR's own AI plate recognition (not the allow list),
-- pushed in by the on-site bridge, used to check whether self-drive bookings actually showed up.
create table if not exists vehicle_events (
  id                bigint generated always as identity primary key,
  plate             text not null,
  event_time        timestamptz not null,
  channel           int,
  vehicle_color     text,
  vehicle_brand     text,
  vehicle_category  text,
  created_at        timestamptz not null default now(),
  unique (plate, event_time, channel)
);
create index if not exists vehicle_events_plate_idx on vehicle_events (plate);
create index if not exists vehicle_events_event_time_idx on vehicle_events (event_time);
alter table vehicle_events enable row level security;
revoke all on vehicle_events from anon, authenticated;

-- The bridge pushes a batch of newly-seen plate events here. Same (plate, event_time, channel)
-- seen again on a later poll (the bridge's window overlaps on purpose) is silently ignored.
drop function if exists ingest_vehicle_events(jsonb);
create or replace function ingest_vehicle_events(p_events jsonb)
returns int
language plpgsql as $$
declare
  v_count int;
begin
  insert into vehicle_events (plate, event_time, channel, vehicle_color, vehicle_brand, vehicle_category)
  select
    nullif(trim(e->>'plate'), ''),
    (e->>'event_time')::timestamptz,
    nullif(e->>'channel', '')::int,
    nullif(e->>'vehicle_color', ''),
    nullif(e->>'vehicle_brand', ''),
    nullif(e->>'vehicle_category', '')
  from jsonb_array_elements(p_events) e
  where nullif(trim(e->>'plate'), '') is not null and (e->>'event_time') is not null
  on conflict (plate, event_time, channel) do nothing;
  get diagnostics v_count = row_count;
  return v_count;
end;
$$;
revoke all on function ingest_vehicle_events(jsonb) from public, anon, authenticated;
grant execute on function ingest_vehicle_events(jsonb) to service_role;

-- Self-drive bookings (shuttle = false — a shuttle booking's car never enters the lot, so there
-- is nothing to check for those) in [p_start, p_end], with whether a matching plate was seen on
-- the booking's start_date. Plate comparison ignores spaces so "กว 2478" and "กว2478" both match.
drop function if exists booking_arrival_report(date, date);
create or replace function booking_arrival_report(p_start date, p_end date)
returns table (
  booking_id      uuid,
  code            text,
  plate           text,
  start_date      date,
  end_date        date,
  status          booking_status,
  checked_in_at   timestamptz,
  seen            boolean,
  first_seen_at   timestamptz
)
language sql stable as $$
  select
    b.id, b.code, b.plate, b.start_date, b.end_date, b.status, b.checked_in_at,
    exists (
      select 1 from vehicle_events v
      where replace(v.plate, ' ', '') = replace(b.plate, ' ', '')
        and (v.event_time at time zone 'Asia/Bangkok')::date = b.start_date
    ) as seen,
    (
      select min(v.event_time) from vehicle_events v
      where replace(v.plate, ' ', '') = replace(b.plate, ' ', '')
        and (v.event_time at time zone 'Asia/Bangkok')::date = b.start_date
    ) as first_seen_at
  from bookings b
  where not b.shuttle
    and b.status in ('confirmed', 'checked_in', 'checked_out')
    and b.start_date between p_start and p_end
  order by b.start_date, b.plate
$$;
revoke all on function booking_arrival_report(date, date) from public, anon, authenticated;
grant execute on function booking_arrival_report(date, date) to service_role;
