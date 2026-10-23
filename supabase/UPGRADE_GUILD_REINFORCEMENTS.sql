-- Apply AFTER City Logistics and V19 Guilds. No existing garrisons are reassigned.
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

-- Guild support: troops belong to their sender, never to the city receiving help.
create table if not exists public.peris_guild_reinforcements (
 id bigint generated always as identity primary key,
 owner_id uuid not null references public.players(id) on delete cascade,
 recipient_id uuid not null references public.players(id) on delete cascade,
 source_settlement_id bigint not null references public.settlements(id),
 target_settlement_id bigint not null references public.settlements(id),
 troops jsonb not null,
 march_path jsonb not null,
 target_x integer not null, target_y integer not null,
 status text not null default 'outbound' check(status in('outbound','stationed','returning')),
 departure_at timestamptz not null default public.peris_game_now(), arrival_at timestamptz,
 check(owner_id<>recipient_id)
);
alter table public.peris_guild_reinforcements add column if not exists faction text;
alter table public.peris_guild_reinforcements add column if not exists recipient_settlement_id bigint references public.settlements(id);
update public.peris_guild_reinforcements set recipient_settlement_id=target_settlement_id where recipient_settlement_id is null and status<>'returning';
create index if not exists peris_guild_reinforcements_due on public.peris_guild_reinforcements(owner_id,arrival_at)
 where status in('outbound','returning');
create index if not exists peris_guild_reinforcements_city on public.peris_guild_reinforcements(target_settlement_id)where status='stationed';
alter table public.peris_guild_reinforcements enable row level security;
revoke all on public.peris_guild_reinforcements from public,anon,authenticated;
grant select on public.peris_guild_reinforcements to authenticated;
drop policy if exists "guild reinforcement participants" on public.peris_guild_reinforcements;
create policy "guild reinforcement participants" on public.peris_guild_reinforcements for select to authenticated
 using(owner_id=public.peris_player_id() or recipient_id=public.peris_player_id());

-- Only guildmates and their living city locations; no inventory or private queues.
create or replace function public.peris_guild_reinforcement_targets() returns jsonb
language sql stable security definer set search_path='' as $$
 select coalesce(jsonb_agg(jsonb_build_object('id',s.id,'name',s.name,'owner_id',p.id,'owner_name',p.display_name,'x',s.x,'y',s.y)
 order by lower(p.display_name),lower(s.name),s.id),'[]'::jsonb)
 from public.peris_guild_members own
 join public.peris_guild_members other on other.guild_id=own.guild_id and other.player_id<>own.player_id
 join public.players p on p.id=other.player_id and p.defeated_at is null
 join public.settlements s on s.owner_id=p.id and s.ruined_at is null
 where own.player_id=public.peris_player_id()
$$;
revoke all on function public.peris_guild_reinforcement_targets() from public,anon;
grant execute on function public.peris_guild_reinforcement_targets() to authenticated;

create or replace function public.peris_guild_reinforcement_return(p_id bigint,p_at timestamptz) returns boolean
language plpgsql security definer set search_path='' as $$
declare r public.peris_guild_reinforcements%rowtype;target jsonb;pace numeric;
begin
 select * into r from public.peris_guild_reinforcements where id=p_id for update;
 if r.id is null then return false;end if;
 select coalesce(min(speed),40)into pace from public.peris_unit_catalog where coalesce((r.troops->>unit)::integer,0)>0;
 pace:=greatest(1,22*pace/40);
 -- The actual return path is authoritative; no instant transfer.
 target:=public.peris_ruin_route(r.owner_id,r.target_x,r.target_y);
 -- The nearest reachable living home city receives the surviving troops.
 if target is null then delete from public.peris_guild_reinforcements where id=r.id;return false;end if;
 update public.peris_guild_reinforcements set target_settlement_id=(target->>'city_id')::bigint,
  march_path=target->'path',target_x=(target->>'x')::integer,target_y=(target->>'y')::integer,
  status='returning',departure_at=p_at,arrival_at=p_at+make_interval(secs=>greatest(2,(target->>'distance')::numeric/pace)::double precision)
 where id=r.id;
 return true;
end $$;
create or replace function public.peris_guild_reinforcement_return(p_id bigint)returns boolean
language sql security definer set search_path='' as $$select public.peris_guild_reinforcement_return(p_id,public.peris_game_now())$$;
revoke all on function public.peris_guild_reinforcement_return(bigint),public.peris_guild_reinforcement_return(bigint,timestamptz) from public,anon,authenticated;

create or replace function public.peris_recall_guild_reinforcements(p_id bigint) returns jsonb
language plpgsql security definer set search_path='' as $$
declare u uuid:=public.peris_player_id();r public.peris_guild_reinforcements%rowtype;
begin
 select * into r from public.peris_guild_reinforcements where id=p_id and owner_id=u;
 if r.id is null then raise exception 'Only stationed reinforcements you sent can be recalled';end if;
 if not public.peris_lock_battle_participants(u,r.recipient_id)then raise exception 'Another order is settling. Try recalling again.'using errcode='55P03';end if;
 select * into r from public.peris_guild_reinforcements where id=p_id and owner_id=u for update;
 if r.id is null or r.status<>'stationed' then raise exception 'Only stationed reinforcements you sent can be recalled';end if;
 if exists(select 1 from public.battles where raid_city_id=r.target_settlement_id and status='active')then raise exception 'Wait for the city battle to end before recalling reinforcements';end if;
 perform public.peris_settle(u,public.peris_game_now());
 perform public.peris_guild_reinforcement_return(r.id);
 return jsonb_build_object('ok',true);
end $$;
revoke all on function public.peris_recall_guild_reinforcements(bigint) from public,anon;
grant execute on function public.peris_recall_guild_reinforcements(bigint) to authenticated;

drop function if exists public.peris_send_guild_reinforcements(bigint,bigint,jsonb,jsonb);
create or replace function public.peris_send_guild_reinforcements(p_source bigint,p_target bigint,p_troops jsonb,p_path jsonb,p_army bigint default null) returns jsonb
language plpgsql security definer set search_path='' as $$
declare u uuid:=public.peris_player_id();s public.settlements%rowtype;d public.settlements%rowtype;
 selected jsonb;stock jsonb;remaining jsonb;origin jsonb;arrival jsonb;distance numeric;pace numeric;role text;new_id bigint;army public.armies%rowtype;
begin
 if u is null then raise exception 'Authentication required';end if;
 -- Stable participant locks serialize opposite dispatches and guild/army changes.
 select * into d from public.settlements where id=p_target;
 if not public.peris_lock_battle_participants(u,d.owner_id)then raise exception 'Another order is settling. Try sending again.'using errcode='55P03';end if;
 perform 1 from public.peris_guild_members where player_id in(u,d.owner_id)order by player_id for share;
 perform public.peris_settle(u,public.peris_game_now());
 select * into s from public.settlements where id=p_source and owner_id=u and ruined_at is null for update;
 select * into d from public.settlements where id=p_target and owner_id<>u and ruined_at is null for update;
 if s.id is null or d.id is null or not exists(select 1 from public.peris_guild_members a join public.peris_guild_members b on b.guild_id=a.guild_id
  where a.player_id=u and b.player_id=d.owner_id) then raise exception 'Choose your city and a living guild member city';end if;
 if exists(select 1 from public.players where id in(u,d.owner_id) and defeated_at is not null)then raise exception 'The ruler is defeated';end if;
 if exists(select 1 from public.battles where status='active'and (attacker_owner_id=u or defender_owner_id=u))then raise exception 'Finish the current battle first';end if;
 selected:=public.peris_garrison_troops(p_troops);
 if public.peris_roster_total(selected)=0 then raise exception 'Send at least one soldier';end if;
 if p_army is null then
  select unit_roster into stock from public.peris_city_garrisons where owner_id=u and settlement_id=s.id for update;
  if stock is null then raise exception 'No permanent garrison troops available';end if;
  stock:=public.peris_roster(stock);
  origin:=public.peris_home_army_position(s.x,s.y);
 else
  select * into army from public.armies where id=p_army and owner_id=u for update;
  if army.id is null or army.status<>'idle' or army.raid_target_id is not null or army.raid_city_id is not null or army.raid_reserve is not null then raise exception 'Choose an idle army in your sending city';end if;
  if exists(select 1 from public.peris_orders where owner_id=u and kind='recruit'and coalesce(recruit_destination,'legion')<>'garrison'and coalesce(army_id,(select min(id)from public.armies where owner_id=u))=army.id)then raise exception 'Finish this army''s recruitment first';end if;
  origin:=public.peris_army_position(army);
  if public.peris_wrap_cell(floor((origin->>'x')::numeric/128)::integer)<>public.peris_wrap_cell(floor(s.x/128.0)::integer)or public.peris_wrap_cell(floor((origin->>'y')::numeric/128)::integer)<>public.peris_wrap_cell(floor(s.y/128.0)::integer)then raise exception 'Bring the army into your sending city first';end if;
  stock:=public.peris_roster(to_jsonb(army));
 end if;
 foreach role in array array['infantry','spearmen','archers','elite','cavalry','scout','heavyCavalry','ram','catapult']loop
  if (selected->>role)::integer>(stock->>role)::integer then raise exception 'Insufficient troops in the selected source';end if;
 end loop;
 arrival:=public.peris_home_army_position(d.x,d.y);
 distance:=public.peris_route_distance((origin->>'x')::numeric,(origin->>'y')::numeric,(arrival->>'x')::numeric,(arrival->>'y')::numeric,p_path);
 select coalesce(min(speed),40)into pace from public.peris_unit_catalog where coalesce((selected->>unit)::integer,0)>0;
 pace:=greatest(1,22*pace/40);
 remaining:=public.peris_roster_add(stock,selected,-1);
 if p_army is not null then
  perform public.peris_write_roster(p_army,remaining);
  update public.armies set updated_at=now()where id=p_army;
 elsif public.peris_roster_total(remaining)=0 then delete from public.peris_city_garrisons where settlement_id=s.id and owner_id=u;
 else update public.peris_city_garrisons set unit_roster=remaining where settlement_id=s.id and owner_id=u;end if;
 insert into public.peris_guild_reinforcements(owner_id,recipient_id,source_settlement_id,target_settlement_id,troops,march_path,target_x,target_y,departure_at,arrival_at,faction,recipient_settlement_id)
 values(u,d.owner_id,s.id,d.id,selected,p_path,(arrival->>'x')::integer,(arrival->>'y')::integer,public.peris_game_now(),public.peris_game_now()+make_interval(secs=>greatest(2,distance/pace)::double precision),
  case when p_army is null then s.faction else coalesce((select faction from public.settlements where id=army.home_settlement_id),s.faction)end,d.id)returning id into new_id;
 return jsonb_build_object('ok',true,'reinforcement_id',new_id);
end $$;
revoke all on function public.peris_send_guild_reinforcements(bigint,bigint,jsonb,jsonb,bigint) from public,anon,authenticated;


create or replace function public.peris_guild_reinforcements_advance(p_owner uuid,p_until timestamptz)returns void
language plpgsql security definer set search_path='' as $$
declare r public.peris_guild_reinforcements%rowtype;city public.settlements%rowtype;is_guild boolean;
begin
 for r in select * from public.peris_guild_reinforcements where owner_id=p_owner and (status='stationed' or arrival_at<=p_until)
 order by id for update loop
  -- Serialize arrival and automatic return with the receiver's battle capture.
  if r.status in('outbound','stationed')and not public.peris_lock_battle_participants(r.owner_id,r.recipient_id)then continue;end if;
  select * into city from public.settlements where id=r.target_settlement_id and owner_id=r.recipient_id and ruined_at is null;
  select exists(select 1 from public.peris_guild_members a join public.peris_guild_members b on b.guild_id=a.guild_id where a.player_id=r.owner_id and b.player_id=r.recipient_id)into is_guild;
  if r.status='stationed' then
   if exists(select 1 from public.battles where raid_city_id=r.target_settlement_id and status='active')then continue;end if;
   if not is_guild or city.id is null then perform public.peris_guild_reinforcement_return(r.id,p_until);end if;
  elsif r.status='outbound' then
   if is_guild and city.id is not null then
    update public.peris_guild_reinforcements set status='stationed',arrival_at=null where id=r.id;
   else perform public.peris_guild_reinforcement_return(r.id,p_until);end if;
  elsif r.status='returning' then
   select * into city from public.settlements where id=r.target_settlement_id and owner_id=r.owner_id and ruined_at is null;
   if city.id is null then perform public.peris_guild_reinforcement_return(r.id,p_until);
   else perform public.peris_city_garrison_receive(r.owner_id,city.id,r.troops);
    delete from public.peris_guild_reinforcements where id=r.id;end if;
  end if;
 end loop;
end $$;
revoke all on function public.peris_guild_reinforcements_advance(uuid,timestamptz) from public,anon,authenticated;

-- Only the participating rulers can inspect their own reinforcements.
create or replace function public.peris_guild_reinforcement_status() returns jsonb
language sql stable security definer set search_path='' as $$
 select coalesce(jsonb_agg(jsonb_build_object(
  'id',r.id,'status',r.status,'owner_id',r.owner_id,'recipient_id',r.recipient_id,
  'source_city',s.name,'target_city',t.name,'troops',r.troops,
  'source_settlement_id',s.id,'target_settlement_id',t.id,'target_x',r.target_x,'target_y',r.target_y,
  'recipient_city_id',r.recipient_settlement_id,'recipient_city',supported.name,
  'owner_name',sender.display_name,'recipient_name',receiver.display_name,'faction',coalesce(r.faction,s.faction),
  'departure_at',r.departure_at,'arrival_at',r.arrival_at)
  order by r.departure_at desc),'[]'::jsonb)
 from public.peris_guild_reinforcements r
 join public.settlements s on s.id=r.source_settlement_id
 join public.settlements t on t.id=r.target_settlement_id
 left join public.settlements supported on supported.id=r.recipient_settlement_id
 join public.players sender on sender.id=r.owner_id
 join public.players receiver on receiver.id=r.recipient_id
 where (r.owner_id=public.peris_player_id() or r.recipient_id=public.peris_player_id())
$$;
revoke all on function public.peris_guild_reinforcement_status() from public,anon;
grant execute on function public.peris_guild_reinforcement_status() to authenticated;

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
 if to_regprocedure('public.peris_food_finish(bigint)')is not null then perform public.peris_food_finish(p_bid);select * into b from public.battles where id=p_bid;end if;
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
  if to_regprocedure('public.peris_food_defender_losses(bigint,jsonb)')is not null then losses:=public.peris_food_defender_losses(b.id,party);end if;
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
 current_roster:=survivors;
 if to_regprocedure('public.peris_food_roster_after(bigint,text,jsonb)')is not null then current_roster:=public.peris_food_roster_after(b.id,'attacker',public.peris_roster(to_jsonb(a)));end if;
 perform public.peris_write_roster(a.id,public.peris_roster_add(current_roster,coalesce(a.raid_reserve,'{}')));
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
create or replace function public.peris_settle(p_owner uuid,p_until timestamptz default public.peris_game_now())returns void
language plpgsql security definer set search_path='' as $$
begin
 if to_regprocedure('public.peris_market_settle(uuid,timestamp with time zone)')is not null then
  perform public.peris_market_settle(p_owner,p_until);
 else perform public.peris_settle_core(p_owner,p_until);end if;
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
  union all select owner_id,due from public.peris_due_trade_routes()
  union all select owner_id,due from public.peris_due_trade_caravans()
  union all select owner_id,due from public.peris_due_guild_reinforcements()
  union all select owner_id,min(resources_updated_at+interval '1 minute')from public.settlements s where ruined_at is null and to_jsonb(s)->>'troop_upkeep_ready'='true'and(coalesce((to_jsonb(s)->>'food_troop_upkeep')::numeric,0)>0 or food_rate<0)and resources_updated_at<=public.peris_game_now()-interval '1 minute'group by owner_id
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
 if to_regprocedure('public.peris_supply_refresh(bigint,timestamp with time zone)')is not null then
  execute 'select public.peris_supply_refresh(id,public.peris_game_now())from public.settlements where owner_id=$1 and ruined_at is null'using u;
 end if;
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
 if to_regprocedure('public.peris_supply_refresh(bigint,timestamp with time zone)')is not null then result:=result||jsonb_build_object('troop_upkeep_version',1);end if;
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
notify pgrst,'reload schema';

do $restore_crop$begin if to_regclass('public.peris_crop_version')is not null then execute $crop_definition$-- Hourly combat troop crop consumption. Private helpers; never a public economy feed.
alter table public.settlements add column if not exists food_troop_upkeep numeric not null default 0;
alter table public.settlements add column if not exists starvation_losses bigint not null default 0;
alter table public.settlements add column if not exists starvation_last_at timestamptz;
alter table public.settlements add column if not exists troop_upkeep_ready boolean not null default false;
alter table public.battle_formations add column if not exists starvation_losses integer not null default 0;
alter table public.battles add column if not exists starvation_sources jsonb not null default '{}';
alter table public.battles add column if not exists food_settled boolean not null default false;
create table if not exists public.peris_crop_version(id boolean primary key default true check(id),activated_at timestamptz);
alter table public.peris_crop_version enable row level security;
revoke all on public.peris_crop_version from public,anon,authenticated;
insert into public.peris_crop_version(id)values(true)on conflict do nothing;

-- Preserve the pre-feature integrator and completion logic for non-retroactive migration.
do $$begin
 if to_regprocedure('public.peris_population_accrue_legacy(bigint,timestamptz)')is null then
  execute replace(pg_get_functiondef('public.peris_population_accrue(bigint,timestamptz)'::regprocedure),'public.peris_population_accrue(','public.peris_population_accrue_legacy(');
 end if;
 if to_regprocedure('public.peris_market_settle_legacy(uuid,timestamptz)')is null then
  execute replace(pg_get_functiondef('public.peris_market_settle(uuid,timestamptz)'::regprocedure),'public.peris_market_settle(','public.peris_market_settle_legacy(');
 end if;
end $$;

create or replace function public.peris_troop_upkeep(p_roster jsonb)returns numeric
language sql immutable set search_path='' as $$
 select coalesce(sum(greatest(0,coalesce((p_roster->>unit)::numeric,0))*case when unit='catapult'then 4 when unit='ram'then 3 when unit in('cavalry','scout','heavyCavalry')then 2 else 1 end),0)/60
 from unnest(array['infantry','spearmen','archers','elite','cavalry','scout','heavyCavalry','ram','catapult'])unit
$$;

create or replace function public.peris_supply_city(p_owner uuid,p_col integer,p_row integer)returns bigint
language sql stable security definer set search_path='' as $$
 select id from public.settlements where owner_id=p_owner and ruined_at is null and public.peris_wrap_cell(floor(x/128.0)::integer)=public.peris_wrap_cell(p_col)and public.peris_wrap_cell(floor(y/128.0)::integer)=public.peris_wrap_cell(p_row)
 union all select s.id from public.peris_map_plots p join public.settlements s on s.id=p.settlement_id and s.ruined_at is null where p.owner_id=p_owner and p.col=public.peris_wrap_cell(p_col)and p.row=public.peris_wrap_cell(p_row)limit 1
$$;

create or replace function public.peris_supply_rows(p_sid bigint,p_at timestamptz)returns table(kind text,key text,owner_id uuid,tier integer,troops jsonb)
language plpgsql stable security definer set search_path='' as $$
#variable_conflict use_column
declare a public.armies%rowtype;r record;source bigint;home bigint;station bigint;origin jsonb;travelling boolean;
begin
 for a in select * from public.armies loop
  home:=coalesce((select id from public.settlements where id=a.home_settlement_id and owner_id=a.owner_id and ruined_at is null),(select min(id)from public.settlements where owner_id=a.owner_id and ruined_at is null));
  origin:=a.march_origin;
  source:=coalesce(case when origin is not null then public.peris_supply_city(a.owner_id,floor((origin->>'x')::numeric/128)::integer,floor((origin->>'y')::numeric/128)::integer)end,home);
  travelling:=a.status='moving'and a.departure_at<=p_at or a.raid_target_id is not null or a.raid_city_id is not null or exists(select 1 from public.battles b where b.attacker_army_id=a.id and b.mode<>'practice'and b.status='active'and not b.food_settled);
  if a.status='moving'and a.departure_at>p_at then station:=coalesce(public.peris_supply_city(a.owner_id,floor(a.start_x/128.0)::integer,floor(a.start_y/128.0)::integer),source);travelling:=false;
  elsif travelling then station:=source;
  else station:=coalesce(public.peris_supply_city(a.owner_id,floor(a.target_x/128.0)::integer,floor(a.target_y/128.0)::integer),home);end if;
  if station=p_sid then kind:='army';key:='army:'||a.id;owner_id:=a.owner_id;tier:=case when travelling then 4 when station<>home then 2 else 3 end;troops:=public.peris_roster(to_jsonb(a));return next;end if;
  if a.raid_reserve is not null and home=p_sid then kind:='reserve';key:='reserve:'||a.id;owner_id:=a.owner_id;tier:=3;troops:=public.peris_roster(a.raid_reserve);return next;end if;
 end loop;
 for r in select * from public.peris_city_garrisons where settlement_id=p_sid loop kind:='city';key:='city:'||p_sid;owner_id:=r.owner_id;tier:=3;troops:=public.peris_roster(r.unit_roster);return next;end loop;
 for r in select g.* from public.peris_garrisons g where public.peris_supply_city(g.owner_id,g.col,g.row)=p_sid loop kind:='station';key:='station:'||r.owner_id||':'||r.col||':'||r.row;owner_id:=r.owner_id;tier:=3;troops:=public.peris_roster(to_jsonb(r));return next;end loop;
 for r in select * from public.peris_city_reinforcements loop
  source:=coalesce((select id from public.settlements where id=r.source_settlement_id and owner_id=r.owner_id and ruined_at is null),(select id from public.settlements where id=r.target_settlement_id and owner_id=r.owner_id and ruined_at is null),(select min(id)from public.settlements where owner_id=r.owner_id and ruined_at is null));
  if source=p_sid then kind:='reinforcement';key:='reinforcement:'||r.id;owner_id:=r.owner_id;tier:=4;troops:=public.peris_roster(r.troops);return next;end if;
 end loop;
 for r in select * from public.peris_guild_reinforcements loop
  source:=coalesce(case when r.status='stationed'then(select id from public.settlements where id=r.target_settlement_id and ruined_at is null)else coalesce((select id from public.settlements where id=r.source_settlement_id and owner_id=r.owner_id and ruined_at is null),(select id from public.settlements where id=r.target_settlement_id and owner_id=r.owner_id and ruined_at is null))end,(select min(id)from public.settlements where owner_id=r.owner_id and ruined_at is null));
  if source=p_sid then kind:='guild';key:='guild:'||r.id;owner_id:=r.owner_id;tier:=case when r.status='stationed'then 1 else 4 end;troops:=public.peris_roster(r.troops);return next;end if;
 end loop;
 for r in select * from public.peris_ruin_evacuations loop
  source:=coalesce((select id from public.settlements where id=r.target_settlement_id and owner_id=r.owner_id and ruined_at is null),(select min(id)from public.settlements where owner_id=r.owner_id and ruined_at is null));
  if source=p_sid then kind:='evacuation';key:='evacuation:'||r.id;owner_id:=r.owner_id;tier:=4;troops:=public.peris_roster(r.troops);return next;end if;
 end loop;
end $$;

create or replace function public.peris_supply_refresh(p_sid bigint,p_at timestamptz)returns void
language plpgsql security definer set search_path='' as $$
declare amount numeric;
begin
 select coalesce(sum(public.peris_troop_upkeep(troops)),0)into amount from public.peris_supply_rows(p_sid,p_at);
 update public.settlements set food_troop_upkeep=amount,food_rate=food_gross_rate-food_upkeep-amount where id=p_sid and troop_upkeep_ready and ruined_at is null;
end $$;

create or replace function public.peris_supply_battle_loss(p_key text,p_unit text)returns void
language plpgsql security definer set search_path='' as $$
declare b public.battles%rowtype;party jsonb;captured integer;already integer;formation bigint;own_side text;source_key text;
begin
 for b in select * from public.battles where status='active'and mode<>'practice'and not food_settled order by id for update loop
  own_side:=null;captured:=0;
  if p_key='army:'||b.attacker_army_id then own_side:='attacker';
  elsif b.raid_city_id is null and p_key='army:'||b.defender_army_id then own_side:='defender';
  elsif b.raid_city_id is not null then
   for party in select value from jsonb_array_elements(b.city_defenders)loop
    source_key:=case when party?'army_id'then 'army:'||(party->>'army_id')when party?'city_garrison_id'then 'city:'||(party->>'city_garrison_id')when party?'guild_reinforcement_id'then 'guild:'||(party->>'guild_reinforcement_id')else 'station:'||b.defender_owner_id||':'||(party->>'col')||':'||(party->>'row')end;
    if source_key=p_key then own_side:='defender';captured:=coalesce((party->'troops'->>p_unit)::integer,0);exit;end if;
   end loop;
  end if;
  if own_side is null then continue;end if;
  if b.raid_city_id is null or own_side='attacker'then select coalesce(sum(initial_soldiers),0)into captured from public.battle_formations where battle_id=b.id and side=own_side and coalesce(recruit_unit,unit_type)=p_unit;end if;
  already:=coalesce((b.starvation_sources#>>array[p_key,p_unit])::integer,0);
  if already>=captured then continue;end if;
  select id into formation from public.battle_formations where battle_id=b.id and side=own_side and coalesce(recruit_unit,unit_type)=p_unit and starvation_losses<initial_soldiers order by initial_soldiers-starvation_losses desc,id limit 1 for update;
  if formation is null then continue;end if;
  update public.battles set starvation_sources=jsonb_set(starvation_sources,array[p_key],coalesce(starvation_sources->p_key,'{}')||jsonb_build_object(p_unit,already+1))where id=b.id;
  update public.battle_formations set starvation_losses=starvation_losses+1,soldiers=least(soldiers,initial_soldiers-starvation_losses-1),status=case when least(soldiers,initial_soldiers-starvation_losses-1)=0 then 'routed'else status end where id=formation;
 end loop;
end $$;

-- Every healing path, including future spells, obeys permanent starvation caps.
create or replace function public.peris_starvation_cap()returns trigger language plpgsql set search_path='' as $$
begin new.starvation_losses:=greatest(0,least(new.initial_soldiers,new.starvation_losses));new.soldiers:=least(new.soldiers,new.initial_soldiers-new.starvation_losses);return new;end $$;
drop trigger if exists peris_starvation_cap on public.battle_formations;
create trigger peris_starvation_cap before insert or update on public.battle_formations for each row execute function public.peris_starvation_cap();

create or replace function public.peris_supply_party_key(p_party jsonb,p_owner uuid)returns text language sql immutable set search_path='' as $$
 select case when p_party?'army_id'then 'army:'||(p_party->>'army_id')when p_party?'city_garrison_id'then 'city:'||(p_party->>'city_garrison_id')when p_party?'guild_reinforcement_id'then 'guild:'||(p_party->>'guild_reinforcement_id')else 'station:'||p_owner||':'||(p_party->>'col')||':'||(p_party->>'row')end
$$;

create or replace function public.peris_food_roster_after(p_bid bigint,p_side text,p_current jsonb)returns jsonb
language plpgsql stable security definer set search_path='' as $$
declare b public.battles%rowtype;initial jsonb;remaining jsonb;starved jsonb;source_key text;unit text;loss integer;result jsonb:=public.peris_roster(p_current);
begin
 select * into b from public.battles where id=p_bid;
 source_key:='army:'||case when p_side='attacker'then b.attacker_army_id else b.defender_army_id end;
 starved:=coalesce(b.starvation_sources->source_key,'{}');
 for unit in select c.unit from public.peris_unit_catalog c loop
  select greatest(0,coalesce(sum(initial_soldiers-soldiers),0)-coalesce((starved->>unit)::integer,0))into loss from public.battle_formations where battle_id=p_bid and side=p_side and coalesce(recruit_unit,unit_type)=unit;
  result:=jsonb_set(result,array[unit],to_jsonb(greatest(0,coalesce((result->>unit)::integer,0)-loss)));
 end loop;return result;
end $$;

create or replace function public.peris_food_finish(p_bid bigint)returns void
language plpgsql security definer set search_path='' as $$
declare b public.battles%rowtype;owner uuid;city record;party jsonb;row_item record;source_key text;side_name text;initial integer;survivors integer;starved integer;loss integer;credit numeric;source_city bigint;role text;
begin
 select * into b from public.battles where id=p_bid for update;if b.id is null or b.status<>'active'or b.mode='practice'or b.food_settled then return;end if;
 if not public.peris_lock_battle_participants(b.attacker_owner_id,b.defender_owner_id)then raise lock_not_available;end if;
 -- Supply is still the committed backing roster up to irreversible finalization.
 perform public.peris_settle(b.attacker_owner_id);if b.defender_owner_id is not null then perform public.peris_settle(b.defender_owner_id);end if;
 select * into b from public.battles where id=p_bid;
 for side_name in select unnest(array['attacker','defender'])loop
  owner:=case when side_name='attacker'then b.attacker_owner_id else b.defender_owner_id end;if owner is null then continue;end if;
  source_key:='army:'||case when side_name='attacker'then b.attacker_army_id else b.defender_army_id end;
  if side_name='defender'and b.raid_city_id is not null then source_city:=b.raid_city_id;
  else select s.id into source_city from public.settlements s cross join lateral public.peris_supply_rows(s.id,public.peris_game_now())r where s.ruined_at is null and r.key=source_key limit 1;end if;
  if source_city is null then continue;end if;credit:=0;
  for role in select c.unit from public.peris_unit_catalog c loop
   select coalesce(sum(initial_soldiers),0),coalesce(sum(soldiers),0),coalesce(sum(starvation_losses),0)into initial,survivors,starved from public.battle_formations where battle_id=b.id and side=side_name and coalesce(recruit_unit,unit_type)=role;
   loss:=greatest(0,initial-starved-survivors);
   credit:=credit+loss*coalesce((select (rule#>>'{cost,food}')::numeric from public.peris_unit_balance where version=2 and unit=role),0);
  end loop;
  update public.settlements set food=least(food_capacity,food+credit)where id=source_city and ruined_at is null;
 end loop;
 update public.battles set food_settled=true where id=b.id;
end $$;

-- Allocate permanent combat deaths against captured survivors, excluding already-debited famine.
create or replace function public.peris_food_defender_losses(p_bid bigint,p_party jsonb)returns jsonb
language plpgsql stable security definer set search_path='' as $$
declare b public.battles%rowtype;party jsonb;unit_name text;source_key text;total integer;prefix integer;amount integer;survivors integer;lost integer;result jsonb:=public.peris_roster('{}');seen boolean;
begin
 select * into b from public.battles where id=p_bid;
 foreach unit_name in array array['infantry','spearmen','archers','elite','cavalry','scout','heavyCavalry','ram','catapult']loop
  total:=0;prefix:=0;amount:=0;seen:=false;
  for party in select value from jsonb_array_elements(b.city_defenders)loop
   source_key:=public.peris_supply_party_key(party,b.defender_owner_id);
   lost:=greatest(0,coalesce((party->'troops'->>unit_name)::integer,0)-coalesce((b.starvation_sources#>>array[source_key,unit_name])::integer,0));
   total:=total+lost;
   if party=p_party then amount:=lost;seen:=true;elsif not seen then prefix:=prefix+lost;end if;
  end loop;
  select coalesce(sum(soldiers),0)into survivors from public.battle_formations where battle_id=p_bid and side='defender'and coalesce(recruit_unit,unit_type)=unit_name;
  lost:=greatest(0,total-survivors);
  result:=jsonb_set(result,array[unit_name],to_jsonb(case when total=0 then 0 else floor(lost::numeric*(prefix+amount)/total)::integer-floor(lost::numeric*prefix/total)::integer end));
 end loop;return result;
end $$;
revoke all on function public.peris_food_defender_losses(bigint,jsonb)from public,anon,authenticated;

create or replace function public.peris_starve_one(p_sid bigint,p_at timestamptz)returns numeric
language plpgsql security definer set search_path='' as $$
declare r record;casualty_unit text;roster jsonb;refund numeric;ident bigint;parts text[];
begin
 select * into r from public.peris_supply_rows(p_sid,p_at)where public.peris_roster_total(troops)>0 order by tier,public.peris_roster_total(troops)desc,kind,key limit 1;
 if r.key is null then return 0;end if;
 select role into casualty_unit from unnest(array['infantry','spearmen','archers','elite','cavalry','scout','heavyCavalry','ram','catapult'])with ordinality u(role,seq)order by coalesce((r.troops->>role)::integer,0)desc,seq limit 1;
 roster:=jsonb_set(r.troops,array[casualty_unit],to_jsonb((r.troops->>casualty_unit)::integer-1));parts:=string_to_array(r.key,':');
 if r.kind='army'then perform public.peris_write_roster(parts[2]::bigint,roster);
 elsif r.kind='reserve'then update public.armies set raid_reserve=roster where id=parts[2]::bigint;
 elsif r.kind='city'then update public.peris_city_garrisons set unit_roster=roster where settlement_id=p_sid;
 elsif r.kind='station'then update public.peris_garrisons set unit_roster=roster,infantry=public.peris_roster_class(roster,'infantry'),archers=public.peris_roster_class(roster,'archers'),cavalry=public.peris_roster_class(roster,'cavalry')where owner_id=r.owner_id and col=parts[3]::integer and row=parts[4]::integer;
 elsif r.kind='reinforcement'then update public.peris_city_reinforcements set troops=roster where id=parts[2]::bigint;
 elsif r.kind='guild'then update public.peris_guild_reinforcements set troops=roster where id=parts[2]::bigint;
 elsif r.kind='evacuation'then update public.peris_ruin_evacuations set troops=roster where id=parts[2]::bigint;end if;
 perform public.peris_supply_battle_loss(r.key,casualty_unit);
 select (rule#>>'{cost,food}')::numeric into refund from public.peris_unit_balance where version=2 and peris_unit_balance.unit=casualty_unit;
 update public.settlements set starvation_losses=starvation_losses+1,starvation_last_at=p_at where id=p_sid;
 return coalesce(refund,0);
end $$;

create or replace function public.peris_population_accrue(p_sid bigint,p_until timestamptz)returns void
language plpgsql security definer set search_path='' as $$
declare s public.settlements%rowtype;remaining double precision;p double precision;cap double precision;jobs double precision;staff double precision;growth double precision;factor double precision;food_slope double precision;net double precision;gross double precision;dt double precision;zero_at double precision;food_full boolean;troop numeric;refund numeric;at_time timestamptz;merchant public.peris_trade_caravans%rowtype;cargo jsonb;
begin
 select * into s from public.settlements where id=p_sid for update;if s.id is null or s.ruined_at is not null then return;end if;
 if not s.troop_upkeep_ready then perform public.peris_population_accrue_legacy(p_sid,p_until);return;end if;
 remaining:=greatest(0,extract(epoch from(p_until-s.resources_updated_at)))/60;at_time:=s.resources_updated_at;
 p:=greatest(10,least(s.population_capacity,s.population));cap:=s.population_capacity;jobs:=s.workers_required;
 select coalesce(sum(public.peris_troop_upkeep(troops)),0)into troop from public.peris_supply_rows(s.id,at_time);
 while remaining>1e-9 loop
  staff:=least(1,p/greatest(1,jobs));gross:=(18+s.field_food_rate+s.food_bonus*staff)*s.food_research;net:=gross-.12*p-troop;
  if s.food<=1e-8 and net< -1e-9 then
   select * into merchant from public.peris_trade_caravans where status='waiting'and owner_id=s.owner_id and coalesce(return_settlement_id,source_settlement_id)=s.id and coalesce((returning_resources->>'food')::numeric,0)>0 order by id limit 1 for update;
   if merchant.id is not null then
    refund:=least(s.food_capacity,(merchant.returning_resources->>'food')::numeric);cargo:=jsonb_set(merchant.returning_resources,'{food}',to_jsonb((merchant.returning_resources->>'food')::numeric-refund));
    update public.peris_trade_caravans set returning_resources=cargo,status=case when public.peris_trade_volume(cargo)=0 then 'completed'else 'waiting'end,completed_at=case when public.peris_trade_volume(cargo)=0 then at_time else null end where id=merchant.id;
    s.food:=least(s.food_capacity,s.food+refund);continue;
   end if;
   refund:=public.peris_starve_one(s.id,at_time);
   if refund>0 then s.food:=least(s.food_capacity,s.food+refund);select coalesce(sum(public.peris_troop_upkeep(troops)),0)into troop from public.peris_supply_rows(s.id,at_time);continue;end if;
  end if;
  growth:=case when (s.food>1e-9 or net>1e-9)and p<cap-1e-9 then 1 else 0 end;
  factor:=case when jobs>0 and p<jobs-1e-9 then growth/jobs else 0 end;food_slope:=s.food_bonus*factor*s.food_research-.12*growth;
  dt:=remaining;if growth>0 then dt:=least(dt,cap-p);end if;
  if growth>0 and p<jobs-1e-9 then dt:=least(dt,jobs-p);end if;
  food_full:=s.food>=s.food_capacity-1e-9 and (net>1e-9 or abs(net)<=1e-9 and food_slope>=0);
  if not food_full then dt:=public.peris_population_event(s.food::double precision,net,food_slope,0,dt);dt:=public.peris_population_event(s.food::double precision,net,food_slope,s.food_capacity,dt);end if;
  if abs(food_slope)>1e-9 then zero_at:=-net/food_slope;if zero_at>1e-9 then dt:=least(dt,zero_at);end if;end if;
  if dt<=1e-9 then raise exception 'Crop integrator made no progress';end if;
  s.wood:=least(s.capacity,greatest(0,s.wood+((14+s.field_wood_rate+s.wood_bonus*staff)*dt+s.wood_bonus*factor*dt*dt/2)*s.wood_research));
  s.stone:=least(s.capacity,greatest(0,s.stone+((12+s.field_stone_rate+s.stone_bonus*staff)*dt+s.stone_bonus*factor*dt*dt/2)*s.stone_research));
  s.gold:=least(s.capacity,greatest(0,s.gold+((3+s.field_gold_rate*s.trade_research+s.gold_bonus*staff)*dt+s.gold_bonus*factor*dt*dt/2)*s.gold_research));
  s.food:=greatest(0,least(s.food_capacity,case when food_full then s.food_capacity else s.food+net*dt+food_slope*dt*dt/2 end));
  p:=greatest(10,least(cap,p+growth*dt));remaining:=remaining-dt;at_time:=at_time+make_interval(secs=>dt*60);
 end loop;
 staff:=least(1,p/greatest(1,jobs));gross:=(18+s.field_food_rate+s.food_bonus*staff)*s.food_research;
 update public.settlements set population=p,wood=s.wood,stone=s.stone,food=s.food,gold=s.gold,
  wood_rate=(14+s.field_wood_rate+s.wood_bonus*staff)*s.wood_research,stone_rate=(12+s.field_stone_rate+s.stone_bonus*staff)*s.stone_research,gold_rate=(3+s.field_gold_rate*s.trade_research+s.gold_bonus*staff)*s.gold_research,food_rate=gross-.12*p-troop,food_gross_rate=gross,food_upkeep=.12*p,food_troop_upkeep=troop,
  resources_updated_at=greatest(resources_updated_at,p_until)where id=s.id;
end $$;

create or replace function public.peris_trade_participants(p_owner uuid)returns uuid[]
language sql stable security definer set search_path='' as $$
 with recursive participants(id)as(select p_owner union select case when r.owner_id=p.id then r.recipient_id else r.owner_id end
 from participants p join(select owner_id,recipient_id from public.peris_trade_caravans where status<>'completed' union select owner_id,recipient_id from public.peris_trade_route_edges()
 union select owner_id,recipient_id from public.peris_guild_reinforcements
 union select attacker_owner_id,defender_owner_id from public.battles where status='active'and defender_owner_id is not null)r on(r.owner_id=p.id or r.recipient_id=p.id))
 select array_agg(id order by id)from participants
$$;

create or replace function public.peris_market_settle(p_owner uuid,p_until timestamptz)returns void
language plpgsql security definer set search_path='' as $$
declare participants uuid[];participant uuid;event_at timestamptz;cursor_at timestamptz;city record;r record;
begin
 if not exists(select 1 from public.peris_crop_version where activated_at is not null)then perform public.peris_market_settle_legacy(p_owner,p_until);return;end if;
 if not pg_try_advisory_xact_lock(72320)then raise lock_not_available;end if;
 participants:=public.peris_trade_participants(p_owner);
 if exists(select 1 from public.peris_settler_expeditions where owner_id=any(participants)and status='travelling'and arrival_at<=p_until)and not pg_try_advisory_xact_lock(204200)then raise lock_not_available;end if;
 perform 1 from public.players where id=any(participants)order by id for update nowait;
 if participants is distinct from public.peris_trade_participants(p_owner)then raise lock_not_available;end if;
 perform 1 from public.settlements where owner_id=any(participants)order by id for update nowait;
 select min(resources_updated_at)into cursor_at from public.settlements where owner_id=any(participants)and ruined_at is null;
 cursor_at:=least(coalesce(cursor_at,p_until),p_until);
 foreach participant in array participants loop perform public.peris_settle_core(participant,cursor_at);end loop;
 for r in select id from public.peris_trade_caravans where owner_id=any(participants)and(status='outbound'and arrival_at<=cursor_at or status='returning'and least(return_at,case when public.peris_trade_volume(returning_resources)>0 then redirect_at end)<=cursor_at)order by id loop perform public.peris_trade_event(r.id,cursor_at);end loop;
 for city in select id from public.settlements where owner_id=any(participants)and ruined_at is null order by id loop perform public.peris_supply_refresh(city.id,cursor_at);end loop;
 loop
  select min(at_time)into event_at from(
   select finish_at at_time from public.peris_orders where owner_id=any(participants)
   union all select public.peris_science_deadline(owner_id)from public.peris_account_science where owner_id=any(participants)and active_id is not null
   union all select arrival_at from public.armies where owner_id=any(participants)and status='moving'
   union all select departure_at from public.armies where owner_id=any(participants)and status='moving'
   union all select arrival_at from public.peris_city_reinforcements where owner_id=any(participants)
   union all select arrival_at from public.peris_guild_reinforcements where (owner_id=any(participants)or recipient_id=any(participants))and status<>'stationed'
   union all select arrival_at from public.peris_ruin_evacuations where owner_id=any(participants)
   union all select arrival_at from public.peris_settler_expeditions where owner_id=any(participants)and status='travelling'
   union all select case when status='outbound'then arrival_at else least(return_at,case when public.peris_trade_volume(returning_resources)>0 then redirect_at end)end from public.peris_trade_caravans where owner_id=any(participants)and status in('outbound','returning')
   union all select p_until
  )events where at_time>cursor_at and at_time<=p_until;
  exit when event_at is null;
  for city in select id from public.settlements where owner_id=any(participants)and ruined_at is null order by id loop perform public.peris_population_accrue(city.id,event_at);end loop;
  foreach participant in array participants loop perform public.peris_settle_core(participant,event_at);end loop;
  for r in select id from public.peris_trade_caravans where owner_id=any(participants)and(status='outbound'and arrival_at<=event_at or status='returning'and least(return_at,case when public.peris_trade_volume(returning_resources)>0 then redirect_at end)<=event_at)order by id loop perform public.peris_trade_event(r.id,event_at);end loop;
  for city in select id from public.settlements where owner_id=any(participants)and ruined_at is null order by id loop perform public.peris_supply_refresh(city.id,event_at);end loop;
  cursor_at:=event_at;
 end loop;
 -- Complete zero-time arrivals/queues and expose current rates without charging twice.
 foreach participant in array participants loop perform public.peris_settle_core(participant,p_until);end loop;
 for r in select id from public.peris_trade_caravans where owner_id=any(participants)and status in('waiting','stranded')order by id loop perform public.peris_trade_event(r.id,p_until);end loop;
 foreach participant in array participants loop perform public.peris_optional_advance_trade_routes(participant,p_until);end loop;
 for city in select id from public.settlements where owner_id=any(participants)and ruined_at is null order by id loop perform public.peris_supply_refresh(city.id,p_until);end loop;
 delete from public.peris_trade_caravans c where c.owner_id=any(participants)and c.status='completed'and c.id not in(select keep.id from public.peris_trade_caravans keep where keep.owner_id=c.owner_id and keep.status='completed'order by keep.completed_at desc,keep.id desc limit 50);
end $$;

-- Only a first install settles free legacy progress to this activation boundary.
do $$declare owner uuid;city record;activation timestamptz:=public.peris_game_now();begin
 if not exists(select 1 from public.peris_crop_version where activated_at is not null)then
  for owner in select id from public.players order by id loop perform public.peris_market_settle_legacy(owner,activation);end loop;
  update public.settlements set troop_upkeep_ready=true;update public.peris_crop_version set activated_at=activation;
 end if;
 for city in select id from public.settlements where ruined_at is null loop perform public.peris_supply_refresh(city.id,activation);end loop;
end $$;
alter table public.settlements alter column troop_upkeep_ready set default true;

revoke all on function public.peris_starvation_cap(),public.peris_supply_party_key(jsonb,uuid),public.peris_food_roster_after(bigint,text,jsonb),public.peris_food_finish(bigint),public.peris_population_accrue_legacy(bigint,timestamptz),public.peris_market_settle_legacy(uuid,timestamptz),public.peris_troop_upkeep(jsonb),public.peris_supply_city(uuid,integer,integer),public.peris_supply_rows(bigint,timestamptz),public.peris_supply_refresh(bigint,timestamptz),public.peris_supply_battle_loss(text,text),public.peris_starve_one(bigint,timestamptz),public.peris_population_accrue(bigint,timestamptz),public.peris_market_settle(uuid,timestamptz),public.peris_trade_participants(uuid)from public,anon,authenticated;
$crop_definition$;end if;end $restore_crop$;
commit;
