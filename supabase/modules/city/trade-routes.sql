-- Owner-private recurring instructions. Actual cargo always remains in peris_trade_caravans.
create table if not exists public.peris_trade_routes(
 id bigint generated always as identity primary key,
 owner_id uuid not null references public.players(id),recipient_id uuid not null references public.players(id),
 source_settlement_id bigint not null references public.settlements(id),target_settlement_id bigint not null references public.settlements(id),
 source_city text not null,target_city text not null,resources jsonb not null,march_path jsonb not null,
 interval_seconds integer not null check(interval_seconds between 300 and 86400),
 deliveries integer not null check(deliveries between 1 and 3),deliveries_left integer not null default 0 check(deliveries_left between 0 and 3),
 enabled boolean not null default true,next_run_at timestamptz not null,next_cycle_at timestamptz not null,
 last_status text not null default 'Scheduled',last_sent_at timestamptz,sent integer not null default 0,skipped integer not null default 0,
 updated_at timestamptz not null default public.peris_game_now()
);
create index if not exists peris_trade_routes_due on public.peris_trade_routes(owner_id,next_run_at)where enabled;
create index if not exists peris_trade_routes_source on public.peris_trade_routes(source_settlement_id);
alter table public.peris_trade_routes enable row level security;
revoke all on public.peris_trade_routes from public,anon,authenticated;
grant select on public.peris_trade_routes to authenticated;
drop policy if exists "own automatic trade routes"on public.peris_trade_routes;
create policy "own automatic trade routes"on public.peris_trade_routes for select to authenticated using(owner_id=public.peris_player_id());

-- First strictly future boundary, preserving the original fixed schedule.
create or replace function public.peris_trade_route_future(p_anchor timestamptz,p_interval integer,p_at timestamptz)returns timestamptz
language sql immutable set search_path='' as $$
 select p_anchor+make_interval(secs=>(greatest(0,floor(extract(epoch from(p_at-p_anchor))/p_interval)+1)*p_interval)::double precision)
$$;

create or replace function public.peris_trade_route_command(p_command jsonb)returns jsonb
language plpgsql security definer set search_path='' as $$
declare u uuid:=public.peris_player_id();r public.peris_trade_routes%rowtype;s public.settlements%rowtype;d public.settlements%rowtype;
 key text;amount numeric;bag jsonb:='{}';volume integer:=0;capacity integer;route jsonb;origin jsonb;destination jsonb;
 step integer;batch integer;first_at timestamptz;at_time timestamptz:=public.peris_game_now();new_id bigint;
begin
 if u is null then raise exception 'Authentication required';end if;
 if p_command is null or jsonb_typeof(p_command)<>'object'or octet_length(p_command::text)>100000 then raise exception 'Choose a valid route command';end if;
 if not pg_try_advisory_xact_lock(72320)then raise lock_not_available;end if;
 perform 1 from public.players where id=u for update nowait;
 if exists(select 1 from public.players where id=u and defeated_at is not null)then raise exception 'This ruler has been permanently defeated';end if;
 if p_command?'id'then
  if jsonb_typeof(p_command->'id')<>'number'or(p_command->>'id')::numeric<>trunc((p_command->>'id')::numeric)then raise exception 'Choose a valid route';end if;
  select * into r from public.peris_trade_routes where id=(p_command->>'id')::bigint and owner_id=u for update;
  if r.id is null then raise exception 'Choose your route';end if;
 end if;
 if p_command->>'type'='deleteTradeRoute'then
  if r.id is null then raise exception 'Choose your route';end if;
  delete from public.peris_trade_routes where id=r.id;return jsonb_build_object('ok',true,'route_id',r.id);
 elsif p_command->>'type'='setTradeRouteEnabled'then
  if r.id is null or jsonb_typeof(p_command->'enabled')is distinct from 'boolean'then raise exception 'Choose a route and enabled state';end if;
  update public.peris_trade_routes set enabled=(p_command->>'enabled')::boolean,deliveries_left=0,
   next_run_at=case when(p_command->>'enabled')::boolean then at_time else next_run_at end,
   next_cycle_at=case when(p_command->>'enabled')::boolean then at_time else next_cycle_at end,
   last_status=case when(p_command->>'enabled')::boolean then 'Scheduled'else 'Paused'end,updated_at=at_time where id=r.id;
  return jsonb_build_object('ok',true,'route_id',r.id);
 elsif p_command->>'type'is distinct from 'saveTradeRoute'then raise exception 'Choose a valid route command';end if;
 if jsonb_typeof(p_command->'intervalSeconds')is distinct from 'number'or jsonb_typeof(p_command->'deliveries')is distinct from 'number'
 or(p_command->>'intervalSeconds')::numeric<>trunc((p_command->>'intervalSeconds')::numeric)
 or(p_command->>'deliveries')::numeric<>trunc((p_command->>'deliveries')::numeric)then raise exception 'Choose whole route interval and deliveries';end if;
 step:=(p_command->>'intervalSeconds')::integer;batch:=(p_command->>'deliveries')::integer;
 if step not between 300 and 86400 or batch not between 1 and 3 then raise exception 'Choose interval 300 to 86400 and deliveries 1 to 3';end if;
 if jsonb_typeof(p_command->'firstRunAt')is distinct from 'string'or(p_command->>'firstRunAt')!~'^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(\.\d{1,6})?(Z|[+-]\d{2}:\d{2})$'then raise exception 'Choose a valid first departure';end if;
 begin first_at:=(p_command->>'firstRunAt')::timestamptz;exception when others then raise exception 'Choose a valid first departure';end;
 if not isfinite(first_at)or first_at>at_time+interval '7 days'then raise exception 'First departure must be within seven game days';end if;
 first_at:=greatest(first_at,at_time);
 if jsonb_typeof(p_command->'resources')is distinct from 'object'or octet_length((p_command->'resources')::text)>500 then raise exception 'Choose positive whole resource quantities';end if;
 if exists(select 1 from jsonb_object_keys(p_command->'resources')k where k not in('wood','stone','food','gold'))then raise exception 'Unknown resource';end if;
 foreach key in array array['wood','stone','food','gold']loop
  amount:=0;
  if(p_command->'resources')?key then
   if jsonb_typeof(p_command->'resources'->key)<>'number'then raise exception 'Choose positive whole resource quantities';end if;
   amount:=(p_command->'resources'->>key)::numeric;
   if amount<0 or amount>5000 or amount<>trunc(amount)then raise exception 'Choose positive whole resource quantities';end if;
  end if;
  bag:=bag||jsonb_build_object(key,amount::integer);volume:=volume+amount::integer;
 end loop;
 if volume not between 1 and 5000 then raise exception 'Choose a load of 1 to 5000 resources';end if;
 if jsonb_typeof(p_command->'settlementId')is distinct from 'number'or jsonb_typeof(p_command->'targetCityId')is distinct from 'number'
 or(p_command->>'settlementId')::numeric<>trunc((p_command->>'settlementId')::numeric)
 or(p_command->>'targetCityId')::numeric<>trunc((p_command->>'targetCityId')::numeric)then raise exception 'Choose valid cities';end if;
 select * into s from public.settlements where id=(p_command->>'settlementId')::bigint and owner_id=u and ruined_at is null;
 select * into d from public.settlements where id=(p_command->>'targetCityId')::bigint and ruined_at is null;
 if s.id is null then raise exception 'Choose your living source city';end if;
 if d.id is null or d.id=s.id or exists(select 1 from public.players where id=d.owner_id and defeated_at is not null)
 or not(d.owner_id=u or exists(select 1 from public.peris_guild_members a join public.peris_guild_members b on b.guild_id=a.guild_id where a.player_id=u and b.player_id=d.owner_id))then raise exception 'Choose another own or guild city';end if;
 select coalesce(sum(level),0)*1000 into capacity from public.peris_city_slots where settlement_id=s.id and building_type='bazaar';
 if volume>capacity then raise exception 'Insufficient completed Market capacity';end if;
 if(select count(*)from public.peris_trade_routes where source_settlement_id=s.id and id is distinct from r.id)>=20 then raise exception 'A city can have at most 20 automatic routes';end if;
 route:=p_command->'route';origin:=public.peris_home_army_position(s.x,s.y);destination:=public.peris_home_army_position(d.x,d.y);
 perform public.peris_route_distance((origin->>'x')::numeric,(origin->>'y')::numeric,(destination->>'x')::numeric,(destination->>'y')::numeric,route);
 if r.id is null then
  insert into public.peris_trade_routes(owner_id,recipient_id,source_settlement_id,target_settlement_id,source_city,target_city,resources,march_path,interval_seconds,deliveries,next_run_at,next_cycle_at)
   values(u,d.owner_id,s.id,d.id,s.name,d.name,bag,route,step,batch,first_at,first_at)returning id into new_id;
 else
  new_id:=r.id;
  update public.peris_trade_routes set recipient_id=d.owner_id,source_settlement_id=s.id,target_settlement_id=d.id,source_city=s.name,target_city=d.name,
   resources=bag,march_path=route,interval_seconds=step,deliveries=batch,deliveries_left=0,next_run_at=first_at,next_cycle_at=first_at,last_status=case when enabled then 'Scheduled'else 'Paused'end,updated_at=at_time where id=r.id;
 end if;
 return jsonb_build_object('ok',true,'route_id',new_id);
end $$;

-- Caller has locked the entire active trade/route component and advanced stocks to p_at.
-- Never settle recursively, never spend at missed historical departures, never loop a batch.
create or replace function public.peris_advance_trade_routes(p_owner uuid,p_at timestamptz)returns void
language plpgsql security definer set search_path='' as $$
declare r public.peris_trade_routes%rowtype;anchor timestamptz;missed integer;left_count integer;answer jsonb;return_time timestamptz;reason text;capacity integer;
begin
 for r in select * from public.peris_trade_routes where owner_id=p_owner and enabled and next_run_at<=p_at order by next_run_at,id for update loop
  anchor:=r.next_cycle_at;left_count:=r.deliveries_left;missed:=0;
  if left_count=0 then
   anchor:=public.peris_trade_route_future(anchor,r.interval_seconds,p_at);
   missed:=greatest(0,round(extract(epoch from(anchor-r.next_cycle_at))/r.interval_seconds)::integer-1);
   left_count:=r.deliveries;
  end if;
  begin
   if not exists(select 1 from public.settlements s join public.players p on p.id=s.owner_id where s.id=r.source_settlement_id and s.owner_id=r.owner_id and s.ruined_at is null and p.defeated_at is null)then raise exception 'Source city is no longer living or owned';end if;
   if not exists(select 1 from public.settlements s join public.players p on p.id=s.owner_id where s.id=r.target_settlement_id and s.owner_id=r.recipient_id and s.ruined_at is null and p.defeated_at is null)
   or not(r.owner_id=r.recipient_id or exists(select 1 from public.peris_guild_members a join public.peris_guild_members b on b.guild_id=a.guild_id where a.player_id=r.owner_id and b.player_id=r.recipient_id))then raise exception 'Recipient is no longer an eligible own or guild city';end if;
   select coalesce(sum(level),0)*1000 into capacity from public.peris_city_slots where settlement_id=r.source_settlement_id and building_type='bazaar';
   if capacity<public.peris_trade_volume(r.resources)then raise exception 'Completed Market capacity is no longer sufficient';end if;
   answer:=public.peris_dispatch_caravan(r.owner_id,r.source_settlement_id,r.target_settlement_id,r.resources,r.march_path,p_at);
   select return_at into return_time from public.peris_trade_caravans where id=(answer->>'caravan_id')::bigint;
   left_count:=left_count-1;
   if left_count=0 then
    missed:=missed+greatest(0,round(extract(epoch from(public.peris_trade_route_future(anchor,r.interval_seconds,p_at)-anchor))/r.interval_seconds)::integer);
    anchor:=public.peris_trade_route_future(anchor,r.interval_seconds,p_at);
   end if;
   update public.peris_trade_routes set deliveries_left=left_count,next_cycle_at=anchor,next_run_at=case when left_count>0 then return_time else anchor end,
    last_status='Caravan sent',last_sent_at=p_at,sent=sent+1,skipped=skipped+missed,updated_at=p_at where id=r.id;
  exception when lock_not_available or serialization_failure or deadlock_detected then raise;
  when others then
   reason:=sqlerrm;
   if reason in('Insufficient resources','Insufficient free Market capacity')then
    missed:=missed+greatest(0,round(extract(epoch from(public.peris_trade_route_future(anchor,r.interval_seconds,p_at)-anchor))/r.interval_seconds)::integer);
    anchor:=public.peris_trade_route_future(anchor,r.interval_seconds,p_at);
    update public.peris_trade_routes set deliveries_left=0,next_run_at=anchor,next_cycle_at=anchor,last_status=reason,skipped=skipped+missed+1,updated_at=p_at where id=r.id;
   else
    update public.peris_trade_routes set enabled=false,deliveries_left=0,last_status=reason,skipped=skipped+missed+1,updated_at=p_at where id=r.id;
   end if;
  end;
 end loop;
end $$;
revoke all on function public.peris_trade_route_future(timestamptz,integer,timestamptz),public.peris_trade_route_command(jsonb),public.peris_advance_trade_routes(uuid,timestamptz)from public,anon,authenticated;
