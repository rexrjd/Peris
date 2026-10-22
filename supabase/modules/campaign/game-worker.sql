create table if not exists public.peris_worker_owners(owner_id uuid primary key references public.players(id)on delete cascade,last_processed_at timestamptz not null default now());
alter table public.peris_worker_owners enable row level security;
revoke all on public.peris_worker_owners from public,anon,authenticated;
-- The same persistent world advances without a browser. All helpers are private.
create or replace function public.peris_game_tick(p_limit integer default 40)returns jsonb
language plpgsql security definer set search_path='' as $$
declare owner uuid;farm public.peris_campaign_farms%rowtype;processed integer:=0;bid bigint;camp_id integer;
begin
 if p_limit not between 1 and 100 then raise exception 'Use a worker budget of 1Ã¢â‚¬“100 owners';end if;
 if not pg_try_advisory_xact_lock(204215)then return jsonb_build_object('busy',true);end if;
 if exists(select 1 from public.peris_settler_expeditions where status='travelling'and arrival_at<=now())then perform pg_advisory_xact_lock(204200);end if;
 for owner in select q.owner_id from(
  select owner_id,min(arrival_at)as due from public.armies where (status='moving' or raid_target_id is not null or raid_city_id is not null)and arrival_at<=now() group by owner_id
  union all select owner_id,min(arrival_at)from public.peris_settler_expeditions where status='travelling'and arrival_at<=now()group by owner_id
  union all select owner_id,min(finish_at)from public.peris_orders where finish_at<=now()group by owner_id
  union all select owner_id,min(arrival_at)from public.peris_city_reinforcements where arrival_at<=now()group by owner_id
  union all select owner_id,min(public.peris_science_deadline(owner_id))from public.peris_account_science where active_id is not null and public.peris_science_deadline(owner_id)<=now()group by owner_id
  union all select owner_id,min(next_at)from public.peris_campaign_farms where enabled and next_at<=now()group by owner_id
  union all select attacker_owner_id,min(last_tick_at)from public.battles where status='active'group by attacker_owner_id
 )q left join public.peris_worker_owners w on w.owner_id=q.owner_id group by q.owner_id,w.last_processed_at order by coalesce(w.last_processed_at,'1970-01-01'::timestamptz),min(q.due),q.owner_id limit p_limit loop
  begin
   perform public.peris_settle(owner);
   for farm in select * from public.peris_campaign_farms where owner_id=owner and enabled and next_at<=now()order by next_at,id limit 100 for update loop
    begin
     if farm.route is null then raise exception 'Start this target manually once to establish its land route';end if;
     perform public.peris_prepare_raid_for(owner,farm.army_id,farm.camp_id,farm.route,farm.troops);
     update public.armies set farm_list_id=farm.list_id where id=farm.army_id;
     update public.peris_campaign_farms set last_status='Raid preparing',sent=sent+1 where id=farm.id;
    exception when others then update public.peris_campaign_farms set last_status=sqlerrm,skipped=skipped+1 where id=farm.id;end;
    update public.peris_campaign_farms set next_at=now()+make_interval(secs=>farm.interval_seconds)where id=farm.id;
   end loop;
   perform public.peris_sync_owner(owner);
   for bid in select id from public.battles where status='active'and attacker_owner_id=owner order by id loop perform public.peris_tick_for(bid,owner);end loop;
   insert into public.peris_worker_owners(owner_id,last_processed_at)values(owner,now())on conflict(owner_id)do update set last_processed_at=excluded.last_processed_at;
   processed:=processed+1;
  exception when others then raise warning 'Peris worker could not process owner %: %',owner,sqlerrm;end;
 end loop;
 for camp_id in select s.camp_id from public.peris_camp_stock s where s.next_recruit_at<=now() or s.stock_updated_at<=now()-interval '1 minute'order by least(s.next_recruit_at,s.stock_updated_at+interval '1 minute'),s.camp_id limit 100 loop perform public.peris_camp_accrue(camp_id);end loop;
 return jsonb_build_object('processed',processed);
end $$;
