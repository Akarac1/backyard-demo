-- 0059: โชว์ช่วงเวลาที่ปิด (ถ้ามี) ให้ลูกค้าเห็นตั้งแต่หน้าเลือกวัน แทนที่จะไปเจอตอนกดยืนยันจอง
--   * check_availability เพิ่มคอลัมน์ closed_start/closed_end (time) — ไม่ null เมื่อวันนั้นปิดเฉพาะบางช่วงเวลา
--     (ปิดทั้งวันอยู่แล้วจะเห็นจาก closed = true เหมือนเดิม ไม่ต้องมีช่วงเวลา)
--   * ไม่กระทบ logic การกันวัน/กันเวลาเดิมใน 0058 จุดอื่นเลย แก้แค่ผลลัพธ์ที่ส่งกลับให้หน้าเว็บ

drop function if exists check_availability(date, date, uuid);

create or replace function check_availability(p_start date, p_end date, p_exclude uuid default null)
returns table (day date, used int, cap int, available boolean, closed boolean, closed_start time, closed_end time)
language sql stable as $$
  select d::date,
         spots_used(d::date, p_exclude),
         s.total_spots - s.reserve_spots,
         (not exists (select 1 from blackout_dates x where x.day = d::date and x.start_time is null))
           and spots_used(d::date, p_exclude) < s.total_spots - s.reserve_spots,
         exists (select 1 from blackout_dates x where x.day = d::date and x.start_time is null),
         (select x.start_time from blackout_dates x where x.day = d::date and x.start_time is not null),
         (select x.end_time from blackout_dates x where x.day = d::date and x.start_time is not null)
  from settings s,
       generate_series(p_start, p_end, interval '1 day') d
  where s.id = 1
  order by 1
$$;

do $$
declare fn text;
begin
  foreach fn in array array['check_availability(date,date,uuid)'] loop
    execute format('revoke execute on function %s from public', fn);
    if exists (select 1 from pg_roles where rolname = 'anon') then
      execute format('revoke execute on function %s from anon, authenticated', fn);
    end if;
  end loop;
end $$;

notify pgrst, 'reload schema';
