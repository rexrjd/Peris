-- PERIS v7 · Empire prototype. Run this entire file in Supabase SQL Editor.
-- Requires the v5 schema. Preserves players, settlements, resources and armies.
-- Safe to run again. No Auth users or campaign data are deleted.
begin;

alter table public.players add column if not exists prestige integer not null default 0;
alter table public.players add column if not exists victories integer not null default 0;
alter table public.players add column if not exists recruits integer not null default 0;
alter table public.players add column if not exists upgrades integer not null default 0;
alter table public.settlements add column if not exists capacity integer not null default 5000;
alter table public.settlements alter column capacity set default 5000;
alter table public.settlements alter column wood_rate set default 14;
alter table public.settlements alter column stone_rate set default 12;
alter table public.settlements alter column food_rate set default 18;
alter table public.settlements alter column gold_rate set default 3;
alter table public.settlements alter column wood type numeric(18,4);
alter table public.settlements alter column stone type numeric(18,4);
alter table public.settlements alter column food type numeric(18,4);
alter table public.settlements alter column gold type numeric(18,4);
update public.buildings set level=least(5,greatest(0,level));
alter table public.buildings drop constraint if exists buildings_level_check;
alter table public.buildings add constraint buildings_level_check check(level between 0 and 5);
alter table public.buildings drop constraint if exists buildings_building_type_check;
alter table public.buildings add constraint buildings_building_type_check check(building_type in ('lumber','quarry','farm','market','barracks','stables','wall','storehouse'));
insert into public.buildings(settlement_id,building_type,level)
select s.id,t,0 from public.settlements s cross join unnest(array['barracks','stables','wall','storehouse']) t
on conflict(settlement_id,building_type) do nothing;

-- Five-stage city progression: level 0 is an unbuilt/ruined plot, levels 1-5 are the visual and mechanical upgrades.
update public.settlements s set
 wood_rate=14+coalesce((select level from public.buildings b where b.settlement_id=s.id and b.building_type='lumber'),0)*8,
 stone_rate=12+coalesce((select level from public.buildings b where b.settlement_id=s.id and b.building_type='quarry'),0)*7,
 food_rate=18+coalesce((select level from public.buildings b where b.settlement_id=s.id and b.building_type='farm'),0)*10,
 gold_rate=3+coalesce((select level from public.buildings b where b.settlement_id=s.id and b.building_type='market'),0)*3,
 capacity=5000+coalesce((select level from public.buildings b where b.settlement_id=s.id and b.building_type='storehouse'),0)*2500;

create table if not exists public.peris_camps(
 id integer primary key,name text not null,x integer not null,y integer not null,tier integer not null,
 terrain text not null,infantry integer not null,archers integer not null,cavalry integer not null,description text not null
);
insert into public.peris_camps(id,name,x,y,tier,terrain,infantry,archers,cavalry,description) values
 (1,'The broken standard',305,405,1,'plains',48,18,0,'Deserters have claimed the old crossroads. An ideal first campaign.'),
 (2,'Oakwood raiders',460,155,2,'woods',90,45,12,'Bowmen hide beneath dense oak cover. Keep your cavalry out of the trees.'),
 (3,'The river watch',655,485,2,'river',100,40,15,'A fortified crossing. The shallows slow troops; use the stone bridge.'),
 (4,'Highland warband',790,160,3,'highlands',160,70,24,'Veteran spearmen defend the ridge. High ground favours their archers.'),
 (5,'Ashen legion',910,550,4,'plains',240,110,55,'A rebel legion controls the eastern road. You will need a larger host.'),
 (6,'The fallen capital',605,280,5,'highlands',340,160,80,'Break the last great host and restore the lost province of Peris.')
on conflict(id) do update set name=excluded.name,x=excluded.x,y=excluded.y,tier=excluded.tier,terrain=excluded.terrain,
 infantry=excluded.infantry,archers=excluded.archers,cavalry=excluded.cavalry,description=excluded.description;

alter table public.armies add column if not exists raid_target_id integer references public.peris_camps(id);
alter table public.battles alter column defender_owner_id drop not null;
alter table public.battles alter column defender_army_id drop not null;
alter table public.battles add column if not exists phase text not null default 'combat';
alter table public.battles add column if not exists mode text not null default 'pvp';
alter table public.battles add column if not exists camp_id integer references public.peris_camps(id);
alter table public.battles add column if not exists terrain text not null default 'plains';
alter table public.battles add column if not exists difficulty text not null default 'normal';
alter table public.battles add column if not exists enemy_name text not null default 'Rival army';
alter table public.battles add column if not exists winner_side text;
alter table public.battles add column if not exists attacker_ready boolean not null default false;
alter table public.battles add column if not exists defender_ready boolean not null default false;
alter table public.battles add column if not exists elapsed numeric not null default 0;
alter table public.battles add column if not exists rally_attacker boolean not null default false;
alter table public.battles add column if not exists rally_defender boolean not null default false;
alter table public.battle_formations alter column owner_id drop not null;
alter table public.battle_formations drop constraint if exists battle_formations_battle_id_owner_id_unit_type_key;
alter table public.battle_formations add column if not exists label text not null default 'Formation';
alter table public.battle_formations add column if not exists stamina numeric(6,2) not null default 100;
alter table public.battle_formations add column if not exists columns integer not null default 10;
alter table public.battle_formations add column if not exists stance text not null default 'balanced';
alter table public.battle_formations add column if not exists running boolean not null default false;
alter table public.battle_formations add column if not exists fire_at_will boolean not null default true;
alter table public.battle_formations add column if not exists target_facing numeric;

create table if not exists public.peris_orders(
 id bigint generated always as identity primary key,owner_id uuid not null references public.players(id) on delete cascade,
 kind text not null check(kind in ('upgrade','recruit')),item text not null,quantity integer not null check(quantity>0),
 started_at timestamptz not null,finish_at timestamptz not null
);
create index if not exists peris_orders_owner_idx on public.peris_orders(owner_id,finish_at);
create table if not exists public.peris_progress(
 owner_id uuid not null references public.players(id) on delete cascade,camp_id integer not null references public.peris_camps(id),
 defeated integer not null default 1,available_at timestamptz not null,primary key(owner_id,camp_id)
);
create table if not exists public.peris_claims(
 owner_id uuid not null references public.players(id) on delete cascade,quest_id text not null,primary key(owner_id,quest_id)
);
create table if not exists public.peris_reports(
 id bigint generated always as identity primary key,owner_id uuid not null references public.players(id) on delete cascade,
 battle_id bigint not null references public.battles(id) on delete cascade,title text not null,won boolean not null,
 result jsonb not null,created_at timestamptz not null default now(),unique(owner_id,battle_id)
);
create table if not exists public.peris_challenges(
 id bigint generated always as identity primary key,attacker_owner_id uuid not null references public.players(id) on delete cascade,
 defender_owner_id uuid not null references public.players(id) on delete cascade,status text not null default 'pending',
 created_at timestamptz not null default now(),expires_at timestamptz not null default now()+interval '90 seconds',
 check(attacker_owner_id<>defender_owner_id)
);
create index if not exists peris_challenges_lookup_idx on public.peris_challenges(defender_owner_id,status);

-- New tables expose read access only. All game changes are checked by RPC functions.
do $$ declare t text; begin
 foreach t in array array['peris_camps','peris_orders','peris_progress','peris_claims','peris_reports','peris_challenges'] loop
 execute format('alter table public.%I enable row level security',t);
 execute format('revoke all on public.%I from anon, authenticated',t);
 execute format('grant select on public.%I to authenticated',t);
 end loop;
end $$;
drop policy if exists "camp read" on public.peris_camps;
create policy "camp read" on public.peris_camps for select to authenticated using(true);
drop policy if exists "own orders" on public.peris_orders;
create policy "own orders" on public.peris_orders for select to authenticated using(owner_id=auth.uid());
drop policy if exists "own progress" on public.peris_progress;
create policy "own progress" on public.peris_progress for select to authenticated using(owner_id=auth.uid());
drop policy if exists "own claims" on public.peris_claims;
create policy "own claims" on public.peris_claims for select to authenticated using(owner_id=auth.uid());
drop policy if exists "own reports" on public.peris_reports;
create policy "own reports" on public.peris_reports for select to authenticated using(owner_id=auth.uid());
drop policy if exists "challenge participants" on public.peris_challenges;
create policy "challenge participants" on public.peris_challenges for select to authenticated
using(attacker_owner_id=auth.uid() or defender_owner_id=auth.uid());

-- Internal helpers are revoked from ALL client roles at the end of the file.
-- Preserve the existing realm; permit additional independently owned cities/armies.
alter table public.settlements drop constraint if exists settlements_owner_id_key;
alter table public.armies drop constraint if exists armies_owner_id_key;
alter table public.settlements alter column spawn_point_id drop not null;
alter table public.settlements add column if not exists settlers integer not null default 0 check(settlers between 0 and 6);
alter table public.settlements add column if not exists development_points integer not null default 0;
alter table public.players add column if not exists culture_points numeric not null default 0 check(culture_points between 0 and 1000000000);
alter table public.players add column if not exists culture_updated_at timestamptz not null default now();
alter table public.peris_orders add column if not exists settlement_id bigint references public.settlements(id) on delete cascade;
alter table public.peris_orders add column if not exists army_id bigint references public.armies(id) on delete cascade;
update public.peris_orders o set settlement_id=(select min(s.id)from public.settlements s where s.owner_id=o.owner_id)where settlement_id is null;
update public.peris_orders o set army_id=(select min(a.id)from public.armies a where a.owner_id=o.owner_id)where army_id is null and kind='recruit';
create index if not exists peris_orders_city on public.peris_orders(settlement_id,kind);
create index if not exists peris_orders_army on public.peris_orders(army_id,kind);
create index if not exists settlements_owner on public.settlements(owner_id);
create index if not exists armies_owner on public.armies(owner_id);
create table if not exists public.peris_heroes(
 id bigint generated always as identity primary key,owner_id uuid not null references public.players(id)on delete cascade,
 army_id bigint not null unique references public.armies(id)on delete cascade,name text not null,
 class text not null default 'knight' check(class in('knight','ranger','mage')),
 experience integer not null default 0 check(experience between 0 and 19000),
 attack integer not null default 0 check(attack between 0 and 19),defence integer not null default 0 check(defence between 0 and 19),
 power integer not null default 0 check(power between 0 and 19),knowledge integer not null default 0 check(knowledge between 0 and 19)
);
create table if not exists public.peris_artifact_catalog(
 id text primary key,name text not null,slot text not null check(slot in('weapon','armour','head','boots','charm')),
 attack integer not null default 0,defence integer not null default 0,power integer not null default 0,knowledge integer not null default 0,speed numeric not null default 0,unique(id,slot)
);
insert into public.peris_artifact_catalog(id,name,slot,attack,defence,power,knowledge,speed)values
 ('iron_sword','Iron oath','weapon',2,0,0,0,0),('oak_staff','Staff of embers','weapon',0,0,2,0,0),
 ('warblade','Dawnblade','weapon',4,0,0,0,0),('runestaff','Staff of the archmage','weapon',0,0,4,0,0),
 ('chainmail','Guardian mail','armour',0,2,0,0,0),('plate','Crownforged plate','armour',0,4,0,0,0),
 ('circlet','Scholar’s circlet','head',0,0,0,2,0),('warhelm','Helm of command','head',2,1,0,0,0),
 ('boots','Wayfarer’s boots','boots',0,0,0,0,.15),('windboots','Windwalkers','boots',0,0,0,0,.25),
 ('talisman','Amber talisman','charm',0,0,1,1,0),('crown_seal','Seal of the lost crown','charm',2,2,2,2,0)
 on conflict(id)do update set name=excluded.name,slot=excluded.slot,attack=excluded.attack,defence=excluded.defence,power=excluded.power,knowledge=excluded.knowledge,speed=excluded.speed;
create table if not exists public.peris_hero_artifacts(
 id bigint generated always as identity primary key,owner_id uuid not null references public.players(id)on delete cascade,
 artifact_id text not null,slot text not null,hero_id bigint references public.peris_heroes(id)on delete set null,
 source_camp_id integer,foreign key(artifact_id,slot)references public.peris_artifact_catalog(id,slot),unique(owner_id,source_camp_id)
);
create unique index if not exists peris_hero_equipment_slot on public.peris_hero_artifacts(hero_id,slot)where hero_id is not null;
create table if not exists public.peris_settler_expeditions(
 id bigint generated always as identity primary key,owner_id uuid not null references public.players(id)on delete cascade,
 origin_settlement_id bigint not null references public.settlements(id)on delete cascade,col integer not null check(col between -100 and 99),row integer not null check(row between -100 and 99),name text not null check(length(name)between 2 and 32),
 departure_at timestamptz not null,arrival_at timestamptz not null,culture_cost integer not null check(culture_cost>0),march_path jsonb not null,
 status text not null default 'travelling'check(status in('travelling','founded','returned')),settlement_id bigint references public.settlements(id),check(arrival_at>=departure_at)
);
create unique index if not exists peris_settler_site on public.peris_settler_expeditions(col,row)where status='travelling';
create index if not exists peris_settler_due on public.peris_settler_expeditions(owner_id,status,arrival_at);
alter table public.battle_formations add column if not exists defence_multiplier numeric not null default 1 check(defence_multiplier between 1 and 3);

create or replace function public.peris_city_id(p_owner uuid)returns bigint language plpgsql security definer set search_path='' as $$
declare requested bigint:=nullif(current_setting('peris.city_id',true),'')::bigint;result bigint;
begin
 if requested is null then select min(id)into result from public.settlements where owner_id=p_owner;
 else select id into result from public.settlements where owner_id=p_owner and id=requested;end if;
 if result is null then raise exception 'Choose one of your cities';end if;return result;
end $$;
create or replace function public.peris_army_id(p_owner uuid)returns bigint language plpgsql security definer set search_path='' as $$
declare requested bigint:=nullif(current_setting('peris.army_id',true),'')::bigint;result bigint;
begin
 if requested is null then select min(id)into result from public.armies where owner_id=p_owner;
 else select id into result from public.armies where owner_id=p_owner and id=requested;end if;
 if result is null then raise exception 'Choose one of your armies';end if;return result;
end $$;
create or replace function public.peris_scope_order()returns trigger language plpgsql security definer set search_path='' as $$
begin
 new.settlement_id:=coalesce(new.settlement_id,public.peris_city_id(new.owner_id));
 if not exists(select 1 from public.settlements where id=new.settlement_id and owner_id=new.owner_id)then raise exception 'Order city ownership mismatch';end if;
 if new.kind='recruit' then
 new.army_id:=coalesce(new.army_id,public.peris_army_id(new.owner_id));
 if not exists(select 1 from public.armies where id=new.army_id and owner_id=new.owner_id)then raise exception 'Order army ownership mismatch';end if;
 end if;return new;
end $$;
drop trigger if exists peris_scope_order on public.peris_orders;
create trigger peris_scope_order before insert or update of settlement_id,army_id,owner_id,kind on public.peris_orders for each row execute function public.peris_scope_order();
create or replace function public.peris_new_army_hero()returns trigger language plpgsql security definer set search_path='' as $$
begin
 insert into public.peris_heroes(owner_id,army_id,name)values(new.owner_id,new.id,(select display_name from public.players where id=new.owner_id)||' · Captain '||(select count(*)+1 from public.peris_heroes where owner_id=new.owner_id))on conflict(army_id)do nothing;return new;
end $$;
drop trigger if exists peris_new_army_hero on public.armies;
create trigger peris_new_army_hero after insert on public.armies for each row execute function public.peris_new_army_hero();
insert into public.peris_heroes(owner_id,army_id,name)select a.owner_id,a.id,p.display_name||' · Captain '||row_number()over(partition by a.owner_id order by a.id)from public.armies a join public.players p on p.id=a.owner_id on conflict(army_id)do nothing;

-- These new tables are private read-only DTOs; the authoritative RPC owns writes.
do $$declare t text;begin
 foreach t in array array['peris_heroes','peris_hero_artifacts','peris_settler_expeditions']loop
 execute format('alter table public.%I enable row level security',t);
 execute format('revoke all on public.%I from public,anon,authenticated',t);
 execute format('grant select on public.%I to authenticated',t);
 execute format('drop policy if exists "own gameplay data" on public.%I',t);
 execute format('create policy "own gameplay data" on public.%I for select to authenticated using(owner_id=auth.uid())',t);
 end loop;
end $$;
alter table public.peris_artifact_catalog enable row level security;
revoke all on public.peris_artifact_catalog from public,anon,authenticated;
grant select on public.peris_artifact_catalog to authenticated;
drop policy if exists "artifact catalogue" on public.peris_artifact_catalog;
create policy "artifact catalogue" on public.peris_artifact_catalog for select to authenticated using(true);
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
 where b.settlement_id=p_sid and b.building_type in ('barracks','stables','storehouse') and (b.level>0 or exists(select 1 from public.peris_orders o where o.owner_id=s.owner_id and o.settlement_id=p_sid and o.kind='upgrade' and o.item=b.building_type)) on conflict do nothing;
 -- Preserve the food capacity of old combined storehouses as well.
 insert into public.peris_city_slots select p_sid,3,'granary',level from public.buildings where settlement_id=p_sid and building_type='storehouse' and level>0 on conflict do nothing;
 update public.peris_orders o set item='slot:'||(case item when 'barracks' then '0:barracks' when 'stables' then '1:stables' else '2:warehouse' end)
 where o.settlement_id=p_sid and kind='upgrade' and item in ('barracks','stables','storehouse');
 update public.settlements set city_slots_ready=true where id=p_sid;
 perform public.peris_city_economy(p_sid);
end $$;
create or replace function public.peris_queue_slot(p_slot integer,p_type text default null) returns jsonb language plpgsql security definer set search_path='' as $$
declare u uuid:=auth.uid();s public.settlements%rowtype;l integer;main integer;t text;factor numeric;cw numeric;cs numeric;cf numeric;cg numeric;
begin
 if u is null then raise exception 'Authentication required';end if;
 perform public.peris_settle(u);
 if exists(select 1 from public.battles where status='active' and (attacker_owner_id=u or defender_owner_id=u)) then raise exception 'Finish the current battle first';end if;
 select * into s from public.settlements where id=public.peris_city_id(u) for update;
 if s.id is null then raise exception 'Realm not found';end if;
 select level into main from public.buildings where settlement_id=s.id and building_type='market';
 if p_slot is null or p_slot<0 or p_slot<>16 and p_slot>=6+2*coalesce(main,0) then raise exception 'Upgrade the main building to unlock this plot';end if;
 if exists(select 1 from public.peris_orders where owner_id=u and settlement_id=s.id and kind='upgrade') then raise exception 'Your builders are already working';end if;
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
-- Never shrink an occupied world silently. The enclosing transaction aborts
-- before changing constraints, terrain or positions when migration is needed.
alter table public.armies add column if not exists march_path jsonb;
alter table public.armies add column if not exists march_distance numeric;
alter table public.armies add column if not exists march_map_version integer;
create or replace function public.peris_wrap_world(p_value numeric) returns numeric
language sql immutable set search_path='' as $$ select mod(mod(p_value+12800,25600)+25600,25600)-12800 $$;
create or replace function public.peris_wrapped_delta(p_from numeric,p_to numeric) returns numeric
language sql immutable set search_path='' as $$ select public.peris_wrap_world(p_to-p_from) $$;
create or replace function public.peris_wrap_cell(p_value integer) returns integer
language sql immutable set search_path='' as $$ select mod(mod(p_value+100,200)+200,200)-100 $$;
do $$
declare outside_settlements integer;outside_armies integer;outside_routes integer;
begin
 select count(*) into outside_settlements from public.settlements
 where x < -12800 or x >= 12800 or y < -12800 or y >= 12800;
 select count(*) into outside_armies from public.armies
 where start_x < -12800 or start_x >= 12800 or start_y < -12800 or start_y >= 12800
    or target_x < -12800 or target_x >= 12800 or target_y < -12800 or target_y >= 12800;
 select count(*) into outside_routes from public.armies a
 where a.march_path is not null and exists (
  select 1 from jsonb_array_elements(a.march_path) p
  where (p->>0)::numeric < -12800 or (p->>0)::numeric >= 12800
     or (p->>1)::numeric < -12800 or (p->>1)::numeric >= 12800
 );
 if outside_settlements + outside_armies + outside_routes > 0 then
  raise exception '200 x 200 world upgrade requires manual migration: % settlements, % armies and % saved routes are outside [-12800, 12800). No positions were moved or deleted.',outside_settlements,outside_armies,outside_routes;
 end if;
end $$;
alter table public.settlements drop constraint if exists settlements_x_check;
alter table public.settlements add constraint settlements_x_check check(x >= -12800 and x < 12800);
alter table public.settlements drop constraint if exists settlements_y_check;
alter table public.settlements add constraint settlements_y_check check(y >= -12800 and y < 12800);

-- Original and historical generated spawn points retain their IDs/coordinates.
-- Current land-only sites are generated after the terrain mask is installed.
create index if not exists spawn_points_map_position_idx on public.spawn_points(x,y);

create index if not exists settlements_map_position_idx on public.settlements(x,y);
create index if not exists armies_map_status_idx on public.armies(status);
create index if not exists armies_map_position_idx on public.armies(target_x,target_y) where status='idle';
-- Generated by node --import tsx scripts/build-world.mjs. Do not edit these bytes.
-- Version 4, seed 1346720329; walkability bits and terrain bytes share row-major indexing.
create table if not exists public.peris_world_map(
 id integer primary key check(id=1),seed integer not null,cols integer not null,rows integer not null,
 cell_size integer not null,walkable bytea not null
);
alter table public.peris_world_map add column if not exists version integer not null default 3;
alter table public.peris_world_map add column if not exists terrain bytea;
alter table public.peris_world_map add column if not exists legacy_walkable bytea;
alter table public.peris_world_map drop constraint if exists peris_world_map_walkable_check;
alter table public.peris_world_map drop constraint if exists peris_world_map_terrain_check;
alter table public.peris_world_map enable row level security;
revoke all on public.peris_world_map from public,anon,authenticated;
-- Never silently relocate an existing player if their occupied field would become sea.
do $$ begin
 if exists(select 1 from public.settlements where get_bit(decode('fffffffffffffffff9ffffffffffffff0100000000f8fffffffffffffffffffffff9ffffffffffffff0100000000fcfffffffffffffffffffffff9ffffffffffffff0000000000fcfffffffffffffffffffffffbffffffffffffff0c00000000fffffffffffffffffffffffff3ffffffffffff7f7e000000c0fffffffffffffffffffffffff3ffffffffffff7fff010000f0ffffffffffffffffffffffffe7ffffffffffff3fff070000f8ffffffffffffffffffffffffe7ffffffffffff9fff3f0000feffffffffffffffffffffffffefffffffffffffcfffff00e0ffffffffffffffffffffffffffffffffffffffffdffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffefffffffffffefffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffeffeefffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffefffffefffffeffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffff01ffffffffffffffffffffffffffffffffffffffffffffff7f00feffffffffffffffffffffffffffffffffffffffffffff3f00fcffffffffffffffffffefffffffffffffffffffffffff1f00f8ffffffffffffffffffffffffffffffffffffffffffff0f00f0ffffffffffffffffffffffffffffffffffffffffffff0f00f0ffffffffffffffffffffffffffffffffffffffffffff0700e0ffffffffffffffffffffeffeffffffffffffffffffff0700c0ffffffffffffffffffffffffffffffffffffffffffff030040ffffffffffffffffffffffffffffffffffffffffffff030000ffffffffffffffffffffffffffffffffffffffffffff0300e0eefffffffffffffffffffffffeffffffffffffffffff0100f0ffffffffffffffffffffffffffffffffffffffffffff0100f0ffffffffffffffffffffffffffffffffffffffffffff0100f0ffffffffffffffffffffffffffffffffffffffffffff0100eeffffffffeefffffffffffffffffeffffffffffffffff0000ffffffffffffffffffffffffffffffffffffffffffffff0000ffffffffffffffffffffffffffffffffffffffffffffff0000ffffffffffffffffffffffffffffffffffffffffffffff0000eefffffffffffffffffffffffffffffeffffffffffffff0000f0ffffffffffffffffffffffffffffffffffffffffffff0000f0ffffffffffffffffffffffffffffffffffffffffffff0000f0ffffffffffffffffffffffffffffffffffffffffffff0000e0ffffffefffffffffffffffffffffffffffffffffffff0000f0ffffffffffffffffffffffffffffffffffffffffffff0000f0ffffffffffffffffffffffffffffffffffffffffffff0000f0ffffffffffffffffffffffffffffffffffffffffffff0100e0ffffffefffffffffffffffffffffefffffffffffffff0300f0ffffffffffffffffffffffffffffffffffffffffffff0300f0ffffffffffffffffffffffffffffffffffffffffffff0700f0ffffffffffffffffffffffffffffffffffffffffffff0f00eeffffffefffffffffffffffffffffffffffffffffffff0f00ffffffffffffffffffffffffffffffffffffffffffffff1f00ffffffffffffffffffffffffffffffffffffffffffffff3f00ffffffffffffffffffffffffffffffffffffffffffffff7fe0feffffffefffffffffffffeefffffffffffffffffffffffffdfffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffeffffffffffffffffffffffffffffffffffffffffffffff7ff0ffffffffffffffffffffffffffffffffffffffffffffff0fe0ffffffffffffffffffffffffffffffffffffffffffffff07c0ffffffffffffffffffffffffffffffffffffffffffffff07e0fffffffffffffffffffffffffffffffffffffffffeffff03f0ffffffffffffffffffffffffffffffffffffffffffffff01f0ffffffffffffffffffffffffffffffffffffffffffffff01f0ffffffffffffffffffffffffffffffffffffffffffffff00e0ffffffffffffffffffffffffffffffffffffffefffffff00f0ffffffffffffffffffffffffffffffffffffffffffff7f00f0ffffffffffffffffffffffffffffffffffffffffffff7f00f0ffffffffffffffffffffffffffffffffffffffffffff7f00e0fefffffffffeffffffffffffffffffffffffefffffff7f0000ffffffffffffffffffffffffffffffffffffffffffff3f0000ffffffffffffffffffffffffffffffffffffffffffff3f0000ffffffffffffffffffffffffffffffffffffffffffff3f00e0feffffffffffffffffffffffffffffffeffffeffffff3f00f0ffffffffffffffffffffffffffffffffffffffffffff3f00f0ffffffffffffffffffffffffffffffffffffffffffff7f00f0ffffffffffffffffffffffffffffffffffffffffffff7f00e0fffffffffffffeffffffffffffffffffffffeeffffffff00f0ffffffffffffffffffffffffffffffffffffffffffffff00f0ffffffffffffffffffffffffffffffffffffffffffffff01f0ffffffffffffffffffffffffffffffffffffffffffffff01f0fffffffffffffffefffffffffffffffffffeeeffffffff03f8ffffffffffffffffffffffffffffffffffffffffffffff0ffcffffffffffffffffffffffffffffffffffffffffffffff3ffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffefffffffffffffffffeffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffeffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffefffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffefffffffffffffefffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffeffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffefffefffffffffefffffffffeefefffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffeefffffffffffefffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffeffffeffeffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffefffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffff8ffffffffffffffffffffffffffffffffffffffffffffffffe0ffffffffffefffeffffffffffeffffffffffffffffffff7fc0ffffffffffffffffffffffffffffffffffffffffffffff3f80ffffffffffffffffffffffffffffffffffffffffffffff1f00ffffffffffffffffffffffffffffffffffffffffffffff0f00feffffffffffffffffffffffffefefffffffffffffffff0f00feffffffffffffffffffffffffffffffffffffffffffff0700fcffffffffffffffffffffffffffffffffffffffffffff0700fcffffffffffffffffffffffffffffffffffffffffffff0300fcfffffffffffeffffffffffffffeffeffffffffffffff0300f8ffffffffffffffffffffffffffffffffffffffffffff0300f0ffffffffffffffffffffffffffffffffffffffffffff0100f0ffffffffffffffffffffffffffffffffffffffffffff0100f0ffffffffefffffffffffffffffffeeffffffffffffff0100f0ffffffffffffffffffffffffffffffffffffffffffff0000f0ffffffffffffffffffffffffffffffffffffffffffff0000f0ffffffffffffffffffffffffffffffffffffffffffff0000e0ffffeffeefffffffffffffffffffffffffffffffffff0000e0ffffffffffffffffffffffffffffffffffffffffff7f0000e0ffffffffffffffffffffffffffffffffffffffffff7f0000e0ffffffffffffffffffffffffffffffffffffffffff7f0000e0ffffeffeffffffffffffffffffffffffffffffffff7f0000c0ffffffffffffffffffffffffffffffffffffffffff7f0000c0ffffffffffffffffffffffffffffffffffffffffff7f0000c0ffffffffffffffffffffffffffffffffffffffffff7f0000c0ffffffffffffffffffffffffffffffefffffffffff7f0000c0ffffffffffffffffffffffffffffffffffffffffff7f0000e0ffffffffffffffffffffffffffffffffffffffffff7f0006e0ffffffffffffffffffffffffffffffffffffffffff7f000fe0ffffffffffffffffffffffffffffffffffffffffff7f000fe0ffffffffffffffffffffffffffffffffffffffffffff000fe0ffffffffffffffffffffffffffffffffffffffffff7f000fe0ffffffffffffffffffffffffffffffffffffffffff7f0006e0fffffffffffeffffffffffffffffffffffffffffff7f0000e0ffffffffffffffffffffffffffffff3fffffffffff7f0000f0ffffffffffffffffffffffffffffff7fffffffffffff0000f0ffffffffffffffffffffffffffffff7fffffffffffff0000f0fffffffffffeffffffffffffffffff7ffeffffffffff0100f0ffffffffffffffffffffffffffffff7ffeffffffffff0100f8ffffffffffffffffffffffffffffff7ffeffffffffff0100f8ffffffffffffffffffffffffffffff7ffeffffffffff0100f0ffffffffffffffffffefeeffffffff7fffffffffffff0100f0fffffffffff3ffffffffdfffffffff7fffffffffffff0100f8fffffffffff3ffffffffdfffffffff7fffffffffffff0100f8ffffffffffe7ffffffffdfffffffff7fffffffffffff0300fcffffffffffe7ffffffffeeffffffff3fffffffffffff0300fcffffffffffcfffffffffffffffffff3fffffffffffff0700feffffffffffcfffffffffffffffffffbfffffffffffff0700feffffffffff9fffffffffffffffffffbfffffffffffff0f00ffffffffffff9fffffffffffffffffff9fffffffffffff0fe0ffffffffffff3fffffffffffffffffffdfffffffffffff1ff8ffffffffffff3fffffffffffffffffffdfffffffffffff3ffcffffffffffff3fffffffffffffffffffdfffffffffffffffffffffffffffff7ffeffffffffffffffffefffffffffffffffffffffffffffff7fffffffffffffffffffffffffffffffffffffffffffffffff7fffffffffffffffffffffffffffffffffffffffffffffffff7fffffffffffffffffff3f00e0fffffffffffffffffffffffffffeffffffffffffffff0f0080ffffffffffffffffffffffffffffffffffffffffffff000000feffffffffffffffffffffffffffffffffffffffff3f000000f0ffffffffffffffffffffffffffffffffffffffff1f000000c0fffffffffffffffffffffffffeffffffffffffff0f00000000fffffffffffffffffffffffffcffffffffffffff0700000000fffffffffffffffffffffffffcffffffffffffff0700000000fefffffffffffffffffffffffdffffffffffffff0700000000fcfffffffffffffffffffffffdffffffffffffff0300000000f8fffffffffffffffffffffffdffffffffffffff0300000000f8fffffffffffffffffffffffdffffffffffffff0100000000f8fffffffffffffffffffffffdffffffffffffff0100000000f0ffffff','hex'),(floor(y/128)::integer+100)*200+floor(x/128)::integer+100)=0) then
  raise exception 'An occupied settlement would become sea. Review its terrain before applying the map migration.';
 end if;
end $$;
update public.peris_world_map set legacy_walkable=walkable where version<4 and legacy_walkable is null;
insert into public.peris_world_map(id,seed,cols,rows,cell_size,walkable,terrain,version)
values(1,1346720329,200,200,128,decode('fffffffffffffffff9ffffffffffffff0100000000f8fffffffffffffffffffffff9ffffffffffffff0100000000fcfffffffffffffffffffffff9ffffffffffffff0000000000fcfffffffffffffffffffffffbffffffffffffff0c00000000fffffffffffffffffffffffff3ffffffffffff7f7e000000c0fffffffffffffffffffffffff3ffffffffffff7fff010000f0ffffffffffffffffffffffffe7ffffffffffff3fff070000f8ffffffffffffffffffffffffe7ffffffffffff9fff3f0000feffffffffffffffffffffffffefffffffffffffcfffff00e0ffffffffffffffffffffffffffffffffffffffffdffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffefffffffffffefffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffeffeefffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffefffffefffffeffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffff01ffffffffffffffffffffffffffffffffffffffffffffff7f00feffffffffffffffffffffffffffffffffffffffffffff3f00fcffffffffffffffffffefffffffffffffffffffffffff1f00f8ffffffffffffffffffffffffffffffffffffffffffff0f00f0ffffffffffffffffffffffffffffffffffffffffffff0f00f0ffffffffffffffffffffffffffffffffffffffffffff0700e0ffffffffffffffffffffeffeffffffffffffffffffff0700c0ffffffffffffffffffffffffffffffffffffffffffff030040ffffffffffffffffffffffffffffffffffffffffffff030000ffffffffffffffffffffffffffffffffffffffffffff0300e0eefffffffffffffffffffffffeffffffffffffffffff0100f0ffffffffffffffffffffffffffffffffffffffffffff0100f0ffffffffffffffffffffffffffffffffffffffffffff0100f0ffffffffffffffffffffffffffffffffffffffffffff0100eeffffffffeefffffffffffffffffeffffffffffffffff0000ffffffffffffffffffffffffffffffffffffffffffffff0000ffffffffffffffffffffffffffffffffffffffffffffff0000ffffffffffffffffffffffffffffffffffffffffffffff0000eefffffffffffffffffffffffffffffeffffffffffffff0000f0ffffffffffffffffffffffffffffffffffffffffffff0000f0ffffffffffffffffffffffffffffffffffffffffffff0000f0ffffffffffffffffffffffffffffffffffffffffffff0000e0ffffffefffffffffffffffffffffffffffffffffffff0000f0ffffffffffffffffffffffffffffffffffffffffffff0000f0ffffffffffffffffffffffffffffffffffffffffffff0000f0ffffffffffffffffffffffffffffffffffffffffffff0100e0ffffffefffffffffffffffffffffefffffffffffffff0300f0ffffffffffffffffffffffffffffffffffffffffffff0300f0ffffffffffffffffffffffffffffffffffffffffffff0700f0ffffffffffffffffffffffffffffffffffffffffffff0f00eeffffffefffffffffffffffffffffffffffffffffffff0f00ffffffffffffffffffffffffffffffffffffffffffffff1f00ffffffffffffffffffffffffffffffffffffffffffffff3f00ffffffffffffffffffffffffffffffffffffffffffffff7fe0feffffffefffffffffffffeefffffffffffffffffffffffffdfffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffeffffffffffffffffffffffffffffffffffffffffffffff7ff0ffffffffffffffffffffffffffffffffffffffffffffff0fe0ffffffffffffffffffffffffffffffffffffffffffffff07c0ffffffffffffffffffffffffffffffffffffffffffffff07e0fffffffffffffffffffffffffffffffffffffffffeffff03f0ffffffffffffffffffffffffffffffffffffffffffffff01f0ffffffffffffffffffffffffffffffffffffffffffffff01f0ffffffffffffffffffffffffffffffffffffffffffffff00e0ffffffffffffffffffffffffffffffffffffffefffffff00f0ffffffffffffffffffffffffffffffffffffffffffff7f00f0ffffffffffffffffffffffffffffffffffffffffffff7f00f0ffffffffffffffffffffffffffffffffffffffffffff7f00e0fefffffffffeffffffffffffffffffffffffefffffff7f0000ffffffffffffffffffffffffffffffffffffffffffff3f0000ffffffffffffffffffffffffffffffffffffffffffff3f0000ffffffffffffffffffffffffffffffffffffffffffff3f00e0feffffffffffffffffffffffffffffffeffffeffffff3f00f0ffffffffffffffffffffffffffffffffffffffffffff3f00f0ffffffffffffffffffffffffffffffffffffffffffff7f00f0ffffffffffffffffffffffffffffffffffffffffffff7f00e0fffffffffffffeffffffffffffffffffffffeeffffffff00f0ffffffffffffffffffffffffffffffffffffffffffffff00f0ffffffffffffffffffffffffffffffffffffffffffffff01f0ffffffffffffffffffffffffffffffffffffffffffffff01f0fffffffffffffffefffffffffffffffffffeeeffffffff03f8ffffffffffffffffffffffffffffffffffffffffffffff0ffcffffffffffffffffffffffffffffffffffffffffffffff3ffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffefffffffffffffffffeffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffeffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffefffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffefffffffffffffefffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffeffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffefffefffffffffefffffffffeefefffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffeefffffffffffefffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffeffffeffeffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffefffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffff8ffffffffffffffffffffffffffffffffffffffffffffffffe0ffffffffffefffeffffffffffeffffffffffffffffffff7fc0ffffffffffffffffffffffffffffffffffffffffffffff3f80ffffffffffffffffffffffffffffffffffffffffffffff1f00ffffffffffffffffffffffffffffffffffffffffffffff0f00feffffffffffffffffffffffffefefffffffffffffffff0f00feffffffffffffffffffffffffffffffffffffffffffff0700fcffffffffffffffffffffffffffffffffffffffffffff0700fcffffffffffffffffffffffffffffffffffffffffffff0300fcfffffffffffeffffffffffffffeffeffffffffffffff0300f8ffffffffffffffffffffffffffffffffffffffffffff0300f0ffffffffffffffffffffffffffffffffffffffffffff0100f0ffffffffffffffffffffffffffffffffffffffffffff0100f0ffffffffefffffffffffffffffffeeffffffffffffff0100f0ffffffffffffffffffffffffffffffffffffffffffff0000f0ffffffffffffffffffffffffffffffffffffffffffff0000f0ffffffffffffffffffffffffffffffffffffffffffff0000e0ffffeffeefffffffffffffffffffffffffffffffffff0000e0ffffffffffffffffffffffffffffffffffffffffff7f0000e0ffffffffffffffffffffffffffffffffffffffffff7f0000e0ffffffffffffffffffffffffffffffffffffffffff7f0000e0ffffeffeffffffffffffffffffffffffffffffffff7f0000c0ffffffffffffffffffffffffffffffffffffffffff7f0000c0ffffffffffffffffffffffffffffffffffffffffff7f0000c0ffffffffffffffffffffffffffffffffffffffffff7f0000c0ffffffffffffffffffffffffffffffefffffffffff7f0000c0ffffffffffffffffffffffffffffffffffffffffff7f0000e0ffffffffffffffffffffffffffffffffffffffffff7f0006e0ffffffffffffffffffffffffffffffffffffffffff7f000fe0ffffffffffffffffffffffffffffffffffffffffff7f000fe0ffffffffffffffffffffffffffffffffffffffffffff000fe0ffffffffffffffffffffffffffffffffffffffffff7f000fe0ffffffffffffffffffffffffffffffffffffffffff7f0006e0fffffffffffeffffffffffffffffffffffffffffff7f0000e0ffffffffffffffffffffffffffffff3fffffffffff7f0000f0ffffffffffffffffffffffffffffff7fffffffffffff0000f0ffffffffffffffffffffffffffffff7fffffffffffff0000f0fffffffffffeffffffffffffffffff7ffeffffffffff0100f0ffffffffffffffffffffffffffffff7ffeffffffffff0100f8ffffffffffffffffffffffffffffff7ffeffffffffff0100f8ffffffffffffffffffffffffffffff7ffeffffffffff0100f0ffffffffffffffffffefeeffffffff7fffffffffffff0100f0fffffffffff3ffffffffdfffffffff7fffffffffffff0100f8fffffffffff3ffffffffdfffffffff7fffffffffffff0100f8ffffffffffe7ffffffffdfffffffff7fffffffffffff0300fcffffffffffe7ffffffffeeffffffff3fffffffffffff0300fcffffffffffcfffffffffffffffffff3fffffffffffff0700feffffffffffcfffffffffffffffffffbfffffffffffff0700feffffffffff9fffffffffffffffffffbfffffffffffff0f00ffffffffffff9fffffffffffffffffff9fffffffffffff0fe0ffffffffffff3fffffffffffffffffffdfffffffffffff1ff8ffffffffffff3fffffffffffffffffffdfffffffffffff3ffcffffffffffff3fffffffffffffffffffdfffffffffffffffffffffffffffff7ffeffffffffffffffffefffffffffffffffffffffffffffff7fffffffffffffffffffffffffffffffffffffffffffffffff7fffffffffffffffffffffffffffffffffffffffffffffffff7fffffffffffffffffff3f00e0fffffffffffffffffffffffffffeffffffffffffffff0f0080ffffffffffffffffffffffffffffffffffffffffffff000000feffffffffffffffffffffffffffffffffffffffff3f000000f0ffffffffffffffffffffffffffffffffffffffff1f000000c0fffffffffffffffffffffffffeffffffffffffff0f00000000fffffffffffffffffffffffffcffffffffffffff0700000000fffffffffffffffffffffffffcffffffffffffff0700000000fefffffffffffffffffffffffdffffffffffffff0700000000fcfffffffffffffffffffffffdffffffffffffff0300000000f8fffffffffffffffffffffffdffffffffffffff0300000000f8fffffffffffffffffffffffdffffffffffffff0100000000f8fffffffffffffffffffffffdffffffffffffff0100000000f0ffffff','hex'),decode('0202010100000000000000000000000000000000000000000000010101000000020202020202020202040001010101010101010101010101010101010101010106080800000000000000000001010101010202020101000000000002020202020a0a0a0a0a04040404040404040404040404040404000002020200000000000000080808080808080808080808080808080808080808080808080808080808080808080808080808080808010101010000000000000000000202020202010101010101010202020202020101000000000000000000000000000000000000000000000101010000000202020202020202020202010101010101010101010101010101010101010100060808000000000000000000010101010102020201010000000000020202020a0a0a0a0a0a04040404040404040404040404040404040202020202020000000006080808080808080808080808080808080808080808080808080808080808080808080808080808080801010101000000000000000000000000010101010101010101010202020202020101000000000000000000000000000000000000000000000101010000020202020202020202020202010101010101010101010101010101010101010000060808060000000000000001010101010101010101010000000000000000000a0a0a0a0a0a04040404040404040404040404040404020202020202020000000008080808080808080808080808080808080808080808080808080808080808080808080808080808080800000000000000000000000000000000000101010101010101010202020202020200000000000000000000000000000000000000020202020202020202020202020202020202020200010101010101010101010202010101010101000000000608060000010101010101010101010101010101010000000000000000000a0a0a0a0a0a0a04040404040404040404040404040404020202020202000000060808060008080808080808080808080808080808080808080808080808080808080808080808080800000000000000000000000000000004040404000101010101010101020202020202020200000000000000000000000000000000000002020202020202020202020202020202020202000101010101010101010202020202010101010000000000060808060101010101010101010101010101010101000200000000000000000a0a0a0a0a0a0a04040404040404040404040404040402020202020202000608080600000000000808080808080808080808080808080808080808080808080808080808080800000000000000000000000000000000040404040404040000000000000000020202020202020200000000000000000000000000000000000202020202020202020202020202020202020200010101010202020202020202020202010101000400000000080806010101010101010202010101010101010102020200000000000000000000000000000a0404040404040404040404040000000000000002020006080600000000000000000808080808080808080808080808080808080808080808080808080000000000000000000000000000000000040404040404040404040400000000000000020202020202000000000000000000010101010101010102020202020200000000000002020202020202010101010102020202020202020202020202000404040000000608080601010101010101020101010101010101010200000000000000000000000000000000000a0a0a0a0a0a00000000000000000000000002020608080602020200000000000000080808080808080808080808080808080808080808080808000000000000000000000000000000000004040404040404040404040404040000000000000202020202000000000000000101010101010101010102020202020000000000000002020202020202010101010102020202020202020202020202020202040000000008080601010101010101010101010101010101010000000000000000000000000000000000000a0a0a0000000a000000000000000000000002060808060202020202000a0a0a0a000000000808080808080808080808080808080808080800000a000002000000000000000000000000000404040404040404040404040404040404040a02020202020200000000000001010202020201010101010102020200000000000000010102020202020201010101010101010101010102020202020202020202040000000608000601010101010101010101010101010101010000000202020000000000000000000000000000000000000000000000000000000000060808060202020000000a0a0a0a0a0a0000000000080808080808080808080808080104040404000a0a0202000000000000000000000000040404040404040404040404040404040404040402020202020200000000000001010202020202020101010101000000000000000000010102020202020202010101010101010101010101010101010004040404040000000106000001010101010101010101010101010101010000020202020200000000000000000000000000000000000000000000000000000000060008060000000000000a0a0a0a0a0202020200000101010101010101010101010101040404040a0a0a020a0a0a0a000000000000000004040404040404040404040404040404040404020202020202020200000000000101020202020202020202020101000000000000000001010101020202020202020202020101010101010101010101010004040404040000000106000006010101010101010101010101010101010000020202020200000000000000000000000000000000000000000000000000000006000006000000000000000a0a0a0a0a020202020000000101010101010101010101010104040404040a0a0a0a0a0a0a0a00000000000004040404040404040404040404040404040404020202020202020202000000010101020202020202020202020202010000000000000000010101010102020101010202020202010101010101010101010101000404040400000001010600000101010101010101010101010101010100000002020200000000000000000000000000000000000000000000000000000006000006000000000000000000000a0a0a020202020000000000000101010101010101010004040404040a0a0a0a0a0a0a0a0a00000000040404040404040404040404040404040404040202020202020202020204000101010102020202020202020202020200000000000000000001010101010101010101010202020201010101010101010101010100000004040000010101060000060101010101010101010101010101000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000a0a02020202000000040404000000000000000004040404040404040a0a0a0a0a020202000000040404040404040404040404040404040404040402020202020202020202040001010102020202020202020202010100000000000000000000010101010101010101010102020202010101010101010101010101010101010101010101010106000001010202020201010101010101000000000000000000000000000000000000000000000000000000000001010101010600000600000000000000000000000000000202020200000004040404040404040404040404040404040404040a0a0a0a020202020000040404040404040400000000000000000000040202020202020202020202040101010102020202020202020201010000000000000000000000010101010101010101010102020202020101010101000000010101010101010101010101010106000006010202020201010101010101000000000000000000000000010101010101010101010101010101010101010101060000060000000000000000000000000000000202020200000004040404040404040404040404040404040404040a0a0a0002020202000404040404040000000001010101010101010102020202020202020202020202010101010202020202020101010000000000000000000000000001010101010101010102020202020202010101010000000000010101010101010101010101010100000602020202020101010101010100000000000000000000000606010101010102020202020201010101010101010106000006000000000000000000000000000000020202020000000404040404040404040404040404040404040404020202020202020202040404040000010101010101010101010101010202020202020202020202020201010102020202020202000000000000000000000000000000000101010101010101020202020202020201010101000000000001010101010101010101010101020608060202020202020101010101010000000000000000000606000006010101010101020202020101010101010101010008060100000000000000000000000000000002020202000000040404040404040404040404040404040404040202020202020202020202040400000101010102020101010101010102020202020202020202020202020101010202020505020200000000000000000000000000000000010101010101010202020202020202020202020100000000000101010101010101010101010202060006020202020202010101010101000000000000000006000000060101010101010101020202010101010101010106000006010000000000000000000000000000000202020200000004040404040404040404040404040404040404020202020202020202020202040002020202020202020201010101010202020202020202050505020202010101020505050505020202000000000000000202020202020202020202020202020205050502020202020202020200000000010101010101010101010101020206000602020202020201010101010100000000000606000000000601010101010101010102020101010101010101010600000101000000000000000000000000000000020202020000000404040404040404040404040404040404040402020202020202020202020202020202020202020202020201010102020202020202050505050505020202020202050505050502020202020200000002020202050502020202020202020202020505020202020202020202020202000001010101010101010101010101020600060202020202020101010101010006060600000000000606010101010101010101010202010101010101010101000006010100000000000000000000000000000002020202020000040404040404040404040404040404040404040202020202020202020202020202020202020202020202020101010202020205050505050505050502020202020205050505020202020202020202020202020505050502020202020202020202020202020205050505050202020202000101010101010101010101010101060806020202020201010106060606000008000000080606000001010101010101010101020201010101010101010100000601010000000000000000000000000000000202020202000004040404040404040404040404040404040400000202020202020202020202020202020202020202020202010101020202020505050505050505050502020202050202050202020202020202020202020205050505050502020202020202020202020202020505050505050202020202020202020202010101010101010600000601010202060606000000000000000000000606000000000001010101010101010101010101010101010101010000060101000000000000000000000000000000020202020200000004040404040404040404040404040404000a0a02020202020202020202020505050202020202020202020101010202020202020205050205050505050502020202020202020202020202020202020202050505050505020202020202020202020202020205050505050505020202020202020202020202010101010106000600060606060000000000000006060606000000000006000000000000000101010101010101010101010101010100000601000000000000000000000000000000000202020202000000000000040404040404040404040000000a0a0a020505050202020202020505050505020202020202020202040202020202020202020202020202050502020202020000000000020202020202020202020505050505050202020202020202020202020202050505050505050202020202020202020202020202010106000006060000000000000606060600000000000006060000000006000000000000000001010101010101010101010101060006000000000000000000000000000000000202020202020000000000000000000000000000000000000202020202050505020202020202050505050502020202020202020202020202020202020202020202020205020202000000000000000000000202020202020202050505050502020202020202020202020202050505050505050505050202020202020202020202020202060000000800000006060600000000000000000000000000060600000806060000000000000000000000000000000000000006000800020000000000000002020202020202020202020202000000000000000000000000000000020202020202020202050202020202020202020505020202020202020202020202020202020202020202020202020202000000000000000000000000000202020202020202020505050505050202020202020202050505050505050505050505020202020202020202020202020600000000060606040404040400000000000000000000000000000606000000060002000000000000000000000000000000000600000602020001010101020202020202020202020202020000000000000000000002020002020202020202020202020202020202020202020202020202020202020202020202020202020202020202020202020202020000000008080808080808040000000202020505020205050505050505050202020202050505050505050505050505050505050505050502020202020202060000060602020202020202020402020000000000000000000000000006000000060000000000000000000000000000000000000600000602020101010102020202020202020202020202020000000002020202020202020202020202020202020202020202020202020202020202020202020202020202020202020202020202020202020202020100000008080808080808080808000000000205050502050505050505050502050502050505050505050505050505050505050505050505050505050505020600000602050502020202020202020505020200000000000000000000000006060000060000000000000000000000000000000000060000060001010202020202020202020202020202020200000202020202020202020202020202020202020202020202020202020202020202020202020202020202020202020202020202020202020202020202010000080808080808080808080808000000000205050202020505050202020205050505050505050505050505050505050505050505050505050505050206000006020505050502020202020202050505020202000000000000000000000006060800060600000000000000000000000000000000060000060102020202020202000004040404040404020202020202020202020202020202020202020202020202020202020202020202020202020202020202020202020202020202020202020202020202020100000808080808080808080808080808010101020505050202020202020205050505050505050505050505050505050505050505050505050505050505060000000605050505050505050202020205050505020202020000000000000202020000060000000606040404040000000000000000000000060000060202020202000000000404040202020202020202020202020205050505020202020202020202020202020202020202020202020202020202020202020202020202020202020202050202020202000008080808080808080808080808080808010102050505020202020505050505050505050505050505050505050505050505050505050505050505050600000600060505050505050505000000050505050505020202020202000002020202020200060600000000060604000000000000000000000000060000060205020200000002020202020202020202020202020202050505050505050502020202020202020202020202020202020202020202020202020202020202020202020202020505050202020000000808080808080808080808080808080801010202050505050202050505050505050505050505050505050505050505050505050505050505050506000006060006050505050505050500000005050505050502020202020202020202020202020200000606000000000606060000000000010101010106060000020505020202020202020202020202020202020202020505050505050505050505050505050202020202020202020202020202020202020202020202020202020202020202020202020202000008080808080808080808080808080808080801010205050501010106020505050505050505050505050505050505050505050505050505050505060000020506000605050505050505050000000505050505050505020202020202020205050502020202020006060608000000080606000101010102020206060006020502020202020202020202020202020505050505050505050505050505050505050505050202020202050505050202020202020202020202020202020202020202020202020202020200000808080808080808080808080808080808080801010101010000000006050505050505050505050505050505050505050505050505050505050600000205050600060505050505010101020202050505050505050505020202020202020202020202020202020202000606060000000000060601020202020206060006020202020202020202020205050505050505050505050505050505050505050505050505050202020505050505020202020202020202020202020202020202020202020202020202020a0808080808080808080808080808080808080808010800000000000000000205050505050505050505050505050505050505050505050505050600000205050506000605050505050101010200020505050505050505050502020202020202020202020202020202020202020206060600000000000606020202020206000606020202020202020505050505050505050505050505050505050505050505050505050502020205050505050202020202020202020202020202020202020202020202020202020a0a08080808080808080808080808080808080808080808000000000000000006050505050505050505050505050505050505050505050505050600000205050505060006050505050501010105020505050505050505050505050502020202020202020202020202020202020202020202060606000000000606020202020600000602020202050505050505050505050505050505050505050505050505050505050502020505050505050505020202020202020202020202020202020202020202020202020a0a0a08080808080808080808080808080808080808000000080000000800000006050505050505020505050505050505050505050505050505060000020505050505060006050505050505050506060605050505050505050505050505020202020202020202020202020202020202020202020202020606080000000602050206000006020205050505050505050505050505050505050505050505050505050505050202050505050505050505020202020202020202020202020202020202020202020202020a0a080808080808080808080808080808080808080000000000000000000000000205050505050502020202020202020202020205050505050600000605050505020600000605050505050505050606060505050505050505050505050505020202020202020202020202020505050502020202020202020202060000000606020206000002050505050505050505050505050505050505050505050505050505050505020205050505050505050202020202020202020202020202020202020202020202050502020a0808080808080808080808080808080808080800000000000000000000000102050505050502020202020202020202020202020505050200000605050506060000000605050505050505050506060605050505050505050505050505050502020202020505050505050505050505050202020202020205050502060000000602020600060205050505050505050505050505050505050505050505050505050505020205050505050505050505020202020202020202020202020202020202020205050505020a0008080808080808080808080808080808080808000000000000000001010102050505050505020202020202020202020202020205050506000602020600000006060205050505050505050505050505050505050505050505050505050505050202020505050505050505050505050502020202020505050505050502060000060202060006020505050505050505050505050505050505050505050505050502020202020505050505050505050202020202020202020202020202020202020205050505050200000808080808080808080808080808080800000008000000010101010101010202020505020202020202020202020202020202020505060008020600080006020505050505050505050505050505050505050505050505050505050505050505020505050505050505050505050505050502020505050505050505050502060008060202060006050505050505050505050505050505050505050505050505020202020202020505050505050505050202020202020202020202020202020202020505050502020008080808080808080808080808080808000000000000000001010101010101010202020202020202020202020101010100000202050200000600000006060505050505050505050505050505050505050505050505050505050505050505050505050505050505050505050505050505050205050505050505050505050505060000000602000006050505050505050505050505050505050505050505020202020202020202050505050505050505020202020202020202020202020202020205050505050202000808080808080808080808080808080800000000000000000101010101010100000202020202020202020202010101010000000202060006000006060202050505050505050505050505050505050505050505050505050505050505050505050505050505050505050505050505050505050505050505050505050505050505020600000006000002050505050505050505050505050505050502020505050202020202020202050505050505050502020201020202020202020202020205050505050502020000080808080808080808080808080808080000000000000000000101010101000000000000000202020202020202010101000000000200000000060602020202020202050505050505050505050505050505050505050505050505050505050505050505050505050505050505050505050505050505050505050505050505050505020606000000000605050505050505050505050502020202020202020505020202020202020205050505050505020202010101010202020202020505050505050502020202000008080808080808080808080808080808080000000800000001010101010100000000000000000202020202020201010100000000060000060602020202020202020202020505050505050505050505050505050505050505050505050505050505050505050505050505050505050505050505050505050505050505050505050505050506060000080605050505050202020202020202020202020202050202020202020202020505050505050202020201010101010102020205050505050502020202020200000808080808080808080808080808080808080808000000000101010202010000000000000000020202020202020101010000000006000602000000020202020202020202020202050505050505050505050505050505050505050505050505050505050505050505050505050505050505050505050505050505050505050505050505050505020600000205050505020202020202020202020202020205020202020202020202050505050505020202020101010101010202020505050502020202020202020000080808080808080808080808080808080808080800000000010102020202000000000000000002020202020202010101000000000600060200000000000202020202020202020202020205050505050505050505050505050505050505050505050505050505050505050505050505050505050505050505050505050505050505050505050505050600060505020202020202020202020202020202050502020202020202020205050505050202020202010101010101020205050502020202020202020000000008080808080808080808080808080808080808080000000001010202020200000000000000000202020202020101010100000006000006020000000000000002020202020202020202020202020505050505050505050505050505050505050505050505050505050505050505050505050505050505050505050505050505050505050505050505020000020202020202020202020202020202020205050202020202020202020205050505020202020201010101010102020505020202020202020000000000000808080808080808080808080808080808080808080000000101020202020000000000000000000202020101010101010000000608000600000000000000000a0a02020202020202020202020202050505020505050505050505050505050505050505050505050505050505050505050505050505050505050505050505050505050505050505050506000602020202020202020202020200000002050502020202020202020202020202020202020202020101010202020202020202020202020200000000000008080808080808080808080808080808080808080000000001010101010100000000000000000000000001010101010100000006000600000000000000000a0a0a0a000202020202020202020202020202020202050505050505050505050505050505050505050505050505050505050505050505050505050505050505050505050505050505050502000006020202020202020202020200000002020202020202020202010101000202020202020202020202020202020202020202020202020000000000000008080808080808080808080808080808080808080000000001010101010100000000000000000000000101010101010101000006000600000000000a0a0a0a0a0a0a0a0002020202020202020202020202020202020505050505050505050505050505050505050505050505050505050505050505050505050505050505050505050505050505050505060006020202020202020202020200000002020202020202020101010101040404040202020202020202020202020202020202020202020000000000000008080808080808080808080808080808080808080000000000000101010100000002020200000000010101010101010101000006000600000000000a0a0a0a0a0a0a0a000000020202020202020202020202020202020505050505050505050505050505050505050505050505050505050505050505050505050505050505050505050505050505050506000601020202020202020101010101010205020202020101010101010004040404020202020202020202020202020202020202020202000000000000000008080808080808080808080808080808080808080000000000000000000000000202020000000101010101010101010100000008060000000000000a0a0a0a0a0a0a0a0000000000020202020202020202020202020202050505050505050505050505050505050505050505050505050505050505050505050505050502020205050505050505050206000806020202020202020101010100010205020202010101010101010004040404020202020202020202020202020202020202020200000000000000000000080808080808080808080808080808080808000000000000000000000001010101010101010101010101010101010101000000060000000000000a0a0a0a0a0a0a0a0a00000000000000000001010102020202020202020205050505050505050505050505050505050505050505050505050505050505020202020202020205050505050502020202060006020202020202020101010101010202020201010101010101010000000000020202020202020202020202020202020202020200000000000000000000080808080808080808080808080808080808000000000000000000000001010101010101010101010101010101010101000000060000000000000a0a0a0a0a0a0a0a0a0000000000000000000101010102020202020202020202020202020202050505050505050505050505050205050505050505020202020202020202020205050505020202020206000601020202020202020201060606020202020101010101010101000000000000020202050505020202020202020202020202000000000000000000000000080808080808080808080808080808080800000000000000000000000101010101010101010101010101010202020200000006000000000000000a0a0a0a0a0a0a0a0000000000000404040101010101010202020202020202020202020202020205050505050505050505050205050505050505020202020202020202020202050202020202020206000006010101010202020201060606010201010101010101010101000000000000000202020505050202020202020202020200000000000000000000000000000808080808080808080808080800000008000000020200010101010101010101010101010101010101020202020200000806000000000000000a020202020a0a000000000002020204040101010101010102020202020202020202020202020202020202020200000002050505050505050502020202020202020202020202020202020202020201060006010101010101010101060606010101010101010101010101000000000000000000020205020202020202020202020000000000000000000000000000000808080808080808080808080000000000000002020202020101010101010101010101010101010102020202020202000006000000000000000002020202020000000000020202020204000101010101010101020202020202020202020202020202020006060000000002050505050505050202020202020202020202020202020202020201010106000601010101010101010101010101010101010101010101010100000000000000000000020502020202020202020000000000000000000000000000000000000808080808080808080808000000000000020202020201010101010101010101010101010101010202020202020000000600000000000000000202020202000000000002020202020404040000020202020000000202020202020202020202020000000000000000000002050505050505020202020202020202020202020202020101010101010600000100000001010101010101010101010101010101010101010102020202020200000002020202020202020200000000000000000000000000000000020000000808080808080808080800000001010102020202010101010101010101010101010101000000020202020202000600060000000000000000020202020200000000000004040404040404040402020202020000000000000202000002020202000000000000000000000205050505050502020202020202020202020202020400010101010101060000060404040000000000000000000102020101010101010102020202020202020101010202020202020200000000000000000000000000000000000002000000000808080808080000000800010101010101010101010101010101010101010101010000000002020202020200060806000000000000000002020202020200000000000404040404040204040002020202000000000000000000000000020000000008000000080000000202050505020202020202020202040404040202020401010101010102060006020404040404040400000000000202010101010101020202020202020202010101020202020202000000000000000000000000000000000000000200000000000008000000000001010101010101010101010101010101020101010101010100000000000202020202000006000000000000000000000202020202020202000004040404040402020202000000020000000000000000000000000000000000000000000000000000000202020202020202020202040404040404020202040001010101000206000602020202020404040404040400020202010101010102020202020202020201010102020202000000000000000000000000000000000000000000000000000000000000000001010101010101010101010101010101020202020101010101010000000000020202020000000600000600000000000000020202020202020202000404040404040202020200000000000000000000000000000000000000000000000000000000000000000004020202020202040404040404040202020202000001010102020600060202020202020404040404040402020202010101020202020202020202010101010102000000000000000000000000000000000000000000000000000000000000000000000101010101010101010101010101010202020202010101010101010000000002020202000000000000060000000000000002020202020202020000040404040404020202020200000000000000000000000000000000000000060000000006000000000000000004040404040404040404040402020202020204000101000202060006020202020202040404040404040202020202010102020202020202020201010101000000000000000000000000000000000000000000000008000000000000000000000000010101010101010101010101010102020202020201010101010101000000000202020200000000060000000000000000020202020202020000000004040404040402020202020000000000000a0a0a00000000000000000000000006060600000000000000000000000404040404040202020202020202020200000101020202060000020202020202040404040404040202020202020202020202020202020101010101000000000000000000000000000000000000000a000008080808080000000000000000000101010101020202020202020202020202020202020101010101010100000000020200000000000600000600000000000202020202020000000000040404040404040202020200000000000a0a0a0a020202000000000000000000000000000000000000000000000000000000000202020202020202020202040002020202020200000602020202020204040404040002020202020202020202020202010101010101010000000000000000000000000000000000000008080808080808080800000000000000000002020202020202020202020202020202020202020101010101010101000000000000000000000006000600000000020202020202000000000000040404040404040202020200000000000a0a0a02020202020000000000000101010101010100000000000000000000000000000202020202020202020202020202020202020206000602020202020204040000000000020202020202020202020206000601010101010000000000000000000000000000000000000808080808080808080808000000000000000002020202020202020202020202020202020202020201010101010101010100000000000000000006000006000202020202020202000000000004040404040404040202020200000000000a0a0a0202020202000000000000000001010000000000000000000000000000000000020202020202020202020202020202020202020600060202020202020200000000000002020202020202020202060000060101010100000000000000000000000000000000000000080808080808080808080000000000000000000202020202020202020202020202020202020202020201010101010101010101010101010101010100000602020202020202020200000000000404040404040404020202020400000000000a0a0a020202020000000000000000000000000000000000000000000000000000000a0a0002020202020202020202020202020202060006020202020202020000000000000202020202020202000608000006010101000000000000000000000000000000000000000808080808080808080800000000000000000000000000000000020202020202020202020202020201010101010101010101010101010101010101010600000602020202020202020000000000040404040404040402020202040000000000000a000202020000000000000000000000000000000000000000000000020000000a0a0a0a0a0202020202020202020202000000020600060202020202020202020000000002020202020202000600000606000000000002020202000000000000000001020201010808080808080808080808000000000000000000000000000000000002020202020202020202010101010101010101010101010101010101010101010202060006020202020202020202020000020404040404040402020202020400000000000000000002020000000000000000000000000000000000000000000202020200000a0a0a0a0a0a0202020202020202000000000002060006020202020202020202020202020202020200000606000006060000000002020202020200000000000000020202010101080808080808080808080800000000000000000000000000000000000202020202010101010101010101010101010101010101010101010101010101020206000006020202020202020202020202020202020404020202020202020000000000000000000000000000000101010000000000000000000000000000020202020a0a0a0a0a0a0a0a02020202020202000000000000000600060202020202020202020202020202020200060600000006000000000000020202020200000000000000020202020101080808080808080808080808080000000000000000000000000000000002020202020101010101010101010101010101010106060601010101010101010202020600060202020202020202020202020202020202020202020202020202000000000000000000000002020201010100000000000000000000000000000002020200000a0a0a0a0a0a02020202020000000000000000000600060202020202020202020202020202020606000008060600000000020202000000000000000000000002020202020101080808080808080808080808000000000000000000000000000000000002020202010101010101010101010101010101010106000006060101010202020202020600000602020202020202020202020202020202020202020202020202020000000000000000000002020201010101000000000000000000000000000000020200000a0a0a0a0a0a02020202000000000000000000000000060202020202020202020202020206060000000606000202020202020202000000000000000000000202020202010108080808080808080808080808000000000000000000000000000000000000000101010101010101010101010101010101010106000000000606020202020202020106000602020202020202020202020202020202020202020202020202020200000000000000000002020201010101000000000000000000000000000000000000000000000a0a0a0002020000000000000000000006000006020202020202020202020202060000000606040000020202020202020200000000000000000000020202020201010808080808080808080808080800000000000000000000000000000000000000010101010101010101010101010101010101010101060600000006060202020202020600000602020202020202020202020202020202020202020202020202020000000000000000000002020101010101010000000000000000000000000000000000000000000000000000000000000000000000000600060002020202020202020202060000000606040404040002020202020202020000000000000000000002020202020101080808080808080808080808080800000008000000000000000000000000000001010101010101010101010101010101010101010101010606080000060202020202020600060202000000020202020202020202020202020202020202020202000000000000000000010101010101010101010101000000000000000000000000000000000000000000000000000000000000000000060006000000020202020202060600080606000404040404000002020202020202000000000000000000000202020201010108080808080808080808080808080808080000010200000000000000000000000101010101010101010101010101010101010101010101010206060000060202020202060000060000000000020202020202020202020202020202020202020200000000000101010101010101010101010101010101010101010101000000000000000000000000000000000000000000000000000000000601010102020202020600000006000204040404040400000000020202020200000000000000000000020202020101080808080808080808080808080808080808000001020100000000000000000001010101010101010101010101010101010101010202020202020202060000060202020202060006000000000002020202020202020202020202020202020202020001010101010101010101010101010101010101010101010101010101010101010000000000000000000000000000000000000000060000060101010202020202060006060100000404040404040000000000020202020000000000000000000002020201010108080808080808080808080808080808080800010101010100000000000000000101010101010101010101010101010101010102020202020202020202060000060202020206000006000000000202020202020202020202020202020202020202010101010101010101010101010101010101010101010101010101010101010101010000000000000000020202000000000000000006000601010101020202020600000601000004040404040400000000000000020202000000000000000000020200010101010808080808080808080808080808080000000801010101010000000000000000010101010101010101010101010101010101020202020202020202020202060000060202010106000600000000020202020202020202020202020202020202020201010101010101010101010101010101010101010101010101010101010101010101010000000000000202020200000000000000060800060101010202020201000806010101010101040404000000000000000000020200000000000000000200000001010101080808080808080808080808080800000000000101010101000000000000000001010101010101010101010101010101010102020202020202020202020202060006020201010600000600000001010101010202020202020202020202020202020101010101010101010101010101010101010101010101010101010101010101010101000000000000020202020000000000000006000006010102020202020600000601010101010101040000000000000000000000000000000000000000000000000101010108080808080808080808080808080000000000010101010100000000000000000101010101010101010101010101010101010102020202020202020202020206000602020101010600060000000101010101020202020202020202020202020202010101020202020101010101010101010101010101010101010101010101010101010100000000000002020202000000000000000000060101020202020202060006010101010101010101000000000000000000000000000000000000000000000000010101010108080808080808080808080808000000000101010101010100000000000001010101010101010101010101010101010101010202020202020202020202020600060601010101060000060400010101010102020202020202020202020202020001010102020202020101010101010202020101010101010101010101010101010101010000000000000002020000000000000006000006010202020202020600000601010000000101010101000000000000000000000000000000000000000000000001010101010808080808080808080808080808000000010101010101010002000000010101010101010101010101010101010101010101010000000202020202020202060000080006060101060006000001010101010202020202020202020202020204040101010202020202010101010101020202020101010101010101010101010101010100000000000000000000000000000000000600060001020202020106000000080000000800000101010100000000000000000000000000000000000000000000000001010101010808080808080808080808080000000101010101010101010202010101010101010101010101010101010101010101010101000000020202020202020202060600000000060606000006010101010102020202020202020202020202040404000101020202020201010101010202020202010101010101010101010101010101010000000000000000000000000000000006000006000202020206060000000000000000000000000101000000000000000000000000000000000000010101010100000000000101080808080808080808080808000001010102010101010101020201010101010101010101010101010101010101010101010100000001010101010102020202020606060000000600000601010101020202020202020404020202020204040404000202020202020202010101020202020200000000000000000000000000000000000000000000000000000000000000000600060002020200060000000000000000000000000000010100000000000000000000000000000000000101010101010100000000000001080808080808080808080800000101020201010101010101020101010101010101010101010101010101010101010101010101010102020101010101020202020201060600000600000101010202020202020204040404040202020404040402020202020202020202010102020202020000000000000000000000000000000000000000000000000000000000000006000006020200060000000006010000000000000000000001000000000000000000000000000000000000010101010101010000000000000008080808080808080808080000000101010101010101010101010101010101010101010101010101010101010101010101010001020202010101010101020202020202010600000800060202020202020202040404040404040202040404040202020202020202020202020202020202000000000000000000000000000000000000000000000000000202020202020600060000060000080006020201000008000000080000010100000000000000000000000000000000000101010101010101000000000000000008080808080808080800000000000001010101010101010101010101010101010101010101010101010101010101010101010101020101010101010101010101020202010600060006020202020202020404040404040404020204040404020202020202020202020202020202020202000000000000000202020000000000000000000202020202020202020206000006060600000006020202020206000000000000000001010000000000000000000000000000000000010101010101010100000000000000000000080808080808000000000000000001010101010101010101010101010101010101010101010101000101010101010606060101010101010101010101010101010101060000000006020202020202040404040404040202020404040404020202020202020202020202020202020200000a0a0a000202020202000000000000000202020202020202020202060006060000000606020202020202010600000000000101010000000000000000000000000000000000000101010101020202020000000000000000000000080800000000000200000000000101010101010101010101010101010101010202010101000000010101010106060601010101010101010101010101010101010106000600060202020202040404040404040404020404040404040202020202020202020202020202020202020202020202020202020202000000000002020202020202020202020600000000000606020202020202020101010606060601010101000000000000000000000000000000000000010101020202020202020000000000000000000000000000000202020000000000010101010101010101010101010101010101020202020200000001010101010606060101010101010101010101010101010101020608000000060202020204040404040404040404040404040404020202020202020202020202020202020202020202020202020202020200000000000002020202020202020202060008000606020202020202020200010101010101010101010100000000000000000000000000000000000202020202020202020202000000000000000000000000020202020202000000000000010101010101010101010101010101010102020202020202010101010101010101010101010101010101010101010101010202020600000006020202040404040404040404040404040404040402020202020202020202020202020202020202020202020202020202020202020200000202020202020202020600000006020202020000020202020000010101010101010100000000000000000000000000000000000002020202020202020202020000000000000000000000020202020202020200000000000000000101010101010101010101010101010202020202020201010101010102020202020202020101010101010101010101020202010600000006020204040404040404040404040404040404040202020202020202020202020202020202020202020202020202020202020202020202020202020202020202060000060202020200000000020200000000000001010000000000000000000000000000000000000000000202020202020202020200000000000002020202020202020202020202020000000000000000000000000101010101010101010101010202020202020201010101010202020202020202010101010101010101010101010101010606000602020404040404040404040000000000000000020202020202020202020202020202020202020202020202020202020202020202020202020202020202020600000602020202000000000002000000000000000000000000000000000000000000000000000000000000020202020202000000000000000000020202020202020202020202020202020000000000000000000000000000000000000404000000020202020202020101010101020202020202020201010101010101010101010101010101000608000604040404040404040001010101010101010102020202020202020202020202020202020202020202020202020202020202020202020202020202020202060006020202020000000000000200000000000000000000000000000000000000000000000000000000000000000000000000000000000000000002020202020202020202020202020202000000000000000000000000000000000000040404040400020202020202010101010102020202020202020101010101010101010101010101010100040600060404040404040404000101010101010101010202020202020202020202020202020202020202020202020202020202020202020202020202020202020600000602020202000000000101020201000000000000000000000000000000000000000000000000000000000000000000000000000000000000000202020202020202020202020202020200000000000000000000000000000202020004040404040404000102020201010101010202020202020202010101010101010101020101010101010404060000060404040404040001010101010101010101020202020202020202020202020202020202020202020202020202020202020202020202020202020202060006020202020000000001010202020101000000000000000000000000000000000000000000000000000000000000000000000000000000000000020202020202020202020202020202020202020202000000000000000002020202020404040404040400000102010101010101010202020202020101010101010101010202010101010100040404000006040404040404000101010101010101010102020202020100020202020202020202020202020202020202020202020202020202020202020202020600000602020000000000000101020202010100000000000002020200000000000000000000000000000000000000000000000000000000000000000002020202020202020202020202020202020202020202000000000000000202020202040404040404040400010101010101010101010101010202010101010101010102020201010101010004040406000006040404000000010101010101010101010102020202010000000000020202020202020202020202020202020202020202020202020202020202060006000200000000000000010102020201010000000a0a0a02020202000000000000000000000000000000000000000000000000000000000000000002020202020202020101020202020202020202020202000000000000000202020202040404040404040400000001010101010101010101010101010101010101010102020101010101010004040404000006000000000000010101010101010101010102020201010000000000000202010202020202020202020202020202020202020202020202020206000006000000000000000000010102020201010000000a0a020202020202000000000000000000000000000000000000000000000000000000000000020202020202020201010100020202020202020202020200000000000000000000000004040404040404040404040000010101010101010101010101010101010101010101010101010101010004040406000000000000000001010101010101010101010202010100000000000000000002020202020202020202020202020202020202020202020202020600000000000000000000000001010202020201000000000a0a02020202020200000000000000000000000000000000000000000000000000000000000202020202020200000100000000000000000202020200000000000000000000000000040404040404040404040404000000010101010101010101010101010101010101010101010101010100040404060000060000000001010101010101010101010101020000000000000000000003000007020202020202020202020202020202020202020202020200000602000000000000000000010102020202000000000000000202020202020200000000000000000000000000000000000000000000000000000000020202020202000000000000000000000000000000000000000000000000000000000000000000020202020404040400000001010102020202020201010101010101010101010101010101010100000406000806000000010101010101010101010000000000000000000000000000000000000002000202020202020202020201010202020202020202060000020200000000000000000000010202020202000000000000000202020202020001010100000000000000000000000000000000000000000000000000020000000000000000000000000000000101010100000000000000000000000000000101010102020202040404000000020202020202020202020201010101010101010101010101010101010101010100000600010101010101010101010100000000000000000000000000000000000000000202020202020202020202020101010000000002020206000602020200000000000000000001020202020202020202000000000202020202010101010101000000000000000000000000000000000000000000000000000000000000000000000000000001010101010100000000000000000000000000010101010202020204040400000002020202020202020202020101010101010101010101010101010101010101010000060101010101010101010101000000000000000000000000000000000000000000000000000002020202020202020101000000020202020000060202020000000000000000000000020202020202020202000000000002020202010101010101000000000000000000000000000000000000000000000000000000000000000000000000010101010101010000000000000a0a00000000010101010102020202040404000000020202020202020202020201010100000000010101010101010101010101010100000601010101010101010101010000000000000000000000000000000000000000000000010101010102020202020201010000000202020600060202020200000000000000000000000202020202020202020200000000010102010101010101010000000000000000000000000000000000000000000000000000000000000000000000000101010101010101000000000a0a0a00000000010101010101010004040400000000020202020202020201010101010100040400000101010101010101010101010100080601010101010101010101010000000000000000000000000002000000000000000001010101010102020202020201000000000202020608060202020200000000000000000000000202020202020202020200000101010101010101010101010202020200000000000000000000000000000000000000000000000000000000000000000101010101010101000000000a0a0a00020200010101010101010404040400000000000002020202020101010101010100020202020202020202020201010101010100000601010101010101010101010000000000000000000000000000000000000000000001010101010102020202020200000000000202060000060202020200000000000000000000000002020202020202020202000101010101010101010101010202020202000000000000000000000200000000000000000000000000000000000000000101010101010101000000000a0202020202020201010101010104040404000000000000010202020201010101010101020202020202020202020202010101010106000006010101010101010101010100000006060000000000000000000000000000000000010101010101020202020202000000000000020600060202020202000000000000000000000000000000000202020202020000000101010101010101010102020202020000000000000000000202000000000000000000000000000000000000000101010101010101010000000002020202020202020101010101000404040400000000000001020202020201010101010100020202020202020202020202010101010600000101010101010101010101000000060000060002020200000000000000000202020000010101010101020202020100000404040400060006020202020200000000000000000000000000000000000202020202020000010101010101010101010202020202000000000000000002020200000000000000000000000000000002020000010101010101010101000000000202020202020202000000000404040404040000000000020202020202010101010101010100000101010202020202020201010106000006010101010101000000000000000600080600000002020200000000000000020202020202000000010101020202010100040404040600000600020202020200000000000000000101010100000000000202020202000101010101010101010101020202020202000000000000000202020000000000000000000000000000000202020001010101010101010100000000020202020202020200040404040404040404000000000202020202020101010101010101010101010101010202020202020101010600000600000000000000000000000006000006000000000000000000000000000000000202020200000000010101010101010004040404060000000002020202020000000000000101010101010100000000000202020202010101010000000000000102020202020200000000000002020202000000010101010101000000020202020200010101010101010101010000000000020202020202000004040404040202040400000000020202020202000000000101010101010101010101010202020202010106000006000000000000000000000000060000060000000000000000000000000000000000000000000000000000010101010101000404040400000600000202020202000000010101010101010101010000000000020202020200000000000000000000000602020202020000000000020202020200010101010101010101010202020202020001010101010101010101000000000002020202020200000404040402020202040000000002020202020000000000000101010101010101010101020202020202060000000000000000000000000000060000000600000001010101000000000000000000000000000000000000000001010101010100040404060000060400020202020101010101010101010101010101000000000000020202020200000000000000000000010202020202000000000002020202020101010101010101010102020202020200000101010101010101010100000000000202020202020000040404040202020204000000000002020200000000000000000101010101010101010102020202020606080006000000000000000000000600000806000001010101010101010000000000000000000000000000000000000101010101010004040408000604040a00020200010101010101010101010101010101000000000002020202020008000000080000000801020202020200000000000202020202010101010101010101010202020202020001010101010101010101010000000000020202020202000000040404020202040400000000000000000000000000000000010101010101010101010102020206060000060000000000000000000600000000060000000101010101010101010100000000000000000000000000000000010101010101000404060000060404000000000001010101010101010101010101010100000000000002020202000000000000000000000102020202020000000002020202020201010101010101010102020202020200000101010101010101010101000000000202020202020200000004040402020204040000000000000000000000000000000001010101010101010101010202060600000600000000000000000606000000060600000000010101010101010101010100000000000000000000000000000001010101010100040406000604040404000000000101010101010101010101010101010000000000000202020202000000000000000000010202020202020202020202020202020101010101010101010202020202020001010101010101010101010100000000020202020202020202000404020404040404000000000000000000000000000000000101010101010101010101010606000006000000000000000006000000000600000000000001010101010101010101010101010000000000000000000004000101010101010004060000060404040400000000010101010101010101010101010101000000000000020202020202000000000600000000010202020202020202020202020202010101010101010102020202020202010101010101010101010101010000000002020202020202020202020202040404040400010101000000000000000000000000010101010101010101010106060800060000000000000006000800000600000000000000000101010101010101010101010101010000000000000004040400010101010101000406000804040404040000000000010101010101010101010101010000000000000002020202020202000000000000000001000002020202020202020202020201010101010101010102020202020101010101010101010101010100000000020202020202020202020202020204040404000101010101000000000000000000000001010101010101010101060000000602000000000000060000000606000000000000000000000000010101010101010101010102020200000000040404040400010101010100040000060404040404000000000000000000000101010101010101000000000000000002020202020000000000000000000000000202020202020202020202010101010101010101010101010101010101010101010101000000000000000002020202020202020202020202020404040401010101010101000000000000000000000101010101010101000600000006020200000000000600000006000000000000000000000000060604000001010101010101010202020202040404040404040001010101010006000006040404040400000000000000000000000000000101000000000000000000000202020200000000000000000000000000000202020202020202020201010101010101010101010101010101010101010100000000000000000000000202020202020202020202020204040404000101010101010101000000000000000000000000000000000006000000060002020000000006000006000000000000000000000000000000000006060001010101010101020202020202020404040404000101010101010600000404040404040000000000000000000000000000000000000000000000000000020202020000000000000000000000000000020202020202000000000101010101010101010101010101010101010101000000000000000000000000000100000000000000000004040404040202010101010101010101010000000000000000000000000000060008000600020002000000060008060000000000000000000000000000000600000800060601010101010102020202020202040404040400010101010101000006040404040404000a0a0a0a0000000000000000000000000000000000000000000202020200000000000000000000000000000002020202000000000000010101010101010101010101010101010101010000000000000000000000000101010100000000000000000404040202020202020101010101010101010102010100000000000000060000060000020202000200060000060000000000000000000000000000000000060600000000060601010101020202020202020404040404000101010101010000060404040404040a0a0a0a0a0000000000000000000000000000000000000000000202020200000000000000000000000000000002020200000000000000010101010101010101010101010101010101010000000000000a00000000010101010100000000000000000004040202020202010101010101010101010202020200000000000006000006000002020202020000060000000000000000000000000000000000000000000000060000000006010101010102020202020404040404000101010101060000060404040404040a0a0a0a0a0a000000000000000000000000000000000000000002020202000000000000000000000000000000000202000000000000000101010101010101010101010101010101010100000000000a0a000000000101010101000000000a0000000000020202020201010101010101010101010202020202020000000600000600000002020202020000000006000000000000000000000000000000000000000000000006000000060101010104040402020404040404000101010101060000040404040404040a0a0a0a0a0a00000000000000000000000000000000000000000002020000000000000000000000000000000000020200000000000000010101010101010101010101010101010101010000000000000a00000000000101010100000000000000000000000202010101010101010101010101010202020202020200060008060000000002020202020a06000006000000000000000000000000000000000000000000000000060000000601010104040404040404040404000101010101060000040404040404000a0a0a0a0a0a0000000000000000000202020200000000000000000000000000040404000000040404000000000002020000000000000001010101020202020202010101010101010100000000000000000000000000010101000000000000000000000000000001010101010101010101010101020202020202020600000600000000000002020202000600000000000000000000000000000000000000000000000000000001060000000601000404040404040404040400010101010106000004040404040400000a0a0a0a0a00000000000000000202020202000000000101000000000404040404040000000404040404040400020200000000000000010202020202020202020202010101010101000000000000000000000000000000000000000000000000000a0a0000000101010101010101010100000000000000000006000006000000000000000202020200000006000000000000000000000000000000000000020202020200000001010600000006040404040404040404040101010101010600000604040404000000000000000000000000000000000202020202000000010101010000040404040404040000000402040404040404020000000000000001020202020202020202020202010101080808000000000000000000000000000000000000000000000000000a0a0000000101010101010101010000000000000000000006000006000000000000000202020206000006020202000404040404040000000000000002020202020200000000010106000000000606040404040404040101010101020200000602020202000000000000000000000000000000000202020200000001010101010100000404040101010404040202020202020202040404000000000102020202020202020202020201010100080808080800000000000000000000000002020202000000000000000a0a0000000101010101010101010000000000000000000608000600000000000000000202020600080600020202020404040404040404000000020000000202020200000000000000060600080000000606040202000101010101020206000602020202020000000000000000000000000000020202020000000101010101010101000404040101010404040202020202020202040404000001010102020202020202020202020101000408080808080808000000000000000000000202020202000000000000000a0a0000000101010101010101000000000000000000000000060101010000000000000002060000060001020202020004040404040404040002020000000202020000000000000000040406060000000000060606020201010101020206000006020202020000000000000000000000000000000202000000010101010101020201010004040101010404040202020202040404000001010101010101020202020202020202010100040808080808080808080000000000000000020202020200000000000000000a0a00000001010101010101010000000000000000000600000601010101000000000006060000060101010202020202000404040404040402020200000002020000000000000000000404040404060600000000000006060101010102010600060202020000000000000000000000000000000000000000000101010101020202010100000404040404040404020202000000010101010101010101010102020202020202020100040808080808080808080808000000000000000002020a0a00000000000000000202000000010101010101010100000000000000000006000601010101010100000006000000060202020202020202020004040404040402010101010002020000000000000000000004040404040404040606060000000000060601010106000006020000000000000001010101010100000004040404000101010101020202020101010004040404040404000001010101010101010101010101010101010202020202020101000808080808080808080808080800000000000000000a0a00000202020202020202020200000101010101010101020000000000000000000006010101010101000600000006060202020202020202020200040404040404020101010000000000000000000000000000040404040404040404040206060600080000000601010608060600000000000000010101010101010000000404040001010101010202020201010100040404040404040001010101010101010101010101010101010101020202020201010408080808080808080808080808000000000000000000000002020202020202020202020000010101010101010202020000000000000600000601010101010606000000060002020202020202020101010004040404040402010101000000000000000000000000000004040404040404040404040402020606060000000006060000060000000000000001010101010101000004040404000001010101020202020101010000040404040400000101010101010101010101010101010101010102020202010101080808080808080808080808080808000000000000000000000202020202020202020200000001010101010101020200000000000000060000060101010106000000060600020202020202020202010101000404040404040404000006060600000000000000000000000404040404040404040404040001010201060600000006060000060000000000000101010101010000040404040404000101010102020201010101010004040404000000000001010101010101010101010101010101010202020201010108080808080808080808080808080800000000000000000002020202020202020202000000000101010101010101020000000000000006000006010106060000000601000002020202020202020201010004040404040404040400000606060000000000000000000000040404040404040404040404040001010101010600000006060000060000000000010101010101000004040404040400010101010101010101010101000000000000000000000000000101010101010101010101010101010202020101080808080808080808080808080808080100000000000000000202020202020000000000000001010101010101010100000000000000000600000601060008000601010101010202020202020202020000040404040402020404040000060606000000000000000001010100040404040404040404040404000000010101000006000806060008060000000001010101010100020204040404040400010101010101010101010101010000000000040404040404040001010101010101010101010101010201010108080808080808080808080808080808080100000000000000020200000000000101010101010101010101010101000000000000000001060000060600000006020101010101020202020202020202020404040404020202020404000000000000000000010101010101010101040404040404040404040400000000000202000006000000000000060000000101010101020202020404040404040001010101010101010201010101010101000004040404040404040001010101010101010101010101010101010808080808080808080808080808080808080100000000000000000000000101010101010101010101010101010100000000000000010101000006000006060101010101010102020202020202020202040404040402020202040400000000000000000101010101010101010100040404040404040404040000000000020200000006000000000000060000010101010202020202000004040404040101010101010102020201010101010100000404040404040404040001010101010101010101010101010108080808080808080808080808080808080808010100020200000000000001010101010101010101010100000000000001010101010101010106000000060101010101010101010202020202020202020204040404040202020204040000000000000001010101010101010101010104040404040404040404000000000002020000000006060000000000060001010101020202020200000004040404010101010101020202020101010101010100040404040404040404040101010101010101010101010101010808080808080808080808080808080808080801010202020000000000010101010101010101010101000000000000000101010101010101010600080601010101010102020202020202020202020202020404040404020202020404000000000000000101010101010101010101010404040404040404040400000000000202000000000000060800000008060101010102020202020000000404040401010101010202020202010101010101010004040404040404040404000101010101010101020202010101080808080808080808080808080808080808080101020202000000000001010101010101010101010101010101010101010101010101010202060000060201010101010202020202020202020202020202020202020202040404040000000000000000010101010101010101010101040404040404040404000000000000020202000000000000000606000000060101010202020200000000040404040101010102020202020201010101010101000404040402020202020401010101010101020202020201010808080808080808080808080808080808080808010102020200000000000101010101010202020202020101010101010101010101010101020201060006020101010101020202020202020202000000000202020202020200000000000002020202000000010101010101010101010100000000000000000000000000040202020204040404000000000006000006060101020202020000000000040404010101020202020202020101010101010100040402020202020202020201010101010202020202020101080808080808080808080808080808080808080801010202000000000000020202020202020202020202020101010101010101010101010102020206000602010101010102020202020202020200000000020202020202020000000000040402020404040000010101010101010101010000000000000000000000040404020202020404040404000000000006000006010202020202000000000004040402020202020202020202010101010101010100020202020202020202020201010102020202020202010108080808080808080808080808080808080808080801000000000000000202020202020202020202020201010800000008000101010101020202020608000601010101010202020202020202020000000000020202020202000000000004040404040404040400000101010101010100000000000000000000000004040402020202040404040404000000000006000006000202020200000000000404020202020202020202020201010101010101010102020202020202020202020101010202020202020201010808080808080808080808080808080808080808080101000000000002020202020202020202020202010000000000000000000602020202020202010600060101010101010202020202020202000000000002020202020000000000000404040404040404040404040400000000000000000000000000000000000404040202020204040404040400000000000006000006020202020000000000040402020202020202020202020101010101010101020202020202020202020202020001020202020202020108080808080808080808080808080808080808080808010100000000000202020202020202020202020101000000000000000000010102020202020202060006000001010101020202020101010100000000000000000000000000000000040404040404040404040404040404040000000000000000000000000000040404040202000000010101010101000000000006000006000000000000000004040202020202020202020202010101010101010102020202020101010101000002020202000001020201010808080808080808080808080808080808080808080801010100000001020202020202020202020202010000000000000000000000010202020202020206000006040400010102020201010101010102020000000000000000000000000004040404040404040404040404040404000000000001010101010101010100000000020201010101010101010101000000020206000006000000000000000404020202020202020202020200010101010101020202020202010101010100000202020200000000000101080808080808080808080808080808080808080808080101010101010101010101010101010101010101010000080000000800000102020202000202020600000604040400010102020101010101010202010101000000000000000000000404040404040404040404040404040400000000000101010101010101010101010101010101010101010101010100000202020606000600000000020202020202040202020202020202020400010101010102020202020101010101010000020202020000000000000008080808080808080808080808080808080808080808080101010101010101010101010101010101010101000000000000000001010202010100040402020600060404040001010201010101010101020202010100000000000000000000040404040404040404040404040404040000000000010101010101010101010101010101010101010101010101010000020202020600000600000002020202020204040202020202020202020001010101010202020202010101010101000002020202000000000000000808080808080808080808080808080808080808080808010101010101010101010101010101010101010101000000000001010101010101010004040404060006040404000101010101010101010102020201010000000000000000000004040404040404040404040404040404000000000001010101010101010101010101010101010101010101010101000002020202020600000000000002020202040404040202020202020202000001010101010102020101010101010100000002020000000000000000080808080808080808080808080808080808080808080801010101010101010101010101010101010101010101010101010101010101010101000404040406000004040400010101010101010101010202020101000000000000000000000404040404040404040404040404040400000000000101010101010101010101010101010101010101010101010100000202020202060000060000000000040404040404040402020202020400000101010101010101010101010101010000000000000000000000000008080808080808080808080808080808080808080808080001010101010101010101010101010101010101010101010101010101010101010100040404040600000402020401010101010101010101020202010100000000000000000000040404040404040404040404040404000000000000010101010101010101010101010101010101010101010101010000020202020202060806000000000000040404040404040404020202040400000101010101010101010101010101000000000000000000000000000808080808080808080808080808080808080808080808010100000001010101010202010101010101010101010101010101010101010101010000040404060000060202040000010101010000000002020200000000000000000000000004040404040404040404040404040400000000000001010101010101010101000000000101010101010101010101000000020202020206000006020000000004040404040404040404020404040404000101010101010101010101010100000000000000000000000000080808080808080808080808080808080808080808080101000000000001010101020202010101010101000404010104040000010101010101010000000004000006020204040404040400000000000202020000000000000000000000000404040404040404040404040404000000000000000101010101010101000004040404040000010101010101010000000002020202020206000602000000000404040404040404040404040404040404000101010101010101010101010100000000000000000000000008080808080808080808040408080808080808080808010102000000000101010102020201010101010004040404040404000001010101010101010000000000000602040404040404040400000000020202000000000000000000000000040404040404040404040404040000000000000000010101010101010000000404040404040400000001010100000000000000000000000600000000000000000404040400000000000402040404040404000101010101010101010101010000000000000000000000000808080808080808080404040408080808080808080801010202000000000101010202020201010100040404040000000000000101010101010101010100000600060404040404040404040000000002020200000000000000000002020404040404040404040404040404000000000000000000010101010100000000000404040404040404040404040000000000000000000000060000060000000000000400010101010101000204040404040404010101010202020202020201000000000000000000000000080808080808080808020202020808080808080808080101020200000000010101010202020101010000000000000000000000000101010101010101010101060006040404040404040404040400000202020000000000000000020202020404040404040404040404040000020200000000000001010101010000000000040404040202020202020404000000000000000000000000000006000000000000000001010101010102020204040404040400010102020202020202020100000000000000000000000000080808080808080802020202080808080808080808010102020200000000010101020202010100000000000a0a0a0000000000010101010101010101010106000000040404040404040404040404020202000000000000000002020202040404040404040404040000000202020200000000000001020100000000000004040404020202020202040400000000000000000000000006000000000000000000010101010101010104040404040404040001010101010101010101010000000000000000000000000808080808080808080a0202000808080808080808080100020202000000000101010102020101000000000a0a0a0a000000000001010101010101010101010600000604040404040404040404040402020204040404040404040202020404040404040404040400000000020202020000000000000101010000000000000004040404020202020202040000000000000000000000000600000600000000000202020202020201010000000000000004040101010101010101010101000000000000000000000000080808080808080808080a00080808080808080808080100020202020000000001010102020101000000000a0a0a0a000000000001010101010101010101010600080600040404040404040404040402020204040404040404040404040404040400000000000000000000000200000000000000000101000000000000000004040404020202020202020202020000000000000000000000000600000000020202020202020202010000000000000000000101010101010101010101000000000000000000000000080808080808080808080808080808080808080808080000020202020000000001010102020200000000000a0a0a0a00000000010101010101010101010101010000060004040404040404040404020202020404040404040404040404040404000000000000000000000000000000000000000000010101000000000000000404040402020202020202020202020000000000000000000808060000000002020202020202020200000000000000000000010101010101010101010100000000000000000000000008080808080808080808080808080808080808080800000002020202020000000000000202020000000000000a0a0000000000010101010101010101010101010600060004040404040404040404020202020404040404040404040404040400000000000000000000000a000000000000000000000101010000000000000000040404020202020202020202020200000000000000000006080600000000020202020202020202020000000000000000000101010101010101010101000000000000000000000000000808080808080808080808080808080808080808000002020202020202000000020202020202000000000000000000000000010101010101010101010101010600000004040404040404040404020202020204040404040404040404040400000000000000000000000a0a0a000000000000000001010100000000000000000404040404020202020202020202020000000000000000060806000000000002020202020202020202000000000000000001010101010101010101010000000000000000000000000008080808080808080808080808080808080808080000020202020202020202020202020202020000000000000000000000010101010101010101010101010106080006040404040404040404040202020202040404040404040404040404000000000000000000000a0a0a0a000000000000000101010101000000000000000404040404040202020202020202020202020202000000060808000000000000000000000202020202020202020202020001010101010101010101010002020200000000000000000000080808080808080808080808080808080808080000020202020202020202020202020202020000000000000000000000010101010101010101010101010101000006040404040404040404040202020202020404040404040404040404000000000000000000000a0a0a0a0a0000000000000101010101010000000000000404040404040402020202020202020202020202020202060808000000000000000000000202020202020202020202020001010101010101010101010000020200000000000000000000080808080808080808080808080808080808000000020202020202020202020202020202020200000000000000000001010101010101010101010101010101060000000404040404040404040202020202020404040404040404040404000000000000000000000a0a0a0a0a00000101000001010101010100000000000004040404040404020202020202020202020202020202020608080000000000000000000a0a0202020202020202020200000101010101010101010101000000000000000000000000000008080808080808080808080808080808080800000002020202020202020202020202020202020000000000000000000101010101020202010101010101010106000006000000040404040404040202020202040404040404040404040400000000000a0a0a000000000000000600010100000101010101010100000000000404040404040404020202020202020202020202020202060808000202020000000000000a0a020202020202020200000001010101010101010101010000000000000000000000000000080808080808080808080808080808080808080000020202020202020000000a0a0202020202020000000000000001010101010202020201010101010101010100000600000000000004040404020202020202040404040404040404000000000000000800000008000000080000010100000101010101010101000002020004040404040404020202020202020202020202020202060806020202020202000000000000000000020202020200000001010101010101010101010000000000000000000000000000080808080808080808080808080808080808080000000202020202000000000a0a0202020202020200000000000001010101010202020201010101010101010106080806000000000000040404040404040202020202020404040400000000000000000000000000000000000806010101000101010101010100000202020004040404040404020202020202020202020202020202060806020202020202000000000000000000000202020200000001010101010101010101010000000000000000000a0a0a0000080808080808080808080808080808080808000000000202020202000000000a0a0a02020202020202020000000001010101010102020101010101010101010106080806000000000000000004040404040202020202020204040400000000000000000000000000000000000806010101000001010101010100000202020004040404040404020202020202020202020202020202060806020202020202000000000000000000000202020200000001010101010101010101010000000000000000000a0a0a0a00080808080808080808080808080808080808000000000202020202000000000a0a0a0202020202020202020000000101010101010101010101010101010101010106080800000000000000000004040404020202020202020204000000000000000000000000000000000000080102010000000000000000000000020202000404040404040402020202020202020202020202020206080602020202020200000000000000000000020202020000000101010101010101010101010000000000000000000a0a0a0000080808080808080808080808080808080a0a00000002020202020000000a0a0a0a0202020202020202020200010202020101010101010101010101010101010106080806000000000000000000000000020202020202020202020200000000000000000000000800000008010202020000000000000000000000020202000404040404040404000000000202020202020202020008080602020202020202000000000000000000020202020202000001010101010101010101010101010000000000000a0a0a0000080808080808080808080808080808080a0a0a000004020202000000000a0a0a0a000000020202020202020101020202020101010101010101010101010101010106080806000000000000010101010202020202020202020000020202000000000000000000000601010102020202000000000000000000000002020200000404040404040000000000000000020202020202060808060202020202020200000000000000000202020202020202000000010101010101010101010101010000000000000a0a00000008080808080808080808080808080a0a0a0a0a0004020200000000000000000000000000000202020202020202020201010101010101010101010101000000000608080600000000010101010202020202020202020200000000000000000000000000010101020202020202020200000000000000000000000000000000000404040000000000000000000000000002020206080602020202020202020000000000000000020202020202020200000000000000000101010101010101010000000000000000000008080808080808080808080808080a0a0a0a0a00040000000000000000000000000000000002020202020202020101000004040404000000000000000000000000060808060101010101010202020202020202020201010100000000000000000000010101020202020202020202020000000000000000000000000100000000000000000000000000000000000000000000060806020202020202020202000000000002020202020202020202000000000000000000010101010101010101000000000000000000000808080808080808080808080a0a0a0a0a0a00000000000000000000000000000000000002020202020202020100040404040404040400000000000000000000060808060101010101020202020202020202020201010101000000000000000000010101020202020202020202000000000000000000000000010101000000000000000000000000000000000404040406080806020202020202020202020202020202020202020202020202000000000000000000010101010101010101000000000000000000000808080808080808080a0a0a0a0a0a0a0a0a0a0000000000000000000000000000000000020202020202020201000404040404040404000000000000000000000106080801010101010202020202020202020202010101010100000000000000000000000202020202020202000000000000000000000000000101010000000000000000000000000404040404040404060806020202020202020202020202020202020202020202020202020000000000000000000101010101010101010000000000000000000000080808080808000a0a0a0a0a0a0a0a0a0a0a000000000000000000000000000000000000020202020202020100040404040404040404000000000000000000010608080601010101020202020202020202020201010101010000000000000000000000020202020200000000000000000000000000000000010101000000000000000000000004040404040404040600080602020202020202020202020202020202020202020202020202020000000000000000010101010101010101000000000000000000000000080808080000000a0a0a0a0a0a0a0a0a0a000000000000000000000000000000000000000202020202010004040404040404040404000000000000000000000108080601010101010202020202020202020201010101010000000000000000000000000202020000000000000000000000000000000000010101000000000000000000000404040404040404040600080001020202020202020202000002020202020202020202020202020000000000000000010101010101010101000000000000020202020000000000000000000a0a0a0a0a0a0a0a0a00000000000000000000000000000000000000000000020202000404040404040404040404000000000000000000000006080801010101010101010102020202020101010101010000000000000000000000000202000000000000000000000000000000000000000100000000000000000000000404040404040404060008060001010202020202020000000000000000020202020202020202020202000000000000010101010101010101000000000002020202020000000000000000000000020a0a0a00000000000000000000000000000000000000000000000000000000000404040404040404040404000000000000000000000006080006010101010101010101020202020101010101010100000000000000000000000002000000000000000000000000000000000000000000000000000000000000000004040404040404060000060000010101000000000000000000000000020202020202020202020202020000000001010101010101010101010000000000020202020200000000000000000002020000000000000000000000000000000000000000000000000000000000000000040404040404020404040400000000000000000000000008000600010101010101010101020202010101010101010000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000404040404040600000604040001010100000000000000000000000000020202020202020202020202020000010101010101010101010101000000000000000000000000000000000002020202020000000000000000000000000000000000000000000000000000000000000004040404040202020404040000000000000000000000000800060000010101010101010102020201010101010101010000000000000000000000000000000000000000000000000000000000000000000002020000000000000000000404040404000000040408080808080808080808080808080800000000000002020000020202020202010101010101010101010101010101000000000000000000000000000000000202020202000000000000000000000000000000000000000000000000000000000000000404040404040404040404000000000000000000000000060806000000010101010101010202020101010101010101020200000000000000000000000000000000000000000000000000000000000000000202020000000000000000000404040600000008080808080808080808080808080808080808000000000000000002020202020202010101010101010101010101010100000000000000000000000000000000020202020200000000000000010101010100000000000000000000000000000000000000040404040404040404040404000000000000000000000006000000000000010101010101020202010101010101010102020100000000000000000000000000000000000000000000000000000000000000000202020000000000000000000a0a080808080808080808080808080808080808080808080808080000000000010102020202020201010101010101010101010101010100000000000000000000000000000002020202020000000000010101010101010101010000000000000000000000000000000004040404040404040404040400000000000000000000000600000000000001010101010102020201010101010101010202010100000000000000000000000000000000000000000000000000000000000000020202000000000000000000080808080808080808080808080808080808080808080808080808080808000101010102020202020101010101010101010101010101010000000000000000000000000000000002020202000000000001010101010101010101000000000000000000000000000000000a040404040404040404040400000000000000000000000600000600000001010101010102020202010101010101010101010100000000000000000000000000000004040404040400000000000000000000000000000000000000000008080808080808080808080808080808080808080808080808080808080808080801010101010202020101010101010101010101010101010000000000000000000000000000000000020202000000000000000101010101000000000000000002020000000000000000000a040404040404040404040404000000000000020200000608000600000001010101010202020202020202020201010101000000000000000000000000000000040404040404040404040404000000000000000000000000000000000808080808080808080808080808080808080808080808080808080808080808080808080101010102020101010101010101010101010101010101010000000000000000000000000000020202000000000000000000000000000000000000000202020000000000000000000a04040404040202020202020202000002020202020200000808060000000101010101020202020202020202020201000000000000000000020202020000000404040404040404040404040404040000000000000000000000000008080808080808080808080808080808080808080808080808080808080808080808080808010101010101010101010101010101010101010101010202020000000000000000000000000002020202000000000000000000000000000000000101020200000000000000000000000404040402020202020202020202020202020202020000080806000000000101010202020202020202020202020100000000000000000002020202020a040404040404040402020204040404040400000000000000000000000008080808080808080808080808080808080808080808080808080808080808080808080808080101010101010201010101010101010101010101020202020202000000000000000000000002020202000000000000000000000000000000000101000000000000000000000000000404040202020202020202020202020202020202020000060806000000000000000202020202020202020202020000000000000000000002020202020a0404040404040404020202040404040404000000000000000000000000080808080808080808080808080808080808080808080808080808080808080808080808080808010101010102020101010101010101010101020202020202020101010100010101000000000202020000000000000000000000000000000001010100000000000202020202000004040402020202020202020202020202020202020200000608060000000000000000020202020202020202020200000000000000000000020202020a04040404040404040404040204040404040000000000000000000000000808080808080808080808080808080808080808080808080808080808080808080808080808080808010101010202000000000000000001010202020202020202020101010101010101000000000000000000000000000000000000000000000101010000000002020202020202000404000002020202020202020202020202020202020000060806000000000000000000010101020202020202010000000000000202020200000a0a0a0404040404040404040404040404040404000000000000000000000000080808080808080808080808080808080808080808080808080808080808080808080808080808080801010101020202000000000000000002020202020202020202020202020201010100000000000000000000000000000000000000000000010101000000020202020202020200040001010101010101010102020202020101020202000006080600000000000000000001010101020202020201000000000002020202020a0a0a0a0a0404040404040404040404040404040400000000000000000000000008080808080808080808080808080808080808080808080808080808080808080808080808080808080801010101020200000000000000000202020202020202010101020202020202010100000000000000000000000000000000000000000000010101000000020202020202020200040001010101010101010101020201010101010101010106080600000000000000000001010101010202020101000000000002020202020a0a0a0a0a040404040404040404040404040404040000000000000000000000000808080808080808080808080808080808080808080808080808080808080808080808080808080808080801010100000000000000000002020202020202010101010102020202','hex'),4)
on conflict(id)do update set seed=excluded.seed,cols=excluded.cols,rows=excluded.rows,cell_size=excluded.cell_size,
 walkable=excluded.walkable,terrain=excluded.terrain,version=excluded.version;
alter table public.peris_world_map add constraint peris_world_map_walkable_check check(octet_length(walkable)=5000);
alter table public.peris_world_map add constraint peris_world_map_terrain_check check(octet_length(terrain)=40000);

create or replace function public.peris_world_walkable(p_x numeric,p_y numeric)returns boolean
language sql stable security definer set search_path='' as $$
 select coalesce((select get_bit(walkable,(floor(public.peris_wrap_world(p_y)/128)::integer+100)*200+floor(public.peris_wrap_world(p_x)/128)::integer+100)=1
 from public.peris_world_map where id=1),false)
$$;

-- Preserve every old site ID and coordinate. New sites require eight dry neighbours.
insert into public.spawn_points(id,x,y)
select site.id,site.x,site.y from (
 select 10013+row_index*50+column_index as id,(column_index*4-98)*128+64 as x,(row_index*4-98)*128+64 as y
 from generate_series(0,49) as rows(row_index) cross join generate_series(0,49) as columns(column_index)
) site
where not exists(select 1 from generate_series(-1,1) dx cross join generate_series(-1,1) dy
 where not public.peris_world_walkable(site.x+dx*128,site.y+dy*128))
 and not exists(select 1 from public.spawn_points existing where existing.x=site.x and existing.y=site.y)
on conflict(id)do nothing;

-- Tactical terrain comes from the canonical field byte, never a caller-provided camp label.
alter table public.peris_camps add column if not exists bandit boolean not null default false;
alter table public.peris_camps add column if not exists faction text;
alter table public.battles add column if not exists defender_faction text;
create or replace function public.peris_battle_terrain(px numeric,py numeric)returns text
language sql stable security definer set search_path='' as $$
 select coalesce((select (array['plains','woods','highlands','farmland','desert','snow','marsh','river','coast','coast','darkland'])[1+get_byte(terrain,(floor(public.peris_wrap_world(py)/128)::integer+100)*200+floor(public.peris_wrap_world(px)/128)::integer+100)] from public.peris_world_map where id=1),'plains')
$$;
update public.peris_camps set terrain=public.peris_battle_terrain(x,y) where not bandit;
-- Persistent map claims are separate from the city's internal building slots.
create or replace function public.peris_wrap_world(p_value numeric) returns numeric
language sql immutable strict set search_path='' as $$
 select p_value-floor((p_value+12800)/25600)*25600
$$;
create or replace function public.peris_wrap_cell(p_value integer) returns integer
language sql immutable strict set search_path='' as $$
 select (((p_value::bigint+100)%200+200)%200-100)::integer
$$;
create or replace function public.peris_cell_distance(p_col integer,p_row integer,p_other_col integer,p_other_row integer) returns integer
language sql immutable strict set search_path='' as $$
 select greatest(least(abs(public.peris_wrap_cell(p_col)-public.peris_wrap_cell(p_other_col)),200-abs(public.peris_wrap_cell(p_col)-public.peris_wrap_cell(p_other_col))),
                 least(abs(public.peris_wrap_cell(p_row)-public.peris_wrap_cell(p_other_row)),200-abs(public.peris_wrap_cell(p_row)-public.peris_wrap_cell(p_other_row))))
$$;
-- Byte indices use the same eleven-terrain order as the generated world grid.
create or replace function public.peris_world_terrain(p_col integer,p_row integer) returns integer
language sql stable strict security definer set search_path='' as $$
 select get_byte(terrain,(public.peris_wrap_cell(p_row)+100)*200+public.peris_wrap_cell(p_col)+100)
 from public.peris_world_map where id=1
$$;

create unique index if not exists settlements_map_owner_key on public.settlements(id,owner_id);
create table if not exists public.peris_map_plots(
 col integer not null check(col>=-100 and col<100),row integer not null check(row>=-100 and row<100),
 settlement_id bigint not null,owner_id uuid not null references public.players(id) on delete cascade,
 building_type text check(building_type in ('lumber','quarry','farm','market')),
 level integer not null default 0 check(level between 0 and 5),primary key(col,row),
 foreign key(settlement_id,owner_id) references public.settlements(id,owner_id) on delete cascade,
 check(building_type is not null or level=0)
);
create index if not exists peris_map_plots_settlement_idx on public.peris_map_plots(settlement_id);
create index if not exists peris_map_plots_bounds_idx on public.peris_map_plots(row,col);
alter table public.peris_map_plots enable row level security;
drop policy if exists "own map plots" on public.peris_map_plots;
create policy "own map plots" on public.peris_map_plots for select to authenticated using(owner_id=auth.uid());
revoke all on public.peris_map_plots from public,anon,authenticated;
grant select on public.peris_map_plots to authenticated;
alter table public.peris_orders drop constraint if exists peris_orders_kind_check;
alter table public.peris_orders add constraint peris_orders_kind_check check(kind in ('upgrade','recruit','field','settler'));
create unique index if not exists peris_orders_field_pending_key
 on public.peris_orders(owner_id,(split_part(item,':',2)),(split_part(item,':',3))) where kind='field';
-- Terrain modifiers produce fractional income; city base rates remain unchanged.
alter table public.settlements alter column wood_rate type numeric(18,4);
alter table public.settlements alter column stone_rate type numeric(18,4);
alter table public.settlements alter column food_rate type numeric(18,4);
alter table public.settlements alter column gold_rate type numeric(18,4);

create or replace function public.peris_field_modifier(p_type text,p_terrain integer) returns numeric
language sql immutable set search_path='' as $$
 select case p_type
 when 'farm' then case when p_terrain=2 then .75 when p_terrain in (0,3) then 1.1 when p_terrain in (4,5) then .85 else 1 end
 when 'lumber' then case when p_terrain=1 then 1.25 when p_terrain in (4,5) then .85 else 1 end
 when 'quarry' then case when p_terrain=2 then 1.3 when p_terrain=6 then .9 else 1 end
 when 'market' then case when p_terrain in (7,9) then 1.1 when p_terrain=5 then .9 else 1 end
 else 0 end
$$;
create or replace function public.peris_field_rates(p_sid bigint)
 returns table(wood numeric,stone numeric,food numeric,gold numeric)
language sql stable security definer set search_path='' as $$
 select coalesce(sum(6*level*public.peris_field_modifier(building_type,public.peris_world_terrain(col,row))) filter(where building_type='lumber'),0),
        coalesce(sum(5*level*public.peris_field_modifier(building_type,public.peris_world_terrain(col,row))) filter(where building_type='quarry'),0),
        coalesce(sum(8*level*public.peris_field_modifier(building_type,public.peris_world_terrain(col,row))) filter(where building_type='farm'),0),
        coalesce(sum(2*level*public.peris_field_modifier(building_type,public.peris_world_terrain(col,row))) filter(where building_type='market'),0)
 from public.peris_map_plots where settlement_id=p_sid and level>0
$$;
-- Existing city migration and debug calls must retain completed external income.
create or replace function public.peris_city_economy(p_sid bigint) returns void language plpgsql security definer set search_path='' as $$
begin
 update public.settlements s set
 wood_rate=14+8*coalesce((select level from public.buildings where settlement_id=s.id and building_type='lumber'),0)+f.wood,
 stone_rate=12+7*coalesce((select level from public.buildings where settlement_id=s.id and building_type='quarry'),0)+f.stone,
 food_rate=18+10*coalesce((select level from public.buildings where settlement_id=s.id and building_type='farm'),0)+8*coalesce((select sum(level) from public.peris_city_slots where settlement_id=s.id and building_type='fishery'),0)+f.food,
 gold_rate=3+3*coalesce((select level from public.buildings where settlement_id=s.id and building_type='market'),0)+f.gold,
 capacity=5000+2500*coalesce((select sum(level) from public.peris_city_slots where settlement_id=s.id and building_type='warehouse'),0),
 food_capacity=5000+2500*coalesce((select sum(level) from public.peris_city_slots where settlement_id=s.id and building_type='granary'),0)
 from public.peris_field_rates(p_sid) f where s.id=p_sid;
end $$;

create or replace function public.peris_claim_field(p_col integer,p_row integer) returns jsonb
language plpgsql security definer set search_path='' as $$
declare u uuid:=auth.uid();s public.settlements%rowtype;c integer;r integer;home_col integer;home_row integer;distance integer;owned integer;population integer;allowance integer;
begin
 if u is null then raise exception 'Authentication required';end if;
 if p_col is null or p_row is null then raise exception 'Choose whole field coordinates';end if;
 -- Claim and spawn share one lock so neither can reserve another's starting land.
 perform pg_advisory_xact_lock(204200);
 perform public.peris_settle(u);
 if exists(select 1 from public.battles where status='active' and (attacker_owner_id=u or defender_owner_id=u)) then raise exception 'Finish the current battle first';end if;
 select * into s from public.settlements where id=public.peris_city_id(u) for update;
 if s.id is null then raise exception 'Settlement not found';end if;
 c:=public.peris_wrap_cell(p_col);r:=public.peris_wrap_cell(p_row);
 home_col:=floor(s.x/128::numeric)::integer;home_row:=floor(s.y/128::numeric)::integer;
 if exists(select 1 from public.peris_settler_expeditions where status='travelling'and public.peris_cell_distance(c,r,col,row)<=1)then raise exception 'Settlers have reserved this land';end if;
 if exists(select 1 from public.peris_map_plots where col=c and row=r) then raise exception 'This field is already owned';end if;
 if exists(select 1 from public.settlements where public.peris_cell_distance(c,r,floor(x/128::numeric)::integer,floor(y/128::numeric)::integer)=0) then raise exception 'This field contains a settlement';end if;
 if exists(select 1 from public.peris_camps where public.peris_cell_distance(c,r,floor(x/128::numeric)::integer,floor(y/128::numeric)::integer)=0) then raise exception 'An ancient campaign site protects this field';end if;
 if public.peris_world_terrain(c,r)=8 or not public.peris_world_walkable(c*128+64,r*128+64) then raise exception 'Resource buildings need dry land';end if;
 if exists(select 1 from public.settlements where id<>s.id and public.peris_cell_distance(c,r,floor(x/128::numeric)::integer,floor(y/128::numeric)::integer)<=1) then raise exception 'Another village protects its starting land';end if;
 distance:=public.peris_cell_distance(c,r,home_col,home_row);
 if distance>6 then raise exception 'Stay within 6 fields of your village';end if;
 select count(*) into owned from public.peris_map_plots where settlement_id=s.id;
 if owned<4 and distance<>1 then raise exception 'Choose your first four fields from the eight village neighbours';end if;
 select 80+10*greatest(0,case when(select count(*)from public.settlements where owner_id=u)=1 then upgrades else s.development_points end)into population from public.players where id=u;
 allowance:=4+case when population>=120 then 1+(population-120)/40 else 0 end;
 if owned>=allowance then raise exception 'More population is needed to claim another field';end if;
 if distance<>1 and not exists(select 1 from public.peris_map_plots where settlement_id=s.id and public.peris_cell_distance(c,r,col,row)=1) then raise exception 'Connect this field directly to your existing territory';end if;
 insert into public.peris_map_plots(col,row,settlement_id,owner_id) values(c,r,s.id,u);
 return jsonb_build_object('ok',true);
exception when unique_violation then raise exception 'This field is already owned';
end $$;

create or replace function public.peris_queue_field(p_col integer,p_row integer,p_type text) returns jsonb
language plpgsql security definer set search_path='' as $$
declare u uuid:=auth.uid();s public.settlements%rowtype;p public.peris_map_plots%rowtype;c integer;r integer;factor numeric;cw numeric;cs numeric;cf numeric;cg numeric;
begin
 if u is null then raise exception 'Authentication required';end if;
 if p_col is null or p_row is null or p_type is null or p_type not in ('lumber','quarry','farm','market') then raise exception 'Choose a valid resource building and field';end if;
 perform public.peris_settle(u);
 if exists(select 1 from public.battles where status='active' and (attacker_owner_id=u or defender_owner_id=u)) then raise exception 'Finish the current battle first';end if;
 select * into s from public.settlements where id=public.peris_city_id(u) for update;
 if s.id is null then raise exception 'Settlement not found';end if;
 c:=public.peris_wrap_cell(p_col);r:=public.peris_wrap_cell(p_row);
 select * into p from public.peris_map_plots where col=c and row=r and owner_id=u and settlement_id=s.id for update;
 if p.settlement_id is null then raise exception 'Claim this field before constructing a building';end if;
 if p.level>=5 then raise exception 'This field has reached its maximum level';end if;
 if p.building_type is not null and p.building_type<>p_type then raise exception 'Upgrade the existing resource building';end if;
 if exists(select 1 from public.peris_orders where owner_id=u and kind='field' and item like 'field:'||c||':'||r||':%') then raise exception 'Construction is already underway on this field';end if;
 factor:=power(1.55::numeric,p.level);
 cw:=ceil((case p_type when 'lumber' then 80 when 'quarry' then 70 when 'farm' then 60 else 90 end)*factor);
 cs:=ceil((case p_type when 'lumber' then 50 when 'quarry' then 60 when 'farm' then 40 else 70 end)*factor);
 cf:=ceil((case p_type when 'farm' then 50 when 'market' then 40 else 30 end)*factor);
 cg:=ceil((case p_type when 'market' then 20 else 10 end)*factor);
 if s.wood<cw or s.stone<cs or s.food<cf or s.gold<cg then raise exception 'Your stores cannot cover this cost';end if;
 update public.settlements set wood=wood-cw,stone=stone-cs,food=food-cf,gold=gold-cg where id=s.id;
 update public.peris_map_plots set building_type=p_type where col=c and row=r;
 insert into public.peris_orders(owner_id,kind,item,quantity,started_at,finish_at) values(u,'field','field:'||c||':'||r||':'||p_type,1,now(),now()+make_interval(secs=>15+p.level*10));
 return jsonb_build_object('ok',true);
end $$;

-- A modular upgrade may have refreshed city base formulas earlier in this file.
select public.peris_city_economy(id) from public.settlements where city_slots_ready;
revoke all on function public.peris_wrap_world(numeric),public.peris_wrap_cell(integer),public.peris_cell_distance(integer,integer,integer,integer),public.peris_world_terrain(integer,integer),public.peris_field_modifier(text,integer),public.peris_field_rates(bigint),public.peris_city_economy(bigint),public.peris_claim_field(integer,integer),public.peris_queue_field(integer,integer,text) from public,anon,authenticated;
grant execute on function public.peris_claim_field(integer,integer),public.peris_queue_field(integer,integer,text) to authenticated;
-- Interpolate by traveled route distance. Old saves and armies with no stored
-- route retain the original straight-line interpolation until their next march.
create or replace function public.peris_army_position(p_army public.armies,p_at timestamptz default now())returns jsonb
language plpgsql stable security definer set search_path='' as $$
declare t numeric;remaining numeric;point jsonb;previous jsonb;x numeric;y numeric;px numeric;py numeric;dx numeric;dy numeric;segment numeric;
begin
 if p_army.status<>'moving' then return jsonb_build_object('x',p_army.target_x,'y',p_army.target_y);end if;
 t:=greatest(0,least(1,extract(epoch from(p_at-p_army.departure_at))/greatest(0.001,extract(epoch from(p_army.arrival_at-p_army.departure_at)))));
 if p_army.march_path is null or jsonb_typeof(p_army.march_path)<>'array' or jsonb_array_length(p_army.march_path)<2 or coalesce(p_army.march_distance,0)<=0 then
  if p_army.march_map_version=4 then return jsonb_build_object('x',public.peris_wrap_world(p_army.start_x+public.peris_wrapped_delta(p_army.start_x,p_army.target_x)*t),'y',public.peris_wrap_world(p_army.start_y+public.peris_wrapped_delta(p_army.start_y,p_army.target_y)*t));end if;
  return jsonb_build_object('x',p_army.start_x+(p_army.target_x-p_army.start_x)*t,'y',p_army.start_y+(p_army.target_y-p_army.start_y)*t);
 end if;
 remaining:=p_army.march_distance*t;previous:=p_army.march_path->0;
 px:=(previous->>0)::numeric;py:=(previous->>1)::numeric;
 for point in select value from jsonb_array_elements(p_army.march_path)with ordinality as points(value,ordinal)where ordinal>1 order by ordinal loop
  x:=(point->>0)::numeric;y:=(point->>1)::numeric;
  dx:=case when p_army.march_map_version=4 then public.peris_wrapped_delta(px,x) else x-px end;
  dy:=case when p_army.march_map_version=4 then public.peris_wrapped_delta(py,y) else y-py end;
  segment:=sqrt(power(dx,2)+power(dy,2));
  if segment>0 and remaining<=segment then
   if p_army.march_map_version=4 then return jsonb_build_object('x',public.peris_wrap_world(px+dx*remaining/segment),'y',public.peris_wrap_world(py+dy*remaining/segment));end if;
   return jsonb_build_object('x',px+dx*remaining/segment,'y',py+dy*remaining/segment);
  end if;
  remaining:=remaining-segment;px:=x;py:=y;
 end loop;
 return jsonb_build_object('x',p_army.target_x,'y',p_army.target_y);
end $$;
-- Optional, unique mage tower and the twenty-spell research catalog.
-- Existing population-era worlds already contain housing. Keep it valid at
-- every migration step, before the population module reapplies this constraint.
alter table public.peris_city_slots drop constraint if exists peris_city_slots_building_type_check;
alter table public.peris_city_slots add constraint peris_city_slots_building_type_check check(building_type in ('barracks','stables','smithy','warehouse','granary','fishery','mage_tower','housing'));
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
 select * into s from public.settlements where id=public.peris_city_id(u) for update;
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
 own_side text;friend boolean;single_target boolean;l integer;mana integer;ready numeric;idx integer:=0;cas integer;troops integer;mor numeric;alive_a boolean;alive_d boolean;hero_bonus jsonb;
begin
 select * into b from public.battles where id=p_battle_id for update;
 if u is null or b.id is null or (u is distinct from b.attacker_owner_id and u is distinct from b.defender_owner_id) then raise exception 'Not your battle';end if;
 if b.status<>'active' or b.phase<>'combat' then raise exception 'Spells can only be cast during combat';end if;
 select * into sp from public.peris_spell_catalog where id=p_spell;
 select city.* into s from public.settlements city join public.peris_spell_research research on research.settlement_id=city.id join public.peris_city_slots tower on tower.settlement_id=city.id and tower.building_type='mage_tower'and tower.level>=sp.level where city.owner_id=u and research.spell_id=sp.id order by city.id limit 1;
 hero_bonus:=public.peris_hero_bonuses(case when b.attacker_owner_id=u then b.attacker_army_id else b.defender_army_id end);
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
 cas:=ceil(greatest(0,sp.damage-case when sp.chain>0 then idx*6 else 0 end)*(hero_bonus->>'spell')::numeric*(1-f.magic_defence));idx:=idx+1;
 troops:=greatest(0,least(f.initial_soldiers,f.soldiers-cas+ceil(sp.heal*(hero_bonus->>'spell')::numeric)::integer));
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
-- Culture is integrated at each completed order/arrival before rates change.
alter table public.battle_formations drop constraint if exists battle_formations_attack_multiplier_check;
alter table public.battle_formations add constraint battle_formations_attack_multiplier_check check(attack_multiplier between 1 and 4);
alter table public.peris_orders drop constraint if exists peris_orders_kind_check;
alter table public.peris_orders add constraint peris_orders_kind_check check(kind in('upgrade','recruit','field','settler'));
update public.settlements s set development_points=p.upgrades from public.players p where p.id=s.owner_id and s.development_points=0 and (select count(*)from public.settlements own where own.owner_id=p.id)=1;
alter table public.peris_challenges add column if not exists attacker_army_id bigint references public.armies(id);

create or replace function public.peris_culture_rate(p_owner uuid)returns numeric language sql stable security definer set search_path='' as $$
 select coalesce(sum(5+2*coalesce((select sum(level)from public.buildings b where b.settlement_id=s.id),0)+3*coalesce((select sum(level)from public.peris_city_slots c where c.settlement_id=s.id),0)),0)from public.settlements s where s.owner_id=p_owner
$$;
create or replace function public.peris_culture_accrue(p_owner uuid,p_until timestamptz)returns void language plpgsql security definer set search_path='' as $$
begin update public.players set culture_points=least(1000000000,culture_points+greatest(0,extract(epoch from p_until-culture_updated_at))/60*public.peris_culture_rate(p_owner)),culture_updated_at=greatest(culture_updated_at,p_until)where id=p_owner;end $$;
create or replace function public.peris_hero_level(p_experience integer)returns integer language sql immutable set search_path='' as $$select least(20,floor((1+sqrt(1+8*greatest(0,p_experience)/100::numeric))/2)::integer)$$;
create or replace function public.peris_hero_bonuses(p_army bigint)returns jsonb language plpgsql stable security definer set search_path='' as $$
declare h public.peris_heroes%rowtype;a numeric:=0;d numeric:=0;p numeric:=0;k numeric:=0;march_speed numeric:=1;
begin
 select * into h from public.peris_heroes where army_id=p_army;
 if h.id is not null then
 a:=h.attack+case h.class when 'knight' then 3 when 'ranger' then 2 else 1 end;
 d:=h.defence+case h.class when 'knight' then 2 else 1 end;
 p:=h.power+case h.class when 'mage' then 3 else 1 end;
 k:=h.knowledge+case h.class when 'knight' then 1 else 2 end;
 if h.class='ranger'then march_speed:=1.1;end if;
 select a+coalesce(sum(c.attack),0),d+coalesce(sum(c.defence),0),p+coalesce(sum(c.power),0),k+coalesce(sum(c.knowledge),0),march_speed+coalesce(sum(c.speed),0)
 into a,d,p,k,march_speed from public.peris_hero_artifacts i join public.peris_artifact_catalog c on c.id=i.artifact_id where i.hero_id=h.id and i.owner_id=h.owner_id;
 end if;
 return jsonb_build_object('attack',a,'defence',d,'power',p,'knowledge',k,'speed',march_speed,'damage',1+a*.02,'protection',1+d*.025,'morale',least(10,a+d),'mana',k*10,'spell',1+p*.08);
end $$;
create or replace function public.peris_apply_hero(p_battle bigint,p_owner uuid,p_side text)returns void language plpgsql security definer set search_path='' as $$
declare aid bigint;sid bigint;bonus jsonb;tower integer;
begin
 if p_owner is null then return;end if;
 select case when p_side='attacker'then attacker_army_id else defender_army_id end into aid from public.battles where id=p_battle;
 select home_settlement_id into sid from public.armies where id=aid and owner_id=p_owner;
 bonus:=public.peris_hero_bonuses(aid);
 update public.battle_formations set attack_multiplier=(1+least(.6,coalesce((select sum(level)*.04 from public.peris_city_slots where settlement_id=sid and building_type='smithy'),0)))*(bonus->>'damage')::numeric,
 defence_multiplier=(bonus->>'protection')::numeric,morale=least(100,morale+(bonus->>'morale')::numeric)where battle_id=p_battle and side=p_side;
 select coalesce(max(c.level),0)into tower from public.peris_city_slots c join public.settlements s on s.id=c.settlement_id where s.owner_id=p_owner and c.building_type='mage_tower';
 update public.battles set mana_attacker=case when p_side='attacker'then (case when tower>0 then 20+tower*10 else 0 end)+(bonus->>'mana')::integer else mana_attacker end,
 mana_defender=case when p_side='defender'then (case when tower>0 then 20+tower*10 else 0 end)+(bonus->>'mana')::integer else mana_defender end where id=p_battle;
end $$;
create or replace function public.peris_hero_reward(p_army bigint,p_experience integer,p_camp integer default null)returns void language plpgsql security definer set search_path='' as $$
declare h public.peris_heroes%rowtype;artifact text;
begin
 select * into h from public.peris_heroes where army_id=p_army for update;if h.id is null then return;end if;
 update public.peris_heroes set experience=least(19000,experience+greatest(0,p_experience))where id=h.id;
 if p_camp is not null and (p_camp<=6 or p_camp%7=0)and(select count(*)from public.peris_hero_artifacts where owner_id=h.owner_id)<200 then
 artifact:=(array['iron_sword','chainmail','boots','circlet','runestaff','crown_seal'])[least(6,greatest(1,case when p_camp>6 then (select tier from public.peris_camps where id=p_camp)else p_camp end))];
 insert into public.peris_hero_artifacts(owner_id,artifact_id,slot,source_camp_id)select h.owner_id,c.id,c.slot,p_camp from public.peris_artifact_catalog c where c.id=artifact on conflict(owner_id,source_camp_id)do nothing;
 end if;
end $$;

create or replace function public.peris_found_reason(p_col integer,p_row integer,p_expedition bigint default null)returns text language plpgsql stable security definer set search_path='' as $$
declare c integer:=public.peris_wrap_cell(p_col);r integer:=public.peris_wrap_cell(p_row);
begin
 if p_col is null or p_row is null then return 'Choose whole field coordinates';end if;
 if exists(select 1 from generate_series(-1,1) dx cross join generate_series(-1,1)dy where not public.peris_world_walkable(public.peris_wrap_world((c+dx)*128+64),public.peris_wrap_world((r+dy)*128+64)))then return 'Choose a site with dry neighbouring fields for your city';end if;
 if exists(select 1 from public.settlements where public.peris_cell_distance(c,r,floor(x/128::numeric)::integer,floor(y/128::numeric)::integer)<4)then return 'Stay at least four fields away from another city';end if;
 if exists(select 1 from public.peris_camps where public.peris_cell_distance(c,r,floor(x/128::numeric)::integer,floor(y/128::numeric)::integer)<=1)then return 'A campaign landmark protects this land';end if;
 if exists(select 1 from public.peris_map_plots where public.peris_cell_distance(c,r,col,row)<=1)then return 'Choose unclaimed land with free neighbouring fields';end if;
 if exists(select 1 from public.peris_settler_expeditions where status='travelling'and id is distinct from p_expedition and public.peris_cell_distance(c,r,col,row)<4)then return 'Another settler expedition has reserved a nearby site';end if;
 return null;
end $$;
create or replace function public.peris_route_distance(p_start_x numeric,p_start_y numeric,p_end_x numeric,p_end_y numeric,p_path jsonb)returns numeric language plpgsql stable security definer set search_path='' as $$
declare point jsonb;px numeric:=p_start_x;py numeric:=p_start_y;x numeric;y numeric;cx integer;cy integer;pcx integer;pcy integer;i integer:=0;distance numeric:=0;segment numeric;
begin
 if p_path is null or jsonb_typeof(p_path)<>'array' then raise exception 'Choose a connected land route';end if;
 if jsonb_array_length(p_path)<2 or jsonb_array_length(p_path)>2000 then raise exception 'A route needs 2-2000 points';end if;
 pcx:=floor(px/128)::integer;pcy:=floor(py/128)::integer;
 for point in select value from jsonb_array_elements(p_path)loop
 i:=i+1;
 if jsonb_typeof(point)<>'array'or jsonb_array_length(point)<>2 or jsonb_typeof(point->0)<>'number'or jsonb_typeof(point->1)<>'number'then raise exception 'Invalid route point';end if;
 x:=(point->>0)::numeric;y:=(point->>1)::numeric;
 if x< -12800 or x>=12800 or y< -12800 or y>=12800 then raise exception 'Route leaves the world';end if;
 if i=1 then if abs(x-px)>1 or abs(y-py)>1 then raise exception 'Route must start at your city';end if;continue;end if;
 cx:=floor(x/128)::integer;cy:=floor(y/128)::integer;
 if public.peris_cell_distance(cx,cy,pcx,pcy)>1 or not public.peris_world_walkable(x,y)then raise exception 'Route must follow neighbouring land fields';end if;
 if cx<>pcx and cy<>pcy and(not public.peris_world_walkable((cx+.5)*128,(pcy+.5)*128)or not public.peris_world_walkable((pcx+.5)*128,(cy+.5)*128))then raise exception 'Route cannot cross a sea corner';end if;
 segment:=sqrt(power(public.peris_wrapped_delta(px,x),2)+power(public.peris_wrapped_delta(py,y),2));if segment=0 then raise exception 'Route must advance';end if;
 distance:=distance+segment;px:=x;py:=y;pcx:=cx;pcy:=cy;
 end loop;
 if px<>p_end_x or py<>p_end_y then raise exception 'Route must end at the colony site';end if;return distance;
end $$;
create or replace function public.peris_found_complete(p_id bigint)returns void language plpgsql security definer set search_path='' as $$
declare e public.peris_settler_expeditions%rowtype;s public.settlements%rowtype;sid bigint;reason text;
begin
 select * into e from public.peris_settler_expeditions where id=p_id for update;if e.id is null or e.status<>'travelling'then return;end if;
 perform pg_advisory_xact_lock(204200);
 perform public.peris_population_accrue(e.origin_settlement_id,e.arrival_at);
 reason:=public.peris_found_reason(e.col,e.row,e.id);
 if reason is not null then
 update public.peris_settler_expeditions set status='returned'where id=e.id;
 update public.settlements set settlers=least(6,settlers+3),wood=least(capacity,wood+500),stone=least(capacity,stone+400),food=least(food_capacity,food+600),gold=least(capacity,gold+150)where id=e.origin_settlement_id;
 update public.players set culture_points=least(1000000000,culture_points+e.culture_cost)where id=e.owner_id;return;
 end if;
 select * into s from public.settlements where id=e.origin_settlement_id;
 insert into public.settlements(owner_id,name,x,y,faction,wood,stone,food,gold,resources_updated_at,created_at,city_slots_ready)
 values(e.owner_id,e.name,e.col*128+64,e.row*128+64,s.faction,750,600,800,250,e.arrival_at,e.arrival_at,true)returning id into sid;
 insert into public.buildings(settlement_id,building_type,level)select sid,t,0 from unnest(array['lumber','quarry','farm','market','barracks','stables','wall','storehouse'])t;
 perform public.peris_city_economy(sid);
 update public.peris_settler_expeditions set status='founded',settlement_id=sid where id=e.id;
end $$;

create or replace function public.peris_empire_command(p_command jsonb)returns jsonb language plpgsql security definer set search_path='' as $$
declare u uuid:=auth.uid();command_kind text:=p_command->>'type';s public.settlements%rowtype;a public.armies%rowtype;t public.armies%rowtype;h public.peris_heroes%rowtype;item public.peris_hero_artifacts%rowtype;
 qty integer;main integer;count_cities integer;count_armies integer;cost integer;reason text;distance numeric;hero_class text;hero_name text;new_army_id bigint;stat text;inf integer;arc integer;cav integer;position jsonb;target jsonb;camp public.peris_camps%rowtype;
begin
 if u is null then raise exception 'Authentication required';end if;
 if p_command is null or jsonb_typeof(p_command)<>'object'or command_kind is null then raise exception 'Choose a valid command';end if;
 if command_kind in('foundCity','claimField')then perform pg_advisory_xact_lock(204200);end if;
 perform set_config('peris.city_id',coalesce(p_command->>'settlementId',''),true);perform set_config('peris.army_id',coalesce(p_command->>'armyId',''),true);
 -- Two-player RPCs own their stable lock order; do not lock this caller first.
 if command_kind in('challenge','respond')then
  perform public.peris_city_id(u);perform public.peris_army_id(u);
  if command_kind='challenge'then return public.peris_challenge((p_command->>'ownerId')::uuid);
  else return public.peris_respond((p_command->>'id')::bigint,(p_command->>'accept')::boolean);end if;
 end if;
 perform public.peris_settle(u);
 select * into s from public.settlements where id=public.peris_city_id(u)for update;
 select * into a from public.armies where id=public.peris_army_id(u)for update;
 if exists(select 1 from public.battles where status='active'and(attacker_owner_id=u or defender_owner_id=u))then raise exception 'Finish the current battle first';end if;
 case command_kind
 when 'upgrade'then return public.peris_queue_upgrade(p_command->>'item');
 when 'buildSlot'then return public.peris_queue_slot((p_command->>'slot')::integer,p_command->>'item');
 when 'upgradeSlot'then return public.peris_queue_slot((p_command->>'slot')::integer,null);
 when 'recruit'then return public.peris_queue_recruit(p_command->>'item',(p_command->>'quantity')::integer);
 when 'move'then if p_command ? 'route'then return public.peris_march(round((p_command->>'x')::numeric)::integer,round((p_command->>'y')::numeric)::integer,p_command->'route');else return public.move_army(round((p_command->>'x')::numeric)::integer,round((p_command->>'y')::numeric)::integer);end if;
 when 'raid'then
  if p_command ? 'route'then
   select * into camp from public.peris_camps where id=(p_command->>'campId')::integer;
   if camp.id is null then raise exception 'Camp not found';end if;
   if a.infantry+a.archers+a.cavalry=0 then raise exception 'Recruit soldiers before starting a raid';end if;
   if exists(select 1 from public.peris_progress where owner_id=u and camp_id=camp.id and available_at>now())then raise exception 'The camp is still regrouping';end if;
   perform public.peris_march(camp.x,camp.y,p_command->'route');
   update public.armies set raid_target_id=camp.id where id=a.id;
   return jsonb_build_object('ok',true);
  else return public.peris_raid((p_command->>'campId')::integer);end if;
 when 'claimField'then return public.peris_claim_field((p_command->>'col')::integer,(p_command->>'row')::integer);
 when 'buildField'then return public.peris_queue_field((p_command->>'col')::integer,(p_command->>'row')::integer,p_command->>'item');
 when 'researchSpell'then return public.peris_research_spell(p_command->>'spell');
 when 'rename'then return public.peris_rename(p_command->>'name');
 when 'claim'then return public.peris_claim(p_command->>'questId');
 when 'setFaction'then perform public.peris_set_faction(p_command->>'faction');
 when 'debugCity'then
  if p_command->>'action'='culture'then
   if not coalesce((select enabled from public.peris_debug_config where id),false)then raise exception 'Debug tools are disabled';end if;
   if (p_command->>'value')::integer is distinct from 1000 then raise exception 'Choose +1,000 culture';end if;
   update public.players set culture_points=least(1000000000,culture_points+1000)where id=u;
  else perform public.peris_debug_city(p_command->>'action',p_command->>'target',(p_command->>'value')::integer);end if;
 when 'challenge'then return public.peris_challenge((p_command->>'ownerId')::uuid);
 when 'respond'then return public.peris_respond((p_command->>'id')::bigint,(p_command->>'accept')::boolean);
 when 'trainSettlers'then
  qty:=(p_command->>'quantity')::integer;
  if qty is null or qty<1 or qty>3 then raise exception 'Train between one and three settlers';end if;
  select level into main from public.buildings where settlement_id=s.id and building_type='market';
  if coalesce(main,0)<2 then raise exception 'Upgrade the main building to level 2 to train settlers';end if;
  if exists(select 1 from public.peris_orders where settlement_id=s.id and kind='settler')then raise exception 'Settlers are already training in this city';end if;
  if s.settlers+qty+3*(select count(*)from public.peris_settler_expeditions where origin_settlement_id=s.id and status='travelling')>6 then raise exception 'A city can prepare up to six settlers';end if;
  if s.wood<350*qty or s.stone<250*qty or s.food<450*qty or s.gold<100*qty then raise exception 'More supplies are needed to train settlers';end if;
  update public.settlements set wood=wood-350*qty,stone=stone-250*qty,food=food-450*qty,gold=gold-100*qty where id=s.id;
  insert into public.peris_orders(owner_id,settlement_id,kind,item,quantity,started_at,finish_at)values(u,s.id,'settler','settlers',qty,now(),now()+make_interval(secs=>ceil(40*qty/(1+main*.15))::double precision));
 when 'foundCity'then
  perform pg_advisory_xact_lock(204200);
  reason:=public.peris_found_reason((p_command->>'col')::integer,(p_command->>'row')::integer);
  if reason is not null then raise exception '%',reason;end if;
  hero_name:=btrim(p_command->>'name');if hero_name is null or length(hero_name)<2 or length(hero_name)>32 then raise exception 'Use a city name of 2-32 characters';end if;
  select (select count(*)from public.settlements where owner_id=u)+(select count(*)from public.peris_settler_expeditions where owner_id=u and status='travelling')into count_cities;
  if count_cities>=10 then raise exception 'Your empire can hold up to ten cities';end if;
  cost:=300*count_cities*count_cities;
  if s.settlers<3 then raise exception 'Prepare three settlers in this city first';end if;
  if (select culture_points from public.players where id=u)<cost then raise exception 'Not enough culture points';end if;
  if s.wood<500 or s.stone<400 or s.food<600 or s.gold<150 then raise exception 'More supplies are needed for this colony';end if;
  distance:=public.peris_route_distance(s.x,s.y,public.peris_wrap_cell((p_command->>'col')::integer)*128+64,public.peris_wrap_cell((p_command->>'row')::integer)*128+64,p_command->'route');
  update public.settlements set settlers=settlers-3,wood=wood-500,stone=stone-400,food=food-600,gold=gold-150 where id=s.id;
  update public.players set culture_points=culture_points-cost where id=u;
  insert into public.peris_settler_expeditions(owner_id,origin_settlement_id,col,row,name,departure_at,arrival_at,culture_cost,march_path)
  values(u,s.id,public.peris_wrap_cell((p_command->>'col')::integer),public.peris_wrap_cell((p_command->>'row')::integer),hero_name,now(),now()+make_interval(secs=>greatest(5,distance/18)::double precision),cost,p_command->'route');
 when 'recruitHero'then
  hero_class:=p_command->>'heroClass';hero_name:=btrim(p_command->>'name');
  if hero_class is null or hero_class not in('knight','ranger','mage')then raise exception 'Choose a hero class';end if;
  if hero_name is null or length(hero_name)<2 or length(hero_name)>24 then raise exception 'Use a hero name of 2-24 characters';end if;
  select count(*)into count_cities from public.settlements where owner_id=u;select count(*)into count_armies from public.armies where owner_id=u;
  if count_armies>=least(20,count_cities*2)then raise exception 'Found another city to support more armies';end if;
  if s.gold<500 then raise exception 'Hiring a hero costs 500 gold';end if;
  update public.settlements set gold=gold-500 where id=s.id;
  insert into public.armies(owner_id,home_settlement_id,name,infantry,archers,cavalry,start_x,start_y,target_x,target_y)values(u,s.id,hero_name||'’s army',0,0,0,s.x+40,s.y+30,s.x+40,s.y+30)returning id into new_army_id;
  update public.peris_heroes set name=hero_name,class=hero_class where army_id=new_army_id;
 when 'heroSkill'then
  select * into h from public.peris_heroes where id=(p_command->>'heroId')::bigint and owner_id=u for update;
  stat:=p_command->>'stat';if h.id is null or stat is null or stat not in('attack','defence','power','knowledge')then raise exception 'Choose your hero and an attribute';end if;
  if public.peris_hero_level(h.experience)-1-h.attack-h.defence-h.power-h.knowledge<1 then raise exception 'Win battles to earn another skill point';end if;
  update public.peris_heroes set attack=attack+case when stat='attack'then 1 else 0 end,defence=defence+case when stat='defence'then 1 else 0 end,power=power+case when stat='power'then 1 else 0 end,knowledge=knowledge+case when stat='knowledge'then 1 else 0 end where id=h.id;
 when 'equipArtifact'then
  select * into h from public.peris_heroes where id=(p_command->>'heroId')::bigint and owner_id=u for update;
  select * into item from public.peris_hero_artifacts where id=(p_command->>'artifactId')::bigint and owner_id=u for update;
  if h.id is null or item.id is null then raise exception 'Choose an artifact from your own inventory';end if;
  if item.hero_id is not null and item.hero_id<>h.id then raise exception 'Unequip this artifact from its current hero first';end if;
  if coalesce((p_command->>'equip')::boolean,false)then update public.peris_hero_artifacts set hero_id=null where hero_id=h.id and slot=item.slot;update public.peris_hero_artifacts set hero_id=h.id where id=item.id;
  else update public.peris_hero_artifacts set hero_id=null where id=item.id;end if;
 when 'transferTroops'then
  select * into t from public.armies where id=(p_command->>'targetArmyId')::bigint and owner_id=u for update;
  if t.id is null or t.id=a.id then raise exception 'Choose a different army of your own';end if;
  position:=public.peris_army_position(a);target:=public.peris_army_position(t);
  if a.status<>'idle'or t.status<>'idle'or sqrt(power(public.peris_wrapped_delta((position->>'x')::numeric,(target->>'x')::numeric),2)+power(public.peris_wrapped_delta((position->>'y')::numeric,(target->>'y')::numeric),2))>90 then raise exception 'Bring both idle armies together first';end if;
  if exists(select 1 from public.peris_orders where kind='recruit'and army_id in(a.id,t.id))then raise exception 'Finish both training queues before transferring troops';end if;
  inf:=(p_command->>'infantry')::integer;arc:=(p_command->>'archers')::integer;cav:=(p_command->>'cavalry')::integer;
  if inf is null or arc is null or cav is null or inf<0 or arc<0 or cav<0 or inf>a.infantry or arc>a.archers or cav>a.cavalry then raise exception 'Choose available soldiers';end if;
  if inf+arc+cav=0 or inf+arc+cav+t.infantry+t.archers+t.cavalry>1000 then raise exception 'Stay within the 1000 soldier capacity';end if;
  update public.armies set infantry=infantry-inf,archers=archers-arc,cavalry=cavalry-cav where id=a.id;
  update public.armies set infantry=infantry+inf,archers=archers+arc,cavalry=cavalry+cav where id=t.id;
 when 'rebaseArmy'then
  position:=public.peris_army_position(a);
  if a.status<>'idle'or sqrt(power(public.peris_wrapped_delta((position->>'x')::numeric,s.x+40),2)+power(public.peris_wrapped_delta((position->>'y')::numeric,s.y+30),2))>90 then raise exception 'Bring this army to the selected city first';end if;
  if exists(select 1 from public.peris_orders where kind='recruit'and army_id=a.id)then raise exception 'Finish training before changing the home city';end if;
  update public.armies set home_settlement_id=s.id where id=a.id;
 else raise exception 'Unknown empire command';
 end case;
 return jsonb_build_object('ok',true);
end $$;
-- Generated by scripts/build-bandits.mjs from the shared deterministic world seed.
insert into public.peris_camps(id,name,x,y,tier,terrain,infantry,archers,cavalry,description,bandit,faction)
select c.* from (values
(1000,'Elves outlaws',-12224,-11840,1,'highlands',29,9,2,'A roaming warband has built a camp here. Defeat its defenders for resources and commander experience. It regroups after ten minutes.',true,'elf'),
(1001,'Dwarves warband',-11712,-12608,3,'plains',82,21,38,'A roaming warband has built a camp here. Defeat its defenders for resources and commander experience. It regroups after ten minutes.',true,'dwarf'),
(1002,'Human · Spartan outlaws',-9920,-12736,1,'plains',30,6,1,'A roaming warband has built a camp here. Defeat its defenders for resources and commander experience. It regroups after ten minutes.',true,'spartan'),
(1003,'Human · Roman outlaws',-9024,-12736,1,'plains',26,17,2,'A roaming warband has built a camp here. Defeat its defenders for resources and commander experience. It regroups after ten minutes.',true,'roman'),
(1004,'Human · Roman outlaws',-8128,-12352,1,'highlands',32,6,3,'A roaming warband has built a camp here. Defeat its defenders for resources and commander experience. It regroups after ten minutes.',true,'roman'),
(1005,'Orcs outlaws',-7360,-12224,1,'woods',26,5,2,'A roaming warband has built a camp here. Defeat its defenders for resources and commander experience. It regroups after ten minutes.',true,'orc'),
(1006,'Gnomes raiders',-6208,-12224,2,'highlands',33,21,17,'A roaming warband has built a camp here. Defeat its defenders for resources and commander experience. It regroups after ten minutes.',true,'gnome'),
(1007,'Demons outlaws',-5568,-11840,1,'highlands',27,13,2,'A roaming warband has built a camp here. Defeat its defenders for resources and commander experience. It regroups after ten minutes.',true,'demon'),
(1008,'Human · Roman warband',-4032,-12736,3,'plains',71,57,27,'A roaming warband has built a camp here. Defeat its defenders for resources and commander experience. It regroups after ten minutes.',true,'roman'),
(1009,'Human · Persian marauders',-3008,-12352,4,'woods',70,89,64,'A roaming warband has built a camp here. Defeat its defenders for resources and commander experience. It regroups after ten minutes.',true,'persian'),
(1010,'Human · Roman outlaws',-2112,-12736,1,'highlands',29,7,2,'A roaming warband has built a camp here. Defeat its defenders for resources and commander experience. It regroups after ten minutes.',true,'roman'),
(1011,'Human · Persian outlaws',-1344,-12224,1,'plains',32,11,0,'A roaming warband has built a camp here. Defeat its defenders for resources and commander experience. It regroups after ten minutes.',true,'persian'),
(1012,'Human · Spartan outlaws',64,-12480,1,'darkland',30,12,1,'A roaming warband has built a camp here. Defeat its defenders for resources and commander experience. It regroups after ten minutes.',true,'spartan'),
(1013,'Human · Roman raiders',1472,-12224,2,'desert',47,21,11,'A roaming warband has built a camp here. Defeat its defenders for resources and commander experience. It regroups after ten minutes.',true,'roman'),
(1014,'Human · Roman raiders',1856,-12224,2,'desert',57,21,20,'A roaming warband has built a camp here. Defeat its defenders for resources and commander experience. It regroups after ten minutes.',true,'roman'),
(1015,'Elves warband',2624,-12736,3,'highlands',101,55,12,'A roaming warband has built a camp here. Defeat its defenders for resources and commander experience. It regroups after ten minutes.',true,'elf'),
(1016,'Gnomes outlaws',4160,-11968,1,'plains',33,9,2,'A roaming warband has built a camp here. Defeat its defenders for resources and commander experience. It regroups after ten minutes.',true,'gnome'),
(1017,'Human · Egyptian warband',5184,-11840,3,'plains',70,47,9,'A roaming warband has built a camp here. Defeat its defenders for resources and commander experience. It regroups after ten minutes.',true,'egyptian'),
(1020,'Pandaren outlaws',8512,-12224,1,'plains',28,17,1,'A roaming warband has built a camp here. Defeat its defenders for resources and commander experience. It regroups after ten minutes.',true,'pandaren'),
(1021,'Human · Egyptian raiders',9408,-12224,2,'plains',58,21,8,'A roaming warband has built a camp here. Defeat its defenders for resources and commander experience. It regroups after ten minutes.',true,'egyptian'),
(1022,'Demons raiders',10304,-12736,2,'plains',30,20,19,'A roaming warband has built a camp here. Defeat its defenders for resources and commander experience. It regroups after ten minutes.',true,'demon'),
(1023,'Human · Spartan warband',11328,-12480,3,'woods',97,54,15,'A roaming warband has built a camp here. Defeat its defenders for resources and commander experience. It regroups after ten minutes.',true,'spartan'),
(1024,'Gnomes raiders',12352,-11968,2,'plains',38,33,26,'A roaming warband has built a camp here. Defeat its defenders for resources and commander experience. It regroups after ten minutes.',true,'gnome'),
(1025,'Orcs warband',-12736,-11328,3,'highlands',106,51,20,'A roaming warband has built a camp here. Defeat its defenders for resources and commander experience. It regroups after ten minutes.',true,'orc'),
(1026,'Elves raiders',-11712,-11712,2,'plains',68,30,0,'A roaming warband has built a camp here. Defeat its defenders for resources and commander experience. It regroups after ten minutes.',true,'elf'),
(1027,'Demons outlaws',-9920,-11200,1,'highlands',33,8,3,'A roaming warband has built a camp here. Defeat its defenders for resources and commander experience. It regroups after ten minutes.',true,'demon'),
(1028,'Human · Persian raiders',-9152,-11456,2,'plains',69,27,3,'A roaming warband has built a camp here. Defeat its defenders for resources and commander experience. It regroups after ten minutes.',true,'persian'),
(1029,'Human · Egyptian raiders',-7744,-11712,2,'highlands',43,20,14,'A roaming warband has built a camp here. Defeat its defenders for resources and commander experience. It regroups after ten minutes.',true,'egyptian'),
(1030,'Demons raiders',-7104,-11072,2,'highlands',46,28,28,'A roaming warband has built a camp here. Defeat its defenders for resources and commander experience. It regroups after ten minutes.',true,'demon'),
(1031,'Elves outlaws',-6336,-11200,1,'woods',22,11,3,'A roaming warband has built a camp here. Defeat its defenders for resources and commander experience. It regroups after ten minutes.',true,'elf'),
(1032,'Demons outlaws',-4800,-11200,1,'desert',23,12,2,'A roaming warband has built a camp here. Defeat its defenders for resources and commander experience. It regroups after ten minutes.',true,'demon'),
(1033,'Human · Persian marauders',-4416,-11712,4,'plains',116,59,30,'A roaming warband has built a camp here. Defeat its defenders for resources and commander experience. It regroups after ten minutes.',true,'persian'),
(1034,'Elves raiders',-2624,-11712,2,'woods',48,12,8,'A roaming warband has built a camp here. Defeat its defenders for resources and commander experience. It regroups after ten minutes.',true,'elf'),
(1035,'Pandaren outlaws',-1984,-11328,1,'woods',31,13,2,'A roaming warband has built a camp here. Defeat its defenders for resources and commander experience. It regroups after ten minutes.',true,'pandaren'),
(1036,'Pandaren raiders',-1088,-11712,2,'highlands',59,18,7,'A roaming warband has built a camp here. Defeat its defenders for resources and commander experience. It regroups after ten minutes.',true,'pandaren'),
(1037,'Human · Roman raiders',64,-11456,2,'plains',42,19,15,'A roaming warband has built a camp here. Defeat its defenders for resources and commander experience. It regroups after ten minutes.',true,'roman'),
(1038,'Human · Persian warband',1088,-11200,3,'plains',125,51,2,'A roaming warband has built a camp here. Defeat its defenders for resources and commander experience. It regroups after ten minutes.',true,'persian'),
(1039,'Gnomes marauders',2112,-10944,4,'woods',100,73,28,'A roaming warband has built a camp here. Defeat its defenders for resources and commander experience. It regroups after ten minutes.',true,'gnome'),
(1040,'Pandaren marauders',2624,-11072,4,'marsh',165,61,48,'A roaming warband has built a camp here. Defeat its defenders for resources and commander experience. It regroups after ten minutes.',true,'pandaren'),
(1041,'Pandaren marauders',4160,-11072,4,'plains',114,84,53,'A roaming warband has built a camp here. Defeat its defenders for resources and commander experience. It regroups after ten minutes.',true,'pandaren'),
(1042,'Demons outlaws',4672,-11456,1,'darkland',28,13,0,'A roaming warband has built a camp here. Defeat its defenders for resources and commander experience. It regroups after ten minutes.',true,'demon'),
(1043,'Demons outlaws',6336,-11200,1,'plains',21,10,3,'A roaming warband has built a camp here. Defeat its defenders for resources and commander experience. It regroups after ten minutes.',true,'demon'),
(1044,'Orcs raiders',6720,-11456,2,'woods',57,18,8,'A roaming warband has built a camp here. Defeat its defenders for resources and commander experience. It regroups after ten minutes.',true,'orc'),
(1045,'Gnomes warband',7744,-11200,3,'desert',71,32,28,'A roaming warband has built a camp here. Defeat its defenders for resources and commander experience. It regroups after ten minutes.',true,'gnome'),
(1046,'Human · Spartan warband',9664,-11200,3,'desert',98,30,3,'A roaming warband has built a camp here. Defeat its defenders for resources and commander experience. It regroups after ten minutes.',true,'spartan'),
(1047,'Gnomes raiders',9792,-10816,2,'desert',39,29,17,'A roaming warband has built a camp here. Defeat its defenders for resources and commander experience. It regroups after ten minutes.',true,'gnome'),
(1048,'Orcs warband',11072,-11712,3,'desert',102,59,11,'A roaming warband has built a camp here. Defeat its defenders for resources and commander experience. It regroups after ten minutes.',true,'orc'),
(1049,'Gnomes outlaws',12352,-10816,1,'highlands',21,13,1,'A roaming warband has built a camp here. Defeat its defenders for resources and commander experience. It regroups after ten minutes.',true,'gnome'),
(1050,'Gnomes raiders',-12352,-10688,2,'highlands',66,15,18,'A roaming warband has built a camp here. Defeat its defenders for resources and commander experience. It regroups after ten minutes.',true,'gnome'),
(1051,'Necropolis raiders',-11200,-10432,2,'snow',75,16,0,'A roaming warband has built a camp here. Defeat its defenders for resources and commander experience. It regroups after ten minutes.',true,'undead'),
(1052,'Human · Roman raiders',-10176,-10176,2,'highlands',56,17,9,'A roaming warband has built a camp here. Defeat its defenders for resources and commander experience. It regroups after ten minutes.',true,'roman'),
(1053,'Human · Spartan warband',-8896,-10688,3,'plains',66,63,49,'A roaming warband has built a camp here. Defeat its defenders for resources and commander experience. It regroups after ten minutes.',true,'spartan'),
(1054,'Human · Spartan warband',-7744,-10176,3,'highlands',70,48,20,'A roaming warband has built a camp here. Defeat its defenders for resources and commander experience. It regroups after ten minutes.',true,'spartan'),
(1055,'Gnomes raiders',-6976,-10688,2,'highlands',34,32,21,'A roaming warband has built a camp here. Defeat its defenders for resources and commander experience. It regroups after ten minutes.',true,'gnome'),
(1056,'Human · Roman raiders',-6080,-10304,2,'highlands',45,29,11,'A roaming warband has built a camp here. Defeat its defenders for resources and commander experience. It regroups after ten minutes.',true,'roman'),
(1057,'Human · Spartan warband',-5568,-10432,3,'plains',51,53,35,'A roaming warband has built a camp here. Defeat its defenders for resources and commander experience. It regroups after ten minutes.',true,'spartan'),
(1058,'Gnomes raiders',-4288,-10176,2,'woods',51,19,19,'A roaming warband has built a camp here. Defeat its defenders for resources and commander experience. It regroups after ten minutes.',true,'gnome'),
(1059,'Gnomes outlaws',-3008,-10176,1,'highlands',19,12,2,'A roaming warband has built a camp here. Defeat its defenders for resources and commander experience. It regroups after ten minutes.',true,'gnome'),
(1060,'Human · Spartan outlaws',-1728,-10176,1,'plains',28,17,3,'A roaming warband has built a camp here. Defeat its defenders for resources and commander experience. It regroups after ten minutes.',true,'spartan'),
(1061,'Necropolis raiders',-576,-10176,2,'plains',34,25,12,'A roaming warband has built a camp here. Defeat its defenders for resources and commander experience. It regroups after ten minutes.',true,'undead'),
(1062,'Necropolis raiders',-448,-9792,2,'marsh',56,11,9,'A roaming warband has built a camp here. Defeat its defenders for resources and commander experience. It regroups after ten minutes.',true,'undead'),
(1063,'Dwarves raiders',832,-10688,2,'highlands',51,13,25,'A roaming warband has built a camp here. Defeat its defenders for resources and commander experience. It regroups after ten minutes.',true,'dwarf'),
(1064,'Orcs warband',2112,-10560,3,'woods',127,28,24,'A roaming warband has built a camp here. Defeat its defenders for resources and commander experience. It regroups after ten minutes.',true,'orc'),
(1065,'Orcs outlaws',2624,-9920,1,'marsh',40,8,0,'A roaming warband has built a camp here. Defeat its defenders for resources and commander experience. It regroups after ten minutes.',true,'orc'),
(1066,'Demons raiders',4160,-10176,2,'plains',38,38,21,'A roaming warband has built a camp here. Defeat its defenders for resources and commander experience. It regroups after ten minutes.',true,'demon'),
(1067,'Human · Spartan raiders',5184,-9920,2,'highlands',71,15,3,'A roaming warband has built a camp here. Defeat its defenders for resources and commander experience. It regroups after ten minutes.',true,'spartan'),
(1068,'Human · Egyptian warband',6336,-10688,3,'desert',92,28,21,'A roaming warband has built a camp here. Defeat its defenders for resources and commander experience. It regroups after ten minutes.',true,'egyptian'),
(1069,'Human · Spartan outlaws',7232,-9792,1,'plains',38,8,0,'A roaming warband has built a camp here. Defeat its defenders for resources and commander experience. It regroups after ten minutes.',true,'spartan'),
(1070,'Necropolis raiders',8512,-10688,2,'highlands',52,14,12,'A roaming warband has built a camp here. Defeat its defenders for resources and commander experience. It regroups after ten minutes.',true,'undead'),
(1071,'Gnomes outlaws',9280,-10176,1,'highlands',22,10,1,'A roaming warband has built a camp here. Defeat its defenders for resources and commander experience. It regroups after ten minutes.',true,'gnome'),
(1072,'Elves warband',10304,-10048,3,'highlands',85,37,16,'A roaming warband has built a camp here. Defeat its defenders for resources and commander experience. It regroups after ten minutes.',true,'elf'),
(1073,'Orcs raiders',10816,-10176,2,'highlands',37,25,9,'A roaming warband has built a camp here. Defeat its defenders for resources and commander experience. It regroups after ten minutes.',true,'orc'),
(1074,'Dwarves raiders',11840,-9920,2,'highlands',36,37,23,'A roaming warband has built a camp here. Defeat its defenders for resources and commander experience. It regroups after ten minutes.',true,'dwarf'),
(1075,'Pandaren raiders',-12608,-9664,2,'highlands',69,14,5,'A roaming warband has built a camp here. Defeat its defenders for resources and commander experience. It regroups after ten minutes.',true,'pandaren'),
(1076,'Gnomes raiders',-11200,-9536,2,'plains',47,35,9,'A roaming warband has built a camp here. Defeat its defenders for resources and commander experience. It regroups after ten minutes.',true,'gnome'),
(1077,'Demons outlaws',-10688,-9408,1,'desert',25,7,2,'A roaming warband has built a camp here. Defeat its defenders for resources and commander experience. It regroups after ten minutes.',true,'demon'),
(1078,'Necropolis raiders',-9280,-9664,2,'snow',48,16,16,'A roaming warband has built a camp here. Defeat its defenders for resources and commander experience. It regroups after ten minutes.',true,'undead'),
(1079,'Dwarves raiders',-8128,-9536,2,'highlands',68,20,5,'A roaming warband has built a camp here. Defeat its defenders for resources and commander experience. It regroups after ten minutes.',true,'dwarf'),
(1080,'Pandaren raiders',-7104,-9152,2,'snow',52,25,2,'A roaming warband has built a camp here. Defeat its defenders for resources and commander experience. It regroups after ten minutes.',true,'pandaren'),
(1081,'Human · Roman raiders',-6080,-8896,2,'snow',36,24,10,'A roaming warband has built a camp here. Defeat its defenders for resources and commander experience. It regroups after ten minutes.',true,'roman'),
(1082,'Human · Persian raiders',-4928,-9664,2,'highlands',35,36,24,'A roaming warband has built a camp here. Defeat its defenders for resources and commander experience. It regroups after ten minutes.',true,'persian'),
(1083,'Human · Persian outlaws',-4032,-9664,1,'marsh',23,13,0,'A roaming warband has built a camp here. Defeat its defenders for resources and commander experience. It regroups after ten minutes.',true,'persian'),
(1084,'Elves warband',-3520,-9536,3,'marsh',112,26,32,'A roaming warband has built a camp here. Defeat its defenders for resources and commander experience. It regroups after ten minutes.',true,'elf'),
(1085,'Human · Roman outlaws',-1728,-9664,1,'plains',25,7,0,'A roaming warband has built a camp here. Defeat its defenders for resources and commander experience. It regroups after ten minutes.',true,'roman'),
(1086,'Human · Roman outlaws',-1472,-9024,1,'highlands',31,6,0,'A roaming warband has built a camp here. Defeat its defenders for resources and commander experience. It regroups after ten minutes.',true,'roman'),
(1087,'Human · Persian outlaws',-448,-9280,1,'plains',27,11,3,'A roaming warband has built a camp here. Defeat its defenders for resources and commander experience. It regroups after ten minutes.',true,'persian'),
(1088,'Orcs raiders',576,-8896,2,'plains',51,24,3,'A roaming warband has built a camp here. Defeat its defenders for resources and commander experience. It regroups after ten minutes.',true,'orc'),
(1089,'Gnomes raiders',1728,-9664,2,'plains',35,23,11,'A roaming warband has built a camp here. Defeat its defenders for resources and commander experience. It regroups after ten minutes.',true,'gnome'),
(1090,'Elves outlaws',2624,-9280,1,'plains',26,12,4,'A roaming warband has built a camp here. Defeat its defenders for resources and commander experience. It regroups after ten minutes.',true,'elf'),
(1091,'Human · Roman warband',3904,-9152,3,'highlands',115,23,13,'A roaming warband has built a camp here. Defeat its defenders for resources and commander experience. It regroups after ten minutes.',true,'roman'),
(1092,'Dwarves raiders',5184,-9280,2,'highlands',72,16,7,'A roaming warband has built a camp here. Defeat its defenders for resources and commander experience. It regroups after ten minutes.',true,'dwarf'),
(1093,'Human · Roman outlaws',6080,-9664,1,'plains',24,8,1,'A roaming warband has built a camp here. Defeat its defenders for resources and commander experience. It regroups after ten minutes.',true,'roman'),
(1094,'Human · Roman outlaws',6720,-9408,1,'highlands',36,7,4,'A roaming warband has built a camp here. Defeat its defenders for resources and commander experience. It regroups after ten minutes.',true,'roman'),
(1095,'Necropolis outlaws',8256,-8896,1,'highlands',26,11,3,'A roaming warband has built a camp here. Defeat its defenders for resources and commander experience. It regroups after ten minutes.',true,'undead'),
(1096,'Human · Roman raiders',9280,-9664,2,'highlands',49,23,5,'A roaming warband has built a camp here. Defeat its defenders for resources and commander experience. It regroups after ten minutes.',true,'roman'),
(1097,'Demons warband',10048,-9152,3,'highlands',91,44,21,'A roaming warband has built a camp here. Defeat its defenders for resources and commander experience. It regroups after ten minutes.',true,'demon'),
(1098,'Elves warband',11584,-9152,3,'highlands',56,61,48,'A roaming warband has built a camp here. Defeat its defenders for resources and commander experience. It regroups after ten minutes.',true,'elf'),
(1099,'Orcs raiders',12224,-9664,2,'highlands',31,31,23,'A roaming warband has built a camp here. Defeat its defenders for resources and commander experience. It regroups after ten minutes.',true,'orc'),
(1100,'Demons raiders',-12736,-7872,2,'darkland',37,35,20,'A roaming warband has built a camp here. Defeat its defenders for resources and commander experience. It regroups after ten minutes.',true,'demon'),
(1102,'Human · Spartan outlaws',-9920,-8640,1,'woods',31,10,3,'A roaming warband has built a camp here. Defeat its defenders for resources and commander experience. It regroups after ten minutes.',true,'spartan'),
(1103,'Elves raiders',-9152,-8256,2,'plains',52,30,16,'A roaming warband has built a camp here. Defeat its defenders for resources and commander experience. It regroups after ten minutes.',true,'elf'),
(1104,'Human · Persian raiders',-8000,-8128,2,'snow',53,23,1,'A roaming warband has built a camp here. Defeat its defenders for resources and commander experience. It regroups after ten minutes.',true,'persian'),
(1105,'Demons raiders',-7488,-8128,2,'snow',48,33,20,'A roaming warband has built a camp here. Defeat its defenders for resources and commander experience. It regroups after ten minutes.',true,'demon'),
(1106,'Human · Spartan raiders',-6592,-8000,2,'highlands',45,27,6,'A roaming warband has built a camp here. Defeat its defenders for resources and commander experience. It regroups after ten minutes.',true,'spartan'),
(1107,'Human · Egyptian warband',-5056,-8384,3,'plains',84,19,20,'A roaming warband has built a camp here. Defeat its defenders for resources and commander experience. It regroups after ten minutes.',true,'egyptian'),
(1108,'Human · Persian outlaws',-4032,-8640,1,'marsh',31,14,0,'A roaming warband has built a camp here. Defeat its defenders for resources and commander experience. It regroups after ten minutes.',true,'persian'),
(1109,'Pandaren outlaws',-3008,-8000,1,'snow',38,9,0,'A roaming warband has built a camp here. Defeat its defenders for resources and commander experience. It regroups after ten minutes.',true,'pandaren'),
(1110,'Demons outlaws',-1984,-7744,1,'snow',31,10,2,'A roaming warband has built a camp here. Defeat its defenders for resources and commander experience. It regroups after ten minutes.',true,'demon'),
(1111,'Dwarves marauders',-832,-8640,4,'highlands',129,71,2,'A roaming warband has built a camp here. Defeat its defenders for resources and commander experience. It regroups after ten minutes.',true,'dwarf'),
(1112,'Human · Egyptian raiders',192,-8128,2,'highlands',46,22,7,'A roaming warband has built a camp here. Defeat its defenders for resources and commander experience. It regroups after ten minutes.',true,'egyptian'),
(1113,'Demons warband',1088,-8000,3,'snow',73,56,34,'A roaming warband has built a camp here. Defeat its defenders for resources and commander experience. It regroups after ten minutes.',true,'demon'),
(1114,'Human · Persian warband',1600,-7872,3,'highlands',120,24,19,'A roaming warband has built a camp here. Defeat its defenders for resources and commander experience. It regroups after ten minutes.',true,'persian'),
(1115,'Human · Spartan raiders',3392,-8640,2,'marsh',60,18,8,'A roaming warband has built a camp here. Defeat its defenders for resources and commander experience. It regroups after ten minutes.',true,'spartan'),
(1116,'Human · Spartan outlaws',3648,-8000,1,'highlands',26,6,3,'A roaming warband has built a camp here. Defeat its defenders for resources and commander experience. It regroups after ten minutes.',true,'spartan'),
(1117,'Orcs outlaws',4672,-7744,1,'snow',37,9,1,'A roaming warband has built a camp here. Defeat its defenders for resources and commander experience. It regroups after ten minutes.',true,'orc'),
(1118,'Gnomes outlaws',6208,-8256,1,'snow',26,15,1,'A roaming warband has built a camp here. Defeat its defenders for resources and commander experience. It regroups after ten minutes.',true,'gnome'),
(1119,'Pandaren raiders',6848,-8128,2,'snow',61,21,0,'A roaming warband has built a camp here. Defeat its defenders for resources and commander experience. It regroups after ten minutes.',true,'pandaren'),
(1120,'Orcs warband',7872,-8128,3,'snow',100,37,1,'A roaming warband has built a camp here. Defeat its defenders for resources and commander experience. It regroups after ten minutes.',true,'orc'),
(1121,'Human · Persian warband',9024,-8640,3,'snow',78,57,40,'A roaming warband has built a camp here. Defeat its defenders for resources and commander experience. It regroups after ten minutes.',true,'persian'),
(1122,'Human · Egyptian outlaws',10304,-8000,1,'highlands',24,8,2,'A roaming warband has built a camp here. Defeat its defenders for resources and commander experience. It regroups after ten minutes.',true,'egyptian'),
(1123,'Orcs marauders',11328,-8640,4,'highlands',89,93,62,'A roaming warband has built a camp here. Defeat its defenders for resources and commander experience. It regroups after ten minutes.',true,'orc'),
(1124,'Necropolis outlaws',12352,-7744,1,'snow',26,5,3,'A roaming warband has built a camp here. Defeat its defenders for resources and commander experience. It regroups after ten minutes.',true,'undead'),
(1127,'Orcs raiders',-10304,-7104,2,'plains',24,27,19,'A roaming warband has built a camp here. Defeat its defenders for resources and commander experience. It regroups after ten minutes.',true,'orc'),
(1128,'Gnomes warband',-8896,-7616,3,'woods',74,37,17,'A roaming warband has built a camp here. Defeat its defenders for resources and commander experience. It regroups after ten minutes.',true,'gnome'),
(1129,'Demons warband',-7872,-7616,3,'highlands',74,38,39,'A roaming warband has built a camp here. Defeat its defenders for resources and commander experience. It regroups after ten minutes.',true,'demon'),
(1130,'Dwarves warband',-7616,-6720,3,'highlands',94,21,18,'A roaming warband has built a camp here. Defeat its defenders for resources and commander experience. It regroups after ten minutes.',true,'dwarf'),
(1131,'Human · Persian outlaws',-6592,-6720,1,'plains',22,14,2,'A roaming warband has built a camp here. Defeat its defenders for resources and commander experience. It regroups after ten minutes.',true,'persian'),
(1132,'Elves outlaws',-5568,-7488,1,'marsh',26,5,3,'A roaming warband has built a camp here. Defeat its defenders for resources and commander experience. It regroups after ten minutes.',true,'elf'),
(1133,'Gnomes raiders',-4416,-7104,2,'highlands',69,18,10,'A roaming warband has built a camp here. Defeat its defenders for resources and commander experience. It regroups after ten minutes.',true,'gnome'),
(1134,'Dwarves outlaws',-2752,-7104,1,'snow',35,7,2,'A roaming warband has built a camp here. Defeat its defenders for resources and commander experience. It regroups after ten minutes.',true,'dwarf'),
(1135,'Human · Roman raiders',-2368,-7616,2,'snow',56,28,12,'A roaming warband has built a camp here. Defeat its defenders for resources and commander experience. It regroups after ten minutes.',true,'roman'),
(1136,'Elves outlaws',-1472,-7104,1,'snow',28,10,3,'A roaming warband has built a camp here. Defeat its defenders for resources and commander experience. It regroups after ten minutes.',true,'elf'),
(1137,'Demons raiders',-448,-7232,2,'snow',74,23,4,'A roaming warband has built a camp here. Defeat its defenders for resources and commander experience. It regroups after ten minutes.',true,'demon'),
(1138,'Gnomes outlaws',1088,-6720,1,'snow',27,14,1,'A roaming warband has built a camp here. Defeat its defenders for resources and commander experience. It regroups after ten minutes.',true,'gnome'),
(1139,'Necropolis outlaws',2112,-7488,1,'snow',22,13,2,'A roaming warband has built a camp here. Defeat its defenders for resources and commander experience. It regroups after ten minutes.',true,'undead'),
(1140,'Human · Roman outlaws',2624,-7360,1,'snow',25,6,2,'A roaming warband has built a camp here. Defeat its defenders for resources and commander experience. It regroups after ten minutes.',true,'roman'),
(1141,'Necropolis raiders',4160,-7232,2,'plains',51,29,19,'A roaming warband has built a camp here. Defeat its defenders for resources and commander experience. It regroups after ten minutes.',true,'undead'),
(1142,'Elves raiders',5440,-7616,2,'snow',48,19,21,'A roaming warband has built a camp here. Defeat its defenders for resources and commander experience. It regroups after ten minutes.',true,'elf'),
(1143,'Necropolis raiders',6208,-7616,2,'snow',46,17,22,'A roaming warband has built a camp here. Defeat its defenders for resources and commander experience. It regroups after ten minutes.',true,'undead'),
(1144,'Dwarves outlaws',6720,-7104,1,'highlands',26,16,1,'A roaming warband has built a camp here. Defeat its defenders for resources and commander experience. It regroups after ten minutes.',true,'dwarf'),
(1145,'Human · Spartan marauders',7744,-6720,4,'highlands',111,83,77,'A roaming warband has built a camp here. Defeat its defenders for resources and commander experience. It regroups after ten minutes.',true,'spartan'),
(1146,'Human · Egyptian outlaws',8768,-7488,1,'snow',27,13,1,'A roaming warband has built a camp here. Defeat its defenders for resources and commander experience. It regroups after ten minutes.',true,'egyptian'),
(1147,'Human · Egyptian warband',10304,-7488,3,'highlands',117,36,10,'A roaming warband has built a camp here. Defeat its defenders for resources and commander experience. It regroups after ten minutes.',true,'egyptian'),
(1148,'Human · Spartan outlaws',10816,-7616,1,'highlands',29,13,2,'A roaming warband has built a camp here. Defeat its defenders for resources and commander experience. It regroups after ten minutes.',true,'spartan'),
(1149,'Pandaren outlaws',12736,-7104,1,'plains',31,9,0,'A roaming warband has built a camp here. Defeat its defenders for resources and commander experience. It regroups after ten minutes.',true,'pandaren'),
(1150,'Elves raiders',-12736,-5824,2,'plains',49,15,24,'A roaming warband has built a camp here. Defeat its defenders for resources and commander experience. It regroups after ten minutes.',true,'elf'),
(1152,'Human · Roman raiders',-10176,-5696,2,'plains',47,21,21,'A roaming warband has built a camp here. Defeat its defenders for resources and commander experience. It regroups after ten minutes.',true,'roman'),
(1153,'Pandaren outlaws',-9152,-6464,1,'woods',32,13,0,'A roaming warband has built a camp here. Defeat its defenders for resources and commander experience. It regroups after ten minutes.',true,'pandaren'),
(1154,'Orcs raiders',-8128,-5952,2,'woods',52,20,24,'A roaming warband has built a camp here. Defeat its defenders for resources and commander experience. It regroups after ten minutes.',true,'orc'),
(1155,'Orcs raiders',-7360,-6080,2,'woods',51,23,19,'A roaming warband has built a camp here. Defeat its defenders for resources and commander experience. It regroups after ten minutes.',true,'orc'),
(1156,'Orcs raiders',-5824,-6592,2,'marsh',39,27,3,'A roaming warband has built a camp here. Defeat its defenders for resources and commander experience. It regroups after ten minutes.',true,'orc'),
(1157,'Pandaren outlaws',-5056,-6080,1,'darkland',30,10,1,'A roaming warband has built a camp here. Defeat its defenders for resources and commander experience. It regroups after ten minutes.',true,'pandaren'),
(1158,'Pandaren raiders',-3648,-6080,2,'plains',46,17,23,'A roaming warband has built a camp here. Defeat its defenders for resources and commander experience. It regroups after ten minutes.',true,'pandaren'),
(1159,'Pandaren outlaws',-3520,-6464,1,'highlands',28,13,3,'A roaming warband has built a camp here. Defeat its defenders for resources and commander experience. It regroups after ten minutes.',true,'pandaren'),
(1160,'Human · Persian marauders',-2496,-6464,4,'highlands',103,51,39,'A roaming warband has built a camp here. Defeat its defenders for resources and commander experience. It regroups after ten minutes.',true,'persian'),
(1161,'Orcs outlaws',-1472,-6208,1,'snow',31,13,0,'A roaming warband has built a camp here. Defeat its defenders for resources and commander experience. It regroups after ten minutes.',true,'orc'),
(1162,'Elves warband',64,-6464,3,'snow',65,41,41,'A roaming warband has built a camp here. Defeat its defenders for resources and commander experience. It regroups after ten minutes.',true,'elf'),
(1163,'Pandaren raiders',704,-6592,2,'snow',31,27,19,'A roaming warband has built a camp here. Defeat its defenders for resources and commander experience. It regroups after ten minutes.',true,'pandaren'),
(1164,'Human · Roman marauders',1600,-6208,4,'snow',90,61,62,'A roaming warband has built a camp here. Defeat its defenders for resources and commander experience. It regroups after ten minutes.',true,'roman'),
(1165,'Human · Persian raiders',3008,-6080,2,'snow',62,15,16,'A roaming warband has built a camp here. Defeat its defenders for resources and commander experience. It regroups after ten minutes.',true,'persian'),
(1166,'Human · Roman raiders',4544,-6080,2,'snow',60,22,3,'A roaming warband has built a camp here. Defeat its defenders for resources and commander experience. It regroups after ten minutes.',true,'roman'),
(1167,'Dwarves warband',5184,-6464,3,'marsh',89,31,14,'A roaming warband has built a camp here. Defeat its defenders for resources and commander experience. It regroups after ten minutes.',true,'dwarf'),
(1168,'Necropolis outlaws',6208,-6208,1,'highlands',33,12,3,'A roaming warband has built a camp here. Defeat its defenders for resources and commander experience. It regroups after ten minutes.',true,'undead'),
(1169,'Pandaren raiders',6720,-6464,2,'plains',39,22,11,'A roaming warband has built a camp here. Defeat its defenders for resources and commander experience. It regroups after ten minutes.',true,'pandaren'),
(1170,'Human · Roman outlaws',8256,-5952,1,'woods',31,12,0,'A roaming warband has built a camp here. Defeat its defenders for resources and commander experience. It regroups after ten minutes.',true,'roman'),
(1171,'Pandaren raiders',9280,-6464,2,'highlands',70,26,5,'A roaming warband has built a camp here. Defeat its defenders for resources and commander experience. It regroups after ten minutes.',true,'pandaren'),
(1172,'Gnomes raiders',10560,-6080,2,'highlands',55,38,8,'A roaming warband has built a camp here. Defeat its defenders for resources and commander experience. It regroups after ten minutes.',true,'gnome'),
(1173,'Gnomes warband',11456,-6592,3,'highlands',93,24,40,'A roaming warband has built a camp here. Defeat its defenders for resources and commander experience. It regroups after ten minutes.',true,'gnome'),
(1174,'Human · Roman warband',11840,-6592,3,'highlands',118,29,1,'A roaming warband has built a camp here. Defeat its defenders for resources and commander experience. It regroups after ten minutes.',true,'roman'),
(1175,'Human · Persian marauders',-12736,-5184,4,'plains',138,48,26,'A roaming warband has built a camp here. Defeat its defenders for resources and commander experience. It regroups after ten minutes.',true,'persian'),
(1176,'Pandaren raiders',-11712,-4928,2,'plains',39,32,23,'A roaming warband has built a camp here. Defeat its defenders for resources and commander experience. It regroups after ten minutes.',true,'pandaren'),
(1177,'Human · Persian warband',-10048,-5056,3,'woods',103,54,3,'A roaming warband has built a camp here. Defeat its defenders for resources and commander experience. It regroups after ten minutes.',true,'persian'),
(1178,'Human · Persian raiders',-9152,-4800,2,'woods',42,24,6,'A roaming warband has built a camp here. Defeat its defenders for resources and commander experience. It regroups after ten minutes.',true,'persian'),
(1179,'Human · Roman raiders',-8384,-5056,2,'woods',28,26,21,'A roaming warband has built a camp here. Defeat its defenders for resources and commander experience. It regroups after ten minutes.',true,'roman'),
(1180,'Demons marauders',-7360,-5056,4,'plains',132,78,14,'A roaming warband has built a camp here. Defeat its defenders for resources and commander experience. It regroups after ten minutes.',true,'demon'),
(1181,'Elves warband',-6208,-5568,3,'plains',102,25,34,'A roaming warband has built a camp here. Defeat its defenders for resources and commander experience. It regroups after ten minutes.',true,'elf'),
(1182,'Gnomes warband',-5056,-5184,3,'plains',115,27,4,'A roaming warband has built a camp here. Defeat its defenders for resources and commander experience. It regroups after ten minutes.',true,'gnome'),
(1183,'Human · Spartan outlaws',-3648,-5568,1,'plains',23,14,3,'A roaming warband has built a camp here. Defeat its defenders for resources and commander experience. It regroups after ten minutes.',true,'spartan'),
(1184,'Demons outlaws',-3008,-5056,1,'desert',29,15,4,'A roaming warband has built a camp here. Defeat its defenders for resources and commander experience. It regroups after ten minutes.',true,'demon'),
(1185,'Human · Persian warband',-1856,-5056,3,'highlands',107,35,25,'A roaming warband has built a camp here. Defeat its defenders for resources and commander experience. It regroups after ten minutes.',true,'persian'),
(1186,'Elves raiders',-704,-5056,2,'plains',42,25,15,'A roaming warband has built a camp here. Defeat its defenders for resources and commander experience. It regroups after ten minutes.',true,'elf'),
(1187,'Human · Spartan warband',192,-5056,3,'plains',46,45,29,'A roaming warband has built a camp here. Defeat its defenders for resources and commander experience. It regroups after ten minutes.',true,'spartan'),
(1188,'Demons raiders',1472,-5568,2,'snow',51,37,11,'A roaming warband has built a camp here. Defeat its defenders for resources and commander experience. It regroups after ten minutes.',true,'demon'),
(1189,'Pandaren marauders',2240,-5568,4,'snow',108,108,58,'A roaming warband has built a camp here. Defeat its defenders for resources and commander experience. It regroups after ten minutes.',true,'pandaren'),
(1190,'Human · Egyptian marauders',2624,-4928,4,'highlands',178,43,10,'A roaming warband has built a camp here. Defeat its defenders for resources and commander experience. It regroups after ten minutes.',true,'egyptian'),
(1191,'Human · Spartan outlaws',4160,-5568,1,'highlands',22,16,3,'A roaming warband has built a camp here. Defeat its defenders for resources and commander experience. It regroups after ten minutes.',true,'spartan'),
(1192,'Gnomes warband',4672,-4800,3,'woods',63,32,30,'A roaming warband has built a camp here. Defeat its defenders for resources and commander experience. It regroups after ten minutes.',true,'gnome'),
(1193,'Human · Egyptian outlaws',6336,-5056,1,'desert',28,15,4,'A roaming warband has built a camp here. Defeat its defenders for resources and commander experience. It regroups after ten minutes.',true,'egyptian'),
(1194,'Orcs raiders',7360,-5568,2,'woods',65,20,16,'A roaming warband has built a camp here. Defeat its defenders for resources and commander experience. It regroups after ten minutes.',true,'orc'),
(1195,'Human · Egyptian raiders',8128,-5568,2,'woods',48,24,1,'A roaming warband has built a camp here. Defeat its defenders for resources and commander experience. It regroups after ten minutes.',true,'egyptian'),
(1196,'Dwarves warband',9280,-5312,3,'highlands',87,63,23,'A roaming warband has built a camp here. Defeat its defenders for resources and commander experience. It regroups after ten minutes.',true,'dwarf'),
(1197,'Pandaren warband',10304,-4928,3,'highlands',96,23,39,'A roaming warband has built a camp here. Defeat its defenders for resources and commander experience. It regroups after ten minutes.',true,'pandaren'),
(1198,'Orcs outlaws',11712,-5568,1,'plains',29,5,1,'A roaming warband has built a camp here. Defeat its defenders for resources and commander experience. It regroups after ten minutes.',true,'orc'),
(1199,'Human · Roman outlaws',12352,-5568,1,'plains',27,8,1,'A roaming warband has built a camp here. Defeat its defenders for resources and commander experience. It regroups after ten minutes.',true,'roman'),
(1200,'Elves outlaws',-11840,-4544,1,'plains',28,9,0,'A roaming warband has built a camp here. Defeat its defenders for resources and commander experience. It regroups after ten minutes.',true,'elf'),
(1201,'Dwarves raiders',-11200,-4160,2,'plains',66,14,0,'A roaming warband has built a camp here. Defeat its defenders for resources and commander experience. It regroups after ten minutes.',true,'dwarf'),
(1202,'Pandaren raiders',-9792,-4544,2,'woods',39,24,17,'A roaming warband has built a camp here. Defeat its defenders for resources and commander experience. It regroups after ten minutes.',true,'pandaren'),
(1203,'Human · Spartan outlaws',-9664,-3904,1,'highlands',27,5,1,'A roaming warband has built a camp here. Defeat its defenders for resources and commander experience. It regroups after ten minutes.',true,'spartan'),
(1204,'Human · Persian warband',-8640,-4032,3,'highlands',84,62,25,'A roaming warband has built a camp here. Defeat its defenders for resources and commander experience. It regroups after ten minutes.',true,'persian'),
(1205,'Necropolis outlaws',-7104,-3648,1,'woods',20,13,1,'A roaming warband has built a camp here. Defeat its defenders for resources and commander experience. It regroups after ten minutes.',true,'undead'),
(1206,'Human · Egyptian outlaws',-6080,-4544,1,'marsh',27,7,2,'A roaming warband has built a camp here. Defeat its defenders for resources and commander experience. It regroups after ten minutes.',true,'egyptian'),
(1207,'Gnomes outlaws',-5568,-4416,1,'plains',21,11,2,'A roaming warband has built a camp here. Defeat its defenders for resources and commander experience. It regroups after ten minutes.',true,'gnome'),
(1208,'Necropolis outlaws',-4544,-4288,1,'highlands',25,6,2,'A roaming warband has built a camp here. Defeat its defenders for resources and commander experience. It regroups after ten minutes.',true,'undead'),
(1209,'Human · Persian raiders',-3136,-4544,2,'desert',55,23,10,'A roaming warband has built a camp here. Defeat its defenders for resources and commander experience. It regroups after ten minutes.',true,'persian'),
(1210,'Human · Egyptian raiders',-2112,-4032,2,'desert',56,20,19,'A roaming warband has built a camp here. Defeat its defenders for resources and commander experience. It regroups after ten minutes.',true,'egyptian'),
(1211,'Gnomes warband',-960,-4032,3,'highlands',78,41,6,'A roaming warband has built a camp here. Defeat its defenders for resources and commander experience. It regroups after ten minutes.',true,'gnome'),
(1212,'Gnomes raiders',64,-4288,2,'plains',60,32,8,'A roaming warband has built a camp here. Defeat its defenders for resources and commander experience. It regroups after ten minutes.',true,'gnome'),
(1213,'Dwarves marauders',576,-3648,4,'plains',201,64,18,'A roaming warband has built a camp here. Defeat its defenders for resources and commander experience. It regroups after ten minutes.',true,'dwarf'),
(1214,'Human · Egyptian outlaws',1856,-4544,1,'plains',27,8,2,'A roaming warband has built a camp here. Defeat its defenders for resources and commander experience. It regroups after ten minutes.',true,'egyptian'),
(1215,'Gnomes outlaws',2624,-4416,1,'plains',29,7,0,'A roaming warband has built a camp here. Defeat its defenders for resources and commander experience. It regroups after ten minutes.',true,'gnome'),
(1216,'Pandaren outlaws',3648,-4288,1,'highlands',22,12,1,'A roaming warband has built a camp here. Defeat its defenders for resources and commander experience. It regroups after ten minutes.',true,'pandaren'),
(1217,'Dwarves raiders',5440,-4032,2,'marsh',58,20,6,'A roaming warband has built a camp here. Defeat its defenders for resources and commander experience. It regroups after ten minutes.',true,'dwarf'),
(1218,'Necropolis raiders',5952,-4032,2,'highlands',72,16,7,'A roaming warband has built a camp here. Defeat its defenders for resources and commander experience. It regroups after ten minutes.',true,'undead'),
(1219,'Human · Egyptian warband',6720,-3776,3,'highlands',76,39,8,'A roaming warband has built a camp here. Defeat its defenders for resources and commander experience. It regroups after ten minutes.',true,'egyptian'),
(1220,'Necropolis marauders',8256,-4160,4,'highlands',114,87,27,'A roaming warband has built a camp here. Defeat its defenders for resources and commander experience. It regroups after ten minutes.',true,'undead'),
(1221,'Elves marauders',9408,-4544,4,'woods',124,49,19,'A roaming warband has built a camp here. Defeat its defenders for resources and commander experience. It regroups after ten minutes.',true,'elf'),
(1222,'Orcs raiders',10048,-4544,2,'plains',50,34,13,'A roaming warband has built a camp here. Defeat its defenders for resources and commander experience. It regroups after ten minutes.',true,'orc'),
(1223,'Human · Roman outlaws',10816,-4288,1,'plains',32,11,1,'A roaming warband has built a camp here. Defeat its defenders for resources and commander experience. It regroups after ten minutes.',true,'roman'),
(1224,'Elves marauders',12352,-4544,4,'darkland',152,45,42,'A roaming warband has built a camp here. Defeat its defenders for resources and commander experience. It regroups after ten minutes.',true,'elf'),
(1225,'Elves raiders',-12224,-3136,2,'plains',42,24,15,'A roaming warband has built a camp here. Defeat its defenders for resources and commander experience. It regroups after ten minutes.',true,'elf'),
(1226,'Gnomes warband',-11200,-2752,3,'woods',60,39,37,'A roaming warband has built a camp here. Defeat its defenders for resources and commander experience. It regroups after ten minutes.',true,'gnome'),
(1227,'Demons warband',-10048,-3520,3,'highlands',73,38,10,'A roaming warband has built a camp here. Defeat its defenders for resources and commander experience. It regroups after ten minutes.',true,'demon'),
(1228,'Pandaren warband',-9664,-2624,3,'woods',70,46,45,'A roaming warband has built a camp here. Defeat its defenders for resources and commander experience. It regroups after ten minutes.',true,'pandaren'),
(1229,'Elves warband',-8384,-3520,3,'woods',72,35,17,'A roaming warband has built a camp here. Defeat its defenders for resources and commander experience. It regroups after ten minutes.',true,'elf'),
(1230,'Demons outlaws',-7232,-3008,1,'woods',37,9,0,'A roaming warband has built a camp here. Defeat its defenders for resources and commander experience. It regroups after ten minutes.',true,'demon'),
(1231,'Necropolis raiders',-6592,-3392,2,'woods',44,17,24,'A roaming warband has built a camp here. Defeat its defenders for resources and commander experience. It regroups after ten minutes.',true,'undead'),
(1232,'Demons raiders',-5568,-3008,2,'highlands',68,20,5,'A roaming warband has built a camp here. Defeat its defenders for resources and commander experience. It regroups after ten minutes.',true,'demon'),
(1233,'Human · Spartan raiders',-4544,-2752,2,'plains',49,21,15,'A roaming warband has built a camp here. Defeat its defenders for resources and commander experience. It regroups after ten minutes.',true,'spartan'),
(1234,'Human · Egyptian warband',-3392,-3520,3,'highlands',58,37,39,'A roaming warband has built a camp here. Defeat its defenders for resources and commander experience. It regroups after ten minutes.',true,'egyptian'),
(1235,'Demons raiders',-1984,-2624,2,'highlands',42,25,13,'A roaming warband has built a camp here. Defeat its defenders for resources and commander experience. It regroups after ten minutes.',true,'demon'),
(1236,'Pandaren warband',-704,-3520,3,'plains',110,51,3,'A roaming warband has built a camp here. Defeat its defenders for resources and commander experience. It regroups after ten minutes.',true,'pandaren'),
(1237,'Dwarves warband',-448,-2880,3,'woods',87,34,16,'A roaming warband has built a camp here. Defeat its defenders for resources and commander experience. It regroups after ten minutes.',true,'dwarf'),
(1238,'Human · Spartan warband',1088,-2880,3,'woods',99,35,6,'A roaming warband has built a camp here. Defeat its defenders for resources and commander experience. It regroups after ten minutes.',true,'spartan'),
(1239,'Orcs raiders',1984,-3008,2,'plains',57,18,26,'A roaming warband has built a camp here. Defeat its defenders for resources and commander experience. It regroups after ten minutes.',true,'orc'),
(1240,'Dwarves raiders',3136,-2752,2,'plains',66,19,7,'A roaming warband has built a camp here. Defeat its defenders for resources and commander experience. It regroups after ten minutes.',true,'dwarf'),
(1241,'Pandaren warband',4288,-3520,3,'plains',84,36,28,'A roaming warband has built a camp here. Defeat its defenders for resources and commander experience. It regroups after ten minutes.',true,'pandaren'),
(1242,'Human · Roman warband',4800,-3008,3,'plains',73,35,21,'A roaming warband has built a camp here. Defeat its defenders for resources and commander experience. It regroups after ten minutes.',true,'roman'),
(1243,'Demons raiders',6208,-3008,2,'highlands',64,21,8,'A roaming warband has built a camp here. Defeat its defenders for resources and commander experience. It regroups after ten minutes.',true,'demon'),
(1244,'Gnomes warband',7104,-3520,3,'highlands',101,58,9,'A roaming warband has built a camp here. Defeat its defenders for resources and commander experience. It regroups after ten minutes.',true,'gnome'),
(1245,'Orcs warband',8256,-3392,3,'marsh',59,45,27,'A roaming warband has built a camp here. Defeat its defenders for resources and commander experience. It regroups after ten minutes.',true,'orc'),
(1246,'Pandaren raiders',9664,-3008,2,'plains',34,29,12,'A roaming warband has built a camp here. Defeat its defenders for resources and commander experience. It regroups after ten minutes.',true,'pandaren'),
(1247,'Demons warband',10688,-3520,3,'plains',92,32,40,'A roaming warband has built a camp here. Defeat its defenders for resources and commander experience. It regroups after ten minutes.',true,'demon'),
(1248,'Human · Egyptian raiders',11584,-3008,2,'woods',64,17,3,'A roaming warband has built a camp here. Defeat its defenders for resources and commander experience. It regroups after ten minutes.',true,'egyptian'),
(1250,'Human · Spartan raiders',-12224,-1600,2,'plains',40,26,5,'A roaming warband has built a camp here. Defeat its defenders for resources and commander experience. It regroups after ten minutes.',true,'spartan'),
(1251,'Elves warband',-10816,-1984,3,'plains',103,63,1,'A roaming warband has built a camp here. Defeat its defenders for resources and commander experience. It regroups after ten minutes.',true,'elf'),
(1252,'Gnomes warband',-10688,-2368,3,'plains',92,64,15,'A roaming warband has built a camp here. Defeat its defenders for resources and commander experience. It regroups after ten minutes.',true,'gnome'),
(1253,'Demons raiders',-9152,-1728,2,'woods',59,15,15,'A roaming warband has built a camp here. Defeat its defenders for resources and commander experience. It regroups after ten minutes.',true,'demon'),
(1254,'Orcs raiders',-8128,-1728,2,'woods',32,29,13,'A roaming warband has built a camp here. Defeat its defenders for resources and commander experience. It regroups after ten minutes.',true,'orc'),
(1255,'Gnomes raiders',-7104,-2496,2,'highlands',53,17,29,'A roaming warband has built a camp here. Defeat its defenders for resources and commander experience. It regroups after ten minutes.',true,'gnome'),
(1256,'Human · Egyptian marauders',-6336,-1984,4,'highlands',203,52,24,'A roaming warband has built a camp here. Defeat its defenders for resources and commander experience. It regroups after ten minutes.',true,'egyptian'),
(1257,'Human · Roman warband',-4928,-1984,3,'woods',79,33,32,'A roaming warband has built a camp here. Defeat its defenders for resources and commander experience. It regroups after ten minutes.',true,'roman'),
(1258,'Elves raiders',-4160,-2496,2,'highlands',57,35,1,'A roaming warband has built a camp here. Defeat its defenders for resources and commander experience. It regroups after ten minutes.',true,'elf'),
(1259,'Necropolis raiders',-3136,-2496,2,'highlands',50,13,23,'A roaming warband has built a camp here. Defeat its defenders for resources and commander experience. It regroups after ten minutes.',true,'undead'),
(1260,'Orcs outlaws',-1600,-2496,1,'woods',31,6,3,'A roaming warband has built a camp here. Defeat its defenders for resources and commander experience. It regroups after ten minutes.',true,'orc'),
(1261,'Necropolis raiders',-1472,-1728,2,'plains',45,29,7,'A roaming warband has built a camp here. Defeat its defenders for resources and commander experience. It regroups after ten minutes.',true,'undead'),
(1262,'Human · Roman raiders',-448,-2496,2,'woods',31,28,14,'A roaming warband has built a camp here. Defeat its defenders for resources and commander experience. It regroups after ten minutes.',true,'roman'),
(1263,'Necropolis outlaws',832,-1984,1,'woods',25,5,3,'A roaming warband has built a camp here. Defeat its defenders for resources and commander experience. It regroups after ten minutes.',true,'undead'),
(1264,'Elves warband',1728,-1984,3,'woods',107,31,20,'A roaming warband has built a camp here. Defeat its defenders for resources and commander experience. It regroups after ten minutes.',true,'elf'),
(1265,'Pandaren outlaws',2624,-2496,1,'woods',36,8,1,'A roaming warband has built a camp here. Defeat its defenders for resources and commander experience. It regroups after ten minutes.',true,'pandaren'),
(1266,'Human · Spartan raiders',4544,-2496,2,'plains',51,13,11,'A roaming warband has built a camp here. Defeat its defenders for resources and commander experience. It regroups after ten minutes.',true,'spartan'),
(1267,'Dwarves outlaws',5440,-1984,1,'woods',19,12,2,'A roaming warband has built a camp here. Defeat its defenders for resources and commander experience. It regroups after ten minutes.',true,'dwarf'),
(1268,'Demons outlaws',6208,-1856,1,'plains',24,14,3,'A roaming warband has built a camp here. Defeat its defenders for resources and commander experience. It regroups after ten minutes.',true,'demon'),
(1269,'Elves raiders',7232,-2496,2,'woods',44,28,8,'A roaming warband has built a camp here. Defeat its defenders for resources and commander experience. It regroups after ten minutes.',true,'elf'),
(1270,'Human · Spartan marauders',8384,-1984,4,'plains',166,51,45,'A roaming warband has built a camp here. Defeat its defenders for resources and commander experience. It regroups after ten minutes.',true,'spartan'),
(1271,'Demons raiders',9408,-1984,2,'plains',79,15,3,'A roaming warband has built a camp here. Defeat its defenders for resources and commander experience. It regroups after ten minutes.',true,'demon'),
(1272,'Elves outlaws',10304,-2368,1,'plains',30,12,0,'A roaming warband has built a camp here. Defeat its defenders for resources and commander experience. It regroups after ten minutes.',true,'elf'),
(1273,'Human · Persian raiders',10816,-2112,2,'plains',58,32,9,'A roaming warband has built a camp here. Defeat its defenders for resources and commander experience. It regroups after ten minutes.',true,'persian'),
(1275,'Gnomes outlaws',-11968,-960,1,'plains',25,8,1,'A roaming warband has built a camp here. Defeat its defenders for resources and commander experience. It regroups after ten minutes.',true,'gnome'),
(1276,'Demons outlaws',-11712,-576,1,'plains',29,12,0,'A roaming warband has built a camp here. Defeat its defenders for resources and commander experience. It regroups after ten minutes.',true,'demon'),
(1277,'Human · Spartan raiders',-10688,-1216,2,'woods',43,27,9,'A roaming warband has built a camp here. Defeat its defenders for resources and commander experience. It regroups after ten minutes.',true,'spartan'),
(1278,'Human · Egyptian raiders',-9536,-960,2,'woods',29,26,16,'A roaming warband has built a camp here. Defeat its defenders for resources and commander experience. It regroups after ten minutes.',true,'egyptian'),
(1279,'Necropolis outlaws',-8128,-832,1,'woods',27,8,0,'A roaming warband has built a camp here. Defeat its defenders for resources and commander experience. It regroups after ten minutes.',true,'undead'),
(1280,'Dwarves outlaws',-7104,-1344,1,'woods',36,6,2,'A roaming warband has built a camp here. Defeat its defenders for resources and commander experience. It regroups after ten minutes.',true,'dwarf'),
(1281,'Human · Egyptian outlaws',-5696,-1472,1,'highlands',35,11,1,'A roaming warband has built a camp here. Defeat its defenders for resources and commander experience. It regroups after ten minutes.',true,'egyptian'),
(1282,'Human · Egyptian raiders',-5568,-1088,2,'woods',40,35,19,'A roaming warband has built a camp here. Defeat its defenders for resources and commander experience. It regroups after ten minutes.',true,'egyptian'),
(1283,'Orcs outlaws',-4032,-576,1,'plains',30,12,3,'A roaming warband has built a camp here. Defeat its defenders for resources and commander experience. It regroups after ten minutes.',true,'orc'),
(1284,'Dwarves raiders',-3008,-1216,2,'desert',58,27,2,'A roaming warband has built a camp here. Defeat its defenders for resources and commander experience. It regroups after ten minutes.',true,'dwarf'),
(1285,'Pandaren raiders',-1856,-960,2,'desert',42,26,10,'A roaming warband has built a camp here. Defeat its defenders for resources and commander experience. It regroups after ten minutes.',true,'pandaren'),
(1286,'Necropolis raiders',-1472,-576,2,'plains',42,29,25,'A roaming warband has built a camp here. Defeat its defenders for resources and commander experience. It regroups after ten minutes.',true,'undead'),
(1287,'Human · Persian warband',320,-1472,3,'highlands',132,25,11,'A roaming warband has built a camp here. Defeat its defenders for resources and commander experience. It regroups after ten minutes.',true,'persian'),
(1288,'Dwarves raiders',1088,-1344,2,'plains',71,26,0,'A roaming warband has built a camp here. Defeat its defenders for resources and commander experience. It regroups after ten minutes.',true,'dwarf'),
(1289,'Human · Egyptian outlaws',2112,-1472,1,'plains',35,12,1,'A roaming warband has built a camp here. Defeat its defenders for resources and commander experience. It regroups after ten minutes.',true,'egyptian'),
(1290,'Pandaren outlaws',2624,-576,1,'highlands',24,8,1,'A roaming warband has built a camp here. Defeat its defenders for resources and commander experience. It regroups after ten minutes.',true,'pandaren'),
(1291,'Human · Roman outlaws',3648,-1344,1,'highlands',29,12,3,'A roaming warband has built a camp here. Defeat its defenders for resources and commander experience. It regroups after ten minutes.',true,'roman'),
(1292,'Human · Persian raiders',4800,-960,2,'plains',57,26,3,'A roaming warband has built a camp here. Defeat its defenders for resources and commander experience. It regroups after ten minutes.',true,'persian'),
(1293,'Human · Persian warband',6080,-960,3,'highlands',90,43,19,'A roaming warband has built a camp here. Defeat its defenders for resources and commander experience. It regroups after ten minutes.',true,'persian'),
(1294,'Gnomes warband',6976,-1472,3,'plains',45,44,32,'A roaming warband has built a camp here. Defeat its defenders for resources and commander experience. It regroups after ten minutes.',true,'gnome'),
(1295,'Elves outlaws',8000,-960,1,'plains',21,15,2,'A roaming warband has built a camp here. Defeat its defenders for resources and commander experience. It regroups after ten minutes.',true,'elf'),
(1296,'Elves outlaws',8768,-576,1,'plains',27,12,4,'A roaming warband has built a camp here. Defeat its defenders for resources and commander experience. It regroups after ten minutes.',true,'elf'),
(1297,'Elves warband',9792,-960,3,'plains',115,24,10,'A roaming warband has built a camp here. Defeat its defenders for resources and commander experience. It regroups after ten minutes.',true,'elf'),
(1298,'Elves outlaws',11328,-1344,1,'plains',24,7,1,'A roaming warband has built a camp here. Defeat its defenders for resources and commander experience. It regroups after ten minutes.',true,'elf'),
(1299,'Gnomes raiders',12480,-960,2,'plains',46,25,23,'A roaming warband has built a camp here. Defeat its defenders for resources and commander experience. It regroups after ten minutes.',true,'gnome'),
(1300,'Elves raiders',-11968,64,2,'highlands',52,23,0,'A roaming warband has built a camp here. Defeat its defenders for resources and commander experience. It regroups after ten minutes.',true,'elf'),
(1301,'Human · Roman raiders',-10944,-448,2,'plains',38,25,13,'A roaming warband has built a camp here. Defeat its defenders for resources and commander experience. It regroups after ten minutes.',true,'roman'),
(1302,'Pandaren outlaws',-10688,64,1,'plains',22,9,2,'A roaming warband has built a camp here. Defeat its defenders for resources and commander experience. It regroups after ten minutes.',true,'pandaren'),
(1303,'Pandaren outlaws',-9152,64,1,'desert',36,6,3,'A roaming warband has built a camp here. Defeat its defenders for resources and commander experience. It regroups after ten minutes.',true,'pandaren'),
(1304,'Elves outlaws',-8000,-448,1,'woods',30,14,0,'A roaming warband has built a camp here. Defeat its defenders for resources and commander experience. It regroups after ten minutes.',true,'elf'),
(1305,'Necropolis outlaws',-7616,-320,1,'woods',29,7,0,'A roaming warband has built a camp here. Defeat its defenders for resources and commander experience. It regroups after ten minutes.',true,'undead'),
(1306,'Human · Spartan outlaws',-6592,-64,1,'highlands',35,11,2,'A roaming warband has built a camp here. Defeat its defenders for resources and commander experience. It regroups after ten minutes.',true,'spartan'),
(1307,'Necropolis warband',-5568,-192,3,'woods',79,50,13,'A roaming warband has built a camp here. Defeat its defenders for resources and commander experience. It regroups after ten minutes.',true,'undead'),
(1308,'Elves raiders',-4032,64,2,'desert',48,26,3,'A roaming warband has built a camp here. Defeat its defenders for resources and commander experience. It regroups after ten minutes.',true,'elf'),
(1309,'Orcs raiders',-3520,-64,2,'desert',32,31,25,'A roaming warband has built a camp here. Defeat its defenders for resources and commander experience. It regroups after ten minutes.',true,'orc'),
(1310,'Demons warband',-2112,64,3,'woods',114,63,1,'A roaming warband has built a camp here. Defeat its defenders for resources and commander experience. It regroups after ten minutes.',true,'demon'),
(1311,'Gnomes marauders',-1472,448,4,'woods',102,81,48,'A roaming warband has built a camp here. Defeat its defenders for resources and commander experience. It regroups after ten minutes.',true,'gnome'),
(1312,'Human · Egyptian outlaws',64,-320,1,'highlands',30,6,3,'A roaming warband has built a camp here. Defeat its defenders for resources and commander experience. It regroups after ten minutes.',true,'egyptian'),
(1313,'Human · Persian outlaws',1088,-192,1,'highlands',21,12,2,'A roaming warband has built a camp here. Defeat its defenders for resources and commander experience. It regroups after ten minutes.',true,'persian'),
(1314,'Human · Persian warband',2112,320,3,'highlands',95,40,9,'A roaming warband has built a camp here. Defeat its defenders for resources and commander experience. It regroups after ten minutes.',true,'persian'),
(1315,'Demons raiders',3264,-448,2,'highlands',43,23,25,'A roaming warband has built a camp here. Defeat its defenders for resources and commander experience. It regroups after ten minutes.',true,'demon'),
(1316,'Human · Egyptian warband',4032,64,3,'plains',73,43,20,'A roaming warband has built a camp here. Defeat its defenders for resources and commander experience. It regroups after ten minutes.',true,'egyptian'),
(1317,'Human · Egyptian warband',5568,64,3,'woods',62,42,27,'A roaming warband has built a camp here. Defeat its defenders for resources and commander experience. It regroups after ten minutes.',true,'egyptian'),
(1318,'Demons warband',6208,448,3,'plains',67,47,11,'A roaming warband has built a camp here. Defeat its defenders for resources and commander experience. It regroups after ten minutes.',true,'demon'),
(1319,'Pandaren outlaws',6720,-320,1,'plains',26,16,1,'A roaming warband has built a camp here. Defeat its defenders for resources and commander experience. It regroups after ten minutes.',true,'pandaren'),
(1320,'Demons outlaws',7744,-64,1,'plains',30,6,3,'A roaming warband has built a camp here. Defeat its defenders for resources and commander experience. It regroups after ten minutes.',true,'demon'),
(1321,'Human · Roman marauders',9280,448,4,'plains',148,65,68,'A roaming warband has built a camp here. Defeat its defenders for resources and commander experience. It regroups after ten minutes.',true,'roman'),
(1322,'Orcs raiders',9920,-448,2,'plains',59,22,18,'A roaming warband has built a camp here. Defeat its defenders for resources and commander experience. It regroups after ten minutes.',true,'orc'),
(1323,'Gnomes raiders',11328,64,2,'plains',36,40,26,'A roaming warband has built a camp here. Defeat its defenders for resources and commander experience. It regroups after ten minutes.',true,'gnome'),
(1324,'Pandaren warband',12096,64,3,'highlands',87,41,16,'A roaming warband has built a camp here. Defeat its defenders for resources and commander experience. It regroups after ten minutes.',true,'pandaren'),
(1325,'Demons outlaws',-11968,576,1,'plains',28,17,3,'A roaming warband has built a camp here. Defeat its defenders for resources and commander experience. It regroups after ten minutes.',true,'demon'),
(1326,'Orcs outlaws',-11584,576,1,'plains',21,11,1,'A roaming warband has built a camp here. Defeat its defenders for resources and commander experience. It regroups after ten minutes.',true,'orc'),
(1327,'Orcs outlaws',-10176,960,1,'plains',25,15,2,'A roaming warband has built a camp here. Defeat its defenders for resources and commander experience. It regroups after ten minutes.',true,'orc'),
(1328,'Orcs outlaws',-9152,704,1,'woods',37,7,2,'A roaming warband has built a camp here. Defeat its defenders for resources and commander experience. It regroups after ten minutes.',true,'orc'),
(1329,'Pandaren raiders',-8000,576,2,'plains',54,13,6,'A roaming warband has built a camp here. Defeat its defenders for resources and commander experience. It regroups after ten minutes.',true,'pandaren'),
(1330,'Necropolis outlaws',-7616,1088,1,'highlands',34,7,2,'A roaming warband has built a camp here. Defeat its defenders for resources and commander experience. It regroups after ten minutes.',true,'undead'),
(1331,'Human · Persian raiders',-5824,1088,2,'desert',66,22,1,'A roaming warband has built a camp here. Defeat its defenders for resources and commander experience. It regroups after ten minutes.',true,'persian'),
(1332,'Orcs outlaws',-5184,1088,1,'woods',27,12,1,'A roaming warband has built a camp here. Defeat its defenders for resources and commander experience. It regroups after ten minutes.',true,'orc'),
(1333,'Human · Spartan raiders',-4032,1472,2,'woods',78,18,0,'A roaming warband has built a camp here. Defeat its defenders for resources and commander experience. It regroups after ten minutes.',true,'spartan'),
(1334,'Necropolis outlaws',-3520,960,1,'plains',31,15,0,'A roaming warband has built a camp here. Defeat its defenders for resources and commander experience. It regroups after ten minutes.',true,'undead'),
(1335,'Human · Roman outlaws',-2496,1216,1,'woods',25,15,2,'A roaming warband has built a camp here. Defeat its defenders for resources and commander experience. It regroups after ten minutes.',true,'roman'),
(1336,'Dwarves outlaws',-960,832,1,'plains',21,10,2,'A roaming warband has built a camp here. Defeat its defenders for resources and commander experience. It regroups after ten minutes.',true,'dwarf'),
(1337,'Human · Egyptian outlaws',-448,704,1,'plains',24,7,2,'A roaming warband has built a camp here. Defeat its defenders for resources and commander experience. It regroups after ten minutes.',true,'egyptian'),
(1338,'Gnomes raiders',832,1088,2,'plains',56,20,21,'A roaming warband has built a camp here. Defeat its defenders for resources and commander experience. It regroups after ten minutes.',true,'gnome'),
(1339,'Human · Spartan outlaws',2112,960,1,'highlands',26,6,2,'A roaming warband has built a camp here. Defeat its defenders for resources and commander experience. It regroups after ten minutes.',true,'spartan'),
(1340,'Human · Roman warband',3008,576,3,'highlands',83,38,20,'A roaming warband has built a camp here. Defeat its defenders for resources and commander experience. It regroups after ten minutes.',true,'roman'),
(1341,'Human · Persian marauders',4160,960,4,'highlands',88,61,52,'A roaming warband has built a camp here. Defeat its defenders for resources and commander experience. It regroups after ten minutes.',true,'persian'),
(1342,'Elves outlaws',5184,1216,1,'plains',29,15,1,'A roaming warband has built a camp here. Defeat its defenders for resources and commander experience. It regroups after ten minutes.',true,'elf'),
(1343,'Gnomes outlaws',6208,1344,1,'plains',19,13,3,'A roaming warband has built a camp here. Defeat its defenders for resources and commander experience. It regroups after ten minutes.',true,'gnome'),
(1344,'Gnomes warband',6720,832,3,'highlands',130,42,8,'A roaming warband has built a camp here. Defeat its defenders for resources and commander experience. It regroups after ten minutes.',true,'gnome'),
(1345,'Human · Roman raiders',8512,1088,2,'woods',51,12,8,'A roaming warband has built a camp here. Defeat its defenders for resources and commander experience. It regroups after ten minutes.',true,'roman'),
(1346,'Dwarves raiders',8768,704,2,'plains',26,27,16,'A roaming warband has built a camp here. Defeat its defenders for resources and commander experience. It regroups after ten minutes.',true,'dwarf'),
(1347,'Elves warband',10688,576,3,'plains',111,36,7,'A roaming warband has built a camp here. Defeat its defenders for resources and commander experience. It regroups after ten minutes.',true,'elf'),
(1348,'Gnomes warband',10816,960,3,'plains',80,37,22,'A roaming warband has built a camp here. Defeat its defenders for resources and commander experience. It regroups after ten minutes.',true,'gnome'),
(1349,'Necropolis outlaws',11840,1216,1,'plains',21,9,3,'A roaming warband has built a camp here. Defeat its defenders for resources and commander experience. It regroups after ten minutes.',true,'undead'),
(1350,'Pandaren warband',-12736,1728,3,'highlands',72,35,32,'A roaming warband has built a camp here. Defeat its defenders for resources and commander experience. It regroups after ten minutes.',true,'pandaren'),
(1351,'Gnomes raiders',-11200,2368,2,'woods',51,19,8,'A roaming warband has built a camp here. Defeat its defenders for resources and commander experience. It regroups after ten minutes.',true,'gnome'),
(1352,'Elves raiders',-10432,2112,2,'highlands',47,30,1,'A roaming warband has built a camp here. Defeat its defenders for resources and commander experience. It regroups after ten minutes.',true,'elf'),
(1353,'Human · Roman outlaws',-9024,2112,1,'desert',28,10,1,'A roaming warband has built a camp here. Defeat its defenders for resources and commander experience. It regroups after ten minutes.',true,'roman'),
(1354,'Demons raiders',-8256,1600,2,'plains',52,19,24,'A roaming warband has built a camp here. Defeat its defenders for resources and commander experience. It regroups after ten minutes.',true,'demon'),
(1355,'Human · Spartan warband',-7104,1856,3,'highlands',108,35,10,'A roaming warband has built a camp here. Defeat its defenders for resources and commander experience. It regroups after ten minutes.',true,'spartan'),
(1356,'Human · Egyptian marauders',-6080,2240,4,'woods',122,58,40,'A roaming warband has built a camp here. Defeat its defenders for resources and commander experience. It regroups after ten minutes.',true,'egyptian'),
(1357,'Human · Roman raiders',-5056,1600,2,'highlands',62,28,12,'A roaming warband has built a camp here. Defeat its defenders for resources and commander experience. It regroups after ten minutes.',true,'roman'),
(1358,'Demons marauders',-4288,2112,4,'marsh',109,87,67,'A roaming warband has built a camp here. Defeat its defenders for resources and commander experience. It regroups after ten minutes.',true,'demon'),
(1359,'Pandaren raiders',-3008,2368,2,'plains',33,30,19,'A roaming warband has built a camp here. Defeat its defenders for resources and commander experience. It regroups after ten minutes.',true,'pandaren'),
(1360,'Demons warband',-2368,2112,3,'marsh',93,59,19,'A roaming warband has built a camp here. Defeat its defenders for resources and commander experience. It regroups after ten minutes.',true,'demon'),
(1361,'Human · Egyptian raiders',-576,1600,2,'highlands',48,11,10,'A roaming warband has built a camp here. Defeat its defenders for resources and commander experience. It regroups after ten minutes.',true,'egyptian'),
(1362,'Pandaren outlaws',64,2240,1,'plains',29,13,4,'A roaming warband has built a camp here. Defeat its defenders for resources and commander experience. It regroups after ten minutes.',true,'pandaren'),
(1363,'Pandaren warband',576,2240,3,'plains',105,34,12,'A roaming warband has built a camp here. Defeat its defenders for resources and commander experience. It regroups after ten minutes.',true,'pandaren'),
(1364,'Demons outlaws',1600,2496,1,'desert',25,9,2,'A roaming warband has built a camp here. Defeat its defenders for resources and commander experience. It regroups after ten minutes.',true,'demon'),
(1365,'Human · Roman raiders',2624,2112,2,'plains',61,23,2,'A roaming warband has built a camp here. Defeat its defenders for resources and commander experience. It regroups after ten minutes.',true,'roman'),
(1366,'Human · Spartan marauders',3648,1984,4,'desert',142,111,32,'A roaming warband has built a camp here. Defeat its defenders for resources and commander experience. It regroups after ten minutes.',true,'spartan'),
(1367,'Elves warband',5184,1984,3,'woods',89,53,27,'A roaming warband has built a camp here. Defeat its defenders for resources and commander experience. It regroups after ten minutes.',true,'elf'),
(1368,'Human · Persian marauders',6464,2112,4,'plains',141,67,3,'A roaming warband has built a camp here. Defeat its defenders for resources and commander experience. It regroups after ten minutes.',true,'persian'),
(1369,'Dwarves warband',7616,1600,3,'woods',109,31,15,'A roaming warband has built a camp here. Defeat its defenders for resources and commander experience. It regroups after ten minutes.',true,'dwarf'),
(1370,'Human · Roman warband',8128,1600,3,'woods',106,40,25,'A roaming warband has built a camp here. Defeat its defenders for resources and commander experience. It regroups after ten minutes.',true,'roman'),
(1371,'Orcs marauders',9280,2496,4,'highlands',161,53,24,'A roaming warband has built a camp here. Defeat its defenders for resources and commander experience. It regroups after ten minutes.',true,'orc'),
(1372,'Human · Persian raiders',10304,1600,2,'plains',59,31,3,'A roaming warband has built a camp here. Defeat its defenders for resources and commander experience. It regroups after ten minutes.',true,'persian'),
(1373,'Human · Spartan warband',11712,2112,3,'woods',72,61,25,'A roaming warband has built a camp here. Defeat its defenders for resources and commander experience. It regroups after ten minutes.',true,'spartan'),
(1374,'Human · Roman raiders',12352,1728,2,'plains',41,19,19,'A roaming warband has built a camp here. Defeat its defenders for resources and commander experience. It regroups after ten minutes.',true,'roman'),
(1375,'Human · Persian raiders',-11840,2624,2,'woods',34,29,21,'A roaming warband has built a camp here. Defeat its defenders for resources and commander experience. It regroups after ten minutes.',true,'persian'),
(1376,'Human · Persian warband',-11328,3136,3,'plains',81,47,7,'A roaming warband has built a camp here. Defeat its defenders for resources and commander experience. It regroups after ten minutes.',true,'persian'),
(1377,'Dwarves warband',-10688,3136,3,'plains',118,27,33,'A roaming warband has built a camp here. Defeat its defenders for resources and commander experience. It regroups after ten minutes.',true,'dwarf'),
(1378,'Necropolis warband',-9664,3392,3,'plains',132,30,0,'A roaming warband has built a camp here. Defeat its defenders for resources and commander experience. It regroups after ten minutes.',true,'undead'),
(1379,'Orcs outlaws',-8640,2624,1,'desert',23,13,2,'A roaming warband has built a camp here. Defeat its defenders for resources and commander experience. It regroups after ten minutes.',true,'orc'),
(1380,'Pandaren outlaws',-7616,3008,1,'woods',35,7,0,'A roaming warband has built a camp here. Defeat its defenders for resources and commander experience. It regroups after ten minutes.',true,'pandaren'),
(1381,'Human · Spartan warband',-5696,3136,3,'plains',76,42,48,'A roaming warband has built a camp here. Defeat its defenders for resources and commander experience. It regroups after ten minutes.',true,'spartan'),
(1382,'Gnomes raiders',-5312,2624,2,'woods',49,28,15,'A roaming warband has built a camp here. Defeat its defenders for resources and commander experience. It regroups after ten minutes.',true,'gnome'),
(1383,'Orcs warband',-3776,3136,3,'marsh',69,66,41,'A roaming warband has built a camp here. Defeat its defenders for resources and commander experience. It regroups after ten minutes.',true,'orc'),
(1384,'Human · Roman raiders',-3008,3136,2,'plains',41,27,6,'A roaming warband has built a camp here. Defeat its defenders for resources and commander experience. It regroups after ten minutes.',true,'roman'),
(1385,'Human · Egyptian warband',-1984,3392,3,'plains',114,26,36,'A roaming warband has built a camp here. Defeat its defenders for resources and commander experience. It regroups after ten minutes.',true,'egyptian'),
(1386,'Human · Egyptian outlaws',-1472,3520,1,'plains',27,9,0,'A roaming warband has built a camp here. Defeat its defenders for resources and commander experience. It regroups after ten minutes.',true,'egyptian'),
(1387,'Orcs outlaws',192,2624,1,'woods',21,15,3,'A roaming warband has built a camp here. Defeat its defenders for resources and commander experience. It regroups after ten minutes.',true,'orc'),
(1388,'Pandaren warband',832,3136,3,'highlands',110,48,22,'A roaming warband has built a camp here. Defeat its defenders for resources and commander experience. It regroups after ten minutes.',true,'pandaren'),
(1389,'Demons raiders',1600,2880,2,'desert',45,11,20,'A roaming warband has built a camp here. Defeat its defenders for resources and commander experience. It regroups after ten minutes.',true,'demon'),
(1390,'Dwarves outlaws',3264,3136,1,'desert',24,13,1,'A roaming warband has built a camp here. Defeat its defenders for resources and commander experience. It regroups after ten minutes.',true,'dwarf'),
(1391,'Elves raiders',4544,3136,2,'plains',31,27,24,'A roaming warband has built a camp here. Defeat its defenders for resources and commander experience. It regroups after ten minutes.',true,'elf'),
(1392,'Orcs warband',4928,2624,3,'woods',67,48,38,'A roaming warband has built a camp here. Defeat its defenders for resources and commander experience. It regroups after ten minutes.',true,'orc'),
(1393,'Demons warband',5696,2624,3,'woods',67,68,39,'A roaming warband has built a camp here. Defeat its defenders for resources and commander experience. It regroups after ten minutes.',true,'demon'),
(1394,'Gnomes outlaws',6720,3520,1,'plains',28,5,1,'A roaming warband has built a camp here. Defeat its defenders for resources and commander experience. It regroups after ten minutes.',true,'gnome'),
(1395,'Orcs outlaws',8000,2624,1,'plains',31,6,3,'A roaming warband has built a camp here. Defeat its defenders for resources and commander experience. It regroups after ten minutes.',true,'orc'),
(1396,'Human · Spartan raiders',9280,2880,2,'plains',68,17,14,'A roaming warband has built a camp here. Defeat its defenders for resources and commander experience. It regroups after ten minutes.',true,'spartan'),
(1397,'Necropolis warband',9792,3008,3,'highlands',104,52,3,'A roaming warband has built a camp here. Defeat its defenders for resources and commander experience. It regroups after ten minutes.',true,'undead'),
(1398,'Demons raiders',11200,3136,2,'woods',47,26,17,'A roaming warband has built a camp here. Defeat its defenders for resources and commander experience. It regroups after ten minutes.',true,'demon'),
(1399,'Human · Spartan raiders',12352,3392,2,'woods',54,26,1,'A roaming warband has built a camp here. Defeat its defenders for resources and commander experience. It regroups after ten minutes.',true,'spartan'),
(1400,'Human · Egyptian warband',-12224,3648,3,'plains',66,46,16,'A roaming warband has built a camp here. Defeat its defenders for resources and commander experience. It regroups after ten minutes.',true,'egyptian'),
(1401,'Necropolis marauders',-11200,4544,4,'plains',213,53,4,'A roaming warband has built a camp here. Defeat its defenders for resources and commander experience. It regroups after ten minutes.',true,'undead'),
(1402,'Human · Persian outlaws',-10176,3648,1,'plains',35,6,0,'A roaming warband has built a camp here. Defeat its defenders for resources and commander experience. It regroups after ten minutes.',true,'persian'),
(1403,'Human · Spartan marauders',-9152,3776,4,'plains',111,81,14,'A roaming warband has built a camp here. Defeat its defenders for resources and commander experience. It regroups after ten minutes.',true,'spartan'),
(1404,'Demons outlaws',-8640,3904,1,'plains',27,15,0,'A roaming warband has built a camp here. Defeat its defenders for resources and commander experience. It regroups after ten minutes.',true,'demon'),
(1405,'Orcs raiders',-6720,4160,2,'plains',63,25,9,'A roaming warband has built a camp here. Defeat its defenders for resources and commander experience. It regroups after ten minutes.',true,'orc'),
(1406,'Elves warband',-6336,3648,3,'highlands',77,39,12,'A roaming warband has built a camp here. Defeat its defenders for resources and commander experience. It regroups after ten minutes.',true,'elf'),
(1407,'Human · Spartan warband',-5568,3904,3,'plains',106,24,12,'A roaming warband has built a camp here. Defeat its defenders for resources and commander experience. It regroups after ten minutes.',true,'spartan'),
(1408,'Elves outlaws',-4544,4416,1,'marsh',29,13,1,'A roaming warband has built a camp here. Defeat its defenders for resources and commander experience. It regroups after ten minutes.',true,'elf'),
(1409,'Elves outlaws',-3392,4160,1,'highlands',36,7,2,'A roaming warband has built a camp here. Defeat its defenders for resources and commander experience. It regroups after ten minutes.',true,'elf'),
(1410,'Elves outlaws',-1856,4160,1,'plains',28,11,2,'A roaming warband has built a camp here. Defeat its defenders for resources and commander experience. It regroups after ten minutes.',true,'elf'),
(1411,'Human · Egyptian outlaws',-960,3776,1,'plains',33,9,0,'A roaming warband has built a camp here. Defeat its defenders for resources and commander experience. It regroups after ten minutes.',true,'egyptian'),
(1412,'Pandaren raiders',-64,4160,2,'plains',55,16,0,'A roaming warband has built a camp here. Defeat its defenders for resources and commander experience. It regroups after ten minutes.',true,'pandaren'),
(1413,'Human · Roman raiders',1088,4416,2,'plains',61,24,11,'A roaming warband has built a camp here. Defeat its defenders for resources and commander experience. It regroups after ten minutes.',true,'roman'),
(1414,'Human · Persian raiders',2112,3648,2,'woods',43,25,20,'A roaming warband has built a camp here. Defeat its defenders for resources and commander experience. It regroups after ten minutes.',true,'persian'),
(1415,'Human · Egyptian warband',2880,4160,3,'plains',68,43,20,'A roaming warband has built a camp here. Defeat its defenders for resources and commander experience. It regroups after ten minutes.',true,'egyptian'),
(1416,'Human · Roman warband',4160,4544,3,'plains',78,39,36,'A roaming warband has built a camp here. Defeat its defenders for resources and commander experience. It regroups after ten minutes.',true,'roman'),
(1417,'Pandaren marauders',5440,3648,4,'plains',184,72,25,'A roaming warband has built a camp here. Defeat its defenders for resources and commander experience. It regroups after ten minutes.',true,'pandaren'),
(1418,'Human · Egyptian raiders',6208,3648,2,'highlands',55,14,27,'A roaming warband has built a camp here. Defeat its defenders for resources and commander experience. It regroups after ten minutes.',true,'egyptian'),
(1419,'Gnomes raiders',6720,4288,2,'woods',47,17,12,'A roaming warband has built a camp here. Defeat its defenders for resources and commander experience. It regroups after ten minutes.',true,'gnome'),
(1420,'Human · Roman raiders',7744,3904,2,'desert',61,35,1,'A roaming warband has built a camp here. Defeat its defenders for resources and commander experience. It regroups after ten minutes.',true,'roman'),
(1421,'Gnomes raiders',8768,3648,2,'desert',60,23,12,'A roaming warband has built a camp here. Defeat its defenders for resources and commander experience. It regroups after ten minutes.',true,'gnome'),
(1422,'Necropolis raiders',10304,4160,2,'plains',62,32,4,'A roaming warband has built a camp here. Defeat its defenders for resources and commander experience. It regroups after ten minutes.',true,'undead'),
(1423,'Human · Roman warband',10944,4160,3,'highlands',87,42,8,'A roaming warband has built a camp here. Defeat its defenders for resources and commander experience. It regroups after ten minutes.',true,'roman'),
(1424,'Dwarves raiders',11840,4416,2,'highlands',62,30,7,'A roaming warband has built a camp here. Defeat its defenders for resources and commander experience. It regroups after ten minutes.',true,'dwarf'),
(1426,'Demons raiders',-11456,5184,2,'woods',38,24,19,'A roaming warband has built a camp here. Defeat its defenders for resources and commander experience. It regroups after ten minutes.',true,'demon'),
(1427,'Elves raiders',-10048,5184,2,'highlands',44,25,14,'A roaming warband has built a camp here. Defeat its defenders for resources and commander experience. It regroups after ten minutes.',true,'elf'),
(1428,'Human · Roman raiders',-9152,4672,2,'highlands',53,14,2,'A roaming warband has built a camp here. Defeat its defenders for resources and commander experience. It regroups after ten minutes.',true,'roman'),
(1429,'Human · Egyptian raiders',-8128,4928,2,'woods',57,23,14,'A roaming warband has built a camp here. Defeat its defenders for resources and commander experience. It regroups after ten minutes.',true,'egyptian'),
(1430,'Elves warband',-6976,5184,3,'plains',70,41,40,'A roaming warband has built a camp here. Defeat its defenders for resources and commander experience. It regroups after ten minutes.',true,'elf'),
(1431,'Gnomes warband',-6080,4800,3,'marsh',98,55,5,'A roaming warband has built a camp here. Defeat its defenders for resources and commander experience. It regroups after ten minutes.',true,'gnome'),
(1432,'Gnomes raiders',-5568,5440,2,'marsh',44,11,14,'A roaming warband has built a camp here. Defeat its defenders for resources and commander experience. It regroups after ten minutes.',true,'gnome'),
(1433,'Pandaren warband',-4544,4800,3,'plains',64,39,19,'A roaming warband has built a camp here. Defeat its defenders for resources and commander experience. It regroups after ten minutes.',true,'pandaren'),
(1434,'Orcs raiders',-3136,4672,2,'highlands',27,27,16,'A roaming warband has built a camp here. Defeat its defenders for resources and commander experience. It regroups after ten minutes.',true,'orc'),
(1435,'Elves raiders',-2496,4672,2,'desert',45,13,18,'A roaming warband has built a camp here. Defeat its defenders for resources and commander experience. It regroups after ten minutes.',true,'elf'),
(1436,'Gnomes raiders',-1472,4928,2,'marsh',76,21,5,'A roaming warband has built a camp here. Defeat its defenders for resources and commander experience. It regroups after ten minutes.',true,'gnome'),
(1437,'Demons raiders',-320,5184,2,'plains',56,22,15,'A roaming warband has built a camp here. Defeat its defenders for resources and commander experience. It regroups after ten minutes.',true,'demon'),
(1438,'Human · Roman marauders',576,5312,4,'desert',97,108,81,'A roaming warband has built a camp here. Defeat its defenders for resources and commander experience. It regroups after ten minutes.',true,'roman'),
(1439,'Human · Egyptian warband',1728,5184,3,'desert',107,48,3,'A roaming warband has built a camp here. Defeat its defenders for resources and commander experience. It regroups after ten minutes.',true,'egyptian'),
(1440,'Human · Spartan marauders',2752,5184,4,'plains',144,84,13,'A roaming warband has built a camp here. Defeat its defenders for resources and commander experience. It regroups after ten minutes.',true,'spartan'),
(1441,'Gnomes raiders',3648,5440,2,'plains',57,11,6,'A roaming warband has built a camp here. Defeat its defenders for resources and commander experience. It regroups after ten minutes.',true,'gnome'),
(1442,'Demons raiders',5184,5568,2,'highlands',39,33,12,'A roaming warband has built a camp here. Defeat its defenders for resources and commander experience. It regroups after ten minutes.',true,'demon'),
(1443,'Human · Spartan raiders',6208,4928,2,'plains',43,13,19,'A roaming warband has built a camp here. Defeat its defenders for resources and commander experience. It regroups after ten minutes.',true,'spartan'),
(1444,'Human · Egyptian raiders',7360,5184,2,'woods',74,20,7,'A roaming warband has built a camp here. Defeat its defenders for resources and commander experience. It regroups after ten minutes.',true,'egyptian'),
(1445,'Gnomes outlaws',8256,5440,1,'woods',24,15,3,'A roaming warband has built a camp here. Defeat its defenders for resources and commander experience. It regroups after ten minutes.',true,'gnome'),
(1446,'Human · Persian outlaws',8768,5568,1,'desert',32,7,0,'A roaming warband has built a camp here. Defeat its defenders for resources and commander experience. It regroups after ten minutes.',true,'persian'),
(1447,'Human · Persian raiders',10688,4672,2,'woods',33,30,18,'A roaming warband has built a camp here. Defeat its defenders for resources and commander experience. It regroups after ten minutes.',true,'persian'),
(1448,'Dwarves outlaws',11072,4672,1,'woods',33,9,0,'A roaming warband has built a camp here. Defeat its defenders for resources and commander experience. It regroups after ten minutes.',true,'dwarf'),
(1449,'Pandaren raiders',12224,4672,2,'desert',49,36,13,'A roaming warband has built a camp here. Defeat its defenders for resources and commander experience. It regroups after ten minutes.',true,'pandaren'),
(1451,'Human · Persian outlaws',-10944,6208,1,'plains',26,18,3,'A roaming warband has built a camp here. Defeat its defenders for resources and commander experience. It regroups after ten minutes.',true,'persian'),
(1452,'Orcs marauders',-10176,5696,4,'plains',146,49,72,'A roaming warband has built a camp here. Defeat its defenders for resources and commander experience. It regroups after ten minutes.',true,'orc'),
(1453,'Human · Persian warband',-9408,5696,3,'woods',91,37,33,'A roaming warband has built a camp here. Defeat its defenders for resources and commander experience. It regroups after ten minutes.',true,'persian'),
(1454,'Orcs raiders',-8640,5696,2,'woods',68,24,6,'A roaming warband has built a camp here. Defeat its defenders for resources and commander experience. It regroups after ten minutes.',true,'orc'),
(1455,'Human · Spartan raiders',-7104,5696,2,'woods',50,12,21,'A roaming warband has built a camp here. Defeat its defenders for resources and commander experience. It regroups after ten minutes.',true,'spartan'),
(1456,'Demons raiders',-6208,6208,2,'marsh',57,34,2,'A roaming warband has built a camp here. Defeat its defenders for resources and commander experience. It regroups after ten minutes.',true,'demon'),
(1457,'Human · Roman outlaws',-5056,5824,1,'highlands',28,15,0,'A roaming warband has built a camp here. Defeat its defenders for resources and commander experience. It regroups after ten minutes.',true,'roman'),
(1458,'Human · Persian raiders',-4032,6208,2,'highlands',37,31,14,'A roaming warband has built a camp here. Defeat its defenders for resources and commander experience. It regroups after ten minutes.',true,'persian'),
(1459,'Human · Spartan outlaws',-3136,6208,1,'highlands',36,8,4,'A roaming warband has built a camp here. Defeat its defenders for resources and commander experience. It regroups after ten minutes.',true,'spartan'),
(1460,'Dwarves warband',-1856,5696,3,'plains',122,34,18,'A roaming warband has built a camp here. Defeat its defenders for resources and commander experience. It regroups after ten minutes.',true,'dwarf'),
(1461,'Demons outlaws',-832,5696,1,'woods',24,10,2,'A roaming warband has built a camp here. Defeat its defenders for resources and commander experience. It regroups after ten minutes.',true,'demon'),
(1462,'Orcs raiders',-448,5696,2,'woods',49,13,10,'A roaming warband has built a camp here. Defeat its defenders for resources and commander experience. It regroups after ten minutes.',true,'orc'),
(1463,'Elves outlaws',704,6208,1,'plains',26,5,1,'A roaming warband has built a camp here. Defeat its defenders for resources and commander experience. It regroups after ten minutes.',true,'elf'),
(1464,'Orcs outlaws',1600,5824,1,'desert',28,14,4,'A roaming warband has built a camp here. Defeat its defenders for resources and commander experience. It regroups after ten minutes.',true,'orc'),
(1465,'Gnomes raiders',2624,6208,2,'highlands',52,31,7,'A roaming warband has built a camp here. Defeat its defenders for resources and commander experience. It regroups after ten minutes.',true,'gnome'),
(1466,'Orcs warband',4416,6208,3,'plains',102,31,26,'A roaming warband has built a camp here. Defeat its defenders for resources and commander experience. It regroups after ten minutes.',true,'orc'),
(1467,'Human · Roman raiders',4800,5696,2,'woods',61,11,0,'A roaming warband has built a camp here. Defeat its defenders for resources and commander experience. It regroups after ten minutes.',true,'roman'),
(1468,'Dwarves warband',6208,6336,3,'desert',113,35,26,'A roaming warband has built a camp here. Defeat its defenders for resources and commander experience. It regroups after ten minutes.',true,'dwarf'),
(1469,'Pandaren outlaws',7232,5952,1,'highlands',21,10,2,'A roaming warband has built a camp here. Defeat its defenders for resources and commander experience. It regroups after ten minutes.',true,'pandaren'),
(1470,'Gnomes warband',8256,6208,3,'woods',87,26,33,'A roaming warband has built a camp here. Defeat its defenders for resources and commander experience. It regroups after ten minutes.',true,'gnome'),
(1471,'Necropolis outlaws',9280,5824,1,'highlands',24,9,1,'A roaming warband has built a camp here. Defeat its defenders for resources and commander experience. It regroups after ten minutes.',true,'undead'),
(1472,'Human · Spartan outlaws',10304,6080,1,'woods',28,14,4,'A roaming warband has built a camp here. Defeat its defenders for resources and commander experience. It regroups after ten minutes.',true,'spartan'),
(1473,'Human · Egyptian outlaws',11328,6464,1,'highlands',23,8,3,'A roaming warband has built a camp here. Defeat its defenders for resources and commander experience. It regroups after ten minutes.',true,'egyptian'),
(1476,'Demons warband',-10944,7232,3,'plains',116,31,24,'A roaming warband has built a camp here. Defeat its defenders for resources and commander experience. It regroups after ten minutes.',true,'demon'),
(1477,'Dwarves outlaws',-10688,7616,1,'plains',36,10,0,'A roaming warband has built a camp here. Defeat its defenders for resources and commander experience. It regroups after ten minutes.',true,'dwarf'),
(1478,'Human · Spartan outlaws',-9024,6720,1,'woods',27,12,2,'A roaming warband has built a camp here. Defeat its defenders for resources and commander experience. It regroups after ten minutes.',true,'spartan'),
(1479,'Elves outlaws',-8640,7104,1,'woods',22,9,2,'A roaming warband has built a camp here. Defeat its defenders for resources and commander experience. It regroups after ten minutes.',true,'elf'),
(1480,'Pandaren marauders',-7616,7104,4,'woods',176,37,4,'A roaming warband has built a camp here. Defeat its defenders for resources and commander experience. It regroups after ten minutes.',true,'pandaren'),
(1481,'Demons raiders',-6464,6720,2,'highlands',49,29,10,'A roaming warband has built a camp here. Defeat its defenders for resources and commander experience. It regroups after ten minutes.',true,'demon'),
(1482,'Human · Persian outlaws',-5056,7104,1,'woods',29,6,1,'A roaming warband has built a camp here. Defeat its defenders for resources and commander experience. It regroups after ten minutes.',true,'persian'),
(1483,'Human · Egyptian warband',-4288,7232,3,'woods',70,49,5,'A roaming warband has built a camp here. Defeat its defenders for resources and commander experience. It regroups after ten minutes.',true,'egyptian'),
(1484,'Pandaren outlaws',-3008,7616,1,'plains',28,10,3,'A roaming warband has built a camp here. Defeat its defenders for resources and commander experience. It regroups after ten minutes.',true,'pandaren'),
(1485,'Dwarves outlaws',-1728,6720,1,'desert',34,12,1,'A roaming warband has built a camp here. Defeat its defenders for resources and commander experience. It regroups after ten minutes.',true,'dwarf'),
(1486,'Demons outlaws',-960,7104,1,'desert',28,8,1,'A roaming warband has built a camp here. Defeat its defenders for resources and commander experience. It regroups after ten minutes.',true,'demon'),
(1487,'Human · Spartan outlaws',64,7360,1,'plains',23,8,2,'A roaming warband has built a camp here. Defeat its defenders for resources and commander experience. It regroups after ten minutes.',true,'spartan'),
(1488,'Orcs raiders',1216,6720,2,'woods',66,28,1,'A roaming warband has built a camp here. Defeat its defenders for resources and commander experience. It regroups after ten minutes.',true,'orc'),
(1489,'Dwarves warband',2112,7232,3,'woods',89,41,17,'A roaming warband has built a camp here. Defeat its defenders for resources and commander experience. It regroups after ten minutes.',true,'dwarf'),
(1490,'Pandaren warband',3392,7232,3,'woods',54,50,34,'A roaming warband has built a camp here. Defeat its defenders for resources and commander experience. It regroups after ten minutes.',true,'pandaren'),
(1491,'Human · Persian raiders',3648,7616,2,'woods',45,17,20,'A roaming warband has built a camp here. Defeat its defenders for resources and commander experience. It regroups after ten minutes.',true,'persian'),
(1492,'Dwarves raiders',5440,6720,2,'plains',55,19,26,'A roaming warband has built a camp here. Defeat its defenders for resources and commander experience. It regroups after ten minutes.',true,'dwarf'),
(1493,'Orcs outlaws',5696,7104,1,'plains',29,8,4,'A roaming warband has built a camp here. Defeat its defenders for resources and commander experience. It regroups after ten minutes.',true,'orc'),
(1494,'Dwarves outlaws',6720,7360,1,'desert',27,8,1,'A roaming warband has built a camp here. Defeat its defenders for resources and commander experience. It regroups after ten minutes.',true,'dwarf'),
(1495,'Pandaren raiders',7744,7104,2,'desert',50,33,1,'A roaming warband has built a camp here. Defeat its defenders for resources and commander experience. It regroups after ten minutes.',true,'pandaren'),
(1496,'Pandaren raiders',8768,7232,2,'woods',50,22,0,'A roaming warband has built a camp here. Defeat its defenders for resources and commander experience. It regroups after ten minutes.',true,'pandaren'),
(1497,'Human · Persian raiders',10048,7232,2,'plains',45,28,13,'A roaming warband has built a camp here. Defeat its defenders for resources and commander experience. It regroups after ten minutes.',true,'persian'),
(1498,'Human · Persian raiders',10816,7488,2,'plains',67,27,2,'A roaming warband has built a camp here. Defeat its defenders for resources and commander experience. It regroups after ten minutes.',true,'persian'),
(1500,'Pandaren raiders',-12608,8256,2,'darkland',45,38,16,'A roaming warband has built a camp here. Defeat its defenders for resources and commander experience. It regroups after ten minutes.',true,'pandaren'),
(1501,'Human · Roman warband',-11072,8256,3,'woods',117,27,8,'A roaming warband has built a camp here. Defeat its defenders for resources and commander experience. It regroups after ten minutes.',true,'roman'),
(1502,'Orcs warband',-10688,8256,3,'highlands',105,39,29,'A roaming warband has built a camp here. Defeat its defenders for resources and commander experience. It regroups after ten minutes.',true,'orc'),
(1503,'Elves warband',-9152,8128,3,'woods',74,53,32,'A roaming warband has built a camp here. Defeat its defenders for resources and commander experience. It regroups after ten minutes.',true,'elf'),
(1504,'Gnomes raiders',-7872,8256,2,'plains',61,27,5,'A roaming warband has built a camp here. Defeat its defenders for resources and commander experience. It regroups after ten minutes.',true,'gnome'),
(1505,'Gnomes outlaws',-7104,8512,1,'woods',27,14,0,'A roaming warband has built a camp here. Defeat its defenders for resources and commander experience. It regroups after ten minutes.',true,'gnome'),
(1506,'Human · Roman warband',-5696,7744,3,'plains',49,47,38,'A roaming warband has built a camp here. Defeat its defenders for resources and commander experience. It regroups after ten minutes.',true,'roman'),
(1507,'Human · Spartan raiders',-4928,8256,2,'desert',58,24,19,'A roaming warband has built a camp here. Defeat its defenders for resources and commander experience. It regroups after ten minutes.',true,'spartan'),
(1508,'Elves outlaws',-4544,8384,1,'desert',34,7,3,'A roaming warband has built a camp here. Defeat its defenders for resources and commander experience. It regroups after ten minutes.',true,'elf'),
(1509,'Gnomes outlaws',-3520,8512,1,'highlands',28,16,1,'A roaming warband has built a camp here. Defeat its defenders for resources and commander experience. It regroups after ten minutes.',true,'gnome'),
(1510,'Elves raiders',-2496,8512,2,'desert',59,22,2,'A roaming warband has built a camp here. Defeat its defenders for resources and commander experience. It regroups after ten minutes.',true,'elf'),
(1511,'Human · Roman raiders',-1216,8256,2,'plains',51,25,25,'A roaming warband has built a camp here. Defeat its defenders for resources and commander experience. It regroups after ten minutes.',true,'roman'),
(1512,'Human · Persian warband',192,8256,3,'plains',47,49,39,'A roaming warband has built a camp here. Defeat its defenders for resources and commander experience. It regroups after ten minutes.',true,'persian'),
(1513,'Elves warband',960,7744,3,'woods',74,46,27,'A roaming warband has built a camp here. Defeat its defenders for resources and commander experience. It regroups after ten minutes.',true,'elf'),
(1514,'Human · Persian warband',1600,8640,3,'plains',103,19,2,'A roaming warband has built a camp here. Defeat its defenders for resources and commander experience. It regroups after ten minutes.',true,'persian'),
(1515,'Necropolis outlaws',3136,8384,1,'highlands',29,17,1,'A roaming warband has built a camp here. Defeat its defenders for resources and commander experience. It regroups after ten minutes.',true,'undead'),
(1516,'Human · Spartan outlaws',4160,8640,1,'highlands',34,6,3,'A roaming warband has built a camp here. Defeat its defenders for resources and commander experience. It regroups after ten minutes.',true,'spartan'),
(1517,'Human · Persian outlaws',5440,8256,1,'plains',23,14,1,'A roaming warband has built a camp here. Defeat its defenders for resources and commander experience. It regroups after ten minutes.',true,'persian'),
(1518,'Elves raiders',6464,8256,2,'highlands',47,16,11,'A roaming warband has built a camp here. Defeat its defenders for resources and commander experience. It regroups after ten minutes.',true,'elf'),
(1519,'Demons raiders',7360,8256,2,'highlands',35,39,25,'A roaming warband has built a camp here. Defeat its defenders for resources and commander experience. It regroups after ten minutes.',true,'demon'),
(1520,'Demons raiders',8640,7744,2,'woods',58,25,8,'A roaming warband has built a camp here. Defeat its defenders for resources and commander experience. It regroups after ten minutes.',true,'demon'),
(1521,'Necropolis outlaws',9408,7744,1,'highlands',30,8,1,'A roaming warband has built a camp here. Defeat its defenders for resources and commander experience. It regroups after ten minutes.',true,'undead'),
(1522,'Human · Egyptian marauders',9792,8384,4,'woods',135,71,3,'A roaming warband has built a camp here. Defeat its defenders for resources and commander experience. It regroups after ten minutes.',true,'egyptian'),
(1523,'Elves outlaws',10816,8640,1,'plains',28,17,2,'A roaming warband has built a camp here. Defeat its defenders for resources and commander experience. It regroups after ten minutes.',true,'elf'),
(1526,'Orcs marauders',-11200,8768,4,'plains',181,63,17,'A roaming warband has built a camp here. Defeat its defenders for resources and commander experience. It regroups after ten minutes.',true,'orc'),
(1527,'Human · Egyptian raiders',-10432,8768,2,'highlands',47,24,28,'A roaming warband has built a camp here. Defeat its defenders for resources and commander experience. It regroups after ten minutes.',true,'egyptian'),
(1528,'Gnomes raiders',-9152,9536,2,'highlands',55,14,11,'A roaming warband has built a camp here. Defeat its defenders for resources and commander experience. It regroups after ten minutes.',true,'gnome'),
(1529,'Pandaren warband',-8128,9408,3,'plains',69,44,31,'A roaming warband has built a camp here. Defeat its defenders for resources and commander experience. It regroups after ten minutes.',true,'pandaren'),
(1530,'Demons outlaws',-7104,9664,1,'woods',23,11,0,'A roaming warband has built a camp here. Defeat its defenders for resources and commander experience. It regroups after ten minutes.',true,'demon'),
(1531,'Human · Roman raiders',-6080,8896,2,'woods',73,27,1,'A roaming warband has built a camp here. Defeat its defenders for resources and commander experience. It regroups after ten minutes.',true,'roman'),
(1532,'Human · Roman raiders',-5056,9280,2,'plains',64,29,3,'A roaming warband has built a camp here. Defeat its defenders for resources and commander experience. It regroups after ten minutes.',true,'roman'),
(1533,'Orcs outlaws',-4032,9152,1,'desert',29,7,0,'A roaming warband has built a camp here. Defeat its defenders for resources and commander experience. It regroups after ten minutes.',true,'orc'),
(1534,'Human · Spartan outlaws',-2752,9280,1,'desert',32,8,2,'A roaming warband has built a camp here. Defeat its defenders for resources and commander experience. It regroups after ten minutes.',true,'spartan'),
(1535,'Human · Roman raiders',-2496,8896,2,'desert',51,22,2,'A roaming warband has built a camp here. Defeat its defenders for resources and commander experience. It regroups after ten minutes.',true,'roman'),
(1536,'Human · Persian warband',-576,9280,3,'plains',96,42,19,'A roaming warband has built a camp here. Defeat its defenders for resources and commander experience. It regroups after ten minutes.',true,'persian'),
(1537,'Orcs marauders',-448,9664,4,'plains',105,68,54,'A roaming warband has built a camp here. Defeat its defenders for resources and commander experience. It regroups after ten minutes.',true,'orc'),
(1538,'Human · Spartan warband',1088,8768,3,'woods',78,29,24,'A roaming warband has built a camp here. Defeat its defenders for resources and commander experience. It regroups after ten minutes.',true,'spartan'),
(1539,'Human · Spartan outlaws',2112,9024,1,'plains',27,12,0,'A roaming warband has built a camp here. Defeat its defenders for resources and commander experience. It regroups after ten minutes.',true,'spartan'),
(1540,'Dwarves marauders',2624,9024,4,'desert',163,64,56,'A roaming warband has built a camp here. Defeat its defenders for resources and commander experience. It regroups after ten minutes.',true,'dwarf'),
(1541,'Gnomes raiders',4160,9536,2,'highlands',49,24,2,'A roaming warband has built a camp here. Defeat its defenders for resources and commander experience. It regroups after ten minutes.',true,'gnome'),
(1542,'Human · Spartan outlaws',5056,9280,1,'highlands',31,10,2,'A roaming warband has built a camp here. Defeat its defenders for resources and commander experience. It regroups after ten minutes.',true,'spartan'),
(1543,'Dwarves warband',6080,9280,3,'highlands',127,40,4,'A roaming warband has built a camp here. Defeat its defenders for resources and commander experience. It regroups after ten minutes.',true,'dwarf'),
(1544,'Necropolis warband',7232,9536,3,'plains',93,41,22,'A roaming warband has built a camp here. Defeat its defenders for resources and commander experience. It regroups after ten minutes.',true,'undead'),
(1545,'Human · Roman outlaws',8256,8896,1,'highlands',24,10,3,'A roaming warband has built a camp here. Defeat its defenders for resources and commander experience. It regroups after ten minutes.',true,'roman'),
(1546,'Human · Persian raiders',8768,9408,2,'woods',43,29,22,'A roaming warband has built a camp here. Defeat its defenders for resources and commander experience. It regroups after ten minutes.',true,'persian'),
(1547,'Human · Persian raiders',10304,9152,2,'plains',52,37,7,'A roaming warband has built a camp here. Defeat its defenders for resources and commander experience. It regroups after ten minutes.',true,'persian'),
(1548,'Gnomes raiders',11584,8768,2,'plains',54,34,0,'A roaming warband has built a camp here. Defeat its defenders for resources and commander experience. It regroups after ten minutes.',true,'gnome'),
(1549,'Elves warband',11840,9408,3,'plains',76,42,39,'A roaming warband has built a camp here. Defeat its defenders for resources and commander experience. It regroups after ten minutes.',true,'elf'),
(1551,'Human · Persian warband',-11712,10560,3,'darkland',124,38,7,'A roaming warband has built a camp here. Defeat its defenders for resources and commander experience. It regroups after ten minutes.',true,'persian'),
(1552,'Elves marauders',-10688,9920,4,'highlands',144,63,39,'A roaming warband has built a camp here. Defeat its defenders for resources and commander experience. It regroups after ten minutes.',true,'elf'),
(1553,'Demons raiders',-9408,10304,2,'plains',62,15,3,'A roaming warband has built a camp here. Defeat its defenders for resources and commander experience. It regroups after ten minutes.',true,'demon'),
(1554,'Human · Egyptian raiders',-8640,10432,2,'highlands',75,17,6,'A roaming warband has built a camp here. Defeat its defenders for resources and commander experience. It regroups after ten minutes.',true,'egyptian'),
(1555,'Pandaren warband',-7616,10048,3,'highlands',96,46,19,'A roaming warband has built a camp here. Defeat its defenders for resources and commander experience. It regroups after ten minutes.',true,'pandaren'),
(1556,'Human · Roman raiders',-6080,10688,2,'plains',51,39,9,'A roaming warband has built a camp here. Defeat its defenders for resources and commander experience. It regroups after ten minutes.',true,'roman'),
(1557,'Elves raiders',-5184,10304,2,'plains',56,12,10,'A roaming warband has built a camp here. Defeat its defenders for resources and commander experience. It regroups after ten minutes.',true,'elf'),
(1558,'Gnomes warband',-4032,10560,3,'woods',69,23,30,'A roaming warband has built a camp here. Defeat its defenders for resources and commander experience. It regroups after ten minutes.',true,'gnome'),
(1559,'Demons warband',-3008,9792,3,'highlands',120,37,10,'A roaming warband has built a camp here. Defeat its defenders for resources and commander experience. It regroups after ten minutes.',true,'demon'),
(1560,'Elves raiders',-2496,9792,2,'highlands',37,26,25,'A roaming warband has built a camp here. Defeat its defenders for resources and commander experience. It regroups after ten minutes.',true,'elf'),
(1561,'Demons raiders',-1216,10304,2,'plains',44,26,14,'A roaming warband has built a camp here. Defeat its defenders for resources and commander experience. It regroups after ten minutes.',true,'demon'),
(1562,'Human · Roman raiders',64,10048,2,'highlands',32,25,23,'A roaming warband has built a camp here. Defeat its defenders for resources and commander experience. It regroups after ten minutes.',true,'roman'),
(1563,'Gnomes raiders',1088,10304,2,'plains',45,20,20,'A roaming warband has built a camp here. Defeat its defenders for resources and commander experience. It regroups after ten minutes.',true,'gnome'),
(1564,'Demons raiders',2496,10304,2,'woods',51,32,3,'A roaming warband has built a camp here. Defeat its defenders for resources and commander experience. It regroups after ten minutes.',true,'demon'),
(1565,'Elves warband',2880,9792,3,'desert',79,38,36,'A roaming warband has built a camp here. Defeat its defenders for resources and commander experience. It regroups after ten minutes.',true,'elf'),
(1566,'Human · Egyptian warband',3648,9792,3,'plains',67,22,32,'A roaming warband has built a camp here. Defeat its defenders for resources and commander experience. It regroups after ten minutes.',true,'egyptian'),
(1567,'Pandaren outlaws',5184,10688,1,'plains',23,11,2,'A roaming warband has built a camp here. Defeat its defenders for resources and commander experience. It regroups after ten minutes.',true,'pandaren'),
(1568,'Elves raiders',6464,9792,2,'highlands',58,30,2,'A roaming warband has built a camp here. Defeat its defenders for resources and commander experience. It regroups after ten minutes.',true,'elf'),
(1569,'Human · Roman warband',6848,10304,3,'highlands',128,28,0,'A roaming warband has built a camp here. Defeat its defenders for resources and commander experience. It regroups after ten minutes.',true,'roman'),
(1570,'Human · Roman raiders',7744,9792,2,'plains',53,26,18,'A roaming warband has built a camp here. Defeat its defenders for resources and commander experience. It regroups after ten minutes.',true,'roman'),
(1571,'Orcs raiders',9152,10304,2,'plains',40,31,22,'A roaming warband has built a camp here. Defeat its defenders for resources and commander experience. It regroups after ten minutes.',true,'orc'),
(1572,'Elves warband',10304,10304,3,'woods',80,46,5,'A roaming warband has built a camp here. Defeat its defenders for resources and commander experience. It regroups after ten minutes.',true,'elf'),
(1573,'Pandaren warband',11328,9792,3,'plains',92,20,22,'A roaming warband has built a camp here. Defeat its defenders for resources and commander experience. It regroups after ten minutes.',true,'pandaren'),
(1574,'Orcs outlaws',11968,10304,1,'plains',29,6,3,'A roaming warband has built a camp here. Defeat its defenders for resources and commander experience. It regroups after ten minutes.',true,'orc'),
(1575,'Elves marauders',-12096,11328,4,'highlands',208,55,13,'A roaming warband has built a camp here. Defeat its defenders for resources and commander experience. It regroups after ten minutes.',true,'elf'),
(1576,'Elves raiders',-11328,10816,2,'darkland',54,33,5,'A roaming warband has built a camp here. Defeat its defenders for resources and commander experience. It regroups after ten minutes.',true,'elf'),
(1577,'Human · Persian raiders',-10176,11072,2,'plains',30,26,15,'A roaming warband has built a camp here. Defeat its defenders for resources and commander experience. It regroups after ten minutes.',true,'persian'),
(1578,'Elves warband',-8768,11328,3,'plains',78,38,19,'A roaming warband has built a camp here. Defeat its defenders for resources and commander experience. It regroups after ten minutes.',true,'elf'),
(1579,'Gnomes raiders',-8128,11584,2,'plains',63,14,16,'A roaming warband has built a camp here. Defeat its defenders for resources and commander experience. It regroups after ten minutes.',true,'gnome'),
(1580,'Human · Persian raiders',-7616,10816,2,'desert',49,30,5,'A roaming warband has built a camp here. Defeat its defenders for resources and commander experience. It regroups after ten minutes.',true,'persian'),
(1581,'Orcs warband',-6592,11072,3,'desert',56,52,24,'A roaming warband has built a camp here. Defeat its defenders for resources and commander experience. It regroups after ten minutes.',true,'orc'),
(1582,'Demons outlaws',-5056,11712,1,'plains',29,18,1,'A roaming warband has built a camp here. Defeat its defenders for resources and commander experience. It regroups after ten minutes.',true,'demon'),
(1583,'Demons raiders',-4416,10816,2,'woods',38,30,26,'A roaming warband has built a camp here. Defeat its defenders for resources and commander experience. It regroups after ten minutes.',true,'demon'),
(1584,'Orcs raiders',-3520,10944,2,'woods',48,37,9,'A roaming warband has built a camp here. Defeat its defenders for resources and commander experience. It regroups after ten minutes.',true,'orc'),
(1585,'Necropolis outlaws',-2368,10816,1,'woods',27,18,1,'A roaming warband has built a camp here. Defeat its defenders for resources and commander experience. It regroups after ten minutes.',true,'undead'),
(1586,'Elves outlaws',-576,11328,1,'plains',30,5,3,'A roaming warband has built a camp here. Defeat its defenders for resources and commander experience. It regroups after ten minutes.',true,'elf'),
(1587,'Gnomes raiders',64,10816,2,'plains',37,30,24,'A roaming warband has built a camp here. Defeat its defenders for resources and commander experience. It regroups after ten minutes.',true,'gnome'),
(1588,'Necropolis warband',1088,11072,3,'plains',82,52,12,'A roaming warband has built a camp here. Defeat its defenders for resources and commander experience. It regroups after ten minutes.',true,'undead'),
(1589,'Human · Roman warband',2240,11328,3,'plains',54,51,26,'A roaming warband has built a camp here. Defeat its defenders for resources and commander experience. It regroups after ten minutes.',true,'roman'),
(1590,'Human · Roman outlaws',3520,10816,1,'plains',26,13,0,'A roaming warband has built a camp here. Defeat its defenders for resources and commander experience. It regroups after ten minutes.',true,'roman'),
(1591,'Gnomes outlaws',4032,10816,1,'desert',30,6,3,'A roaming warband has built a camp here. Defeat its defenders for resources and commander experience. It regroups after ten minutes.',true,'gnome'),
(1592,'Gnomes outlaws',5056,11328,1,'plains',30,6,2,'A roaming warband has built a camp here. Defeat its defenders for resources and commander experience. It regroups after ten minutes.',true,'gnome'),
(1593,'Pandaren raiders',6336,10816,2,'highlands',59,23,9,'A roaming warband has built a camp here. Defeat its defenders for resources and commander experience. It regroups after ten minutes.',true,'pandaren'),
(1594,'Human · Roman raiders',7616,10816,2,'highlands',53,29,17,'A roaming warband has built a camp here. Defeat its defenders for resources and commander experience. It regroups after ten minutes.',true,'roman'),
(1595,'Dwarves outlaws',8640,11328,1,'highlands',37,7,2,'A roaming warband has built a camp here. Defeat its defenders for resources and commander experience. It regroups after ten minutes.',true,'dwarf'),
(1596,'Orcs outlaws',9280,11072,1,'highlands',34,6,3,'A roaming warband has built a camp here. Defeat its defenders for resources and commander experience. It regroups after ten minutes.',true,'orc'),
(1597,'Elves outlaws',9792,11072,1,'woods',27,10,3,'A roaming warband has built a camp here. Defeat its defenders for resources and commander experience. It regroups after ten minutes.',true,'elf'),
(1598,'Necropolis outlaws',11712,10816,1,'highlands',27,6,1,'A roaming warband has built a camp here. Defeat its defenders for resources and commander experience. It regroups after ten minutes.',true,'undead'),
(1599,'Human · Roman raiders',12352,11200,2,'plains',54,14,3,'A roaming warband has built a camp here. Defeat its defenders for resources and commander experience. It regroups after ten minutes.',true,'roman'),
(1600,'Gnomes raiders',-12224,11840,2,'plains',56,32,6,'A roaming warband has built a camp here. Defeat its defenders for resources and commander experience. It regroups after ten minutes.',true,'gnome'),
(1601,'Elves raiders',-11328,11840,2,'plains',49,18,5,'A roaming warband has built a camp here. Defeat its defenders for resources and commander experience. It regroups after ten minutes.',true,'elf'),
(1602,'Gnomes raiders',-10176,12096,2,'plains',52,28,18,'A roaming warband has built a camp here. Defeat its defenders for resources and commander experience. It regroups after ten minutes.',true,'gnome'),
(1603,'Demons warband',-9152,12352,3,'woods',106,50,1,'A roaming warband has built a camp here. Defeat its defenders for resources and commander experience. It regroups after ten minutes.',true,'demon'),
(1604,'Necropolis raiders',-7744,12352,2,'plains',65,19,8,'A roaming warband has built a camp here. Defeat its defenders for resources and commander experience. It regroups after ten minutes.',true,'undead'),
(1605,'Pandaren outlaws',-7616,12736,1,'plains',20,11,3,'A roaming warband has built a camp here. Defeat its defenders for resources and commander experience. It regroups after ten minutes.',true,'pandaren'),
(1606,'Necropolis outlaws',-6080,11840,1,'desert',25,8,2,'A roaming warband has built a camp here. Defeat its defenders for resources and commander experience. It regroups after ten minutes.',true,'undead'),
(1607,'Human · Spartan raiders',-5056,12096,2,'highlands',47,20,2,'A roaming warband has built a camp here. Defeat its defenders for resources and commander experience. It regroups after ten minutes.',true,'spartan'),
(1608,'Human · Spartan raiders',-3904,12352,2,'plains',70,23,5,'A roaming warband has built a camp here. Defeat its defenders for resources and commander experience. It regroups after ten minutes.',true,'spartan'),
(1609,'Human · Spartan raiders',-3520,12096,2,'woods',48,17,6,'A roaming warband has built a camp here. Defeat its defenders for resources and commander experience. It regroups after ten minutes.',true,'spartan'),
(1610,'Human · Egyptian raiders',-2496,12352,2,'highlands',50,27,20,'A roaming warband has built a camp here. Defeat its defenders for resources and commander experience. It regroups after ten minutes.',true,'egyptian'),
(1611,'Dwarves raiders',-960,12608,2,'highlands',49,17,5,'A roaming warband has built a camp here. Defeat its defenders for resources and commander experience. It regroups after ten minutes.',true,'dwarf'),
(1612,'Pandaren warband',-320,11840,3,'plains',73,48,19,'A roaming warband has built a camp here. Defeat its defenders for resources and commander experience. It regroups after ten minutes.',true,'pandaren'),
(1613,'Human · Roman warband',1472,11840,3,'desert',114,44,13,'A roaming warband has built a camp here. Defeat its defenders for resources and commander experience. It regroups after ten minutes.',true,'roman'),
(1614,'Human · Persian raiders',2368,11840,2,'plains',66,18,11,'A roaming warband has built a camp here. Defeat its defenders for resources and commander experience. It regroups after ten minutes.',true,'persian'),
(1615,'Dwarves raiders',3136,11968,2,'plains',54,14,10,'A roaming warband has built a camp here. Defeat its defenders for resources and commander experience. It regroups after ten minutes.',true,'dwarf'),
(1616,'Human · Persian warband',3648,12096,3,'plains',96,45,32,'A roaming warband has built a camp here. Defeat its defenders for resources and commander experience. It regroups after ten minutes.',true,'persian'),
(1621,'Human · Roman warband',9280,11840,3,'highlands',104,50,20,'A roaming warband has built a camp here. Defeat its defenders for resources and commander experience. It regroups after ten minutes.',true,'roman'),
(1622,'Human · Egyptian raiders',10560,11840,2,'woods',43,31,25,'A roaming warband has built a camp here. Defeat its defenders for resources and commander experience. It regroups after ten minutes.',true,'egyptian'),
(1623,'Gnomes raiders',11328,11968,2,'woods',36,24,22,'A roaming warband has built a camp here. Defeat its defenders for resources and commander experience. It regroups after ten minutes.',true,'gnome'),
(1624,'Human · Persian raiders',11840,12352,2,'highlands',61,16,1,'A roaming warband has built a camp here. Defeat its defenders for resources and commander experience. It regroups after ten minutes.',true,'persian')
) as c(id,name,x,y,tier,terrain,infantry,archers,cavalry,description,bandit,faction)
where not exists(select 1 from public.settlements s where public.peris_cell_distance(floor(s.x/128)::integer,floor(s.y/128)::integer,floor(c.x/128)::integer,floor(c.y/128)::integer)<=1)
 and not exists(select 1 from public.peris_map_plots p where p.col=floor(c.x/128)::integer and p.row=floor(c.y/128)::integer)
 and not exists(select 1 from public.peris_settler_expeditions e where e.status='travelling' and public.peris_cell_distance(e.col,e.row,floor(c.x/128)::integer,floor(c.y/128)::integer)<=1)
on conflict(id) do update set name=excluded.name,terrain=excluded.terrain,faction=excluded.faction,bandit=true,infantry=excluded.infantry,archers=excluded.archers,cavalry=excluded.cavalry;
create or replace function public.peris_settle(p_owner uuid,p_until timestamptz default now()) returns void
language plpgsql security definer set search_path='' as $$
declare s public.settlements%rowtype;o public.peris_orders%rowtype;event record;target_slot integer;field_col integer;field_row integer;
begin
 -- Cell reservation lock precedes player locks everywhere, including offline arrivals.
 if exists(select 1 from public.peris_settler_expeditions where owner_id=p_owner and status='travelling'and arrival_at<=p_until)then perform pg_advisory_xact_lock(204200);end if;
 perform 1 from public.players where id=p_owner for update;
 if not found then return;end if;
 for s in select * from public.settlements where owner_id=p_owner order by id for update loop
 perform public.peris_city_migrate(s.id);if not s.population_ready then perform public.peris_city_economy(s.id);end if;
 end loop;
 for event in select id,finish_at as at_time,false as expedition from public.peris_orders where owner_id=p_owner and finish_at<=p_until
 union all select id,arrival_at as at_time,true as expedition from public.peris_settler_expeditions where owner_id=p_owner and status='travelling'and arrival_at<=p_until
 order by at_time,expedition,id loop
 perform public.peris_culture_accrue(p_owner,event.at_time);
 if event.expedition then perform public.peris_found_complete(event.id);continue;end if;
 select * into o from public.peris_orders where id=event.id for update;
 select * into s from public.settlements where id=coalesce(o.settlement_id,(select min(id)from public.settlements where owner_id=p_owner))and owner_id=p_owner for update;
 if s.id is null then raise exception 'The city for this order is missing';end if;
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
  update public.armies set infantry=infantry+case when o.item='infantry' then o.quantity else 0 end,
  archers=archers+case when o.item='archers' then o.quantity else 0 end,cavalry=cavalry+case when o.item='cavalry' then o.quantity else 0 end,updated_at=o.finish_at
  where owner_id=p_owner and id=coalesce(o.army_id,(select min(id)from public.armies where owner_id=p_owner));
  if not found then raise exception 'The army for this training order is missing';end if;
  update public.players set recruits=recruits+o.quantity where id=p_owner;
 end if;
 delete from public.peris_orders where id=o.id;
 end loop;
 perform public.peris_culture_accrue(p_owner,p_until);
 for s in select * from public.settlements where owner_id=p_owner order by id loop perform public.peris_population_accrue(s.id,p_until);end loop;
 update public.armies set status='idle',start_x=target_x,start_y=target_y,updated_at=p_until where owner_id=p_owner and status='moving'and arrival_at<=p_until;
end $$;
create or replace function public.peris_add_formations(p_battle bigint,p_owner uuid,p_side text,p_inf integer,p_arc integer,p_cav integer,p_morale numeric)
returns void language plpgsql security definer set search_path='' as $$
declare typ text;n integer;total integer;i integer;amount integer;px numeric;py numeric;cap integer;
begin
 foreach typ in array array['infantry','archers','cavalry'] loop
 total:=case typ when 'infantry' then p_inf when 'archers' then p_arc else p_cav end;
 cap:=case typ when 'infantry' then 60 when 'archers' then 40 else 24 end;
 n:=least(6,ceil(total::numeric/cap)::integer);if n<=0 then continue;end if;
 for i in 0..n-1 loop
 amount:=total/n+case when i<total%n then 1 else 0 end;
 px:=case when p_side='attacker' then case when typ='infantry'then 285 when typ='cavalry'then 205 else 175 end else case when typ='infantry'then 915 when typ='cavalry'then 995 else 1025 end end;
 px:=px+600*(sqrt(5)-1);
 py:=case when typ='cavalry' then case when i%2=0 then 75+(i/2)*65 else 625-(i/2)*65 end else round(350+(i-(n-1)/2.0)*least(105,490.0/greatest(1,n-1))) end;
 py:=py+350*(sqrt(5)-1);
 insert into public.battle_formations(battle_id,owner_id,side,unit_type,label,initial_soldiers,soldiers,morale,x,y,target_x,target_y,facing,columns)
 values(p_battle,p_owner,p_side,typ,(case typ when 'infantry' then 'Legionaries' when 'archers' then 'Sagittarii' else 'Equites' end)||' '||(i+1),amount,amount,least(100,p_morale),px,py,px,py,case when p_side='attacker' then 0 else 180 end,case when typ='cavalry' then 6 else 10 end);
 end loop;
 end loop;
 perform public.peris_apply_hero(p_battle,p_owner,p_side);
end $$;
create or replace function public.peris_start_raid(p_owner uuid,p_camp integer) returns bigint
language plpgsql security definer set search_path='' as $$
declare a public.armies%rowtype;c public.peris_camps%rowtype;bid bigint;mor numeric;
begin
 select * into a from public.armies where id=public.peris_army_id(p_owner) for update;
 select * into c from public.peris_camps where id=p_camp;
 if c.id is null or a.id is null then raise exception 'Army or camp not found';end if;
 if a.infantry+a.archers+a.cavalry=0 then raise exception 'Your army has no soldiers';end if;
 if exists(select 1 from public.battles where status='active' and (attacker_owner_id=p_owner or defender_owner_id=p_owner)) then raise exception 'Finish the current battle first';end if;
 if exists(select 1 from public.peris_progress where owner_id=p_owner and camp_id=p_camp and available_at>now()) then raise exception 'The camp is still regrouping';end if;
 insert into public.battles(attacker_owner_id,defender_owner_id,attacker_army_id,defender_army_id,mode,phase,camp_id,terrain,difficulty,enemy_name,defender_ready,defender_faction)
 values(p_owner,null,a.id,null,'pve','combat',c.id,public.peris_battle_terrain(c.x,c.y),case when c.tier>=4 then 'hard' when c.tier=1 then 'easy' else 'normal' end,c.name,true,c.faction) returning id into bid;
 select 90+2*level into mor from public.buildings where settlement_id=a.home_settlement_id and building_type='wall';
 perform public.peris_add_formations(bid,p_owner,'attacker',a.infantry,a.archers,a.cavalry,coalesce(mor,92));
 perform public.peris_add_formations(bid,null,'defender',c.infantry,c.archers,c.cavalry,case when c.tier>=4 then 100 when c.tier=1 then 78 else 90 end);
 update public.armies set raid_target_id=null where id=a.id;
 return bid;
end $$;

create or replace function public.sync_my_state()returns jsonb language plpgsql security definer set search_path='' as $$
declare u uuid:=auth.uid();a public.armies%rowtype;
begin
 if u is null then raise exception 'Authentication required';end if;
 perform public.peris_settle(u);
 if not exists(select 1 from public.battles where status='active'and(attacker_owner_id=u or defender_owner_id=u))then
 for a in select * from public.armies where owner_id=u and raid_target_id is not null and status='idle'order by arrival_at,id for update loop
  if exists(select 1 from public.peris_progress where owner_id=u and camp_id=a.raid_target_id and available_at>now())or a.infantry+a.archers+a.cavalry=0 then update public.armies set raid_target_id=null where id=a.id;continue;end if;
  perform set_config('peris.army_id',a.id::text,true);perform public.peris_start_raid(u,a.raid_target_id);exit;
 end loop;
 end if;
 return jsonb_build_object('ok',true);
end $$;
create or replace function public.peris_queue_upgrade(p_type text) returns jsonb language plpgsql security definer set search_path='' as $$
declare u uuid:=auth.uid();s public.settlements%rowtype;l integer;factor numeric;cw numeric;cs numeric;cf numeric;cg numeric;
begin
 if u is null then raise exception 'Authentication required';end if;
 if p_type is null or p_type not in ('market','wall','lumber','quarry','farm') then raise exception 'Choose a building plot for this building';end if;
 perform public.peris_settle(u);
 if exists(select 1 from public.battles where status='active' and (attacker_owner_id=u or defender_owner_id=u)) then raise exception 'Finish the current battle first';end if;
 select * into s from public.settlements where id=public.peris_city_id(u) for update;
 select level into l from public.buildings where settlement_id=s.id and building_type=p_type;
 if l is null then raise exception 'Building not found';end if;
 if l>=5 then raise exception 'Maximum level reached';end if;
 if exists(select 1 from public.peris_orders where owner_id=u and settlement_id=s.id and kind='upgrade') then raise exception 'Your builders are already working';end if;
 factor:=power(1.55::numeric,greatest(0,l));
 cw:=ceil((case p_type when 'lumber' then 150 when 'quarry' then 110 when 'farm' then 100 when 'market' then 140 when 'barracks' then 180 when 'stables' then 200 when 'wall' then 100 else 200 end)*factor);
 cs:=ceil((case p_type when 'lumber' then 90 when 'quarry' then 150 when 'farm' then 80 when 'market' then 130 when 'barracks' then 160 when 'stables' then 120 when 'wall' then 240 else 150 end)*factor);
 cf:=ceil((case p_type when 'lumber' then 70 when 'quarry' then 70 when 'farm' then 150 when 'market' then 80 when 'barracks' then 100 when 'stables' then 180 when 'wall' then 80 else 90 end)*factor);
 cg:=ceil((case p_type when 'lumber' then 10 when 'quarry' then 10 when 'farm' then 8 when 'market' then 25 when 'barracks' then 30 when 'stables' then 45 when 'wall' then 25 else 20 end)*factor);
 if s.wood<cw or s.stone<cs or s.food<cf or s.gold<cg then raise exception 'Your stores cannot cover this cost';end if;
 update public.settlements set wood=wood-cw,stone=stone-cs,food=food-cf,gold=gold-cg where id=s.id;
 insert into public.peris_orders(owner_id,kind,item,quantity,started_at,finish_at)values(u,'upgrade',p_type,1,now(),now()+make_interval(secs=>15+l*10));
 return jsonb_build_object('ok',true);
end $$;

create or replace function public.peris_queue_recruit(p_type text,p_quantity integer) returns jsonb language plpgsql security definer set search_path='' as $$
declare u uuid:=auth.uid();s public.settlements%rowtype;a public.armies%rowtype;l integer;at_time timestamptz;duration numeric;cw integer;cs integer;cf integer;cg integer;queued integer;
begin
 if u is null then raise exception 'Authentication required';end if;
 if p_type is null or p_type not in ('infantry','archers','cavalry') or p_quantity is null or p_quantity<1 or p_quantity>200 then raise exception 'Choose between 1 and 200 soldiers';end if;
 perform public.peris_settle(u);
 if exists(select 1 from public.battles where status='active' and (attacker_owner_id=u or defender_owner_id=u)) then raise exception 'Finish the current battle first';end if;
 select * into s from public.settlements where id=public.peris_city_id(u) for update;
 select * into a from public.armies where id=public.peris_army_id(u) for update;
 if s.id is null or a.id is null then raise exception 'Realm not found';end if;
 if a.status='moving' or sqrt(power(a.target_x-s.x-40,2)+power(a.target_y-s.y-30,2))>90 then raise exception 'Bring your army home to recruit';end if;
 if (select count(*) from public.peris_orders where owner_id=u and army_id=public.peris_army_id(u) and kind='recruit')>=3 then raise exception 'Training queue is full';end if;
 select coalesce(sum(quantity),0) into queued from public.peris_orders where owner_id=u and army_id=public.peris_army_id(u) and kind='recruit';
 if a.infantry+a.archers+a.cavalry+queued+p_quantity>1000 then raise exception 'Army capacity is 1,000 soldiers';end if;
 cw:=p_quantity*case when p_type='archers' then 6 else 4 end;cs:=p_quantity*case when p_type='cavalry' then 7 else 2 end;
 cf:=p_quantity*case p_type when 'infantry' then 6 when 'archers' then 5 else 12 end;cg:=p_quantity*case p_type when 'infantry' then 1 when 'archers' then 2 else 4 end;
 if s.wood<cw or s.stone<cs or s.food<cf or s.gold<cg then raise exception 'Your stores cannot cover this cost';end if;
 select coalesce(sum(level),0) into l from public.peris_city_slots where settlement_id=s.id and building_type=case when p_type='cavalry' then 'stables' else 'barracks' end;
 if l=0 then raise exception 'Build barracks or stables first';end if;
 select greatest(now(),coalesce(max(finish_at),now())) into at_time from public.peris_orders where owner_id=u and army_id=public.peris_army_id(u) and kind='recruit';
 duration:=greatest(5,ceil(p_quantity*case when p_type='cavalry' then 5 else 2 end/(1+(coalesce(l,1)-1)*0.18)));
 update public.settlements set wood=wood-cw,stone=stone-cs,food=food-cf,gold=gold-cg where id=s.id;
 insert into public.peris_orders(owner_id,kind,item,quantity,started_at,finish_at)values(u,'recruit',p_type,p_quantity,at_time,at_time+make_interval(secs=>duration::double precision));
 return jsonb_build_object('ok',true);
end $$;

create or replace function public.peris_march(p_target_x integer,p_target_y integer,p_path jsonb)returns jsonb
language plpgsql security definer set search_path='' as $$
declare u uuid:=auth.uid();a public.armies%rowtype;position jsonb;point jsonb;route jsonb;
 tx integer:=public.peris_wrap_world(p_target_x);ty integer:=public.peris_wrap_world(p_target_y);
 x numeric;y numeric;px numeric;py numeric;cx integer;cy integer;pcx integer;pcy integer;
 distance numeric:=0;segment numeric;seconds numeric;count_points integer;ordinal integer:=0;
begin
 if u is null then raise exception 'Authentication required';end if;
 if p_target_x is null or p_target_y is null then raise exception 'Choose a destination';end if;
 if p_path is null or jsonb_typeof(p_path)<>'array' then raise exception 'Choose a valid land route';end if;
 count_points:=jsonb_array_length(p_path);
 if count_points<2 or count_points>2000 then raise exception 'A march needs 2-2000 route points';end if;
 perform public.peris_settle(u);
 if exists(select 1 from public.battles where status='active' and (attacker_owner_id=u or defender_owner_id=u)) then raise exception 'Finish the current battle first';end if;
 if exists(select 1 from public.peris_orders where owner_id=u and army_id=public.peris_army_id(u) and kind='recruit') then raise exception 'Let training finish before marching';end if;
 select * into a from public.armies where id=public.peris_army_id(u) for update;
 if a.id is null then raise exception 'Army not found';end if;
 position:=public.peris_army_position(a);
 px:=(position->>'x')::numeric;py:=(position->>'y')::numeric;
 if not public.peris_world_walkable(px,py) then raise exception 'The army must start on land';end if;
 pcx:=floor(px/128)::integer;pcy:=floor(py/128)::integer;
 route:=jsonb_build_array(jsonb_build_array(px,py));
 for point in select value from jsonb_array_elements(p_path)with ordinality as points(value,sequence)order by sequence loop
  ordinal:=ordinal+1;
  if jsonb_typeof(point)<>'array' then raise exception 'Choose a valid land route';end if;
  if jsonb_array_length(point)<>2 or jsonb_typeof(point->0)<>'number' or jsonb_typeof(point->1)<>'number' then raise exception 'Route points must be numeric coordinate pairs';end if;
  x:=(point->>0)::numeric;y:=(point->>1)::numeric;
  if x<-12800 or x>=12800 or y<-12800 or y>=12800 then raise exception 'Route leaves the world';end if;
  cx:=floor(x/128)::integer;cy:=floor(y/128)::integer;
  if ordinal=1 then
   if abs(public.peris_wrap_cell(cx-pcx))>1 or abs(public.peris_wrap_cell(cy-pcy))>1 then raise exception 'Route does not start at your army';end if;
   continue;
  end if;
  if abs(public.peris_wrap_cell(cx-pcx))>1 or abs(public.peris_wrap_cell(cy-pcy))>1 then raise exception 'Route points must pass through neighboring fields';end if;
  if not public.peris_world_walkable(x,y) then raise exception 'Armies cannot march across the sea';end if;
  if cx<>pcx and cy<>pcy and (not public.peris_world_walkable((cx+.5)*128,(pcy+.5)*128) or not public.peris_world_walkable((pcx+.5)*128,(cy+.5)*128)) then
   raise exception 'A route cannot cut a sea corner';
  end if;
  segment:=sqrt(power(public.peris_wrapped_delta(px,x),2)+power(public.peris_wrapped_delta(py,y),2));
  if segment=0 and count_points>2 then raise exception 'A route must advance through its fields';end if;
  distance:=distance+segment;route:=route||jsonb_build_array(jsonb_build_array(x,y));
  px:=x;py:=y;pcx:=cx;pcy:=cy;
 end loop;
 if px<>tx or py<>ty then raise exception 'Route must end at the chosen destination';end if;
 seconds:=greatest(2,distance/(22*(public.peris_hero_bonuses(a.id)->>'speed')::numeric));
 update public.armies set start_x=round((position->>'x')::numeric),start_y=round((position->>'y')::numeric),target_x=tx,target_y=ty,
  march_path=route,march_distance=distance,march_map_version=4,departure_at=now(),arrival_at=now()+make_interval(secs=>seconds::double precision),
  status='moving',raid_target_id=null,updated_at=now() where id=a.id;
 return jsonb_build_object('ok',true);
end $$;
-- Compatibility RPCs and raids still use the straight route. Sample every half
-- field so all traversed cells are validated by the authoritative land marcher.
create or replace function public.move_army(p_target_x integer,p_target_y integer)returns jsonb
language plpgsql security definer set search_path='' as $$
declare u uuid:=auth.uid();a public.armies%rowtype;position jsonb;route jsonb;x numeric;y numeric;
 tx integer:=greatest(-12736,least(12736,p_target_x));ty integer:=greatest(-12736,least(12736,p_target_y));steps integer;i integer;
begin
 if u is null then raise exception 'Authentication required';end if;
 if p_target_x is null or p_target_y is null then raise exception 'Choose a destination';end if;
 perform public.peris_settle(u);
 select * into a from public.armies where id=public.peris_army_id(u) for update;
 if a.id is null then raise exception 'Army not found';end if;
 position:=public.peris_army_position(a);x:=(position->>'x')::numeric;y:=(position->>'y')::numeric;
 steps:=greatest(1,ceil(greatest(abs(tx-x),abs(ty-y))/64)::integer);
 route:=jsonb_build_array(jsonb_build_array(x,y));
 for i in 1..steps loop
  route:=route||jsonb_build_array(case when i=steps then jsonb_build_array(tx,ty)else jsonb_build_array(x+(tx-x)*i/steps,y+(ty-y)*i/steps)end);
 end loop;
 return public.peris_march(tx,ty,route);
end $$;

create or replace function public.peris_raid(p_camp_id integer) returns jsonb language plpgsql security definer set search_path='' as $$
declare u uuid:=auth.uid();c public.peris_camps%rowtype;a public.armies%rowtype;
begin
 if u is null then raise exception 'Authentication required';end if;
 select * into c from public.peris_camps where id=p_camp_id;if c.id is null then raise exception 'Camp not found';end if;
 perform public.peris_settle(u);
 select * into a from public.armies where id=public.peris_army_id(u) for update;if a.id is null or a.infantry+a.archers+a.cavalry=0 then raise exception 'Recruit soldiers before starting a raid';end if;
 if exists(select 1 from public.peris_progress where owner_id=u and camp_id=p_camp_id and available_at>now()) then raise exception 'The camp is still regrouping';end if;
 perform public.move_army(c.x,c.y);update public.armies set raid_target_id=c.id where id=a.id;
 return jsonb_build_object('ok',true);
end $$;

create or replace function public.peris_ready(p_battle_id bigint) returns jsonb language plpgsql security definer set search_path='' as $$
declare u uuid:=auth.uid();b public.battles%rowtype;
begin
 select * into b from public.battles where id=p_battle_id for update;
 if u is null or b.id is null or (u is distinct from b.attacker_owner_id and u is distinct from b.defender_owner_id) then raise exception 'Not your battle';end if;
 if b.status='active'and b.phase='deployment'then update public.battles set phase='combat',attacker_ready=true,defender_ready=true,last_tick_at=now()where id=b.id;end if;
 return jsonb_build_object('ok',true);
end $$;
create or replace function public.peris_order(p_battle_id bigint,p_order jsonb) returns jsonb language plpgsql security definer set search_path='' as $$
declare u uuid:=auth.uid();b public.battles%rowtype;f public.battle_formations%rowtype;t public.battle_formations%rowtype;k text:=p_order->>'kind';px numeric;py numeric;n integer;i integer:=0;col integer;face numeric;cx numeric;cy numeric;spacing numeric;ang numeric;
begin
 select * into b from public.battles where id=p_battle_id for update;
 if u is null or b.id is null or (u is distinct from b.attacker_owner_id and u is distinct from b.defender_owner_id) then raise exception 'Not your battle';end if;
 if b.status<>'active' then raise exception 'Battle has ended';end if;
 if p_order is null or k is null or k not in ('move','attack','halt','stance','run','fire','width') then raise exception 'Invalid order';end if;
 if jsonb_typeof(p_order->'ids') is distinct from 'array' then raise exception 'Select a formation';end if;
 select count(*) into n from public.battle_formations where battle_id=b.id and owner_id=u and soldiers>0 and status<>'routed'
 and id in(select value::bigint from jsonb_array_elements_text(p_order->'ids'));
 if n<1 then raise exception 'Select a formation that can receive orders';end if;
 select avg(x),avg(y) into cx,cy from public.battle_formations where battle_id=b.id and owner_id=u and soldiers>0 and status<>'routed' and id in(select value::bigint from jsonb_array_elements_text(p_order->'ids'));
 spacing:=least(620.0/greatest(1,n-1),coalesce((p_order->>'columns')::integer,10)*8+24);
 ang:=coalesce((p_order->>'facing')::numeric,0)*pi()/180;
 if k='attack' then
 if b.phase<>'combat' then raise exception 'Begin the battle before attacking';end if;
 select * into t from public.battle_formations where id=(p_order->>'target')::bigint and battle_id=b.id;
 if t.id is null or t.owner_id=u or t.soldiers<=0 or t.status='routed' then raise exception 'Choose an enemy formation';end if;
 end if;
 if k='stance' and coalesce(p_order->>'stance','') not in ('balanced','guard','aggressive') then raise exception 'Invalid stance';end if;
 for f in select * from public.battle_formations where battle_id=b.id and owner_id=u and soldiers>0 and status<>'routed'
 and id in(select value::bigint from jsonb_array_elements_text(p_order->'ids')) order by id for update loop
 if k='move' then
 if p_order->>'x' is null or p_order->>'y' is null then raise exception 'Choose a destination';end if;
 px:=greatest(35,least(1165,(p_order->>'x')::numeric+case when p_order->>'facing' is null then f.x-cx else -sin(ang)*(i-(n-1)/2.0)*spacing end));
 py:=greatest(40,least(660,(p_order->>'y')::numeric+case when p_order->>'facing' is null then f.y-cy else cos(ang)*(i-(n-1)/2.0)*spacing end));
 if b.phase='deployment' and ((f.side='attacker' and px>365)or(f.side='defender' and px<835)) then raise exception 'Deploy inside your shaded zone';end if;
 face:=(p_order->>'facing')::numeric;col:=greatest(4,least(20,coalesce((p_order->>'columns')::integer,f.columns)));
 update public.battle_formations set target_x=px,target_y=py,target_facing=face,target_formation_id=null,charge_ready=false,columns=col,
 x=case when b.phase='deployment' then px else battle_formations.x end,y=case when b.phase='deployment' then py else battle_formations.y end,
 facing=case when b.phase='deployment' then coalesce(face,facing) else facing end,status=case when b.phase='deployment' then 'idle' else 'moving' end,updated_at=now() where id=f.id;
 elsif k='attack' then
 update public.battle_formations set target_formation_id=t.id,target_x=t.x,target_y=t.y,status='moving',target_facing=null,
 charge_ready=unit_type='cavalry' and stamina>35 and sqrt(power(t.x-x,2)+power(t.y-y,2))>140,updated_at=now() where id=f.id;
 elsif k='halt' then update public.battle_formations set target_formation_id=null,target_x=x,target_y=y,status='idle',charge_ready=false where id=f.id;
 elsif k='stance' then update public.battle_formations set stance=p_order->>'stance' where id=f.id;
 elsif k='run' then update public.battle_formations set running=coalesce((p_order->>'enabled')::boolean,not running) where id=f.id;
 elsif k='fire' then update public.battle_formations set fire_at_will=coalesce((p_order->>'enabled')::boolean,not fire_at_will) where id=f.id;
 elsif k='width' then update public.battle_formations set columns=greatest(4,least(20,(p_order->>'columns')::integer)) where id=f.id;
 end if;i:=i+1;
 end loop;
 return jsonb_build_object('ok',true);
end $$;

create or replace function public.peris_ground(p_terrain text,px numeric,py numeric) returns jsonb language sql immutable set search_path='' as $$
 select case
 when p_terrain='woods' and ((nx>260 and nx<650 and ny>45 and ny<310)or(nx>660 and nx<1040 and ny>405 and ny<665)) then '{"kind":"Forest","speed":0.68,"cover":0.6,"height":0}'::jsonb
 when p_terrain='highlands' and power((nx-650)/240,2)+power((ny-285)/180,2)<1 then '{"kind":"High ground","speed":0.85,"cover":1,"height":1}'::jsonb
 when p_terrain='river' and abs(nx-(600+sin(ny/110)*32))<42 and (ny<306 or ny>395) then '{"kind":"Shallows","speed":0.42,"cover":1,"height":0}'::jsonb
 when p_terrain='marsh' and sin(nx/95)+cos(ny/70)>.3 then '{"kind":"Marsh","speed":0.62,"cover":0.9,"height":0}'::jsonb
 when p_terrain='snow' then '{"kind":"Snow","speed":0.88,"cover":1,"height":0}'::jsonb
 when p_terrain='desert' then '{"kind":"Sand","speed":0.9,"cover":1,"height":0}'::jsonb
 when p_terrain='coast' then '{"kind":"Coastal ground","speed":1,"cover":1,"height":0}'::jsonb
 when p_terrain='farmland' then '{"kind":"Farmland","speed":1,"cover":1,"height":0}'::jsonb
 when p_terrain='darkland' then '{"kind":"Volcanic ground","speed":1,"cover":1,"height":0}'::jsonb
 else '{"kind":"Open ground","speed":1,"cover":1,"height":0}'::jsonb end from(select px/sqrt(5) nx,py/sqrt(5) ny) coordinates;
$$;

create or replace function public.peris_finish(p_bid bigint,p_winner text,p_reason text) returns void
language plpgsql security definer set search_path='' as $$
declare b public.battles%rowtype;ai integer;di integer;asur integer;dsur integer;r jsonb;loot jsonb:='{"wood":0,"stone":0,"food":0,"gold":0}';tier integer;u uuid;name text;a public.armies%rowtype;s public.settlements%rowtype;winner uuid;
begin
 select * into b from public.battles where id=p_bid for update;if b.id is null or b.status='resolved' then return;end if;
 select coalesce(sum(initial_soldiers)filter(where side='attacker'),0),coalesce(sum(initial_soldiers)filter(where side='defender'),0),
 coalesce(sum(soldiers)filter(where side='attacker'),0),coalesce(sum(soldiers)filter(where side='defender'),0) into ai,di,asur,dsur from public.battle_formations where battle_id=b.id;
 winner:=case p_winner when 'attacker' then b.attacker_owner_id when 'defender' then b.defender_owner_id else null end;
 -- A due colony takes the shared land lock before player locks, matching founding commands.
 if exists(select 1 from public.peris_settler_expeditions where owner_id in(b.attacker_owner_id,b.defender_owner_id)and status='travelling'and arrival_at<=now())then perform pg_advisory_xact_lock(204200);end if;
 -- Acquire both player locks in a stable order, even when two battles finish concurrently.
 perform 1 from public.players where id in(b.attacker_owner_id,b.defender_owner_id) order by id for update;
 if b.mode='pve' and p_winner='attacker' then
 select c.tier into tier from public.peris_camps c where id=b.camp_id;
 loot:=jsonb_build_object('wood',180*tier,'stone',140*tier,'food',220*tier,'gold',60*tier);
 insert into public.peris_progress(owner_id,camp_id,defeated,available_at) values(b.attacker_owner_id,b.camp_id,1,now()+case when (select bandit from public.peris_camps where id=b.camp_id)then interval '10 minutes'else interval '2 minutes'end)
 on conflict(owner_id,camp_id)do update set defeated=peris_progress.defeated+1,available_at=excluded.available_at;
 end if;
 r:=jsonb_build_object('attacker_initial',ai,'defender_initial',di,'attacker_survivors',asur,'defender_survivors',dsur,'attacker_losses',ai-asur,'defender_losses',di-dsur,'loot',loot,'duration',round(b.elapsed),'reason',p_reason);
 update public.battles set status='resolved',phase='finished',winner_side=p_winner,winner_owner_id=winner,ended_at=now(),result=r where id=b.id;
 for u in select id from public.players where id in(b.attacker_owner_id,b.defender_owner_id) order by id loop
 perform public.peris_settle(u);
 select * into a from public.armies where id=case when u=b.attacker_owner_id then b.attacker_army_id else b.defender_army_id end;
 select * into s from public.settlements where id=a.home_settlement_id;
 update public.armies a0 set
 infantry=coalesce((select sum(soldiers) from public.battle_formations where battle_id=b.id and owner_id=u and unit_type='infantry'),0),
 archers=coalesce((select sum(soldiers) from public.battle_formations where battle_id=b.id and owner_id=u and unit_type='archers'),0),
 cavalry=coalesce((select sum(soldiers) from public.battle_formations where battle_id=b.id and owner_id=u and unit_type='cavalry'),0),
 status='idle',raid_target_id=null,start_x=s.x+40,start_y=s.y+30,target_x=s.x+40,target_y=s.y+30,arrival_at=now(),departure_at=now(),updated_at=now() where id=a.id;
 if u=winner then update public.players set victories=victories+1,prestige=prestige+coalesce(tier,1)*25 where id=u;end if;
 if u=b.attacker_owner_id and b.mode='pve' and p_winner='attacker' then
 update public.settlements set wood=least(capacity,wood+(loot->>'wood')::integer),stone=least(capacity,stone+(loot->>'stone')::integer),
 food=least(food_capacity,food+(loot->>'food')::integer),gold=least(capacity,gold+(loot->>'gold')::integer)where id=s.id;
 end if;
 perform public.peris_hero_reward(a.id,case when u=b.attacker_owner_id then (di-dsur)*2 else(ai-asur)*2 end+case when u=winner then 50 else 20 end,case when u=winner and b.mode='pve'then b.camp_id else null end);
 name:=case when b.mode='pve' then b.enemy_name else 'Duel against '||coalesce((select display_name from public.players where id=case when u=b.attacker_owner_id then b.defender_owner_id else b.attacker_owner_id end),'rival') end;
 insert into public.peris_reports(owner_id,battle_id,title,won,result)values(u,b.id,name,coalesce(u=winner,false),r)on conflict(owner_id,battle_id)do nothing;
 end loop;
end $$;

create or replace function public.peris_tick(p_battle_id bigint)returns jsonb language plpgsql security definer set search_path='' as $$
declare u uuid:=auth.uid();b public.battles%rowtype;f public.battle_formations%rowtype;t public.battle_formations%rowtype;threat public.battle_formations%rowtype;
 bw numeric:=1200*sqrt(5);bh numeric:=700*sqrt(5);remain numeric;processed numeric;dt numeric;dx numeric;dy numeric;distance numeric;speed numeric;reach numeric;move_step numeric;direction numeric;turn numeric;contact numeric;minimum numeric;push numeric;interval_sec numeric;ranged boolean;
 gf jsonb;gt jsonb;snapshot jsonb;positions jsonb;correction jsonb;pending jsonb;entry jsonb;pair record;rate numeric;flank numeric;charge numeric;matchup numeric;stance_mult numeric;brace numeric;cover numeric;elevation numeric;melee_arc numeric;defence numeric;difficulty_mult numeric;relative numeric;damage numeric;cas integer;mor_loss numeric;alive_a integer;alive_d integer;strength_a integer;strength_d integer;own_side text;average numeric;
begin
 select * into b from public.battles where id=p_battle_id for update;
 if u is null or b.id is null or(u is distinct from b.attacker_owner_id and u is distinct from b.defender_owner_id)then raise exception 'Not your battle';end if;
 if b.status<>'active'then return jsonb_build_object('ok',true);end if;
 if b.phase='deployment'then b.phase:='combat';update public.battles set phase='combat',attacker_ready=true,defender_ready=true where id=b.id;end if;
 remain:=least(10,greatest(0,extract(epoch from(now()-b.last_tick_at))));
 if remain<.15 then return jsonb_build_object('ok',true);end if;
 processed:=remain;update public.battles set last_tick_at=last_tick_at+make_interval(secs=>processed::double precision)where id=b.id;
 while remain>0 loop
 dt:=least(.1,remain);remain:=remain-dt;b.elapsed:=b.elapsed+dt;
 if b.elapsed<=dt or floor(b.elapsed*2)<>floor((b.elapsed-dt)*2)then perform public.peris_auto_orders(b.id);end if;
 select jsonb_object_agg(id::text,to_jsonb(q))into snapshot from(select * from public.battle_formations where battle_id=b.id)q;
 positions:='{}';
 -- Plan both sides from one immutable position snapshot, then commit together.
 for f in select * from public.battle_formations where battle_id=b.id and soldiers>0 order by id loop
 if f.status='routed'then f.x:=greatest(12,least(bw-12,f.x+case when f.side='attacker'then -1 else 1 end*64*dt));f.facing:=case when f.side='attacker'then 180 else 0 end;
 else
 t:=jsonb_populate_record(null::public.battle_formations,snapshot->f.target_formation_id::text);
 if t.id is null or t.soldiers<=0 or t.status='routed'then f.target_formation_id:=null;f.target_x:=f.x;f.target_y:=f.y;f.status:='idle';
 else
 dx:=t.x-f.x;dy:=t.y-f.y;distance:=sqrt(dx*dx+dy*dy);contact:=public.peris_contact(f,t);
 f.target_x:=t.x;f.target_y:=t.y;reach:=case when f.unit_type='archers'then 208 else contact end;
 select * into threat from jsonb_populate_recordset(null::public.battle_formations,(select jsonb_agg(value)from jsonb_each(snapshot)))e where e.side<>f.side and e.soldiers>0 and e.status<>'routed'and e.unit_type<>'archers'order by power(e.x-f.x,2)+power(e.y-f.y,2),e.id limit 1;
 if f.unit_type='archers'and threat.id is not null and sqrt(power(threat.x-f.x,2)+power(threat.y-f.y,2))<public.peris_contact(f,threat)+65 then
 distance:=greatest(1,sqrt(power(threat.x-f.x,2)+power(threat.y-f.y,2)));
 f.target_x:=greatest(40,least(bw-40,f.x+(f.x-threat.x)/distance*85));f.target_y:=greatest(45,least(bh-45,f.y+(f.y-threat.y)/distance*85));
 if sqrt(power(f.target_x-f.x,2)+power(f.target_y-f.y,2))>12 then reach:=0;else f.target_x:=t.x;f.target_y:=t.y;reach:=contact;end if;
 elsif f.unit_type='cavalry'and distance>240 and abs(f.y-t.y)<85 then
 f.target_y:=greatest(65,least(bh-65,t.y+case when f.y<bh/2 then -120 else 120 end));f.target_x:=t.x+case when f.side='attacker'then -145 else 145 end;reach:=0;
 end if;
 dx:=f.target_x-f.x;dy:=f.target_y-f.y;distance:=sqrt(dx*dx+dy*dy);
 direction:=degrees(atan2(case when distance>reach+2 then dy else t.y-f.y end,case when distance>reach+2 then dx else t.x-f.x end));
 turn:=direction-f.facing;turn:=turn-360*floor((turn+180)/360);f.facing:=f.facing+greatest(-120*dt,least(120*dt,turn));
 gf:=public.peris_ground(b.terrain,f.x,f.y);
 if distance>reach+2 then
 turn:=direction-f.facing;turn:=abs(turn-360*floor((turn+180)/360));
 speed:=(case f.unit_type when 'cavalry'then 76 when 'archers'then 34 else 40 end)*f.magic_speed*(gf->>'speed')::numeric*(case when f.unit_type='cavalry'and gf->>'kind'='Forest'then .65 else 1 end)*(case when f.running and f.stamina>8 then 1.35 else 1 end)*(case when f.stamina<15 then .75 else 1 end)*(case when turn>75 then .25 when turn>40 then .65 else 1 end);
 move_step:=least(speed*dt,greatest(0,distance-reach));f.x:=greatest(35,least(bw-35,f.x+dx/distance*move_step));f.y:=greatest(45,least(bh-45,f.y+dy/distance*move_step));f.status:='moving';f.stamina:=greatest(0,least(100,f.stamina-case when f.running then 1.4 else .1 end*dt));
 if f.unit_type='cavalry'and f.running and gf->>'kind'<>'Forest'and turn<40 then f.charge_distance:=f.charge_distance+move_step;if f.charge_distance>=100 and f.stamina>35 then f.charge_ready:=true;end if;end if;
 else f.status:='engaged';f.running:=false;f.stamina:=greatest(0,least(100,f.stamina-case when f.unit_type='archers'then .12 else .3 end*dt));end if;
 end if;end if;
 positions:=jsonb_set(positions,array[f.id::text],to_jsonb(f),true);
 end loop;
 for pair in select key,value from jsonb_each(positions)loop
 f:=jsonb_populate_record(null::public.battle_formations,pair.value);
 update public.battle_formations set x=f.x,y=f.y,facing=f.facing,target_x=f.target_x,target_y=f.target_y,target_formation_id=f.target_formation_id,status=f.status,running=f.running,stamina=f.stamina,charge_ready=f.charge_ready,charge_distance=f.charge_distance,updated_at=now()where id=f.id;
 end loop;
 -- Symmetric soft separation based on the actual regiment footprint.
 correction:='{}';
 for f in select * from public.battle_formations where battle_id=b.id and soldiers>0 and status<>'routed'order by id loop
 for t in select * from public.battle_formations where battle_id=b.id and id>f.id and soldiers>0 and status<>'routed'order by id loop
 dx:=t.x-f.x;dy:=t.y-f.y;distance:=sqrt(dx*dx+dy*dy);if distance<.001 then dx:=0;dy:=1;distance:=1;end if;
 minimum:=public.peris_extent(f,dx,dy)+public.peris_extent(t,-dx,-dy)+case when f.side=t.side then 10 else 4 end;
 if distance>=minimum then continue;end if;push:=least((minimum-distance)*.5,50*dt);dx:=dx/distance*push;dy:=dy/distance*push;
 entry:=coalesce(correction->f.id::text,'{"x":0,"y":0}'::jsonb);correction:=jsonb_set(correction,array[f.id::text],jsonb_build_object('x',(entry->>'x')::numeric-dx,'y',(entry->>'y')::numeric-dy),true);
 entry:=coalesce(correction->t.id::text,'{"x":0,"y":0}'::jsonb);correction:=jsonb_set(correction,array[t.id::text],jsonb_build_object('x',(entry->>'x')::numeric+dx,'y',(entry->>'y')::numeric+dy),true);
 end loop;end loop;
 for pair in select key,value from jsonb_each(correction)loop update public.battle_formations set x=greatest(35,least(bw-35,x+(pair.value->>'x')::numeric)),y=greatest(45,least(bh-45,y+(pair.value->>'y')::numeric))where id=pair.key::bigint;end loop;
 -- Accumulate attacks into a map, then apply both armies' losses together.
 pending:='{}'::jsonb;
 for f in select * from public.battle_formations where battle_id=b.id and soldiers>0 and status<>'routed' and target_formation_id is not null order by id loop
 select * into t from public.battle_formations where id=f.target_formation_id;if t.id is null or t.status='routed' or t.soldiers=0 then continue;end if;
 dx:=t.x-f.x;dy:=t.y-f.y;distance:=sqrt(dx*dx+dy*dy);reach:=case when f.unit_type='archers'then 220 else public.peris_contact(f,t)end;
 if distance>reach+4 or b.elapsed<f.attack_ready_at then continue;end if;
 ranged:=f.unit_type='archers'and distance>public.peris_contact(f,t)+20;
 if ranged and f.status='moving'then continue;end if;
 direction:=degrees(atan2(t.y-f.y,t.x-f.x))-f.facing;direction:=abs(direction-360*floor((direction+180)/360));if direction>65 then continue;end if;
 interval_sec:=case when ranged then 2.5 when f.unit_type='cavalry'then 1.4 else 1.2 end;
 if f.damage_target_id is distinct from t.id then f.damage_pool:=0;end if;
 gf:=public.peris_ground(b.terrain,f.x,f.y);gt:=public.peris_ground(b.terrain,t.x,t.y);
 relative:=degrees(atan2(f.y-t.y,f.x-t.x))-t.facing;relative:=abs(relative-360*floor((relative+180)/360));
 flank:=case when ranged then 1 when relative>135 then 1.65 when relative>65 then 1.28 else 1 end;
 charge:=case when f.charge_ready and f.unit_type='cavalry' and gf->>'kind'<>'Forest' then 2.4 else 1 end;
 matchup:=case when f.unit_type='cavalry' then case when t.unit_type='archers' then 1.65 else 0.9 end when f.unit_type='infantry' then case when t.unit_type='cavalry' then 1.25 else 1 end else case when t.unit_type='cavalry' then 0.75 else 1 end end;
 stance_mult:=case f.stance when 'aggressive' then 1.22 when 'guard' then 0.9 else 1 end;
 brace:=case when t.stance='guard' and t.unit_type='infantry' and relative<65 and f.unit_type='cavalry' then 0.5 else 1 end;
 defence:=case t.stance when 'guard' then 0.8 when 'aggressive' then 1.15 else 1 end;
 cover:=case when ranged then (gt->>'cover')::numeric else 1 end;
 elevation:=case when ranged and (gf->>'height')::numeric>(gt->>'height')::numeric then 1.25 when ranged and (gf->>'height')::numeric<(gt->>'height')::numeric then 0.8 else 1 end;
 melee_arc:=case when f.unit_type='archers'and not ranged then 0.28 else 1 end;
 difficulty_mult:=1;
 rate:=case f.unit_type when 'infantry' then 0.020 when 'archers' then 0.012 else 0.031 end;
 damage:=f.damage_pool+f.soldiers*f.attack_multiplier*f.magic_attack*(1-t.magic_defence)*rate*matchup*stance_mult*defence*brace*flank*charge*cover*elevation*melee_arc*difficulty_mult*(0.55+f.stamina/220)*interval_sec/t.defence_multiplier;
 if charge>1 then damage:=damage+f.soldiers*0.06*brace*flank*(1-t.magic_defence)/t.defence_multiplier;end if;
 cas:=least(greatest(0,t.soldiers-coalesce((pending->t.id::text->>'loss')::integer,0)),floor(damage)::integer);mor_loss:=cas::numeric/greatest(1,t.initial_soldiers)*125+case when flank>1 then cas::numeric/greatest(1,t.initial_soldiers)*35 else 0 end+case when charge>1 then 8 else 0 end;
 update public.battle_formations set damage_pool=mod(damage-cas,1),damage_target_id=t.id,attack_ready_at=b.elapsed+interval_sec,kills=kills+cas,charge_distance=case when charge>1 then 0 else charge_distance end,charge_ready=case when charge>1 then false else charge_ready end,
 stamina=case when charge>1 then greatest(0,stamina-12) else stamina end where id=f.id;
 entry:=coalesce(pending->t.id::text,'{"loss":0,"morale":0}'::jsonb);
 pending:=jsonb_set(pending,array[t.id::text],jsonb_build_object('loss',(entry->>'loss')::integer+cas,'morale',(entry->>'morale')::numeric+mor_loss),true);
 end loop;
 for pair in select key,value from jsonb_each(pending) loop
 update public.battle_formations set soldiers=greatest(0,soldiers-(pair.value->>'loss')::integer),morale=greatest(0,morale-(pair.value->>'morale')::numeric) where id=pair.key::bigint;
 update public.battle_formations set status='routed',target_formation_id=null where id=pair.key::bigint and (soldiers=0 or morale<18);
 end loop;

 -- One automatic rally per side, with morale weighted by remaining manpower.
 foreach own_side in array array['attacker','defender']loop
 if (case when own_side='attacker'then b.rally_attacker else b.rally_defender end) then continue;end if;
 select sum(morale*soldiers)/nullif(sum(soldiers),0)into average from public.battle_formations where battle_id=b.id and side=own_side and soldiers>0;
 if average<42 then
 update public.battle_formations set morale=least(100,morale+25),status=case when status='routed'then 'idle'else status end,target_x=case when status='routed'then x else target_x end,target_y=case when status='routed'then y else target_y end where battle_id=b.id and side=own_side and soldiers>0;
 if own_side='attacker'then b.rally_attacker:=true;else b.rally_defender:=true;end if;
 end if;
 end loop;
 update public.battles set elapsed=b.elapsed,rally_attacker=b.rally_attacker,rally_defender=b.rally_defender where id=b.id;
 perform public.peris_auto_magic(b.id);select * into b from public.battles where id=b.id;
 if b.status<>'active'then exit;end if;
 select count(*)filter(where side='attacker'),count(*)filter(where side='defender'),coalesce(sum(soldiers)filter(where side='attacker'),0),coalesce(sum(soldiers)filter(where side='defender'),0)
 into alive_a,alive_d,strength_a,strength_d from public.battle_formations where battle_id=b.id and soldiers>0 and status<>'routed';
 if alive_a=0 or alive_d=0 then perform public.peris_finish(b.id,case when alive_a>0 then 'attacker'when alive_d>0 then 'defender'else 'draw'end,'Army routed');exit;end if;
 if b.elapsed>=900 then perform public.peris_finish(b.id,case when strength_a>strength_d then 'attacker'when strength_d>strength_a then 'defender'else 'draw'end,'Time limit');exit;end if;
 end loop;
 return jsonb_build_object('ok',true);
end $$;
create or replace function public.peris_rally(p_battle_id bigint) returns jsonb language plpgsql security definer set search_path='' as $$
declare u uuid:=auth.uid();b public.battles%rowtype;side_name text;
begin
 select * into b from public.battles where id=p_battle_id for update;
 if u is null or b.id is null or (u is distinct from b.attacker_owner_id and u is distinct from b.defender_owner_id)then raise exception 'Not your battle';end if;
 if b.status<>'active' or b.phase<>'combat' then raise exception 'Rally is available during combat';end if;
 side_name:=case when u=b.attacker_owner_id then 'attacker' else 'defender' end;
 if (side_name='attacker' and b.rally_attacker)or(side_name='defender' and b.rally_defender)then raise exception 'Your general has already rallied the army';end if;
 update public.battles set rally_attacker=rally_attacker or side_name='attacker',rally_defender=rally_defender or side_name='defender'where id=b.id;
 update public.battle_formations set morale=least(100,morale+25),status=case when status='routed' then 'idle' else status end,
 target_x=case when status='routed' then x else target_x end,target_y=case when status='routed' then y else target_y end where battle_id=b.id and owner_id=u and soldiers>0;
 return jsonb_build_object('ok',true);
end $$;

create or replace function public.retreat_from_battle(p_battle_id bigint)returns jsonb language plpgsql security definer set search_path='' as $$
declare u uuid:=auth.uid();b public.battles%rowtype;
begin
 select * into b from public.battles where id=p_battle_id for update;
 if u is null or b.id is null or (u is distinct from b.attacker_owner_id and u is distinct from b.defender_owner_id)then raise exception 'Not your battle';end if;
 perform public.peris_finish(b.id,case when u=b.attacker_owner_id then 'defender' else 'attacker' end,'Withdrawal');
 return jsonb_build_object('ok',true);
end $$;

create or replace function public.peris_challenge(p_defender uuid)returns jsonb language plpgsql security definer set search_path='' as $$
declare u uuid:=auth.uid();
begin
 if u is null or p_defender is null or u=p_defender then raise exception 'Choose another ruler';end if;
 perform 1 from public.players where id in(u,p_defender) order by id for update;
 if not exists(select 1 from public.players where id=p_defender)then raise exception 'Ruler not found';end if;
 if exists(select 1 from public.battles where status='active'and (attacker_owner_id in(u,p_defender)or defender_owner_id in(u,p_defender)))then raise exception 'One army is already fighting';end if;
 if exists(select 1 from public.peris_challenges where status='pending'and expires_at>now()and(attacker_owner_id=u or defender_owner_id=u))then raise exception 'You already have a pending challenge';end if;
 insert into public.peris_challenges(attacker_owner_id,defender_owner_id,attacker_army_id)values(u,p_defender,public.peris_army_id(u));
 return jsonb_build_object('ok',true);
end $$;

create or replace function public.peris_respond(p_id bigint,p_accept boolean)returns jsonb language plpgsql security definer set search_path='' as $$
declare u uuid:=auth.uid();c public.peris_challenges%rowtype;a public.armies%rowtype;d public.armies%rowtype;bid bigint;
begin
 select * into c from public.peris_challenges where id=p_id for update;
 if u is null or c.id is null or c.defender_owner_id<>u then raise exception 'Not your invitation';end if;
 if c.status<>'pending' or c.expires_at<=now()then raise exception 'Challenge has expired';end if;
 if not p_accept then update public.peris_challenges set status='declined'where id=c.id;return jsonb_build_object('ok',true);end if;
 if exists(select 1 from public.peris_settler_expeditions where owner_id in(c.attacker_owner_id,c.defender_owner_id)and status='travelling'and arrival_at<=now())then perform pg_advisory_xact_lock(204200);end if;
 perform 1 from public.players where id in(c.attacker_owner_id,c.defender_owner_id)order by id for update;
 perform public.peris_settle(c.attacker_owner_id);perform public.peris_settle(c.defender_owner_id);
 perform 1 from public.armies where owner_id in(c.attacker_owner_id,c.defender_owner_id)order by owner_id for update;
 if exists(select 1 from public.battles where status='active'and(attacker_owner_id in(c.attacker_owner_id,c.defender_owner_id)or defender_owner_id in(c.attacker_owner_id,c.defender_owner_id)))then raise exception 'One army is already fighting';end if;

 select * into a from public.armies where id=coalesce(c.attacker_army_id,(select min(id)from public.armies where owner_id=c.attacker_owner_id))and owner_id=c.attacker_owner_id;select * into d from public.armies where id=public.peris_army_id(u);
 if exists(select 1 from public.peris_orders where army_id in(a.id,d.id)and kind='recruit')then raise exception 'Finish training before a duel';end if;
 if a.id is null or d.id is null or a.infantry+a.archers+a.cavalry=0 or d.infantry+d.archers+d.cavalry=0 then raise exception 'Both armies need soldiers';end if;
 insert into public.battles(attacker_owner_id,defender_owner_id,attacker_army_id,defender_army_id,mode,phase,terrain,enemy_name)
 values(a.owner_id,d.owner_id,a.id,d.id,'pvp','combat',public.peris_battle_terrain(d.target_x,d.target_y),(select display_name from public.players where id=d.owner_id))returning id into bid;
 perform public.peris_add_formations(bid,a.owner_id,'attacker',a.infantry,a.archers,a.cavalry,coalesce((select 90+2*level from public.buildings where settlement_id=a.home_settlement_id and building_type='wall'),92));
 perform public.peris_add_formations(bid,d.owner_id,'defender',d.infantry,d.archers,d.cavalry,coalesce((select 90+2*level from public.buildings where settlement_id=d.home_settlement_id and building_type='wall'),92));
 update public.armies set status='idle',raid_target_id=null where id in(a.id,d.id);
 update public.peris_challenges set status='accepted'where id=c.id;
 return jsonb_build_object('ok',true,'battle_id',bid);
end $$;

create or replace function public.peris_claim(p_quest_id text)returns jsonb language plpgsql security definer set search_path='' as $$
declare u uuid:=auth.uid();p public.players%rowtype;cw integer;cs integer;cf integer;cg integer;
begin
 if u is null then raise exception 'Authentication required';end if;perform public.peris_settle(u);select * into p from public.players where id=u for update;
 if exists(select 1 from public.peris_claims where owner_id=u and quest_id=p_quest_id)then raise exception 'Reward already claimed';end if;
 if p_quest_id='builder' and p.upgrades>=1 then cw:=250;cs:=200;cf:=200;cg:=50;
 elsif p_quest_id='recruiter' and p.recruits>=20 then cw:=200;cs:=150;cf:=300;cg:=75;
 elsif p_quest_id='victor' and p.victories>=1 then cw:=300;cs:=300;cf:=400;cg:=150;
 elsif p_quest_id='conqueror' and p.victories>=5 then cw:=1000;cs:=800;cf:=1000;cg:=500;
 else raise exception 'Complete the objective first';end if;
 insert into public.peris_claims(owner_id,quest_id)values(u,p_quest_id);
 update public.settlements set wood=least(capacity,wood+cw),stone=least(capacity,stone+cs),food=least(food_capacity,food+cf),gold=least(capacity,gold+cg)where id=public.peris_city_id(u);
 return jsonb_build_object('ok',true);
end $$;
create or replace function public.peris_rename(p_name text)returns jsonb language plpgsql security definer set search_path='' as $$
begin
 if auth.uid() is null then raise exception 'Authentication required';end if;
 if p_name is null or length(btrim(p_name))<2 or length(btrim(p_name))>32 then raise exception 'Use a name of 2-32 characters';end if;
 update public.settlements set name=btrim(p_name)where id=public.peris_city_id(auth.uid());return jsonb_build_object('ok',true);
end $$;

-- New players receive all eight structures; existing players keep their existing troops.
create or replace function public.create_player(p_display_name text)returns jsonb language plpgsql security definer set search_path='' as $$
declare u uuid:=auth.uid();n text:=btrim(p_display_name);sp public.spawn_points%rowtype;sid bigint;
begin
 if u is null then raise exception 'Authentication required';end if;
 perform pg_advisory_xact_lock(204200);
 if exists(select 1 from public.players where id=u)then return jsonb_build_object('ok',true);end if;
 if n is null or n!~'^[A-Za-z0-9 _-]{2,20}$'then raise exception 'Use 2-20 letters, numbers, spaces, _ or -';end if;
 select sp0.* into sp from public.spawn_points sp0 left join public.settlements s on s.spawn_point_id=sp0.id
 where s.id is null and public.peris_world_walkable(sp0.x,sp0.y)
 and not exists(select 1 from generate_series(-1,1) dx cross join generate_series(-1,1) dy
  where not public.peris_world_walkable(public.peris_wrap_world(sp0.x+dx*128),public.peris_wrap_world(sp0.y+dy*128)))
 and not exists(select 1 from public.peris_map_plots p
  where public.peris_cell_distance(floor(sp0.x/128::numeric)::integer,floor(sp0.y/128::numeric)::integer,p.col,p.row)<=1)
 and not exists(select 1 from public.settlements existing
  where public.peris_cell_distance(floor(sp0.x/128::numeric)::integer,floor(sp0.y/128::numeric)::integer,floor(existing.x/128::numeric)::integer,floor(existing.y/128::numeric)::integer)<3)
 and not exists(select 1 from public.peris_camps camp
  where public.peris_cell_distance(floor(sp0.x/128::numeric)::integer,floor(sp0.y/128::numeric)::integer,floor(camp.x/128::numeric)::integer,floor(camp.y/128::numeric)::integer)<=1)
 and not exists(select 1 from public.peris_settler_expeditions e where e.status='travelling'and public.peris_cell_distance(floor(sp0.x/128::numeric)::integer,floor(sp0.y/128::numeric)::integer,e.col,e.row)<4)
 order by sp0.id limit 1 for update of sp0 skip locked;
 if sp.id is null then raise exception 'This world has no free settlement sites';end if;
 insert into public.players(id,display_name)values(u,n);
 insert into public.settlements(owner_id,spawn_point_id,name,x,y,wood,stone,food,gold)values(u,sp.id,n||'''s Keep',sp.x,sp.y,1250,1000,1500,500)returning id into sid;
 insert into public.buildings(settlement_id,building_type,level)select sid,t,0 from unnest(array['lumber','quarry','farm','market','barracks','stables','wall','storehouse'])t;
 insert into public.armies(owner_id,home_settlement_id,name,infantry,archers,cavalry,start_x,start_y,target_x,target_y)values(u,sid,'Legio I · The Dawn',120,50,16,sp.x+40,sp.y+30,sp.x+40,sp.y+30);
 return jsonb_build_object('ok',true);
exception when unique_violation then raise exception 'That ruler name is already taken';
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
 update public.settlements set faction=p_faction where id=public.peris_city_id(u);if not found then raise exception 'Settlement missing';end if;
end $$;
create or replace function public.peris_debug_city(p_action text,p_target text default null,p_value integer default null)returns void language plpgsql security definer set search_path='' as $$
declare u uuid:=auth.uid();s public.settlements%rowtype;c public.peris_city_slots%rowtype;b public.buildings%rowtype;target_slot integer;l integer;max_level integer;lost_magic boolean:=false;count_slots integer;
begin
 if u is null then raise exception 'Authentication required';end if;
 if not coalesce((select enabled from public.peris_debug_config where id),false)then raise exception 'Debug tools are disabled';end if;
 perform 1 from public.players where id=u for update;
 select * into s from public.settlements where id=public.peris_city_id(u) for update;if s.id is null then raise exception 'Settlement missing';end if;
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
  update public.peris_orders set started_at=least(started_at,now()),finish_at=now() where owner_id=u and settlement_id=s.id and kind='upgrade';perform public.peris_settle(u);return;
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
  delete from public.peris_orders where owner_id=u and settlement_id=s.id and kind='upgrade' and item='slot:'||c.slot_index||':'||c.building_type;
  if l=0 then delete from public.peris_city_slots where settlement_id=s.id and slot_index=c.slot_index;lost_magic:=c.building_type='mage_tower';
  else update public.peris_city_slots set level=l where settlement_id=s.id and slot_index=c.slot_index;end if;
 else
  update public.buildings set level=l,updated_at=now() where id=b.id;
  delete from public.peris_orders where owner_id=u and settlement_id=s.id and kind='upgrade' and item=b.building_type;
  if b.building_type='market' then
   count_slots:=6+2*l;lost_magic:=exists(select 1 from public.peris_city_slots where settlement_id=s.id and slot_index>=count_slots and slot_index<>16 and building_type='mage_tower');
   delete from public.peris_orders o using public.peris_city_slots cs where cs.settlement_id=s.id and cs.slot_index>=count_slots and cs.slot_index<>16 and o.owner_id=u and o.settlement_id=s.id and o.kind='upgrade' and o.item='slot:'||cs.slot_index||':'||cs.building_type;
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
 'map',jsonb_build_object('version',4,'cols',200,'rows',200,'cell_size',128,'seed',1346720329,
   'total_players',(select count(*) from public.players),'total_settlements',(select count(*) from public.settlements)),
 'gameplay_version',1,
 'heroes',coalesce((select jsonb_agg(h order by id)from public.peris_heroes h where owner_id=u),'[]'::jsonb),
 'hero_artifacts',coalesce((select jsonb_agg(i order by id)from public.peris_hero_artifacts i where owner_id=u),'[]'::jsonb),
 'settler_expeditions',coalesce((select jsonb_agg(e order by id)from public.peris_settler_expeditions e where owner_id=u),'[]'::jsonb),
 'players',coalesce((select jsonb_agg(p order by created_at)from public.players p where p.id=u
   or exists(select 1 from public.battles b where (b.attacker_owner_id=u or b.defender_owner_id=u) and (b.attacker_owner_id=p.id or b.defender_owner_id=p.id))
   or exists(select 1 from public.peris_challenges c where c.status='pending' and c.expires_at>now() and (c.attacker_owner_id=u or c.defender_owner_id=u) and (c.attacker_owner_id=p.id or c.defender_owner_id=p.id))),'[]'::jsonb),
 'settlements',coalesce((select jsonb_agg(s order by id)from public.settlements s where s.owner_id=u),'[]'::jsonb),
 'buildings',coalesce((select jsonb_agg(b order by b.id)from public.buildings b join public.settlements s on s.id=b.settlement_id where s.owner_id=u),'[]'::jsonb),
 'spell_research',coalesce((select jsonb_agg(r order by r.spell_id)from public.peris_spell_research r join public.settlements s on s.id=r.settlement_id where s.owner_id=u),'[]'::jsonb),
 'city_slots',coalesce((select jsonb_agg(c order by c.slot_index)from public.peris_city_slots c join public.settlements s on s.id=c.settlement_id where s.owner_id=u),'[]'::jsonb),
 'map_plots',coalesce((select jsonb_agg(p order by p.row,p.col)from public.peris_map_plots p where p.owner_id=u),'[]'::jsonb),
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

-- Translated viewport intervals retain entities on both sides of a periodic seam.
create or replace function public.peris_map_development(p_sid bigint) returns integer
language sql stable security definer set search_path='' as $$
 select least(5,greatest(1,
 coalesce((select least(5,greatest(0,level)) from public.buildings where settlement_id=p_sid and building_type='market'),0),
 1+floor((coalesce((select sum(least(5,greatest(0,level))) from public.buildings where settlement_id=p_sid and building_type in ('lumber','quarry','farm','wall')),0)
 +coalesce((select sum(least(5,greatest(0,level))) from public.peris_city_slots where settlement_id=p_sid),0))/8)::integer))
$$;
create or replace function public.peris_map_axis_visible(p_value numeric,p_min integer,p_max integer) returns boolean
language sql immutable set search_path='' as $$
 select p_max-p_min>=25600 or exists(select 1 from generate_series(-1,1) shift
 where p_value+shift*25600>=p_min and p_value+shift*25600<p_max)
$$;
create or replace function public.peris_map_snapshot(p_min_x integer,p_min_y integer,p_max_x integer,p_max_y integer)
returns jsonb language plpgsql security definer set search_path='' as $$
declare u uuid:=auth.uid();min_x integer:=p_min_x;min_y integer:=p_min_y;max_x integer:=p_max_x;max_y integer:=p_max_y;result jsonb;
begin
 if u is null then raise exception 'Authentication required';end if;
 if min_x is null or min_y is null or max_x is null or max_y is null
 or min_x>=max_x or min_y>=max_y or min_x < -38400 or min_y < -38400 or max_x > 38400 or max_y > 38400 then raise exception 'Choose valid map bounds';end if;
 with nearby_settlements as materialized (
   select s.id,s.owner_id,s.name,s.x,s.y,s.faction from public.settlements s where s.owner_id<>u
   and public.peris_map_axis_visible(s.x,min_x,max_x) and public.peris_map_axis_visible(s.y,min_y,max_y)
   order by s.id limit 601
 ), visible_settlements as (
   select s.id,s.owner_id,s.name,s.x,s.y,s.faction from public.settlements s where s.owner_id=u
   union all select * from (select * from nearby_settlements order by id limit 600) nearby
 ), army_positions as materialized (
   select a.*,(travel.position->>'x')::numeric as map_x,(travel.position->>'y')::numeric as map_y
   from public.armies a cross join lateral (select public.peris_army_position(a) as position) travel
   where a.owner_id=u or a.status='moving'
   or (public.peris_map_axis_visible(a.target_x,min_x,max_x) and public.peris_map_axis_visible(a.target_y,min_y,max_y))
 ), nearby_armies as materialized (
   select a.* from army_positions a where a.owner_id<>u
   and public.peris_map_axis_visible(a.map_x,min_x,max_x) and public.peris_map_axis_visible(a.map_y,min_y,max_y)
   order by a.id limit 601
 ), visible_armies as (
   select a.* from army_positions a where a.owner_id=u
   union all select * from (select * from nearby_armies order by id limit 600) nearby
 ), nearby_plots as materialized (
   select p.*,s.faction from public.peris_map_plots p join public.settlements s on s.id=p.settlement_id where p.owner_id<>u
   and public.peris_map_axis_visible(p.col*128+64,min_x,max_x) and public.peris_map_axis_visible(p.row*128+64,min_y,max_y)
   order by p.row,p.col limit 2001
 ), visible_plots as (
   select p.*,s.faction from public.peris_map_plots p join public.settlements s on s.id=p.settlement_id where p.owner_id=u
   union all select * from (select * from nearby_plots order by row,col limit 2000) nearby
 ), visible_owners as (
   select owner_id from visible_settlements union select owner_id from visible_armies union select owner_id from visible_plots union select u
 )
 select jsonb_build_object('server_now',now(),
   'players',coalesce((select jsonb_agg(jsonb_build_object('id',p.id,'display_name',p.display_name) order by p.id)
     from public.players p join visible_owners o on o.owner_id=p.id),'[]'::jsonb),
   'settlements',coalesce((select jsonb_agg(to_jsonb(s)||jsonb_build_object('map_development',public.peris_map_development(s.id)) order by s.id) from visible_settlements s),'[]'::jsonb),
   'armies',coalesce((select jsonb_agg(to_jsonb(a)-'map_x'-'map_y' order by a.id) from visible_armies a),'[]'::jsonb),
   'map_plots',coalesce((select jsonb_agg(p order by p.row,p.col) from visible_plots p),'[]'::jsonb),
   'total_players',(select count(*) from public.players),'total_settlements',(select count(*) from public.settlements),
   'settlements_truncated',(select count(*)>600 from nearby_settlements),
   'armies_truncated',(select count(*)>600 from nearby_armies),
   'plots_truncated',(select count(*)>2000 from nearby_plots)) into result;
 return result;
end $$;
-- Automatic battles: persistent cooldowns, mirrored AI and read-only spectators.
alter table public.battle_formations add column if not exists attack_ready_at numeric not null default 0;
alter table public.battle_formations add column if not exists damage_target_id bigint;
alter table public.battle_formations add column if not exists charge_distance numeric not null default 0;
alter table public.battles alter column phase set default 'combat';
alter table public.battles alter column attacker_ready set default true;
alter table public.battles alter column defender_ready set default true;
update public.battles set phase='combat',attacker_ready=true,defender_ready=true,last_tick_at=now() where status='active' and phase='deployment';

create or replace function public.peris_extent(f public.battle_formations,dx numeric,dy numeric)returns numeric language plpgsql immutable set search_path='' as $$
declare len numeric:=greatest(.001,sqrt(dx*dx+dy*dy));a numeric:=radians(f.facing);cols numeric:=least(f.columns,greatest(1,f.initial_soldiers));width numeric:=cols*8+12;depth numeric:=ceil(least(f.initial_soldiers,120)::numeric/cols)*8+12;
begin return sqrt(power((dx*cos(a)+dy*sin(a))/len*depth/2,2)+power((-dx*sin(a)+dy*cos(a))/len*width/2,2));end $$;
create or replace function public.peris_contact(f public.battle_formations,t public.battle_formations)returns numeric language sql immutable set search_path='' as $$select public.peris_extent(f,t.x-f.x,t.y-f.y)+public.peris_extent(t,f.x-t.x,f.y-t.y)+8$$;

create or replace function public.peris_auto_orders(p_battle bigint)returns void language plpgsql security definer set search_path='' as $$
declare f public.battle_formations%rowtype;t public.battle_formations%rowtype;old public.battle_formations%rowtype;loads jsonb:='{}';best numeric;previous numeric;distance numeric;
begin
 for f in select * from public.battle_formations where battle_id=p_battle and soldiers>0 and status<>'routed' order by id loop
 select e.* into t
 from public.battle_formations e where e.battle_id=p_battle and e.side<>f.side and e.soldiers>0 and e.status<>'routed'
 order by greatest(0,sqrt(power(e.x-f.x,2)+power(e.y-f.y,2))-public.peris_contact(f,e))+coalesce((loads->>e.id::text)::integer,0)*45-case when f.unit_type='cavalry' and e.unit_type='archers' then 110 else 0 end,e.id limit 1;
 if t.id is null then continue;end if;
 best:=greatest(0,sqrt(power(t.x-f.x,2)+power(t.y-f.y,2))-public.peris_contact(f,t))+coalesce((loads->>t.id::text)::integer,0)*45-case when f.unit_type='cavalry'and t.unit_type='archers'then 110 else 0 end;
 select * into old from public.battle_formations where id=f.target_formation_id and soldiers>0 and status<>'routed';
 if old.id is not null then
 previous:=greatest(0,sqrt(power(old.x-f.x,2)+power(old.y-f.y,2))-public.peris_contact(f,old))+coalesce((loads->>old.id::text)::integer,0)*45-case when f.unit_type='cavalry'and old.unit_type='archers'then 110 else 0 end;
 if sqrt(power(old.x-f.x,2)+power(old.y-f.y,2))<=public.peris_contact(f,old)+30 or previous<=best*1.3+15 then t:=old;end if;
 end if;
 distance:=sqrt(power(t.x-f.x,2)+power(t.y-f.y,2));
 update public.battle_formations set target_formation_id=t.id,target_x=t.x,target_y=t.y,fire_at_will=true,
 running=unit_type='cavalry' and distance>public.peris_contact(f,t)+70 and stamina>35,
 stance=case when unit_type='infantry' and t.unit_type='cavalry' and distance<180 then 'guard' else 'balanced' end,
 damage_pool=case when target_formation_id is distinct from t.id then 0 else damage_pool end,damage_target_id=t.id where id=f.id;
 loads:=jsonb_set(loads,array[t.id::text],to_jsonb(coalesce((loads->>t.id::text)::integer,0)+1),true);
 end loop;
end $$;

create or replace function public.peris_cast_spell_for(p_owner uuid,p_battle_id bigint,p_spell text,p_target bigint default null) returns jsonb language plpgsql security definer set search_path='' as $$
declare u uuid:=p_owner;b public.battles%rowtype;s public.settlements%rowtype;sp public.peris_spell_catalog%rowtype;f public.battle_formations%rowtype;t public.battle_formations%rowtype;
 own_side text;friend boolean;single_target boolean;l integer;mana integer;ready numeric;idx integer:=0;cas integer;troops integer;mor numeric;alive_a boolean;alive_d boolean;hero_bonus jsonb;
begin
 select * into b from public.battles where id=p_battle_id for update;
 if u is null or b.id is null or (u is distinct from b.attacker_owner_id and u is distinct from b.defender_owner_id) then raise exception 'Not your battle';end if;
 if b.status<>'active' or b.phase<>'combat' then raise exception 'Spells can only be cast during combat';end if;
 select * into sp from public.peris_spell_catalog where id=p_spell;
 select city.* into s from public.settlements city join public.peris_spell_research research on research.settlement_id=city.id join public.peris_city_slots tower on tower.settlement_id=city.id and tower.building_type='mage_tower'and tower.level>=sp.level where city.owner_id=u and research.spell_id=sp.id order by city.id limit 1;
 hero_bonus:=public.peris_hero_bonuses(case when b.attacker_owner_id=u then b.attacker_army_id else b.defender_army_id end);
 select level into l from public.peris_city_slots where settlement_id=s.id and building_type='mage_tower';
 if sp.id is null or coalesce(l,0)<sp.level or not exists(select 1 from public.peris_spell_research where settlement_id=s.id and spell_id=sp.id) then raise exception 'Research this spell in your mage tower first';end if;

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
 cas:=ceil(greatest(0,sp.damage-case when sp.chain>0 then idx*6 else 0 end)*(hero_bonus->>'spell')::numeric*(1-f.magic_defence));idx:=idx+1;
 troops:=greatest(0,least(f.initial_soldiers,f.soldiers-cas+ceil(sp.heal*(hero_bonus->>'spell')::numeric)::integer));
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
-- Public tactical command endpoints remain as explicit rejections for old clients.
create or replace function public.peris_order(p_battle_id bigint,p_order jsonb)returns jsonb language plpgsql security definer set search_path='' as $$begin raise exception 'Both armies are controlled automatically';end $$;
create or replace function public.peris_rally(p_battle_id bigint)returns jsonb language plpgsql security definer set search_path='' as $$begin raise exception 'Both armies are controlled automatically';end $$;
create or replace function public.peris_cast_spell(p_battle_id bigint,p_spell text,p_target bigint default null)returns jsonb language plpgsql security definer set search_path='' as $$begin raise exception 'The AI controls battle spells automatically';end $$;

create or replace function public.peris_auto_magic(p_battle bigint)returns void language plpgsql security definer set search_path='' as $$
declare b public.battles%rowtype;owner uuid;own_side text;sp public.peris_spell_catalog%rowtype;t public.battle_formations%rowtype;f public.battle_formations%rowtype;friendly boolean;all_targets boolean;mana_available integer;power_bonus numeric;utility numeric;score numeric;best numeric;choice text;target_id bigint;idx integer;missing integer;threat boolean;hero jsonb;
begin
 foreach own_side in array array['attacker','defender'] loop
 select * into b from public.battles where id=p_battle;
 if b.status<>'active' or b.elapsed<1 then return;end if;
 owner:=case when own_side='attacker'then b.attacker_owner_id else b.defender_owner_id end;
 if owner is null or b.elapsed<(case when own_side='attacker'then b.spell_ready_attacker else b.spell_ready_defender end) then continue;end if;
 mana_available:=coalesce(case when own_side='attacker'then b.mana_attacker else b.mana_defender end,0);
 hero:=public.peris_hero_bonuses(case when own_side='attacker'then b.attacker_army_id else b.defender_army_id end);power_bonus:=coalesce((hero->>'spell')::numeric,1);best:=0;choice:=null;
 for sp in select c.* from public.peris_spell_catalog c where c.mana<=mana_available and exists(select 1 from public.peris_spell_research r join public.settlements s on s.id=r.settlement_id join public.peris_city_slots tower on tower.settlement_id=s.id and tower.building_type='mage_tower' and tower.level>=c.level where s.owner_id=owner and r.spell_id=c.id) order by c.level,c.id loop
 friendly:=sp.target in('ally','allies');all_targets:=sp.target in('allies','enemies');
 for t in select * from public.battle_formations where battle_id=b.id and (side=own_side)=friendly and (sp.revive or soldiers>0 and status<>'routed') order by id loop
 utility:=0;idx:=0;
 for f in select * from public.battle_formations where battle_id=b.id and (side=own_side)=friendly and (sp.revive or soldiers>0 and status<>'routed')
 and (all_targets or id=t.id or sp.chain>0 or sp.radius>0 and power(x-t.x,2)+power(y-t.y,2)<=sp.radius*sp.radius)
 order by case when sp.chain>0 then case when id=t.id then -1 else power(x-t.x,2)+power(y-t.y,2)end else id end,id limit case when sp.chain>0 then sp.chain else 10000 end loop
 if friendly then
 missing:=f.initial_soldiers-f.soldiers;
 if missing>=least(sp.heal*power_bonus*.5,greatest(1,f.initial_soldiers*.15))then utility:=utility+least(missing,ceil(sp.heal*power_bonus))*case when f.status='routed'and sp.revive then 1.5 else 1.1 end;end if;
 if f.soldiers>0 then
 utility:=utility+case when sp.morale>0 then least(sp.morale,greatest(0,70-f.morale))*.3 else 0 end;
 select exists(select 1 from public.battle_formations e where e.battle_id=b.id and e.side<>own_side and e.soldiers>0 and e.status<>'routed' and power(e.x-f.x,2)+power(e.y-f.y,2)<260*260) into threat;
 if threat then utility:=utility+f.soldiers*(least(sp.attack,1.5-f.magic_attack)*.3+least(sp.defence,.4-f.magic_defence)*.4);end if;
 if f.status='moving'then utility:=utility+f.soldiers*least(sp.speed,1.75-f.magic_speed)*.12;end if;
 end if;
 elsif exists(select 1 from public.battle_formations a where a.battle_id=b.id and a.side=own_side and a.soldiers>0 and a.status<>'routed' and power(a.x-f.x,2)+power(a.y-f.y,2)<300*300)then
 utility:=utility+least(f.soldiers,ceil(greatest(0,sp.damage-case when sp.chain>0 then idx*6 else 0 end)*power_bonus*(1-f.magic_defence)))+case when sp.morale<0 then least(-sp.morale,f.morale)*.15 else 0 end;
 end if;idx:=idx+1;
 end loop;
 score:=utility/sqrt(sp.mana);
 if utility>=3 and score>best then best:=score;choice:=sp.id;target_id:=t.id;end if;
 if all_targets then exit;end if;
 end loop;
 end loop;
 if choice is not null then perform public.peris_cast_spell_for(owner,b.id,choice,target_id);end if;
 end loop;
end $$;
-- Retire v4/v5 bypasses: clients cannot use instant upgrades, instant recruitment,
-- unaccepted challenges, or the old tactical simulation to circumvent v6 rules.
revoke all on function public.upgrade_building(text) from public,anon,authenticated;
revoke all on function public.recruit_units(integer,integer,integer)from public,anon,authenticated;
revoke all on function public.create_battle(uuid)from public,anon,authenticated;
revoke all on function public.issue_battle_move(bigint,bigint,integer,integer)from public,anon,authenticated;
revoke all on function public.issue_battle_attack(bigint,bigint,bigint)from public,anon,authenticated;
revoke all on function public.advance_battle(bigint)from public,anon,authenticated;
-- Restrict helpers even when Supabase defaults grant function execution to clients.
do $$declare r record;signature text;begin
 for r in select p.oid from pg_proc p join pg_namespace n on n.oid=p.pronamespace where n.nspname='public'and p.proname like 'peris_%' loop
 signature:=r.oid::regprocedure::text;execute 'revoke all on function '||signature||' from public, anon, authenticated';
 end loop;
end $$;
revoke all on function public.create_player(text),public.sync_my_state(),public.move_army(integer,integer),public.retreat_from_battle(bigint)from public,anon;
grant execute on function public.create_player(text),public.sync_my_state(),public.move_army(integer,integer),public.retreat_from_battle(bigint)to authenticated;
grant execute on function public.peris_empire_command(jsonb)to authenticated;
grant execute on function public.peris_claim_field(integer,integer),public.peris_queue_field(integer,integer,text),public.peris_set_faction(text),public.peris_debug_city(text,text,integer),public.peris_snapshot(),public.peris_map_snapshot(integer,integer,integer,integer),public.peris_march(integer,integer,jsonb),public.peris_queue_upgrade(text),public.peris_queue_slot(integer,text),public.peris_research_spell(text),public.peris_cast_spell(bigint,text,bigint),public.peris_queue_recruit(text,integer),public.peris_raid(integer),public.peris_ready(bigint),
 public.peris_order(bigint,jsonb),public.peris_tick(bigint),public.peris_rally(bigint),public.peris_challenge(uuid),public.peris_respond(bigint,boolean),public.peris_claim(text),public.peris_rename(text)to authenticated;

do $$declare t text;begin
 foreach t in array array['peris_map_plots','peris_orders','peris_reports','peris_challenges']loop
 begin execute format('alter publication supabase_realtime add table public.%I',t);exception when duplicate_object then null;end;
 end loop;
end $$;
commit;
