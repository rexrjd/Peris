create table if not exists public.peris_worker_owners(owner_id uuid primary key references public.players(id)on delete cascade,last_processed_at timestamptz not null default now());
alter table public.peris_worker_owners add column if not exists last_attempt_at timestamptz;
alter table public.peris_worker_owners add column if not exists next_attempt_at timestamptz;
alter table public.peris_worker_owners add column if not exists consecutive_failures integer not null default 0;
alter table public.peris_worker_owners add column if not exists last_sqlstate text;
alter table public.peris_worker_owners enable row level security;
revoke all on public.peris_worker_owners from public,anon,authenticated;
-- The same persistent world advances without a browser. All helpers are private.
create or replace function public.peris_game_tick(p_limit integer default 40)returns jsonb
language plpgsql security definer set search_path='' as $$
declare owner uuid;farm public.peris_campaign_farms%rowtype;processed integer:=0;camp_id integer;
 attempted integer:=0;failed integer:=0;camp_failed integer:=0;
 started timestamptz:=clock_timestamp();pass_started timestamptz;battles jsonb;
begin
 if p_limit is null or p_limit not between 1 and 100 then raise exception 'Use a worker budget of 1Ã¢â‚¬“100 owners';end if;
 if not pg_try_advisory_xact_lock(204215)then return jsonb_build_object('busy',true);end if;
 battles:=public.peris_advance_battles(20,2000);pass_started:=clock_timestamp();
 for owner in select q.owner_id from(
  select owner_id,min(arrival_at)as due from public.armies where (status='moving' or raid_target_id is not null or raid_city_id is not null)and arrival_at<=now() group by owner_id
  union all select owner_id,min(arrival_at)from public.peris_settler_expeditions where status='travelling'and arrival_at<=now()group by owner_id
  union all select owner_id,min(arrival_at)from public.peris_ruin_evacuations where arrival_at<=now()group by owner_id
  union all select owner_id,min(finish_at)from public.peris_orders where finish_at<=now()group by owner_id
  union all select owner_id,min(public.peris_science_deadline(owner_id))from public.peris_account_science where active_id is not null and public.peris_science_deadline(owner_id)<=now()group by owner_id
  union all select owner_id,min(next_at)from public.peris_campaign_farms where enabled and next_at<=now()group by owner_id
 )q left join public.peris_worker_owners w on w.owner_id=q.owner_id
 where w.next_attempt_at is null or w.next_attempt_at<=clock_timestamp()
 group by q.owner_id,w.last_processed_at,w.last_attempt_at order by coalesce(w.last_attempt_at,w.last_processed_at,'1970-01-01'::timestamptz),min(q.due),q.owner_id limit p_limit loop
  exit when extract(epoch from(clock_timestamp()-pass_started))*1000>=2000;
  attempted:=attempted+1;
  begin
   if exists(select 1 from public.peris_settler_expeditions where owner_id=owner and status='travelling'and arrival_at<=now())and not pg_try_advisory_xact_lock(204200)then raise lock_not_available;end if;
   perform 1 from public.players where id=owner for update nowait;
   perform public.peris_sync_owner(owner);
   for farm in select * from public.peris_campaign_farms where owner_id=owner and enabled and next_at<=now()order by next_at,id limit 100 for update skip locked loop
    exit when extract(epoch from(clock_timestamp()-pass_started))*1000>=2000;
    begin
     if farm.route is null then raise exception 'Start this target manually once to establish its land route';end if;
     perform public.peris_prepare_raid_for(owner,farm.army_id,farm.camp_id,farm.route,farm.troops);
     update public.armies set farm_list_id=farm.list_id where id=farm.army_id;
     update public.peris_campaign_farms set last_status='Raid preparing',sent=sent+1 where id=farm.id;
    exception when others then update public.peris_campaign_farms set last_status=sqlerrm,skipped=skipped+1 where id=farm.id;end;
    update public.peris_campaign_farms set next_at=now()+make_interval(secs=>farm.interval_seconds)where id=farm.id;
   end loop;
   insert into public.peris_worker_owners(owner_id,last_processed_at,last_attempt_at,next_attempt_at,consecutive_failures,last_sqlstate)
    values(owner,clock_timestamp(),clock_timestamp(),null,0,null)on conflict(owner_id)do update set
    last_processed_at=excluded.last_processed_at,last_attempt_at=excluded.last_attempt_at,next_attempt_at=null,consecutive_failures=0,last_sqlstate=null;
   processed:=processed+1;
  exception when lock_not_available then
   insert into public.peris_worker_owners(owner_id,last_attempt_at,next_attempt_at)values(owner,clock_timestamp(),clock_timestamp()+interval '1 second')
    on conflict(owner_id)do update set last_attempt_at=excluded.last_attempt_at,next_attempt_at=excluded.next_attempt_at;
  when others then
   failed:=failed+1;
   insert into public.peris_worker_owners(owner_id,last_attempt_at,next_attempt_at,consecutive_failures,last_sqlstate)
    values(owner,clock_timestamp(),clock_timestamp()+interval '5 seconds',1,sqlstate)on conflict(owner_id)do update set
    last_attempt_at=excluded.last_attempt_at,next_attempt_at=clock_timestamp()+make_interval(secs=>least(300,5*power(2,least(6,public.peris_worker_owners.consecutive_failures)))::double precision),
    consecutive_failures=public.peris_worker_owners.consecutive_failures+1,last_sqlstate=excluded.last_sqlstate;
  end;
 end loop;
 pass_started:=clock_timestamp();
 for camp_id in select s.camp_id from public.peris_camp_stock s where s.next_recruit_at<=now() or s.stock_updated_at<=now()-interval '1 minute'order by least(s.next_recruit_at,s.stock_updated_at+interval '1 minute'),s.camp_id limit 100 loop
  exit when extract(epoch from(clock_timestamp()-pass_started))*1000>=500;
  begin perform public.peris_camp_accrue(camp_id);exception when others then camp_failed:=camp_failed+1;end;
 end loop;
 return jsonb_build_object('processed',processed,'attempted',attempted,'failed',failed,'battles',battles,'camps_failed',camp_failed,'duration_ms',extract(epoch from(clock_timestamp()-started))*1000);
end $$;
