-- PERIS: direct city-garrison recruitment and marching garrison reinforcements.
-- Apply after UPGRADE_CITY_GARRISONS.sql, once. No existing units are changed.
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

do $$ begin if to_regclass('public.peris_city_garrisons') is null or to_regprocedure('public.peris_ruin_city(bigint)') is null then raise exception 'Apply the existing City Ruins and City Garrisons updates first'; end if; end $$;
-- Logistics belong to their real city, never to a synthetic/zero-cost hero.
-- Old recruitment orders retain their original legion destination.
alter table public.peris_orders add column if not exists recruit_destination text not null default 'legion';
alter table public.peris_orders drop constraint if exists peris_orders_recruit_destination_check;
alter table public.peris_orders add constraint peris_orders_recruit_destination_check check(recruit_destination in ('legion','garrison'));

create table if not exists public.peris_city_reinforcements (
 id bigint generated always as identity primary key,
 owner_id uuid not null references public.players(id) on delete cascade,
 source_settlement_id bigint not null references public.settlements(id) on delete cascade,
 target_settlement_id bigint not null references public.settlements(id) on delete cascade,
 troops jsonb not null,
 march_path jsonb not null,
 target_x integer not null,target_y integer not null,
 departure_at timestamptz not null,arrival_at timestamptz not null,
 check(arrival_at>departure_at)
);
create index if not exists peris_city_reinforcements_due on public.peris_city_reinforcements(owner_id,arrival_at);
alter table public.peris_city_reinforcements enable row level security;
revoke all on public.peris_city_reinforcements from public,anon,authenticated;
grant select on public.peris_city_reinforcements to authenticated;
drop policy if exists "own city reinforcements" on public.peris_city_reinforcements;
create policy "own city reinforcements" on public.peris_city_reinforcements for select to authenticated
 using(owner_id=public.peris_player_id());

-- Atomic merge; concurrent recruitment, transports and battles cannot overwrite a roster.
create or replace function public.peris_city_garrison_receive(p_owner uuid,p_city bigint,p_troops jsonb)returns void
language plpgsql security definer set search_path='' as $$
begin
 if public.peris_roster_total(public.peris_roster(p_troops))<=0 then return;end if;
 if not exists(select 1 from public.settlements where id=p_city and owner_id=p_owner and ruined_at is null)then
  raise exception 'Cannot deliver soldiers to a ruined or foreign city';end if;
 insert into public.peris_city_garrisons(settlement_id,owner_id,unit_roster)
 values(p_city,p_owner,public.peris_roster(p_troops))
 on conflict(settlement_id)do update set unit_roster=public.peris_roster_add(public.peris_city_garrisons.unit_roster,excluded.unit_roster);
end $$;
revoke all on function public.peris_city_garrison_receive(uuid,bigint,jsonb) from public,anon,authenticated;

-- Garrison-to-garrison troop transport along the already validated map-route format.
-- Troops are debited at dispatch and credited once, on the server's due tick.
create or replace function public.peris_send_city_reinforcements(p_owner uuid,p_source bigint,p_target bigint,p_troops jsonb,p_path jsonb)returns jsonb
language plpgsql security definer set search_path='' as $$
declare source_city public.settlements%rowtype;destination public.settlements%rowtype;
 selected jsonb;stock jsonb;remaining jsonb;distance numeric;pace numeric;origin jsonb;arrival jsonb;new_id bigint;role text;
begin
 if p_owner is null then raise exception 'Authentication required';end if;
 if p_source is null or p_target is null or p_source=p_target then raise exception 'Choose two different cities';end if;
 if exists(select 1 from public.players where id=p_owner and defeated_at is not null)then raise exception 'This ruler is defeated';end if;
 if exists(select 1 from public.battles where status='active'and(attacker_owner_id=p_owner or defender_owner_id=p_owner))then
  raise exception 'Finish the current battle first';end if;
 select * into source_city from public.settlements where id=p_source and owner_id=p_owner and ruined_at is null for update;
 select * into destination from public.settlements where id=p_target and owner_id=p_owner and ruined_at is null for update;
 if source_city.id is null or destination.id is null then raise exception 'Choose two living cities you own';end if;
 selected:=public.peris_garrison_troops(p_troops);
 if public.peris_roster_total(selected)=0 then raise exception 'Send at least one soldier';end if;
 select g.unit_roster into stock from public.peris_city_garrisons g where g.settlement_id=p_source and g.owner_id=p_owner for update;
 if stock is null then raise exception 'No permanent defenders are stationed in the sending city';end if;
 stock:=public.peris_roster(stock);
 foreach role in array array['infantry','spearmen','archers','elite','cavalry','scout','heavyCavalry','ram','catapult']loop
  if (selected->>role)::integer>(stock->>role)::integer then raise exception 'Choose soldiers currently in the sending garrison';end if;
 end loop;
 origin:=public.peris_home_army_position(source_city.x,source_city.y);
 arrival:=public.peris_home_army_position(destination.x,destination.y);
 distance:=public.peris_route_distance((origin->>'x')::numeric,(origin->>'y')::numeric,(arrival->>'x')::numeric,(arrival->>'y')::numeric,p_path);
 select coalesce(min(speed),40)into pace from public.peris_unit_catalog where coalesce((selected->>unit)::integer,0)>0;
 pace:=greatest(1,22*pace/40);
 remaining:=public.peris_roster_add(stock,selected,-1);
 if public.peris_roster_total(remaining)=0 then delete from public.peris_city_garrisons where settlement_id=p_source and owner_id=p_owner;
 else update public.peris_city_garrisons set unit_roster=remaining where settlement_id=p_source and owner_id=p_owner;end if;
 insert into public.peris_city_reinforcements(owner_id,source_settlement_id,target_settlement_id,troops,march_path,target_x,target_y,departure_at,arrival_at)
 values(p_owner,p_source,p_target,selected,p_path,(arrival->>'x')::integer,(arrival->>'y')::integer,public.peris_game_now(),public.peris_game_now()+make_interval(secs=>greatest(2,distance/pace)::double precision))returning id into new_id;
 return jsonb_build_object('ok',true,'reinforcement_id',new_id);
end $$;
revoke all on function public.peris_send_city_reinforcements(uuid,bigint,bigint,jsonb,jsonb) from public,anon,authenticated;

create or replace function public.peris_city_reinforcements_advance(p_owner uuid,p_until timestamptz)returns void
language plpgsql security definer set search_path='' as $$
declare party public.peris_city_reinforcements%rowtype;city public.settlements%rowtype;reroute jsonb;
begin
 for party in select * from public.peris_city_reinforcements where owner_id=p_owner and arrival_at<=p_until order by arrival_at,id for update loop
  select * into city from public.settlements where id=party.target_settlement_id and owner_id=p_owner and ruined_at is null;
  if city.id is not null then
   perform public.peris_city_garrison_receive(p_owner,city.id,party.troops);
   delete from public.peris_city_reinforcements where id=party.id;
  else
   -- The convoy reaches a ruined city, then must make another real journey.
   reroute:=public.peris_ruin_route(p_owner,party.target_x,party.target_y);
   if reroute is null then delete from public.peris_city_reinforcements where id=party.id;
   else
    update public.peris_city_reinforcements set target_settlement_id=(reroute->>'city_id')::bigint,
     departure_at=p_until,arrival_at=p_until+make_interval(secs=>greatest(2,(reroute->>'distance')::numeric/22)::double precision),
     march_path=reroute->'path',target_x=(reroute->>'x')::integer,target_y=(reroute->>'y')::integer where id=party.id;
   end if;
  end if;
 end loop;
end $$;
revoke all on function public.peris_city_reinforcements_advance(uuid,timestamptz) from public,anon,authenticated;

create or replace function public.peris_scope_order()returns trigger language plpgsql security definer set search_path='' as $$
begin
 new.settlement_id:=coalesce(new.settlement_id,public.peris_city_id(new.owner_id));
 if not exists(select 1 from public.settlements where id=new.settlement_id and owner_id=new.owner_id and ruined_at is null)then raise exception 'Order city ownership mismatch';end if;
 if new.kind='recruit' and coalesce(new.recruit_destination,'legion')<>'garrison' then
 new.army_id:=coalesce(new.army_id,public.peris_army_id(new.owner_id));
 if not exists(select 1 from public.armies where id=new.army_id and owner_id=new.owner_id)then raise exception 'Order army ownership mismatch';end if;
 end if;return new;
end $$;
create or replace function public.peris_queue_recruit_to(p_type text,p_quantity integer,p_destination text)returns jsonb
language plpgsql security definer set search_path='' as $$
declare u uuid:=public.peris_player_id();s public.settlements%rowtype;a public.armies%rowtype;
 l integer;at_time timestamptz;duration numeric;queued integer;queue_size integer;home jsonb;r public.peris_unit_catalog%rowtype;
begin
 if u is null then raise exception 'Authentication required';end if;
 if p_destination not in('legion','garrison')or p_destination is null then raise exception 'Choose a recruitment destination';end if;
 select * into r from public.peris_unit_catalog where unit=p_type;
 if r.unit is null or p_quantity is null or p_quantity<1 or p_quantity>200 then raise exception 'Choose between 1 and 200 soldiers';end if;
 perform public.peris_settle(u);
 if exists(select 1 from public.battles where status='active'and(attacker_owner_id=u or defender_owner_id=u))then raise exception 'Finish the current battle first';end if;
 select * into s from public.settlements where id=public.peris_city_id(u) and owner_id=u and ruined_at is null for update;
 if s.id is null then raise exception 'Choose your own living city';end if;
 if p_destination='legion' then
  select * into a from public.armies where id=public.peris_army_id(u) and owner_id=u for update;
  if a.id is null then raise exception 'Choose your legion';end if;
  home:=public.peris_home_army_position(s.x,s.y);
  if a.status='moving' or a.raid_target_id is not null or a.raid_city_id is not null or a.raid_reserve is not null
   or sqrt(power(a.target_x-(home->>'x')::integer,2)+power(a.target_y-(home->>'y')::integer,2))>90 then
   raise exception 'Bring your army home to recruit';end if;
  select count(*),coalesce(sum(quantity),0)into queue_size,queued from public.peris_orders
   where owner_id=u and army_id=a.id and kind='recruit'and recruit_destination='legion';
  if queue_size>=3 then raise exception 'Training queue is full';end if;
  if a.infantry+a.archers+a.cavalry+queued+p_quantity>1000 then raise exception 'Army capacity is 1,000 soldiers';end if;
 else
  select count(*)into queue_size from public.peris_orders where owner_id=u and settlement_id=s.id and kind='recruit'and recruit_destination='garrison';
  if queue_size>=3 then raise exception 'Garrison training queue is full';end if;
 end if;
 select coalesce(sum(level),0)into l from public.peris_city_slots where settlement_id=s.id and building_type=r.building;
 if l=0 then raise exception 'Build % first',r.building;end if;
 if r.research_seconds>0 and public.peris_research_bonus(u,'unlock_'||p_type)=0
  and not exists(select 1 from public.peris_unit_research where settlement_id=s.id and unit=p_type and completes_at<=public.peris_game_now())then
  raise exception 'Research this unit in this village first';end if;
 if s.wood<(r.cost->>'wood')::integer*p_quantity or s.stone<(r.cost->>'stone')::integer*p_quantity or
    s.food<(r.cost->>'food')::integer*p_quantity or s.gold<(r.cost->>'gold')::integer*p_quantity then raise exception 'Your stores cannot cover this cost';end if;
 select greatest(public.peris_game_now(),coalesce(max(o.finish_at),public.peris_game_now()))into at_time from public.peris_orders o
 join public.peris_unit_catalog c on c.unit=o.item where o.settlement_id=s.id and o.kind='recruit'and c.building=r.building;
 duration:=greatest(5,ceil(p_quantity*r.train_seconds/((1+(l-1)*.18)*public.peris_research_factor(u,'training'))));
 update public.settlements set wood=wood-(r.cost->>'wood')::integer*p_quantity,
  stone=stone-(r.cost->>'stone')::integer*p_quantity,food=food-(r.cost->>'food')::integer*p_quantity,
  gold=gold-(r.cost->>'gold')::integer*p_quantity where id=s.id;
 insert into public.peris_orders(owner_id,settlement_id,army_id,recruit_destination,kind,item,quantity,started_at,finish_at)
 values(u,s.id,case when p_destination='legion'then a.id else null end,p_destination,'recruit',p_type,p_quantity,
  at_time,at_time+make_interval(secs=>duration::double precision));
 return jsonb_build_object('ok',true,'destination',p_destination);
end $$;
create or replace function public.peris_queue_recruit(p_type text,p_quantity integer)returns jsonb
language sql security definer set search_path='' as $$
 select public.peris_queue_recruit_to(p_type,p_quantity,'legion')
$$;
create or replace function public.peris_settle(p_owner uuid,p_until timestamptz default public.peris_game_now()) returns void
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
notify pgrst,'reload schema';
commit;