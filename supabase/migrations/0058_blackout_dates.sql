-- 0058: ปิดลานเป็นวัน (เลือกวันได้ และระบุช่วงเวลาได้) — กันลูกค้าจองวันที่ไม่มีคนอยู่ลาน
--   * ไม่กระทบการจองที่ยืนยันแล้ว เฉพาะการจอง/เลื่อนวันใหม่เท่านั้นที่ถูกกัน
--   * check_availability เดิมถูกใช้อยู่ในหลายฟังก์ชัน (create_booking, reschedule_booking,
--     verify_payment การเช็กซ้ำตอนหมดเวลากันที่) จึงแก้จุดเดียวที่นี่ ทุกจุดกันวันปิดอัตโนมัติ
--   * เพิ่มคอลัมน์ 'closed' ในผลลัพธ์ เพื่อให้หน้าจองแสดงข้อความ "ปิดให้บริการ" แยกจาก "เต็มแล้ว"
--   * ปิดได้ 2 แบบ: ทั้งวัน (ไม่ระบุเวลา) หรือ เฉพาะบางช่วงเวลา (start_time/end_time)
--     - ปิดทั้งวัน: บล็อกการจองใหม่ทั้งวันนั้น (เหมือนเดิม)
--     - ปิดเฉพาะช่วงเวลา: ไม่บล็อกการจองทั้งวัน (การจองไม่มีเวลาละเอียดขนาดนั้น) แต่บล็อก
--       รถรับส่งที่นัดเวลา (pickup_at) ให้ตรงกับช่วงที่ปิด ทั้งตอนจองใหม่ (create_booking) และยอดเดิม

create table if not exists blackout_dates (
  day        date not null,
  start_time time,  -- null = ปิดทั้งวัน; ถ้าไม่ null ต้องมี end_time ด้วย (ปิดเฉพาะช่วงเวลานี้)
  end_time   time,
  note       text,
  created_by uuid references staff_users(id),
  created_at timestamptz not null default now(),
  constraint blackout_dates_time_pair check ((start_time is null) = (end_time is null)),
  constraint blackout_dates_time_order check (start_time is null or end_time > start_time)
);
-- ปิดวันเดียวกันซ้ำ (เรียก admin_set_blackout ครั้งใหม่) จะอัปเดตแถวเดิมแทนการเพิ่มช่วงเวลาที่ 2 ของวันนั้น
do $$ begin
  if not exists (select 1 from pg_constraint where conname = 'blackout_dates_day_key') then
    alter table blackout_dates add constraint blackout_dates_day_key unique (day);
  end if;
end $$;
alter table blackout_dates enable row level security;
revoke all on blackout_dates from anon, authenticated;

-- ต้อง drop ก่อน เพราะเพิ่มคอลัมน์ผลลัพธ์ใหม่ (closed) — Postgres ไม่ให้ create or replace เปลี่ยนคอลัมน์ผลลัพธ์
drop function if exists check_availability(date, date, uuid);

create or replace function check_availability(p_start date, p_end date, p_exclude uuid default null)
returns table (day date, used int, cap int, available boolean, closed boolean)
language sql stable as $$
  -- ปิดทั้งวัน (start_time is null) เท่านั้นที่กันการจองทั้งวัน; ปิดเฉพาะช่วงเวลาไม่กระทบที่นี่
  select d::date,
         spots_used(d::date, p_exclude),
         s.total_spots - s.reserve_spots,
         (not exists (select 1 from blackout_dates x where x.day = d::date and x.start_time is null))
           and spots_used(d::date, p_exclude) < s.total_spots - s.reserve_spots,
         exists (select 1 from blackout_dates x where x.day = d::date and x.start_time is null)
  from settings s,
       generate_series(p_start, p_end, interval '1 day') d
  where s.id = 1
  order by 1
$$;

-- ---------------------------------------------------------------------
-- admin: ปิด/เปิดลานเป็นช่วงวัน (ทั้งวัน หรือระบุช่วงเวลาก็ได้)
--   * ถ้าช่วงนี้มีการจองที่ยืนยันแล้ว/เข้าลานอยู่แล้ว (รวมรถรับส่งที่นัดไว้ตรงช่วงที่จะปิด) และ p_force = false
--     จะไม่ปิดให้ แต่ raise จำนวนกลับไปก่อน ให้หน้าแอดมินแจ้งเตือนแล้วให้กดยืนยันอีกครั้ง (p_force = true)
--   * ปิดไม่ยกเลิกการจองเดิม แอดมินต้องติดต่อลูกค้า/จัดคนเองถ้าจำเป็น
--   * p_start_time/p_end_time ให้มาคู่กัน (ไม่ให้แค่ตัวเดียว) ไม่ให้ = ปิดทั้งวัน
-- error: invalid_range | invalid_time_range | has_bookings:<n>:<m>
-- ---------------------------------------------------------------------
drop function if exists admin_set_blackout(uuid, date, date, text, boolean);

create or replace function admin_set_blackout(
  p_actor uuid, p_start date, p_end date, p_note text default null, p_force boolean default false,
  p_start_time time default null, p_end_time time default null)
returns table (bookings int, shuttle_trips int)
language plpgsql set search_path = public as $$
declare
  a staff_users;
  v_bookings int;
  v_shuttle  int;
begin
  a := staff_require_admin(p_actor);
  if p_start is null or p_end is null or p_end < p_start then raise exception 'invalid_range'; end if;
  if p_end - p_start > 365 then raise exception 'invalid_range'; end if;
  if (p_start_time is null) <> (p_end_time is null) then raise exception 'invalid_time_range'; end if;
  if p_start_time is not null and p_end_time <= p_start_time then raise exception 'invalid_time_range'; end if;

  if p_start_time is null then
    -- ปิดทั้งวัน: นับการจองทุกตัวที่คาบเกี่ยวช่วงวันนี้ + รถรับส่งทุกเที่ยวในช่วงวันนี้
    select count(distinct b.id) into v_bookings from bookings b
    where b.status in ('confirmed', 'checked_in') and b.start_date <= p_end and b.end_date >= p_start;

    select count(*) into v_shuttle from shuttle_trips st
    join bookings b on b.id = st.booking_id
    where b.status in ('confirmed', 'checked_in')
      and st.pickup_at is not null
      and (st.pickup_at at time zone 'Asia/Bangkok')::date between p_start and p_end;
  else
    -- ปิดเฉพาะช่วงเวลา: การจองไม่มีเวลาละเอียดพอจะชน จึงนับแค่รถรับส่งที่นัดเวลาตรงช่วงที่จะปิด
    v_bookings := 0;
    select count(*) into v_shuttle from shuttle_trips st
    join bookings b on b.id = st.booking_id
    where b.status in ('confirmed', 'checked_in')
      and st.pickup_at is not null
      and (st.pickup_at at time zone 'Asia/Bangkok')::date between p_start and p_end
      and (st.pickup_at at time zone 'Asia/Bangkok')::time between p_start_time and p_end_time;
  end if;

  if (v_bookings > 0 or v_shuttle > 0) and not p_force then
    raise exception 'has_bookings:%:%', v_bookings, v_shuttle;
  end if;

  insert into blackout_dates (day, start_time, end_time, note, created_by)
  select d::date, p_start_time, p_end_time, nullif(trim(p_note), ''), a.id
  from generate_series(p_start, p_end, interval '1 day') d
  on conflict (day) do update
    set start_time = excluded.start_time, end_time = excluded.end_time,
        note = excluded.note, created_by = excluded.created_by;
  perform audit(a, 'update', 'blackout_dates', p_start::text,
    jsonb_build_object('start', p_start, 'end', p_end, 'start_time', p_start_time, 'end_time', p_end_time,
      'note', p_note, 'forced', p_force, 'bookings', v_bookings, 'shuttle_trips', v_shuttle));
  return query select v_bookings, v_shuttle;
end $$;

create or replace function admin_clear_blackout(p_actor uuid, p_day date)
returns void
language plpgsql set search_path = public as $$
declare a staff_users;
begin
  a := staff_require_admin(p_actor);
  delete from blackout_dates where day = p_day;
  perform audit(a, 'delete', 'blackout_dates', p_day::text, '{}'::jsonb);
end $$;

-- ---------------------------------------------------------------------
-- create_booking: กันไม่ให้ตั้งเวลารับ-ส่งรถ (ตอนจองใหม่) ให้ตรงกับช่วงที่ปิดลาน
-- error (new): closed_time:<YYYY-MM-DD>:<HH:MM>-<HH:MM>
-- ---------------------------------------------------------------------
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
  p_return_time       timestamptz default null,    -- ใช้เมื่อไม่มีเลขไฟลต์
  p_ref_phone         text        default null,
  p_coupon            uuid        default null
) returns bookings
language plpgsql set search_path = public, extensions as $$
declare
  s          settings;
  v_customer uuid;
  v_full     date;
  v_disc     int;
  v_reason   text;
  v_gross    int;
  v_cp       coupons;
  v_cp_amt   int := 0;
  v_win      blackout_dates;
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

  if p_shuttle then
    select * into v_win from blackout_dates x
    where p_outbound_time is not null and x.day = p_start and x.start_time is not null
      and (p_outbound_time at time zone 'Asia/Bangkok')::time between x.start_time and x.end_time;
    if found then
      raise exception 'closed_time:%:%-%', p_start, to_char(v_win.start_time, 'HH24:MI'), to_char(v_win.end_time, 'HH24:MI');
    end if;

    select * into v_win from blackout_dates x
    where p_return_time is not null and x.day = p_end and x.start_time is not null
      and (p_return_time at time zone 'Asia/Bangkok')::time between x.start_time and x.end_time;
    if found then
      raise exception 'closed_time:%:%-%', p_end, to_char(v_win.start_time, 'HH24:MI'), to_char(v_win.end_time, 'HH24:MI');
    end if;
  end if;

  v_gross := (p_end - p_start + 1) * s.price_per_day + case when p_shuttle then s.shuttle_price else 0 end;
  select bd.amount, bd.reason into v_disc, v_reason from booking_discount(p_phone, p_ref_phone) bd;
  v_disc := least(coalesce(v_disc, 0), v_gross);

  insert into customers (line_user_id, name, phone)
  values (p_line_user_id, p_name, p_phone)
  on conflict (line_user_id) do update set name = excluded.name, phone = excluded.phone
  returning id into v_customer;

  if p_coupon is not null then
    select * into v_cp from coupons where id = p_coupon for update;
    if not found or v_cp.customer_id <> v_customer or v_cp.status <> 'active'
       or v_cp.kind <> 'parking_discount' or v_cp.expires_at <= now() then
      raise exception 'coupon_invalid';
    end if;
    v_cp_amt := least(v_cp.value_baht, v_gross - v_disc);
  end if;

  insert into bookings (customer_id, plate, plate_province, start_date, end_date,
                        parking_amount, shuttle, pax, shuttle_amount, hold_expires_at,
                        discount_amount, discount_reason, referrer_phone, coupon_id, coupon_amount)
  values (v_customer,
          upper(regexp_replace(p_plate, '\s+', '', 'g')),
          p_province, p_start, p_end,
          (p_end - p_start + 1) * s.price_per_day,
          p_shuttle,
          case when p_shuttle then p_pax end,
          case when p_shuttle then s.shuttle_price else 0 end,
          now() + make_interval(mins => s.hold_minutes),
          v_disc,
          case when v_disc > 0 then v_reason end,
          case when v_disc > 0 and v_reason = 'referral' then norm_phone(p_ref_phone) end,
          v_cp.id, v_cp_amt)
  returning * into b;

  if v_cp.id is not null then
    update coupons set status = 'used', used_at = now(), used_booking = b.id, used_by = 'booking' where id = v_cp.id;
  end if;

  if p_shuttle then
    insert into shuttle_trips (booking_id, direction, pax, flight_number, flight_date, customer_time, pickup_at)
    values (b.id, 'to_airport',   p_pax, nullif(upper(p_outbound_flight), ''), p_start, p_outbound_time, p_outbound_time),
           (b.id, 'from_airport', p_pax, nullif(upper(p_return_flight), ''),   p_end,   p_return_time,   p_return_time);
  end if;

  insert into payments (booking_id, kind, amount) values (b.id, 'booking', b.total_amount);

  return b;
end $$;

-- check_availability / create_booking เก็บสิทธิ์เดิม (revoked จาก anon/authenticated ตั้งแต่ 0001/0013);
-- การ drop ด้านบนไม่ได้รีเซ็ตสิทธินี้ แต่ตั้งซ้ำไว้เผื่อรันใหม่
do $$
declare fn text;
begin
  foreach fn in array array[
    'check_availability(date,date,uuid)',
    'admin_set_blackout(uuid,date,date,text,boolean,time,time)',
    'admin_clear_blackout(uuid,date)',
    'create_booking(text,text,text,text,text,date,date,boolean,int,text,timestamptz,text,timestamptz,text,uuid)'
  ] loop
    execute format('revoke execute on function %s from public', fn);
    if exists (select 1 from pg_roles where rolname = 'anon') then
      execute format('revoke execute on function %s from anon, authenticated', fn);
    end if;
  end loop;
end $$;

notify pgrst, 'reload schema';
