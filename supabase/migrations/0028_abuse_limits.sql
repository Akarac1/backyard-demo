-- 0028: limits against abuse.
-- 1) One customer can hold at most 2 unpaid bookings at a time, so a script cannot fill the lot
--    with 15-minute holds.
-- 2) At most 6 slip uploads per payment, so the slip-check quota (EasySlip) cannot be drained.

create or replace function bookings_hold_limit_trg() returns trigger
language plpgsql set search_path = public as $$
begin
  if new.status = 'pending_payment' and new.customer_id is not null then
    -- serialise per customer so two parallel requests cannot both slip through
    perform pg_advisory_xact_lock(hashtext('hold:' || new.customer_id::text));
    if (select count(*) from bookings
        where customer_id = new.customer_id and status = 'pending_payment'
          and (hold_expires_at is null or hold_expires_at > now())) >= 2 then
      raise exception 'too_many_holds';
    end if;
  end if;
  return new;
end $$;

drop trigger if exists bookings_hold_limit on bookings;
create trigger bookings_hold_limit before insert on bookings
  for each row execute function bookings_hold_limit_trg();

alter table payments add column if not exists slip_attempts int not null default 0;

-- returns the new count, or raises too_many_slips once the limit is reached
create or replace function payment_slip_attempt(p_payment uuid) returns int
language plpgsql set search_path = public as $$
declare n int;
begin
  update payments set slip_attempts = slip_attempts + 1
  where id = p_payment and slip_attempts < 6 returning slip_attempts into n;
  if n is null then raise exception 'too_many_slips'; end if;
  return n;
end $$;

revoke all on function bookings_hold_limit_trg() from public, anon, authenticated;
revoke all on function payment_slip_attempt(uuid) from public, anon, authenticated;
grant execute on function payment_slip_attempt(uuid) to service_role;
