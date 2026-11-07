-- =====================================================================
-- Backyard Parking — Supabase schema v1
-- ที่จอดรถรายวันใกล้สุวรรณภูมิ 60 ช่อง + รถรับส่งไป-กลับ 2 คัน
--
-- รันใน Supabase: SQL Editor > วางทั้งไฟล์ > Run
-- หรือ supabase CLI: supabase db push
--
-- หลักการ:
--  - ตรรกะสำคัญ (ตัดที่จอด, เลื่อนจอง, จัดรถ) อยู่ในฟังก์ชัน Postgres
--    ใช้ advisory lock กันจองช่องสุดท้ายพร้อมกัน
--  - ทุกตารางเปิด RLS และไม่มี policy = เข้าได้เฉพาะ service_role
--    (API บน Vercel ใช้ SUPABASE_SERVICE_ROLE_KEY ฝั่ง server เท่านั้น)
--  - วันที่ทั้งหมดคิดตามเวลาไทย (Asia/Bangkok)
-- =====================================================================

create extension if not exists pgcrypto;

-- ---------------------------------------------------------------------
-- Enums
-- ---------------------------------------------------------------------
create type booking_status as enum (
  'pending_payment', 'confirmed', 'checked_in', 'checked_out',
  'cancelled', 'expired', 'no_show'
);
create type trip_direction as enum ('to_airport', 'from_airport');
create type trip_status    as enum ('unassigned', 'assigned', 'en_route', 'picked_up', 'done', 'cancelled');
create type payment_status as enum ('pending', 'verified', 'rejected');
create type payment_kind   as enum ('booking', 'reschedule_extra', 'overstay');
create type flight_type    as enum ('domestic', 'international');

-- ---------------------------------------------------------------------
-- Settings (แถวเดียว แก้จาก dashboard แอดมิน)
-- ---------------------------------------------------------------------
create table settings (
  id                          int primary key default 1 check (id = 1),
  total_spots                 int  not null default 60,
  reserve_spots               int  not null default 5,    -- เก็บไว้ให้รถจอดเกิน/เพิ่มวัน
  price_per_day               int  not null default 100,
  extra_price_per_day         int  not null default 120,  -- วันที่เกินหรือเพิ่มตอนเลื่อน
  shuttle_price               int  not null default 300,  -- ไป-กลับ ต่อการจอง
  shuttle_max_pax             int  not null default 7,
  trip_minutes                int  not null default 40,   -- 15 ไป + 15 กลับ + เผื่อ 10
  hold_minutes                int  not null default 15,   -- กันที่ไว้ระหว่างรอจ่าย
  reschedule_min_days         int  not null default 7,    -- ต้องเลื่อนล่วงหน้ากี่วัน
  exit_minutes_domestic       int  not null default 30,   -- เวลาลงเครื่องถึงออกโถง
  exit_minutes_international  int  not null default 60,
  pickup_meeting_point        text not null default 'ชั้น 2 ประตู 4',
  reserve_alert_below         int  not null default 2,
  updated_at                  timestamptz not null default now()
);
insert into settings default values;

-- ---------------------------------------------------------------------
-- People & vehicles
-- ---------------------------------------------------------------------
create table customers (
  id            uuid primary key default gen_random_uuid(),
  line_user_id  text unique not null,
  name          text not null,
  phone         text not null,
  created_at    timestamptz not null default now()
);

create table drivers (
  id            uuid primary key default gen_random_uuid(),
  line_user_id  text unique,
  name          text not null,
  phone         text,
  active        boolean not null default true,
  created_at    timestamptz not null default now()
);

create table vehicles (
  id         uuid primary key default gen_random_uuid(),
  name       text not null,
  seats      int  not null check (seats > 0),
  driver_id  uuid references drivers(id),
  active     boolean not null default true
);
insert into vehicles (name, seats) values ('คันที่ 1', 2), ('คันที่ 2', 7);

-- ---------------------------------------------------------------------
-- Bookings
-- ---------------------------------------------------------------------
create table bookings (
  id                   uuid primary key default gen_random_uuid(),
  code                 text unique not null default upper(substr(encode(gen_random_bytes(4), 'hex'), 1, 6)),
  customer_id          uuid not null references customers(id),
  plate                text not null,
  plate_province       text not null,
  start_date           date not null,
  end_date             date not null,
  days                 int  generated always as (end_date - start_date + 1) stored,
  parking_amount       int  not null,
  shuttle              boolean not null default false,
  pax                  int  check (pax between 1 and 7),
  shuttle_amount       int  not null default 0,
  total_amount         int  generated always as (parking_amount + shuttle_amount) stored,
  extra_amount_due     int  not null default 0,   -- ค่าเพิ่มวันตอนเลื่อนที่ยังไม่จ่าย
  status               booking_status not null default 'pending_payment',
  hold_expires_at      timestamptz,
  booked_at            timestamptz not null default now(),
  rescheduled_at       timestamptz,               -- ไม่ null = ใช้สิทธิ์เลื่อนแล้ว
  original_start_date  date,
  original_end_date    date,
  checked_in_at        timestamptz,
  checked_out_at       timestamptz,
  created_at           timestamptz not null default now(),
  updated_at           timestamptz not null default now(),
  check (end_date >= start_date),
  check (not shuttle or pax is not null)
);
create index bookings_active_range_idx on bookings (start_date, end_date)
  where status in ('pending_payment', 'confirmed', 'checked_in');
create index bookings_plate_idx on bookings (plate);

create table payments (
  id           uuid primary key default gen_random_uuid(),
  booking_id   uuid not null references bookings(id) on delete cascade,
  kind         payment_kind not null,
  amount       int not null check (amount > 0),
  slip_path    text,                 -- path ใน Supabase Storage bucket "slips"
  status       payment_status not null default 'pending',
  verified_by  text,
  paid_at      timestamptz,
  created_at   timestamptz not null default now()
);
create index payments_pending_idx on payments (created_at) where status = 'pending';

-- ---------------------------------------------------------------------
-- Flights & shuttle
-- ---------------------------------------------------------------------
create table flights (
  id                 uuid primary key default gen_random_uuid(),
  flight_number      text not null,
  flight_date        date not null,
  direction          text not null check (direction in ('departure', 'arrival')),
  operating_airline  text,           -- IATA ของสายที่บินจริง (codeshare)
  flight_type        flight_type,
  scheduled_at       timestamptz,
  estimated_at       timestamptz,
  actual_at          timestamptz,
  status             text,
  check_in_desk      text,
  last_polled_at     timestamptz,
  unique (flight_number, flight_date, direction)
);

create table shuttle_trips (
  id                 uuid primary key default gen_random_uuid(),
  booking_id         uuid not null references bookings(id) on delete cascade,
  direction          trip_direction not null,
  pax                int not null check (pax between 1 and 7),
  flight_number      text,           -- ที่ลูกค้ากรอก
  flight_date        date,
  flight_id          uuid references flights(id),
  customer_time      timestamptz,    -- เวลาที่ลูกค้ากรอกเอง (ไม่มีไฟลต์)
  pickup_at          timestamptz,    -- เวลารับที่คำนวณแล้ว
  vehicle_id         uuid references vehicles(id),
  assignment_locked  boolean not null default false,  -- แอดมินล็อกไว้ ระบบไม่ย้าย
  drop_door          text,           -- ประตูส่งชั้น 4 (ขาไป)
  status             trip_status not null default 'unassigned',
  created_at         timestamptz not null default now(),
  updated_at         timestamptz not null default now(),
  unique (booking_id, direction)
);
create index shuttle_trips_vehicle_time_idx on shuttle_trips (vehicle_id, pickup_at)
  where status not in ('done', 'cancelled');

create table airline_checkin (
  airline_iata  text not null,
  flight_type   flight_type not null,
  checkin_rows  text not null,
  door          text not null,
  note          text,
  updated_at    timestamptz not null default now(),
  primary key (airline_iata, flight_type)
);
-- seed จากแหล่งที่ค้นได้ (พ.ย. 2026) ให้คนขับยืนยันหน้างาน
insert into airline_checkin (airline_iata, flight_type, checkin_rows, door, note) values
  ('TG', 'domestic',      'C',   '2',   'การบินไทย ในประเทศ — ยืนยันประตู'),
  ('TG', 'international', 'H/J', '4-5', 'การบินไทย ต่างประเทศ ชั้นประหยัด'),
  ('PG', 'domestic',      'D',   '3',   'Bangkok Airways'),
  ('PG', 'international', 'D',   '3',   'Bangkok Airways'),
  ('TR', 'international', 'K',   '5',   'Scoot'),
  ('NH', 'international', 'L',   '7',   'ANA แนะนำประตู 7'),
  ('QR', 'international', 'Q',   '8',   'Qatar Airways'),
  ('KE', 'international', 'U',   '10',  'Korean Air'),
  ('6E', 'international', 'W',   '10',  'IndiGo');

-- ---------------------------------------------------------------------
-- Plate reader (LPR)
-- ---------------------------------------------------------------------
create table lpr_sync (
  id              bigserial primary key,
  booking_id      uuid not null references bookings(id) on delete cascade,
  plate           text not null,
  plate_province  text not null,
  action          text not null check (action in ('add', 'remove')),
  valid_from      date,
  valid_to        date,
  status          text not null default 'pending' check (status in ('pending', 'done', 'failed')),
  attempts        int  not null default 0,
  last_error      text,
  created_at      timestamptz not null default now(),
  done_at         timestamptz
);
create index lpr_sync_pending_idx on lpr_sync (created_at) where status <> 'done';

create table lpr_events (
  id          bigserial primary key,
  plate       text not null,
  direction   text not null check (direction in ('in', 'out')),
  event_at    timestamptz not null,
  booking_id  uuid references bookings(id),
  image_url   text,
  raw         jsonb,
  created_at  timestamptz not null default now()
);

-- =====================================================================
-- Helpers
-- =====================================================================
create or replace function today_bkk() returns date
language sql stable as $$
  select (now() at time zone 'Asia/Bangkok')::date
$$;

create or replace function set_updated_at() returns trigger
language plpgsql as $$
begin
  new.updated_at := now();
  return new;
end $$;

create trigger bookings_updated_at      before update on bookings      for each row execute function set_updated_at();
create trigger shuttle_trips_updated_at before update on shuttle_trips for each row execute function set_updated_at();
create trigger settings_updated_at      before update on settings      for each row execute function set_updated_at();

-- จำนวนช่องที่ใช้ในวันหนึ่ง
-- นับ: ยืนยันแล้ว + เข้าลานแล้ว + รอจ่ายที่ยังไม่หมดเวลา
-- รถที่ยังไม่ออกทั้งที่เลยวันจองแล้ว นับเฉพาะวันนี้
create or replace function spots_used(p_day date, p_exclude uuid default null) returns int
language sql stable as $$
  select count(*)::int
  from bookings b
  where b.id is distinct from p_exclude
    and (
      ( p_day between b.start_date and b.end_date
        and ( b.status in ('confirmed', 'checked_in')
              or (b.status = 'pending_payment' and b.hold_expires_at > now()) ) )
      or
      ( b.status = 'checked_in' and b.end_date < p_day and p_day = today_bkk() )
    )
$$;

-- ที่ว่างรายวันสำหรับการจองล่วงหน้า (หักช่องสำรองแล้ว)
create or replace function check_availability(p_start date, p_end date, p_exclude uuid default null)
returns table (day date, used int, cap int, available boolean)
language sql stable as $$
  select d::date,
         spots_used(d::date, p_exclude),
         s.total_spots - s.reserve_spots,
         spots_used(d::date, p_exclude) < s.total_spots - s.reserve_spots
  from settings s,
       generate_series(p_start, p_end, interval '1 day') d
  where s.id = 1
  order by 1
$$;

create or replace view v_occupancy_30d as
select d::date                                  as day,
       spots_used(d::date)                      as used,
       s.total_spots,
       s.reserve_spots,
       s.total_spots - spots_used(d::date)      as free_total
from settings s,
     generate_series(today_bkk(), today_bkk() + 29, interval '1 day') d
where s.id = 1;

-- =====================================================================
-- create_booking: จองใหม่ กันที่ไว้ hold_minutes นาที รอจ่ายเงิน
-- error: start_date_in_past | invalid_range | invalid_pax | full:<วันที่>
-- =====================================================================
create or replace function create_booking(
  p_line_user_id      text,
  p_name              text,
  p_phone             text,
  p_plate             text,
  p_province          text,
  p_start             date,
  p_end               date,
  p_shuttle           boolean     default false,
  p_pax               int         default null,
  p_outbound_flight   text        default null,
  p_outbound_time     timestamptz default null,   -- เวลามาถึงลาน
  p_return_flight     text        default null,
  p_return_time       timestamptz default null    -- ใช้เมื่อไม่มีเลขไฟลต์
) returns bookings
language plpgsql as $$
declare
  s          settings;
  v_customer uuid;
  v_full     date;
  b          bookings;
begin
  select * into s from settings where id = 1;

  if p_start < today_bkk() then raise exception 'start_date_in_past'; end if;
  if p_end < p_start       then raise exception 'invalid_range'; end if;
  if p_shuttle and (p_pax is null or p_pax < 1 or p_pax > s.shuttle_max_pax) then
    raise exception 'invalid_pax';
  end if;

  perform pg_advisory_xact_lock(hashtext('backyard_booking'));

  select a.day into v_full
  from check_availability(p_start, p_end) a
  where not a.available
  order by a.day limit 1;
  if v_full is not null then raise exception 'full:%', v_full; end if;

  insert into customers (line_user_id, name, phone)
  values (p_line_user_id, p_name, p_phone)
  on conflict (line_user_id) do update set name = excluded.name, phone = excluded.phone
  returning id into v_customer;

  insert into bookings (customer_id, plate, plate_province, start_date, end_date,
                        parking_amount, shuttle, pax, shuttle_amount, hold_expires_at)
  values (v_customer,
          upper(regexp_replace(p_plate, '\s+', '', 'g')),
          p_province, p_start, p_end,
          (p_end - p_start + 1) * s.price_per_day,
          p_shuttle,
          case when p_shuttle then p_pax end,
          case when p_shuttle then s.shuttle_price else 0 end,
          now() + make_interval(mins => s.hold_minutes))
  returning * into b;

  if p_shuttle then
    insert into shuttle_trips (booking_id, direction, pax, flight_number, flight_date, customer_time, pickup_at)
    values (b.id, 'to_airport',   p_pax, nullif(upper(p_outbound_flight), ''), p_start, p_outbound_time, p_outbound_time),
           (b.id, 'from_airport', p_pax, nullif(upper(p_return_flight), ''),   p_end,   p_return_time,   p_return_time);
  end if;

  insert into payments (booking_id, kind, amount) values (b.id, 'booking', b.total_amount);

  return b;
end $$;

-- =====================================================================
-- confirm_payment: แอดมิน (หรือระบบตรวจสลิป) ยืนยันการจ่าย
-- ถ้าจ่ายหลังหมดเวลากันที่ จะเช็กที่ว่างอีกรอบ
-- =====================================================================
create or replace function confirm_payment(p_payment_id uuid, p_verified_by text) returns bookings
language plpgsql as $$
declare
  p      payments;
  b      bookings;
  v_full date;
begin
  perform pg_advisory_xact_lock(hashtext('backyard_booking'));

  select * into p from payments where id = p_payment_id for update;
  if not found then raise exception 'payment_not_found'; end if;
  if p.status <> 'pending' then raise exception 'payment_not_pending'; end if;

  select * into b from bookings where id = p.booking_id for update;

  if p.kind = 'booking' then
    if b.status not in ('pending_payment', 'expired') then raise exception 'booking_not_awaiting_payment'; end if;
    if b.status = 'expired' or b.hold_expires_at <= now() then
      select a.day into v_full
      from check_availability(b.start_date, b.end_date, b.id) a
      where not a.available order by a.day limit 1;
      if v_full is not null then raise exception 'full_after_hold_expired:%', v_full; end if;
    end if;
    update bookings set status = 'confirmed', hold_expires_at = null
    where id = b.id returning * into b;
  elsif p.kind = 'reschedule_extra' then
    update bookings set extra_amount_due = greatest(0, extra_amount_due - p.amount)
    where id = b.id returning * into b;
  end if;

  update payments set status = 'verified', verified_by = p_verified_by, paid_at = now()
  where id = p.id;

  return b;
end $$;

-- =====================================================================
-- expire_holds: เรียกทุก 1-5 นาทีจาก n8n หรือ pg_cron
-- =====================================================================
create or replace function expire_holds() returns int
language plpgsql as $$
declare n int;
begin
  update bookings set status = 'expired'
  where status = 'pending_payment' and hold_expires_at <= now();
  get diagnostics n = row_count;
  return n;
end $$;

-- =====================================================================
-- reschedule_booking: เลื่อนได้ 1 ครั้งต่อการจอง
--  - ต้องเลื่อนก่อนวันเข้าเดิมอย่างน้อย reschedule_min_days วัน
--  - วันใหม่ต้องไม่เกิน 1 ปีนับจากวันที่กดจอง
--  - วันเพิ่ม: คิดวันละ extra_price_per_day / วันลด: ไม่คืนเงิน
-- error: booking_not_found | not_confirmed | already_rescheduled | too_late
--        | start_date_in_past | invalid_range | beyond_one_year | full:<วันที่>
-- =====================================================================
create or replace function reschedule_booking(p_booking_id uuid, p_new_start date, p_new_end date)
returns bookings
language plpgsql as $$
declare
  s        settings;
  b        bookings;
  v_full   date;
  v_extra  int;
begin
  select * into s from settings where id = 1;
  perform pg_advisory_xact_lock(hashtext('backyard_booking'));

  select * into b from bookings where id = p_booking_id for update;
  if not found then raise exception 'booking_not_found'; end if;
  if b.status <> 'confirmed'         then raise exception 'not_confirmed'; end if;
  if b.rescheduled_at is not null    then raise exception 'already_rescheduled'; end if;
  if today_bkk() > b.start_date - s.reschedule_min_days then raise exception 'too_late'; end if;
  if p_new_start < today_bkk()       then raise exception 'start_date_in_past'; end if;
  if p_new_end < p_new_start         then raise exception 'invalid_range'; end if;
  if p_new_end > ((b.booked_at at time zone 'Asia/Bangkok') + interval '1 year')::date then
    raise exception 'beyond_one_year';
  end if;

  select a.day into v_full
  from check_availability(p_new_start, p_new_end, b.id) a
  where not a.available order by a.day limit 1;
  if v_full is not null then raise exception 'full:%', v_full; end if;

  v_extra := greatest(0, (p_new_end - p_new_start + 1) - b.days) * s.extra_price_per_day;

  update bookings
  set original_start_date = start_date,
      original_end_date   = end_date,
      start_date          = p_new_start,
      end_date            = p_new_end,
      rescheduled_at      = now(),
      extra_amount_due    = v_extra
  where id = b.id
  returning * into b;

  -- เที่ยวรถเดิมใช้ไม่ได้แล้ว ให้ลูกค้ากรอกไฟลต์/เวลาใหม่ แล้วจัดรถใหม่
  update shuttle_trips
  set flight_date   = case direction when 'to_airport' then p_new_start else p_new_end end,
      flight_number = null, flight_id = null, customer_time = null, pickup_at = null,
      vehicle_id    = null, assignment_locked = false, drop_door = null, status = 'unassigned'
  where booking_id = b.id and status not in ('done', 'cancelled');

  if v_extra > 0 then
    insert into payments (booking_id, kind, amount) values (b.id, 'reschedule_extra', v_extra);
  end if;

  return b;
end $$;

-- =====================================================================
-- assign_vehicle: เลือกรถคันเล็กที่สุดที่นั่งพอและว่างในช่วงเวลานั้น
-- คืน vehicle_id หรือ null (ไม่มีรถว่าง -> แจ้งแอดมิน)
-- =====================================================================
create or replace function assign_vehicle(p_trip_id uuid) returns uuid
language plpgsql as $$
declare
  s    settings;
  t    shuttle_trips;
  vid  uuid;
  win  interval;
begin
  select * into s from settings where id = 1;
  win := make_interval(mins => s.trip_minutes);
  perform pg_advisory_xact_lock(hashtext('backyard_shuttle'));

  select * into t from shuttle_trips where id = p_trip_id for update;
  if not found then raise exception 'trip_not_found'; end if;
  if t.assignment_locked then return t.vehicle_id; end if;
  if t.pickup_at is null then raise exception 'no_pickup_time'; end if;

  select v.id into vid
  from vehicles v
  where v.active
    and v.seats >= t.pax
    and not exists (
      select 1 from shuttle_trips o
      where o.vehicle_id = v.id
        and o.id <> t.id
        and o.status not in ('done', 'cancelled')
        and o.pickup_at is not null
        and o.pickup_at < t.pickup_at + win
        and t.pickup_at < o.pickup_at + win
    )
  order by v.seats asc
  limit 1;

  update shuttle_trips
  set vehicle_id = vid,
      status     = case when vid is null then 'unassigned'::trip_status else 'assigned'::trip_status end
  where id = t.id;

  return vid;
end $$;

-- =====================================================================
-- LPR sync queue: สร้างงานเพิ่ม/ลบทะเบียนอัตโนมัติเมื่อสถานะเปลี่ยน
-- เฟสแรกแอดมินทำตามคิวนี้เอง พอมี API ให้ n8n ดึงคิวไปทำ
-- =====================================================================
create or replace function enqueue_lpr_sync() returns trigger
language plpgsql as $$
begin
  if new.status = 'confirmed' and old.status in ('pending_payment', 'expired') then
    insert into lpr_sync (booking_id, plate, plate_province, action, valid_from, valid_to)
    values (new.id, new.plate, new.plate_province, 'add', new.start_date, new.end_date);

  elsif new.status = 'confirmed' and old.status = 'confirmed'
        and (new.start_date, new.end_date) is distinct from (old.start_date, old.end_date) then
    insert into lpr_sync (booking_id, plate, plate_province, action, valid_from, valid_to)
    values (new.id, old.plate, old.plate_province, 'remove', old.start_date, old.end_date),
           (new.id, new.plate, new.plate_province, 'add',    new.start_date, new.end_date);

  elsif new.status in ('cancelled', 'no_show') and old.status = 'confirmed' then
    insert into lpr_sync (booking_id, plate, plate_province, action, valid_from, valid_to)
    values (new.id, old.plate, old.plate_province, 'remove', old.start_date, old.end_date);
  end if;
  return new;
end $$;

create trigger bookings_lpr_sync
after update of status, start_date, end_date on bookings
for each row execute function enqueue_lpr_sync();

-- =====================================================================
-- Security: RLS เปิดทุกตาราง ไม่มี policy (service_role เท่านั้น)
-- และไม่ให้ anon/authenticated เรียกฟังก์ชันตรง ๆ
-- =====================================================================
alter table settings        enable row level security;
alter table customers       enable row level security;
alter table drivers         enable row level security;
alter table vehicles        enable row level security;
alter table bookings        enable row level security;
alter table payments        enable row level security;
alter table flights         enable row level security;
alter table shuttle_trips   enable row level security;
alter table airline_checkin enable row level security;
alter table lpr_sync        enable row level security;
alter table lpr_events      enable row level security;

do $$
declare
  fn text;
begin
  foreach fn in array array[
    'create_booking(text,text,text,text,text,date,date,boolean,int,text,timestamptz,text,timestamptz)',
    'confirm_payment(uuid,text)',
    'expire_holds()',
    'reschedule_booking(uuid,date,date)',
    'assign_vehicle(uuid)',
    'check_availability(date,date,uuid)',
    'spots_used(date,uuid)'
  ] loop
    execute format('revoke execute on function %s from public', fn);
    if exists (select 1 from pg_roles where rolname = 'anon') then
      execute format('revoke execute on function %s from anon, authenticated', fn);
    end if;
  end loop;
  if exists (select 1 from pg_roles where rolname = 'anon') then
    revoke all on v_occupancy_30d from anon, authenticated;
  end if;
end $$;
