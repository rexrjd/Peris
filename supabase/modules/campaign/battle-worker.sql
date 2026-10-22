-- Scheduling timestamps are operational real time, never accelerated game time.
create table if not exists public.peris_battle_work(
 battle_id bigint primary key references public.battles(id) on delete cascade,
 last_attempt_at timestamptz not null,next_attempt_at timestamptz not null,
 consecutive_failures integer not null default 0,last_sqlstate text
);
alter table public.peris_battle_work enable row level security;
revoke all on public.peris_battle_work from public,anon,authenticated;
create index if not exists peris_active_battles_due on public.battles(last_tick_at,id)where status='active';
create or replace function public.peris_advance_battles(p_limit integer default 20,p_budget_ms integer default 2000)returns jsonb
language plpgsql security definer set search_path='' as $$
declare started timestamptz:=clock_timestamp();bid bigint;owner uuid;visited bigint[]:='{}';
 attempted integer:=0;processed integer:=0;failed integer:=0;busy integer:=0;outcome jsonb;
begin
 if p_limit is null or p_limit not between 1 and 100 or p_budget_ms is null or p_budget_ms not between 1 and 5000 then raise exception 'Invalid battle worker budget';end if;
 while attempted<p_limit and extract(epoch from(clock_timestamp()-started))*1000<p_budget_ms loop
  bid:=null;
  begin
   select b.id,b.attacker_owner_id into bid,owner from public.battles b left join public.peris_battle_work w on w.battle_id=b.id
    where b.status='active'and b.last_tick_at<=now()-interval '150 milliseconds'
     and not(b.id=any(visited))and(w.next_attempt_at is null or w.next_attempt_at<=clock_timestamp())
    order by w.last_attempt_at nulls first,b.last_tick_at,b.id limit 1 for update of b skip locked;
   if bid is null then exit;end if;
   visited:=array_append(visited,bid);attempted:=attempted+1;
   outcome:=public.peris_tick_for(bid,owner);
   if coalesce((outcome->>'busy')::boolean,false)then raise lock_not_available;end if;
   insert into public.peris_battle_work values(bid,clock_timestamp(),clock_timestamp(),0,null)
    on conflict(battle_id)do update set last_attempt_at=excluded.last_attempt_at,next_attempt_at=excluded.next_attempt_at,consecutive_failures=0,last_sqlstate=null;
   processed:=processed+1;
  exception when lock_not_available then
   busy:=busy+1;
   insert into public.peris_battle_work values(bid,clock_timestamp(),clock_timestamp()+interval '1 second',0,'55P03')
    on conflict(battle_id)do update set last_attempt_at=excluded.last_attempt_at,next_attempt_at=excluded.next_attempt_at;
  when others then
   failed:=failed+1;
   insert into public.peris_battle_work values(bid,clock_timestamp(),clock_timestamp()+interval '5 seconds',1,sqlstate)
    on conflict(battle_id)do update set last_attempt_at=excluded.last_attempt_at,
     next_attempt_at=clock_timestamp()+make_interval(secs=>least(300,5*power(2,least(6,public.peris_battle_work.consecutive_failures)))::double precision),
     consecutive_failures=public.peris_battle_work.consecutive_failures+1,last_sqlstate=excluded.last_sqlstate;
  end;
 end loop;
 return jsonb_build_object('attempted',attempted,'processed',processed,'failed',failed,'busy',busy,'duration_ms',extract(epoch from(clock_timestamp()-started))*1000);
end $$;
