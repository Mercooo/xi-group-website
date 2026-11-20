-- Seat kinds: regular (anyone can book), vip (front five rows: shown, but only the organisers give them out),
-- blocked (broken seats nobody can book). Adds rows 13 and 14.
alter table fest_seats add column if not exists kind text not null default 'regular' check (kind in ('regular', 'vip', 'blocked'));

insert into fest_seats (id)
select lpad(r::text, 2, '0') || '-' || s.sec || lpad(n::text, 2, '0')
  from generate_series(13, 14) r
  cross join (values ('L', 5), ('M', 10), ('R', 5)) as s(sec, cnt)
  cross join lateral generate_series(1, s.cnt) n
on conflict (id) do nothing;

update fest_seats set kind = 'vip' where substr(id, 1, 2) in ('01','02','03','04','05') and order_id is null;
-- Broken seats, counted facing the stage: row 1 4th from the right, row 3 3rd from the left, row 5 1st from the right.
update fest_seats set kind = 'blocked', hold_token = null, hold_ip = null, held_until = null
 where id in ('01-R02', '03-L03', '05-R05') and order_id is null;

create or replace function public.fest_hold_seats(p_seats text[], p_token text, p_ip text, p_minutes integer)
 returns integer language plpgsql security definer set search_path to 'public' as $function$
declare n int;
begin
  update fest_seats set hold_token = null, hold_ip = null, held_until = null where hold_token = p_token;
  update fest_seats set hold_token = p_token, hold_ip = p_ip, held_until = now() + make_interval(mins => p_minutes)
   where id = any(p_seats) and kind = 'regular' and order_id is null and (held_until is null or held_until < now());
  get diagnostics n = row_count;
  if n <> cardinality(p_seats) then raise exception 'seat_unavailable'; end if;
  return n;
end $function$;

drop function if exists public.fest_claim_seats(uuid, text[], text[], text);
create or replace function public.fest_claim_seats(p_order uuid, p_seats text[], p_codes text[], p_token text, p_allow_vip boolean default false)
 returns integer language plpgsql security definer set search_path to 'public' as $function$
declare n int;
begin
  update fest_seats s set order_id = p_order, ticket_code = c.code, hold_token = null, hold_ip = null, held_until = null
    from unnest(p_seats, p_codes) as c(id, code)
   where s.id = c.id and s.order_id is null
     and (s.kind = 'regular' or (s.kind = 'vip' and p_allow_vip))
     and (s.held_until is null or s.held_until < now() or (p_token is not null and s.hold_token = p_token));
  get diagnostics n = row_count;
  if n <> cardinality(p_seats) then raise exception 'seat_unavailable'; end if;
  return n;
end $function$;

revoke execute on function public.fest_hold_seats(text[], text, text, integer) from public, anon, authenticated;
revoke execute on function public.fest_claim_seats(uuid, text[], text[], text, boolean) from public, anon, authenticated;
grant execute on function public.fest_hold_seats(text[], text, text, integer) to service_role;
grant execute on function public.fest_claim_seats(uuid, text[], text[], text, boolean) to service_role;
