-- Current city, mage, faction and population update. Preserves progress.
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
begin
 update public.settlements s set
 wood_rate=14+8*coalesce((select level from public.buildings where settlement_id=s.id and building_type='lumber'),0),
 stone_rate=12+7*coalesce((select level from public.buildings where settlement_id=s.id and building_type='quarry'),0),
 food_rate=18+10*coalesce((select level from public.buildings where settlement_id=s.id and building_type='farm'),0)+8*coalesce((select sum(level) from public.peris_city_slots where settlement_id=s.id and building_type='fishery'),0),
 gold_rate=3+3*coalesce((select level from public.buildings where settlement_id=s.id and building_type='market'),0),
 capacity=5000+2500*coalesce((select sum(level) from public.peris_city_slots where settlement_id=s.id and building_type='warehouse'),0),
 food_capacity=5000+2500*coalesce((select sum(level) from public.peris_city_slots where settlement_id=s.id and building_type='granary'),0)
 where s.id=p_sid;
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
-- Optional, unique mage tower and the twenty-spell research catalog.
alter table public.peris_city_slots drop constraint if exists peris_city_slots_building_type_check;
alter table public.peris_city_slots add constraint peris_city_slots_building_type_check check(building_type in ('barracks','stables','smithy','warehouse','granary','fishery','mage_tower'));
alter table public.peris_city_slots drop constraint if exists peris_city_slots_level_check;
alter table public.peris_city_slots add constraint peris_city_slots_level_check check(level between 0 and case when building_type='mage_tower' then 10 else 5 end);
create unique index if not exists peris_one_mage_tower on public.peris_city_slots(settlement_id) where building_type='mage_tower';
alter table public.battles add column if not exists mana_attacker integer;
alter table public.battles add column if not exists mana_defender integer;
alter table public.battles add column if not exists spell_ready_attacker numeric not null default 0;
alter table public.battles add column if not exists spell_ready_defender numeric not null default 0;
alter table public.battles add column if not exists last_spell jsonb;
alter table public.battle_formations add column if not exists magic_attack numeric not null default 1 check(magic_attack between 1 and 1.5);
alter table public.battle_formations add column if not exists magic_defence numeric not null default 0 check(magic_defence between 0 and .4);
alter table public.battle_formations add column if not exists magic_speed numeric not null default 1 check(magic_speed between 1 and 1.75);
create table if not exists public.peris_spell_catalog (
 id text primary key,name text not null,school text not null,level integer not null, mana integer not null,target text not null,
 damage integer not null,heal integer not null,morale integer not null,stamina integer not null,attack numeric not null,defence numeric not null,speed numeric not null,radius integer not null,chain integer not null,revive boolean not null
);
insert into public.peris_spell_catalog values
('spark','Spark','Fire',1,5,'enemy',8,0,0,0,0,0,0,0,0,false),
('mend','Mend','Light',1,5,'ally',0,8,0,0,0,0,0,0,0,false),
('ice-bolt','Ice Bolt','Water',2,8,'enemy',12,0,0,-12,0,0,0,0,0,false),
('stone-skin','Stone Skin','Earth',2,8,'ally',0,0,0,0,0,0.2,0,0,0,false),
('lightning','Lightning','Air',3,10,'enemy',18,0,0,0,0,0,0,0,0,false),
('haste','Haste','Air',3,10,'ally',0,0,0,0,0,0,0.25,0,0,false),
('fireball','Fireball','Fire',4,15,'enemy',12,0,0,0,0,0,0,100,0,false),
('bless','Bless','Light',4,12,'ally',0,0,0,0,0.15,0,0,0,0,false),
('terror','Terror','Shadow',5,15,'enemy',0,0,-25,0,0,0,0,0,0,false),
('courage','Courage','Light',5,18,'allies',0,0,12,0,0,0,0,0,0,false),
('chain-lightning','Chain Lightning','Air',6,22,'enemy',18,0,0,0,0,0,0,0,3,false),
('sanctuary','Sanctuary','Light',6,22,'allies',0,12,0,0,0,0,0,0,0,false),
('frost-nova','Frost Nova','Water',7,25,'enemy',12,0,0,-30,0,0,0,120,0,false),
('battle-trance','Battle Trance','Shadow',7,25,'allies',0,0,0,25,0.15,0,0,0,0,false),
('meteor','Meteor','Earth',8,32,'enemy',22,0,0,0,0,0,0,150,0,false),
('resurrection','Resurrection','Light',8,30,'ally',0,25,65,0,0,0,0,0,0,true),
('storm','Storm','Air',9,40,'enemies',18,0,0,0,0,0,0,0,0,false),
('aegis','Aegis','Earth',9,38,'allies',0,0,0,0,0,0.4,0,0,0,false),
('inferno','Inferno','Fire',10,50,'enemies',28,0,-15,0,0,0,0,0,0,false),
('phoenix','Phoenix','Light',10,50,'allies',0,30,80,0,0,0,0,0,0,true)
on conflict(id) do update set name=excluded.name,school=excluded.school,level=excluded.level,mana=excluded.mana,target=excluded.target,damage=excluded.damage,heal=excluded.heal,morale=excluded.morale,stamina=excluded.stamina,attack=excluded.attack,defence=excluded.defence,speed=excluded.speed,radius=excluded.radius,chain=excluded.chain,revive=excluded.revive;
create table if not exists public.peris_spell_research (
 settlement_id bigint not null references public.settlements(id) on delete cascade,
 spell_id text not null references public.peris_spell_catalog(id),researched_at timestamptz not null default now(),primary key(settlement_id,spell_id)
);
alter table public.peris_spell_catalog enable row level security;
alter table public.peris_spell_research enable row level security;
drop policy if exists "spell catalog" on public.peris_spell_catalog;
create policy "spell catalog" on public.peris_spell_catalog for select to authenticated using(true);
drop policy if exists "own researched spells" on public.peris_spell_research;
create policy "own researched spells" on public.peris_spell_research for select to authenticated using(exists(select 1 from public.settlements s where s.id=settlement_id and s.owner_id=auth.uid()));
revoke all on public.peris_spell_catalog,public.peris_spell_research from public,anon,authenticated;
grant select on public.peris_spell_catalog,public.peris_spell_research to authenticated;
create or replace function public.peris_research_spell(p_spell text) returns jsonb language plpgsql security definer set search_path='' as $$
declare u uuid:=auth.uid();s public.settlements%rowtype;sp public.peris_spell_catalog%rowtype;l integer;
begin
 if u is null then raise exception 'Authentication required';end if;
 perform public.peris_settle(u);
 if exists(select 1 from public.battles where status='active' and (attacker_owner_id=u or defender_owner_id=u)) then raise exception 'Finish the current battle first';end if;
 select * into s from public.settlements where owner_id=u for update;
 select * into sp from public.peris_spell_catalog where id=p_spell;
 if s.id is null or sp.id is null then raise exception 'Unknown spell or realm';end if;
 select level into l from public.peris_city_slots where settlement_id=s.id and building_type='mage_tower';
 if coalesce(l,0)<sp.level then raise exception 'Upgrade the mage tower to level %',sp.level;end if;
 if exists(select 1 from public.peris_spell_research where settlement_id=s.id and spell_id=sp.id) then raise exception 'This spell is already researched';end if;
 if s.wood<sp.level*40 or s.stone<sp.level*55 or s.gold<sp.level*70 then raise exception 'Your stores cannot cover this research';end if;
 update public.settlements set wood=wood-sp.level*40,stone=stone-sp.level*55,gold=gold-sp.level*70 where id=s.id;
 insert into public.peris_spell_research(settlement_id,spell_id)values(s.id,sp.id);
 return jsonb_build_object('ok',true);
end $$;
create or replace function public.peris_cast_spell(p_battle_id bigint,p_spell text,p_target bigint default null) returns jsonb language plpgsql security definer set search_path='' as $$
declare u uuid:=auth.uid();b public.battles%rowtype;s public.settlements%rowtype;sp public.peris_spell_catalog%rowtype;f public.battle_formations%rowtype;t public.battle_formations%rowtype;
 own_side text;friend boolean;single_target boolean;l integer;mana integer;ready numeric;idx integer:=0;cas integer;troops integer;mor numeric;alive_a boolean;alive_d boolean;
begin
 select * into b from public.battles where id=p_battle_id for update;
 if u is null or b.id is null or (u is distinct from b.attacker_owner_id and u is distinct from b.defender_owner_id) then raise exception 'Not your battle';end if;
 if b.status<>'active' or b.phase<>'combat' then raise exception 'Spells can only be cast during combat';end if;
 select * into s from public.settlements where owner_id=u;
 select * into sp from public.peris_spell_catalog where id=p_spell;
 select level into l from public.peris_city_slots where settlement_id=s.id and building_type='mage_tower';
 if sp.id is null or coalesce(l,0)<sp.level or not exists(select 1 from public.peris_spell_research where settlement_id=s.id and spell_id=sp.id) then raise exception 'Research this spell in your mage tower first';end if;
 perform public.peris_tick(b.id);
 select * into b from public.battles where id=p_battle_id;
 if b.status<>'active' then return jsonb_build_object('ok',true,'ended',true);end if;
 own_side:=case when b.attacker_owner_id=u then 'attacker' else 'defender' end;
 mana:=coalesce(case when own_side='attacker' then b.mana_attacker else b.mana_defender end,20+l*10);
 ready:=case when own_side='attacker' then b.spell_ready_attacker else b.spell_ready_defender end;
 if b.elapsed<ready then raise exception 'Your mage is recovering';end if;
 if mana<sp.mana then raise exception 'Not enough mana';end if;
 friend:=sp.target in ('ally','allies');single_target:=sp.target in ('ally','enemy');
 if single_target then
 select * into t from public.battle_formations where id=p_target and battle_id=b.id and (side=own_side)=friend and (sp.revive or soldiers>0 and status<>'routed');
 if t.id is null then raise exception 'Choose an eligible formation on the correct side';end if;
 end if;
 for f in select * from public.battle_formations where battle_id=b.id and (side=own_side)=friend and (sp.revive or soldiers>0 and status<>'routed')
 and (not single_target or id=t.id or sp.chain>0 or sp.radius>0 and power(x-t.x,2)+power(y-t.y,2)<=sp.radius*sp.radius)
 order by case when sp.chain>0 then case when id=t.id then -1 else power(x-t.x,2)+power(y-t.y,2) end else id end,id
 limit case when sp.chain>0 then sp.chain else 10000 end for update loop
 cas:=ceil(greatest(0,sp.damage-case when sp.chain>0 then idx*6 else 0 end)*(1-f.magic_defence));idx:=idx+1;
 troops:=greatest(0,least(f.initial_soldiers,f.soldiers-cas+sp.heal));
 mor:=case when sp.revive then greatest(f.morale,sp.morale) else greatest(0,least(100,f.morale+sp.morale)) end;
 update public.battle_formations set soldiers=troops,morale=mor,stamina=greatest(0,least(100,f.stamina+sp.stamina)),
 magic_attack=least(1.5,f.magic_attack+sp.attack),magic_defence=least(.4,f.magic_defence+sp.defence),magic_speed=least(1.75,f.magic_speed+sp.speed),
 status=case when troops=0 or mor<=18 then 'routed' when sp.revive then 'idle' else f.status end,
 target_formation_id=case when sp.revive then null else f.target_formation_id end,
 target_x=case when sp.revive then f.x else f.target_x end,target_y=case when sp.revive then f.y else f.target_y end where id=f.id;
 end loop;
 if idx=0 then raise exception 'No eligible formations';end if;
 update public.battles set mana_attacker=case when own_side='attacker' then mana-sp.mana else mana_attacker end,
 mana_defender=case when own_side='defender' then mana-sp.mana else mana_defender end,
 spell_ready_attacker=case when own_side='attacker' then b.elapsed+8 else spell_ready_attacker end,
 spell_ready_defender=case when own_side='defender' then b.elapsed+8 else spell_ready_defender end,
 last_spell=jsonb_build_object('id',sp.id,'name',sp.name,'owner_id',u,'at',b.elapsed,'target',t.id) where id=b.id;
 select exists(select 1 from public.battle_formations where battle_id=b.id and side='attacker' and soldiers>0 and status<>'routed'),exists(select 1 from public.battle_formations where battle_id=b.id and side='defender' and soldiers>0 and status<>'routed') into alive_a,alive_d;
 if not alive_a or not alive_d then perform public.peris_finish(b.id,case when alive_a then 'attacker' when alive_d then 'defender' else 'draw' end,'Army routed by magic');end if;
 return jsonb_build_object('ok',true);
end $$;
revoke all on function public.peris_research_spell(text),public.peris_cast_spell(bigint,text,bigint) from public,anon,authenticated;
grant execute on function public.peris_research_spell(text),public.peris_cast_spell(bigint,text,bigint) to authenticated;
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
create or replace function public.peris_settle(p_owner uuid,p_until timestamptz default now()) returns void
language plpgsql security definer set search_path='' as $$
declare s public.settlements%rowtype;o public.peris_orders%rowtype;target_slot integer;
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
  else
   update public.armies set infantry=infantry+case when o.item='infantry' then o.quantity else 0 end,
    archers=archers+case when o.item='archers' then o.quantity else 0 end,cavalry=cavalry+case when o.item='cavalry' then o.quantity else 0 end,updated_at=o.finish_at where owner_id=p_owner;
   update public.players set recruits=recruits+o.quantity where id=p_owner;
  end if;delete from public.peris_orders where id=o.id;
 end loop;
 perform public.peris_population_accrue(s.id,p_until);
 update public.armies set status='idle',start_x=target_x,start_y=target_y,updated_at=p_until where owner_id=p_owner and status='moving' and arrival_at<=p_until;
end $$;
create or replace function public.peris_add_formations(p_battle bigint,p_owner uuid,p_side text,p_inf integer,p_arc integer,p_cav integer,p_morale numeric)
returns void language plpgsql security definer set search_path='' as $$
declare typ text;n integer;total integer;i integer;amount integer;px integer;py integer;cap integer;
begin
 foreach typ in array array['infantry','archers','cavalry'] loop
 total:=case typ when 'infantry' then p_inf when 'archers' then p_arc else p_cav end;
 cap:=case typ when 'infantry' then 60 when 'archers' then 40 else 24 end;
 n:=least(6,ceil(total::numeric/cap)::integer);if n<=0 then continue;end if;
 for i in 0..n-1 loop
 amount:=total/n+case when i<total%n then 1 else 0 end;
 px:=case when p_side='attacker' then case when typ='infantry' then 285 else 175 end else case when typ='infantry' then 915 else 1025 end end;
 py:=case when typ='cavalry' then case when i%2=0 then 110+i*15 else 590-i*15 end else round(350+(i-(n-1)/2.0)*105+case when typ='archers' then 15 else 0 end) end;
 insert into public.battle_formations(battle_id,owner_id,side,unit_type,label,initial_soldiers,soldiers,morale,x,y,target_x,target_y,facing,columns)
 values(p_battle,p_owner,p_side,typ,(case typ when 'infantry' then 'Legionaries' when 'archers' then 'Sagittarii' else 'Equites' end)||' '||(i+1),amount,amount,least(100,p_morale),px,py,px,py,case when p_side='attacker' then 0 else 180 end,case when typ='cavalry' then 6 else 10 end);
 end loop;
 end loop;
 update public.battle_formations set attack_multiplier=1+least(.6,coalesce((select sum(c.level)*.04 from public.peris_city_slots c join public.settlements s on s.id=c.settlement_id where s.owner_id=p_owner and c.building_type='smithy'),0)) where battle_id=p_battle and owner_id=p_owner;
end $$;

create or replace function public.peris_queue_recruit(p_type text,p_quantity integer) returns jsonb language plpgsql security definer set search_path='' as $$
declare u uuid:=auth.uid();s public.settlements%rowtype;a public.armies%rowtype;l integer;at_time timestamptz;duration numeric;cw integer;cs integer;cf integer;cg integer;queued integer;
begin
 if u is null then raise exception 'Authentication required';end if;
 if p_type is null or p_type not in ('infantry','archers','cavalry') or p_quantity is null or p_quantity<1 or p_quantity>200 then raise exception 'Choose between 1 and 200 soldiers';end if;
 perform public.peris_settle(u);
 if exists(select 1 from public.battles where status='active' and (attacker_owner_id=u or defender_owner_id=u)) then raise exception 'Finish the current battle first';end if;
 select * into s from public.settlements where owner_id=u for update;
 select * into a from public.armies where owner_id=u for update;
 if s.id is null or a.id is null then raise exception 'Realm not found';end if;
 if a.status='moving' or sqrt(power(a.target_x-s.x-40,2)+power(a.target_y-s.y-30,2))>90 then raise exception 'Bring your army home to recruit';end if;
 if (select count(*) from public.peris_orders where owner_id=u and kind='recruit')>=3 then raise exception 'Training queue is full';end if;
 select coalesce(sum(quantity),0) into queued from public.peris_orders where owner_id=u and kind='recruit';
 if a.infantry+a.archers+a.cavalry+queued+p_quantity>1000 then raise exception 'Army capacity is 1,000 soldiers';end if;
 cw:=p_quantity*case when p_type='archers' then 6 else 4 end;cs:=p_quantity*case when p_type='cavalry' then 7 else 2 end;
 cf:=p_quantity*case p_type when 'infantry' then 6 when 'archers' then 5 else 12 end;cg:=p_quantity*case p_type when 'infantry' then 1 when 'archers' then 2 else 4 end;
 if s.wood<cw or s.stone<cs or s.food<cf or s.gold<cg then raise exception 'Your stores cannot cover this cost';end if;
 select coalesce(sum(level),0) into l from public.peris_city_slots where settlement_id=s.id and building_type=case when p_type='cavalry' then 'stables' else 'barracks' end;
 if l=0 then raise exception 'Build barracks or stables first';end if;
 select greatest(now(),coalesce(max(finish_at),now())) into at_time from public.peris_orders where owner_id=u and kind='recruit';
 duration:=greatest(5,ceil(p_quantity*case when p_type='cavalry' then 5 else 2 end/(1+(coalesce(l,1)-1)*0.18)));
 update public.settlements set wood=wood-cw,stone=stone-cs,food=food-cf,gold=gold-cg where id=s.id;
 insert into public.peris_orders(owner_id,kind,item,quantity,started_at,finish_at)values(u,'recruit',p_type,p_quantity,at_time,at_time+make_interval(secs=>duration::double precision));
 return jsonb_build_object('ok',true);
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
create or replace function public.peris_snapshot()returns jsonb language plpgsql security definer set search_path='' as $$
declare u uuid:=auth.uid();result jsonb;
begin
 if u is null then raise exception 'Authentication required';end if;
 perform public.peris_city_migrate(s.id) from public.settlements s where s.owner_id=u;
 select jsonb_build_object('version',6,'server_now',now(),
 'debug_enabled',coalesce((select enabled from public.peris_debug_config where id),false),
 'map',jsonb_build_object('version',3,'cols',200,'rows',200,'cell_size',128,'seed',98213,
   'total_players',(select count(*) from public.players),'total_settlements',(select count(*) from public.settlements)),
 'players',coalesce((select jsonb_agg(p order by created_at)from public.players p where p.id=u
   or exists(select 1 from public.battles b where (b.attacker_owner_id=u or b.defender_owner_id=u) and (b.attacker_owner_id=p.id or b.defender_owner_id=p.id))
   or exists(select 1 from public.peris_challenges c where c.status='pending' and c.expires_at>now() and (c.attacker_owner_id=u or c.defender_owner_id=u) and (c.attacker_owner_id=p.id or c.defender_owner_id=p.id))),'[]'::jsonb),
 'settlements',coalesce((select jsonb_agg(s order by id)from public.settlements s where s.owner_id=u),'[]'::jsonb),
 'buildings',coalesce((select jsonb_agg(b order by b.id)from public.buildings b join public.settlements s on s.id=b.settlement_id where s.owner_id=u),'[]'::jsonb),
 'spell_research',coalesce((select jsonb_agg(r order by r.spell_id)from public.peris_spell_research r join public.settlements s on s.id=r.settlement_id where s.owner_id=u),'[]'::jsonb),
 'city_slots',coalesce((select jsonb_agg(c order by c.slot_index)from public.peris_city_slots c join public.settlements s on s.id=c.settlement_id where s.owner_id=u),'[]'::jsonb),
 'armies',coalesce((select jsonb_agg(a order by id)from public.armies a where a.owner_id=u),'[]'::jsonb),
 'camps',coalesce((select jsonb_agg(c order by id)from public.peris_camps c),'[]'::jsonb),
 'orders',coalesce((select jsonb_agg(o order by finish_at)from public.peris_orders o where owner_id=u),'[]'::jsonb),
 'battles',coalesce((select jsonb_agg(b order by id)from public.battles b where attacker_owner_id=u or defender_owner_id=u),'[]'::jsonb),
 'formations',coalesce((select jsonb_agg(f order by f.id)from public.battle_formations f join public.battles b on b.id=f.battle_id where b.status='active'and (b.attacker_owner_id=u or b.defender_owner_id=u)),'[]'::jsonb),
 'reports',coalesce((select jsonb_agg(r order by id desc)from (select * from public.peris_reports where owner_id=u order by id desc limit 50)r),'[]'::jsonb),
 'progress',coalesce((select jsonb_agg(p)from public.peris_progress p where owner_id=u),'[]'::jsonb),
 'claims',coalesce((select jsonb_agg(c)from public.peris_claims c where owner_id=u),'[]'::jsonb),
 'challenges',coalesce((select jsonb_agg(c)from public.peris_challenges c where (attacker_owner_id=u or defender_owner_id=u)and status='pending'and expires_at>now()),'[]'::jsonb))into result;
 return result;
end $$;

-- Public strategic visibility is bounded independently of the private campaign
-- snapshot. The caller's own markers remain available outside the viewport.
create or replace function public.peris_map_snapshot(p_min_x integer,p_min_y integer,p_max_x integer,p_max_y integer)
returns jsonb language plpgsql security definer set search_path='' as $$
declare u uuid:=auth.uid();min_x integer;min_y integer;max_x integer;max_y integer;result jsonb;
begin
 if u is null then raise exception 'Authentication required';end if;
 if p_min_x is null or p_min_y is null or p_max_x is null or p_max_y is null then raise exception 'Choose map bounds';end if;
 min_x:=greatest(-12800,p_min_x);min_y:=greatest(-12800,p_min_y);
 max_x:=least(12800,p_max_x);max_y:=least(12800,p_max_y);
 if min_x>=max_x or min_y>=max_y then raise exception 'Choose valid map bounds';end if;
 with visible_settlements as (
   select s.id,s.owner_id,s.name,s.x,s.y,s.faction from public.settlements s where s.owner_id=u
   union all
   select * from (select s.id,s.owner_id,s.name,s.x,s.y,s.faction from public.settlements s
     where s.owner_id<>u and s.x>=min_x and s.x<max_x and s.y>=min_y and s.y<max_y order by s.id limit 600) nearby
 ), army_positions as (
   select a.*,
     (travel.position->>'x')::numeric as map_x,
     (travel.position->>'y')::numeric as map_y
   from public.armies a cross join lateral (
     select public.peris_army_position(a) as position
   ) travel
   where a.owner_id=u or a.status='moving'
     or (a.target_x>=min_x and a.target_x<max_x and a.target_y>=min_y and a.target_y<max_y)
 ), visible_armies as (
   select a.* from army_positions a where a.owner_id=u
   union all
   select * from (select a.* from army_positions a where a.owner_id<>u
     and a.map_x>=min_x and a.map_x<max_x and a.map_y>=min_y and a.map_y<max_y order by a.id limit 600) nearby
 ), visible_owners as (
   select owner_id from visible_settlements union select owner_id from visible_armies union select u
 )
 select jsonb_build_object('server_now',now(),
   'players',coalesce((select jsonb_agg(jsonb_build_object('id',p.id,'display_name',p.display_name) order by p.id)
     from public.players p join visible_owners o on o.owner_id=p.id),'[]'::jsonb),
   'settlements',coalesce((select jsonb_agg(s order by s.id) from visible_settlements s),'[]'::jsonb),
   'armies',coalesce((select jsonb_agg(to_jsonb(a)-'map_x'-'map_y' order by a.id) from visible_armies a),'[]'::jsonb),
   'total_players',(select count(*) from public.players),'total_settlements',(select count(*) from public.settlements),
   'settlements_truncated',(select count(*)>600 from public.settlements s where s.owner_id<>u and s.x>=min_x and s.x<max_x and s.y>=min_y and s.y<max_y),
   'armies_truncated',(select count(*)>600 from army_positions a where a.owner_id<>u and a.map_x>=min_x and a.map_x<max_x and a.map_y>=min_y and a.map_y<max_y)) into result;
 return result;
end $$;
create or replace function public.peris_tick(p_battle_id bigint) returns jsonb language plpgsql security definer set search_path='' as $$
declare u uuid:=auth.uid();b public.battles%rowtype;f public.battle_formations%rowtype;t public.battle_formations%rowtype;
 remain numeric;dt numeric;dx numeric;dy numeric;distance numeric;speed numeric;reach numeric;move_step numeric;direction numeric;turn numeric;
 gf jsonb;gt jsonb;pending jsonb;entry jsonb;pair record;rate numeric;flank numeric;charge numeric;matchup numeric;stance_mult numeric;brace numeric;cover numeric;elevation numeric;melee_arc numeric;defence numeric;difficulty_mult numeric;relative numeric;damage numeric;cas integer;mor_loss numeric;alive_a integer;alive_d integer;strength_a integer;strength_d integer;
begin
 select * into b from public.battles where id=p_battle_id for update;
 if u is null or b.id is null or (u is distinct from b.attacker_owner_id and u is distinct from b.defender_owner_id) then raise exception 'Not your battle';end if;
 if b.status<>'active' or b.phase<>'combat' then return jsonb_build_object('ok',true);end if;
 remain:=least(2,greatest(0,extract(epoch from(now()-b.last_tick_at))));
 if remain<0.15 then return jsonb_build_object('ok',true);end if;
 update public.battles set last_tick_at=now() where id=b.id;
 while remain>0 loop
 dt:=least(0.1,remain);remain:=remain-dt;b.elapsed:=b.elapsed+dt;
 -- NPCs choose targets; archers pull away from melee and cavalry favours bowmen.
 if b.mode='pve' and floor(b.elapsed*2)<>floor((b.elapsed-dt)*2) then
 for f in select * from public.battle_formations where battle_id=b.id and owner_id is null and soldiers>0 and status<>'routed' order by id loop
 select * into t from public.battle_formations where battle_id=b.id and side<>f.side and soldiers>0 and status<>'routed'
 order by case when f.unit_type='cavalry' and b.difficulty<>'easy' and unit_type='archers' then 0 else 1 end,power(x-f.x,2)+power(y-f.y,2),id limit 1;
 if t.id is null then continue;end if;
 distance:=sqrt(power(t.x-f.x,2)+power(t.y-f.y,2));
 if f.unit_type='archers' and distance<80 and b.difficulty<>'easy' then
 update public.battle_formations set target_formation_id=null,target_x=greatest(50,least(1150,f.x+(f.x-t.x)*1.2)),target_y=greatest(50,least(650,f.y+(f.y-t.y)*1.2)),status='moving' where id=f.id;
 elsif f.target_formation_id is distinct from t.id then
 update public.battle_formations set target_formation_id=t.id,status='moving',running=unit_type='cavalry',
 charge_ready=unit_type='cavalry' and distance>140 and stamina>35 where id=f.id;
 end if;
 end loop;
 end if;
 -- Movement / self-defence pass.
 for f in select * from public.battle_formations where battle_id=b.id and soldiers>0 order by id for update loop
 if f.status='routed' then update public.battle_formations set x=greatest(12,least(1188,x+case when side='attacker' then -1 else 1 end*64*dt))where id=f.id;continue;end if;
 if f.target_formation_id is not null then
 select * into t from public.battle_formations where id=f.target_formation_id and soldiers>0 and status<>'routed';
 if t.id is null then f.target_formation_id:=null;f.target_x:=f.x;f.target_y:=f.y;f.charge_ready:=false;end if;
 end if;
 reach:=case f.unit_type when 'archers' then 220 when 'cavalry' then 50 else 44 end;
 if f.target_formation_id is null then
 select * into t from public.battle_formations where battle_id=b.id and side<>f.side and soldiers>0 and status<>'routed'
 and sqrt(power(x-f.x,2)+power(y-f.y,2))<case when f.unit_type='archers' and not f.fire_at_will then 0 else reach end
 order by power(x-f.x,2)+power(y-f.y,2),id limit 1;
 if t.id is not null then f.target_formation_id:=t.id;f.charge_ready:=false;end if;
 end if;
 if f.target_formation_id is not null then select * into t from public.battle_formations where id=f.target_formation_id;f.target_x:=t.x;f.target_y:=t.y;else reach:=0;end if;
 dx:=f.target_x-f.x;dy:=f.target_y-f.y;distance:=sqrt(dx*dx+dy*dy);gf:=public.peris_ground(b.terrain,f.x,f.y);
 if distance>reach+2 and not(f.target_formation_id is not null and f.stance='guard') then
 direction:=degrees(atan2(dy,dx));turn:=direction-f.facing;turn:=turn-360*floor((turn+180)/360);f.facing:=f.facing+greatest(-150*dt,least(150*dt,turn));
 speed:=(case f.unit_type when 'cavalry' then 76 when 'archers' then 34 else 40 end)*f.magic_speed*(gf->>'speed')::numeric*
 (case when f.unit_type='cavalry' and gf->>'kind'='Forest' then 0.65 else 1 end)*(case when f.running and f.stamina>8 then 1.45 else 1 end)*(case when f.stamina<15 then 0.75 else 1 end);
 move_step:=least(speed*dt,distance-reach);f.x:=greatest(25,least(1175,f.x+dx/distance*move_step));f.y:=greatest(30,least(670,f.y+dy/distance*move_step));f.status:='moving';
 f.stamina:=greatest(0,least(100,f.stamina-case when f.running then 1.9 else 0.12 end*dt));
 else
 f.status:=case when f.target_formation_id is null then 'idle' else 'engaged' end;
 f.stamina:=greatest(0,least(100,f.stamina+case when f.target_formation_id is null then 2 else -0.4 end*dt));
 if f.target_formation_id is null and f.target_facing is not null then
 turn:=f.target_facing-f.facing;turn:=turn-360*floor((turn+180)/360);f.facing:=f.facing+greatest(-150*dt,least(150*dt,turn));end if;
 if f.target_formation_id is null and f.morale<90 then f.morale:=least(100,f.morale+0.7*dt);end if;
 end if;
 update public.battle_formations set x=f.x,y=f.y,facing=f.facing,target_x=f.target_x,target_y=f.target_y,target_formation_id=f.target_formation_id,status=f.status,stamina=f.stamina,morale=f.morale,charge_ready=f.charge_ready,updated_at=now() where id=f.id;
 end loop;
 -- Accumulate attacks into a map, then apply both armies' losses together.
 pending:='{}'::jsonb;
 for f in select * from public.battle_formations where battle_id=b.id and soldiers>0 and status<>'routed' and target_formation_id is not null order by id loop
 select * into t from public.battle_formations where id=f.target_formation_id;if t.id is null or t.status='routed' or t.soldiers=0 then continue;end if;
 dx:=t.x-f.x;dy:=t.y-f.y;distance:=sqrt(dx*dx+dy*dy);reach:=case f.unit_type when 'archers' then 220 when 'cavalry' then 50 else 44 end;
 if distance>reach+4 then continue;end if;
 gf:=public.peris_ground(b.terrain,f.x,f.y);gt:=public.peris_ground(b.terrain,t.x,t.y);
 relative:=degrees(atan2(f.y-t.y,f.x-t.x))-t.facing;relative:=abs(relative-360*floor((relative+180)/360));
 flank:=case when f.unit_type='archers' and distance>65 then 1 when relative>135 then 1.65 when relative>65 then 1.28 else 1 end;
 charge:=case when f.charge_ready and f.unit_type='cavalry' and gf->>'kind'<>'Forest' then 2.4 else 1 end;
 matchup:=case when f.unit_type='cavalry' then case when t.unit_type='archers' then 1.65 else 0.9 end when f.unit_type='infantry' then case when t.unit_type='cavalry' then 1.25 else 1 end else case when t.unit_type='cavalry' then 0.75 else 1 end end;
 stance_mult:=case f.stance when 'aggressive' then 1.22 when 'guard' then 0.9 else 1 end;
 brace:=case when t.stance='guard' and t.unit_type='infantry' and relative<65 and f.unit_type='cavalry' then 0.5 else 1 end;
 defence:=case t.stance when 'guard' then 0.8 when 'aggressive' then 1.15 else 1 end;
 cover:=case when f.unit_type='archers' and distance>65 then (gt->>'cover')::numeric else 1 end;
 elevation:=case when f.unit_type='archers' and distance>65 and (gf->>'height')::numeric>(gt->>'height')::numeric then 1.25 when f.unit_type='archers' and distance>65 and (gf->>'height')::numeric<(gt->>'height')::numeric then 0.8 else 1 end;
 melee_arc:=case when f.unit_type='archers' and distance<=65 then 0.28 else 1 end;
 difficulty_mult:=case when f.owner_id is null then case b.difficulty when 'hard' then 1.13 when 'easy' then 0.8 else 1 end else 1 end;
 rate:=case f.unit_type when 'infantry' then 0.020 when 'archers' then 0.012 else 0.031 end;
 damage:=f.damage_pool+f.soldiers*f.attack_multiplier*f.magic_attack*(1-t.magic_defence)*rate*matchup*stance_mult*defence*brace*flank*charge*cover*elevation*melee_arc*difficulty_mult*(0.55+f.stamina/220)*dt;
 if charge>1 then damage:=damage+f.soldiers*0.06*brace*flank*(1-t.magic_defence);end if;
 cas:=least(greatest(0,t.soldiers-coalesce((pending->t.id::text->>'loss')::integer,0)),floor(damage)::integer);mor_loss:=cas::numeric/greatest(1,t.initial_soldiers)*85+case when flank>1 then cas*1.2 else 0 end+case when charge>1 then 12 else 0 end;
 update public.battle_formations set damage_pool=damage-cas,kills=kills+cas,charge_ready=case when charge>1 then false else charge_ready end,
 stamina=case when charge>1 then greatest(0,stamina-12) else stamina end where id=f.id;
 entry:=coalesce(pending->t.id::text,'{"loss":0,"morale":0}'::jsonb);
 pending:=jsonb_set(pending,array[t.id::text],jsonb_build_object('loss',(entry->>'loss')::integer+cas,'morale',(entry->>'morale')::numeric+mor_loss),true);
 end loop;
 for pair in select key,value from jsonb_each(pending) loop
 update public.battle_formations set soldiers=greatest(0,soldiers-(pair.value->>'loss')::integer),morale=greatest(0,morale-(pair.value->>'morale')::numeric) where id=pair.key::bigint;
 update public.battle_formations set status='routed',target_formation_id=null where id=pair.key::bigint and (soldiers=0 or morale<18);
 end loop;
 select count(*)filter(where side='attacker'),count(*)filter(where side='defender'),coalesce(sum(soldiers)filter(where side='attacker'),0),coalesce(sum(soldiers)filter(where side='defender'),0)
 into alive_a,alive_d,strength_a,strength_d from public.battle_formations where battle_id=b.id and soldiers>0 and status<>'routed';
 update public.battles set elapsed=b.elapsed where id=b.id;
 if alive_a=0 or alive_d=0 then perform public.peris_finish(b.id,case when alive_a>0 then 'attacker' when alive_d>0 then 'defender' else 'draw' end,'Army routed');exit;end if;
 if b.elapsed>=900 then perform public.peris_finish(b.id,case when strength_a>strength_d then 'attacker' when strength_d>strength_a then 'defender' else 'draw' end,'Time limit');exit;end if;
 end loop;
 return jsonb_build_object('ok',true);
end $$;

do $$declare r record;begin for r in select p.oid from pg_proc p join pg_namespace n on n.oid=p.pronamespace where n.nspname='public' and p.proname in ('peris_city_migrate','peris_settle','peris_city_economy','peris_add_formations')loop execute 'revoke all on function '||r.oid::regprocedure::text||' from public,anon,authenticated';end loop;end $$;
commit;
