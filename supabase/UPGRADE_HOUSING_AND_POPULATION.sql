-- PERIS housing and population. Generated from modular source.
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

-- Catch up completed legacy construction and income before introducing consumption.
do $$declare city record;begin
 if to_regprocedure('public.peris_settle(uuid,timestamptz)')is not null and not exists(select 1 from information_schema.columns where table_schema='public' and table_name='settlements' and column_name='population')then
  for city in select owner_id from public.settlements loop perform public.peris_settle(city.owner_id,public.peris_game_now());end loop;
 end if;
end $$;
-- Civilian population, housing and production-worker economy.
-- External fields keep their terrain-adjusted income independently of city staffing.
alter table public.settlements add column if not exists population numeric(18,6) not null default 30 check(population between 10 and 2500);
alter table public.settlements add column if not exists population_capacity integer not null default 40;
alter table public.settlements add column if not exists workers_required integer not null default 0;
alter table public.settlements add column if not exists wood_bonus numeric not null default 0;
alter table public.settlements add column if not exists stone_bonus numeric not null default 0;
alter table public.settlements add column if not exists food_bonus numeric not null default 0;
alter table public.settlements add column if not exists gold_bonus numeric not null default 0;
alter table public.settlements add column if not exists food_gross_rate numeric not null default 18;
alter table public.settlements add column if not exists food_upkeep numeric not null default 3.6;
alter table public.settlements add column if not exists population_ready boolean not null default false;
alter table public.settlements add column if not exists field_wood_rate numeric not null default 0;
alter table public.settlements add column if not exists field_stone_rate numeric not null default 0;
alter table public.settlements add column if not exists field_food_rate numeric not null default 0;
alter table public.settlements add column if not exists field_gold_rate numeric not null default 0;
alter table public.settlements alter column wood_rate type numeric(18,8);
alter table public.settlements alter column stone_rate type numeric(18,8);
alter table public.settlements alter column food_rate type numeric(18,8);
alter table public.settlements alter column gold_rate type numeric(18,8);
alter table public.peris_city_slots drop constraint if exists peris_city_slots_building_type_check;
alter table public.peris_city_slots add constraint peris_city_slots_building_type_check check(building_type in ('barracks','stables','workshop','smithy','warehouse','granary','fishery','mage_tower','housing','academy','bazaar'));
create or replace function public.peris_population_event(p_value double precision,p_rate double precision,p_slope double precision,p_target double precision,p_limit double precision)returns double precision language plpgsql immutable set search_path='' as $$
declare disc double precision;t double precision;result double precision:=p_limit;
begin
 if abs(p_slope)<1e-9 then if abs(p_rate)>1e-9 then t:=(p_target-p_value)/p_rate;if t>1e-9 then result:=least(result,t);end if;end if;
 else disc:=p_rate*p_rate-2*p_slope*(p_value-p_target);if disc>=0 then
  t:=(-p_rate-sqrt(disc))/p_slope;if t>1e-9 then result:=least(result,t);end if;
  t:=(-p_rate+sqrt(disc))/p_slope;if t>1e-9 then result:=least(result,t);end if;
 end if;end if;return result;
end $$;
create or replace function public.peris_population_accrue(p_sid bigint,p_until timestamptz)returns void language plpgsql security definer set search_path='' as $$
declare s public.settlements%rowtype;remaining double precision;p double precision;cap double precision;jobs double precision;staff double precision;growth double precision;factor double precision;food_slope double precision;net double precision;gross double precision;dt double precision;zero_at double precision;food_full boolean;i integer;
begin
 select * into s from public.settlements where id=p_sid for update;if s.id is null then return;end if;
 remaining:=greatest(0,extract(epoch from(p_until-s.resources_updated_at)))/60;
 if not s.population_ready then
  update public.settlements set wood=least(capacity,greatest(0,wood+wood_rate*remaining)),stone=least(capacity,greatest(0,stone+stone_rate*remaining)),
   food=least(food_capacity,greatest(0,food+food_rate*remaining)),gold=least(capacity,greatest(0,gold+gold_rate*remaining)),resources_updated_at=greatest(resources_updated_at,p_until)where id=s.id;return;
 end if;
 p:=greatest(10,least(s.population_capacity,s.population));cap:=s.population_capacity;jobs:=s.workers_required;
 for i in 1..64 loop
  exit when remaining<=1e-9;staff:=least(1,p/greatest(1,jobs));gross:=(18+s.field_food_rate+s.food_bonus*staff)*s.food_research;net:=gross-.12*p;
  growth:=case when s.food>1e-9 or net>1e-9 then case when p<cap-1e-9 then 1 else 0 end when net< -1e-9 and p>10+1e-9 then -1 else 0 end;
  factor:=case when jobs>0 and (p<jobs-1e-9 or abs(p-jobs)<1e-9 and growth<0)then growth/jobs else 0 end;food_slope:=s.food_bonus*factor*s.food_research-.12*growth;
  dt:=remaining;if growth>0 then dt:=least(dt,cap-p);elsif growth<0 then dt:=least(dt,p-10);end if;
  if growth<>0 and ((growth>0 and p<jobs-1e-9)or(growth<0 and p>jobs+1e-9))then dt:=least(dt,abs(jobs-p));end if;
  food_full:=s.food>=s.food_capacity-1e-9 and (net>1e-9 or abs(net)<=1e-9 and food_slope>=0);
  if not food_full then dt:=public.peris_population_event(s.food::double precision,net,food_slope,0,dt);dt:=public.peris_population_event(s.food::double precision,net,food_slope,s.food_capacity,dt);end if;
  if abs(food_slope)>1e-9 then zero_at:=-net/food_slope;if zero_at>1e-9 then dt:=least(dt,zero_at);end if;end if;exit when dt<=1e-9;
  s.wood:=least(s.capacity,greatest(0,s.wood+((14+s.field_wood_rate+s.wood_bonus*staff)*dt+s.wood_bonus*factor*dt*dt/2)*s.wood_research));
  s.stone:=least(s.capacity,greatest(0,s.stone+((12+s.field_stone_rate+s.stone_bonus*staff)*dt+s.stone_bonus*factor*dt*dt/2)*s.stone_research));
  s.gold:=least(s.capacity,greatest(0,s.gold+((3+s.field_gold_rate*s.trade_research+s.gold_bonus*staff)*dt+s.gold_bonus*factor*dt*dt/2)*s.gold_research));
  s.food:=greatest(0,least(s.food_capacity,case when food_full then s.food_capacity else s.food+net*dt+food_slope*dt*dt/2 end));
  p:=greatest(10,least(cap,p+growth*dt));remaining:=remaining-dt;
 end loop;
 staff:=least(1,p/greatest(1,jobs));gross:=(18+s.field_food_rate+s.food_bonus*staff)*s.food_research;
 update public.settlements set population=p,wood=s.wood,stone=s.stone,food=s.food,gold=s.gold,
  wood_rate=(14+s.field_wood_rate+s.wood_bonus*staff)*s.wood_research,stone_rate=(12+s.field_stone_rate+s.stone_bonus*staff)*s.stone_research,gold_rate=(3+s.field_gold_rate*s.trade_research+s.gold_bonus*staff)*s.gold_research,food_rate=gross-.12*p,food_gross_rate=gross,food_upkeep=.12*p,
  resources_updated_at=greatest(resources_updated_at,p_until)where id=s.id;
end $$;
create or replace function public.peris_city_economy(p_sid bigint)returns void language plpgsql security definer set search_path='' as $$
declare main integer;lumber integer;quarry integer;farm integer;fish integer;homes integer;s public.settlements%rowtype;staff numeric;fw numeric:=0;fs numeric:=0;ff numeric:=0;fg numeric:=0;
begin
 select * into s from public.settlements where id=p_sid for update;if s.id is null then return;end if;
 if not s.population_ready then perform public.peris_population_accrue(p_sid,public.peris_game_now());select * into s from public.settlements where id=p_sid;end if;
 select coalesce(max(level)filter(where building_type='market'),0),coalesce(max(level)filter(where building_type='lumber'),0),coalesce(max(level)filter(where building_type='quarry'),0),coalesce(max(level)filter(where building_type='farm'),0) into main,lumber,quarry,farm from public.buildings where settlement_id=p_sid;
 select coalesce(sum(level)filter(where building_type='fishery'),0),coalesce(sum(level)filter(where building_type='housing'),0) into fish,homes from public.peris_city_slots where settlement_id=p_sid;
 s.population_capacity:=40+10*main+30*homes;s.population:=greatest(10,least(s.population_capacity,s.population));s.workers_required:=4*main+6*lumber+6*quarry+5*farm+4*fish;
 if to_regprocedure('public.peris_field_rates(bigint)')is not null then execute 'select wood,stone,food,gold from public.peris_field_rates($1)' into fw,fs,ff,fg using p_sid;end if;
 s.wood_research:=public.peris_research_factor(s.owner_id,'wood');s.stone_research:=public.peris_research_factor(s.owner_id,'stone');s.food_research:=public.peris_research_factor(s.owner_id,'food');s.gold_research:=public.peris_research_factor(s.owner_id,'gold');s.trade_research:=public.peris_research_factor(s.owner_id,'trade');
 staff:=least(1,s.population/greatest(1,s.workers_required));
 update public.settlements set population=s.population,population_capacity=s.population_capacity,workers_required=s.workers_required,population_ready=true,
  wood_research=s.wood_research,stone_research=s.stone_research,food_research=s.food_research,gold_research=s.gold_research,trade_research=s.trade_research,
  field_wood_rate=fw,field_stone_rate=fs,field_food_rate=ff,field_gold_rate=fg,
  wood_bonus=8*lumber,stone_bonus=7*quarry,food_bonus=10*farm+8*fish,gold_bonus=3*main,
  wood_rate=(14+fw+8*lumber*staff)*s.wood_research,stone_rate=(12+fs+7*quarry*staff)*s.stone_research,food_gross_rate=(18+ff+(10*farm+8*fish)*staff)*s.food_research,food_upkeep=.12*s.population,food_rate=(18+ff+(10*farm+8*fish)*staff)*s.food_research-.12*s.population-coalesce((to_jsonb(s)->>'food_troop_upkeep')::numeric,0),gold_rate=(3+fg*s.trade_research+3*main*staff)*s.gold_research,
  capacity=floor((5000+2500*coalesce((select sum(level) from public.peris_city_slots where settlement_id=p_sid and building_type='warehouse'),0))*public.peris_research_factor(s.owner_id,'storage')),
  food_capacity=floor((5000+2500*coalesce((select sum(level) from public.peris_city_slots where settlement_id=p_sid and building_type='granary'),0))*public.peris_research_factor(s.owner_id,'storage'))where id=p_sid;
end $$;
-- Settle legacy income before initializing population; repeated upgrades preserve it.
do $$declare city record;begin for city in select id from public.settlements loop perform public.peris_city_migrate(city.id);perform public.peris_city_economy(city.id);end loop;end $$;
revoke all on function public.peris_population_event(double precision,double precision,double precision,double precision,double precision),public.peris_population_accrue(bigint,timestamptz),public.peris_city_economy(bigint) from public,anon,authenticated;

notify pgrst,'reload schema';

do $restore_crop$begin if to_regclass('public.peris_crop_version')is not null then execute $crop_definition$-- Hourly combat troop crop consumption. Private helpers; never a public economy feed.
alter table public.settlements add column if not exists food_troop_upkeep numeric not null default 0;
alter table public.settlements add column if not exists starvation_losses bigint not null default 0;
alter table public.settlements add column if not exists starvation_last_at timestamptz;
alter table public.settlements add column if not exists troop_upkeep_ready boolean not null default false;
alter table public.battle_formations add column if not exists starvation_losses integer not null default 0;
alter table public.battles add column if not exists starvation_sources jsonb not null default '{}';
alter table public.battles add column if not exists food_settled boolean not null default false;
create table if not exists public.peris_crop_version(id boolean primary key default true check(id),activated_at timestamptz);
alter table public.peris_crop_version enable row level security;
revoke all on public.peris_crop_version from public,anon,authenticated;
insert into public.peris_crop_version(id)values(true)on conflict do nothing;

-- Preserve the pre-feature integrator and completion logic for non-retroactive migration.
do $$begin
 if to_regprocedure('public.peris_population_accrue_legacy(bigint,timestamptz)')is null then
  execute replace(pg_get_functiondef('public.peris_population_accrue(bigint,timestamptz)'::regprocedure),'public.peris_population_accrue(','public.peris_population_accrue_legacy(');
 end if;
 if to_regprocedure('public.peris_market_settle_legacy(uuid,timestamptz)')is null then
  execute replace(pg_get_functiondef('public.peris_market_settle(uuid,timestamptz)'::regprocedure),'public.peris_market_settle(','public.peris_market_settle_legacy(');
 end if;
end $$;

create or replace function public.peris_troop_upkeep(p_roster jsonb)returns numeric
language sql immutable set search_path='' as $$
 select coalesce(sum(greatest(0,coalesce((p_roster->>unit)::numeric,0))*case when unit='catapult'then 4 when unit='ram'then 3 when unit in('cavalry','scout','heavyCavalry')then 2 else 1 end),0)/60
 from unnest(array['infantry','spearmen','archers','elite','cavalry','scout','heavyCavalry','ram','catapult'])unit
$$;

create or replace function public.peris_supply_city(p_owner uuid,p_col integer,p_row integer)returns bigint
language sql stable security definer set search_path='' as $$
 select id from public.settlements where owner_id=p_owner and ruined_at is null and public.peris_wrap_cell(floor(x/128.0)::integer)=public.peris_wrap_cell(p_col)and public.peris_wrap_cell(floor(y/128.0)::integer)=public.peris_wrap_cell(p_row)
 union all select s.id from public.peris_map_plots p join public.settlements s on s.id=p.settlement_id and s.ruined_at is null where p.owner_id=p_owner and p.col=public.peris_wrap_cell(p_col)and p.row=public.peris_wrap_cell(p_row)limit 1
$$;

create or replace function public.peris_supply_rows(p_sid bigint,p_at timestamptz)returns table(kind text,key text,owner_id uuid,tier integer,troops jsonb)
language plpgsql stable security definer set search_path='' as $$
#variable_conflict use_column
declare a public.armies%rowtype;r record;source bigint;home bigint;station bigint;origin jsonb;travelling boolean;
begin
 for a in select * from public.armies loop
  home:=coalesce((select id from public.settlements where id=a.home_settlement_id and owner_id=a.owner_id and ruined_at is null),(select min(id)from public.settlements where owner_id=a.owner_id and ruined_at is null));
  origin:=a.march_origin;
  source:=coalesce(case when origin is not null then public.peris_supply_city(a.owner_id,floor((origin->>'x')::numeric/128)::integer,floor((origin->>'y')::numeric/128)::integer)end,home);
  travelling:=a.status='moving'and a.departure_at<=p_at or a.raid_target_id is not null or a.raid_city_id is not null or exists(select 1 from public.battles b where b.attacker_army_id=a.id and b.mode<>'practice'and b.status='active'and not b.food_settled);
  if a.status='moving'and a.departure_at>p_at then station:=coalesce(public.peris_supply_city(a.owner_id,floor(a.start_x/128.0)::integer,floor(a.start_y/128.0)::integer),source);travelling:=false;
  elsif travelling then station:=source;
  else station:=coalesce(public.peris_supply_city(a.owner_id,floor(a.target_x/128.0)::integer,floor(a.target_y/128.0)::integer),home);end if;
  if station=p_sid then kind:='army';key:='army:'||a.id;owner_id:=a.owner_id;tier:=case when travelling then 4 when station<>home then 2 else 3 end;troops:=public.peris_roster(to_jsonb(a));return next;end if;
  if a.raid_reserve is not null and home=p_sid then kind:='reserve';key:='reserve:'||a.id;owner_id:=a.owner_id;tier:=3;troops:=public.peris_roster(a.raid_reserve);return next;end if;
 end loop;
 for r in select * from public.peris_city_garrisons where settlement_id=p_sid loop kind:='city';key:='city:'||p_sid;owner_id:=r.owner_id;tier:=3;troops:=public.peris_roster(r.unit_roster);return next;end loop;
 for r in select g.* from public.peris_garrisons g where public.peris_supply_city(g.owner_id,g.col,g.row)=p_sid loop kind:='station';key:='station:'||r.owner_id||':'||r.col||':'||r.row;owner_id:=r.owner_id;tier:=3;troops:=public.peris_roster(to_jsonb(r));return next;end loop;
 for r in select * from public.peris_city_reinforcements loop
  source:=coalesce((select id from public.settlements where id=r.source_settlement_id and owner_id=r.owner_id and ruined_at is null),(select id from public.settlements where id=r.target_settlement_id and owner_id=r.owner_id and ruined_at is null),(select min(id)from public.settlements where owner_id=r.owner_id and ruined_at is null));
  if source=p_sid then kind:='reinforcement';key:='reinforcement:'||r.id;owner_id:=r.owner_id;tier:=4;troops:=public.peris_roster(r.troops);return next;end if;
 end loop;
 for r in select * from public.peris_guild_reinforcements loop
  source:=coalesce(case when r.status='stationed'then(select id from public.settlements where id=r.target_settlement_id and ruined_at is null)else coalesce((select id from public.settlements where id=r.source_settlement_id and owner_id=r.owner_id and ruined_at is null),(select id from public.settlements where id=r.target_settlement_id and owner_id=r.owner_id and ruined_at is null))end,(select min(id)from public.settlements where owner_id=r.owner_id and ruined_at is null));
  if source=p_sid then kind:='guild';key:='guild:'||r.id;owner_id:=r.owner_id;tier:=case when r.status='stationed'then 1 else 4 end;troops:=public.peris_roster(r.troops);return next;end if;
 end loop;
 for r in select * from public.peris_ruin_evacuations loop
  source:=coalesce((select id from public.settlements where id=r.target_settlement_id and owner_id=r.owner_id and ruined_at is null),(select min(id)from public.settlements where owner_id=r.owner_id and ruined_at is null));
  if source=p_sid then kind:='evacuation';key:='evacuation:'||r.id;owner_id:=r.owner_id;tier:=4;troops:=public.peris_roster(r.troops);return next;end if;
 end loop;
end $$;

create or replace function public.peris_supply_refresh(p_sid bigint,p_at timestamptz)returns void
language plpgsql security definer set search_path='' as $$
declare amount numeric;
begin
 select coalesce(sum(public.peris_troop_upkeep(troops)),0)into amount from public.peris_supply_rows(p_sid,p_at);
 update public.settlements set food_troop_upkeep=amount,food_rate=food_gross_rate-food_upkeep-amount where id=p_sid and troop_upkeep_ready and ruined_at is null;
end $$;

create or replace function public.peris_supply_battle_loss(p_key text,p_unit text)returns void
language plpgsql security definer set search_path='' as $$
declare b public.battles%rowtype;party jsonb;captured integer;already integer;formation bigint;own_side text;source_key text;
begin
 for b in select * from public.battles where status='active'and mode<>'practice'and not food_settled order by id for update loop
  own_side:=null;captured:=0;
  if p_key='army:'||b.attacker_army_id then own_side:='attacker';
  elsif b.raid_city_id is null and p_key='army:'||b.defender_army_id then own_side:='defender';
  elsif b.raid_city_id is not null then
   for party in select value from jsonb_array_elements(b.city_defenders)loop
    source_key:=case when party?'army_id'then 'army:'||(party->>'army_id')when party?'city_garrison_id'then 'city:'||(party->>'city_garrison_id')when party?'guild_reinforcement_id'then 'guild:'||(party->>'guild_reinforcement_id')else 'station:'||b.defender_owner_id||':'||(party->>'col')||':'||(party->>'row')end;
    if source_key=p_key then own_side:='defender';captured:=coalesce((party->'troops'->>p_unit)::integer,0);exit;end if;
   end loop;
  end if;
  if own_side is null then continue;end if;
  if b.raid_city_id is null or own_side='attacker'then select coalesce(sum(initial_soldiers),0)into captured from public.battle_formations where battle_id=b.id and side=own_side and coalesce(recruit_unit,unit_type)=p_unit;end if;
  already:=coalesce((b.starvation_sources#>>array[p_key,p_unit])::integer,0);
  if already>=captured then continue;end if;
  select id into formation from public.battle_formations where battle_id=b.id and side=own_side and coalesce(recruit_unit,unit_type)=p_unit and starvation_losses<initial_soldiers order by initial_soldiers-starvation_losses desc,id limit 1 for update;
  if formation is null then continue;end if;
  update public.battles set starvation_sources=jsonb_set(starvation_sources,array[p_key],coalesce(starvation_sources->p_key,'{}')||jsonb_build_object(p_unit,already+1))where id=b.id;
  update public.battle_formations set starvation_losses=starvation_losses+1,soldiers=least(soldiers,initial_soldiers-starvation_losses-1),status=case when least(soldiers,initial_soldiers-starvation_losses-1)=0 then 'routed'else status end where id=formation;
 end loop;
end $$;

-- Every healing path, including future spells, obeys permanent starvation caps.
create or replace function public.peris_starvation_cap()returns trigger language plpgsql set search_path='' as $$
begin new.starvation_losses:=greatest(0,least(new.initial_soldiers,new.starvation_losses));new.soldiers:=least(new.soldiers,new.initial_soldiers-new.starvation_losses);return new;end $$;
drop trigger if exists peris_starvation_cap on public.battle_formations;
create trigger peris_starvation_cap before insert or update on public.battle_formations for each row execute function public.peris_starvation_cap();

create or replace function public.peris_supply_party_key(p_party jsonb,p_owner uuid)returns text language sql immutable set search_path='' as $$
 select case when p_party?'army_id'then 'army:'||(p_party->>'army_id')when p_party?'city_garrison_id'then 'city:'||(p_party->>'city_garrison_id')when p_party?'guild_reinforcement_id'then 'guild:'||(p_party->>'guild_reinforcement_id')else 'station:'||p_owner||':'||(p_party->>'col')||':'||(p_party->>'row')end
$$;

create or replace function public.peris_food_roster_after(p_bid bigint,p_side text,p_current jsonb)returns jsonb
language plpgsql stable security definer set search_path='' as $$
declare b public.battles%rowtype;initial jsonb;remaining jsonb;starved jsonb;source_key text;unit text;loss integer;result jsonb:=public.peris_roster(p_current);
begin
 select * into b from public.battles where id=p_bid;
 source_key:='army:'||case when p_side='attacker'then b.attacker_army_id else b.defender_army_id end;
 starved:=coalesce(b.starvation_sources->source_key,'{}');
 for unit in select c.unit from public.peris_unit_catalog c loop
  select greatest(0,coalesce(sum(initial_soldiers-soldiers),0)-coalesce((starved->>unit)::integer,0))into loss from public.battle_formations where battle_id=p_bid and side=p_side and coalesce(recruit_unit,unit_type)=unit;
  result:=jsonb_set(result,array[unit],to_jsonb(greatest(0,coalesce((result->>unit)::integer,0)-loss)));
 end loop;return result;
end $$;

create or replace function public.peris_food_finish(p_bid bigint)returns void
language plpgsql security definer set search_path='' as $$
declare b public.battles%rowtype;owner uuid;city record;party jsonb;row_item record;source_key text;side_name text;initial integer;survivors integer;starved integer;loss integer;credit numeric;source_city bigint;role text;
begin
 select * into b from public.battles where id=p_bid for update;if b.id is null or b.status<>'active'or b.mode='practice'or b.food_settled then return;end if;
 if not public.peris_lock_battle_participants(b.attacker_owner_id,b.defender_owner_id)then raise lock_not_available;end if;
 -- Supply is still the committed backing roster up to irreversible finalization.
 perform public.peris_settle(b.attacker_owner_id);if b.defender_owner_id is not null then perform public.peris_settle(b.defender_owner_id);end if;
 select * into b from public.battles where id=p_bid;
 for side_name in select unnest(array['attacker','defender'])loop
  owner:=case when side_name='attacker'then b.attacker_owner_id else b.defender_owner_id end;if owner is null then continue;end if;
  source_key:='army:'||case when side_name='attacker'then b.attacker_army_id else b.defender_army_id end;
  if side_name='defender'and b.raid_city_id is not null then source_city:=b.raid_city_id;
  else select s.id into source_city from public.settlements s cross join lateral public.peris_supply_rows(s.id,public.peris_game_now())r where s.ruined_at is null and r.key=source_key limit 1;end if;
  if source_city is null then continue;end if;credit:=0;
  for role in select c.unit from public.peris_unit_catalog c loop
   select coalesce(sum(initial_soldiers),0),coalesce(sum(soldiers),0),coalesce(sum(starvation_losses),0)into initial,survivors,starved from public.battle_formations where battle_id=b.id and side=side_name and coalesce(recruit_unit,unit_type)=role;
   loss:=greatest(0,initial-starved-survivors);
   credit:=credit+loss*coalesce((select (rule#>>'{cost,food}')::numeric from public.peris_unit_balance where version=2 and unit=role),0);
  end loop;
  update public.settlements set food=least(food_capacity,food+credit)where id=source_city and ruined_at is null;
 end loop;
 update public.battles set food_settled=true where id=b.id;
end $$;

-- Allocate permanent combat deaths against captured survivors, excluding already-debited famine.
create or replace function public.peris_food_defender_losses(p_bid bigint,p_party jsonb)returns jsonb
language plpgsql stable security definer set search_path='' as $$
declare b public.battles%rowtype;party jsonb;unit_name text;source_key text;total integer;prefix integer;amount integer;survivors integer;lost integer;result jsonb:=public.peris_roster('{}');seen boolean;
begin
 select * into b from public.battles where id=p_bid;
 foreach unit_name in array array['infantry','spearmen','archers','elite','cavalry','scout','heavyCavalry','ram','catapult']loop
  total:=0;prefix:=0;amount:=0;seen:=false;
  for party in select value from jsonb_array_elements(b.city_defenders)loop
   source_key:=public.peris_supply_party_key(party,b.defender_owner_id);
   lost:=greatest(0,coalesce((party->'troops'->>unit_name)::integer,0)-coalesce((b.starvation_sources#>>array[source_key,unit_name])::integer,0));
   total:=total+lost;
   if party=p_party then amount:=lost;seen:=true;elsif not seen then prefix:=prefix+lost;end if;
  end loop;
  select coalesce(sum(soldiers),0)into survivors from public.battle_formations where battle_id=p_bid and side='defender'and coalesce(recruit_unit,unit_type)=unit_name;
  lost:=greatest(0,total-survivors);
  result:=jsonb_set(result,array[unit_name],to_jsonb(case when total=0 then 0 else floor(lost::numeric*(prefix+amount)/total)::integer-floor(lost::numeric*prefix/total)::integer end));
 end loop;return result;
end $$;
revoke all on function public.peris_food_defender_losses(bigint,jsonb)from public,anon,authenticated;

create or replace function public.peris_starve_one(p_sid bigint,p_at timestamptz)returns numeric
language plpgsql security definer set search_path='' as $$
declare r record;casualty_unit text;roster jsonb;refund numeric;ident bigint;parts text[];
begin
 select * into r from public.peris_supply_rows(p_sid,p_at)where public.peris_roster_total(troops)>0 order by tier,public.peris_roster_total(troops)desc,kind,key limit 1;
 if r.key is null then return 0;end if;
 select role into casualty_unit from unnest(array['infantry','spearmen','archers','elite','cavalry','scout','heavyCavalry','ram','catapult'])with ordinality u(role,seq)order by coalesce((r.troops->>role)::integer,0)desc,seq limit 1;
 roster:=jsonb_set(r.troops,array[casualty_unit],to_jsonb((r.troops->>casualty_unit)::integer-1));parts:=string_to_array(r.key,':');
 if r.kind='army'then perform public.peris_write_roster(parts[2]::bigint,roster);
 elsif r.kind='reserve'then update public.armies set raid_reserve=roster where id=parts[2]::bigint;
 elsif r.kind='city'then update public.peris_city_garrisons set unit_roster=roster where settlement_id=p_sid;
 elsif r.kind='station'then update public.peris_garrisons set unit_roster=roster,infantry=public.peris_roster_class(roster,'infantry'),archers=public.peris_roster_class(roster,'archers'),cavalry=public.peris_roster_class(roster,'cavalry')where owner_id=r.owner_id and col=parts[3]::integer and row=parts[4]::integer;
 elsif r.kind='reinforcement'then update public.peris_city_reinforcements set troops=roster where id=parts[2]::bigint;
 elsif r.kind='guild'then update public.peris_guild_reinforcements set troops=roster where id=parts[2]::bigint;
 elsif r.kind='evacuation'then update public.peris_ruin_evacuations set troops=roster where id=parts[2]::bigint;end if;
 perform public.peris_supply_battle_loss(r.key,casualty_unit);
 select (rule#>>'{cost,food}')::numeric into refund from public.peris_unit_balance where version=2 and peris_unit_balance.unit=casualty_unit;
 update public.settlements set starvation_losses=starvation_losses+1,starvation_last_at=p_at where id=p_sid;
 return coalesce(refund,0);
end $$;

create or replace function public.peris_population_accrue(p_sid bigint,p_until timestamptz)returns void
language plpgsql security definer set search_path='' as $$
declare s public.settlements%rowtype;remaining double precision;p double precision;cap double precision;jobs double precision;staff double precision;growth double precision;factor double precision;food_slope double precision;net double precision;gross double precision;dt double precision;zero_at double precision;food_full boolean;troop numeric;refund numeric;at_time timestamptz;merchant public.peris_trade_caravans%rowtype;cargo jsonb;
begin
 select * into s from public.settlements where id=p_sid for update;if s.id is null or s.ruined_at is not null then return;end if;
 if not s.troop_upkeep_ready then perform public.peris_population_accrue_legacy(p_sid,p_until);return;end if;
 remaining:=greatest(0,extract(epoch from(p_until-s.resources_updated_at)))/60;at_time:=s.resources_updated_at;
 p:=greatest(10,least(s.population_capacity,s.population));cap:=s.population_capacity;jobs:=s.workers_required;
 select coalesce(sum(public.peris_troop_upkeep(troops)),0)into troop from public.peris_supply_rows(s.id,at_time);
 while remaining>1e-9 loop
  staff:=least(1,p/greatest(1,jobs));gross:=(18+s.field_food_rate+s.food_bonus*staff)*s.food_research;net:=gross-.12*p-troop;
  if s.food<=1e-8 and net< -1e-9 then
   select * into merchant from public.peris_trade_caravans where status='waiting'and owner_id=s.owner_id and coalesce(return_settlement_id,source_settlement_id)=s.id and coalesce((returning_resources->>'food')::numeric,0)>0 order by id limit 1 for update;
   if merchant.id is not null then
    refund:=least(s.food_capacity,(merchant.returning_resources->>'food')::numeric);cargo:=jsonb_set(merchant.returning_resources,'{food}',to_jsonb((merchant.returning_resources->>'food')::numeric-refund));
    update public.peris_trade_caravans set returning_resources=cargo,status=case when public.peris_trade_volume(cargo)=0 then 'completed'else 'waiting'end,completed_at=case when public.peris_trade_volume(cargo)=0 then at_time else null end where id=merchant.id;
    s.food:=least(s.food_capacity,s.food+refund);continue;
   end if;
   refund:=public.peris_starve_one(s.id,at_time);
   if refund>0 then s.food:=least(s.food_capacity,s.food+refund);select coalesce(sum(public.peris_troop_upkeep(troops)),0)into troop from public.peris_supply_rows(s.id,at_time);continue;end if;
  end if;
  growth:=case when (s.food>1e-9 or net>1e-9)and p<cap-1e-9 then 1 else 0 end;
  factor:=case when jobs>0 and p<jobs-1e-9 then growth/jobs else 0 end;food_slope:=s.food_bonus*factor*s.food_research-.12*growth;
  dt:=remaining;if growth>0 then dt:=least(dt,cap-p);end if;
  if growth>0 and p<jobs-1e-9 then dt:=least(dt,jobs-p);end if;
  food_full:=s.food>=s.food_capacity-1e-9 and (net>1e-9 or abs(net)<=1e-9 and food_slope>=0);
  if not food_full then dt:=public.peris_population_event(s.food::double precision,net,food_slope,0,dt);dt:=public.peris_population_event(s.food::double precision,net,food_slope,s.food_capacity,dt);end if;
  if abs(food_slope)>1e-9 then zero_at:=-net/food_slope;if zero_at>1e-9 then dt:=least(dt,zero_at);end if;end if;
  if dt<=1e-9 then raise exception 'Crop integrator made no progress';end if;
  s.wood:=least(s.capacity,greatest(0,s.wood+((14+s.field_wood_rate+s.wood_bonus*staff)*dt+s.wood_bonus*factor*dt*dt/2)*s.wood_research));
  s.stone:=least(s.capacity,greatest(0,s.stone+((12+s.field_stone_rate+s.stone_bonus*staff)*dt+s.stone_bonus*factor*dt*dt/2)*s.stone_research));
  s.gold:=least(s.capacity,greatest(0,s.gold+((3+s.field_gold_rate*s.trade_research+s.gold_bonus*staff)*dt+s.gold_bonus*factor*dt*dt/2)*s.gold_research));
  s.food:=greatest(0,least(s.food_capacity,case when food_full then s.food_capacity else s.food+net*dt+food_slope*dt*dt/2 end));
  p:=greatest(10,least(cap,p+growth*dt));remaining:=remaining-dt;at_time:=at_time+make_interval(secs=>dt*60);
 end loop;
 staff:=least(1,p/greatest(1,jobs));gross:=(18+s.field_food_rate+s.food_bonus*staff)*s.food_research;
 update public.settlements set population=p,wood=s.wood,stone=s.stone,food=s.food,gold=s.gold,
  wood_rate=(14+s.field_wood_rate+s.wood_bonus*staff)*s.wood_research,stone_rate=(12+s.field_stone_rate+s.stone_bonus*staff)*s.stone_research,gold_rate=(3+s.field_gold_rate*s.trade_research+s.gold_bonus*staff)*s.gold_research,food_rate=gross-.12*p-troop,food_gross_rate=gross,food_upkeep=.12*p,food_troop_upkeep=troop,
  resources_updated_at=greatest(resources_updated_at,p_until)where id=s.id;
end $$;

create or replace function public.peris_trade_participants(p_owner uuid)returns uuid[]
language sql stable security definer set search_path='' as $$
 with recursive participants(id)as(select p_owner union select case when r.owner_id=p.id then r.recipient_id else r.owner_id end
 from participants p join(select owner_id,recipient_id from public.peris_trade_caravans where status<>'completed' union select owner_id,recipient_id from public.peris_trade_route_edges()
 union select owner_id,recipient_id from public.peris_guild_reinforcements
 union select attacker_owner_id,defender_owner_id from public.battles where status='active'and defender_owner_id is not null)r on(r.owner_id=p.id or r.recipient_id=p.id))
 select array_agg(id order by id)from participants
$$;

create or replace function public.peris_market_settle(p_owner uuid,p_until timestamptz)returns void
language plpgsql security definer set search_path='' as $$
declare participants uuid[];participant uuid;event_at timestamptz;cursor_at timestamptz;city record;r record;
begin
 if not exists(select 1 from public.peris_crop_version where activated_at is not null)then perform public.peris_market_settle_legacy(p_owner,p_until);return;end if;
 if not pg_try_advisory_xact_lock(72320)then raise lock_not_available;end if;
 participants:=public.peris_trade_participants(p_owner);
 if exists(select 1 from public.peris_settler_expeditions where owner_id=any(participants)and status='travelling'and arrival_at<=p_until)and not pg_try_advisory_xact_lock(204200)then raise lock_not_available;end if;
 perform 1 from public.players where id=any(participants)order by id for update nowait;
 if participants is distinct from public.peris_trade_participants(p_owner)then raise lock_not_available;end if;
 perform 1 from public.settlements where owner_id=any(participants)order by id for update nowait;
 select min(resources_updated_at)into cursor_at from public.settlements where owner_id=any(participants)and ruined_at is null;
 cursor_at:=least(coalesce(cursor_at,p_until),p_until);
 foreach participant in array participants loop perform public.peris_settle_core(participant,cursor_at);end loop;
 for r in select id from public.peris_trade_caravans where owner_id=any(participants)and(status='outbound'and arrival_at<=cursor_at or status='returning'and least(return_at,case when public.peris_trade_volume(returning_resources)>0 then redirect_at end)<=cursor_at)order by id loop perform public.peris_trade_event(r.id,cursor_at);end loop;
 for city in select id from public.settlements where owner_id=any(participants)and ruined_at is null order by id loop perform public.peris_supply_refresh(city.id,cursor_at);end loop;
 loop
  select min(at_time)into event_at from(
   select finish_at at_time from public.peris_orders where owner_id=any(participants)
   union all select public.peris_science_deadline(owner_id)from public.peris_account_science where owner_id=any(participants)and active_id is not null
   union all select arrival_at from public.armies where owner_id=any(participants)and status='moving'
   union all select departure_at from public.armies where owner_id=any(participants)and status='moving'
   union all select arrival_at from public.peris_city_reinforcements where owner_id=any(participants)
   union all select arrival_at from public.peris_guild_reinforcements where (owner_id=any(participants)or recipient_id=any(participants))and status<>'stationed'
   union all select arrival_at from public.peris_ruin_evacuations where owner_id=any(participants)
   union all select arrival_at from public.peris_settler_expeditions where owner_id=any(participants)and status='travelling'
   union all select case when status='outbound'then arrival_at else least(return_at,case when public.peris_trade_volume(returning_resources)>0 then redirect_at end)end from public.peris_trade_caravans where owner_id=any(participants)and status in('outbound','returning')
   union all select p_until
  )events where at_time>cursor_at and at_time<=p_until;
  exit when event_at is null;
  for city in select id from public.settlements where owner_id=any(participants)and ruined_at is null order by id loop perform public.peris_population_accrue(city.id,event_at);end loop;
  foreach participant in array participants loop perform public.peris_settle_core(participant,event_at);end loop;
  for r in select id from public.peris_trade_caravans where owner_id=any(participants)and(status='outbound'and arrival_at<=event_at or status='returning'and least(return_at,case when public.peris_trade_volume(returning_resources)>0 then redirect_at end)<=event_at)order by id loop perform public.peris_trade_event(r.id,event_at);end loop;
  for city in select id from public.settlements where owner_id=any(participants)and ruined_at is null order by id loop perform public.peris_supply_refresh(city.id,event_at);end loop;
  cursor_at:=event_at;
 end loop;
 -- Complete zero-time arrivals/queues and expose current rates without charging twice.
 foreach participant in array participants loop perform public.peris_settle_core(participant,p_until);end loop;
 for r in select id from public.peris_trade_caravans where owner_id=any(participants)and status in('waiting','stranded')order by id loop perform public.peris_trade_event(r.id,p_until);end loop;
 foreach participant in array participants loop perform public.peris_optional_advance_trade_routes(participant,p_until);end loop;
 for city in select id from public.settlements where owner_id=any(participants)and ruined_at is null order by id loop perform public.peris_supply_refresh(city.id,p_until);end loop;
 delete from public.peris_trade_caravans c where c.owner_id=any(participants)and c.status='completed'and c.id not in(select keep.id from public.peris_trade_caravans keep where keep.owner_id=c.owner_id and keep.status='completed'order by keep.completed_at desc,keep.id desc limit 50);
end $$;

-- Only a first install settles free legacy progress to this activation boundary.
do $$declare owner uuid;city record;activation timestamptz:=public.peris_game_now();begin
 if not exists(select 1 from public.peris_crop_version where activated_at is not null)then
  for owner in select id from public.players order by id loop perform public.peris_market_settle_legacy(owner,activation);end loop;
  update public.settlements set troop_upkeep_ready=true;update public.peris_crop_version set activated_at=activation;
 end if;
 for city in select id from public.settlements where ruined_at is null loop perform public.peris_supply_refresh(city.id,activation);end loop;
end $$;
alter table public.settlements alter column troop_upkeep_ready set default true;

revoke all on function public.peris_starvation_cap(),public.peris_supply_party_key(jsonb,uuid),public.peris_food_roster_after(bigint,text,jsonb),public.peris_food_finish(bigint),public.peris_population_accrue_legacy(bigint,timestamptz),public.peris_market_settle_legacy(uuid,timestamptz),public.peris_troop_upkeep(jsonb),public.peris_supply_city(uuid,integer,integer),public.peris_supply_rows(bigint,timestamptz),public.peris_supply_refresh(bigint,timestamptz),public.peris_supply_battle_loss(text,text),public.peris_starve_one(bigint,timestamptz),public.peris_population_accrue(bigint,timestamptz),public.peris_market_settle(uuid,timestamptz),public.peris_trade_participants(uuid)from public,anon,authenticated;
$crop_definition$;end if;end $restore_crop$;
commit;
