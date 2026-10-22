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
  departure_at=now(),arrival_at=now()+make_interval(secs=>greatest(2,(route->>'distance')::numeric/greatest(1,public.peris_march_speed(a.id)))::double precision),updated_at=now()where id=a.id;
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
declare city public.settlements%rowtype;g public.peris_garrisons%rowtype;a public.armies%rowtype;route jsonb;
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
 -- Transport surviving station pools before abandoning the claimed fields.
 for g in select * from public.peris_garrisons where owner_id=city.owner_id and (col||':'||row)=any(old_fields)for update loop
  route:=public.peris_ruin_route(city.owner_id,g.col*128+64,g.row*128+64);
  if route is not null and public.peris_roster_total(public.peris_roster(to_jsonb(g)))>0 then
   insert into public.peris_ruin_evacuations(owner_id,origin_settlement_id,target_settlement_id,origin_x,origin_y,troops,departure_at,arrival_at)
   values(city.owner_id,city.id,(route->>'city_id')::bigint,g.col*128+64,g.row*128+64,public.peris_roster(to_jsonb(g)),now(),
    now()+make_interval(secs=>greatest(2,(route->>'distance')::numeric/22)::double precision));
  end if;
  delete from public.peris_garrisons where owner_id=g.owner_id and col=g.col and row=g.row;
 end loop;
 delete from public.peris_map_plots where settlement_id=p_city;
 select count(*)into living_count from public.settlements where owner_id=city.owner_id and ruined_at is null;
 if living_count=0 then
  update public.players set defeated_at=coalesce(defeated_at,now()),culture_points=0 where id=city.owner_id;
  delete from public.peris_ruin_evacuations where owner_id=city.owner_id;
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
