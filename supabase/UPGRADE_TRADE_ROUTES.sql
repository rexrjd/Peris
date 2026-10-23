-- PERIS automatic trade routes. Apply after UPGRADE_MARKET.sql. Review and back up first; never deployed automatically.
begin;
-- One backend is one world. Operational/security/audit clocks remain real UTC.
create table if not exists public.peris_world_clock(
 id boolean primary key default true check(id),
 version integer not null default 1 check(version=1),
 rate integer not null default 1 check(rate in(1,10,100)),
 profile_id text not null default 'normal-v1' check(profile_id in('normal-v1','accelerated-test-v1')),
 real_anchor timestamptz not null,game_anchor timestamptz not null,
 check(profile_id<>'normal-v1'or rate=1)
);
insert into public.peris_world_clock(id,real_anchor,game_anchor)values(true,now(),now())on conflict(id)do nothing;
alter table public.peris_world_clock enable row level security;
revoke all on public.peris_world_clock from public,anon,authenticated;

create or replace function public.peris_game_now()returns timestamptz
language sql stable security definer set search_path='' as $$
 select game_anchor+(now()-real_anchor)*rate from public.peris_world_clock where id
$$;
create or replace function public.peris_clock_snapshot()returns jsonb
language sql stable security definer set search_path='' as $$
 select jsonb_build_object('version',version,'rate',rate,'profile_id',profile_id,'real_now',now(),'game_now',public.peris_game_now())from public.peris_world_clock where id
$$;
-- Private operator setup, only before the first account in a disposable backend.
create or replace function public.peris_configure_test_clock(p_rate integer)returns void
language plpgsql security definer set search_path='' as $$
begin
 if p_rate is null or p_rate not in(1,10,100)then raise exception 'Invalid test clock rate';end if;
 perform pg_advisory_xact_lock(204200);
 if exists(select 1 from public.players)then raise exception 'Test clock configuration requires an empty world';end if;
 update public.peris_world_clock set rate=p_rate,profile_id='accelerated-test-v1',real_anchor=now(),game_anchor=now()where id;
end $$;
revoke all on function public.peris_game_now(),public.peris_clock_snapshot(),public.peris_configure_test_clock(integer)from public,anon,authenticated;
-- Core tables exist before this module, including on legacy upgrades.
-- Defaults affect new rows only; accepted dates and balances are untouched.
alter table public.armies alter column departure_at set default public.peris_game_now();
alter table public.armies alter column arrival_at set default public.peris_game_now();
alter table public.battles alter column started_at set default public.peris_game_now();
alter table public.battles alter column last_tick_at set default public.peris_game_now();
alter table public.settlements alter column resources_updated_at set default public.peris_game_now();
alter table public.peris_challenges alter column expires_at set default public.peris_game_now()+interval '90 seconds';

-- Never wait for a player while retaining another participant's row/land lock.
-- Exception rollback releases every lock acquired in this helper on contention.
create or replace function public.peris_lock_battle_participants(p_attacker uuid,p_defender uuid)returns boolean
language plpgsql security definer set search_path='' as $$
begin
 if exists(select 1 from public.peris_settler_expeditions where owner_id in(p_attacker,p_defender)and status='travelling'and arrival_at<=public.peris_game_now())
  and not pg_try_advisory_xact_lock(204200)then raise lock_not_available;end if;
 perform 1 from public.players where id in(p_attacker,p_defender)order by id for update nowait;
 return true;
exception when lock_not_available then return false;
end $$;
revoke all on function public.peris_lock_battle_participants(uuid,uuid)from public,anon,authenticated;

-- Optional hooks keep focused upgrades usable before guild support is installed.
-- No public reads, schema mutation, or synthetic troop state on older worlds.
create or replace function public.peris_optional_guild_reinforcements()returns jsonb
language plpgsql stable security definer set search_path='' as $$
begin
 if to_regprocedure('public.peris_guild_reinforcement_status()')is null then return '[]'::jsonb;end if;
 return public.peris_guild_reinforcement_status();
end $$;
revoke all on function public.peris_optional_guild_reinforcements()from public,anon,authenticated;

create or replace function public.peris_due_guild_reinforcements()returns table(owner_id uuid,due timestamptz)
language plpgsql stable security definer set search_path='' as $$
begin
 if to_regclass('public.peris_guild_reinforcements')is null then return;end if;
 return query
 select r.owner_id,min(r.arrival_at)from public.peris_guild_reinforcements r
 where r.status in('outbound','returning')and r.arrival_at<=public.peris_game_now()group by r.owner_id
 union all
 select r.owner_id,min(public.peris_game_now())from public.peris_guild_reinforcements r
 join public.settlements s on s.id=r.target_settlement_id
 where r.status='stationed'and (s.ruined_at is not null or not exists(
  select 1 from public.peris_guild_members a join public.peris_guild_members b on b.guild_id=a.guild_id
  where a.player_id=r.owner_id and b.player_id=r.recipient_id))group by r.owner_id;
end $$;
revoke all on function public.peris_due_guild_reinforcements()from public,anon,authenticated;

-- Optional dependencies keep older focused installers valid without creating trade state.
create or replace function public.peris_optional_trade_caravans()returns jsonb
language plpgsql stable security definer set search_path='' as $$
begin
 if to_regprocedure('public.peris_trade_status()')is null then return '[]'::jsonb;end if;
 return public.peris_trade_status();
end $$;
create or replace function public.peris_due_trade_caravans()returns table(owner_id uuid,due timestamptz)
language plpgsql stable security definer set search_path='' as $$
begin
 if to_regclass('public.peris_trade_caravans')is null then return;end if;
 return query select c.owner_id,min(case c.status when 'outbound'then c.arrival_at when 'returning'then least(c.return_at,c.redirect_at) else public.peris_game_now()end)
 from public.peris_trade_caravans c where c.status in('waiting','stranded')or(c.status='outbound'and c.arrival_at<=public.peris_game_now())or(c.status='returning'and least(c.return_at,c.redirect_at)<=public.peris_game_now())group by c.owner_id;
end $$;
revoke all on function public.peris_optional_trade_caravans(),public.peris_due_trade_caravans()from public,anon,authenticated;

create or replace function public.peris_settle_core(p_owner uuid,p_until timestamptz default public.peris_game_now()) returns void
language plpgsql security definer set search_path='' as $$
declare s public.settlements%rowtype;o public.peris_orders%rowtype;event record;target_slot integer;field_col integer;field_row integer;arriving_army bigint;
begin
 -- Cell reservation lock precedes player locks everywhere, including offline arrivals.
 if exists(select 1 from public.peris_settler_expeditions where owner_id=p_owner and status='travelling'and arrival_at<=p_until)then perform pg_advisory_xact_lock(204200);end if;
 perform 1 from public.players where id=p_owner for update;
 if not found then return;end if;
 if exists(select 1 from public.players where id=p_owner and defeated_at is not null)then return;end if;
 perform public.peris_ruin_advance(p_owner,p_until);
 perform public.peris_city_reinforcements_advance(p_owner,p_until);
 if to_regprocedure('public.peris_guild_reinforcements_advance(uuid,timestamp with time zone)')is not null then
  perform public.peris_guild_reinforcements_advance(p_owner,p_until);
 end if;
 for s in select * from public.settlements where owner_id=p_owner and ruined_at is null order by id for update loop
 perform public.peris_city_migrate(s.id);if not s.population_ready then perform public.peris_city_economy(s.id);end if;
 end loop;
 for event in select id,finish_at as at_time,false as expedition from public.peris_orders where owner_id=p_owner and finish_at<=p_until
 union all select id,arrival_at as at_time,true as expedition from public.peris_settler_expeditions where owner_id=p_owner and status='travelling'and arrival_at<=p_until
 order by at_time,expedition,id loop
 perform public.peris_science_advance(p_owner,event.at_time);
 perform public.peris_culture_accrue(p_owner,event.at_time);
 if event.expedition then perform public.peris_found_complete(event.id);continue;end if;
 select * into o from public.peris_orders where id=event.id for update;
 select * into s from public.settlements where id=coalesce(o.settlement_id,(select min(id)from public.settlements where owner_id=p_owner and ruined_at is null))and owner_id=p_owner for update;
 if s.id is null or s.ruined_at is not null then delete from public.peris_orders where id=o.id;continue;end if;
 perform public.peris_population_accrue(s.id,o.finish_at);
 if o.kind='upgrade' then
  if o.item like 'slot:%' then
   target_slot:=split_part(o.item,':',2)::integer;
   update public.peris_city_slots set level=least(case when building_type='mage_tower' then 10 else 5 end,level+1)where settlement_id=s.id and slot_index=target_slot;
  else update public.buildings set level=least(5,level+1),updated_at=o.finish_at where settlement_id=s.id and building_type=o.item;end if;
  update public.players set upgrades=upgrades+1 where id=p_owner;update public.settlements set development_points=development_points+1 where id=s.id;perform public.peris_city_economy(s.id);
 elsif o.kind='field' then
  field_col:=split_part(o.item,':',2)::integer;field_row:=split_part(o.item,':',3)::integer;
  update public.peris_map_plots set level=level+1 where col=field_col and row=field_row and owner_id=p_owner and settlement_id=s.id and building_type=split_part(o.item,':',4) and level<5;
  if not found then raise exception 'Queued external field no longer matches its owner or building';end if;
  update public.players set upgrades=upgrades+1 where id=p_owner;update public.settlements set development_points=development_points+1 where id=s.id;perform public.peris_city_economy(s.id);
 elsif o.kind='settler'then update public.settlements set settlers=settlers+o.quantity where id=s.id;
 elsif o.kind='recruit' then
  if o.recruit_destination='garrison' then
   perform public.peris_city_garrison_receive(p_owner,s.id,jsonb_build_object(o.item,o.quantity));
  else
   perform public.peris_recruit_complete(coalesce(o.army_id,(select min(id)from public.armies where owner_id=p_owner)),o.item,o.quantity);
  end if;
  update public.players set recruits=recruits+o.quantity where id=p_owner;
 end if;
 delete from public.peris_orders where id=o.id;
 end loop;
 perform public.peris_science_advance(p_owner,p_until);
 perform public.peris_culture_accrue(p_owner,p_until);
 for s in select * from public.settlements where owner_id=p_owner and ruined_at is null order by id loop perform public.peris_population_accrue(s.id,p_until);end loop;
 for arriving_army in select id from public.armies where owner_id=p_owner and status='moving' and raid_target_id is null and raid_city_id is null and arrival_at<=p_until order by id for update loop
  if not exists(select 1 from public.armies a where a.id=arriving_army and public.peris_station_owned(p_owner,floor(a.target_x/128.0)::integer,floor(a.target_y/128.0)::integer))then
   perform public.peris_ruin_redirect_army(arriving_army);continue;
  end if;
  perform public.peris_deliver_loot(arriving_army);
  update public.armies set status='idle',start_x=target_x,start_y=target_y,march_path=null,march_distance=null,
   march_sent_at=null,march_cancel_until=null,march_origin=null,march_returning=false,updated_at=p_until where id=arriving_army;
  if not exists(select 1 from public.battles b join public.settlements c on c.id=b.raid_city_id join public.armies a on a.id=arriving_army where b.status='active'and b.defender_owner_id=p_owner and floor(c.x/128.0)=floor(a.target_x/128.0)and floor(c.y/128.0)=floor(a.target_y/128.0))then perform public.peris_garrison_merge(arriving_army);end if;
 end loop;
 -- Attack arrivals retain their outbound route for the eventual return.
 update public.armies set status='idle',start_x=target_x,start_y=target_y,updated_at=p_until where owner_id=p_owner and status='moving'and arrival_at<=p_until;
end $$;
revoke all on function public.peris_settle_core(uuid,timestamptz)from public,anon,authenticated;

do $$begin if to_regclass('public.peris_trade_caravans')is null then raise exception 'Install UPGRADE_MARKET.sql first';end if;end $$;
-- These hooks are deliberately installable without the optional route table.
create or replace function public.peris_optional_trade_routes()returns jsonb
language plpgsql stable security definer set search_path='' as $$
begin
 if to_regclass('public.peris_trade_routes')is null then return '[]'::jsonb;end if;
 return(select coalesce(jsonb_agg(r order by r.source_settlement_id,r.id),'[]'::jsonb)from public.peris_trade_routes r where r.owner_id=public.peris_player_id());
end $$;
create or replace function public.peris_due_trade_routes()returns table(owner_id uuid,due timestamptz)
language plpgsql stable security definer set search_path='' as $$
begin
 if to_regclass('public.peris_trade_routes')is null then return;end if;
 return query select r.owner_id,min(r.next_run_at)from public.peris_trade_routes r where r.enabled and r.next_run_at<=public.peris_game_now()group by r.owner_id;
end $$;
-- Include future routes: any route may become due while its component is settling.
create or replace function public.peris_trade_route_edges()returns table(owner_id uuid,recipient_id uuid)
language plpgsql stable security definer set search_path='' as $$
begin
 if to_regclass('public.peris_trade_routes')is null then return;end if;
 return query select r.owner_id,r.recipient_id from public.peris_trade_routes r where r.enabled;
end $$;
create or replace function public.peris_optional_advance_trade_routes(p_owner uuid,p_at timestamptz)returns void
language plpgsql security definer set search_path='' as $$
begin
 if to_regprocedure('public.peris_advance_trade_routes(uuid,timestamp with time zone)')is not null then perform public.peris_advance_trade_routes(p_owner,p_at);end if;
end $$;
revoke all on function public.peris_optional_trade_routes(),public.peris_due_trade_routes(),public.peris_trade_route_edges(),public.peris_optional_advance_trade_routes(uuid,timestamptz)from public,anon,authenticated;

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

create or replace function public.peris_dispatch_caravan(p_owner uuid,p_source bigint,p_target bigint,p_resources jsonb,p_path jsonb,p_at timestamptz)returns jsonb
language plpgsql security definer set search_path='' as $$
declare u uuid:=p_owner;s public.settlements%rowtype;d public.settlements%rowtype;bag jsonb:='{}';key text;amount numeric;volume integer:=0;used integer;capacity integer;origin jsonb;arrival jsonb;distance numeric;new_id bigint;
begin
 if u is null then raise exception 'Authentication required';end if;
 if exists(select 1 from public.players where id=u and defeated_at is not null)then raise exception 'This ruler has been permanently defeated';end if;
 if p_resources is null or jsonb_typeof(p_resources)<>'object'or octet_length(p_resources::text)>500 then raise exception 'Choose positive whole resource quantities';end if;
 if exists(select 1 from jsonb_object_keys(p_resources)k where k not in('wood','stone','food','gold'))then raise exception 'Unknown resource';end if;
 foreach key in array array['wood','stone','food','gold']loop
  if p_resources?key then
   if jsonb_typeof(p_resources->key)<>'number'then raise exception 'Choose positive whole resource quantities';end if;
   amount:=(p_resources->>key)::numeric;
   if amount<0 or amount<>trunc(amount)or amount>5000 then raise exception 'Choose positive whole resource quantities';end if;
  else amount:=0;end if;
  bag:=bag||jsonb_build_object(key,amount::integer);volume:=volume+amount::integer;
 end loop;
 if volume=0 then raise exception 'Choose positive whole resource quantities';end if;
 if not pg_try_advisory_xact_lock(72320)then raise lock_not_available;end if;
 select * into s from public.settlements where id=p_source and owner_id=u and ruined_at is null;
 if s.id is null then raise exception 'Choose your living source city';end if;
 select * into d from public.settlements where id=p_target and ruined_at is null;
 if d.id is null or d.id=s.id or not(d.owner_id=u or exists(select 1 from public.peris_guild_members a join public.peris_guild_members b on b.guild_id=a.guild_id where a.player_id=u and b.player_id=d.owner_id))then raise exception 'Choose another own or guild city';end if;
 if not public.peris_lock_battle_participants(u,d.owner_id)then raise lock_not_available;end if;
 perform 1 from public.settlements where id in(p_source,p_target)order by id for update nowait;
 select * into s from public.settlements where id=p_source and owner_id=u and ruined_at is null;
 select * into d from public.settlements where id=p_target and ruined_at is null;
 if s.id is null or d.id is null then raise exception 'Choose living cities';end if;
 select coalesce(sum(level),0)*1000 into capacity from public.peris_city_slots where settlement_id=s.id and building_type='bazaar';
 select coalesce(sum(c.volume),0)into used from public.peris_trade_caravans c where c.source_settlement_id=s.id and c.status<>'completed';
 if volume>capacity-used then raise exception 'Insufficient free Market capacity';end if;
 if s.wood<(bag->>'wood')::integer or s.stone<(bag->>'stone')::integer or s.food<(bag->>'food')::integer or s.gold<(bag->>'gold')::integer then raise exception 'Insufficient resources';end if;
 origin:=public.peris_home_army_position(s.x,s.y);arrival:=public.peris_home_army_position(d.x,d.y);
 distance:=public.peris_route_distance((origin->>'x')::numeric,(origin->>'y')::numeric,(arrival->>'x')::numeric,(arrival->>'y')::numeric,p_path);
 update public.settlements set wood=wood-(bag->>'wood')::integer,stone=stone-(bag->>'stone')::integer,food=food-(bag->>'food')::integer,gold=gold-(bag->>'gold')::integer where id=s.id;
 insert into public.peris_trade_caravans(owner_id,recipient_id,source_settlement_id,target_settlement_id,source_city,target_city,resources,returning_resources,volume,march_path,departure_at,arrival_at,return_at)
 values(u,d.owner_id,s.id,d.id,s.name,d.name,bag,bag,volume,p_path,p_at,p_at+make_interval(secs=>greatest(2,distance/22)::double precision),p_at+make_interval(secs=>2*greatest(2,distance/22)::double precision))returning id into new_id;
 return jsonb_build_object('ok',true,'caravan_id',new_id);
end $$;
create or replace function public.peris_send_resources(p_source bigint,p_target bigint,p_resources jsonb,p_path jsonb)returns jsonb
language plpgsql security definer set search_path='' as $$
declare u uuid:=public.peris_player_id();recipient uuid;answer jsonb;
begin
 if u is null then raise exception 'Authentication required';end if;
 if not pg_try_advisory_xact_lock(72320)then raise lock_not_available;end if;
 select owner_id into recipient from public.settlements where id=p_target and ruined_at is null;
 if recipient is null then raise exception 'Choose another own or guild city';end if;
 if not public.peris_lock_battle_participants(u,recipient)then raise lock_not_available;end if;
 perform public.peris_settle(u);perform public.peris_settle(recipient);
 answer:=public.peris_dispatch_caravan(u,p_source,p_target,p_resources,p_path,public.peris_game_now());
 -- Sending can open storage for an earlier waiting return.
 perform public.peris_settle(u);
 return answer;
end $$;
create or replace function public.peris_trade_participants(p_owner uuid)returns uuid[]
language sql stable security definer set search_path='' as $$
 with recursive participants(id)as(select p_owner union select case when r.owner_id=p.id then r.recipient_id else r.owner_id end
 from participants p join(select owner_id,recipient_id from public.peris_trade_caravans where status<>'completed' union select owner_id,recipient_id from public.peris_trade_route_edges())r on(r.owner_id=p.id or r.recipient_id=p.id))
 select array_agg(id order by id)from participants
$$;
create or replace function public.peris_market_settle(p_owner uuid,p_until timestamptz)returns void
language plpgsql security definer set search_path='' as $$
declare participants uuid[];participant uuid;event record;r record;
begin
 -- Same structural lock as guild mutations. NOWAIT avoids waiting while callers hold player rows.
 if not pg_try_advisory_xact_lock(72320)then raise lock_not_available using message='Guild or trade state is settling. Try again.';end if;
 participants:=public.peris_trade_participants(p_owner);
 if exists(select 1 from public.peris_settler_expeditions where owner_id=any(participants)and status='travelling'and arrival_at<=p_until)
 and not pg_try_advisory_xact_lock(204200)then raise lock_not_available;end if;
 perform 1 from public.players where id=any(participants)order by id for update nowait;
 if participants is distinct from public.peris_trade_participants(p_owner)then raise serialization_failure using message='Trade participants changed. Try again.';end if;
 perform 1 from public.settlements where owner_id=any(participants)order by id for update nowait;
 -- Advancing everyone only to each next deadline prevents sender/receiver recursion and time travel.
 loop
  select q.id,q.at_time into event from(
   select c.id,case when c.status='outbound'then c.arrival_at else least(c.return_at,case when public.peris_trade_volume(c.returning_resources)>0 then c.redirect_at else null end)end as at_time
   from public.peris_trade_caravans c left join public.settlements s on s.id=c.return_settlement_id
   where c.owner_id=any(participants)and c.status in('outbound','returning'))q where q.at_time<=p_until order by q.at_time,q.id limit 1;
  exit when not found;
  foreach participant in array participants loop perform public.peris_settle_core(participant,event.at_time);end loop;
  perform public.peris_trade_event(event.id,event.at_time);
 end loop;
 foreach participant in array participants loop perform public.peris_settle_core(participant,p_until);end loop;
 for r in select id from public.peris_trade_caravans where owner_id=any(participants)and status in('waiting','stranded')order by id loop perform public.peris_trade_event(r.id,p_until);end loop;
 foreach participant in array participants loop perform public.peris_optional_advance_trade_routes(participant,p_until);end loop;
 -- Retain a useful bounded sender history; receipts remain separately journaled.
 delete from public.peris_trade_caravans c where c.owner_id=any(participants)and c.status='completed'and c.id not in(
  select keep.id from public.peris_trade_caravans keep where keep.owner_id=c.owner_id and keep.status='completed'order by keep.completed_at desc,keep.id desc limit 50);
end $$;
create or replace function public.peris_snapshot()returns jsonb language plpgsql security definer set search_path='' as $$
declare u uuid:=public.peris_player_id();result jsonb;
begin
 if u is null then raise exception 'Authentication required';end if;
 perform public.peris_note_account_activity();
 perform public.peris_science_ensure(u);
 perform public.peris_city_migrate(s.id) from public.settlements s where s.owner_id=u;
 select jsonb_build_object('version',6,'server_now',public.peris_game_now(),'game_clock',public.peris_clock_snapshot(),
 'debug_enabled',coalesce((select enabled from public.peris_debug_config where id),false),
 'map',jsonb_build_object('version',4,'cols',200,'rows',200,'cell_size',128,'seed',1346720329,
   'total_players',(select count(*) from public.players),'total_settlements',(select count(*) from public.settlements)),
 'gameplay_version',1,'unit_balance_version',2,
 'account_science',coalesce((select jsonb_agg(s)from public.peris_account_science s where s.owner_id=u),'[]'::jsonb),
 'research_progress',coalesce((select jsonb_agg(p order by technology_id)from public.peris_research_progress p where p.owner_id=u),'[]'::jsonb),
 'heroes',coalesce((select jsonb_agg(h order by id)from public.peris_heroes h where owner_id=u),'[]'::jsonb),
 'hero_artifacts',coalesce((select jsonb_agg(i order by id)from public.peris_hero_artifacts i where owner_id=u),'[]'::jsonb),
 'settler_expeditions',coalesce((select jsonb_agg(e order by id)from public.peris_settler_expeditions e where owner_id=u),'[]'::jsonb),
 'campaign_farm_lists',coalesce((select jsonb_agg(l order by id)from public.peris_campaign_farm_lists l where owner_id=u),'[]'::jsonb),
 'campaign_farms',coalesce((select jsonb_agg(f order by id)from public.peris_campaign_farms f where owner_id=u),'[]'::jsonb),
 'campaign_farm_stats',coalesce((select jsonb_agg(jsonb_build_object('owner_id',u,'camp_id',s.camp_id,'raids',s.raids,'last_raid_at',coalesce(s.result->>'delivered_at',s.created_at::text),'last_loot',s.delivered,'total_loot',s.total_loot,'last_result',coalesce(s.winner_side,case when s.won then 'attacker'else 'defender'end),'last_losses',coalesce((s.result->>'attacker_losses')::integer,0))order by s.camp_id)from(
   select r.*,b.winner_side,coalesce((r.result#>>'{delivered,wood}')::numeric,0)+coalesce((r.result#>>'{delivered,stone}')::numeric,0)+coalesce((r.result#>>'{delivered,food}')::numeric,0)+coalesce((r.result#>>'{delivered,gold}')::numeric,0)as delivered,
    count(*)over(partition by r.camp_id)as raids,
    sum(coalesce((r.result#>>'{delivered,wood}')::numeric,0)+coalesce((r.result#>>'{delivered,stone}')::numeric,0)+coalesce((r.result#>>'{delivered,food}')::numeric,0)+coalesce((r.result#>>'{delivered,gold}')::numeric,0))over(partition by r.camp_id)as total_loot,
    row_number()over(partition by r.camp_id order by coalesce((r.result->>'delivered_at')::timestamptz,r.created_at)desc,r.id desc)as rank
   from public.peris_reports r join public.peris_camps c on c.id=r.camp_id and c.bandit left join public.battles b on b.id=r.battle_id where r.owner_id=u and r.result?'delivered'
  )s where s.rank=1),'[]'::jsonb),
 'garrisons',coalesce((select jsonb_agg(g order by row,col)from public.peris_garrisons g where owner_id=u),'[]'::jsonb),
 'trade_routes',public.peris_optional_trade_routes(),
 'trade_caravans',public.peris_optional_trade_caravans(),
 'guild_reinforcements',public.peris_optional_guild_reinforcements(),
 'city_reinforcements',coalesce((select jsonb_agg(r order by r.arrival_at,r.id)from public.peris_city_reinforcements r where r.owner_id=u),'[]'::jsonb),
 'city_garrisons',coalesce((select jsonb_agg(to_jsonb(g)||jsonb_build_object('infantry',public.peris_roster_class(g.unit_roster,'infantry'),'archers',public.peris_roster_class(g.unit_roster,'archers'),'cavalry',public.peris_roster_class(g.unit_roster,'cavalry'))order by g.settlement_id)from public.peris_city_garrisons g where g.owner_id=u),'[]'::jsonb),
 'ruin_evacuations',coalesce((select jsonb_agg(e order by e.arrival_at)from public.peris_ruin_evacuations e where e.owner_id=u),'[]'::jsonb),
 'players',coalesce((select jsonb_agg(p order by created_at)from public.players p where p.id=u
   or exists(select 1 from public.battles b where (b.attacker_owner_id=u or b.defender_owner_id=u) and (b.attacker_owner_id=p.id or b.defender_owner_id=p.id))
   or exists(select 1 from public.peris_challenges c where c.status='pending' and c.expires_at>public.peris_game_now() and (c.attacker_owner_id=u or c.defender_owner_id=u) and (c.attacker_owner_id=p.id or c.defender_owner_id=p.id))),'[]'::jsonb),
 'settlements',coalesce((select jsonb_agg(s order by id)from public.settlements s where s.owner_id=u),'[]'::jsonb),
 'buildings',coalesce((select jsonb_agg(b order by b.id)from public.buildings b join public.settlements s on s.id=b.settlement_id where s.owner_id=u),'[]'::jsonb),
 'unit_research',coalesce((select jsonb_agg(r order by r.unit)from public.peris_unit_research r join public.settlements s on s.id=r.settlement_id where s.owner_id=u),'[]'::jsonb),
 'spell_research',coalesce((select jsonb_agg(r order by r.spell_id)from public.peris_spell_research r join public.settlements s on s.id=r.settlement_id where s.owner_id=u),'[]'::jsonb),
 'city_slots',coalesce((select jsonb_agg(c order by c.slot_index)from public.peris_city_slots c join public.settlements s on s.id=c.settlement_id where s.owner_id=u),'[]'::jsonb),
 'map_plots',coalesce((select jsonb_agg(p order by p.row,p.col)from public.peris_map_plots p where p.owner_id=u),'[]'::jsonb),
 'armies',coalesce((select jsonb_agg(a order by id)from public.armies a where a.owner_id=u),'[]'::jsonb),
 'camps',coalesce((select jsonb_agg(to_jsonb(c)||jsonb_build_object('resources',stock.resources,'stock_updated_at',stock.stock_updated_at)order by c.id)from public.peris_camps c left join public.peris_camp_stock stock on stock.camp_id=c.id),'[]'::jsonb),
 'orders',coalesce((select jsonb_agg(o order by finish_at)from public.peris_orders o where owner_id=u),'[]'::jsonb),
 'battles',coalesce((select jsonb_agg(b order by id)from public.battles b where attacker_owner_id=u or defender_owner_id=u),'[]'::jsonb),
 'formations',coalesce((select jsonb_agg(f order by f.id)from public.battle_formations f join public.battles b on b.id=f.battle_id where b.status='active'and (b.attacker_owner_id=u or b.defender_owner_id=u)),'[]'::jsonb),
 'reports',coalesce((select jsonb_agg(r order by id desc)from (select * from public.peris_reports where owner_id=u and (coalesce((peris_reports.result->>'attacker_losses')::integer,0)>0 or not exists(select 1 from public.peris_campaign_farm_lists l where l.id=peris_reports.farm_list_id and l.owner_id=u and l.casualties_only)) order by id desc limit 50)r),'[]'::jsonb),
 'report_count',(select count(*)from public.peris_reports r where owner_id=u and (coalesce((r.result->>'attacker_losses')::integer,0)>0 or not exists(select 1 from public.peris_campaign_farm_lists l where l.id=r.farm_list_id and l.owner_id=u and l.casualties_only))),
 'hidden_report_count',(select count(*)from public.peris_reports r where owner_id=u and coalesce((r.result->>'attacker_losses')::integer,0)=0 and exists(select 1 from public.peris_campaign_farm_lists l where l.id=r.farm_list_id and l.owner_id=u and l.casualties_only)),
 'unread_report_count',(select count(*)from public.peris_reports r where owner_id=u and r.read_at is null and (coalesce((r.result->>'attacker_losses')::integer,0)>0 or not exists(select 1 from public.peris_campaign_farm_lists l where l.id=r.farm_list_id and l.owner_id=u and l.casualties_only))),
 'progress',coalesce((select jsonb_agg(p)from public.peris_progress p where owner_id=u),'[]'::jsonb),
 'claims',coalesce((select jsonb_agg(c)from public.peris_claims c where owner_id=u),'[]'::jsonb),
 'challenges',coalesce((select jsonb_agg(c)from public.peris_challenges c where (attacker_owner_id=u or defender_owner_id=u)and status='pending'and expires_at>public.peris_game_now()),'[]'::jsonb))into result;
 return result;
end $$;
create or replace function public.peris_game_tick(p_limit integer default 40)returns jsonb
language plpgsql security definer set search_path='' as $$
declare owner uuid;farm public.peris_campaign_farms%rowtype;processed integer:=0;camp_id integer;
 attempted integer:=0;failed integer:=0;camp_failed integer:=0;
 started timestamptz:=clock_timestamp();pass_started timestamptz;battles jsonb;
begin
 if p_limit is null or p_limit not between 1 and 100 then raise exception 'Use a worker budget of 1Ã¢â‚¬“100 owners';end if;
 if not pg_try_advisory_xact_lock(204215)then return jsonb_build_object('busy',true);end if;
 delete from public.peris_worker_owners w where not exists(select 1 from public.players p where p.id=w.owner_id);
 battles:=public.peris_advance_battles(20,2000);pass_started:=clock_timestamp();
 for owner in select q.owner_id from(
  select owner_id,min(arrival_at)as due from public.armies where (status='moving' or raid_target_id is not null or raid_city_id is not null)and arrival_at<=public.peris_game_now() group by owner_id
  union all select owner_id,min(arrival_at)from public.peris_settler_expeditions where status='travelling'and arrival_at<=public.peris_game_now()group by owner_id
  union all select owner_id,min(arrival_at)from public.peris_ruin_evacuations where arrival_at<=public.peris_game_now()group by owner_id
  union all select owner_id,min(arrival_at)from public.peris_city_reinforcements where arrival_at<=public.peris_game_now()group by owner_id
  union all select owner_id,due from public.peris_due_trade_routes()
  union all select owner_id,due from public.peris_due_trade_caravans()
  union all select owner_id,due from public.peris_due_guild_reinforcements()
  union all select owner_id,min(finish_at)from public.peris_orders where finish_at<=public.peris_game_now()group by owner_id
  union all select owner_id,min(public.peris_science_deadline(owner_id))from public.peris_account_science where active_id is not null and public.peris_science_deadline(owner_id)<=public.peris_game_now()group by owner_id
  union all select owner_id,min(next_at)from public.peris_campaign_farms where enabled and next_at<=public.peris_game_now()group by owner_id
 )q left join public.peris_worker_owners w on w.owner_id=q.owner_id
 where w.next_attempt_at is null or w.next_attempt_at<=clock_timestamp()
 group by q.owner_id,w.last_processed_at,w.last_attempt_at order by coalesce(w.last_attempt_at,w.last_processed_at,'1970-01-01'::timestamptz),min(q.due),q.owner_id limit p_limit loop
  exit when extract(epoch from(clock_timestamp()-pass_started))*1000>=2000;
  attempted:=attempted+1;
  begin
   if exists(select 1 from public.peris_settler_expeditions where owner_id=owner and status='travelling'and arrival_at<=public.peris_game_now())and not pg_try_advisory_xact_lock(204200)then raise lock_not_available;end if;
   perform 1 from public.players where id=owner for update nowait;
   perform public.peris_sync_owner(owner);
   for farm in select * from public.peris_campaign_farms where owner_id=owner and enabled and next_at<=public.peris_game_now()order by next_at,id limit 100 for update skip locked loop
    exit when extract(epoch from(clock_timestamp()-pass_started))*1000>=2000;
    begin
     if farm.route is null then raise exception 'Start this target manually once to establish its land route';end if;
     perform public.peris_prepare_raid_for(owner,farm.army_id,farm.camp_id,farm.route,farm.troops);
     update public.armies set farm_list_id=farm.list_id where id=farm.army_id;
     update public.peris_campaign_farms set last_status='Raid preparing',sent=sent+1 where id=farm.id;
    exception when others then update public.peris_campaign_farms set last_status=sqlerrm,skipped=skipped+1 where id=farm.id;end;
    update public.peris_campaign_farms set next_at=public.peris_game_now()+make_interval(secs=>farm.interval_seconds)where id=farm.id;
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
 for camp_id in select s.camp_id from public.peris_camp_stock s where s.next_recruit_at<=public.peris_game_now() or s.stock_updated_at<=public.peris_game_now()-interval '1 minute'order by least(s.next_recruit_at,s.stock_updated_at+interval '1 minute'),s.camp_id limit 100 loop
  exit when extract(epoch from(clock_timestamp()-pass_started))*1000>=500;
  begin perform public.peris_camp_accrue(camp_id);exception when others then camp_failed:=camp_failed+1;end;
 end loop;
 return jsonb_build_object('processed',processed,'attempted',attempted,'failed',failed,'battles',battles,'camps_failed',camp_failed,'duration_ms',extract(epoch from(clock_timestamp()-started))*1000);
end $$;
create or replace function public.peris_submit_command(p_request_id uuid,p_function text,p_args jsonb)
returns jsonb language plpgsql security definer set search_path='' as $$
declare u uuid:=public.peris_player_id();previous public.peris_command_receipts%rowtype;answer jsonb;
begin
 if u is null or not exists(select 1 from public.players where id=u)then raise exception 'Authentication required';end if;
 if p_request_id is null or p_function is null or p_args is null or jsonb_typeof(p_args)<>'object' or octet_length(p_args::text)>100000 then raise exception 'Choose a valid command';end if;
 perform pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended(u::text||':'||p_request_id::text,0));
 select * into previous from public.peris_command_receipts where owner_id=u and request_id=p_request_id;
 if previous.request_id is not null then
  if previous.function_name is distinct from p_function or previous.arguments is distinct from p_args then raise exception 'This request belongs to a different command';end if;
  return previous.response;
 end if;
 if exists(select 1 from public.players where id=u and defeated_at is not null)then raise exception 'This ruler has been permanently defeated';end if;
 -- A fixed whitelist keeps the receipt endpoint from invoking private helpers.
 case p_function
 when 'peris_trade_route_command' then answer:=public.peris_trade_route_command(p_args->'p_command');
 when 'peris_send_resources' then answer:=public.peris_send_resources((p_args->>'p_source')::bigint,(p_args->>'p_target')::bigint,p_args->'p_resources',p_args->'p_path');
 when 'peris_send_guild_reinforcements' then answer:=public.peris_send_guild_reinforcements((p_args->>'p_source')::bigint,(p_args->>'p_target')::bigint,p_args->'p_troops',p_args->'p_path',(p_args->>'p_army')::bigint);
 when 'peris_recall_guild_reinforcements' then answer:=public.peris_recall_guild_reinforcements((p_args->>'p_id')::bigint);
 when 'peris_empire_command' then answer:=public.peris_empire_command(p_args->'p_command');
 when 'peris_campaign_farm_command' then answer:=public.peris_campaign_farm_command(p_args->'p_command');
 when 'peris_research_unit' then answer:=public.peris_research_unit((p_args->>'p_city')::bigint,p_args->>'p_unit');
 when 'peris_collect_garrison' then answer:=public.peris_collect_garrison((p_args->>'p_army')::bigint,nullif(p_args->'p_troops','null'::jsonb));
 when 'peris_claim_field' then answer:=public.peris_claim_field((p_args->>'p_col')::integer,(p_args->>'p_row')::integer);
 when 'peris_queue_field' then answer:=public.peris_queue_field((p_args->>'p_col')::integer,(p_args->>'p_row')::integer,p_args->>'p_type');
 when 'peris_set_faction' then perform public.peris_set_faction(p_args->>'p_faction');answer:='{}'::jsonb;
 when 'peris_debug_city' then perform public.peris_debug_city(p_args->>'p_action',p_args->>'p_target',(p_args->>'p_value')::integer);answer:='{}'::jsonb;
 when 'peris_research_spell' then answer:=public.peris_research_spell(p_args->>'p_spell');
 when 'peris_queue_slot' then answer:=public.peris_queue_slot((p_args->>'p_slot')::integer,p_args->>'p_type');
 when 'peris_queue_upgrade' then answer:=public.peris_queue_upgrade(p_args->>'p_type');
 when 'peris_queue_recruit' then answer:=public.peris_queue_recruit(p_args->>'p_type',(p_args->>'p_quantity')::integer);
 when 'peris_march' then answer:=public.peris_march((p_args->>'p_target_x')::integer,(p_args->>'p_target_y')::integer,p_args->'p_path');
 when 'move_army' then answer:=public.move_army((p_args->>'p_target_x')::integer,(p_args->>'p_target_y')::integer);
 when 'peris_raid' then answer:=public.peris_raid((p_args->>'p_camp_id')::integer);
 when 'peris_ready' then answer:=public.peris_ready((p_args->>'p_battle_id')::bigint);
 when 'retreat_from_battle' then answer:=public.retreat_from_battle((p_args->>'p_battle_id')::bigint);
 when 'peris_claim' then answer:=public.peris_claim(p_args->>'p_quest_id');
 when 'peris_rename' then answer:=public.peris_rename(p_args->>'p_name');
 when 'peris_challenge' then answer:=public.peris_challenge((p_args->>'p_defender')::uuid);
 when 'peris_respond' then answer:=public.peris_respond((p_args->>'p_id')::bigint,(p_args->>'p_accept')::boolean);
 else raise exception 'This command is not available';
 end case;
 insert into public.peris_command_receipts(owner_id,request_id,function_name,arguments,response)values(u,p_request_id,p_function,p_args,coalesce(answer,'{}'::jsonb));
 return coalesce(answer,'{}'::jsonb);
end $$;
revoke all on function public.peris_dispatch_caravan(uuid,bigint,bigint,jsonb,jsonb,timestamptz),public.peris_send_resources(bigint,bigint,jsonb,jsonb),public.peris_trade_participants(uuid),public.peris_market_settle(uuid,timestamptz)from public,anon,authenticated;
notify pgrst,'reload schema';
commit;