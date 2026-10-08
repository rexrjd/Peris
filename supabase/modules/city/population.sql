-- Catch up completed legacy construction and income before introducing consumption.
do $$declare city record;begin
 if to_regprocedure('public.peris_settle(uuid,timestamptz)')is not null and not exists(select 1 from information_schema.columns where table_schema='public' and table_name='settlements' and column_name='population')then
  for city in select owner_id from public.settlements loop perform public.peris_settle(city.owner_id,now());end loop;
 end if;
end $$;
-- Civilian population, housing and production-worker economy.
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
alter table public.settlements alter column wood_rate type numeric(18,8);
alter table public.settlements alter column stone_rate type numeric(18,8);
alter table public.settlements alter column food_rate type numeric(18,8);
alter table public.settlements alter column gold_rate type numeric(18,8);
alter table public.peris_city_slots drop constraint if exists peris_city_slots_building_type_check;
alter table public.peris_city_slots add constraint peris_city_slots_building_type_check check(building_type in ('barracks','stables','smithy','warehouse','granary','fishery','mage_tower','housing'));
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
  exit when remaining<=1e-9;staff:=least(1,p/greatest(1,jobs));gross:=18+s.food_bonus*staff;net:=gross-.12*p;
  growth:=case when s.food>1e-9 or net>1e-9 then case when p<cap-1e-9 then 1 else 0 end when net< -1e-9 and p>10+1e-9 then -1 else 0 end;
  factor:=case when jobs>0 and (p<jobs-1e-9 or abs(p-jobs)<1e-9 and growth<0)then growth/jobs else 0 end;food_slope:=s.food_bonus*factor-.12*growth;
  dt:=remaining;if growth>0 then dt:=least(dt,cap-p);elsif growth<0 then dt:=least(dt,p-10);end if;
  if growth<>0 and ((growth>0 and p<jobs-1e-9)or(growth<0 and p>jobs+1e-9))then dt:=least(dt,abs(jobs-p));end if;
  food_full:=s.food>=s.food_capacity-1e-9 and (net>1e-9 or abs(net)<=1e-9 and food_slope>=0);
  if not food_full then dt:=public.peris_population_event(s.food::double precision,net,food_slope,0,dt);dt:=public.peris_population_event(s.food::double precision,net,food_slope,s.food_capacity,dt);end if;
  if abs(food_slope)>1e-9 then zero_at:=-net/food_slope;if zero_at>1e-9 then dt:=least(dt,zero_at);end if;end if;exit when dt<=1e-9;
  s.wood:=least(s.capacity,greatest(0,s.wood+(14+s.wood_bonus*staff)*dt+s.wood_bonus*factor*dt*dt/2));
  s.stone:=least(s.capacity,greatest(0,s.stone+(12+s.stone_bonus*staff)*dt+s.stone_bonus*factor*dt*dt/2));
  s.gold:=least(s.capacity,greatest(0,s.gold+(3+s.gold_bonus*staff)*dt+s.gold_bonus*factor*dt*dt/2));
  s.food:=greatest(0,least(s.food_capacity,case when food_full then s.food_capacity else s.food+net*dt+food_slope*dt*dt/2 end));
  p:=greatest(10,least(cap,p+growth*dt));remaining:=remaining-dt;
 end loop;
 staff:=least(1,p/greatest(1,jobs));gross:=18+s.food_bonus*staff;
 update public.settlements set population=p,wood=s.wood,stone=s.stone,food=s.food,gold=s.gold,
  wood_rate=14+s.wood_bonus*staff,stone_rate=12+s.stone_bonus*staff,gold_rate=3+s.gold_bonus*staff,food_rate=gross-.12*p,food_gross_rate=gross,food_upkeep=.12*p,
  resources_updated_at=greatest(resources_updated_at,p_until)where id=s.id;
end $$;
create or replace function public.peris_city_economy(p_sid bigint)returns void language plpgsql security definer set search_path='' as $$
declare main integer;lumber integer;quarry integer;farm integer;fish integer;homes integer;s public.settlements%rowtype;staff numeric;
begin
 select * into s from public.settlements where id=p_sid for update;if s.id is null then return;end if;
 if not s.population_ready then perform public.peris_population_accrue(p_sid,now());select * into s from public.settlements where id=p_sid;end if;
 select coalesce(max(level)filter(where building_type='market'),0),coalesce(max(level)filter(where building_type='lumber'),0),coalesce(max(level)filter(where building_type='quarry'),0),coalesce(max(level)filter(where building_type='farm'),0) into main,lumber,quarry,farm from public.buildings where settlement_id=p_sid;
 select coalesce(sum(level)filter(where building_type='fishery'),0),coalesce(sum(level)filter(where building_type='housing'),0) into fish,homes from public.peris_city_slots where settlement_id=p_sid;
 s.population_capacity:=40+10*main+30*homes;s.population:=greatest(10,least(s.population_capacity,s.population));s.workers_required:=4*main+6*lumber+6*quarry+5*farm+4*fish;
 staff:=least(1,s.population/greatest(1,s.workers_required));
 update public.settlements set population=s.population,population_capacity=s.population_capacity,workers_required=s.workers_required,population_ready=true,
  wood_bonus=8*lumber,stone_bonus=7*quarry,food_bonus=10*farm+8*fish,gold_bonus=3*main,
  wood_rate=14+8*lumber*staff,stone_rate=12+7*quarry*staff,food_gross_rate=18+(10*farm+8*fish)*staff,food_upkeep=.12*s.population,food_rate=18+(10*farm+8*fish)*staff-.12*s.population,gold_rate=3+3*main*staff,
  capacity=5000+2500*coalesce((select sum(level) from public.peris_city_slots where settlement_id=p_sid and building_type='warehouse'),0),
  food_capacity=5000+2500*coalesce((select sum(level) from public.peris_city_slots where settlement_id=p_sid and building_type='granary'),0)where id=p_sid;
end $$;
-- Settle legacy income before initializing population; repeated upgrades preserve it.
do $$declare city record;begin for city in select id from public.settlements where not population_ready loop perform public.peris_city_migrate(city.id);perform public.peris_city_economy(city.id);end loop;end $$;
revoke all on function public.peris_population_event(double precision,double precision,double precision,double precision,double precision),public.peris_population_accrue(bigint,timestamptz),public.peris_city_economy(bigint) from public,anon,authenticated;
