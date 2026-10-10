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
