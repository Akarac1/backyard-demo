-- Which of migrations 0030–0035 are installed? Read-only: safe to run any time.
-- Run in Supabase SQL Editor. Every row should say ✅ once everything is installed.
select m.migration,
       case when m.ok then '✅ ติดตั้งแล้ว' else '❌ ยังไม่ได้ติดตั้ง' end as status
from (values
  ('0030_shuttle_capacity',          exists (select 1 from pg_proc where proname = 'shuttle_capacity_ok')),
  ('0031_vehicle_luggage_priority',  exists (select 1 from information_schema.columns
                                             where table_name = 'vehicles' and column_name = 'priority')),
  ('0032_customer_return_bags',      exists (select 1 from pg_proc where proname = 'customer_set_trip_bags')),
  ('0033_large_bags_only (รันซ้ำได้ปลอดภัย)', exists (select 1 from information_schema.columns
                                             where table_name = 'vehicles' and column_name = 'luggage_units')),
  ('0034_tv_board',                  exists (select 1 from information_schema.columns
                                             where table_name = 'settings' and column_name = 'tv_token')),
  ('0035_live_dispatch',             exists (select 1 from information_schema.columns
                                             where table_name = 'shuttle_trips' and column_name = 'dispatched_at'))
) as m(migration, ok)
order by 1;
