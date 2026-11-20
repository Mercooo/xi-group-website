-- The theatre as the organisers drew it (festival/src/lib/theatre.json): 21 rows of left, middle and right
-- blocks of different lengths, 653 seats. Seat numbers count from the left, facing the stage.
-- kind: regular (anyone can book), vip (the middle block of rows 1-5: shown, given out by the organisers only),
-- blocked (broken: nobody can book).
alter table fest_seats add column if not exists kind text not null default 'regular' check (kind in ('regular', 'vip', 'blocked'));

drop table if exists pg_temp.plan;
create temporary table plan as
with t as (select '[{"row":1,"L":{"count":8,"blocked":[8]},"R":{"count":8,"blocked":[1]},"M":{"count":13,"blocked":[10],"vip":true}},{"row":2,"L":{"count":8,"blocked":[]},"R":{"count":8,"blocked":[]},"M":{"count":14,"blocked":[],"vip":true}},{"row":3,"L":{"count":9,"blocked":[]},"R":{"count":9,"blocked":[]},"M":{"count":13,"blocked":[3],"vip":true}},{"row":4,"L":{"count":9,"blocked":[]},"R":{"count":8,"blocked":[7,8]},"M":{"count":14,"blocked":[],"vip":true}},{"row":5,"L":{"count":8,"blocked":[8]},"R":{"count":8,"blocked":[5]},"M":{"count":13,"blocked":[13],"vip":true}},{"row":6,"L":{"count":7,"blocked":[]},"R":{"count":7,"blocked":[]},"M":{"count":16,"blocked":[1,2,6]}},{"row":7,"L":{"count":8,"blocked":[1]},"R":{"count":9,"blocked":[]},"M":{"count":15,"blocked":[]}},{"row":8,"L":{"count":8,"blocked":[]},"R":{"count":9,"blocked":[1]},"M":{"count":16,"blocked":[1]}},{"row":9,"L":{"count":7,"blocked":[]},"R":{"count":8,"blocked":[]},"M":{"count":15,"blocked":[1]}},{"row":10,"L":{"count":11,"blocked":[11]},"R":{"count":10,"blocked":[]},"M":{"count":16,"blocked":[1,4]}},{"row":11,"L":{"count":8,"blocked":[]},"R":{"count":9,"blocked":[]},"M":{"count":15,"blocked":[10]}},{"row":12,"L":{"count":8,"blocked":[8]},"R":{"count":9,"blocked":[]},"M":{"count":16,"blocked":[16]}},{"row":13,"L":{"count":4,"blocked":[]},"R":{"count":9,"blocked":[]},"M":{"count":13,"blocked":[]}},{"row":14,"L":{"count":9,"blocked":[7,8]},"R":{"count":9,"blocked":[]},"M":{"count":16,"blocked":[1]}},{"row":15,"L":{"count":8,"blocked":[1]},"R":{"count":8,"blocked":[]},"M":{"count":15,"blocked":[]}},{"row":16,"L":{"count":8,"blocked":[]},"R":{"count":8,"blocked":[]},"M":{"count":16,"blocked":[]}},{"row":17,"L":{"count":6,"blocked":[]},"R":{"count":6,"blocked":[]},"M":{"count":15,"blocked":[]}},{"row":18,"L":{"count":9,"blocked":[]},"R":{"count":9,"blocked":[4]},"M":{"count":16,"blocked":[9]}},{"row":19,"L":{"count":8,"blocked":[4]},"R":{"count":8,"blocked":[]},"M":{"count":15,"blocked":[10]}},{"row":20,"L":{"count":8,"blocked":[]},"R":{"count":8,"blocked":[]},"M":{"count":16,"blocked":[]}},{"row":21,"L":{"count":7,"blocked":[]},"R":{"count":7,"blocked":[]},"M":{"count":15,"blocked":[1]}}]'::jsonb as j),
     blk as (
       select (r->>'row')::int as row_no, sec, r->sec as b
         from t, jsonb_array_elements(t.j) r, unnest(array['L','M','R']) sec
     )
select lpad(row_no::text, 2, '0') || '-' || sec || lpad(n::text, 2, '0') as id,
       case when (b->'blocked') @> to_jsonb(n) then 'blocked'
            when coalesce((b->>'vip')::boolean, false) then 'vip'
            else 'regular' end as kind
  from blk, generate_series(1, (b->>'count')::int) n;

-- Seats that are not in the plan go, unless someone already has them (then they stay, so no booking breaks).
delete from fest_seats s where s.order_id is null and not exists (select 1 from plan p where p.id = s.id);
insert into fest_seats (id, kind) select id, kind from plan on conflict (id) do update set kind = excluded.kind;
update fest_seats set hold_token = null, hold_ip = null, held_until = null where kind <> 'regular';
drop table plan;

-- Guests (and leaders) can only hold regular seats.
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

-- Claiming: regular seats for everyone, VIP seats only when the organisers allow it, broken seats never.
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
