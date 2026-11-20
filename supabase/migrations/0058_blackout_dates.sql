-- 0058: ปิดลานเป็นวัน (เลือกวันได้) — กันลูกค้าจองวันที่ไม่มีคนอยู่ลาน
--   * ไม่กระทบการจองที่ยืนยันแล้ว เฉพาะการจอง/เลื่อนวันใหม่เท่านั้นที่ถูกกัน
--   * check_availability เดิมถูกใช้อยู่ในหลายฟังก์ชัน (create_booking, reschedule_booking,
--     verify_payment การเช็กซ้ำตอนหมดเวลากันที่) จึงแก้จุดเดียวที่นี่ ทุกจุดกันวันปิดอัตโนมัติ
--   * เพิ่มคอลัมน์ 'closed' ในผลลัพธ์ เพื่อให้หน้าจองแสดงข้อความ "ปิดให้บริการ" แยกจาก "เต็มแล้ว"

create table if not exists blackout_dates (
  day        date primary key,
  note       text,
  created_by uuid references staff_users(id),
  created_at timestamptz not null default now()
);
alter table blackout_dates enable row level security;
revoke all on blackout_dates from anon, authenticated;

-- ต้อง drop ก่อน เพราะเพิ่มคอลัมน์ผลลัพธ์ใหม่ (closed) — Postgres ไม่ให้ create or replace เปลี่ยนคอลัมน์ผลลัพธ์
drop function if exists check_availability(date, date, uuid);

create or replace function check_availability(p_start date, p_end date, p_exclude uuid default null)
returns table (day date, used int, cap int, available boolean, closed boolean)
language sql stable as $$
  select d::date,
         spots_used(d::date, p_exclude),
         s.total_spots - s.reserve_spots,
         (not exists (select 1 from blackout_dates x where x.day = d::date))
           and spots_used(d::date, p_exclude) < s.total_spots - s.reserve_spots,
         exists (select 1 from blackout_dates x where x.day = d::date)
  from settings s,
       generate_series(p_start, p_end, interval '1 day') d
  where s.id = 1
  order by 1
$$;

-- ---------------------------------------------------------------------
-- admin: ปิด/เปิดลานเป็นช่วงวัน
-- ---------------------------------------------------------------------
create or replace function admin_set_blackout(p_actor uuid, p_start date, p_end date, p_note text default null)
returns void
language plpgsql set search_path = public as $$
declare a staff_users;
begin
  a := staff_require_admin(p_actor);
  if p_start is null or p_end is null or p_end < p_start then raise exception 'invalid_range'; end if;
  if p_end - p_start > 365 then raise exception 'invalid_range'; end if;
  insert into blackout_dates (day, note, created_by)
  select d::date, nullif(trim(p_note), ''), a.id
  from generate_series(p_start, p_end, interval '1 day') d
  on conflict (day) do update set note = excluded.note, created_by = excluded.created_by;
  perform audit(a, 'update', 'blackout_dates', p_start::text, jsonb_build_object('start', p_start, 'end', p_end, 'note', p_note));
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

-- check_availability keeps the same access as before (revoked from anon/authenticated in 0001);
-- the drop above does not reset that, but re-apply it in case the drop ever needs re-running.
do $$
declare fn text;
begin
  foreach fn in array array[
    'check_availability(date,date,uuid)',
    'admin_set_blackout(uuid,date,date,text)',
    'admin_clear_blackout(uuid,date)'
  ] loop
    execute format('revoke execute on function %s from public', fn);
    if exists (select 1 from pg_roles where rolname = 'anon') then
      execute format('revoke execute on function %s from anon, authenticated', fn);
    end if;
  end loop;
end $$;

notify pgrst, 'reload schema';
