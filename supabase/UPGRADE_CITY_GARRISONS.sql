-- PERIS permanent city garrisons. Run after UPGRADE_CITY_RUINS.sql.
-- Back up your realm first. Do not mix with an in-progress migration.
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

do $$ begin if to_regprocedure('public.peris_ruin_city(bigint)') is null then raise exception 'Apply UPGRADE_CITY_RUINS.sql first'; end if; end $$;
-- Persistent defensive garrisons: separate from transient field stations.
-- Automatic arrival-merging must never withdraw soldiers assigned to this city.
create table if not exists public.peris_city_garrisons (
 settlement_id bigint primary key references public.settlements(id) on delete cascade,
 owner_id uuid not null references public.players(id) on delete cascade,
 unit_roster jsonb not null default '{}'::jsonb
);
create index if not exists peris_city_garrisons_owner on public.peris_city_garrisons(owner_id,settlement_id);
alter table public.peris_city_garrisons enable row level security;
revoke all on public.peris_city_garrisons from public,anon,authenticated;
grant select on public.peris_city_garrisons to authenticated;
drop policy if exists "own city garrisons" on public.peris_city_garrisons;
create policy "own city garrisons" on public.peris_city_garrisons for select to authenticated
 using(owner_id=public.peris_player_id());

-- A passive numeric modifier applied to defender formations at battle creation.
-- Five wall levels => 10%, 20%, 30%, 40%, 50%, with no tactical gate system.
create or replace function public.peris_wall_defence_bonus(p_level integer)returns numeric
language sql immutable set search_path='' as $$
 select least(.5::numeric,greatest(0,least(5,coalesce(p_level,0)))*.1::numeric)
$$;

-- Called only through the authenticated, idempotent empire command.
-- A dedicated city garrison has no commander and does not march; legions can
-- withdraw it explicitly when present, never automatically upon return.
create or replace function public.peris_manage_city_garrison(
 p_owner uuid,p_city bigint,p_army bigint,p_action text,p_troops jsonb
)returns jsonb language plpgsql security definer set search_path='' as $$
declare city public.settlements%rowtype;army public.armies%rowtype;position jsonb;
 selected jsonb;legion jsonb;stationed jsonb;updated jsonb;unit_name text;
begin
 if p_owner is null or p_action is null or p_action not in('station','withdraw') or jsonb_typeof(p_troops)is distinct from 'object' then
  raise exception 'Choose a valid city garrison action';end if;
 select * into city from public.settlements where id=p_city and owner_id=p_owner and ruined_at is null for update;
 select * into army from public.armies where id=p_army and owner_id=p_owner for update;
 if city.id is null or army.id is null then raise exception 'Choose your city and an owned legion';end if;
 if exists(select 1 from public.players where id=p_owner and defeated_at is not null)then raise exception 'This ruler has been permanently defeated';end if;
 if army.status<>'idle' or army.raid_target_id is not null or army.raid_city_id is not null or army.raid_reserve is not null then
  raise exception 'Bring an idle legion to the city';end if;
 if exists(select 1 from public.battles where status='active'and(attacker_owner_id=p_owner or defender_owner_id=p_owner))then
  raise exception 'Finish the current battle first';end if;
 if exists(select 1 from public.peris_orders where kind='recruit'and owner_id=p_owner and
  coalesce(army_id,(select min(id)from public.armies where owner_id=p_owner))=army.id)then
  raise exception 'Finish this legion''s recruitment first';end if;
 position:=public.peris_army_position(army);
 if public.peris_wrap_cell(floor((position->>'x')::numeric/128)::integer)<>public.peris_wrap_cell(floor(city.x/128.0)::integer)
  or public.peris_wrap_cell(floor((position->>'y')::numeric/128)::integer)<>public.peris_wrap_cell(floor(city.y/128.0)::integer)then
  raise exception 'Bring an idle legion into this city before transferring defenders';end if;
 selected:=public.peris_garrison_troops(p_troops);
 if public.peris_roster_total(selected)=0 then raise exception 'Choose one or more soldiers';end if;
 legion:=public.peris_roster(to_jsonb(army));
 select g.unit_roster into stationed from public.peris_city_garrisons g where g.settlement_id=p_city and g.owner_id=p_owner for update;
 stationed:=public.peris_roster(coalesce(stationed,'{}'::jsonb));
 foreach unit_name in array array['infantry','spearmen','archers','elite','cavalry','scout','heavyCavalry','ram','catapult']loop
  if (selected->>unit_name)::integer>(case when p_action='station'then (legion->>unit_name)::integer else (stationed->>unit_name)::integer end)then
   raise exception 'Choose troops actually available in this location';end if;
 end loop;
 if p_action='station'then
  updated:=public.peris_roster_add(stationed,selected);
  insert into public.peris_city_garrisons(settlement_id,owner_id,unit_roster)values(p_city,p_owner,updated)
  on conflict(settlement_id)do update set unit_roster=excluded.unit_roster;
  perform public.peris_write_roster(p_army,public.peris_roster_add(legion,selected,-1));
 else
  if public.peris_roster_total(legion)+public.peris_roster_total(selected)>1000 then raise exception 'A legion cannot carry more than 1,000 soldiers';end if;
  updated:=public.peris_roster_add(stationed,selected,-1);
  if public.peris_roster_total(updated)=0 then delete from public.peris_city_garrisons where settlement_id=p_city and owner_id=p_owner;
  else update public.peris_city_garrisons set unit_roster=updated where settlement_id=p_city and owner_id=p_owner;end if;
  perform public.peris_write_roster(p_army,public.peris_roster_add(legion,selected));
 end if;
 update public.armies set updated_at=now()where id=p_army;
 return jsonb_build_object('ok',true,'garrison',updated);
end $$;
revoke all on function public.peris_manage_city_garrison(uuid,bigint,bigint,text,jsonb) from public,anon,authenticated;

create or replace function public.peris_empire_command(p_command jsonb)returns jsonb language plpgsql security definer set search_path='' as $$
declare u uuid:=public.peris_player_id();command_kind text:=p_command->>'type';s public.settlements%rowtype;a public.armies%rowtype;t public.armies%rowtype;h public.peris_heroes%rowtype;item public.peris_hero_artifacts%rowtype;
 qty integer;main integer;count_cities integer;count_armies integer;cost integer;reason text;distance numeric;hero_class text;hero_name text;new_army_id bigint;stat text;inf integer;arc integer;cav integer;position jsonb;target jsonb;camp public.peris_camps%rowtype;chosen jsonb;available jsonb;reply jsonb;
begin
 if u is null then raise exception 'Authentication required';end if;
 if exists(select 1 from public.players where id=u and defeated_at is not null)then raise exception 'This ruler has been permanently defeated';end if;
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
 if command_kind in('startResearch','pauseResearch','debugResearch')then return public.peris_research_command(p_command);end if;
 if command_kind='cancelMarch'then return public.peris_cancel_march((p_command->>'armyId')::bigint,(p_command->>'sentAt')::timestamptz);end if;
 select * into s from public.settlements where id=public.peris_city_id(u)for update;
 select * into a from public.armies where id=public.peris_army_id(u)for update;
 if exists(select 1 from public.battles where status='active'and(attacker_owner_id=u or defender_owner_id=u))then raise exception 'Finish the current battle first';end if;
 case command_kind
 when 'manageCityGarrison'then return public.peris_manage_city_garrison(u,s.id,a.id,p_command->>'action',p_command->'troops');
 when 'reinforceCity'then return public.peris_send_city_reinforcements(u,s.id,(p_command->>'targetCityId')::bigint,p_command->'troops',p_command->'route');
 when 'upgrade'then return public.peris_queue_upgrade(p_command->>'item');
 when 'buildSlot'then return public.peris_queue_slot((p_command->>'slot')::integer,p_command->>'item');
 when 'upgradeSlot'then return public.peris_queue_slot((p_command->>'slot')::integer,null);
 when 'recruit'then return public.peris_queue_recruit_to(p_command->>'item',(p_command->>'quantity')::integer,coalesce(p_command->>'destination','legion'));
 when 'move'then
  if p_command ? 'troops'then
   if jsonb_typeof(p_command->'troops')is distinct from 'object'then raise exception 'Choose troops currently available in this legion';end if;
   chosen:=public.peris_garrison_troops(p_command->'troops');available:=public.peris_roster(to_jsonb(a));
   if public.peris_roster_total(chosen)=0 or exists(select 1 from jsonb_each_text(chosen)where value::integer>(available->>key)::integer)then raise exception 'Choose troops currently available in this legion';end if;
   position:=public.peris_army_position(a);
   if public.peris_roster_total(chosen)<public.peris_roster_total(available)and not public.peris_station_owned(u,floor((position->>'x')::numeric/128)::integer,floor((position->>'y')::numeric/128)::integer)then raise exception 'Leave reinforcements only at your own village or field';end if;
  end if;
  if p_command ? 'route'then reply:=public.peris_march(round((p_command->>'x')::numeric)::integer,round((p_command->>'y')::numeric)::integer,p_command->'route');else reply:=public.move_army(round((p_command->>'x')::numeric)::integer,round((p_command->>'y')::numeric)::integer);end if;
  if chosen is not null then
   if public.peris_roster_total(chosen)<public.peris_roster_total(available)then perform public.peris_garrison_add(u,floor((position->>'x')::numeric/128)::integer,floor((position->>'y')::numeric/128)::integer,public.peris_roster_add(available,chosen,-1));end if;
   perform public.peris_write_roster(a.id,chosen);
   update public.armies set arrival_at=departure_at+make_interval(secs=>greatest(2,march_distance/public.peris_march_speed(id))::double precision)where id=a.id;
  end if;
  return reply;
 when 'raid'then
  return public.peris_prepare_raid((p_command->>'campId')::integer,p_command->'route',p_command->'troops');
 when 'raidCity'then
  return public.peris_prepare_city_raid(u,a.id,(p_command->>'targetCityId')::bigint,p_command->'route',p_command->'troops',coalesce(p_command->>'siegeTarget','auto'));
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
  insert into public.peris_orders(owner_id,settlement_id,kind,item,quantity,started_at,finish_at)values(u,s.id,'settler','settlers',qty,public.peris_game_now(),public.peris_game_now()+make_interval(secs=>ceil(40*qty/(1+main*.15))::double precision));
 when 'foundCity'then
  perform pg_advisory_xact_lock(204200);
  reason:=public.peris_found_reason((p_command->>'col')::integer,(p_command->>'row')::integer);
  if reason is not null then raise exception '%',reason;end if;
  hero_name:=btrim(p_command->>'name');if hero_name is null or length(hero_name)<2 or length(hero_name)>32 then raise exception 'Use a city name of 2-32 characters';end if;
  select (select count(*)from public.settlements where owner_id=u and ruined_at is null)+(select count(*)from public.peris_settler_expeditions where owner_id=u and status='travelling')into count_cities;
  if count_cities>=10 then raise exception 'Your empire can hold up to ten cities';end if;
  cost:=300*count_cities*count_cities;
  if s.settlers<3 then raise exception 'Prepare three settlers in this city first';end if;
  if (select culture_points from public.players where id=u)<cost then raise exception 'Not enough culture points';end if;
  if s.wood<500 or s.stone<400 or s.food<600 or s.gold<150 then raise exception 'More supplies are needed for this colony';end if;
  distance:=public.peris_route_distance(s.x,s.y,public.peris_wrap_cell((p_command->>'col')::integer)*128+64,public.peris_wrap_cell((p_command->>'row')::integer)*128+64,p_command->'route');
  update public.settlements set settlers=settlers-3,wood=wood-500,stone=stone-400,food=food-600,gold=gold-150 where id=s.id;
  update public.players set culture_points=culture_points-cost where id=u;
  insert into public.peris_settler_expeditions(owner_id,origin_settlement_id,col,row,name,departure_at,arrival_at,culture_cost,march_path)
  values(u,s.id,public.peris_wrap_cell((p_command->>'col')::integer),public.peris_wrap_cell((p_command->>'row')::integer),hero_name,public.peris_game_now(),public.peris_game_now()+make_interval(secs=>greatest(5,distance/18)::double precision),cost,p_command->'route');
 when 'recruitHero'then
  hero_class:=p_command->>'heroClass';hero_name:=btrim(p_command->>'name');
  if hero_class is null or hero_class not in('knight','ranger','mage')then raise exception 'Choose a hero class';end if;
  if hero_name is null or length(hero_name)<2 or length(hero_name)>24 then raise exception 'Use a hero name of 2-24 characters';end if;
  select count(*)into count_cities from public.settlements where owner_id=u and ruined_at is null;select count(*)into count_armies from public.armies where owner_id=u;
  if count_armies>=least(20,count_cities*2)then raise exception 'Found another city to support more armies';end if;
  if s.gold<500 then raise exception 'Hiring a hero costs 500 gold';end if;
  update public.settlements set gold=gold-500 where id=s.id;
  position:=public.peris_home_army_position(s.x,s.y);
  insert into public.armies(owner_id,home_settlement_id,name,infantry,archers,cavalry,start_x,start_y,target_x,target_y)values(u,s.id,hero_name||'’s army',0,0,0,(position->>'x')::integer,(position->>'y')::integer,(position->>'x')::integer,(position->>'y')::integer)returning id into new_army_id;
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
  if a.status<>'idle'or t.status<>'idle'or a.raid_reserve is not null or t.raid_reserve is not null or a.raid_target_id is not null or t.raid_target_id is not null or a.raid_city_id is not null or t.raid_city_id is not null or sqrt(power(public.peris_wrapped_delta((position->>'x')::numeric,(target->>'x')::numeric),2)+power(public.peris_wrapped_delta((position->>'y')::numeric,(target->>'y')::numeric),2))>90 then raise exception 'Bring both idle armies together first';end if;
  if exists(select 1 from public.peris_orders where kind='recruit'and army_id in(a.id,t.id))then raise exception 'Finish both training queues before transferring troops';end if;
  if p_command ? 'troops'then
   if jsonb_typeof(p_command->'troops')is distinct from 'object'then raise exception 'Choose available soldiers';end if;
   chosen:=public.peris_roster(p_command->'troops');
   if exists(select 1 from jsonb_each_text(chosen)where value::integer>(public.peris_roster(to_jsonb(a))->>key)::integer)then raise exception 'Choose available soldiers';end if;
  else
   inf:=(p_command->>'infantry')::integer;arc:=(p_command->>'archers')::integer;cav:=(p_command->>'cavalry')::integer;
   if inf is null or arc is null or cav is null or inf<0 or arc<0 or cav<0 or inf>a.infantry or arc>a.archers or cav>a.cavalry then raise exception 'Choose available soldiers';end if;
   chosen:=public.peris_roster_take_classes(public.peris_roster(to_jsonb(a)),jsonb_build_object('infantry',inf,'archers',arc,'cavalry',cav));
  end if;
  if public.peris_roster_total(chosen)=0 or public.peris_roster_total(chosen)+t.infantry+t.archers+t.cavalry>1000 then raise exception 'Stay within the 1000 soldier capacity';end if;
  perform public.peris_write_roster(a.id,public.peris_roster_add(public.peris_roster(to_jsonb(a)),chosen,-1));
  perform public.peris_write_roster(t.id,public.peris_roster_add(public.peris_roster(to_jsonb(t)),chosen));
 when 'rebaseArmy'then
  position:=public.peris_army_position(a);
  target:=public.peris_home_army_position(s.x,s.y);
  if a.status<>'idle'or a.raid_city_id is not null or sqrt(power(public.peris_wrapped_delta((position->>'x')::numeric,(target->>'x')::numeric),2)+power(public.peris_wrapped_delta((position->>'y')::numeric,(target->>'y')::numeric),2))>90 then raise exception 'Bring this army to the selected city first';end if;
  if exists(select 1 from public.peris_orders where kind='recruit'and army_id=a.id)then raise exception 'Finish training before changing the home city';end if;
  update public.armies set home_settlement_id=s.id where id=a.id;
 else raise exception 'Unknown empire command';
 end case;
 return jsonb_build_object('ok',true);
end $$;
create or replace function public.peris_start_city_raid(p_owner uuid,p_army bigint)returns bigint
language plpgsql security definer set search_path='' as $$
declare a public.armies%rowtype;c public.settlements%rowtype;defenders jsonb;roster jsonb;leader bigint;bid bigint;wall integer;bonus jsonb;
begin
 select * into a from public.armies where id=p_army and owner_id=p_owner;
 select * into c from public.settlements where id=a.raid_city_id and owner_id<>p_owner;
 if a.id is null or c.id is null or to_jsonb(c)->>'ruined_at' is not null or a.status<>'idle'or a.target_x<>c.x or a.target_y<>c.y then return null;end if;
 -- A pact accepted during travel protects the city when the raid arrives.
 if public.peris_social_relation(p_owner,c.owner_id)in('guild','alliance','nap')then perform public.peris_return_raid(a.id);return null;end if;
 -- Avoid waiting on another ruler while the caller already holds its own lock.
 if exists(select 1 from public.peris_settler_expeditions where owner_id in(p_owner,c.owner_id)and status='travelling'and arrival_at<=public.peris_game_now())and not pg_try_advisory_xact_lock(204200)then return null;end if;
 begin perform 1 from public.players where id in(p_owner,c.owner_id)order by id for update nowait;
 exception when lock_not_available then return null;end;
 if exists(select 1 from public.battles where status='active'and(attacker_owner_id in(p_owner,c.owner_id)or defender_owner_id in(p_owner,c.owner_id)))then return null;end if;
 perform public.peris_settle(c.owner_id);
 perform 1 from public.armies where id=a.id for update;
 select * into c from public.settlements where id=c.id for update;
 select coalesce(jsonb_agg(jsonb_build_object('army_id',d.id,'troops',public.peris_roster(to_jsonb(d)))order by d.id),'[]')into defenders
 from public.armies d where d.owner_id=c.owner_id and d.status='idle'and d.raid_target_id is null and d.raid_city_id is null
 and floor(d.target_x/128.0)=floor(c.x/128.0)and floor(d.target_y/128.0)=floor(c.y/128.0);
 select d.id into leader from public.armies d left join public.peris_heroes h on h.army_id=d.id
 where d.owner_id=c.owner_id and d.status='idle'and d.raid_target_id is null and d.raid_city_id is null
 and floor(d.target_x/128.0)=floor(c.x/128.0)and floor(d.target_y/128.0)=floor(c.y/128.0)order by coalesce(h.experience,0)desc,d.id limit 1;
 select public.peris_roster(to_jsonb(g))into roster from public.peris_garrisons g where owner_id=c.owner_id and col=floor(c.x/128.0)::integer and row=floor(c.y/128.0)::integer for update;
 if roster is not null then defenders:=defenders||jsonb_build_array(jsonb_build_object('col',floor(c.x/128.0),'row',floor(c.y/128.0),'troops',roster));end if;
 -- Guild troops remain owned by their sender, and are accounted for individually.
 if to_regclass('public.peris_guild_reinforcements')is not null then
 select defenders||coalesce(jsonb_agg(jsonb_build_object('guild_reinforcement_id',r.id,'troops',r.troops)order by r.id),'[]'::jsonb) into defenders
 from public.peris_guild_reinforcements r
 join public.peris_guild_members sender on sender.player_id=r.owner_id
 join public.peris_guild_members receiver on receiver.player_id=r.recipient_id and receiver.guild_id=sender.guild_id
 where r.target_settlement_id=c.id and r.recipient_id=c.owner_id and r.status='stationed';
 end if;
 select public.peris_roster(g.unit_roster)into roster from public.peris_city_garrisons g where g.settlement_id=c.id and g.owner_id=c.owner_id for update;
 if roster is not null and public.peris_roster_total(roster)>0 then defenders:=defenders||jsonb_build_array(jsonb_build_object('city_garrison_id',c.id,'troops',roster));end if;
 insert into public.battles(attacker_owner_id,defender_owner_id,attacker_army_id,defender_army_id,mode,phase,terrain,difficulty,enemy_name,attacker_ready,defender_ready,defender_faction,raid_city_id,siege_target,city_defenders)
 values(p_owner,c.owner_id,a.id,leader,'pvp','combat',public.peris_battle_terrain(c.x,c.y),'normal',c.name,true,true,c.faction,c.id,a.siege_target,defenders)returning id into bid;
 perform public.peris_add_formations(bid,p_owner,'attacker',a.infantry,a.archers,a.cavalry,90);
 perform public.peris_add_formations(bid,c.owner_id,'defender',0,0,0,90);
 select coalesce(level,0)into wall from public.buildings where settlement_id=c.id and building_type='wall';wall:=coalesce(wall,0);
 bonus:=public.peris_hero_bonuses(leader);
 update public.battle_formations set defence_multiplier=defence_multiplier*(1+public.peris_wall_defence_bonus(wall)),
 attack_multiplier=(1+least(.6,coalesce((select sum(level)*.04 from public.peris_city_slots where settlement_id=c.id and building_type='smithy'),0)))*(bonus->>'damage')::numeric where battle_id=bid and side='defender';
 update public.armies set raid_city_id=null where id=a.id;
 return bid;
end $$;
create or replace function public.peris_finish_city_raid(p_bid bigint,p_winner text,p_reason text)returns void
language plpgsql security definer set search_path='' as $$
declare b public.battles%rowtype;c public.settlements%rowtype;a public.armies%rowtype;party jsonb;initial jsonb;survivors jsonb;def_initial jsonb;def_remaining jsonb;current_roster jsonb;losses jsonb;cumulative jsonb:=public.peris_roster('{}');engines jsonb;loot jsonb:=jsonb_build_object('wood',0,'stone',0,'food',0,'gold',0);r jsonb;damage jsonb;reward jsonb;receipt jsonb;unit_name text;key text;lost integer;start_count integer;party_count integer;total integer;ai integer;di integer;asur integer;dsur integer;carry numeric;owner uuid;winner uuid;commander bigint;side text;g public.peris_garrisons%rowtype;
begin
 select * into b from public.battles where id=p_bid for update;if b.id is null or b.status<>'active'or b.raid_city_id is null then return;end if;
 if p_winner not in('attacker','defender','draw')then raise exception 'Invalid battle outcome';end if;
 if not public.peris_lock_battle_participants(b.attacker_owner_id,b.defender_owner_id)then raise lock_not_available;end if;
 perform public.peris_settle(b.attacker_owner_id);perform public.peris_settle(b.defender_owner_id);
 select * into c from public.settlements where id=b.raid_city_id for update;
 select * into a from public.armies where id=b.attacker_army_id for update;
 select coalesce(sum(f.initial_soldiers)filter(where f.side='attacker'),0),coalesce(sum(f.initial_soldiers)filter(where f.side='defender'),0),coalesce(sum(f.soldiers)filter(where f.side='attacker'),0),coalesce(sum(f.soldiers)filter(where f.side='defender'),0)into ai,di,asur,dsur from public.battle_formations f where f.battle_id=b.id;
 select public.peris_roster(coalesce(jsonb_object_agg(unit,n),'{}'))into initial from(select coalesce(f.recruit_unit,f.unit_type)unit,sum(f.initial_soldiers)n from public.battle_formations f where f.battle_id=b.id and f.side='attacker'group by coalesce(f.recruit_unit,f.unit_type))q;
 select public.peris_roster(coalesce(jsonb_object_agg(unit,n),'{}'))into survivors from(select coalesce(f.recruit_unit,f.unit_type)unit,sum(f.soldiers)n from public.battle_formations f where f.battle_id=b.id and f.side='attacker'group by coalesce(f.recruit_unit,f.unit_type))q;
 def_initial:=public.peris_city_defender_roster(b.id);
 select public.peris_roster(coalesce(jsonb_object_agg(unit,n),'{}'))into def_remaining from(select coalesce(f.recruit_unit,f.unit_type)unit,sum(f.soldiers)n from public.battle_formations f where f.battle_id=b.id and f.side='defender'group by coalesce(f.recruit_unit,f.unit_type))q;
 for party in select value from jsonb_array_elements(b.city_defenders)loop
  losses:=public.peris_roster('{}');
  foreach unit_name in array array['infantry','spearmen','archers','elite','cavalry','scout','heavyCavalry','ram','catapult']loop
   total:=(def_initial->>unit_name)::integer;lost:=total-(def_remaining->>unit_name)::integer;start_count:=(cumulative->>unit_name)::integer;party_count:=(party->'troops'->>unit_name)::integer;
   losses:=jsonb_set(losses,array[unit_name],to_jsonb(case when total=0 then 0 else floor(lost::numeric*(start_count+party_count)/total)::integer-floor(lost::numeric*start_count/total)::integer end));
   cumulative:=jsonb_set(cumulative,array[unit_name],to_jsonb(start_count+party_count));
  end loop;
  if party ? 'army_id'then
   select public.peris_roster(to_jsonb(d))into current_roster from public.armies d where id=(party->>'army_id')::bigint and owner_id=b.defender_owner_id for update;
   perform public.peris_write_roster((party->>'army_id')::bigint,public.peris_roster_add(current_roster,losses,-1));
  elsif party ? 'guild_reinforcement_id' then
   select public.peris_roster(troops)into current_roster from public.peris_guild_reinforcements
    where id=(party->>'guild_reinforcement_id')::bigint and status='stationed' for update;
   if current_roster is not null then
    current_roster:=public.peris_roster_add(current_roster,losses,-1);
    if public.peris_roster_total(current_roster)=0 then
     delete from public.peris_guild_reinforcements where id=(party->>'guild_reinforcement_id')::bigint;
    else update public.peris_guild_reinforcements set troops=current_roster where id=(party->>'guild_reinforcement_id')::bigint;end if;
   end if;
  elsif party ? 'city_garrison_id'then
   select public.peris_roster(garrison.unit_roster)into current_roster from public.peris_city_garrisons garrison where garrison.settlement_id=(party->>'city_garrison_id')::bigint and garrison.owner_id=b.defender_owner_id for update;
   if current_roster is not null then
    current_roster:=public.peris_roster_add(current_roster,losses,-1);
    if public.peris_roster_total(current_roster)=0 then delete from public.peris_city_garrisons where settlement_id=(party->>'city_garrison_id')::bigint and owner_id=b.defender_owner_id;
    else update public.peris_city_garrisons set unit_roster=current_roster where settlement_id=(party->>'city_garrison_id')::bigint and owner_id=b.defender_owner_id;end if;
   end if;
  else
   select * into g from public.peris_garrisons where owner_id=b.defender_owner_id and col=(party->>'col')::integer and row=(party->>'row')::integer for update;
   if g.owner_id is not null then
    current_roster:=public.peris_roster_add(public.peris_roster(to_jsonb(g)),losses,-1);
    update public.peris_garrisons set unit_roster=current_roster,infantry=public.peris_roster_class(current_roster,'infantry'),archers=public.peris_roster_class(current_roster,'archers'),cavalry=public.peris_roster_class(current_roster,'cavalry')where owner_id=g.owner_id and col=g.col and row=g.row;
    delete from public.peris_garrisons where owner_id=g.owner_id and col=g.col and row=g.row and infantry+archers+cavalry=0;
   end if;
  end if;
 end loop;
 perform public.peris_write_roster(a.id,public.peris_roster_add(survivors,coalesce(a.raid_reserve,'{}')));
 select coalesce(sum(f.soldiers*u.carry),0)into carry from public.battle_formations f join public.peris_unit_catalog u on u.unit=coalesce(f.recruit_unit,f.unit_type)where f.battle_id=b.id and f.side='attacker';
 carry:=floor(carry*public.peris_research_factor(b.attacker_owner_id,'carry'));
 if p_winner='attacker'then
  loot:=public.peris_take_camp_loot(jsonb_build_object('wood',floor(c.wood),'stone',floor(c.stone),'food',floor(c.food),'gold',floor(c.gold)),carry);
  update public.settlements set wood=wood-(loot->>'wood')::numeric,stone=stone-(loot->>'stone')::numeric,food=food-(loot->>'food')::numeric,gold=gold-(loot->>'gold')::numeric where id=c.id;
  select public.peris_roster(coalesce(jsonb_object_agg(unit,n),'{}'))into engines from(select coalesce(f.recruit_unit,f.unit_type)unit,sum(f.soldiers)n from public.battle_formations f where f.battle_id=b.id and f.side='attacker'and f.status<>'routed'group by coalesce(f.recruit_unit,f.unit_type))q;
  engines:=jsonb_set(jsonb_set(engines,'{ram}',to_jsonb(floor((engines->>'ram')::integer*public.peris_research_factor(b.attacker_owner_id,'siege'))::integer)),'{catapult}',to_jsonb(floor((engines->>'catapult')::integer*public.peris_research_factor(b.attacker_owner_id,'siege'))::integer));
  damage:=public.peris_damage_city(c.id,engines,b.siege_target);
 else damage:='[]';end if;
 winner:=case p_winner when 'attacker'then b.attacker_owner_id when 'defender'then b.defender_owner_id end;
 r:=jsonb_build_object('balance_version',b.balance_version,'attacker_initial',ai,'defender_initial',di,'attacker_survivors',asur,'defender_survivors',dsur,'attacker_losses',ai-asur,'defender_losses',di-dsur,'attacker_roster',initial,'attacker_survivor_roster',survivors,'defender_roster',def_initial,'defender_survivor_roster',def_remaining,'attacker_faction',coalesce(b.attacker_faction,(select faction from public.settlements where id=a.home_settlement_id)),'defender_faction',coalesce(b.defender_faction,c.faction),'loot',loot,'duration',round(b.elapsed),'reason',p_reason,'carrying_capacity',carry,'replacement_cost',public.peris_roster_loss_cost(initial,survivors,b.balance_version),'raid_city',jsonb_build_object('id',c.id,'name',c.name),'siege_damage',damage,
   'city_ruined',exists(select 1 from public.settlements where id=c.id and ruined_at is not null));
 if carry=0 or(loot->>'wood')::numeric+(loot->>'stone')::numeric+(loot->>'food')::numeric+(loot->>'gold')::numeric=0 then r:=r||jsonb_build_object('estimated_profit',public.peris_resource_difference(loot,r->'replacement_cost'));end if;
 update public.armies set status='idle',raid_city_id=null,raid_target_id=null,raid_reserve=null,march_sent_at=null,march_cancel_until=null,carried_loot=loot,loot_report_id=b.id,updated_at=now()where id=a.id;
 for side in select unnest(array['attacker','defender'])loop
  owner:=case side when 'attacker'then b.attacker_owner_id else b.defender_owner_id end;
  commander:=case side when 'attacker'then a.id else b.defender_army_id end;
  reward:=case when commander is not null then public.peris_battle_hero_reward(commander,case side when 'attacker'then(di-dsur)*2 else(ai-asur)*2 end+case when owner=winner then 50 else 20 end,null,b.id)end;
  receipt:=r||jsonb_build_object('report_side',side,'hero_reward',reward);
  if side='attacker'then r:=r||jsonb_build_object('hero_reward',reward);end if;
  if owner=winner then update public.players set victories=victories+1,prestige=prestige+25 where id=owner;end if;
  insert into public.peris_reports(owner_id,battle_id,title,won,result)values(owner,b.id,case side when 'attacker'then c.name else 'Defence of '||c.name end,coalesce(owner=winner,false),receipt)on conflict(owner_id,battle_id)do nothing;
 end loop;
 update public.battles set status='resolved',phase='finished',winner_side=p_winner,winner_owner_id=winner,ended_at=public.peris_game_now(),result=r where id=b.id;
 if not public.peris_return_raid(a.id)then
  update public.armies set start_x=(public.peris_home_army_position(s.x,s.y)->>'x')::integer,start_y=(public.peris_home_army_position(s.x,s.y)->>'y')::integer,target_x=(public.peris_home_army_position(s.x,s.y)->>'x')::integer,target_y=(public.peris_home_army_position(s.x,s.y)->>'y')::integer,march_path=null,march_distance=null,march_returning=false from public.settlements s where armies.id=a.id and s.id=a.home_settlement_id;
  perform public.peris_deliver_loot(a.id);
 end if;
end $$;
create or replace function public.peris_ruin_city(p_city bigint)returns boolean
language plpgsql security definer set search_path='' as $$
declare city public.settlements%rowtype;garrison public.peris_city_garrisons%rowtype;g public.peris_garrisons%rowtype;a public.armies%rowtype;route jsonb;
 old_fields text[];city_key text;pos jsonb;target_key text;living_count integer;
begin
 select * into city from public.settlements where id=p_city for update;
 if city.id is null or city.ruined_at is not null then return false;end if;
 if exists(select 1 from public.buildings where settlement_id=p_city and level>0)
    or exists(select 1 from public.peris_city_slots where settlement_id=p_city and level>0)then return false;end if;
 city_key:=floor(city.x/128.0)::integer||':'||floor(city.y/128.0)::integer;
 select array_append(coalesce(array_agg(col||':'||row),array[]::text[]),city_key)into old_fields from public.peris_map_plots where settlement_id=p_city;
 update public.settlements set ruined_at=now(),wood=0,stone=0,food=0,gold=0,
    wood_rate=0,stone_rate=0,food_rate=0,gold_rate=0,settlers=0,population=0 where id=p_city;
 delete from public.peris_orders where settlement_id=p_city;
 update public.peris_settler_expeditions set status='returned' where origin_settlement_id=p_city and status='travelling';
 -- Dedicated city defenders evacuate using the same no-commander transport.
 for garrison in select * from public.peris_city_garrisons where settlement_id=p_city and owner_id=city.owner_id for update loop
  route:=public.peris_ruin_route(city.owner_id,city.x,city.y);
  if route is not null and public.peris_roster_total(garrison.unit_roster)>0 then
   insert into public.peris_ruin_evacuations(owner_id,origin_settlement_id,target_settlement_id,origin_x,origin_y,troops,departure_at,arrival_at)
   values(city.owner_id,city.id,(route->>'city_id')::bigint,city.x,city.y,public.peris_roster(garrison.unit_roster),public.peris_game_now(),
     public.peris_game_now()+make_interval(secs=>greatest(2,(route->>'distance')::numeric/22)::double precision));
  end if;
  delete from public.peris_city_garrisons where settlement_id=p_city and owner_id=city.owner_id;
 end loop;
 -- Transport surviving station pools before abandoning the claimed fields.
 for g in select * from public.peris_garrisons where owner_id=city.owner_id and (col||':'||row)=any(old_fields)for update loop
  route:=public.peris_ruin_route(city.owner_id,g.col*128+64,g.row*128+64);
  if route is not null and public.peris_roster_total(public.peris_roster(to_jsonb(g)))>0 then
   insert into public.peris_ruin_evacuations(owner_id,origin_settlement_id,target_settlement_id,origin_x,origin_y,troops,departure_at,arrival_at)
   values(city.owner_id,city.id,(route->>'city_id')::bigint,g.col*128+64,g.row*128+64,public.peris_roster(to_jsonb(g)),public.peris_game_now(),
    public.peris_game_now()+make_interval(secs=>greatest(2,(route->>'distance')::numeric/22)::double precision));
  end if;
  delete from public.peris_garrisons where owner_id=g.owner_id and col=g.col and row=g.row;
 end loop;
 delete from public.peris_map_plots where settlement_id=p_city;
 select count(*)into living_count from public.settlements where owner_id=city.owner_id and ruined_at is null;
 if living_count=0 then
  update public.players set defeated_at=coalesce(defeated_at,now()),culture_points=0 where id=city.owner_id;
  delete from public.peris_ruin_evacuations where owner_id=city.owner_id;
  delete from public.peris_city_reinforcements where owner_id=city.owner_id;
  if to_regclass('public.peris_guild_reinforcements')is not null then
   delete from public.peris_guild_reinforcements where owner_id=city.owner_id;
  end if;
  delete from public.peris_garrisons where owner_id=city.owner_id;
  delete from public.peris_orders where owner_id=city.owner_id;
  update public.peris_settler_expeditions set status='returned'where owner_id=city.owner_id and status='travelling';
  update public.peris_campaign_farms set enabled=false where owner_id=city.owner_id;
  for a in select * from public.armies where owner_id=city.owner_id for update loop
   perform public.peris_write_roster(a.id,public.peris_roster('{}'));
   update public.armies set status='idle',raid_city_id=null,raid_target_id=null,raid_reserve=null,march_path=null,march_distance=null,march_origin=null,march_returning=false,march_sent_at=null,march_cancel_until=null,carried_loot=null,updated_at=now()where id=a.id;
  end loop;
  return true;
 end if;
 for a in select * from public.armies where owner_id=city.owner_id order by id for update loop
  pos:=public.peris_army_position(a);
  target_key:=floor(a.target_x/128.0)::integer||':'||floor(a.target_y/128.0)::integer;
  if a.home_settlement_id=city.id or target_key=any(old_fields) or
   (a.status='idle' and (floor((pos->>'x')::numeric/128.0)::integer||':'||floor((pos->>'y')::numeric/128.0)::integer)=any(old_fields))then
   perform public.peris_ruin_redirect_army(a.id);
  end if;
 end loop;
 return true;
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
notify pgrst,'reload schema';
commit;