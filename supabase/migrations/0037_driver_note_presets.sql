-- 0037: ready-made phrases for the driver's "problem / note" box, edited on the settings page.
alter table settings add column if not exists driver_note_presets text[] not null default array[
  'รถติดหนัก ถึงช้ากว่ากำหนดประมาณ 10–15 นาที',
  'ถึงจุดนัดรับแล้ว รอที่ป้ายทางเข้า 7',
  'โทรหาลูกค้าไม่ติด รบกวนติดต่อกลับ',
  'ลูกค้ายังไม่ออกจากโถง รอต่อที่จุดนัดรับ',
  'กระเป๋าเยอะกว่าที่แจ้ง ขอเปลี่ยนเป็นรถคันใหญ่'
];

create or replace function admin_set_note_presets(p_actor uuid, p_presets text[]) returns settings
language plpgsql set search_path = public as $$
declare a staff_users; s settings; clean text[];
begin
  a := staff_require_admin(p_actor);
  select coalesce(array_agg(x order by i), '{}') into clean
  from (select btrim(v) as x, i from unnest(coalesce(p_presets, '{}')) with ordinality as u(v, i)) q
  where x <> '';
  if cardinality(clean) > 12 or exists (select 1 from unnest(clean) x where char_length(x) > 200) then
    raise exception 'invalid_presets';
  end if;
  update settings set driver_note_presets = clean where id = 1 returning * into s;
  perform audit(a, 'note_presets', 'settings', '1', jsonb_build_object('count', cardinality(clean)));
  return s;
end $$;

revoke all on function admin_set_note_presets(uuid, text[]) from public, anon, authenticated;
grant execute on function admin_set_note_presets(uuid, text[]) to service_role;
