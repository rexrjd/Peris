-- Run after the faction/mage release. Preserves existing cities and progress.
begin;
-- Repeatable city plots; legacy buildings are retained for save compatibility.
alter table public.settlements add column if not exists food_capacity integer not null default 5000;
alter table public.settlements add column if not exists city_slots_ready boolean not null default false;
alter table public.battle_formations add column if not exists attack_multiplier numeric not null default 1 check(attack_multiplier between 1 and 1.6);
create table if not exists public.peris_city_slots (
 settlement_id bigint not null references public.settlements(id) on delete cascade,
 slot_index integer not null check(slot_index between 0 and 16),
 building_type text not null check(building_type in ('barracks','stables','smithy','warehouse','granary','fishery','mage_tower','housing')),
 level integer not null default 0 check(level between 0 and 5),
 primary key(settlement_id,slot_index),check((building_type='fishery')=(slot_index=16))
);
alter table public.peris_city_slots enable row level security;
drop policy if exists "own city slots" on public.peris_city_slots;
create policy "own city slots" on public.peris_city_slots for select to authenticated using(exists(select 1 from public.settlements s where s.id=settlement_id and s.owner_id=auth.uid()));
revoke all on public.peris_city_slots from public,anon,authenticated;
grant select on public.peris_city_slots to authenticated;
create or replace function public.peris_city_economy(p_sid bigint) returns void language plpgsql security definer set search_path='' as $$
declare fw numeric;fs numeric;ff numeric;fg numeric;
begin
 update public.settlements s set
 wood_rate=14+8*coalesce((select level from public.buildings where settlement_id=s.id and building_type='lumber'),0),
 stone_rate=12+7*coalesce((select level from public.buildings where settlement_id=s.id and building_type='quarry'),0),
 food_rate=18+10*coalesce((select level from public.buildings where settlement_id=s.id and building_type='farm'),0)+8*coalesce((select sum(level) from public.peris_city_slots where settlement_id=s.id and building_type='fishery'),0),
 gold_rate=3+3*coalesce((select level from public.buildings where settlement_id=s.id and building_type='market'),0),
 capacity=5000+2500*coalesce((select sum(level) from public.peris_city_slots where settlement_id=s.id and building_type='warehouse'),0),
 food_capacity=5000+2500*coalesce((select sum(level) from public.peris_city_slots where settlement_id=s.id and building_type='granary'),0)
 where s.id=p_sid;
 if to_regprocedure('public.peris_field_rates(bigint)')is not null then
  execute 'select wood,stone,food,gold from public.peris_field_rates($1)' into fw,fs,ff,fg using p_sid;
  update public.settlements set wood_rate=wood_rate+fw,stone_rate=stone_rate+fs,food_rate=food_rate+ff,gold_rate=gold_rate+fg where id=p_sid;
 end if;
end $$;
create or replace function public.peris_city_migrate(p_sid bigint) returns void language plpgsql security definer set search_path='' as $$
begin
 perform 1 from public.settlements where id=p_sid and not city_slots_ready for update;
 if not found then return;end if;
 insert into public.peris_city_slots(settlement_id,slot_index,building_type,level)
 select b.settlement_id,case b.building_type when 'barracks' then 0 when 'stables' then 1 else 2 end,
 case b.building_type when 'storehouse' then 'warehouse' else b.building_type end,b.level
 from public.buildings b join public.settlements s on s.id=b.settlement_id
 where b.settlement_id=p_sid and b.building_type in ('barracks','stables','storehouse') and (b.level>0 or exists(select 1 from public.peris_orders o where o.owner_id=s.owner_id and o.kind='upgrade' and o.item=b.building_type)) on conflict do nothing;
 -- Preserve the food capacity of old combined storehouses as well.
 insert into public.peris_city_slots select p_sid,3,'granary',level from public.buildings where settlement_id=p_sid and building_type='storehouse' and level>0 on conflict do nothing;
 update public.peris_orders o set item='slot:'||(case item when 'barracks' then '0:barracks' when 'stables' then '1:stables' else '2:warehouse' end)
 where o.owner_id=(select owner_id from public.settlements where id=p_sid) and kind='upgrade' and item in ('barracks','stables','storehouse');
 update public.settlements set city_slots_ready=true where id=p_sid;
 perform public.peris_city_economy(p_sid);
end $$;
create or replace function public.peris_queue_slot(p_slot integer,p_type text default null) returns jsonb language plpgsql security definer set search_path='' as $$
declare u uuid:=auth.uid();s public.settlements%rowtype;l integer;main integer;t text;factor numeric;cw numeric;cs numeric;cf numeric;cg numeric;
begin
 if u is null then raise exception 'Authentication required';end if;
 perform public.peris_settle(u);
 if exists(select 1 from public.battles where status='active' and (attacker_owner_id=u or defender_owner_id=u)) then raise exception 'Finish the current battle first';end if;
 select * into s from public.settlements where owner_id=u for update;
 if s.id is null then raise exception 'Realm not found';end if;
 select level into main from public.buildings where settlement_id=s.id and building_type='market';
 if p_slot is null or p_slot<0 or p_slot<>16 and p_slot>=6+2*coalesce(main,0) then raise exception 'Upgrade the main building to unlock this plot';end if;
 if exists(select 1 from public.peris_orders where owner_id=u and kind='upgrade') then raise exception 'Your builders are already working';end if;
 select level,building_type into l,t from public.peris_city_slots where settlement_id=s.id and slot_index=p_slot;
 if p_type is not null then
  if l is not null then raise exception 'This plot is already occupied';end if;
  if p_type not in ('barracks','stables','smithy','warehouse','granary','fishery','mage_tower','housing') then raise exception 'Unknown building';end if;
  if p_type='mage_tower' and exists(select 1 from public.peris_city_slots where settlement_id=s.id and building_type='mage_tower') then raise exception 'Only one mage tower can be built in your city';end if;
  if (p_type='fishery')<>(p_slot=16) then raise exception 'A fishery needs a riverside plot';end if;
  t:=p_type;l:=0;
 elsif l is null or l=0 then raise exception 'This building is not ready';end if;
 if l>=(case when t='mage_tower' then 10 else 5 end) then raise exception 'Maximum building level reached';end if;
 factor:=power(case when t='mage_tower' then 1.38::numeric else 1.55::numeric end,l);
 cw:=ceil((case t when 'housing' then 140 when 'mage_tower' then 260 when 'barracks' then 180 when 'stables' then 200 when 'smithy' then 180 when 'warehouse' then 200 else 160 end)*factor);
 cs:=ceil((case t when 'housing' then 110 when 'mage_tower' then 340 when 'barracks' then 160 when 'stables' then 120 when 'smithy' then 220 when 'warehouse' then 150 when 'granary' then 120 else 80 end)*factor);
 cf:=ceil((case t when 'housing' then 60 when 'barracks' then 100 when 'stables' then 180 when 'smithy' then 80 when 'warehouse' then 90 else 100 end)*factor);
 cg:=ceil((case t when 'mage_tower' then 160 when 'barracks' then 30 when 'stables' then 45 when 'smithy' then 60 when 'granary' then 15 else 20 end)*factor);
 if s.wood<cw or s.stone<cs or s.food<cf or s.gold<cg then raise exception 'Your stores cannot cover this cost';end if;
 update public.settlements set wood=wood-cw,stone=stone-cs,food=food-cf,gold=gold-cg where id=s.id;
 if p_type is not null then insert into public.peris_city_slots values(s.id,p_slot,t,0);end if;
 insert into public.peris_orders(owner_id,kind,item,quantity,started_at,finish_at)values(u,'upgrade','slot:'||p_slot||':'||t,1,now(),now()+make_interval(secs=>15+l*10));
 return jsonb_build_object('ok',true);
end $$;
revoke all on function public.peris_city_economy(bigint),public.peris_city_migrate(bigint),public.peris_queue_slot(integer,text) from public,anon,authenticated;
grant execute on function public.peris_queue_slot(integer,text) to authenticated;
-- Catch up completed legacy construction and income before introducing consumption.
do $$declare city record;begin
 if to_regprocedure('public.peris_settle(uuid,timestamptz)')is not null and not exists(select 1 from information_schema.columns where table_schema='public' and table_name='settlements' and column_name='population')then
  for city in select owner_id from public.settlements loop perform public.peris_settle(city.owner_id,now());end loop;
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
  exit when remaining<=1e-9;staff:=least(1,p/greatest(1,jobs));gross:=18+s.field_food_rate+s.food_bonus*staff;net:=gross-.12*p;
  growth:=case when s.food>1e-9 or net>1e-9 then case when p<cap-1e-9 then 1 else 0 end when net< -1e-9 and p>10+1e-9 then -1 else 0 end;
  factor:=case when jobs>0 and (p<jobs-1e-9 or abs(p-jobs)<1e-9 and growth<0)then growth/jobs else 0 end;food_slope:=s.food_bonus*factor-.12*growth;
  dt:=remaining;if growth>0 then dt:=least(dt,cap-p);elsif growth<0 then dt:=least(dt,p-10);end if;
  if growth<>0 and ((growth>0 and p<jobs-1e-9)or(growth<0 and p>jobs+1e-9))then dt:=least(dt,abs(jobs-p));end if;
  food_full:=s.food>=s.food_capacity-1e-9 and (net>1e-9 or abs(net)<=1e-9 and food_slope>=0);
  if not food_full then dt:=public.peris_population_event(s.food::double precision,net,food_slope,0,dt);dt:=public.peris_population_event(s.food::double precision,net,food_slope,s.food_capacity,dt);end if;
  if abs(food_slope)>1e-9 then zero_at:=-net/food_slope;if zero_at>1e-9 then dt:=least(dt,zero_at);end if;end if;exit when dt<=1e-9;
  s.wood:=least(s.capacity,greatest(0,s.wood+(14+s.field_wood_rate+s.wood_bonus*staff)*dt+s.wood_bonus*factor*dt*dt/2));
  s.stone:=least(s.capacity,greatest(0,s.stone+(12+s.field_stone_rate+s.stone_bonus*staff)*dt+s.stone_bonus*factor*dt*dt/2));
  s.gold:=least(s.capacity,greatest(0,s.gold+(3+s.field_gold_rate+s.gold_bonus*staff)*dt+s.gold_bonus*factor*dt*dt/2));
  s.food:=greatest(0,least(s.food_capacity,case when food_full then s.food_capacity else s.food+net*dt+food_slope*dt*dt/2 end));
  p:=greatest(10,least(cap,p+growth*dt));remaining:=remaining-dt;
 end loop;
 staff:=least(1,p/greatest(1,jobs));gross:=18+s.field_food_rate+s.food_bonus*staff;
 update public.settlements set population=p,wood=s.wood,stone=s.stone,food=s.food,gold=s.gold,
  wood_rate=14+s.field_wood_rate+s.wood_bonus*staff,stone_rate=12+s.field_stone_rate+s.stone_bonus*staff,gold_rate=3+s.field_gold_rate+s.gold_bonus*staff,food_rate=gross-.12*p,food_gross_rate=gross,food_upkeep=.12*p,
  resources_updated_at=greatest(resources_updated_at,p_until)where id=s.id;
end $$;
create or replace function public.peris_city_economy(p_sid bigint)returns void language plpgsql security definer set search_path='' as $$
declare main integer;lumber integer;quarry integer;farm integer;fish integer;homes integer;s public.settlements%rowtype;staff numeric;fw numeric:=0;fs numeric:=0;ff numeric:=0;fg numeric:=0;
begin
 select * into s from public.settlements where id=p_sid for update;if s.id is null then return;end if;
 if not s.population_ready then perform public.peris_population_accrue(p_sid,now());select * into s from public.settlements where id=p_sid;end if;
 select coalesce(max(level)filter(where building_type='market'),0),coalesce(max(level)filter(where building_type='lumber'),0),coalesce(max(level)filter(where building_type='quarry'),0),coalesce(max(level)filter(where building_type='farm'),0) into main,lumber,quarry,farm from public.buildings where settlement_id=p_sid;
 select coalesce(sum(level)filter(where building_type='fishery'),0),coalesce(sum(level)filter(where building_type='housing'),0) into fish,homes from public.peris_city_slots where settlement_id=p_sid;
 s.population_capacity:=40+10*main+30*homes;s.population:=greatest(10,least(s.population_capacity,s.population));s.workers_required:=4*main+6*lumber+6*quarry+5*farm+4*fish;
 if to_regprocedure('public.peris_field_rates(bigint)')is not null then execute 'select wood,stone,food,gold from public.peris_field_rates($1)' into fw,fs,ff,fg using p_sid;end if;
 staff:=least(1,s.population/greatest(1,s.workers_required));
 update public.settlements set population=s.population,population_capacity=s.population_capacity,workers_required=s.workers_required,population_ready=true,
  field_wood_rate=fw,field_stone_rate=fs,field_food_rate=ff,field_gold_rate=fg,
  wood_bonus=8*lumber,stone_bonus=7*quarry,food_bonus=10*farm+8*fish,gold_bonus=3*main,
  wood_rate=14+fw+8*lumber*staff,stone_rate=12+fs+7*quarry*staff,food_gross_rate=18+ff+(10*farm+8*fish)*staff,food_upkeep=.12*s.population,food_rate=18+ff+(10*farm+8*fish)*staff-.12*s.population,gold_rate=3+fg+3*main*staff,
  capacity=5000+2500*coalesce((select sum(level) from public.peris_city_slots where settlement_id=p_sid and building_type='warehouse'),0),
  food_capacity=5000+2500*coalesce((select sum(level) from public.peris_city_slots where settlement_id=p_sid and building_type='granary'),0)where id=p_sid;
end $$;
-- Settle legacy income before initializing population; repeated upgrades preserve it.
do $$declare city record;begin for city in select id from public.settlements loop perform public.peris_city_migrate(city.id);perform public.peris_city_economy(city.id);end loop;end $$;
revoke all on function public.peris_population_event(double precision,double precision,double precision,double precision,double precision),public.peris_population_accrue(bigint,timestamptz),public.peris_city_economy(bigint) from public,anon,authenticated;
create or replace function public.peris_settle(p_owner uuid,p_until timestamptz default now()) returns void
language plpgsql security definer set search_path='' as $$
declare s public.settlements%rowtype;o public.peris_orders%rowtype;target_slot integer;field_col integer;field_row integer;
begin
 perform 1 from public.players where id=p_owner for update;
 select * into s from public.settlements where owner_id=p_owner for update;if s.id is null then return;end if;
 perform public.peris_city_migrate(s.id);if not s.population_ready then perform public.peris_city_economy(s.id);end if;
 for o in select * from public.peris_orders where owner_id=p_owner and finish_at<=p_until order by finish_at,id for update loop
  perform public.peris_population_accrue(s.id,o.finish_at);
  if o.kind='upgrade' then
   if o.item like 'slot:%' then
    target_slot:=split_part(o.item,':',2)::integer;
    update public.peris_city_slots set level=least(case when building_type='mage_tower' then 10 else 5 end,level+1)where settlement_id=s.id and slot_index=target_slot;
   else update public.buildings set level=least(5,level+1),updated_at=o.finish_at where settlement_id=s.id and building_type=o.item;end if;
   update public.players set upgrades=upgrades+1 where id=p_owner;perform public.peris_city_economy(s.id);
  elsif o.kind='field' then
   field_col:=split_part(o.item,':',2)::integer;field_row:=split_part(o.item,':',3)::integer;
   update public.peris_map_plots set level=level+1 where col=field_col and row=field_row and owner_id=p_owner and settlement_id=s.id and building_type=split_part(o.item,':',4) and level<5;
   if not found then raise exception 'Queued external field no longer matches its owner or building';end if;
   update public.players set upgrades=upgrades+1 where id=p_owner;perform public.peris_city_economy(s.id);
  elsif o.kind='recruit' then
   update public.armies set infantry=infantry+case when o.item='infantry' then o.quantity else 0 end,
    archers=archers+case when o.item='archers' then o.quantity else 0 end,cavalry=cavalry+case when o.item='cavalry' then o.quantity else 0 end,updated_at=o.finish_at where owner_id=p_owner;
   update public.players set recruits=recruits+o.quantity where id=p_owner;
  end if;delete from public.peris_orders where id=o.id;
 end loop;
 perform public.peris_population_accrue(s.id,p_until);
 update public.armies set status='idle',start_x=target_x,start_y=target_y,updated_at=p_until where owner_id=p_owner and status='moving' and arrival_at<=p_until;
end $$;
-- Low-poly city factions and explicit owner-scoped prototype debug controls.
alter table public.settlements add column if not exists faction text not null default 'roman';
alter table public.settlements drop constraint if exists settlements_faction_check;
alter table public.settlements add constraint settlements_faction_check check(faction in ('roman','spartan','persian','egyptian','orc','elf','dwarf','gnome','pandaren','undead','demon'));
create table if not exists public.peris_debug_config(id boolean primary key default true check(id),enabled boolean not null default true);
insert into public.peris_debug_config(id,enabled)values(true,true)on conflict(id)do nothing;
alter table public.peris_debug_config enable row level security;
revoke all on public.peris_debug_config from public,anon,authenticated;
-- This admin-owned flag can disable instant cheats without disabling faction selection.
create or replace function public.peris_set_faction(p_faction text)returns void language plpgsql security definer set search_path='' as $$
declare u uuid:=auth.uid();
begin
 if u is null then raise exception 'Authentication required';end if;
 if p_faction is null or p_faction not in ('roman','spartan','persian','egyptian','orc','elf','dwarf','gnome','pandaren','undead','demon')then raise exception 'Unknown faction';end if;
 update public.settlements set faction=p_faction where owner_id=u;if not found then raise exception 'Settlement missing';end if;
end $$;
create or replace function public.peris_debug_city(p_action text,p_target text default null,p_value integer default null)returns void language plpgsql security definer set search_path='' as $$
declare u uuid:=auth.uid();s public.settlements%rowtype;c public.peris_city_slots%rowtype;b public.buildings%rowtype;target_slot integer;l integer;max_level integer;lost_magic boolean:=false;count_slots integer;
begin
 if u is null then raise exception 'Authentication required';end if;
 if not coalesce((select enabled from public.peris_debug_config where id),false)then raise exception 'Debug tools are disabled';end if;
 perform 1 from public.players where id=u for update;
 select * into s from public.settlements where owner_id=u for update;if s.id is null then raise exception 'Settlement missing';end if;
 if exists(select 1 from public.battles where status='active' and (attacker_owner_id=u or defender_owner_id=u))then raise exception 'Finish the current battle first';end if;
 perform public.peris_settle(u);select * into s from public.settlements where id=s.id;
 if p_action='resources' then
  if p_value is null or p_value not in (0,1000)then raise exception 'Choose fill storage or +1,000 supplies';end if;
  update public.settlements set wood=case when p_value=0 then capacity else least(capacity,wood+1000)end,stone=case when p_value=0 then capacity else least(capacity,stone+1000)end,
   food=case when p_value=0 then food_capacity else least(food_capacity,food+1000)end,gold=case when p_value=0 then capacity else least(capacity,gold+1000)end,resources_updated_at=now() where id=s.id;return;
 elsif p_action='population' then
  if p_value is null or p_value not in (0,10)then raise exception 'Choose fill housing or +10 residents';end if;
  update public.settlements set population=case when p_value=0 then population_capacity else least(population_capacity,population+10)end where id=s.id;perform public.peris_city_economy(s.id);return;
 elsif p_action='finish' then
  update public.peris_orders set started_at=least(started_at,now()),finish_at=now() where owner_id=u and kind='upgrade';perform public.peris_settle(u);return;
 end if;
 if p_action is null or p_action not in ('demolish','level')then raise exception 'Invalid debug action';end if;
 if p_target ~ '^slot:[0-9]{1,2}$' then
  target_slot:=split_part(p_target,':',2)::integer;select * into c from public.peris_city_slots where settlement_id=s.id and slot_index=target_slot for update;
  if c.settlement_id is null then raise exception 'Select a built building';end if;
  max_level:=case when c.building_type='mage_tower' then 10 else 5 end;
 else
  select * into b from public.buildings where settlement_id=s.id and building_type=p_target for update;if b.id is null then raise exception 'Select a built building';end if;max_level:=5;
 end if;
 l:=case when p_action='demolish' then 0 else p_value end;if l is null or l<0 or l>max_level then raise exception 'Invalid building level';end if;
 if c.settlement_id is not null then
  delete from public.peris_orders where owner_id=u and kind='upgrade' and item='slot:'||c.slot_index||':'||c.building_type;
  if l=0 then delete from public.peris_city_slots where settlement_id=s.id and slot_index=c.slot_index;lost_magic:=c.building_type='mage_tower';
  else update public.peris_city_slots set level=l where settlement_id=s.id and slot_index=c.slot_index;end if;
 else
  update public.buildings set level=l,updated_at=now() where id=b.id;
  delete from public.peris_orders where owner_id=u and kind='upgrade' and item=b.building_type;
  if b.building_type='market' then
   count_slots:=6+2*l;lost_magic:=exists(select 1 from public.peris_city_slots where settlement_id=s.id and slot_index>=count_slots and slot_index<>16 and building_type='mage_tower');
   delete from public.peris_orders o using public.peris_city_slots cs where cs.settlement_id=s.id and cs.slot_index>=count_slots and cs.slot_index<>16 and o.owner_id=u and o.kind='upgrade' and o.item='slot:'||cs.slot_index||':'||cs.building_type;
   delete from public.peris_city_slots where settlement_id=s.id and slot_index>=count_slots and slot_index<>16;
  end if;
 end if;
 if lost_magic then delete from public.peris_spell_research where settlement_id=s.id;end if;
 perform public.peris_city_economy(s.id);
 update public.settlements set wood=least(wood,capacity),stone=least(stone,capacity),food=least(food,food_capacity),gold=least(gold,capacity)where id=s.id;
end $$;
revoke all on function public.peris_set_faction(text),public.peris_debug_city(text,text,integer) from public,anon;
grant execute on function public.peris_set_faction(text),public.peris_debug_city(text,text,integer) to authenticated;
do $$declare r record;begin for r in select p.oid from pg_proc p join pg_namespace n on n.oid=p.pronamespace where n.nspname='public' and p.proname in ('peris_city_migrate','peris_settle','peris_city_economy','peris_add_formations')loop execute 'revoke all on function '||r.oid::regprocedure::text||' from public,anon,authenticated';end loop;end $$;
commit;
