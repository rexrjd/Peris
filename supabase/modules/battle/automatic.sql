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
