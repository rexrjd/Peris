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
