-- 0048 Link bookings that staff entered / imported (customer has no LINE id yet, stored as 'demo-walkin-<phone>')
-- to the customer's real LINE account. Proof = the phone number AND a plate from one of those bookings (both must match).
-- 5 wrong tries per hour per LINE user. Returns the number of linked bookings, or -1 when nothing matched
-- (not an exception, so the failed try is kept in claim_attempts). Error: claim_locked

create table if not exists claim_attempts (
  id uuid primary key default gen_random_uuid(),
  line_user_id text not null,
  at timestamptz not null default now()
);
create index if not exists claim_attempts_idx on claim_attempts (line_user_id, at);
alter table claim_attempts enable row level security;

create or replace function claim_imported_bookings(p_line_user_id text, p_phone text, p_plate text)
returns int
language plpgsql set search_path = public, extensions as $$
declare
  v_phone text := norm_phone(p_phone);
  v_plate text := upper(regexp_replace(coalesce(p_plate, ''), '\s+', '', 'g'));
  src customers; tgt customers; n int := 0; hit boolean := false;
begin
  if p_line_user_id is null or p_line_user_id = '' then return -1; end if;
  if (select count(*) from claim_attempts where line_user_id = p_line_user_id and at > now() - interval '1 hour') >= 5 then
    raise exception 'claim_locked';
  end if;
  if v_phone !~ '^0[0-9]{8,9}$' or v_plate = '' then
    insert into claim_attempts (line_user_id) values (p_line_user_id);
    return -1;
  end if;

  perform pg_advisory_xact_lock(hashtext('claim:' || v_phone));
  select * into tgt from customers where line_user_id = p_line_user_id;

  for src in
    select c.* from customers c
    where c.line_user_id like 'demo-walkin-%' and norm_phone(c.phone) = v_phone
      and exists (select 1 from bookings b where b.customer_id = c.id and b.plate = v_plate)
    order by c.created_at
  loop
    hit := true;
    if tgt.id is null then
      -- the LINE user has no customer row yet: the imported one simply becomes theirs
      update customers set line_user_id = p_line_user_id where id = src.id returning * into tgt;
    else
      update bookings set customer_id = tgt.id where customer_id = src.id;
      update booking_groups set customer_id = tgt.id where customer_id = src.id;
      update coupons set customer_id = tgt.id where customer_id = src.id;
      update member_purchases set customer_id = tgt.id where customer_id = src.id;
      update point_lots set customer_id = tgt.id where customer_id = src.id;
      update point_spends set customer_id = tgt.id where customer_id = src.id;
      update trip_ratings set customer_id = tgt.id where customer_id = src.id;
      update vip_plates set customer_id = tgt.id where customer_id = src.id;
      update black_diamond set customer_id = tgt.id
        where customer_id = src.id and not exists (select 1 from black_diamond x where x.customer_id = tgt.id);
      delete from customers where id = src.id;
    end if;
  end loop;

  if not hit then
    insert into claim_attempts (line_user_id) values (p_line_user_id);
    return -1;
  end if;
  if coalesce(tgt.phone, '') = '' then update customers set phone = trim(p_phone) where id = tgt.id; end if;
  select count(*) into n from bookings where customer_id = tgt.id and plate = v_plate;
  return n;
end $$;

do $$ begin
  revoke execute on function claim_imported_bookings(text, text, text) from public;
  if exists (select 1 from pg_roles where rolname = 'anon') then
    revoke execute on function claim_imported_bookings(text, text, text) from anon, authenticated;
  end if;
  if exists (select 1 from pg_roles where rolname = 'service_role') then
    grant execute on function claim_imported_bookings(text, text, text) to service_role;
    grant all on claim_attempts to service_role;
  end if;
end $$;
notify pgrst, 'reload schema';
