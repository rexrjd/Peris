-- PERIS permanent city ruins: focused upgrade for an existing V19 database.
-- REVIEW FIRST. Back up your database. Not automatically deployed.
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

-- PERIS city ruins and permanent ruler defeat. All timestamps are authoritative.
-- These columns preserve existing IDs, reports, sessions, and older saves.
alter table public.settlements add column if not exists ruined_at timestamptz;
alter table public.players add column if not exists defeated_at timestamptz;
alter table public.settlements drop constraint if exists settlements_population_check;
alter table public.settlements add constraint settlements_population_check check(population between 0 and 2500);
create index if not exists peris_living_cities_owner on public.settlements(owner_id,id) where ruined_at is null;
create table if not exists public.peris_ruin_evacuations (
 id bigint generated always as identity primary key,
 owner_id uuid not null references public.players(id) on delete cascade,
 origin_settlement_id bigint not null references public.settlements(id) on delete cascade,
 target_settlement_id bigint not null references public.settlements(id) on delete cascade,
 origin_x integer not null,origin_y integer not null,
 troops jsonb not null,departure_at timestamptz not null,arrival_at timestamptz not null
);
create index if not exists peris_ruin_evacuations_due on public.peris_ruin_evacuations(owner_id,arrival_at);
alter table public.peris_ruin_evacuations enable row level security;
revoke all on public.peris_ruin_evacuations from public,anon,authenticated;
grant select on public.peris_ruin_evacuations to authenticated;
drop policy if exists "own ruin evacuations" on public.peris_ruin_evacuations;
create policy "own ruin evacuations" on public.peris_ruin_evacuations for select to authenticated using(owner_id=public.peris_player_id());

-- BFS over the same wrapped 200 x 200 land mask and no-corner-cut diagonals.
-- Return a validated route to the first reachable surviving city. Never teleport.
create or replace function public.peris_ruin_route(p_owner uuid,p_x integer,p_y integer)returns jsonb
language plpgsql stable security definer set search_path='' as $$
declare visited integer[]:=array_fill(0,array[40000]); parents integer[]:=array_fill(0,array[40000]); queue integer[]:=array_fill(0,array[40000]);
 start_col integer:=public.peris_wrap_cell(floor(p_x/128.0)::integer);
 start_row integer:=public.peris_wrap_cell(floor(p_y/128.0)::integer);
 start_idx integer;current_idx integer;next_idx integer;goal_idx integer:=0;cx integer;cy integer;nx integer;ny integer;
 dx integer;dy integer;head integer:=1;tail integer:=1;target public.settlements%rowtype; candidate public.settlements%rowtype;
 cells integer[]:='{}';point_idx integer;tx integer;ty integer;px integer:=p_x;py integer:=p_y;
 position jsonb;route jsonb;distance numeric:=0;change_x numeric;change_y numeric;
begin
 if p_x is null or p_y is null or not public.peris_world_walkable(p_x,p_y)then return null;end if;
 start_idx:=(start_row+100)*200+start_col+101;
 queue[1]:=start_idx;visited[start_idx]:=1;
 while head<=tail loop
  current_idx:=queue[head];head:=head+1;
  cx:=mod(current_idx-1,200)-100;cy:=floor((current_idx-1)/200.0)::integer-100;
  for candidate in select * from public.settlements s where s.owner_id=p_owner and s.ruined_at is null order by id loop
   if floor(candidate.x/128.0)::integer=cx and floor(candidate.y/128.0)::integer=cy then
    target:=candidate;goal_idx:=current_idx;exit;
   end if;
  end loop;
  exit when goal_idx>0;
  for dx in -1..1 loop for dy in -1..1 loop
   if dx=0 and dy=0 then continue;end if;
   nx:=public.peris_wrap_cell(cx+dx);ny:=public.peris_wrap_cell(cy+dy);
   next_idx:=(ny+100)*200+nx+101;
   if visited[next_idx]<>0 or not public.peris_world_walkable(nx*128+64,ny*128+64)then continue;end if;
   if dx<>0 and dy<>0 and (not public.peris_world_walkable(nx*128+64,cy*128+64)
     or not public.peris_world_walkable(cx*128+64,ny*128+64))then continue;end if;
   visited[next_idx]:=1;parents[next_idx]:=current_idx;tail:=tail+1;queue[tail]:=next_idx;
  end loop;end loop;
 end loop;
 if goal_idx=0 then return null;end if;
 current_idx:=goal_idx;
 while current_idx<>start_idx loop
  cells:=array_prepend(current_idx,cells);
  current_idx:=parents[current_idx];
  if current_idx=0 then return null;end if;
 end loop;
 route:=jsonb_build_array(jsonb_build_array(p_x,p_y));
 foreach point_idx in array cells loop
  tx:=(mod(point_idx-1,200)-100)*128+64;
  ty:=(floor((point_idx-1)/200.0)::integer-100)*128+64;
  change_x:=public.peris_wrapped_delta(px,tx);change_y:=public.peris_wrapped_delta(py,ty);
  distance:=distance+sqrt(change_x*change_x+change_y*change_y);
  route:=route||jsonb_build_array(jsonb_build_array(tx,ty));px:=tx;py:=ty;
 end loop;
 position:=public.peris_home_army_position(target.x,target.y);
 tx:=(position->>'x')::integer;ty:=(position->>'y')::integer;
 if px<>tx or py<>ty then
  change_x:=public.peris_wrapped_delta(px,tx);change_y:=public.peris_wrapped_delta(py,ty);
  distance:=distance+sqrt(change_x*change_x+change_y*change_y);
  route:=route||jsonb_build_array(jsonb_build_array(tx,ty));
 end if;
 return jsonb_build_object('city_id',target.id,'path',route,'distance',distance,'x',tx,'y',ty);
end $$;

-- Each hero remains attached to their existing army. Never spawn free commanders.
create or replace function public.peris_ruin_redirect_army(p_army bigint)returns boolean
language plpgsql security definer set search_path='' as $$
declare a public.armies%rowtype;position jsonb;route jsonb;owner_defeated boolean;
begin
 select * into a from public.armies where id=p_army for update;
 if a.id is null then return false;end if;
 select defeated_at is not null into owner_defeated from public.players where id=a.owner_id;
 if owner_defeated then
  perform public.peris_write_roster(a.id,public.peris_roster('{}'));
  update public.armies set status='idle',raid_city_id=null,raid_target_id=null,raid_reserve=null,march_path=null,march_distance=null,march_origin=null,march_returning=false,march_sent_at=null,march_cancel_until=null,carried_loot=null,updated_at=now()where id=a.id;
  return false;
 end if;
 if exists(select 1 from public.battles b where b.status='active'and (b.attacker_army_id=a.id or b.defender_army_id=a.id))then return false;end if;
 position:=public.peris_army_position(a);
 route:=public.peris_ruin_route(a.owner_id,round((position->>'x')::numeric)::integer,round((position->>'y')::numeric)::integer);
 if route is null then
  perform public.peris_write_roster(a.id,public.peris_roster('{}'));
  update public.armies set status='idle',raid_city_id=null,raid_target_id=null,raid_reserve=null,march_path=null,march_distance=null,march_origin=null,march_returning=false,march_sent_at=null,march_cancel_until=null,carried_loot=null,updated_at=now()where id=a.id;
  return false;
 end if;
 update public.armies set home_settlement_id=(route->>'city_id')::bigint,
  start_x=round((position->>'x')::numeric)::integer,start_y=round((position->>'y')::numeric)::integer,
  target_x=(route->>'x')::integer,target_y=(route->>'y')::integer,march_path=route->'path',march_distance=(route->>'distance')::numeric,march_map_version=4,
  status='moving',raid_city_id=null,raid_target_id=null,raid_reserve=null,march_origin=null,march_returning=true,march_sent_at=null,march_cancel_until=null,
  departure_at=public.peris_game_now(),arrival_at=public.peris_game_now()+make_interval(secs=>greatest(2,(route->>'distance')::numeric/greatest(1,public.peris_march_speed(a.id)))::double precision),updated_at=now()where id=a.id;
 return true;
end $$;

-- Deliver GARRISON evacuees as troops, not as new armies. One field can hold
-- multiple legions, so the ordinary 1000-per-legion input limit does not apply.
create or replace function public.peris_ruin_advance(p_owner uuid,p_until timestamptz)returns void
language plpgsql security definer set search_path='' as $$
declare e public.peris_ruin_evacuations%rowtype;s public.settlements%rowtype;route jsonb;existing jsonb;troops jsonb;cx integer;cy integer;
begin
 for e in select * from public.peris_ruin_evacuations where owner_id=p_owner and arrival_at<=p_until order by arrival_at,id for update loop
  select * into s from public.settlements where id=e.target_settlement_id and owner_id=p_owner and ruined_at is null;
  if s.id is null then
   route:=public.peris_ruin_route(p_owner,e.origin_x,e.origin_y);
   if route is null then delete from public.peris_ruin_evacuations where id=e.id;continue;end if;
   update public.peris_ruin_evacuations set target_settlement_id=(route->>'city_id')::bigint,departure_at=p_until,
    arrival_at=p_until+make_interval(secs=>greatest(2,(route->>'distance')::numeric/22)::double precision) where id=e.id;
   continue;
  end if;
  cx:=floor(s.x/128.0)::integer;cy:=floor(s.y/128.0)::integer;
  select public.peris_roster(to_jsonb(g))into existing from public.peris_garrisons g where g.owner_id=p_owner and g.col=cx and g.row=cy for update;
  troops:=public.peris_roster_add(coalesce(existing,public.peris_roster('{}')),e.troops);
  insert into public.peris_garrisons(owner_id,col,row,unit_roster,infantry,archers,cavalry)
   values(p_owner,cx,cy,troops,public.peris_roster_class(troops,'infantry'),public.peris_roster_class(troops,'archers'),public.peris_roster_class(troops,'cavalry'))
   on conflict(owner_id,col,row)do update set unit_roster=excluded.unit_roster,infantry=excluded.infantry,archers=excluded.archers,cavalry=excluded.cavalry;
  delete from public.peris_ruin_evacuations where id=e.id;
 end loop;
end $$;

-- Called exclusively after successful siege damage. Never delete the settlement,
-- account, history or location; ruined_at is permanent and applied only once.
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

create or replace function public.peris_city_id(p_owner uuid)returns bigint language plpgsql security definer set search_path='' as $$
declare requested bigint:=nullif(current_setting('peris.city_id',true),'')::bigint;result bigint;
begin
 if requested is null then select min(id)into result from public.settlements where owner_id=p_owner and ruined_at is null;
 else select id into result from public.settlements where owner_id=p_owner and id=requested and ruined_at is null;end if;
 if result is null then raise exception 'Choose one of your cities';end if;return result;
end $$;
create or replace function public.peris_army_id(p_owner uuid)returns bigint language plpgsql security definer set search_path='' as $$
declare requested bigint:=nullif(current_setting('peris.army_id',true),'')::bigint;result bigint;
begin
 if exists(select 1 from public.players where id=p_owner and defeated_at is not null)then raise exception 'This ruler has been defeated';end if;
 if requested is null then select min(id)into result from public.armies where owner_id=p_owner;
 else select id into result from public.armies where owner_id=p_owner and id=requested;end if;
 if result is null then raise exception 'Choose one of your armies';end if;return result;
end $$;
create or replace function public.peris_scope_order()returns trigger language plpgsql security definer set search_path='' as $$
begin
 new.settlement_id:=coalesce(new.settlement_id,public.peris_city_id(new.owner_id));
 if not exists(select 1 from public.settlements where id=new.settlement_id and owner_id=new.owner_id and ruined_at is null)then raise exception 'Order city ownership mismatch';end if;
 if new.kind='recruit' and coalesce(new.recruit_destination,'legion')<>'garrison' then
 new.army_id:=coalesce(new.army_id,public.peris_army_id(new.owner_id));
 if not exists(select 1 from public.armies where id=new.army_id and owner_id=new.owner_id)then raise exception 'Order army ownership mismatch';end if;
 end if;return new;
end $$;
create or replace function public.peris_station_owned(p_owner uuid,p_col integer,p_row integer)
returns boolean language sql stable security definer set search_path='' as $$
 select exists(select 1 from public.settlements s where s.owner_id=p_owner and s.ruined_at is null
  and public.peris_wrap_cell(floor(s.x/128.0)::integer)=public.peris_wrap_cell(p_col)
  and public.peris_wrap_cell(floor(s.y/128.0)::integer)=public.peris_wrap_cell(p_row))
 or exists(select 1 from public.peris_map_plots p where p.owner_id=p_owner and p.col=public.peris_wrap_cell(p_col) and p.row=public.peris_wrap_cell(p_row))
$$;
create or replace function public.peris_culture_rate(p_owner uuid)returns numeric language sql stable security definer set search_path='' as $$
 select coalesce(sum(5+2*coalesce((select sum(level)from public.buildings b where b.settlement_id=s.id),0)+3*coalesce((select sum(level)from public.peris_city_slots c where c.settlement_id=s.id),0)),0)*public.peris_research_factor(p_owner,'culture')from public.settlements s where s.owner_id=p_owner and s.ruined_at is null
$$;
create or replace function public.peris_found_complete(p_id bigint)returns void language plpgsql security definer set search_path='' as $$
declare e public.peris_settler_expeditions%rowtype;s public.settlements%rowtype;sid bigint;reason text;
begin
 select * into e from public.peris_settler_expeditions where id=p_id for update;if e.id is null or e.status<>'travelling'then return;end if;
 if exists(select 1 from public.players where id=e.owner_id and defeated_at is not null)or exists(select 1 from public.settlements where id=e.origin_settlement_id and ruined_at is not null)then update public.peris_settler_expeditions set status='returned' where id=e.id;return;end if;
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
create or replace function public.peris_march_for_target(p_owner uuid,p_army bigint,p_target_x integer,p_target_y integer,p_path jsonb,p_raid integer,p_city bigint)returns jsonb
language plpgsql security definer set search_path='' as $$
declare u uuid:=p_owner;a public.armies%rowtype;position jsonb;point jsonb;route jsonb;
 tx integer:=public.peris_wrap_world(p_target_x);ty integer:=public.peris_wrap_world(p_target_y);
 x numeric;y numeric;px numeric;py numeric;cx integer;cy integer;pcx integer;pcy integer;
 distance numeric:=0;segment numeric;seconds numeric;count_points integer;ordinal integer:=0;raid_target integer:=p_raid;
begin
 if u is null then raise exception 'Authentication required';end if;
 if p_target_x is null or p_target_y is null then raise exception 'Choose a destination';end if;
 if p_path is null or jsonb_typeof(p_path)<>'array' then raise exception 'Choose a valid land route';end if;
 count_points:=jsonb_array_length(p_path);
 if count_points<2 or count_points>2000 then raise exception 'A march needs 2-2000 route points';end if;
 perform public.peris_settle(u);
 if exists(select 1 from public.battles where status='active' and (attacker_owner_id=u or defender_owner_id=u)) then raise exception 'Finish the current battle first';end if;
 if exists(select 1 from public.peris_orders where owner_id=u and army_id=p_army and kind='recruit') then raise exception 'Let training finish before marching';end if;
 select * into a from public.armies where id=p_army and owner_id=u for update;
 if a.id is null then raise exception 'Army not found';end if;
 if a.status<>'idle' or a.raid_target_id is not null or a.raid_city_id is not null or a.raid_reserve is not null then raise exception 'This legion already has a march or raid. Cancel within 30 seconds or wait for its return';end if;
 position:=public.peris_army_position(a);
 px:=(position->>'x')::numeric;py:=(position->>'y')::numeric;
 if (raid_target is not null or p_city is not null) and not public.peris_station_owned(u,floor(px/128)::integer,floor(py/128)::integer)then raise exception 'Depart from one of your own villages or claimed fields';end if;
 if p_city is not null and not exists(select 1 from public.settlements c where c.id=p_city and c.owner_id<>u and c.ruined_at is null and c.x=tx and c.y=ty)then raise exception 'Choose another player''s city';end if;
 if not public.peris_station_owned(u,floor(tx/128.0)::integer,floor(ty/128.0)::integer) and not exists(select 1 from public.peris_camps c where c.id=raid_target and c.x=tx and c.y=ty)and p_city is null then raise exception 'Troops can only station in your own villages and fields';end if;
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
 seconds:=greatest(2,distance/public.peris_march_speed(a.id));
 update public.armies set start_x=round((position->>'x')::numeric),start_y=round((position->>'y')::numeric),target_x=tx,target_y=ty,
  march_path=route,march_distance=distance,march_map_version=4,march_sent_at=public.peris_game_now(),march_cancel_until=public.peris_game_now()+interval '30 seconds',
  march_origin=jsonb_build_object('col',floor((position->>'x')::numeric/128),'row',floor((position->>'y')::numeric/128),'x',round((position->>'x')::numeric),'y',round((position->>'y')::numeric)),march_returning=false,
  departure_at=public.peris_game_now()+interval '30 seconds',arrival_at=public.peris_game_now()+interval '30 seconds'+make_interval(secs=>seconds::double precision),
  status='moving',raid_target_id=null,raid_city_id=p_city,siege_target='auto',farm_list_id=null,updated_at=now() where id=a.id;
 return jsonb_build_object('ok',true);
end $$;
create or replace function public.peris_return_raid(p_army bigint)returns boolean
language plpgsql security definer set search_path='' as $$
declare a public.armies%rowtype;route jsonb;seconds numeric;
begin
 select * into a from public.armies where id=p_army for update;
 if a.march_returning then return true;end if;
 if a.id is null then return false;end if;
 if a.march_origin is not null and not public.peris_station_owned(a.owner_id,floor((a.march_origin->>'x')::numeric/128.0)::integer,floor((a.march_origin->>'y')::numeric/128.0)::integer)then perform public.peris_ruin_redirect_army(a.id);return true;end if;
 if a.march_origin is null or a.march_path is null or a.march_distance is null then perform public.peris_ruin_redirect_army(a.id);return true;end if;
 select jsonb_agg(value order by ordinal desc) into route from jsonb_array_elements(a.march_path)with ordinality as points(value,ordinal);
 seconds:=greatest(2,a.march_distance/public.peris_march_speed(a.id));
 update public.armies set start_x=a.target_x,start_y=a.target_y,target_x=(a.march_origin->>'x')::integer,target_y=(a.march_origin->>'y')::integer,
  march_path=route,status='moving',raid_target_id=null,raid_city_id=null,siege_target='auto',march_returning=true,march_sent_at=null,march_cancel_until=null,
  departure_at=public.peris_game_now(),arrival_at=public.peris_game_now()+make_interval(secs=>seconds::double precision),updated_at=now() where id=a.id;
 return true;
end $$;
create or replace function public.peris_sync_owner(p_owner uuid)returns jsonb language plpgsql security definer set search_path='' as $$
declare u uuid:=p_owner;a public.armies%rowtype;
begin
 if u is null then raise exception 'Authentication required';end if;
 perform public.peris_settle(u);
 if not exists(select 1 from public.battles where status='active'and(attacker_owner_id=u or defender_owner_id=u))then
 for a in select * from public.armies where owner_id=u and raid_city_id is not null and status='idle'order by arrival_at,id for update loop
  if a.infantry+a.archers+a.cavalry=0 or not exists(select 1 from public.settlements where id=a.raid_city_id and owner_id<>u and ruined_at is null)then perform public.peris_return_raid(a.id);continue;end if;
  if public.peris_start_city_raid(u,a.id)is not null then exit;end if;
 end loop;
 end if;
 if not exists(select 1 from public.battles where status='active'and(attacker_owner_id=u or defender_owner_id=u))then
 for a in select * from public.armies where owner_id=u and raid_target_id is not null and status='idle'order by arrival_at,id for update loop
  if (not exists(select 1 from public.peris_camps where id=a.raid_target_id and bandit) and exists(select 1 from public.peris_progress where owner_id=u and camp_id=a.raid_target_id and available_at>public.peris_game_now()))or a.infantry+a.archers+a.cavalry=0 then
   perform public.peris_restore_raid_reserve(a.id);perform public.peris_return_raid(a.id);update public.armies set raid_target_id=null where id=a.id;continue;
  end if;
  perform set_config('peris.army_id',a.id::text,true);perform public.peris_start_raid(u,a.raid_target_id);exit;
 end loop;
 end if;
 return jsonb_build_object('ok',true);
end $$;
create or replace function public.peris_settle(p_owner uuid,p_until timestamptz default public.peris_game_now())returns void
language plpgsql security definer set search_path='' as $$
begin
 if to_regprocedure('public.peris_market_settle(uuid,timestamp with time zone)')is not null then
  perform public.peris_market_settle(p_owner,p_until);
 else perform public.peris_settle_core(p_owner,p_until);end if;
end $$;
create or replace function public.peris_prepare_city_raid(p_owner uuid,p_army bigint,p_city bigint,p_path jsonb,p_troops jsonb,p_target text default 'auto')returns jsonb
language plpgsql security definer set search_path='' as $$
declare a public.armies%rowtype;c public.settlements%rowtype;available jsonb;chosen jsonb;unit_name text;
begin
 if p_owner is null then raise exception 'Authentication required';end if;
 if p_target not in('auto','market','barracks','stables','workshop','smithy','warehouse','granary','housing','mage_tower','fishery','lumber','quarry','farm','storehouse','trading_post')then raise exception 'Choose a valid catapult target';end if;
 perform public.peris_settle(p_owner);
 select * into a from public.armies where id=p_army and owner_id=p_owner for update;
 select * into c from public.settlements where id=p_city and owner_id<>p_owner;
 if a.id is null or c.id is null or to_jsonb(c)->>'ruined_at' is not null then raise exception 'Choose your legion and another player''s living city';end if;
 if public.peris_social_relation(p_owner,c.owner_id)in('guild','alliance','nap')then raise exception 'Your guild or diplomatic pact protects this city';end if;
 available:=public.peris_roster(to_jsonb(a));chosen:=public.peris_garrison_troops(coalesce(nullif(p_troops,'null'::jsonb),available));
 if public.peris_roster_total(chosen)=0 then raise exception 'Send at least one soldier';end if;
 foreach unit_name in array array['infantry','spearmen','archers','elite','cavalry','scout','heavyCavalry','ram','catapult']loop
  if(chosen->>unit_name)::integer>(available->>unit_name)::integer then raise exception 'Choose troops currently available in this legion';end if;
 end loop;
 perform public.peris_march_for_target(p_owner,a.id,c.x,c.y,p_path,null,c.id);
 perform public.peris_garrison_add(p_owner,floor(a.target_x/128.0)::integer,floor(a.target_y/128.0)::integer,public.peris_roster_add(available,chosen,-1));
 perform public.peris_write_roster(a.id,chosen);
 update public.armies set siege_target=p_target,arrival_at=departure_at+make_interval(secs=>greatest(2,march_distance/public.peris_march_speed(id))::double precision)where id=a.id;
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
create or replace function public.peris_damage_city(p_city bigint,p_engines jsonb,p_target text)returns jsonb
language plpgsql security definer set search_path='' as $$
declare wall public.buildings%rowtype;chosen record;loss integer;damage jsonb:='[]';
begin
 if exists(select 1 from public.settlements where id=p_city and ruined_at is not null)then return '[]'::jsonb;end if;
 select * into wall from public.buildings where settlement_id=p_city and building_type='wall'for update;
 if wall.id is not null then
  loss:=public.peris_siege_reduction(coalesce((p_engines->>'ram')::integer,0),wall.level,'ram');
  if loss>0 then damage:=damage||jsonb_build_array(jsonb_build_object('building_type','wall','name','Walls','before',wall.level,'after',wall.level-loss,'weapon','ram'));update public.buildings set level=level-loss,updated_at=now()where id=wall.id;end if;
 end if;
 select * into chosen from(
  select building_type,level,slot_index,null::bigint as building_id,null::integer as field_col,null::integer as field_row from public.peris_city_slots where settlement_id=p_city
  union all select building_type,level,null::integer,id,null::integer,null::integer from public.buildings where settlement_id=p_city and building_type<>'wall'
  union all select case when building_type='market'then 'trading_post'else building_type end,level,null::integer,null::bigint,col,row from public.peris_map_plots where settlement_id=p_city and building_type is not null
 )q where level>0 and(p_target='auto'or building_type=p_target)order by level desc,building_type collate "C",coalesce(slot_index,999),coalesce(field_col,999),coalesce(field_row,999)limit 1;
 if chosen.level is not null then
  loss:=public.peris_siege_reduction(coalesce((p_engines->>'catapult')::integer,0),chosen.level,'catapult');
  if loss>0 then
   damage:=damage||jsonb_build_array(jsonb_strip_nulls(jsonb_build_object('building_type',chosen.building_type,'name',case chosen.building_type when 'mage_tower'then 'Mage tower'when 'lumber'then 'Lumber mill'when 'trading_post'then 'Trading post'else initcap(chosen.building_type)end,'slot_index',chosen.slot_index,'col',chosen.field_col,'row',chosen.field_row,'before',chosen.level,'after',chosen.level-loss,'weapon','catapult')));
   if chosen.slot_index is not null then update public.peris_city_slots set level=level-loss where settlement_id=p_city and slot_index=chosen.slot_index;
   elsif chosen.field_col is not null then update public.peris_map_plots set level=level-loss where settlement_id=p_city and col=chosen.field_col and row=chosen.field_row;
   else update public.buildings set level=level-loss,updated_at=now()where id=chosen.building_id;end if;
  end if;
 end if;
 if jsonb_array_length(damage)>0 then perform public.peris_city_economy(p_city);end if;
 if coalesce((p_engines->>'catapult')::integer,0)>0 or coalesce((p_engines->>'ram')::integer,0)>0 then perform public.peris_ruin_city(p_city);end if;
 return damage;
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
 'trade_routes',public.peris_optional_trade_routes(),
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
create or replace function public.peris_map_snapshot(p_min_x integer,p_min_y integer,p_max_x integer,p_max_y integer)
returns jsonb language plpgsql security definer set search_path='' as $$
declare u uuid:=public.peris_player_id();min_x integer:=p_min_x;min_y integer:=p_min_y;max_x integer:=p_max_x;max_y integer:=p_max_y;result jsonb;
begin
 if u is null then raise exception 'Authentication required';end if;
 if min_x is null or min_y is null or max_x is null or max_y is null
 or min_x>=max_x or min_y>=max_y or min_x < -38400 or min_y < -38400 or max_x > 38400 or max_y > 38400 then raise exception 'Choose valid map bounds';end if;
 with nearby_settlements as materialized (
   select s.id,s.owner_id,s.name,s.x,s.y,s.faction,s.ruined_at from public.settlements s where s.owner_id<>u
   and public.peris_map_axis_visible(s.x,min_x,max_x) and public.peris_map_axis_visible(s.y,min_y,max_y)
   order by s.id limit 601
 ), visible_settlements as (
   select s.id,s.owner_id,s.name,s.x,s.y,s.faction,s.ruined_at from public.settlements s where s.owner_id=u
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
 select jsonb_build_object('server_now',public.peris_game_now(),'game_clock',public.peris_clock_snapshot(),
   'players',coalesce((select jsonb_agg(jsonb_build_object('id',p.id,'display_name',p.display_name) order by p.id)
     from public.players p join visible_owners o on o.owner_id=p.id),'[]'::jsonb),
   'settlements',coalesce((select jsonb_agg(to_jsonb(s)||jsonb_build_object('map_development',public.peris_map_development(s.id)) order by s.id) from visible_settlements s),'[]'::jsonb),
   'armies',coalesce((select jsonb_agg(case when a.owner_id=u then to_jsonb(a)-'map_x'-'map_y' else to_jsonb(a)-'map_x'-'map_y'-'raid_reserve'-'march_sent_at'-'march_cancel_until'-'march_origin'-'march_returning' end order by a.id) from visible_armies a),'[]'::jsonb),
   'map_plots',coalesce((select jsonb_agg(p order by p.row,p.col) from visible_plots p),'[]'::jsonb),
   'total_players',(select count(*) from public.players),'total_settlements',(select count(*) from public.settlements),
   'settlements_truncated',(select count(*)>600 from nearby_settlements),
   'armies_truncated',(select count(*)>600 from nearby_armies),
   'plots_truncated',(select count(*)>2000 from nearby_plots)) into result;
 return result;
end $$;
create or replace function public.peris_submit_command(p_request_id uuid,p_function text,p_args jsonb)
returns jsonb language plpgsql security definer set search_path='' as $$
declare u uuid:=public.peris_player_id();previous public.peris_command_receipts%rowtype;answer jsonb;
begin
 if u is null or not exists(select 1 from public.players where id=u)then raise exception 'Authentication required';end if;
 if p_request_id is null or p_function is null or p_args is null or jsonb_typeof(p_args)<>'object' or octet_length(p_args::text)>100000 then raise exception 'Choose a valid command';end if;
 perform pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended(u::text||':'||p_request_id::text,0));
 select * into previous from public.peris_command_receipts where owner_id=u and request_id=p_request_id;
 if previous.request_id is not null then
  if previous.function_name is distinct from p_function or previous.arguments is distinct from p_args then raise exception 'This request belongs to a different command';end if;
  return previous.response;
 end if;
 if exists(select 1 from public.players where id=u and defeated_at is not null)then raise exception 'This ruler has been permanently defeated';end if;
 -- A fixed whitelist keeps the receipt endpoint from invoking private helpers.
 case p_function
 when 'peris_trade_route_command' then answer:=public.peris_trade_route_command(p_args->'p_command');
 when 'peris_send_resources' then answer:=public.peris_send_resources((p_args->>'p_source')::bigint,(p_args->>'p_target')::bigint,p_args->'p_resources',p_args->'p_path');
 when 'peris_send_guild_reinforcements' then answer:=public.peris_send_guild_reinforcements((p_args->>'p_source')::bigint,(p_args->>'p_target')::bigint,p_args->'p_troops',p_args->'p_path',(p_args->>'p_army')::bigint);
 when 'peris_recall_guild_reinforcements' then answer:=public.peris_recall_guild_reinforcements((p_args->>'p_id')::bigint);
 when 'peris_empire_command' then answer:=public.peris_empire_command(p_args->'p_command');
 when 'peris_campaign_farm_command' then answer:=public.peris_campaign_farm_command(p_args->'p_command');
 when 'peris_research_unit' then answer:=public.peris_research_unit((p_args->>'p_city')::bigint,p_args->>'p_unit');
 when 'peris_collect_garrison' then answer:=public.peris_collect_garrison((p_args->>'p_army')::bigint,nullif(p_args->'p_troops','null'::jsonb));
 when 'peris_claim_field' then answer:=public.peris_claim_field((p_args->>'p_col')::integer,(p_args->>'p_row')::integer);
 when 'peris_queue_field' then answer:=public.peris_queue_field((p_args->>'p_col')::integer,(p_args->>'p_row')::integer,p_args->>'p_type');
 when 'peris_set_faction' then perform public.peris_set_faction(p_args->>'p_faction');answer:='{}'::jsonb;
 when 'peris_debug_city' then perform public.peris_debug_city(p_args->>'p_action',p_args->>'p_target',(p_args->>'p_value')::integer);answer:='{}'::jsonb;
 when 'peris_research_spell' then answer:=public.peris_research_spell(p_args->>'p_spell');
 when 'peris_queue_slot' then answer:=public.peris_queue_slot((p_args->>'p_slot')::integer,p_args->>'p_type');
 when 'peris_queue_upgrade' then answer:=public.peris_queue_upgrade(p_args->>'p_type');
 when 'peris_queue_recruit' then answer:=public.peris_queue_recruit(p_args->>'p_type',(p_args->>'p_quantity')::integer);
 when 'peris_march' then answer:=public.peris_march((p_args->>'p_target_x')::integer,(p_args->>'p_target_y')::integer,p_args->'p_path');
 when 'move_army' then answer:=public.move_army((p_args->>'p_target_x')::integer,(p_args->>'p_target_y')::integer);
 when 'peris_raid' then answer:=public.peris_raid((p_args->>'p_camp_id')::integer);
 when 'peris_ready' then answer:=public.peris_ready((p_args->>'p_battle_id')::bigint);
 when 'retreat_from_battle' then answer:=public.retreat_from_battle((p_args->>'p_battle_id')::bigint);
 when 'peris_claim' then answer:=public.peris_claim(p_args->>'p_quest_id');
 when 'peris_rename' then answer:=public.peris_rename(p_args->>'p_name');
 when 'peris_challenge' then answer:=public.peris_challenge((p_args->>'p_defender')::uuid);
 when 'peris_respond' then answer:=public.peris_respond((p_args->>'p_id')::bigint,(p_args->>'p_accept')::boolean);
 else raise exception 'This command is not available';
 end case;
 insert into public.peris_command_receipts(owner_id,request_id,function_name,arguments,response)values(u,p_request_id,p_function,p_args,coalesce(answer,'{}'::jsonb));
 return coalesce(answer,'{}'::jsonb);
end $$;
revoke all on function public.peris_ruin_route(uuid,integer,integer),public.peris_ruin_redirect_army(bigint),public.peris_ruin_advance(uuid,timestamptz),public.peris_ruin_city(bigint) from public,anon,authenticated;
notify pgrst,'reload schema';
commit;