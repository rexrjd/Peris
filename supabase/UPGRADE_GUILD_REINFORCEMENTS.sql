-- Apply AFTER City Logistics and V19 Guilds. No existing garrisons are reassigned.
begin;
-- Optional hooks keep earlier focused migrations usable without enabling scouting.
create or replace function public.peris_optional_scout_missions()returns table(id bigint,owner_id uuid,target_owner_id uuid,source_settlement_id bigint,target_city_id bigint,status text,scouts integer,departure_at timestamptz,arrival_at timestamptz)
language plpgsql stable security definer set search_path='' as $$
begin
 if to_regclass('public.peris_scout_missions')is not null then return query execute 'select id,owner_id,target_owner_id,source_settlement_id,target_city_id,status,scouts,departure_at,arrival_at from public.peris_scout_missions where status in(''outbound'',''returning'')';end if;
end $$;
create or replace function public.peris_scout_edges()returns table(owner_id uuid,recipient_id uuid)
language plpgsql stable security definer set search_path='' as $$
begin
 return query select m.owner_id,m.target_owner_id from public.peris_optional_scout_missions()m where m.target_owner_id is not null
 union select m.owner_id,s.owner_id from public.peris_optional_scout_missions()m join public.settlements s on s.id=m.target_city_id;
 if to_regclass('public.peris_scout_missions')is not null then
  return query execute 'select m.owner_id,a.owner_id from public.peris_scout_missions m join public.armies a on a.raid_target_id=m.target_camp_id where m.status=''outbound''
   union select m.owner_id,b.attacker_owner_id from public.peris_scout_missions m join public.battles b on b.camp_id=m.target_camp_id and b.status=''active''where m.status=''outbound''
   union select m.owner_id,n.owner_id from public.peris_scout_missions m join public.peris_scout_missions n on n.target_camp_id=m.target_camp_id and n.id>m.id where m.status=''outbound''and n.status=''outbound''';
 end if;
end $$;
create or replace function public.peris_due_scouts()returns table(owner_id uuid,due timestamptz)
language sql stable security definer set search_path='' as $$select owner_id,min(arrival_at)from public.peris_optional_scout_missions()where arrival_at<=public.peris_game_now()group by owner_id$$;
create or replace function public.peris_optional_advance_scouts(p_owners uuid[],p_at timestamptz)returns void
language plpgsql security definer set search_path='' as $$
begin if to_regprocedure('public.peris_scout_advance(uuid[],timestamp with time zone)')is not null then execute 'select public.peris_scout_advance($1,$2)'using p_owners,p_at;end if;end $$;
revoke all on function public.peris_optional_scout_missions(),public.peris_scout_edges(),public.peris_due_scouts(),public.peris_optional_advance_scouts(uuid[],timestamptz)from public,anon,authenticated;

create or replace function public.peris_scout_camp_cutoff(p_camp integer,p_until timestamptz)returns timestamptz
language plpgsql stable security definer set search_path='' as $$
declare cutoff timestamptz;
begin
 if to_regclass('public.peris_scout_missions')is not null then execute 'select min(arrival_at)from public.peris_scout_missions where target_camp_id=$1 and status=''outbound'''into cutoff using p_camp;end if;
 return least(p_until,coalesce(cutoff,p_until));
end $$;
revoke all on function public.peris_scout_camp_cutoff(integer,timestamptz)from public,anon,authenticated;

create or replace function public.peris_optional_scout_camp_mutation(p_camp integer,p_at timestamptz,p_owner uuid)returns void
language plpgsql security definer set search_path='' as $$
begin if p_camp is not null and to_regprocedure('public.peris_scout_flush_camp(integer,timestamp with time zone,uuid)')is not null then execute 'select public.peris_scout_flush_camp($1,$2,$3)'using p_camp,p_at,p_owner;end if;end $$;
revoke all on function public.peris_optional_scout_camp_mutation(integer,timestamptz,uuid)from public,anon,authenticated;

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
 if to_regprocedure('public.peris_loyalty_accrue(bigint,timestamp with time zone)')is not null then perform public.peris_loyalty_accrue(s.id,p_until);end if;
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
 foreach role in array array['infantry','spearmen','archers','elite','cavalry','scout','heavyCavalry','ram','catapult','diplomat']loop
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
declare b public.battles%rowtype;c public.settlements%rowtype;a public.armies%rowtype;party jsonb;initial jsonb;survivors jsonb;def_initial jsonb;def_remaining jsonb;current_roster jsonb;losses jsonb;cumulative jsonb:=public.peris_roster('{}');engines jsonb;loot jsonb:=jsonb_build_object('wood',0,'stone',0,'food',0,'gold',0);r jsonb;damage jsonb;reward jsonb;receipt jsonb;conquest jsonb;unit_name text;key text;lost integer;start_count integer;party_count integer;total integer;ai integer;di integer;asur integer;dsur integer;carry numeric;owner uuid;winner uuid;commander bigint;side text;g public.peris_garrisons%rowtype;
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
  foreach unit_name in array array['infantry','spearmen','archers','elite','cavalry','scout','heavyCavalry','ram','catapult','diplomat']loop
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

 select coalesce(sum(f.soldiers*u.carry),0)into carry from public.battle_formations f join public.peris_unit_catalog u on u.unit=coalesce(f.recruit_unit,f.unit_type)where f.battle_id=b.id and f.side='attacker';
 carry:=floor(carry*public.peris_research_factor(b.attacker_owner_id,'carry'));
 if p_winner='attacker'and c.owner_id=b.defender_owner_id and c.ruined_at is null then
  -- Take loot before siege: destroying the last building clears all city stores.
  -- Keep the local game's ordering and never debit a pre-siege snapshot afterward.
  loot:=public.peris_take_camp_loot(jsonb_build_object('wood',floor(c.wood),'stone',floor(c.stone),'food',floor(c.food),'gold',floor(c.gold)),carry);
  update public.settlements set wood=wood-(loot->>'wood')::numeric,stone=stone-(loot->>'stone')::numeric,food=food-(loot->>'food')::numeric,gold=gold-(loot->>'gold')::numeric where id=c.id;
  select public.peris_roster(coalesce(jsonb_object_agg(unit,n),'{}'))into engines from(select coalesce(f.recruit_unit,f.unit_type)unit,sum(f.soldiers)n from public.battle_formations f where f.battle_id=b.id and f.side='attacker'and f.status<>'routed'group by coalesce(f.recruit_unit,f.unit_type))q;
  engines:=jsonb_set(jsonb_set(engines,'{ram}',to_jsonb(floor((engines->>'ram')::integer*public.peris_research_factor(b.attacker_owner_id,'siege'))::integer)),'{catapult}',to_jsonb(floor((engines->>'catapult')::integer*public.peris_research_factor(b.attacker_owner_id,'siege'))::integer));
  damage:=public.peris_damage_city(c.id,engines,b.siege_target);
  if coalesce((initial->>'diplomat')::integer,0)>0 and to_regprocedure('public.peris_apply_city_conquest(bigint,uuid,integer,timestamp with time zone)')is not null then
   conquest:=public.peris_apply_city_conquest(c.id,b.attacker_owner_id,coalesce((survivors->>'diplomat')::integer,0),public.peris_game_now());
  end if;
  if coalesce((conquest->>'captured')::boolean,false)then
   -- Captured cities retain their resources; no loot leaves with the attacker.
   update public.settlements set wood=wood+(loot->>'wood')::numeric,stone=stone+(loot->>'stone')::numeric,food=food+(loot->>'food')::numeric,gold=gold+(loot->>'gold')::numeric where id=c.id;
   loot:=jsonb_build_object('wood',0,'stone',0,'food',0,'gold',0);
  end if;
 else
  damage:='[]';
  if coalesce((initial->>'diplomat')::integer,0)>0 and to_regclass('public.peris_conquest_version')is not null then
   conquest:=jsonb_build_object('city_id',c.id,'before',c.loyalty,'after',c.loyalty,'diplomats',coalesce((survivors->>'diplomat')::integer,0),'reduction',0,'captured',false,'culture_cost',0,'former_owner_id',b.defender_owner_id,'reason',case when c.ruined_at is not null then 'city_ruined'when c.owner_id<>b.defender_owner_id then 'ownership_changed'else 'attacker_did_not_win'end);
  end if;
 end if;
 if coalesce((conquest->>'captured')::boolean,false)then
  current_roster:=jsonb_set(current_roster,'{diplomat}',to_jsonb(greatest(0,(current_roster->>'diplomat')::integer-1)));
  -- Old campaign reserves did not participate. Keep them at the original owned home.
  if public.peris_roster_total(coalesce(a.raid_reserve,'{}'))>0 then
   perform public.peris_garrison_add(b.attacker_owner_id,floor(s.x/128.0)::integer,floor(s.y/128.0)::integer,a.raid_reserve)
   from public.settlements s where s.id=a.home_settlement_id and s.owner_id=b.attacker_owner_id and s.ruined_at is null;
  end if;
  perform public.peris_write_roster(a.id,current_roster);
 else perform public.peris_write_roster(a.id,public.peris_roster_add(current_roster,coalesce(a.raid_reserve,'{}')));end if;
 winner:=case p_winner when 'attacker'then b.attacker_owner_id when 'defender'then b.defender_owner_id end;
 r:=jsonb_build_object('balance_version',b.balance_version,'attacker_initial',ai,'defender_initial',di,'attacker_survivors',asur,'defender_survivors',dsur,'attacker_losses',ai-asur,'defender_losses',di-dsur,'attacker_roster',initial,'attacker_survivor_roster',survivors,'defender_roster',def_initial,'defender_survivor_roster',def_remaining,'attacker_faction',coalesce(b.attacker_faction,(select faction from public.settlements where id=a.home_settlement_id)),'defender_faction',coalesce(b.defender_faction,c.faction),'loot',loot,'duration',round(b.elapsed),'reason',p_reason,'carrying_capacity',carry,'replacement_cost',public.peris_roster_loss_cost(initial,survivors,b.balance_version),'raid_city',jsonb_build_object('id',c.id,'name',c.name),'siege_damage',damage,
   'city_ruined',exists(select 1 from public.settlements where id=c.id and ruined_at is not null));
 if conquest is not null then r:=r||jsonb_build_object('conquest',conquest);end if;
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
 if coalesce((conquest->>'captured')::boolean,false)then
  update public.armies set start_x=(public.peris_home_army_position(c.x,c.y)->>'x')::integer,start_y=(public.peris_home_army_position(c.x,c.y)->>'y')::integer,
   target_x=(public.peris_home_army_position(c.x,c.y)->>'x')::integer,target_y=(public.peris_home_army_position(c.x,c.y)->>'y')::integer,
   departure_at=public.peris_game_now(),arrival_at=public.peris_game_now(),march_path=null,march_distance=null,march_returning=false,march_origin=null,carried_loot=null,loot_report_id=null where id=a.id;
 elsif not public.peris_return_raid(a.id)then
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
declare owner uuid;farm public.peris_campaign_farms%rowtype;processed integer:=0;camp_id integer;preparation jsonb;
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
  union all select owner_id,due from public.peris_due_scouts()
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
     preparation:=public.peris_prepare_raid_for(owner,farm.army_id,farm.camp_id,farm.route,farm.troops);
     update public.armies set farm_list_id=farm.list_id where id=farm.army_id;
     update public.peris_campaign_farms set last_status=case when preparation?'mission_id'then 'Scouting preparing'else 'Raid preparing'end,sent=sent+1 where id=farm.id;
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
 if to_regprocedure('public.peris_loyalty_accrue(bigint,timestamp with time zone)')is not null then perform public.peris_loyalty_accrue(s.id,public.peris_game_now())from public.settlements s where s.owner_id=u;end if;
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
 if to_regclass('public.peris_conquest_version')is not null then result:=result||jsonb_build_object('conquest_version',1);end if;
 if to_regclass('public.peris_scout_missions')is not null and to_regclass('public.peris_crop_version')is not null then
  result:=result||jsonb_build_object('scouting_version',1);
  execute 'select $1||jsonb_build_object(''scouting_missions'',coalesce((select jsonb_agg(to_jsonb(m)order by m.id)from public.peris_scout_missions m where owner_id=$2 and(status in(''outbound'',''returning'')or id in(select id from public.peris_scout_missions where owner_id=$2 and status in(''completed'',''cancelled'')order by id desc limit 200))),''[]''::jsonb))'into result using result,u;
 end if;
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
 when 'peris_scout_command' then answer:=public.peris_scout_command(p_args->'p_command');
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
 from unnest(array['infantry','spearmen','archers','elite','cavalry','scout','heavyCavalry','ram','catapult','diplomat'])unit
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
  source:=coalesce(case when r.status='stationed'then(select id from public.settlements where id=r.target_settlement_id and owner_id=r.recipient_id and ruined_at is null)else coalesce((select id from public.settlements where id=r.source_settlement_id and owner_id=r.owner_id and ruined_at is null),(select id from public.settlements where id=r.target_settlement_id and owner_id=r.owner_id and ruined_at is null))end,(select min(id)from public.settlements where owner_id=r.owner_id and ruined_at is null));
  if source=p_sid then kind:='guild';key:='guild:'||r.id;owner_id:=r.owner_id;tier:=case when r.status='stationed'then 1 else 4 end;troops:=public.peris_roster(r.troops);return next;end if;
 end loop;
 for r in select * from public.peris_optional_scout_missions() loop
  source:=coalesce((select id from public.settlements where id=r.source_settlement_id and owner_id=r.owner_id and ruined_at is null),(select min(id)from public.settlements where owner_id=r.owner_id and ruined_at is null));
  if source=p_sid then kind:='scout';key:='scout:'||r.id;owner_id:=r.owner_id;tier:=4;troops:=public.peris_roster(jsonb_build_object('scout',r.scouts));return next;end if;
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
  update public.settlements set food=least(food_capacity,food+credit)where id=source_city and owner_id=owner and ruined_at is null;
 end loop;
 update public.battles set food_settled=true where id=b.id;
end $$;

-- Allocate permanent combat deaths against captured survivors, excluding already-debited famine.
create or replace function public.peris_food_defender_losses(p_bid bigint,p_party jsonb)returns jsonb
language plpgsql stable security definer set search_path='' as $$
declare b public.battles%rowtype;party jsonb;unit_name text;source_key text;total integer;prefix integer;amount integer;survivors integer;lost integer;result jsonb:=public.peris_roster('{}');seen boolean;
begin
 select * into b from public.battles where id=p_bid;
 foreach unit_name in array array['infantry','spearmen','archers','elite','cavalry','scout','heavyCavalry','ram','catapult','diplomat']loop
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
 select role into casualty_unit from unnest(array['infantry','spearmen','archers','elite','cavalry','scout','heavyCavalry','ram','catapult','diplomat'])with ordinality u(role,seq)order by coalesce((r.troops->>role)::integer,0)desc,seq limit 1;
 roster:=jsonb_set(r.troops,array[casualty_unit],to_jsonb((r.troops->>casualty_unit)::integer-1));parts:=string_to_array(r.key,':');
 if r.kind='army'then perform public.peris_write_roster(parts[2]::bigint,roster);
 elsif r.kind='reserve'then update public.armies set raid_reserve=roster where id=parts[2]::bigint;
 elsif r.kind='city'then update public.peris_city_garrisons set unit_roster=roster where settlement_id=p_sid;
 elsif r.kind='station'then update public.peris_garrisons set unit_roster=roster,infantry=public.peris_roster_class(roster,'infantry'),archers=public.peris_roster_class(roster,'archers'),cavalry=public.peris_roster_class(roster,'cavalry')where owner_id=r.owner_id and col=parts[3]::integer and row=parts[4]::integer;
 elsif r.kind='reinforcement'then update public.peris_city_reinforcements set troops=roster where id=parts[2]::bigint;
 elsif r.kind='guild'then update public.peris_guild_reinforcements set troops=roster where id=parts[2]::bigint;
 elsif r.kind='scout'then execute 'update public.peris_scout_missions set scouts=$1 where id=$2'using(roster->>'scout')::integer,parts[2]::bigint;
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
 union select owner_id,recipient_id from public.peris_scout_edges()
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
 perform public.peris_optional_advance_scouts(participants,cursor_at);
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
   union all select arrival_at from public.peris_optional_scout_missions()where owner_id=any(participants)
   union all select p_until
  )events where at_time>cursor_at and at_time<=p_until;
  exit when event_at is null;
  for city in select id from public.settlements where owner_id=any(participants)and ruined_at is null order by id loop perform public.peris_population_accrue(city.id,event_at);end loop;
  foreach participant in array participants loop perform public.peris_settle_core(participant,event_at);end loop;
  for r in select id from public.peris_trade_caravans where owner_id=any(participants)and(status='outbound'and arrival_at<=event_at or status='returning'and least(return_at,case when public.peris_trade_volume(returning_resources)>0 then redirect_at end)<=event_at)order by id loop perform public.peris_trade_event(r.id,event_at);end loop;
  perform public.peris_optional_advance_scouts(participants,event_at);
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

do $restore_conquest$begin if to_regclass('public.peris_conquest_version')is not null then execute $conquest_definition$-- Never wait for a player while retaining another participant's row/land lock.
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

alter table public.players add column if not exists research_faction text check(research_faction in('roman','spartan','persian','egyptian','orc','elf','dwarf','gnome','pandaren','undead','demon'));
-- Private loyalty; no rival map projection includes these columns.
alter table public.settlements add column if not exists loyalty numeric not null default 100 check(loyalty between 0 and 100);
alter table public.settlements add column if not exists loyalty_updated_at timestamptz not null default public.peris_game_now();
create table if not exists public.peris_conquest_version(id boolean primary key default true check(id));
alter table public.peris_conquest_version enable row level security;
revoke all on public.peris_conquest_version from public,anon,authenticated;
insert into public.peris_conquest_version values(true)on conflict do nothing;

create or replace function public.peris_loyalty_accrue(p_city bigint,p_until timestamptz)returns void
language sql security definer set search_path='' as $$
 update public.settlements set loyalty=least(100,loyalty+greatest(0,extract(epoch from(p_until-loyalty_updated_at)))*25/3600),
 loyalty_updated_at=greatest(loyalty_updated_at,p_until)where id=p_city
$$;
revoke all on function public.peris_loyalty_accrue(bigint,timestamptz)from public,anon,authenticated;

-- Generated by scripts/build-unit-balance.mjs; edit unitBalance.json.
insert into public.peris_unit_balance values
(1,'infantry','{"role":"line_infantry","building":"barracks","combatClass":"infantry","cost":{"wood":4,"stone":2,"food":6,"gold":1},"carry":20,"speed":40,"trainSeconds":2,"attack":1,"defence":1,"researchSeconds":0,"researchCost":{"wood":0,"stone":0,"food":0,"gold":0}}'::jsonb),
(1,'spearmen','{"role":"spear_guard","building":"barracks","combatClass":"infantry","cost":{"wood":5,"stone":3,"food":7,"gold":1},"carry":15,"speed":36,"trainSeconds":3,"attack":0.9,"defence":1.2,"researchSeconds":30,"researchCost":{"wood":40,"stone":30,"food":50,"gold":10}}'::jsonb),
(1,'archers','{"role":"archer","building":"barracks","combatClass":"archers","cost":{"wood":6,"stone":2,"food":5,"gold":2},"carry":15,"speed":34,"trainSeconds":2,"attack":1,"defence":1,"researchSeconds":0,"researchCost":{"wood":0,"stone":0,"food":0,"gold":0}}'::jsonb),
(1,'elite','{"role":"elite","building":"barracks","combatClass":"infantry","cost":{"wood":8,"stone":6,"food":12,"gold":3},"carry":15,"speed":38,"trainSeconds":4,"attack":1.4,"defence":1.35,"researchSeconds":60,"researchCost":{"wood":100,"stone":80,"food":120,"gold":30}}'::jsonb),
(1,'cavalry','{"role":"light_cavalry","building":"stables","combatClass":"cavalry","cost":{"wood":4,"stone":7,"food":12,"gold":4},"carry":40,"speed":76,"trainSeconds":5,"attack":1,"defence":1,"researchSeconds":0,"researchCost":{"wood":0,"stone":0,"food":0,"gold":0}}'::jsonb),
(1,'scout','{"role":"scout","building":"stables","combatClass":"cavalry","cost":{"wood":3,"stone":5,"food":9,"gold":3},"carry":10,"speed":92,"trainSeconds":4,"attack":0.45,"defence":0.75,"researchSeconds":30,"researchCost":{"wood":40,"stone":20,"food":50,"gold":10}}'::jsonb),
(1,'heavyCavalry','{"role":"heavy_cavalry","building":"stables","combatClass":"cavalry","cost":{"wood":8,"stone":12,"food":20,"gold":7},"carry":35,"speed":60,"trainSeconds":8,"attack":1.45,"defence":1.35,"researchSeconds":60,"researchCost":{"wood":100,"stone":120,"food":150,"gold":40}}'::jsonb),
(1,'ram','{"role":"ram","building":"workshop","combatClass":"infantry","cost":{"wood":20,"stone":15,"food":15,"gold":6},"carry":0,"speed":16,"trainSeconds":12,"attack":0.6,"defence":2,"researchSeconds":90,"researchCost":{"wood":180,"stone":120,"food":80,"gold":35}}'::jsonb),
(1,'catapult','{"role":"catapult","building":"workshop","combatClass":"archers","cost":{"wood":30,"stone":20,"food":18,"gold":10},"carry":0,"speed":12,"trainSeconds":18,"attack":2.4,"defence":0.7,"researchSeconds":120,"researchCost":{"wood":220,"stone":180,"food":100,"gold":60}}'::jsonb),
(1,'diplomat','{"role":"diplomat","building":"main","combatClass":"infantry","cost":{"wood":400,"stone":200,"food":600,"gold":100},"carry":0,"speed":30,"trainSeconds":200,"attack":0.1,"defence":0.5,"researchSeconds":90,"researchCost":{"wood":800,"stone":400,"food":1200,"gold":200}}'::jsonb),
(2,'infantry','{"role":"line_infantry","building":"barracks","combatClass":"infantry","cost":{"wood":4,"stone":2,"food":6,"gold":1},"carry":20,"speed":40,"trainSeconds":2,"attack":1,"defence":1,"researchSeconds":0,"researchCost":{"wood":0,"stone":0,"food":0,"gold":0}}'::jsonb),
(2,'spearmen','{"role":"spear_guard","building":"barracks","combatClass":"infantry","cost":{"wood":5,"stone":3,"food":7,"gold":1},"carry":15,"speed":36,"trainSeconds":3,"attack":0.9,"defence":1.3,"researchSeconds":30,"researchCost":{"wood":40,"stone":30,"food":50,"gold":10}}'::jsonb),
(2,'archers','{"role":"archer","building":"barracks","combatClass":"archers","cost":{"wood":6,"stone":2,"food":5,"gold":1},"carry":15,"speed":34,"trainSeconds":3,"attack":1.25,"defence":0.9,"researchSeconds":0,"researchCost":{"wood":0,"stone":0,"food":0,"gold":0}}'::jsonb),
(2,'elite','{"role":"elite","building":"barracks","combatClass":"infantry","cost":{"wood":7,"stone":5,"food":10,"gold":1},"carry":15,"speed":38,"trainSeconds":4,"attack":1.6,"defence":1.6,"researchSeconds":60,"researchCost":{"wood":100,"stone":80,"food":120,"gold":30}}'::jsonb),
(2,'cavalry','{"role":"light_cavalry","building":"stables","combatClass":"cavalry","cost":{"wood":5,"stone":6,"food":10,"gold":3},"carry":40,"speed":76,"trainSeconds":5,"attack":1,"defence":1,"researchSeconds":0,"researchCost":{"wood":0,"stone":0,"food":0,"gold":0}}'::jsonb),
(2,'scout','{"role":"scout","building":"stables","combatClass":"cavalry","cost":{"wood":3,"stone":2,"food":4,"gold":1},"carry":10,"speed":92,"trainSeconds":2,"attack":0.45,"defence":0.75,"researchSeconds":30,"researchCost":{"wood":40,"stone":20,"food":50,"gold":10}}'::jsonb),
(2,'heavyCavalry','{"role":"heavy_cavalry","building":"stables","combatClass":"cavalry","cost":{"wood":8,"stone":10,"food":16,"gold":4},"carry":35,"speed":60,"trainSeconds":8,"attack":1.45,"defence":1.4,"researchSeconds":60,"researchCost":{"wood":100,"stone":120,"food":150,"gold":40}}'::jsonb),
(2,'ram','{"role":"ram","building":"workshop","combatClass":"infantry","cost":{"wood":18,"stone":12,"food":12,"gold":4},"carry":0,"speed":16,"trainSeconds":12,"attack":0.6,"defence":2,"researchSeconds":90,"researchCost":{"wood":180,"stone":120,"food":80,"gold":35}}'::jsonb),
(2,'catapult','{"role":"catapult","building":"workshop","combatClass":"archers","cost":{"wood":25,"stone":18,"food":14,"gold":6},"carry":0,"speed":12,"trainSeconds":18,"attack":2.4,"defence":0.7,"researchSeconds":120,"researchCost":{"wood":220,"stone":180,"food":100,"gold":60}}'::jsonb),
(2,'diplomat','{"role":"diplomat","building":"main","combatClass":"infantry","cost":{"wood":400,"stone":200,"food":600,"gold":100},"carry":0,"speed":30,"trainSeconds":200,"attack":0.1,"defence":0.5,"researchSeconds":90,"researchCost":{"wood":800,"stone":400,"food":1200,"gold":200}}'::jsonb)
on conflict(version,unit)do update set rule=excluded.rule;
insert into public.peris_unit_profiles values
('roman','infantry',1,1),
('roman','archers',1,1),
('roman','cavalry',1,1),
('spartan','infantry',1,1.015),
('spartan','archers',0.98,0.98),
('spartan','cavalry',0.98,0.98),
('persian','infantry',0.98,0.98),
('persian','archers',1.04,1),
('persian','cavalry',1.04,1),
('egyptian','infantry',1,1.02),
('egyptian','archers',1,1.02),
('egyptian','cavalry',0.96,0.96),
('orc','infantry',1.02,0.99),
('orc','archers',0.965,0.965),
('orc','cavalry',1.03,0.99),
('elf','infantry',0.99,0.99),
('elf','archers',1.06,1.02),
('elf','cavalry',0.99,0.99),
('dwarf','infantry',0.99,1.05),
('dwarf','archers',0.99,0.99),
('dwarf','cavalry',0.965,0.965),
('gnome','infantry',1,0.99),
('gnome','archers',1.05,1.02),
('gnome','cavalry',1,0.99),
('pandaren','infantry',1,1.01),
('pandaren','archers',0.99,0.99),
('pandaren','cavalry',0.99,0.99),
('undead','infantry',0.98,1.012),
('undead','archers',0.97,0.97),
('undead','cavalry',1.015,1.01),
('demon','infantry',1.04,0.97),
('demon','archers',1.06,0.99),
('demon','cavalry',1,0.95)
on conflict(faction,combat_class)do update set attack=excluded.attack,defence=excluded.defence;
insert into public.peris_unit_catalog values
('infantry','barracks','infantry','{"wood":4,"stone":2,"food":6,"gold":1}'::jsonb,2,0,'{"wood":0,"stone":0,"food":0,"gold":0}'::jsonb,1,1,40,20),
('spearmen','barracks','infantry','{"wood":5,"stone":3,"food":7,"gold":1}'::jsonb,3,30,'{"wood":40,"stone":30,"food":50,"gold":10}'::jsonb,0.9,1.3,36,15),
('archers','barracks','archers','{"wood":6,"stone":2,"food":5,"gold":1}'::jsonb,3,0,'{"wood":0,"stone":0,"food":0,"gold":0}'::jsonb,1.25,0.9,34,15),
('elite','barracks','infantry','{"wood":7,"stone":5,"food":10,"gold":1}'::jsonb,4,60,'{"wood":100,"stone":80,"food":120,"gold":30}'::jsonb,1.6,1.6,38,15),
('cavalry','stables','cavalry','{"wood":5,"stone":6,"food":10,"gold":3}'::jsonb,5,0,'{"wood":0,"stone":0,"food":0,"gold":0}'::jsonb,1,1,76,40),
('scout','stables','cavalry','{"wood":3,"stone":2,"food":4,"gold":1}'::jsonb,2,30,'{"wood":40,"stone":20,"food":50,"gold":10}'::jsonb,0.45,0.75,92,10),
('heavyCavalry','stables','cavalry','{"wood":8,"stone":10,"food":16,"gold":4}'::jsonb,8,60,'{"wood":100,"stone":120,"food":150,"gold":40}'::jsonb,1.45,1.4,60,35),
('ram','workshop','infantry','{"wood":18,"stone":12,"food":12,"gold":4}'::jsonb,12,90,'{"wood":180,"stone":120,"food":80,"gold":35}'::jsonb,0.6,2,16,0),
('catapult','workshop','archers','{"wood":25,"stone":18,"food":14,"gold":6}'::jsonb,18,120,'{"wood":220,"stone":180,"food":100,"gold":60}'::jsonb,2.4,0.7,12,0),
('diplomat','main','infantry','{"wood":400,"stone":200,"food":600,"gold":100}'::jsonb,200,90,'{"wood":800,"stone":400,"food":1200,"gold":200}'::jsonb,0.1,0.5,30,0)
on conflict(unit)do update set building=excluded.building,combat_class=excluded.combat_class,cost=excluded.cost,train_seconds=excluded.train_seconds,research_seconds=excluded.research_seconds,research_cost=excluded.research_cost,attack=excluded.attack,defence=excluded.defence,speed=excluded.speed,carry=excluded.carry;

-- Generated from the shared technology catalog. Do not hand edit.
insert into public.peris_technology_catalog(id,name,branch,era,faction,cost,seconds,prerequisites,effects,metadata)values
('drill-grounds','Drill Grounds','warfare',0,null,35,30,'[]'::jsonb,'{"training":0.05}'::jsonb,'{"id":"drill-grounds","name":"Drill Grounds","branch":"warfare","era":0,"stage":0,"lane":0,"faction":null,"cost":35,"seconds":30,"requires":[],"effects":{"training":0.05},"atlas":"warfare","art_index":0,"description":"Drill Grounds develops your empire’s warfare. This discovery benefits every owned city and army."}'::jsonb),
('spear-formations','Spear Formations','warfare',0,null,42,36,'["drill-grounds"]'::jsonb,'{"unlock_spearmen":1}'::jsonb,'{"id":"spear-formations","name":"Spear Formations","branch":"warfare","era":0,"stage":1,"lane":0,"faction":null,"cost":42,"seconds":36,"requires":["drill-grounds"],"effects":{"unlock_spearmen":1},"atlas":"warfare","art_index":1,"description":"Spear Formations develops your empire’s warfare. This discovery benefits every owned city and army."}'::jsonb),
('shieldcraft','Shieldcraft','warfare',1,null,90,90,'["spear-formations"]'::jsonb,'{"infantry_defence":0.05}'::jsonb,'{"id":"shieldcraft","name":"Shieldcraft","branch":"warfare","era":1,"stage":2,"lane":0,"faction":null,"cost":90,"seconds":90,"requires":["spear-formations"],"effects":{"infantry_defence":0.05},"atlas":"warfare","art_index":2,"description":"Shieldcraft develops your empire’s warfare. This discovery benefits every owned city and army."}'::jsonb),
('bronze-forging','Bronze Forging','warfare',1,null,108,108,'["shieldcraft"]'::jsonb,'{"infantry_attack":0.05}'::jsonb,'{"id":"bronze-forging","name":"Bronze Forging","branch":"warfare","era":1,"stage":3,"lane":0,"faction":null,"cost":108,"seconds":108,"requires":["shieldcraft"],"effects":{"infantry_attack":0.05},"atlas":"warfare","art_index":3,"description":"Bronze Forging develops your empire’s warfare. This discovery benefits every owned city and army."}'::jsonb),
('professional-soldiers','Professional Soldiers','warfare',2,null,220,240,'["bronze-forging","libraries"]'::jsonb,'{"unlock_elite":1}'::jsonb,'{"id":"professional-soldiers","name":"Professional Soldiers","branch":"warfare","era":2,"stage":4,"lane":0,"faction":null,"cost":220,"seconds":240,"requires":["bronze-forging","libraries"],"effects":{"unlock_elite":1},"atlas":"warfare","art_index":4,"description":"Professional Soldiers develops your empire’s warfare. This discovery benefits every owned city and army."}'::jsonb),
('iron-forging','Iron Forging','warfare',2,null,264,288,'["professional-soldiers"]'::jsonb,'{"attack":0.08}'::jsonb,'{"id":"iron-forging","name":"Iron Forging","branch":"warfare","era":2,"stage":5,"lane":0,"faction":null,"cost":264,"seconds":288,"requires":["professional-soldiers"],"effects":{"attack":0.08},"atlas":"warfare","art_index":5,"description":"Iron Forging develops your empire’s warfare. This discovery benefits every owned city and army."}'::jsonb),
('steel-shields','Steel Shields','warfare',3,null,500,480,'["iron-forging"]'::jsonb,'{"defence":0.08}'::jsonb,'{"id":"steel-shields","name":"Steel Shields","branch":"warfare","era":3,"stage":6,"lane":0,"faction":null,"cost":500,"seconds":480,"requires":["iron-forging"],"effects":{"defence":0.08},"atlas":"warfare","art_index":6,"description":"Steel Shields develops your empire’s warfare. This discovery benefits every owned city and army."}'::jsonb),
('officer-school','Officer School','warfare',3,null,600,576,'["steel-shields"]'::jsonb,'{"training":0.08}'::jsonb,'{"id":"officer-school","name":"Officer School","branch":"warfare","era":3,"stage":7,"lane":0,"faction":null,"cost":600,"seconds":576,"requires":["steel-shields"],"effects":{"training":0.08},"atlas":"warfare","art_index":7,"description":"Officer School develops your empire’s warfare. This discovery benefits every owned city and army."}'::jsonb),
('combined-arms','Combined Arms','warfare',4,null,1000,850,'["officer-school","philosophy"]'::jsonb,'{"attack":0.1}'::jsonb,'{"id":"combined-arms","name":"Combined Arms","branch":"warfare","era":4,"stage":8,"lane":0,"faction":null,"cost":1000,"seconds":850,"requires":["officer-school","philosophy"],"effects":{"attack":0.1},"atlas":"warfare","art_index":8,"description":"Combined Arms develops your empire’s warfare. This discovery benefits every owned city and army."}'::jsonb),
('veteran-guard','Veteran Guard','warfare',4,null,1200,1020,'["combined-arms"]'::jsonb,'{"infantry_defence":0.1}'::jsonb,'{"id":"veteran-guard","name":"Veteran Guard","branch":"warfare","era":4,"stage":9,"lane":0,"faction":null,"cost":1200,"seconds":1020,"requires":["combined-arms"],"effects":{"infantry_defence":0.1},"atlas":"warfare","art_index":9,"description":"Veteran Guard develops your empire’s warfare. This discovery benefits every owned city and army."}'::jsonb),
('bowcraft','Bowcraft','archery',0,null,35,30,'[]'::jsonb,'{"archers_attack":0.05}'::jsonb,'{"id":"bowcraft","name":"Bowcraft","branch":"archery","era":0,"stage":0,"lane":1,"faction":null,"cost":35,"seconds":30,"requires":[],"effects":{"archers_attack":0.05},"atlas":"archery","art_index":0,"description":"Bowcraft develops your empire’s archery. This discovery benefits every owned city and army."}'::jsonb),
('fletching','Fletching','archery',0,null,42,36,'["bowcraft"]'::jsonb,'{"training":0.05}'::jsonb,'{"id":"fletching","name":"Fletching","branch":"archery","era":0,"stage":1,"lane":1,"faction":null,"cost":42,"seconds":36,"requires":["bowcraft"],"effects":{"training":0.05},"atlas":"archery","art_index":1,"description":"Fletching develops your empire’s archery. This discovery benefits every owned city and army."}'::jsonb),
('target-practice','Target Practice','archery',1,null,90,90,'["fletching"]'::jsonb,'{"archers_defence":0.05}'::jsonb,'{"id":"target-practice","name":"Target Practice","branch":"archery","era":1,"stage":2,"lane":1,"faction":null,"cost":90,"seconds":90,"requires":["fletching"],"effects":{"archers_defence":0.05},"atlas":"archery","art_index":2,"description":"Target Practice develops your empire’s archery. This discovery benefits every owned city and army."}'::jsonb),
('composite-bows','Composite Bows','archery',1,null,108,108,'["target-practice"]'::jsonb,'{"archers_attack":0.05}'::jsonb,'{"id":"composite-bows","name":"Composite Bows","branch":"archery","era":1,"stage":3,"lane":1,"faction":null,"cost":108,"seconds":108,"requires":["target-practice"],"effects":{"archers_attack":0.05},"atlas":"archery","art_index":3,"description":"Composite Bows develops your empire’s archery. This discovery benefits every owned city and army."}'::jsonb),
('range-finding','Range Finding','archery',2,null,220,240,'["composite-bows","libraries"]'::jsonb,'{"archers_attack":0.08}'::jsonb,'{"id":"range-finding","name":"Range Finding","branch":"archery","era":2,"stage":4,"lane":1,"faction":null,"cost":220,"seconds":240,"requires":["composite-bows","libraries"],"effects":{"archers_attack":0.08},"atlas":"archery","art_index":4,"description":"Range Finding develops your empire’s archery. This discovery benefits every owned city and army."}'::jsonb),
('siege-arrows','Siege Arrows','archery',2,null,264,288,'["range-finding"]'::jsonb,'{"siege":0.08}'::jsonb,'{"id":"siege-arrows","name":"Siege Arrows","branch":"archery","era":2,"stage":5,"lane":1,"faction":null,"cost":264,"seconds":288,"requires":["range-finding"],"effects":{"siege":0.08},"atlas":"archery","art_index":5,"description":"Siege Arrows develops your empire’s archery. This discovery benefits every owned city and army."}'::jsonb),
('longbows','Longbows','archery',3,null,500,480,'["siege-arrows"]'::jsonb,'{"archers_attack":0.08}'::jsonb,'{"id":"longbows","name":"Longbows","branch":"archery","era":3,"stage":6,"lane":1,"faction":null,"cost":500,"seconds":480,"requires":["siege-arrows"],"effects":{"archers_attack":0.08},"atlas":"archery","art_index":6,"description":"Longbows develops your empire’s archery. This discovery benefits every owned city and army."}'::jsonb),
('bodkin-arrows','Bodkin Arrows','archery',3,null,600,576,'["longbows"]'::jsonb,'{"archers_attack":0.08}'::jsonb,'{"id":"bodkin-arrows","name":"Bodkin Arrows","branch":"archery","era":3,"stage":7,"lane":1,"faction":null,"cost":600,"seconds":576,"requires":["longbows"],"effects":{"archers_attack":0.08},"atlas":"archery","art_index":7,"description":"Bodkin Arrows develops your empire’s archery. This discovery benefits every owned city and army."}'::jsonb),
('volley-drill','Volley Drill','archery',4,null,1000,850,'["bodkin-arrows","philosophy"]'::jsonb,'{"training":0.1}'::jsonb,'{"id":"volley-drill","name":"Volley Drill","branch":"archery","era":4,"stage":8,"lane":1,"faction":null,"cost":1000,"seconds":850,"requires":["bodkin-arrows","philosophy"],"effects":{"training":0.1},"atlas":"archery","art_index":8,"description":"Volley Drill develops your empire’s archery. This discovery benefits every owned city and army."}'::jsonb),
('master-archers','Master Archers','archery',4,null,1200,1020,'["volley-drill"]'::jsonb,'{"archers_defence":0.1}'::jsonb,'{"id":"master-archers","name":"Master Archers","branch":"archery","era":4,"stage":9,"lane":1,"faction":null,"cost":1200,"seconds":1020,"requires":["volley-drill"],"effects":{"archers_defence":0.1},"atlas":"archery","art_index":9,"description":"Master Archers develops your empire’s archery. This discovery benefits every owned city and army."}'::jsonb),
('scouting','Scouting','cavalry',0,null,35,30,'[]'::jsonb,'{"unlock_scout":1}'::jsonb,'{"id":"scouting","name":"Scouting","branch":"cavalry","era":0,"stage":0,"lane":2,"faction":null,"cost":35,"seconds":30,"requires":[],"effects":{"unlock_scout":1},"atlas":"cavalry","art_index":0,"description":"Scouting develops your empire’s cavalry. This discovery benefits every owned city and army."}'::jsonb),
('saddles','Saddles','cavalry',0,null,42,36,'["scouting"]'::jsonb,'{"march":0.05}'::jsonb,'{"id":"saddles","name":"Saddles","branch":"cavalry","era":0,"stage":1,"lane":2,"faction":null,"cost":42,"seconds":36,"requires":["scouting"],"effects":{"march":0.05},"atlas":"cavalry","art_index":1,"description":"Saddles develops your empire’s cavalry. This discovery benefits every owned city and army."}'::jsonb),
('stirrups','Stirrups','cavalry',1,null,90,90,'["saddles"]'::jsonb,'{"cavalry_attack":0.05}'::jsonb,'{"id":"stirrups","name":"Stirrups","branch":"cavalry","era":1,"stage":2,"lane":2,"faction":null,"cost":90,"seconds":90,"requires":["saddles"],"effects":{"cavalry_attack":0.05},"atlas":"cavalry","art_index":2,"description":"Stirrups develops your empire’s cavalry. This discovery benefits every owned city and army."}'::jsonb),
('riding-schools','Riding Schools','cavalry',1,null,108,108,'["stirrups"]'::jsonb,'{"training":0.05}'::jsonb,'{"id":"riding-schools","name":"Riding Schools","branch":"cavalry","era":1,"stage":3,"lane":2,"faction":null,"cost":108,"seconds":108,"requires":["stirrups"],"effects":{"training":0.05},"atlas":"cavalry","art_index":3,"description":"Riding Schools develops your empire’s cavalry. This discovery benefits every owned city and army."}'::jsonb),
('barding','Barding','cavalry',2,null,220,240,'["riding-schools","libraries"]'::jsonb,'{"cavalry_defence":0.08}'::jsonb,'{"id":"barding","name":"Barding","branch":"cavalry","era":2,"stage":4,"lane":2,"faction":null,"cost":220,"seconds":240,"requires":["riding-schools","libraries"],"effects":{"cavalry_defence":0.08},"atlas":"cavalry","art_index":4,"description":"Barding develops your empire’s cavalry. This discovery benefits every owned city and army."}'::jsonb),
('heavy-cavalry','Heavy Cavalry','cavalry',2,null,264,288,'["barding"]'::jsonb,'{"unlock_heavyCavalry":1}'::jsonb,'{"id":"heavy-cavalry","name":"Heavy Cavalry","branch":"cavalry","era":2,"stage":5,"lane":2,"faction":null,"cost":264,"seconds":288,"requires":["barding"],"effects":{"unlock_heavyCavalry":1},"atlas":"cavalry","art_index":5,"description":"Heavy Cavalry develops your empire’s cavalry. This discovery benefits every owned city and army."}'::jsonb),
('swift-couriers','Swift Couriers','cavalry',3,null,500,480,'["heavy-cavalry"]'::jsonb,'{"march":0.08}'::jsonb,'{"id":"swift-couriers","name":"Swift Couriers","branch":"cavalry","era":3,"stage":6,"lane":2,"faction":null,"cost":500,"seconds":480,"requires":["heavy-cavalry"],"effects":{"march":0.08},"atlas":"cavalry","art_index":6,"description":"Swift Couriers develops your empire’s cavalry. This discovery benefits every owned city and army."}'::jsonb),
('mounted-tactics','Mounted Tactics','cavalry',3,null,600,576,'["swift-couriers"]'::jsonb,'{"cavalry_attack":0.08}'::jsonb,'{"id":"mounted-tactics","name":"Mounted Tactics","branch":"cavalry","era":3,"stage":7,"lane":2,"faction":null,"cost":600,"seconds":576,"requires":["swift-couriers"],"effects":{"cavalry_attack":0.08},"atlas":"cavalry","art_index":7,"description":"Mounted Tactics develops your empire’s cavalry. This discovery benefits every owned city and army."}'::jsonb),
('warhorse-breeding','Warhorse Breeding','cavalry',4,null,1000,850,'["mounted-tactics","philosophy"]'::jsonb,'{"training":0.1}'::jsonb,'{"id":"warhorse-breeding","name":"Warhorse Breeding","branch":"cavalry","era":4,"stage":8,"lane":2,"faction":null,"cost":1000,"seconds":850,"requires":["mounted-tactics","philosophy"],"effects":{"training":0.1},"atlas":"cavalry","art_index":8,"description":"Warhorse Breeding develops your empire’s cavalry. This discovery benefits every owned city and army."}'::jsonb),
('royal-cavalry','Royal Cavalry','cavalry',4,null,1200,1020,'["warhorse-breeding"]'::jsonb,'{"cavalry_defence":0.1}'::jsonb,'{"id":"royal-cavalry","name":"Royal Cavalry","branch":"cavalry","era":4,"stage":9,"lane":2,"faction":null,"cost":1200,"seconds":1020,"requires":["warhorse-breeding"],"effects":{"cavalry_defence":0.1},"atlas":"cavalry","art_index":9,"description":"Royal Cavalry develops your empire’s cavalry. This discovery benefits every owned city and army."}'::jsonb),
('carpentry','Carpentry','siege',0,null,35,30,'[]'::jsonb,'{"construction":0.05}'::jsonb,'{"id":"carpentry","name":"Carpentry","branch":"siege","era":0,"stage":0,"lane":3,"faction":null,"cost":35,"seconds":30,"requires":[],"effects":{"construction":0.05},"atlas":"siege","art_index":0,"description":"Carpentry develops your empire’s siege. This discovery benefits every owned city and army."}'::jsonb),
('battering-rams','Battering Rams','siege',0,null,42,36,'["carpentry"]'::jsonb,'{"unlock_ram":1}'::jsonb,'{"id":"battering-rams","name":"Battering Rams","branch":"siege","era":0,"stage":1,"lane":3,"faction":null,"cost":42,"seconds":36,"requires":["carpentry"],"effects":{"unlock_ram":1},"atlas":"siege","art_index":1,"description":"Battering Rams develops your empire’s siege. This discovery benefits every owned city and army."}'::jsonb),
('siege-logistics','Siege Logistics','siege',1,null,90,90,'["battering-rams"]'::jsonb,'{"march":0.05}'::jsonb,'{"id":"siege-logistics","name":"Siege Logistics","branch":"siege","era":1,"stage":2,"lane":3,"faction":null,"cost":90,"seconds":90,"requires":["battering-rams"],"effects":{"march":0.05},"atlas":"siege","art_index":2,"description":"Siege Logistics develops your empire’s siege. This discovery benefits every owned city and army."}'::jsonb),
('fortification-studies','Fortification Studies','siege',1,null,108,108,'["siege-logistics"]'::jsonb,'{"defence":0.05}'::jsonb,'{"id":"fortification-studies","name":"Fortification Studies","branch":"siege","era":1,"stage":3,"lane":3,"faction":null,"cost":108,"seconds":108,"requires":["siege-logistics"],"effects":{"defence":0.05},"atlas":"siege","art_index":3,"description":"Fortification Studies develops your empire’s siege. This discovery benefits every owned city and army."}'::jsonb),
('catapults','Catapults','siege',2,null,220,240,'["fortification-studies","libraries"]'::jsonb,'{"unlock_catapult":1}'::jsonb,'{"id":"catapults","name":"Catapults","branch":"siege","era":2,"stage":4,"lane":3,"faction":null,"cost":220,"seconds":240,"requires":["fortification-studies","libraries"],"effects":{"unlock_catapult":1},"atlas":"siege","art_index":4,"description":"Catapults develops your empire’s siege. This discovery benefits every owned city and army."}'::jsonb),
('counterweights','Counterweights','siege',2,null,264,288,'["catapults"]'::jsonb,'{"siege":0.08}'::jsonb,'{"id":"counterweights","name":"Counterweights","branch":"siege","era":2,"stage":5,"lane":3,"faction":null,"cost":264,"seconds":288,"requires":["catapults"],"effects":{"siege":0.08},"atlas":"siege","art_index":5,"description":"Counterweights develops your empire’s siege. This discovery benefits every owned city and army."}'::jsonb),
('reinforced-frames','Reinforced Frames','siege',3,null,500,480,'["counterweights"]'::jsonb,'{"siege":0.08}'::jsonb,'{"id":"reinforced-frames","name":"Reinforced Frames","branch":"siege","era":3,"stage":6,"lane":3,"faction":null,"cost":500,"seconds":480,"requires":["counterweights"],"effects":{"siege":0.08},"atlas":"siege","art_index":6,"description":"Reinforced Frames develops your empire’s siege. This discovery benefits every owned city and army."}'::jsonb),
('siege-engines','Siege Engines','siege',3,null,600,576,'["reinforced-frames"]'::jsonb,'{"training":0.08}'::jsonb,'{"id":"siege-engines","name":"Siege Engines","branch":"siege","era":3,"stage":7,"lane":3,"faction":null,"cost":600,"seconds":576,"requires":["reinforced-frames"],"effects":{"training":0.08},"atlas":"siege","art_index":7,"description":"Siege Engines develops your empire’s siege. This discovery benefits every owned city and army."}'::jsonb),
('siege-masters','Siege Masters','siege',4,null,1000,850,'["siege-engines","philosophy"]'::jsonb,'{"siege":0.1}'::jsonb,'{"id":"siege-masters","name":"Siege Masters","branch":"siege","era":4,"stage":8,"lane":3,"faction":null,"cost":1000,"seconds":850,"requires":["siege-engines","philosophy"],"effects":{"siege":0.1},"atlas":"siege","art_index":8,"description":"Siege Masters develops your empire’s siege. This discovery benefits every owned city and army."}'::jsonb),
('grand-bombardment','Grand Bombardment','siege',4,null,1200,1020,'["siege-masters"]'::jsonb,'{"siege":0.1}'::jsonb,'{"id":"grand-bombardment","name":"Grand Bombardment","branch":"siege","era":4,"stage":9,"lane":3,"faction":null,"cost":1200,"seconds":1020,"requires":["siege-masters"],"effects":{"siege":0.1},"atlas":"siege","art_index":9,"description":"Grand Bombardment develops your empire’s siege. This discovery benefits every owned city and army."}'::jsonb),
('crop-rotation','Crop Rotation','agriculture',0,null,35,30,'[]'::jsonb,'{"food":0.05}'::jsonb,'{"id":"crop-rotation","name":"Crop Rotation","branch":"agriculture","era":0,"stage":0,"lane":4,"faction":null,"cost":35,"seconds":30,"requires":[],"effects":{"food":0.05},"atlas":"agriculture","art_index":0,"description":"Crop Rotation develops your empire’s agriculture. This discovery benefits every owned city and army."}'::jsonb),
('irrigation','Irrigation','agriculture',0,null,42,36,'["crop-rotation"]'::jsonb,'{"food":0.05}'::jsonb,'{"id":"irrigation","name":"Irrigation","branch":"agriculture","era":0,"stage":1,"lane":4,"faction":null,"cost":42,"seconds":36,"requires":["crop-rotation"],"effects":{"food":0.05},"atlas":"agriculture","art_index":1,"description":"Irrigation develops your empire’s agriculture. This discovery benefits every owned city and army."}'::jsonb),
('seed-selection','Seed Selection','agriculture',1,null,90,90,'["irrigation"]'::jsonb,'{"food":0.05}'::jsonb,'{"id":"seed-selection","name":"Seed Selection","branch":"agriculture","era":1,"stage":2,"lane":4,"faction":null,"cost":90,"seconds":90,"requires":["irrigation"],"effects":{"food":0.05},"atlas":"agriculture","art_index":2,"description":"Seed Selection develops your empire’s agriculture. This discovery benefits every owned city and army."}'::jsonb),
('water-mills','Water Mills','agriculture',1,null,108,108,'["seed-selection"]'::jsonb,'{"food":0.05}'::jsonb,'{"id":"water-mills","name":"Water Mills","branch":"agriculture","era":1,"stage":3,"lane":4,"faction":null,"cost":108,"seconds":108,"requires":["seed-selection"],"effects":{"food":0.05},"atlas":"agriculture","art_index":3,"description":"Water Mills develops your empire’s agriculture. This discovery benefits every owned city and army."}'::jsonb),
('terrace-farming','Terrace Farming','agriculture',2,null,220,240,'["water-mills","libraries"]'::jsonb,'{"food":0.08}'::jsonb,'{"id":"terrace-farming","name":"Terrace Farming","branch":"agriculture","era":2,"stage":4,"lane":4,"faction":null,"cost":220,"seconds":240,"requires":["water-mills","libraries"],"effects":{"food":0.08},"atlas":"agriculture","art_index":4,"description":"Terrace Farming develops your empire’s agriculture. This discovery benefits every owned city and army."}'::jsonb),
('orchards','Orchards','agriculture',2,null,264,288,'["terrace-farming"]'::jsonb,'{"food":0.08}'::jsonb,'{"id":"orchards","name":"Orchards","branch":"agriculture","era":2,"stage":5,"lane":4,"faction":null,"cost":264,"seconds":288,"requires":["terrace-farming"],"effects":{"food":0.08},"atlas":"agriculture","art_index":5,"description":"Orchards develops your empire’s agriculture. This discovery benefits every owned city and army."}'::jsonb),
('animal-husbandry','Animal Husbandry','agriculture',3,null,500,480,'["orchards"]'::jsonb,'{"food":0.08}'::jsonb,'{"id":"animal-husbandry","name":"Animal Husbandry","branch":"agriculture","era":3,"stage":6,"lane":4,"faction":null,"cost":500,"seconds":480,"requires":["orchards"],"effects":{"food":0.08},"atlas":"agriculture","art_index":6,"description":"Animal Husbandry develops your empire’s agriculture. This discovery benefits every owned city and army."}'::jsonb),
('food-preservation','Food Preservation','agriculture',3,null,600,576,'["animal-husbandry"]'::jsonb,'{"storage":0.08}'::jsonb,'{"id":"food-preservation","name":"Food Preservation","branch":"agriculture","era":3,"stage":7,"lane":4,"faction":null,"cost":600,"seconds":576,"requires":["animal-husbandry"],"effects":{"storage":0.08},"atlas":"agriculture","art_index":7,"description":"Food Preservation develops your empire’s agriculture. This discovery benefits every owned city and army."}'::jsonb),
('agrarian-estates','Agrarian Estates','agriculture',4,null,1000,850,'["food-preservation","philosophy"]'::jsonb,'{"food":0.1}'::jsonb,'{"id":"agrarian-estates","name":"Agrarian Estates","branch":"agriculture","era":4,"stage":8,"lane":4,"faction":null,"cost":1000,"seconds":850,"requires":["food-preservation","philosophy"],"effects":{"food":0.1},"atlas":"agriculture","art_index":8,"description":"Agrarian Estates develops your empire’s agriculture. This discovery benefits every owned city and army."}'::jsonb),
('abundant-harvest','Abundant Harvest','agriculture',4,null,1200,1020,'["agrarian-estates"]'::jsonb,'{"food":0.1}'::jsonb,'{"id":"abundant-harvest","name":"Abundant Harvest","branch":"agriculture","era":4,"stage":9,"lane":4,"faction":null,"cost":1200,"seconds":1020,"requires":["agrarian-estates"],"effects":{"food":0.1},"atlas":"agriculture","art_index":9,"description":"Abundant Harvest develops your empire’s agriculture. This discovery benefits every owned city and army."}'::jsonb),
('forestry','Forestry','industry',0,null,35,30,'[]'::jsonb,'{"wood":0.05}'::jsonb,'{"id":"forestry","name":"Forestry","branch":"industry","era":0,"stage":0,"lane":5,"faction":null,"cost":35,"seconds":30,"requires":[],"effects":{"wood":0.05},"atlas":"industry","art_index":0,"description":"Forestry develops your empire’s industry. This discovery benefits every owned city and army."}'::jsonb),
('stonecutting','Stonecutting','industry',0,null,42,36,'["forestry"]'::jsonb,'{"stone":0.05}'::jsonb,'{"id":"stonecutting","name":"Stonecutting","branch":"industry","era":0,"stage":1,"lane":5,"faction":null,"cost":42,"seconds":36,"requires":["forestry"],"effects":{"stone":0.05},"atlas":"industry","art_index":1,"description":"Stonecutting develops your empire’s industry. This discovery benefits every owned city and army."}'::jsonb),
('improved-axes','Improved Axes','industry',1,null,90,90,'["stonecutting"]'::jsonb,'{"wood":0.05}'::jsonb,'{"id":"improved-axes","name":"Improved Axes","branch":"industry","era":1,"stage":2,"lane":5,"faction":null,"cost":90,"seconds":90,"requires":["stonecutting"],"effects":{"wood":0.05},"atlas":"industry","art_index":2,"description":"Improved Axes develops your empire’s industry. This discovery benefits every owned city and army."}'::jsonb),
('deep-quarrying','Deep Quarrying','industry',1,null,108,108,'["improved-axes"]'::jsonb,'{"stone":0.05}'::jsonb,'{"id":"deep-quarrying","name":"Deep Quarrying","branch":"industry","era":1,"stage":3,"lane":5,"faction":null,"cost":108,"seconds":108,"requires":["improved-axes"],"effects":{"stone":0.05},"atlas":"industry","art_index":3,"description":"Deep Quarrying develops your empire’s industry. This discovery benefits every owned city and army."}'::jsonb),
('ore-prospecting','Ore Prospecting','industry',2,null,220,240,'["deep-quarrying","libraries"]'::jsonb,'{"gold":0.08}'::jsonb,'{"id":"ore-prospecting","name":"Ore Prospecting","branch":"industry","era":2,"stage":4,"lane":5,"faction":null,"cost":220,"seconds":240,"requires":["deep-quarrying","libraries"],"effects":{"gold":0.08},"atlas":"industry","art_index":4,"description":"Ore Prospecting develops your empire’s industry. This discovery benefits every owned city and army."}'::jsonb),
('saw-mills','Saw Mills','industry',2,null,264,288,'["ore-prospecting"]'::jsonb,'{"wood":0.08}'::jsonb,'{"id":"saw-mills","name":"Saw Mills","branch":"industry","era":2,"stage":5,"lane":5,"faction":null,"cost":264,"seconds":288,"requires":["ore-prospecting"],"effects":{"wood":0.08},"atlas":"industry","art_index":5,"description":"Saw Mills develops your empire’s industry. This discovery benefits every owned city and army."}'::jsonb),
('precision-tools','Precision Tools','industry',3,null,500,480,'["saw-mills"]'::jsonb,'{"construction":0.08}'::jsonb,'{"id":"precision-tools","name":"Precision Tools","branch":"industry","era":3,"stage":6,"lane":5,"faction":null,"cost":500,"seconds":480,"requires":["saw-mills"],"effects":{"construction":0.08},"atlas":"industry","art_index":6,"description":"Precision Tools develops your empire’s industry. This discovery benefits every owned city and army."}'::jsonb),
('industrial-estates','Industrial Estates','industry',3,null,600,576,'["precision-tools"]'::jsonb,'{"stone":0.08}'::jsonb,'{"id":"industrial-estates","name":"Industrial Estates","branch":"industry","era":3,"stage":7,"lane":5,"faction":null,"cost":600,"seconds":576,"requires":["precision-tools"],"effects":{"stone":0.08},"atlas":"industry","art_index":7,"description":"Industrial Estates develops your empire’s industry. This discovery benefits every owned city and army."}'::jsonb),
('master-craftsmen','Master Craftsmen','industry',4,null,1000,850,'["industrial-estates","philosophy"]'::jsonb,'{"wood":0.1}'::jsonb,'{"id":"master-craftsmen","name":"Master Craftsmen","branch":"industry","era":4,"stage":8,"lane":5,"faction":null,"cost":1000,"seconds":850,"requires":["industrial-estates","philosophy"],"effects":{"wood":0.1},"atlas":"industry","art_index":8,"description":"Master Craftsmen develops your empire’s industry. This discovery benefits every owned city and army."}'::jsonb),
('great-foundries','Great Foundries','industry',4,null,1200,1020,'["master-craftsmen"]'::jsonb,'{"stone":0.1}'::jsonb,'{"id":"great-foundries","name":"Great Foundries","branch":"industry","era":4,"stage":9,"lane":5,"faction":null,"cost":1200,"seconds":1020,"requires":["master-craftsmen"],"effects":{"stone":0.1},"atlas":"industry","art_index":9,"description":"Great Foundries develops your empire’s industry. This discovery benefits every owned city and army."}'::jsonb),
('masonry','Masonry','engineering',0,null,35,30,'[]'::jsonb,'{"construction":0.05}'::jsonb,'{"id":"masonry","name":"Masonry","branch":"engineering","era":0,"stage":0,"lane":6,"faction":null,"cost":35,"seconds":30,"requires":[],"effects":{"construction":0.05},"atlas":"engineering","art_index":0,"description":"Masonry develops your empire’s engineering. This discovery benefits every owned city and army."}'::jsonb),
('road-building','Road Building','engineering',0,null,42,36,'["masonry"]'::jsonb,'{"march":0.05}'::jsonb,'{"id":"road-building","name":"Road Building","branch":"engineering","era":0,"stage":1,"lane":6,"faction":null,"cost":42,"seconds":36,"requires":["masonry"],"effects":{"march":0.05},"atlas":"engineering","art_index":1,"description":"Road Building develops your empire’s engineering. This discovery benefits every owned city and army."}'::jsonb),
('scaffolding','Scaffolding','engineering',1,null,90,90,'["road-building"]'::jsonb,'{"construction":0.05}'::jsonb,'{"id":"scaffolding","name":"Scaffolding","branch":"engineering","era":1,"stage":2,"lane":6,"faction":null,"cost":90,"seconds":90,"requires":["road-building"],"effects":{"construction":0.05},"atlas":"engineering","art_index":2,"description":"Scaffolding develops your empire’s engineering. This discovery benefits every owned city and army."}'::jsonb),
('architecture','Architecture','engineering',1,null,108,108,'["scaffolding"]'::jsonb,'{"storage":0.05}'::jsonb,'{"id":"architecture","name":"Architecture","branch":"engineering","era":1,"stage":3,"lane":6,"faction":null,"cost":108,"seconds":108,"requires":["scaffolding"],"effects":{"storage":0.05},"atlas":"engineering","art_index":3,"description":"Architecture develops your empire’s engineering. This discovery benefits every owned city and army."}'::jsonb),
('cranes','Cranes','engineering',2,null,220,240,'["architecture","libraries"]'::jsonb,'{"construction":0.08}'::jsonb,'{"id":"cranes","name":"Cranes","branch":"engineering","era":2,"stage":4,"lane":6,"faction":null,"cost":220,"seconds":240,"requires":["architecture","libraries"],"effects":{"construction":0.08},"atlas":"engineering","art_index":4,"description":"Cranes develops your empire’s engineering. This discovery benefits every owned city and army."}'::jsonb),
('surveying','Surveying','engineering',2,null,264,288,'["cranes"]'::jsonb,'{"construction":0.08}'::jsonb,'{"id":"surveying","name":"Surveying","branch":"engineering","era":2,"stage":5,"lane":6,"faction":null,"cost":264,"seconds":288,"requires":["cranes"],"effects":{"construction":0.08},"atlas":"engineering","art_index":5,"description":"Surveying develops your empire’s engineering. This discovery benefits every owned city and army."}'::jsonb),
('urban-planning','Urban Planning','engineering',3,null,500,480,'["surveying"]'::jsonb,'{"construction":0.08}'::jsonb,'{"id":"urban-planning","name":"Urban Planning","branch":"engineering","era":3,"stage":6,"lane":6,"faction":null,"cost":500,"seconds":480,"requires":["surveying"],"effects":{"construction":0.08},"atlas":"engineering","art_index":6,"description":"Urban Planning develops your empire’s engineering. This discovery benefits every owned city and army."}'::jsonb),
('concrete','Concrete','engineering',3,null,600,576,'["urban-planning"]'::jsonb,'{"defence":0.08}'::jsonb,'{"id":"concrete","name":"Concrete","branch":"engineering","era":3,"stage":7,"lane":6,"faction":null,"cost":600,"seconds":576,"requires":["urban-planning"],"effects":{"defence":0.08},"atlas":"engineering","art_index":7,"description":"Concrete develops your empire’s engineering. This discovery benefits every owned city and army."}'::jsonb),
('monuments','Monuments','engineering',4,null,1000,850,'["concrete","philosophy"]'::jsonb,'{"culture":0.1}'::jsonb,'{"id":"monuments","name":"Monuments","branch":"engineering","era":4,"stage":8,"lane":6,"faction":null,"cost":1000,"seconds":850,"requires":["concrete","philosophy"],"effects":{"culture":0.1},"atlas":"engineering","art_index":8,"description":"Monuments develops your empire’s engineering. This discovery benefits every owned city and army."}'::jsonb),
('master-builders','Master Builders','engineering',4,null,1200,1020,'["monuments"]'::jsonb,'{"construction":0.1}'::jsonb,'{"id":"master-builders","name":"Master Builders","branch":"engineering","era":4,"stage":9,"lane":6,"faction":null,"cost":1200,"seconds":1020,"requires":["monuments"],"effects":{"construction":0.1},"atlas":"engineering","art_index":9,"description":"Master Builders develops your empire’s engineering. This discovery benefits every owned city and army."}'::jsonb),
('barter','Barter','commerce',0,null,35,30,'[]'::jsonb,'{"trade":0.05}'::jsonb,'{"id":"barter","name":"Barter","branch":"commerce","era":0,"stage":0,"lane":7,"faction":null,"cost":35,"seconds":30,"requires":[],"effects":{"trade":0.05},"atlas":"commerce","art_index":0,"description":"Barter develops your empire’s commerce. This discovery benefits every owned city and army."}'::jsonb),
('currency','Currency','commerce',0,null,42,36,'["barter"]'::jsonb,'{"gold":0.05}'::jsonb,'{"id":"currency","name":"Currency","branch":"commerce","era":0,"stage":1,"lane":7,"faction":null,"cost":42,"seconds":36,"requires":["barter"],"effects":{"gold":0.05},"atlas":"commerce","art_index":1,"description":"Currency develops your empire’s commerce. This discovery benefits every owned city and army."}'::jsonb),
('trade-routes','Trade Routes','commerce',1,null,90,90,'["currency"]'::jsonb,'{"carry":0.05}'::jsonb,'{"id":"trade-routes","name":"Trade Routes","branch":"commerce","era":1,"stage":2,"lane":7,"faction":null,"cost":90,"seconds":90,"requires":["currency"],"effects":{"carry":0.05},"atlas":"commerce","art_index":2,"description":"Trade Routes develops your empire’s commerce. This discovery benefits every owned city and army."}'::jsonb),
('merchant-guilds','Merchant Guilds','commerce',1,null,108,108,'["trade-routes"]'::jsonb,'{"trade":0.05}'::jsonb,'{"id":"merchant-guilds","name":"Merchant Guilds","branch":"commerce","era":1,"stage":3,"lane":7,"faction":null,"cost":108,"seconds":108,"requires":["trade-routes"],"effects":{"trade":0.05},"atlas":"commerce","art_index":3,"description":"Merchant Guilds develops your empire’s commerce. This discovery benefits every owned city and army."}'::jsonb),
('caravans','Caravans','commerce',2,null,220,240,'["merchant-guilds","libraries"]'::jsonb,'{"carry":0.08}'::jsonb,'{"id":"caravans","name":"Caravans","branch":"commerce","era":2,"stage":4,"lane":7,"faction":null,"cost":220,"seconds":240,"requires":["merchant-guilds","libraries"],"effects":{"carry":0.08},"atlas":"commerce","art_index":4,"description":"Caravans develops your empire’s commerce. This discovery benefits every owned city and army."}'::jsonb),
('counting-houses','Counting Houses','commerce',2,null,264,288,'["caravans"]'::jsonb,'{"gold":0.08}'::jsonb,'{"id":"counting-houses","name":"Counting Houses","branch":"commerce","era":2,"stage":5,"lane":7,"faction":null,"cost":264,"seconds":288,"requires":["caravans"],"effects":{"gold":0.08},"atlas":"commerce","art_index":5,"description":"Counting Houses develops your empire’s commerce. This discovery benefits every owned city and army."}'::jsonb),
('banking','Banking','commerce',3,null,500,480,'["counting-houses"]'::jsonb,'{"storage":0.08}'::jsonb,'{"id":"banking","name":"Banking","branch":"commerce","era":3,"stage":6,"lane":7,"faction":null,"cost":500,"seconds":480,"requires":["counting-houses"],"effects":{"storage":0.08},"atlas":"commerce","art_index":6,"description":"Banking develops your empire’s commerce. This discovery benefits every owned city and army."}'::jsonb),
('customs-houses','Customs Houses','commerce',3,null,600,576,'["banking"]'::jsonb,'{"trade":0.08}'::jsonb,'{"id":"customs-houses","name":"Customs Houses","branch":"commerce","era":3,"stage":7,"lane":7,"faction":null,"cost":600,"seconds":576,"requires":["banking"],"effects":{"trade":0.08},"atlas":"commerce","art_index":7,"description":"Customs Houses develops your empire’s commerce. This discovery benefits every owned city and army."}'::jsonb),
('market-charters','Market Charters','commerce',4,null,1000,850,'["customs-houses","philosophy"]'::jsonb,'{"gold":0.1}'::jsonb,'{"id":"market-charters","name":"Market Charters","branch":"commerce","era":4,"stage":8,"lane":7,"faction":null,"cost":1000,"seconds":850,"requires":["customs-houses","philosophy"],"effects":{"gold":0.1},"atlas":"commerce","art_index":8,"description":"Market Charters develops your empire’s commerce. This discovery benefits every owned city and army."}'::jsonb),
('great-exchange','Great Exchange','commerce',4,null,1200,1020,'["market-charters"]'::jsonb,'{"trade":0.1}'::jsonb,'{"id":"great-exchange","name":"Great Exchange","branch":"commerce","era":4,"stage":9,"lane":7,"faction":null,"cost":1200,"seconds":1020,"requires":["market-charters"],"effects":{"trade":0.1},"atlas":"commerce","art_index":9,"description":"Great Exchange develops your empire’s commerce. This discovery benefits every owned city and army."}'::jsonb),
('writing','Writing','knowledge',0,null,35,30,'[]'::jsonb,'{"science":0.05}'::jsonb,'{"id":"writing","name":"Writing","branch":"knowledge","era":0,"stage":0,"lane":8,"faction":null,"cost":35,"seconds":30,"requires":[],"effects":{"science":0.05},"atlas":"knowledge","art_index":0,"description":"Writing develops your empire’s knowledge. This discovery benefits every owned city and army."}'::jsonb),
('mathematics','Mathematics','knowledge',0,null,42,36,'["writing"]'::jsonb,'{"science":0.05}'::jsonb,'{"id":"mathematics","name":"Mathematics","branch":"knowledge","era":0,"stage":1,"lane":8,"faction":null,"cost":42,"seconds":36,"requires":["writing"],"effects":{"science":0.05},"atlas":"knowledge","art_index":1,"description":"Mathematics develops your empire’s knowledge. This discovery benefits every owned city and army."}'::jsonb),
('libraries','Libraries','knowledge',1,null,90,90,'["mathematics"]'::jsonb,'{"science":0.05}'::jsonb,'{"id":"libraries","name":"Libraries","branch":"knowledge","era":1,"stage":2,"lane":8,"faction":null,"cost":90,"seconds":90,"requires":["mathematics"],"effects":{"science":0.05},"atlas":"knowledge","art_index":2,"description":"Libraries develops your empire’s knowledge. This discovery benefits every owned city and army."}'::jsonb),
('scholarship','Scholarship','knowledge',1,null,108,108,'["libraries"]'::jsonb,'{"research_speed":0.05}'::jsonb,'{"id":"scholarship","name":"Scholarship","branch":"knowledge","era":1,"stage":3,"lane":8,"faction":null,"cost":108,"seconds":108,"requires":["libraries"],"effects":{"research_speed":0.05},"atlas":"knowledge","art_index":3,"description":"Scholarship develops your empire’s knowledge. This discovery benefits every owned city and army."}'::jsonb),
('astronomy','Astronomy','knowledge',2,null,220,240,'["scholarship"]'::jsonb,'{"science":0.08}'::jsonb,'{"id":"astronomy","name":"Astronomy","branch":"knowledge","era":2,"stage":4,"lane":8,"faction":null,"cost":220,"seconds":240,"requires":["scholarship"],"effects":{"science":0.08},"atlas":"knowledge","art_index":4,"description":"Astronomy develops your empire’s knowledge. This discovery benefits every owned city and army."}'::jsonb),
('observatories','Observatories','knowledge',2,null,264,288,'["astronomy"]'::jsonb,'{"research_speed":0.08}'::jsonb,'{"id":"observatories","name":"Observatories","branch":"knowledge","era":2,"stage":5,"lane":8,"faction":null,"cost":264,"seconds":288,"requires":["astronomy"],"effects":{"research_speed":0.08},"atlas":"knowledge","art_index":5,"description":"Observatories develops your empire’s knowledge. This discovery benefits every owned city and army."}'::jsonb),
('philosophy','Philosophy','knowledge',3,null,500,480,'["observatories"]'::jsonb,'{"science":0.08}'::jsonb,'{"id":"philosophy","name":"Philosophy","branch":"knowledge","era":3,"stage":6,"lane":8,"faction":null,"cost":500,"seconds":480,"requires":["observatories"],"effects":{"science":0.08},"atlas":"knowledge","art_index":6,"description":"Philosophy develops your empire’s knowledge. This discovery benefits every owned city and army."}'::jsonb),
('paper-making','Paper Making','knowledge',3,null,600,576,'["philosophy"]'::jsonb,'{"science":0.08}'::jsonb,'{"id":"paper-making","name":"Paper Making","branch":"knowledge","era":3,"stage":7,"lane":8,"faction":null,"cost":600,"seconds":576,"requires":["philosophy"],"effects":{"science":0.08},"atlas":"knowledge","art_index":7,"description":"Paper Making develops your empire’s knowledge. This discovery benefits every owned city and army."}'::jsonb),
('universities','Universities','knowledge',4,null,1000,850,'["paper-making"]'::jsonb,'{"research_speed":0.1}'::jsonb,'{"id":"universities","name":"Universities","branch":"knowledge","era":4,"stage":8,"lane":8,"faction":null,"cost":1000,"seconds":850,"requires":["paper-making"],"effects":{"research_speed":0.1},"atlas":"knowledge","art_index":8,"description":"Universities develops your empire’s knowledge. This discovery benefits every owned city and army."}'::jsonb),
('enlightenment','Enlightenment','knowledge',4,null,1200,1020,'["universities"]'::jsonb,'{"science":0.1}'::jsonb,'{"id":"enlightenment","name":"Enlightenment","branch":"knowledge","era":4,"stage":9,"lane":8,"faction":null,"cost":1200,"seconds":1020,"requires":["universities"],"effects":{"science":0.1},"atlas":"knowledge","art_index":9,"description":"Enlightenment develops your empire’s knowledge. This discovery benefits every owned city and army."}'::jsonb),
('command','Command','leadership',0,null,35,30,'[]'::jsonb,'{"attack":0.05}'::jsonb,'{"id":"command","name":"Command","branch":"leadership","era":0,"stage":0,"lane":9,"faction":null,"cost":35,"seconds":30,"requires":[],"effects":{"attack":0.05},"atlas":"leadership","art_index":0,"description":"Command develops your empire’s leadership. This discovery benefits every owned city and army."}'::jsonb),
('logistics','Logistics','leadership',0,null,42,36,'["command"]'::jsonb,'{"carry":0.05}'::jsonb,'{"id":"logistics","name":"Logistics","branch":"leadership","era":0,"stage":1,"lane":9,"faction":null,"cost":42,"seconds":36,"requires":["command"],"effects":{"carry":0.05},"atlas":"leadership","art_index":1,"description":"Logistics develops your empire’s leadership. This discovery benefits every owned city and army."}'::jsonb),
('diplomacy','Diplomacy','leadership',1,null,90,90,'["logistics"]'::jsonb,'{"culture":0.05,"unlock_diplomat":1}'::jsonb,'{"id":"diplomacy","name":"Diplomacy","branch":"leadership","era":1,"stage":2,"lane":9,"faction":null,"cost":90,"seconds":90,"requires":["logistics"],"effects":{"culture":0.05,"unlock_diplomat":1},"atlas":"leadership","art_index":2,"description":"Diplomacy develops your empire’s leadership. This discovery benefits every owned city and army. Unlocks diplomats, trained in the Main building to persuade enemy cities."}'::jsonb),
('war-council','War Council','leadership',1,null,108,108,'["diplomacy"]'::jsonb,'{"defence":0.05}'::jsonb,'{"id":"war-council","name":"War Council","branch":"leadership","era":1,"stage":3,"lane":9,"faction":null,"cost":108,"seconds":108,"requires":["diplomacy"],"effects":{"defence":0.05},"atlas":"leadership","art_index":3,"description":"War Council develops your empire’s leadership. This discovery benefits every owned city and army."}'::jsonb),
('heroic-deeds','Heroic Deeds','leadership',2,null,220,240,'["war-council","libraries"]'::jsonb,'{"hero_xp":0.08}'::jsonb,'{"id":"heroic-deeds","name":"Heroic Deeds","branch":"leadership","era":2,"stage":4,"lane":9,"faction":null,"cost":220,"seconds":240,"requires":["war-council","libraries"],"effects":{"hero_xp":0.08},"atlas":"leadership","art_index":4,"description":"Heroic Deeds develops your empire’s leadership. This discovery benefits every owned city and army."}'::jsonb),
('strategy','Strategy','leadership',2,null,264,288,'["heroic-deeds"]'::jsonb,'{"march":0.08}'::jsonb,'{"id":"strategy","name":"Strategy","branch":"leadership","era":2,"stage":5,"lane":9,"faction":null,"cost":264,"seconds":288,"requires":["heroic-deeds"],"effects":{"march":0.08},"atlas":"leadership","art_index":5,"description":"Strategy develops your empire’s leadership. This discovery benefits every owned city and army."}'::jsonb),
('chronicles','Chronicles','leadership',3,null,500,480,'["strategy"]'::jsonb,'{"culture":0.08}'::jsonb,'{"id":"chronicles","name":"Chronicles","branch":"leadership","era":3,"stage":6,"lane":9,"faction":null,"cost":500,"seconds":480,"requires":["strategy"],"effects":{"culture":0.08},"atlas":"leadership","art_index":6,"description":"Chronicles develops your empire’s leadership. This discovery benefits every owned city and army."}'::jsonb),
('arcane-command','Arcane Command','leadership',3,null,600,576,'["chronicles"]'::jsonb,'{"spell_power":0.08}'::jsonb,'{"id":"arcane-command","name":"Arcane Command","branch":"leadership","era":3,"stage":7,"lane":9,"faction":null,"cost":600,"seconds":576,"requires":["chronicles"],"effects":{"spell_power":0.08},"atlas":"leadership","art_index":7,"description":"Arcane Command develops your empire’s leadership. This discovery benefits every owned city and army."}'::jsonb),
('imperial-governance','Imperial Governance','leadership',4,null,1000,850,'["arcane-command","philosophy"]'::jsonb,'{"mana":0.1}'::jsonb,'{"id":"imperial-governance","name":"Imperial Governance","branch":"leadership","era":4,"stage":8,"lane":9,"faction":null,"cost":1000,"seconds":850,"requires":["arcane-command","philosophy"],"effects":{"mana":0.1},"atlas":"leadership","art_index":8,"description":"Imperial Governance develops your empire’s leadership. This discovery benefits every owned city and army."}'::jsonb),
('legendary-command','Legendary Command','leadership',4,null,1200,1020,'["imperial-governance"]'::jsonb,'{"hero_xp":0.1}'::jsonb,'{"id":"legendary-command","name":"Legendary Command","branch":"leadership","era":4,"stage":9,"lane":9,"faction":null,"cost":1200,"seconds":1020,"requires":["imperial-governance"],"effects":{"hero_xp":0.1},"atlas":"leadership","art_index":9,"description":"Legendary Command develops your empire’s leadership. This discovery benefits every owned city and army."}'::jsonb),
('roman-legion-discipline','Legion Discipline','heritage',0,'roman',40,34,'["writing"]'::jsonb,'{"infantry_attack":0.08}'::jsonb,'{"id":"roman-legion-discipline","name":"Legion Discipline","branch":"heritage","era":0,"stage":0,"lane":10,"faction":"roman","cost":40,"seconds":34,"requires":["writing"],"effects":{"infantry_attack":0.08},"atlas":"roman","art_index":0,"description":"A roman tradition that strengthens the whole account. Heritage bonuses apply while this is your account faction."}'::jsonb),
('roman-testudo','Testudo','heritage',0,'roman',48,41,'["roman-legion-discipline"]'::jsonb,'{"infantry_defence":0.08}'::jsonb,'{"id":"roman-testudo","name":"Testudo","branch":"heritage","era":0,"stage":1,"lane":10,"faction":"roman","cost":48,"seconds":41,"requires":["roman-legion-discipline"],"effects":{"infantry_defence":0.08},"atlas":"roman","art_index":1,"description":"A roman tradition that strengthens the whole account. Heritage bonuses apply while this is your account faction."}'::jsonb),
('roman-roman-roads','Roman Roads','heritage',1,'roman',103,103,'["roman-testudo"]'::jsonb,'{"march":0.08}'::jsonb,'{"id":"roman-roman-roads","name":"Roman Roads","branch":"heritage","era":1,"stage":2,"lane":10,"faction":"roman","cost":103,"seconds":103,"requires":["roman-testudo"],"effects":{"march":0.08},"atlas":"roman","art_index":2,"description":"A roman tradition that strengthens the whole account. Heritage bonuses apply while this is your account faction."}'::jsonb),
('roman-aqueducts','Aqueducts','heritage',1,'roman',124,124,'["roman-roman-roads"]'::jsonb,'{"food":0.08}'::jsonb,'{"id":"roman-aqueducts","name":"Aqueducts","branch":"heritage","era":1,"stage":3,"lane":10,"faction":"roman","cost":124,"seconds":124,"requires":["roman-roman-roads"],"effects":{"food":0.08},"atlas":"roman","art_index":3,"description":"A roman tradition that strengthens the whole account. Heritage bonuses apply while this is your account faction."}'::jsonb),
('roman-imperial-census','Imperial Census','heritage',2,'roman',253,276,'["roman-aqueducts","libraries"]'::jsonb,'{"gold":0.08}'::jsonb,'{"id":"roman-imperial-census","name":"Imperial Census","branch":"heritage","era":2,"stage":4,"lane":10,"faction":"roman","cost":253,"seconds":276,"requires":["roman-aqueducts","libraries"],"effects":{"gold":0.08},"atlas":"roman","art_index":4,"description":"A roman tradition that strengthens the whole account. Heritage bonuses apply while this is your account faction."}'::jsonb),
('roman-military-engineering','Military Engineering','heritage',2,'roman',304,331,'["roman-imperial-census"]'::jsonb,'{"construction":0.08}'::jsonb,'{"id":"roman-military-engineering","name":"Military Engineering","branch":"heritage","era":2,"stage":5,"lane":10,"faction":"roman","cost":304,"seconds":331,"requires":["roman-imperial-census"],"effects":{"construction":0.08},"atlas":"roman","art_index":5,"description":"A roman tradition that strengthens the whole account. Heritage bonuses apply while this is your account faction."}'::jsonb),
('roman-forum-trade','Forum Trade','heritage',3,'roman',575,552,'["roman-military-engineering"]'::jsonb,'{"trade":0.12}'::jsonb,'{"id":"roman-forum-trade","name":"Forum Trade","branch":"heritage","era":3,"stage":6,"lane":10,"faction":"roman","cost":575,"seconds":552,"requires":["roman-military-engineering"],"effects":{"trade":0.12},"atlas":"roman","art_index":6,"description":"A roman tradition that strengthens the whole account. Heritage bonuses apply while this is your account faction."}'::jsonb),
('roman-latin-scholarship','Latin Scholarship','heritage',3,'roman',690,662,'["roman-forum-trade"]'::jsonb,'{"science":0.12}'::jsonb,'{"id":"roman-latin-scholarship","name":"Latin Scholarship","branch":"heritage","era":3,"stage":7,"lane":10,"faction":"roman","cost":690,"seconds":662,"requires":["roman-forum-trade"],"effects":{"science":0.12},"atlas":"roman","art_index":7,"description":"A roman tradition that strengthens the whole account. Heritage bonuses apply while this is your account faction."}'::jsonb),
('roman-praetorian-training','Praetorian Training','heritage',4,'roman',1150,977,'["roman-latin-scholarship","philosophy"]'::jsonb,'{"training":0.12}'::jsonb,'{"id":"roman-praetorian-training","name":"Praetorian Training","branch":"heritage","era":4,"stage":8,"lane":10,"faction":"roman","cost":1150,"seconds":977,"requires":["roman-latin-scholarship","philosophy"],"effects":{"training":0.12},"atlas":"roman","art_index":8,"description":"A roman tradition that strengthens the whole account. Heritage bonuses apply while this is your account faction."}'::jsonb),
('roman-pax-imperium','Pax Imperium','heritage',4,'roman',1380,1173,'["roman-praetorian-training"]'::jsonb,'{"culture":0.12}'::jsonb,'{"id":"roman-pax-imperium","name":"Pax Imperium","branch":"heritage","era":4,"stage":9,"lane":10,"faction":"roman","cost":1380,"seconds":1173,"requires":["roman-praetorian-training"],"effects":{"culture":0.12},"atlas":"roman","art_index":9,"description":"A roman tradition that strengthens the whole account. Heritage bonuses apply while this is your account faction."}'::jsonb),
('spartan-agoge','Agoge','heritage',0,'spartan',40,34,'["writing"]'::jsonb,'{"training":0.08}'::jsonb,'{"id":"spartan-agoge","name":"Agoge","branch":"heritage","era":0,"stage":0,"lane":10,"faction":"spartan","cost":40,"seconds":34,"requires":["writing"],"effects":{"training":0.08},"atlas":"spartan","art_index":0,"description":"A spartan tradition that strengthens the whole account. Heritage bonuses apply while this is your account faction."}'::jsonb),
('spartan-phalanx','Phalanx','heritage',0,'spartan',48,41,'["spartan-agoge"]'::jsonb,'{"infantry_defence":0.08}'::jsonb,'{"id":"spartan-phalanx","name":"Phalanx","branch":"heritage","era":0,"stage":1,"lane":10,"faction":"spartan","cost":48,"seconds":41,"requires":["spartan-agoge"],"effects":{"infantry_defence":0.08},"atlas":"spartan","art_index":1,"description":"A spartan tradition that strengthens the whole account. Heritage bonuses apply while this is your account faction."}'::jsonb),
('spartan-bronze-hoplites','Bronze Hoplites','heritage',1,'spartan',103,103,'["spartan-phalanx"]'::jsonb,'{"infantry_attack":0.08}'::jsonb,'{"id":"spartan-bronze-hoplites","name":"Bronze Hoplites","branch":"heritage","era":1,"stage":2,"lane":10,"faction":"spartan","cost":103,"seconds":103,"requires":["spartan-phalanx"],"effects":{"infantry_attack":0.08},"atlas":"spartan","art_index":2,"description":"A spartan tradition that strengthens the whole account. Heritage bonuses apply while this is your account faction."}'::jsonb),
('spartan-laconic-orders','Laconic Orders','heritage',1,'spartan',124,124,'["spartan-bronze-hoplites"]'::jsonb,'{"march":0.08}'::jsonb,'{"id":"spartan-laconic-orders","name":"Laconic Orders","branch":"heritage","era":1,"stage":3,"lane":10,"faction":"spartan","cost":124,"seconds":124,"requires":["spartan-bronze-hoplites"],"effects":{"march":0.08},"atlas":"spartan","art_index":3,"description":"A spartan tradition that strengthens the whole account. Heritage bonuses apply while this is your account faction."}'::jsonb),
('spartan-shield-wall','Shield Wall','heritage',2,'spartan',253,276,'["spartan-laconic-orders","libraries"]'::jsonb,'{"defence":0.08}'::jsonb,'{"id":"spartan-shield-wall","name":"Shield Wall","branch":"heritage","era":2,"stage":4,"lane":10,"faction":"spartan","cost":253,"seconds":276,"requires":["spartan-laconic-orders","libraries"],"effects":{"defence":0.08},"atlas":"spartan","art_index":4,"description":"A spartan tradition that strengthens the whole account. Heritage bonuses apply while this is your account faction."}'::jsonb),
('spartan-warrior-houses','Warrior Houses','heritage',2,'spartan',304,331,'["spartan-shield-wall"]'::jsonb,'{"food":0.08}'::jsonb,'{"id":"spartan-warrior-houses","name":"Warrior Houses","branch":"heritage","era":2,"stage":5,"lane":10,"faction":"spartan","cost":304,"seconds":331,"requires":["spartan-shield-wall"],"effects":{"food":0.08},"atlas":"spartan","art_index":5,"description":"A spartan tradition that strengthens the whole account. Heritage bonuses apply while this is your account faction."}'::jsonb),
('spartan-battle-oaths','Battle Oaths','heritage',3,'spartan',575,552,'["spartan-warrior-houses"]'::jsonb,'{"attack":0.12}'::jsonb,'{"id":"spartan-battle-oaths","name":"Battle Oaths","branch":"heritage","era":3,"stage":6,"lane":10,"faction":"spartan","cost":575,"seconds":552,"requires":["spartan-warrior-houses"],"effects":{"attack":0.12},"atlas":"spartan","art_index":6,"description":"A spartan tradition that strengthens the whole account. Heritage bonuses apply while this is your account faction."}'::jsonb),
('spartan-iron-discipline','Iron Discipline','heritage',3,'spartan',690,662,'["spartan-battle-oaths"]'::jsonb,'{"training":0.12}'::jsonb,'{"id":"spartan-iron-discipline","name":"Iron Discipline","branch":"heritage","era":3,"stage":7,"lane":10,"faction":"spartan","cost":690,"seconds":662,"requires":["spartan-battle-oaths"],"effects":{"training":0.12},"atlas":"spartan","art_index":7,"description":"A spartan tradition that strengthens the whole account. Heritage bonuses apply while this is your account faction."}'::jsonb),
('spartan-royal-guard','Royal Guard','heritage',4,'spartan',1150,977,'["spartan-iron-discipline","philosophy"]'::jsonb,'{"infantry_defence":0.12}'::jsonb,'{"id":"spartan-royal-guard","name":"Royal Guard","branch":"heritage","era":4,"stage":8,"lane":10,"faction":"spartan","cost":1150,"seconds":977,"requires":["spartan-iron-discipline","philosophy"],"effects":{"infantry_defence":0.12},"atlas":"spartan","art_index":8,"description":"A spartan tradition that strengthens the whole account. Heritage bonuses apply while this is your account faction."}'::jsonb),
('spartan-spartan-legend','Spartan Legend','heritage',4,'spartan',1380,1173,'["spartan-royal-guard"]'::jsonb,'{"hero_xp":0.12}'::jsonb,'{"id":"spartan-spartan-legend","name":"Spartan Legend","branch":"heritage","era":4,"stage":9,"lane":10,"faction":"spartan","cost":1380,"seconds":1173,"requires":["spartan-royal-guard"],"effects":{"hero_xp":0.12},"atlas":"spartan","art_index":9,"description":"A spartan tradition that strengthens the whole account. Heritage bonuses apply while this is your account faction."}'::jsonb),
('persian-royal-roads','Royal Roads','heritage',0,'persian',40,34,'["writing"]'::jsonb,'{"march":0.08}'::jsonb,'{"id":"persian-royal-roads","name":"Royal Roads","branch":"heritage","era":0,"stage":0,"lane":10,"faction":"persian","cost":40,"seconds":34,"requires":["writing"],"effects":{"march":0.08},"atlas":"persian","art_index":0,"description":"A persian tradition that strengthens the whole account. Heritage bonuses apply while this is your account faction."}'::jsonb),
('persian-qanat-irrigation','Qanat Irrigation','heritage',0,'persian',48,41,'["persian-royal-roads"]'::jsonb,'{"food":0.08}'::jsonb,'{"id":"persian-qanat-irrigation","name":"Qanat Irrigation","branch":"heritage","era":0,"stage":1,"lane":10,"faction":"persian","cost":48,"seconds":41,"requires":["persian-royal-roads"],"effects":{"food":0.08},"atlas":"persian","art_index":1,"description":"A persian tradition that strengthens the whole account. Heritage bonuses apply while this is your account faction."}'::jsonb),
('persian-immortal-guard','Immortal Guard','heritage',1,'persian',103,103,'["persian-qanat-irrigation"]'::jsonb,'{"infantry_attack":0.08}'::jsonb,'{"id":"persian-immortal-guard","name":"Immortal Guard","branch":"heritage","era":1,"stage":2,"lane":10,"faction":"persian","cost":103,"seconds":103,"requires":["persian-qanat-irrigation"],"effects":{"infantry_attack":0.08},"atlas":"persian","art_index":2,"description":"A persian tradition that strengthens the whole account. Heritage bonuses apply while this is your account faction."}'::jsonb),
('persian-silk-caravans','Silk Caravans','heritage',1,'persian',124,124,'["persian-immortal-guard"]'::jsonb,'{"trade":0.08}'::jsonb,'{"id":"persian-silk-caravans","name":"Silk Caravans","branch":"heritage","era":1,"stage":3,"lane":10,"faction":"persian","cost":124,"seconds":124,"requires":["persian-immortal-guard"],"effects":{"trade":0.08},"atlas":"persian","art_index":3,"description":"A persian tradition that strengthens the whole account. Heritage bonuses apply while this is your account faction."}'::jsonb),
('persian-horse-archery','Horse Archery','heritage',2,'persian',253,276,'["persian-silk-caravans","libraries"]'::jsonb,'{"archers_attack":0.08}'::jsonb,'{"id":"persian-horse-archery","name":"Horse Archery","branch":"heritage","era":2,"stage":4,"lane":10,"faction":"persian","cost":253,"seconds":276,"requires":["persian-silk-caravans","libraries"],"effects":{"archers_attack":0.08},"atlas":"persian","art_index":4,"description":"A persian tradition that strengthens the whole account. Heritage bonuses apply while this is your account faction."}'::jsonb),
('persian-court-scholars','Court Scholars','heritage',2,'persian',304,331,'["persian-horse-archery"]'::jsonb,'{"science":0.08}'::jsonb,'{"id":"persian-court-scholars","name":"Court Scholars","branch":"heritage","era":2,"stage":5,"lane":10,"faction":"persian","cost":304,"seconds":331,"requires":["persian-horse-archery"],"effects":{"science":0.08},"atlas":"persian","art_index":5,"description":"A persian tradition that strengthens the whole account. Heritage bonuses apply while this is your account faction."}'::jsonb),
('persian-gardens-of-knowledge','Gardens of Knowledge','heritage',3,'persian',575,552,'["persian-court-scholars"]'::jsonb,'{"research_speed":0.12}'::jsonb,'{"id":"persian-gardens-of-knowledge","name":"Gardens of Knowledge","branch":"heritage","era":3,"stage":6,"lane":10,"faction":"persian","cost":575,"seconds":552,"requires":["persian-court-scholars"],"effects":{"research_speed":0.12},"atlas":"persian","art_index":6,"description":"A persian tradition that strengthens the whole account. Heritage bonuses apply while this is your account faction."}'::jsonb),
('persian-cataphract-armour','Cataphract Armour','heritage',3,'persian',690,662,'["persian-gardens-of-knowledge"]'::jsonb,'{"cavalry_defence":0.12}'::jsonb,'{"id":"persian-cataphract-armour","name":"Cataphract Armour","branch":"heritage","era":3,"stage":7,"lane":10,"faction":"persian","cost":690,"seconds":662,"requires":["persian-gardens-of-knowledge"],"effects":{"cavalry_defence":0.12},"atlas":"persian","art_index":7,"description":"A persian tradition that strengthens the whole account. Heritage bonuses apply while this is your account faction."}'::jsonb),
('persian-satrapal-estates','Satrapal Estates','heritage',4,'persian',1150,977,'["persian-cataphract-armour","philosophy"]'::jsonb,'{"gold":0.12}'::jsonb,'{"id":"persian-satrapal-estates","name":"Satrapal Estates","branch":"heritage","era":4,"stage":8,"lane":10,"faction":"persian","cost":1150,"seconds":977,"requires":["persian-cataphract-armour","philosophy"],"effects":{"gold":0.12},"atlas":"persian","art_index":8,"description":"A persian tradition that strengthens the whole account. Heritage bonuses apply while this is your account faction."}'::jsonb),
('persian-king-of-kings','King of Kings','heritage',4,'persian',1380,1173,'["persian-satrapal-estates"]'::jsonb,'{"culture":0.12}'::jsonb,'{"id":"persian-king-of-kings","name":"King of Kings","branch":"heritage","era":4,"stage":9,"lane":10,"faction":"persian","cost":1380,"seconds":1173,"requires":["persian-satrapal-estates"],"effects":{"culture":0.12},"atlas":"persian","art_index":9,"description":"A persian tradition that strengthens the whole account. Heritage bonuses apply while this is your account faction."}'::jsonb),
('egyptian-nile-irrigation','Nile Irrigation','heritage',0,'egyptian',40,34,'["writing"]'::jsonb,'{"food":0.08}'::jsonb,'{"id":"egyptian-nile-irrigation","name":"Nile Irrigation","branch":"heritage","era":0,"stage":0,"lane":10,"faction":"egyptian","cost":40,"seconds":34,"requires":["writing"],"effects":{"food":0.08},"atlas":"egyptian","art_index":0,"description":"A egyptian tradition that strengthens the whole account. Heritage bonuses apply while this is your account faction."}'::jsonb),
('egyptian-papyrus','Papyrus','heritage',0,'egyptian',48,41,'["egyptian-nile-irrigation"]'::jsonb,'{"science":0.08}'::jsonb,'{"id":"egyptian-papyrus","name":"Papyrus","branch":"heritage","era":0,"stage":1,"lane":10,"faction":"egyptian","cost":48,"seconds":41,"requires":["egyptian-nile-irrigation"],"effects":{"science":0.08},"atlas":"egyptian","art_index":1,"description":"A egyptian tradition that strengthens the whole account. Heritage bonuses apply while this is your account faction."}'::jsonb),
('egyptian-granary-scribes','Granary Scribes','heritage',1,'egyptian',103,103,'["egyptian-papyrus"]'::jsonb,'{"storage":0.08}'::jsonb,'{"id":"egyptian-granary-scribes","name":"Granary Scribes","branch":"heritage","era":1,"stage":2,"lane":10,"faction":"egyptian","cost":103,"seconds":103,"requires":["egyptian-papyrus"],"effects":{"storage":0.08},"atlas":"egyptian","art_index":2,"description":"A egyptian tradition that strengthens the whole account. Heritage bonuses apply while this is your account faction."}'::jsonb),
('egyptian-desert-scouts','Desert Scouts','heritage',1,'egyptian',124,124,'["egyptian-granary-scribes"]'::jsonb,'{"march":0.08}'::jsonb,'{"id":"egyptian-desert-scouts","name":"Desert Scouts","branch":"heritage","era":1,"stage":3,"lane":10,"faction":"egyptian","cost":124,"seconds":124,"requires":["egyptian-granary-scribes"],"effects":{"march":0.08},"atlas":"egyptian","art_index":3,"description":"A egyptian tradition that strengthens the whole account. Heritage bonuses apply while this is your account faction."}'::jsonb),
('egyptian-stone-obelisks','Stone Obelisks','heritage',2,'egyptian',253,276,'["egyptian-desert-scouts","libraries"]'::jsonb,'{"stone":0.08}'::jsonb,'{"id":"egyptian-stone-obelisks","name":"Stone Obelisks","branch":"heritage","era":2,"stage":4,"lane":10,"faction":"egyptian","cost":253,"seconds":276,"requires":["egyptian-desert-scouts","libraries"],"effects":{"stone":0.08},"atlas":"egyptian","art_index":4,"description":"A egyptian tradition that strengthens the whole account. Heritage bonuses apply while this is your account faction."}'::jsonb),
('egyptian-solar-temples','Solar Temples','heritage',2,'egyptian',304,331,'["egyptian-stone-obelisks"]'::jsonb,'{"culture":0.08}'::jsonb,'{"id":"egyptian-solar-temples","name":"Solar Temples","branch":"heritage","era":2,"stage":5,"lane":10,"faction":"egyptian","cost":304,"seconds":331,"requires":["egyptian-stone-obelisks"],"effects":{"culture":0.08},"atlas":"egyptian","art_index":5,"description":"A egyptian tradition that strengthens the whole account. Heritage bonuses apply while this is your account faction."}'::jsonb),
('egyptian-chariot-tactics','Chariot Tactics','heritage',3,'egyptian',575,552,'["egyptian-solar-temples"]'::jsonb,'{"cavalry_attack":0.12}'::jsonb,'{"id":"egyptian-chariot-tactics","name":"Chariot Tactics","branch":"heritage","era":3,"stage":6,"lane":10,"faction":"egyptian","cost":575,"seconds":552,"requires":["egyptian-solar-temples"],"effects":{"cavalry_attack":0.12},"atlas":"egyptian","art_index":6,"description":"A egyptian tradition that strengthens the whole account. Heritage bonuses apply while this is your account faction."}'::jsonb),
('egyptian-pyramid-engineering','Pyramid Engineering','heritage',3,'egyptian',690,662,'["egyptian-chariot-tactics"]'::jsonb,'{"construction":0.12}'::jsonb,'{"id":"egyptian-pyramid-engineering","name":"Pyramid Engineering","branch":"heritage","era":3,"stage":7,"lane":10,"faction":"egyptian","cost":690,"seconds":662,"requires":["egyptian-chariot-tactics"],"effects":{"construction":0.12},"atlas":"egyptian","art_index":7,"description":"A egyptian tradition that strengthens the whole account. Heritage bonuses apply while this is your account faction."}'::jsonb),
('egyptian-royal-necropolis','Royal Necropolis','heritage',4,'egyptian',1150,977,'["egyptian-pyramid-engineering","philosophy"]'::jsonb,'{"mana":0.12}'::jsonb,'{"id":"egyptian-royal-necropolis","name":"Royal Necropolis","branch":"heritage","era":4,"stage":8,"lane":10,"faction":"egyptian","cost":1150,"seconds":977,"requires":["egyptian-pyramid-engineering","philosophy"],"effects":{"mana":0.12},"atlas":"egyptian","art_index":8,"description":"A egyptian tradition that strengthens the whole account. Heritage bonuses apply while this is your account faction."}'::jsonb),
('egyptian-pharaonic-legacy','Pharaonic Legacy','heritage',4,'egyptian',1380,1173,'["egyptian-royal-necropolis"]'::jsonb,'{"hero_xp":0.12}'::jsonb,'{"id":"egyptian-pharaonic-legacy","name":"Pharaonic Legacy","branch":"heritage","era":4,"stage":9,"lane":10,"faction":"egyptian","cost":1380,"seconds":1173,"requires":["egyptian-royal-necropolis"],"effects":{"hero_xp":0.12},"atlas":"egyptian","art_index":9,"description":"A egyptian tradition that strengthens the whole account. Heritage bonuses apply while this is your account faction."}'::jsonb),
('orc-war-drums','War Drums','heritage',0,'orc',40,34,'["writing"]'::jsonb,'{"training":0.08}'::jsonb,'{"id":"orc-war-drums","name":"War Drums","branch":"heritage","era":0,"stage":0,"lane":10,"faction":"orc","cost":40,"seconds":34,"requires":["writing"],"effects":{"training":0.08},"atlas":"orc","art_index":0,"description":"A orc tradition that strengthens the whole account. Heritage bonuses apply while this is your account faction."}'::jsonb),
('orc-iron-tusks','Iron Tusks','heritage',0,'orc',48,41,'["orc-war-drums"]'::jsonb,'{"infantry_attack":0.08}'::jsonb,'{"id":"orc-iron-tusks","name":"Iron Tusks","branch":"heritage","era":0,"stage":1,"lane":10,"faction":"orc","cost":48,"seconds":41,"requires":["orc-war-drums"],"effects":{"infantry_attack":0.08},"atlas":"orc","art_index":1,"description":"A orc tradition that strengthens the whole account. Heritage bonuses apply while this is your account faction."}'::jsonb),
('orc-raider-packs','Raider Packs','heritage',1,'orc',103,103,'["orc-iron-tusks"]'::jsonb,'{"carry":0.08}'::jsonb,'{"id":"orc-raider-packs","name":"Raider Packs","branch":"heritage","era":1,"stage":2,"lane":10,"faction":"orc","cost":103,"seconds":103,"requires":["orc-iron-tusks"],"effects":{"carry":0.08},"atlas":"orc","art_index":2,"description":"A orc tradition that strengthens the whole account. Heritage bonuses apply while this is your account faction."}'::jsonb),
('orc-bone-armour','Bone Armour','heritage',1,'orc',124,124,'["orc-raider-packs"]'::jsonb,'{"defence":0.08}'::jsonb,'{"id":"orc-bone-armour","name":"Bone Armour","branch":"heritage","era":1,"stage":3,"lane":10,"faction":"orc","cost":124,"seconds":124,"requires":["orc-raider-packs"],"effects":{"defence":0.08},"atlas":"orc","art_index":3,"description":"A orc tradition that strengthens the whole account. Heritage bonuses apply while this is your account faction."}'::jsonb),
('orc-warg-riders','Warg Riders','heritage',2,'orc',253,276,'["orc-bone-armour","libraries"]'::jsonb,'{"cavalry_attack":0.08}'::jsonb,'{"id":"orc-warg-riders","name":"Warg Riders","branch":"heritage","era":2,"stage":4,"lane":10,"faction":"orc","cost":253,"seconds":276,"requires":["orc-bone-armour","libraries"],"effects":{"cavalry_attack":0.08},"atlas":"orc","art_index":4,"description":"A orc tradition that strengthens the whole account. Heritage bonuses apply while this is your account faction."}'::jsonb),
('orc-spoils-of-war','Spoils of War','heritage',2,'orc',304,331,'["orc-warg-riders"]'::jsonb,'{"gold":0.08}'::jsonb,'{"id":"orc-spoils-of-war","name":"Spoils of War","branch":"heritage","era":2,"stage":5,"lane":10,"faction":"orc","cost":304,"seconds":331,"requires":["orc-warg-riders"],"effects":{"gold":0.08},"atlas":"orc","art_index":5,"description":"A orc tradition that strengthens the whole account. Heritage bonuses apply while this is your account faction."}'::jsonb),
('orc-shaman-lore','Shaman Lore','heritage',3,'orc',575,552,'["orc-spoils-of-war"]'::jsonb,'{"spell_power":0.12}'::jsonb,'{"id":"orc-shaman-lore","name":"Shaman Lore","branch":"heritage","era":3,"stage":6,"lane":10,"faction":"orc","cost":575,"seconds":552,"requires":["orc-spoils-of-war"],"effects":{"spell_power":0.12},"atlas":"orc","art_index":6,"description":"A orc tradition that strengthens the whole account. Heritage bonuses apply while this is your account faction."}'::jsonb),
('orc-brutal-siege','Brutal Siege','heritage',3,'orc',690,662,'["orc-shaman-lore"]'::jsonb,'{"siege":0.12}'::jsonb,'{"id":"orc-brutal-siege","name":"Brutal Siege","branch":"heritage","era":3,"stage":7,"lane":10,"faction":"orc","cost":690,"seconds":662,"requires":["orc-shaman-lore"],"effects":{"siege":0.12},"atlas":"orc","art_index":7,"description":"A orc tradition that strengthens the whole account. Heritage bonuses apply while this is your account faction."}'::jsonb),
('orc-clan-forging','Clan Forging','heritage',4,'orc',1150,977,'["orc-brutal-siege","philosophy"]'::jsonb,'{"construction":0.12}'::jsonb,'{"id":"orc-clan-forging","name":"Clan Forging","branch":"heritage","era":4,"stage":8,"lane":10,"faction":"orc","cost":1150,"seconds":977,"requires":["orc-brutal-siege","philosophy"],"effects":{"construction":0.12},"atlas":"orc","art_index":8,"description":"A orc tradition that strengthens the whole account. Heritage bonuses apply while this is your account faction."}'::jsonb),
('orc-warchief-legacy','Warchief Legacy','heritage',4,'orc',1380,1173,'["orc-clan-forging"]'::jsonb,'{"attack":0.12}'::jsonb,'{"id":"orc-warchief-legacy","name":"Warchief Legacy","branch":"heritage","era":4,"stage":9,"lane":10,"faction":"orc","cost":1380,"seconds":1173,"requires":["orc-clan-forging"],"effects":{"attack":0.12},"atlas":"orc","art_index":9,"description":"A orc tradition that strengthens the whole account. Heritage bonuses apply while this is your account faction."}'::jsonb),
('elf-living-groves','Living Groves','heritage',0,'elf',40,34,'["writing"]'::jsonb,'{"wood":0.08}'::jsonb,'{"id":"elf-living-groves","name":"Living Groves","branch":"heritage","era":0,"stage":0,"lane":10,"faction":"elf","cost":40,"seconds":34,"requires":["writing"],"effects":{"wood":0.08},"atlas":"elf","art_index":0,"description":"A elf tradition that strengthens the whole account. Heritage bonuses apply while this is your account faction."}'::jsonb),
('elf-moon-arrows','Moon Arrows','heritage',0,'elf',48,41,'["elf-living-groves"]'::jsonb,'{"archers_attack":0.08}'::jsonb,'{"id":"elf-moon-arrows","name":"Moon Arrows","branch":"heritage","era":0,"stage":1,"lane":10,"faction":"elf","cost":48,"seconds":41,"requires":["elf-living-groves"],"effects":{"archers_attack":0.08},"atlas":"elf","art_index":1,"description":"A elf tradition that strengthens the whole account. Heritage bonuses apply while this is your account faction."}'::jsonb),
('elf-silver-bark','Silver Bark','heritage',1,'elf',103,103,'["elf-moon-arrows"]'::jsonb,'{"defence":0.08}'::jsonb,'{"id":"elf-silver-bark","name":"Silver Bark","branch":"heritage","era":1,"stage":2,"lane":10,"faction":"elf","cost":103,"seconds":103,"requires":["elf-moon-arrows"],"effects":{"defence":0.08},"atlas":"elf","art_index":2,"description":"A elf tradition that strengthens the whole account. Heritage bonuses apply while this is your account faction."}'::jsonb),
('elf-stag-riders','Stag Riders','heritage',1,'elf',124,124,'["elf-silver-bark"]'::jsonb,'{"cavalry_defence":0.08}'::jsonb,'{"id":"elf-stag-riders","name":"Stag Riders","branch":"heritage","era":1,"stage":3,"lane":10,"faction":"elf","cost":124,"seconds":124,"requires":["elf-silver-bark"],"effects":{"cavalry_defence":0.08},"atlas":"elf","art_index":3,"description":"A elf tradition that strengthens the whole account. Heritage bonuses apply while this is your account faction."}'::jsonb),
('elf-forest-wardens','Forest Wardens','heritage',2,'elf',253,276,'["elf-stag-riders","libraries"]'::jsonb,'{"march":0.08}'::jsonb,'{"id":"elf-forest-wardens","name":"Forest Wardens","branch":"heritage","era":2,"stage":4,"lane":10,"faction":"elf","cost":253,"seconds":276,"requires":["elf-stag-riders","libraries"],"effects":{"march":0.08},"atlas":"elf","art_index":4,"description":"A elf tradition that strengthens the whole account. Heritage bonuses apply while this is your account faction."}'::jsonb),
('elf-crystal-lore','Crystal Lore','heritage',2,'elf',304,331,'["elf-forest-wardens"]'::jsonb,'{"science":0.08}'::jsonb,'{"id":"elf-crystal-lore","name":"Crystal Lore","branch":"heritage","era":2,"stage":5,"lane":10,"faction":"elf","cost":304,"seconds":331,"requires":["elf-forest-wardens"],"effects":{"science":0.08},"atlas":"elf","art_index":5,"description":"A elf tradition that strengthens the whole account. Heritage bonuses apply while this is your account faction."}'::jsonb),
('elf-sylvan-harvest','Sylvan Harvest','heritage',3,'elf',575,552,'["elf-crystal-lore"]'::jsonb,'{"food":0.12}'::jsonb,'{"id":"elf-sylvan-harvest","name":"Sylvan Harvest","branch":"heritage","era":3,"stage":6,"lane":10,"faction":"elf","cost":575,"seconds":552,"requires":["elf-crystal-lore"],"effects":{"food":0.12},"atlas":"elf","art_index":6,"description":"A elf tradition that strengthens the whole account. Heritage bonuses apply while this is your account faction."}'::jsonb),
('elf-ancient-songs','Ancient Songs','heritage',3,'elf',690,662,'["elf-sylvan-harvest"]'::jsonb,'{"culture":0.12}'::jsonb,'{"id":"elf-ancient-songs","name":"Ancient Songs","branch":"heritage","era":3,"stage":7,"lane":10,"faction":"elf","cost":690,"seconds":662,"requires":["elf-sylvan-harvest"],"effects":{"culture":0.12},"atlas":"elf","art_index":7,"description":"A elf tradition that strengthens the whole account. Heritage bonuses apply while this is your account faction."}'::jsonb),
('elf-star-sight','Star Sight','heritage',4,'elf',1150,977,'["elf-ancient-songs","philosophy"]'::jsonb,'{"spell_power":0.12}'::jsonb,'{"id":"elf-star-sight","name":"Star Sight","branch":"heritage","era":4,"stage":8,"lane":10,"faction":"elf","cost":1150,"seconds":977,"requires":["elf-ancient-songs","philosophy"],"effects":{"spell_power":0.12},"atlas":"elf","art_index":8,"description":"A elf tradition that strengthens the whole account. Heritage bonuses apply while this is your account faction."}'::jsonb),
('elf-elder-wisdom','Elder Wisdom','heritage',4,'elf',1380,1173,'["elf-star-sight"]'::jsonb,'{"research_speed":0.12}'::jsonb,'{"id":"elf-elder-wisdom","name":"Elder Wisdom","branch":"heritage","era":4,"stage":9,"lane":10,"faction":"elf","cost":1380,"seconds":1173,"requires":["elf-star-sight"],"effects":{"research_speed":0.12},"atlas":"elf","art_index":9,"description":"A elf tradition that strengthens the whole account. Heritage bonuses apply while this is your account faction."}'::jsonb),
('dwarf-mountain-mining','Mountain Mining','heritage',0,'dwarf',40,34,'["writing"]'::jsonb,'{"stone":0.08}'::jsonb,'{"id":"dwarf-mountain-mining","name":"Mountain Mining","branch":"heritage","era":0,"stage":0,"lane":10,"faction":"dwarf","cost":40,"seconds":34,"requires":["writing"],"effects":{"stone":0.08},"atlas":"dwarf","art_index":0,"description":"A dwarf tradition that strengthens the whole account. Heritage bonuses apply while this is your account faction."}'::jsonb),
('dwarf-rune-carving','Rune Carving','heritage',0,'dwarf',48,41,'["dwarf-mountain-mining"]'::jsonb,'{"science":0.08}'::jsonb,'{"id":"dwarf-rune-carving","name":"Rune Carving","branch":"heritage","era":0,"stage":1,"lane":10,"faction":"dwarf","cost":48,"seconds":41,"requires":["dwarf-mountain-mining"],"effects":{"science":0.08},"atlas":"dwarf","art_index":1,"description":"A dwarf tradition that strengthens the whole account. Heritage bonuses apply while this is your account faction."}'::jsonb),
('dwarf-deep-vaults','Deep Vaults','heritage',1,'dwarf',103,103,'["dwarf-rune-carving"]'::jsonb,'{"storage":0.08}'::jsonb,'{"id":"dwarf-deep-vaults","name":"Deep Vaults","branch":"heritage","era":1,"stage":2,"lane":10,"faction":"dwarf","cost":103,"seconds":103,"requires":["dwarf-rune-carving"],"effects":{"storage":0.08},"atlas":"dwarf","art_index":2,"description":"A dwarf tradition that strengthens the whole account. Heritage bonuses apply while this is your account faction."}'::jsonb),
('dwarf-steel-axes','Steel Axes','heritage',1,'dwarf',124,124,'["dwarf-deep-vaults"]'::jsonb,'{"infantry_attack":0.08}'::jsonb,'{"id":"dwarf-steel-axes","name":"Steel Axes","branch":"heritage","era":1,"stage":3,"lane":10,"faction":"dwarf","cost":124,"seconds":124,"requires":["dwarf-deep-vaults"],"effects":{"infantry_attack":0.08},"atlas":"dwarf","art_index":3,"description":"A dwarf tradition that strengthens the whole account. Heritage bonuses apply while this is your account faction."}'::jsonb),
('dwarf-heavy-mail','Heavy Mail','heritage',2,'dwarf',253,276,'["dwarf-steel-axes","libraries"]'::jsonb,'{"infantry_defence":0.08}'::jsonb,'{"id":"dwarf-heavy-mail","name":"Heavy Mail","branch":"heritage","era":2,"stage":4,"lane":10,"faction":"dwarf","cost":253,"seconds":276,"requires":["dwarf-steel-axes","libraries"],"effects":{"infantry_defence":0.08},"atlas":"dwarf","art_index":4,"description":"A dwarf tradition that strengthens the whole account. Heritage bonuses apply while this is your account faction."}'::jsonb),
('dwarf-geared-siege','Geared Siege','heritage',2,'dwarf',304,331,'["dwarf-heavy-mail"]'::jsonb,'{"siege":0.08}'::jsonb,'{"id":"dwarf-geared-siege","name":"Geared Siege","branch":"heritage","era":2,"stage":5,"lane":10,"faction":"dwarf","cost":304,"seconds":331,"requires":["dwarf-heavy-mail"],"effects":{"siege":0.08},"atlas":"dwarf","art_index":5,"description":"A dwarf tradition that strengthens the whole account. Heritage bonuses apply while this is your account faction."}'::jsonb),
('dwarf-stone-halls','Stone Halls','heritage',3,'dwarf',575,552,'["dwarf-geared-siege"]'::jsonb,'{"construction":0.12}'::jsonb,'{"id":"dwarf-stone-halls","name":"Stone Halls","branch":"heritage","era":3,"stage":6,"lane":10,"faction":"dwarf","cost":575,"seconds":552,"requires":["dwarf-geared-siege"],"effects":{"construction":0.12},"atlas":"dwarf","art_index":6,"description":"A dwarf tradition that strengthens the whole account. Heritage bonuses apply while this is your account faction."}'::jsonb),
('dwarf-tunnel-roads','Tunnel Roads','heritage',3,'dwarf',690,662,'["dwarf-stone-halls"]'::jsonb,'{"march":0.12}'::jsonb,'{"id":"dwarf-tunnel-roads","name":"Tunnel Roads","branch":"heritage","era":3,"stage":7,"lane":10,"faction":"dwarf","cost":690,"seconds":662,"requires":["dwarf-stone-halls"],"effects":{"march":0.12},"atlas":"dwarf","art_index":7,"description":"A dwarf tradition that strengthens the whole account. Heritage bonuses apply while this is your account faction."}'::jsonb),
('dwarf-master-forging','Master Forging','heritage',4,'dwarf',1150,977,'["dwarf-tunnel-roads","philosophy"]'::jsonb,'{"training":0.12}'::jsonb,'{"id":"dwarf-master-forging","name":"Master Forging","branch":"heritage","era":4,"stage":8,"lane":10,"faction":"dwarf","cost":1150,"seconds":977,"requires":["dwarf-tunnel-roads","philosophy"],"effects":{"training":0.12},"atlas":"dwarf","art_index":8,"description":"A dwarf tradition that strengthens the whole account. Heritage bonuses apply while this is your account faction."}'::jsonb),
('dwarf-ancestral-runes','Ancestral Runes','heritage',4,'dwarf',1380,1173,'["dwarf-master-forging"]'::jsonb,'{"spell_power":0.12}'::jsonb,'{"id":"dwarf-ancestral-runes","name":"Ancestral Runes","branch":"heritage","era":4,"stage":9,"lane":10,"faction":"dwarf","cost":1380,"seconds":1173,"requires":["dwarf-master-forging"],"effects":{"spell_power":0.12},"atlas":"dwarf","art_index":9,"description":"A dwarf tradition that strengthens the whole account. Heritage bonuses apply while this is your account faction."}'::jsonb),
('gnome-clockwork-tools','Clockwork Tools','heritage',0,'gnome',40,34,'["writing"]'::jsonb,'{"construction":0.08}'::jsonb,'{"id":"gnome-clockwork-tools","name":"Clockwork Tools","branch":"heritage","era":0,"stage":0,"lane":10,"faction":"gnome","cost":40,"seconds":34,"requires":["writing"],"effects":{"construction":0.08},"atlas":"gnome","art_index":0,"description":"A gnome tradition that strengthens the whole account. Heritage bonuses apply while this is your account faction."}'::jsonb),
('gnome-precision-optics','Precision Optics','heritage',0,'gnome',48,41,'["gnome-clockwork-tools"]'::jsonb,'{"archers_attack":0.08}'::jsonb,'{"id":"gnome-precision-optics","name":"Precision Optics","branch":"heritage","era":0,"stage":1,"lane":10,"faction":"gnome","cost":48,"seconds":41,"requires":["gnome-clockwork-tools"],"effects":{"archers_attack":0.08},"atlas":"gnome","art_index":1,"description":"A gnome tradition that strengthens the whole account. Heritage bonuses apply while this is your account faction."}'::jsonb),
('gnome-automata','Automata','heritage',1,'gnome',103,103,'["gnome-precision-optics"]'::jsonb,'{"training":0.08}'::jsonb,'{"id":"gnome-automata","name":"Automata","branch":"heritage","era":1,"stage":2,"lane":10,"faction":"gnome","cost":103,"seconds":103,"requires":["gnome-precision-optics"],"effects":{"training":0.08},"atlas":"gnome","art_index":2,"description":"A gnome tradition that strengthens the whole account. Heritage bonuses apply while this is your account faction."}'::jsonb),
('gnome-gearworks','Gearworks','heritage',1,'gnome',124,124,'["gnome-automata"]'::jsonb,'{"gold":0.08}'::jsonb,'{"id":"gnome-gearworks","name":"Gearworks","branch":"heritage","era":1,"stage":3,"lane":10,"faction":"gnome","cost":124,"seconds":124,"requires":["gnome-automata"],"effects":{"gold":0.08},"atlas":"gnome","art_index":3,"description":"A gnome tradition that strengthens the whole account. Heritage bonuses apply while this is your account faction."}'::jsonb),
('gnome-mechanical-siege','Mechanical Siege','heritage',2,'gnome',253,276,'["gnome-gearworks","libraries"]'::jsonb,'{"siege":0.08}'::jsonb,'{"id":"gnome-mechanical-siege","name":"Mechanical Siege","branch":"heritage","era":2,"stage":4,"lane":10,"faction":"gnome","cost":253,"seconds":276,"requires":["gnome-gearworks","libraries"],"effects":{"siege":0.08},"atlas":"gnome","art_index":4,"description":"A gnome tradition that strengthens the whole account. Heritage bonuses apply while this is your account faction."}'::jsonb),
('gnome-workshop-science','Workshop Science','heritage',2,'gnome',304,331,'["gnome-mechanical-siege"]'::jsonb,'{"science":0.08}'::jsonb,'{"id":"gnome-workshop-science","name":"Workshop Science","branch":"heritage","era":2,"stage":5,"lane":10,"faction":"gnome","cost":304,"seconds":331,"requires":["gnome-mechanical-siege"],"effects":{"science":0.08},"atlas":"gnome","art_index":5,"description":"A gnome tradition that strengthens the whole account. Heritage bonuses apply while this is your account faction."}'::jsonb),
('gnome-rat-couriers','Rat Couriers','heritage',3,'gnome',575,552,'["gnome-workshop-science"]'::jsonb,'{"march":0.12}'::jsonb,'{"id":"gnome-rat-couriers","name":"Rat Couriers","branch":"heritage","era":3,"stage":6,"lane":10,"faction":"gnome","cost":575,"seconds":552,"requires":["gnome-workshop-science"],"effects":{"march":0.12},"atlas":"gnome","art_index":6,"description":"A gnome tradition that strengthens the whole account. Heritage bonuses apply while this is your account faction."}'::jsonb),
('gnome-alchemy','Alchemy','heritage',3,'gnome',690,662,'["gnome-rat-couriers"]'::jsonb,'{"spell_power":0.12}'::jsonb,'{"id":"gnome-alchemy","name":"Alchemy","branch":"heritage","era":3,"stage":7,"lane":10,"faction":"gnome","cost":690,"seconds":662,"requires":["gnome-rat-couriers"],"effects":{"spell_power":0.12},"atlas":"gnome","art_index":7,"description":"A gnome tradition that strengthens the whole account. Heritage bonuses apply while this is your account faction."}'::jsonb),
('gnome-patent-houses','Patent Houses','heritage',4,'gnome',1150,977,'["gnome-alchemy","philosophy"]'::jsonb,'{"trade":0.12}'::jsonb,'{"id":"gnome-patent-houses","name":"Patent Houses","branch":"heritage","era":4,"stage":8,"lane":10,"faction":"gnome","cost":1150,"seconds":977,"requires":["gnome-alchemy","philosophy"],"effects":{"trade":0.12},"atlas":"gnome","art_index":8,"description":"A gnome tradition that strengthens the whole account. Heritage bonuses apply while this is your account faction."}'::jsonb),
('gnome-grand-invention','Grand Invention','heritage',4,'gnome',1380,1173,'["gnome-patent-houses"]'::jsonb,'{"research_speed":0.12}'::jsonb,'{"id":"gnome-grand-invention","name":"Grand Invention","branch":"heritage","era":4,"stage":9,"lane":10,"faction":"gnome","cost":1380,"seconds":1173,"requires":["gnome-patent-houses"],"effects":{"research_speed":0.12},"atlas":"gnome","art_index":9,"description":"A gnome tradition that strengthens the whole account. Heritage bonuses apply while this is your account faction."}'::jsonb),
('pandaren-bamboo-craft','Bamboo Craft','heritage',0,'pandaren',40,34,'["writing"]'::jsonb,'{"wood":0.08}'::jsonb,'{"id":"pandaren-bamboo-craft","name":"Bamboo Craft","branch":"heritage","era":0,"stage":0,"lane":10,"faction":"pandaren","cost":40,"seconds":34,"requires":["writing"],"effects":{"wood":0.08},"atlas":"pandaren","art_index":0,"description":"A pandaren tradition that strengthens the whole account. Heritage bonuses apply while this is your account faction."}'::jsonb),
('pandaren-rice-terraces','Rice Terraces','heritage',0,'pandaren',48,41,'["pandaren-bamboo-craft"]'::jsonb,'{"food":0.08}'::jsonb,'{"id":"pandaren-rice-terraces","name":"Rice Terraces","branch":"heritage","era":0,"stage":1,"lane":10,"faction":"pandaren","cost":48,"seconds":41,"requires":["pandaren-bamboo-craft"],"effects":{"food":0.08},"atlas":"pandaren","art_index":1,"description":"A pandaren tradition that strengthens the whole account. Heritage bonuses apply while this is your account faction."}'::jsonb),
('pandaren-tea-houses','Tea Houses','heritage',1,'pandaren',103,103,'["pandaren-rice-terraces"]'::jsonb,'{"culture":0.08}'::jsonb,'{"id":"pandaren-tea-houses","name":"Tea Houses","branch":"heritage","era":1,"stage":2,"lane":10,"faction":"pandaren","cost":103,"seconds":103,"requires":["pandaren-rice-terraces"],"effects":{"culture":0.08},"atlas":"pandaren","art_index":2,"description":"A pandaren tradition that strengthens the whole account. Heritage bonuses apply while this is your account faction."}'::jsonb),
('pandaren-martial-forms','Martial Forms','heritage',1,'pandaren',124,124,'["pandaren-tea-houses"]'::jsonb,'{"infantry_defence":0.08}'::jsonb,'{"id":"pandaren-martial-forms","name":"Martial Forms","branch":"heritage","era":1,"stage":3,"lane":10,"faction":"pandaren","cost":124,"seconds":124,"requires":["pandaren-tea-houses"],"effects":{"infantry_defence":0.08},"atlas":"pandaren","art_index":3,"description":"A pandaren tradition that strengthens the whole account. Heritage bonuses apply while this is your account faction."}'::jsonb),
('pandaren-silk-markets','Silk Markets','heritage',2,'pandaren',253,276,'["pandaren-martial-forms","libraries"]'::jsonb,'{"trade":0.08}'::jsonb,'{"id":"pandaren-silk-markets","name":"Silk Markets","branch":"heritage","era":2,"stage":4,"lane":10,"faction":"pandaren","cost":253,"seconds":276,"requires":["pandaren-martial-forms","libraries"],"effects":{"trade":0.08},"atlas":"pandaren","art_index":4,"description":"A pandaren tradition that strengthens the whole account. Heritage bonuses apply while this is your account faction."}'::jsonb),
('pandaren-jade-wisdom','Jade Wisdom','heritage',2,'pandaren',304,331,'["pandaren-silk-markets"]'::jsonb,'{"science":0.08}'::jsonb,'{"id":"pandaren-jade-wisdom","name":"Jade Wisdom","branch":"heritage","era":2,"stage":5,"lane":10,"faction":"pandaren","cost":304,"seconds":331,"requires":["pandaren-silk-markets"],"effects":{"science":0.08},"atlas":"pandaren","art_index":5,"description":"A pandaren tradition that strengthens the whole account. Heritage bonuses apply while this is your account faction."}'::jsonb),
('pandaren-mountain-monasteries','Mountain Monasteries','heritage',3,'pandaren',575,552,'["pandaren-jade-wisdom"]'::jsonb,'{"training":0.12}'::jsonb,'{"id":"pandaren-mountain-monasteries","name":"Mountain Monasteries","branch":"heritage","era":3,"stage":6,"lane":10,"faction":"pandaren","cost":575,"seconds":552,"requires":["pandaren-jade-wisdom"],"effects":{"training":0.12},"atlas":"pandaren","art_index":6,"description":"A pandaren tradition that strengthens the whole account. Heritage bonuses apply while this is your account faction."}'::jsonb),
('pandaren-dragon-breath','Dragon Breath','heritage',3,'pandaren',690,662,'["pandaren-mountain-monasteries"]'::jsonb,'{"spell_power":0.12}'::jsonb,'{"id":"pandaren-dragon-breath","name":"Dragon Breath","branch":"heritage","era":3,"stage":7,"lane":10,"faction":"pandaren","cost":690,"seconds":662,"requires":["pandaren-mountain-monasteries"],"effects":{"spell_power":0.12},"atlas":"pandaren","art_index":7,"description":"A pandaren tradition that strengthens the whole account. Heritage bonuses apply while this is your account faction."}'::jsonb),
('pandaren-golden-harvest','Golden Harvest','heritage',4,'pandaren',1150,977,'["pandaren-dragon-breath","philosophy"]'::jsonb,'{"gold":0.12}'::jsonb,'{"id":"pandaren-golden-harvest","name":"Golden Harvest","branch":"heritage","era":4,"stage":8,"lane":10,"faction":"pandaren","cost":1150,"seconds":977,"requires":["pandaren-dragon-breath","philosophy"],"effects":{"gold":0.12},"atlas":"pandaren","art_index":8,"description":"A pandaren tradition that strengthens the whole account. Heritage bonuses apply while this is your account faction."}'::jsonb),
('pandaren-celestial-harmony','Celestial Harmony','heritage',4,'pandaren',1380,1173,'["pandaren-golden-harvest"]'::jsonb,'{"mana":0.12}'::jsonb,'{"id":"pandaren-celestial-harmony","name":"Celestial Harmony","branch":"heritage","era":4,"stage":9,"lane":10,"faction":"pandaren","cost":1380,"seconds":1173,"requires":["pandaren-golden-harvest"],"effects":{"mana":0.12},"atlas":"pandaren","art_index":9,"description":"A pandaren tradition that strengthens the whole account. Heritage bonuses apply while this is your account faction."}'::jsonb),
('undead-grave-lore','Grave Lore','heritage',0,'undead',40,34,'["writing"]'::jsonb,'{"science":0.08}'::jsonb,'{"id":"undead-grave-lore","name":"Grave Lore","branch":"heritage","era":0,"stage":0,"lane":10,"faction":"undead","cost":40,"seconds":34,"requires":["writing"],"effects":{"science":0.08},"atlas":"undead","art_index":0,"description":"A undead tradition that strengthens the whole account. Heritage bonuses apply while this is your account faction."}'::jsonb),
('undead-bone-legion','Bone Legion','heritage',0,'undead',48,41,'["undead-grave-lore"]'::jsonb,'{"infantry_defence":0.08}'::jsonb,'{"id":"undead-bone-legion","name":"Bone Legion","branch":"heritage","era":0,"stage":1,"lane":10,"faction":"undead","cost":48,"seconds":41,"requires":["undead-grave-lore"],"effects":{"infantry_defence":0.08},"atlas":"undead","art_index":1,"description":"A undead tradition that strengthens the whole account. Heritage bonuses apply while this is your account faction."}'::jsonb),
('undead-crypt-vaults','Crypt Vaults','heritage',1,'undead',103,103,'["undead-bone-legion"]'::jsonb,'{"storage":0.08}'::jsonb,'{"id":"undead-crypt-vaults","name":"Crypt Vaults","branch":"heritage","era":1,"stage":2,"lane":10,"faction":"undead","cost":103,"seconds":103,"requires":["undead-bone-legion"],"effects":{"storage":0.08},"atlas":"undead","art_index":2,"description":"A undead tradition that strengthens the whole account. Heritage bonuses apply while this is your account faction."}'::jsonb),
('undead-soul-binding','Soul Binding','heritage',1,'undead',124,124,'["undead-crypt-vaults"]'::jsonb,'{"mana":0.08}'::jsonb,'{"id":"undead-soul-binding","name":"Soul Binding","branch":"heritage","era":1,"stage":3,"lane":10,"faction":"undead","cost":124,"seconds":124,"requires":["undead-crypt-vaults"],"effects":{"mana":0.08},"atlas":"undead","art_index":3,"description":"A undead tradition that strengthens the whole account. Heritage bonuses apply while this is your account faction."}'::jsonb),
('undead-dark-scholars','Dark Scholars','heritage',2,'undead',253,276,'["undead-soul-binding","libraries"]'::jsonb,'{"research_speed":0.08}'::jsonb,'{"id":"undead-dark-scholars","name":"Dark Scholars","branch":"heritage","era":2,"stage":4,"lane":10,"faction":"undead","cost":253,"seconds":276,"requires":["undead-soul-binding","libraries"],"effects":{"research_speed":0.08},"atlas":"undead","art_index":4,"description":"A undead tradition that strengthens the whole account. Heritage bonuses apply while this is your account faction."}'::jsonb),
('undead-spectral-march','Spectral March','heritage',2,'undead',304,331,'["undead-dark-scholars"]'::jsonb,'{"march":0.08}'::jsonb,'{"id":"undead-spectral-march","name":"Spectral March","branch":"heritage","era":2,"stage":5,"lane":10,"faction":"undead","cost":304,"seconds":331,"requires":["undead-dark-scholars"],"effects":{"march":0.08},"atlas":"undead","art_index":5,"description":"A undead tradition that strengthens the whole account. Heritage bonuses apply while this is your account faction."}'::jsonb),
('undead-necromantic-rites','Necromantic Rites','heritage',3,'undead',575,552,'["undead-spectral-march"]'::jsonb,'{"spell_power":0.12}'::jsonb,'{"id":"undead-necromantic-rites","name":"Necromantic Rites","branch":"heritage","era":3,"stage":6,"lane":10,"faction":"undead","cost":575,"seconds":552,"requires":["undead-spectral-march"],"effects":{"spell_power":0.12},"atlas":"undead","art_index":6,"description":"A undead tradition that strengthens the whole account. Heritage bonuses apply while this is your account faction."}'::jsonb),
('undead-black-citadels','Black Citadels','heritage',3,'undead',690,662,'["undead-necromantic-rites"]'::jsonb,'{"construction":0.12}'::jsonb,'{"id":"undead-black-citadels","name":"Black Citadels","branch":"heritage","era":3,"stage":7,"lane":10,"faction":"undead","cost":690,"seconds":662,"requires":["undead-necromantic-rites"],"effects":{"construction":0.12},"atlas":"undead","art_index":7,"description":"A undead tradition that strengthens the whole account. Heritage bonuses apply while this is your account faction."}'::jsonb),
('undead-death-knights','Death Knights','heritage',4,'undead',1150,977,'["undead-black-citadels","philosophy"]'::jsonb,'{"cavalry_attack":0.12}'::jsonb,'{"id":"undead-death-knights","name":"Death Knights","branch":"heritage","era":4,"stage":8,"lane":10,"faction":"undead","cost":1150,"seconds":977,"requires":["undead-black-citadels","philosophy"],"effects":{"cavalry_attack":0.12},"atlas":"undead","art_index":8,"description":"A undead tradition that strengthens the whole account. Heritage bonuses apply while this is your account faction."}'::jsonb),
('undead-lich-ascendancy','Lich Ascendancy','heritage',4,'undead',1380,1173,'["undead-death-knights"]'::jsonb,'{"hero_xp":0.12}'::jsonb,'{"id":"undead-lich-ascendancy","name":"Lich Ascendancy","branch":"heritage","era":4,"stage":9,"lane":10,"faction":"undead","cost":1380,"seconds":1173,"requires":["undead-death-knights"],"effects":{"hero_xp":0.12},"atlas":"undead","art_index":9,"description":"A undead tradition that strengthens the whole account. Heritage bonuses apply while this is your account faction."}'::jsonb),
('demon-hellforging','Hellforging','heritage',0,'demon',40,34,'["writing"]'::jsonb,'{"infantry_attack":0.08}'::jsonb,'{"id":"demon-hellforging","name":"Hellforging","branch":"heritage","era":0,"stage":0,"lane":10,"faction":"demon","cost":40,"seconds":34,"requires":["writing"],"effects":{"infantry_attack":0.08},"atlas":"demon","art_index":0,"description":"A demon tradition that strengthens the whole account. Heritage bonuses apply while this is your account faction."}'::jsonb),
('demon-ember-bolts','Ember Bolts','heritage',0,'demon',48,41,'["demon-hellforging"]'::jsonb,'{"archers_attack":0.08}'::jsonb,'{"id":"demon-ember-bolts","name":"Ember Bolts","branch":"heritage","era":0,"stage":1,"lane":10,"faction":"demon","cost":48,"seconds":41,"requires":["demon-hellforging"],"effects":{"archers_attack":0.08},"atlas":"demon","art_index":1,"description":"A demon tradition that strengthens the whole account. Heritage bonuses apply while this is your account faction."}'::jsonb),
('demon-infernal-engines','Infernal Engines','heritage',1,'demon',103,103,'["demon-ember-bolts"]'::jsonb,'{"siege":0.08}'::jsonb,'{"id":"demon-infernal-engines","name":"Infernal Engines","branch":"heritage","era":1,"stage":2,"lane":10,"faction":"demon","cost":103,"seconds":103,"requires":["demon-ember-bolts"],"effects":{"siege":0.08},"atlas":"demon","art_index":2,"description":"A demon tradition that strengthens the whole account. Heritage bonuses apply while this is your account faction."}'::jsonb),
('demon-soul-bargains','Soul Bargains','heritage',1,'demon',124,124,'["demon-infernal-engines"]'::jsonb,'{"trade":0.08}'::jsonb,'{"id":"demon-soul-bargains","name":"Soul Bargains","branch":"heritage","era":1,"stage":3,"lane":10,"faction":"demon","cost":124,"seconds":124,"requires":["demon-infernal-engines"],"effects":{"trade":0.08},"atlas":"demon","art_index":3,"description":"A demon tradition that strengthens the whole account. Heritage bonuses apply while this is your account faction."}'::jsonb),
('demon-obsidian-armour','Obsidian Armour','heritage',2,'demon',253,276,'["demon-soul-bargains","libraries"]'::jsonb,'{"defence":0.08}'::jsonb,'{"id":"demon-obsidian-armour","name":"Obsidian Armour","branch":"heritage","era":2,"stage":4,"lane":10,"faction":"demon","cost":253,"seconds":276,"requires":["demon-soul-bargains","libraries"],"effects":{"defence":0.08},"atlas":"demon","art_index":4,"description":"A demon tradition that strengthens the whole account. Heritage bonuses apply while this is your account faction."}'::jsonb),
('demon-flame-scholars','Flame Scholars','heritage',2,'demon',304,331,'["demon-obsidian-armour"]'::jsonb,'{"science":0.08}'::jsonb,'{"id":"demon-flame-scholars","name":"Flame Scholars","branch":"heritage","era":2,"stage":5,"lane":10,"faction":"demon","cost":304,"seconds":331,"requires":["demon-obsidian-armour"],"effects":{"science":0.08},"atlas":"demon","art_index":5,"description":"A demon tradition that strengthens the whole account. Heritage bonuses apply while this is your account faction."}'::jsonb),
('demon-abyssal-gates','Abyssal Gates','heritage',3,'demon',575,552,'["demon-flame-scholars"]'::jsonb,'{"march":0.12}'::jsonb,'{"id":"demon-abyssal-gates","name":"Abyssal Gates","branch":"heritage","era":3,"stage":6,"lane":10,"faction":"demon","cost":575,"seconds":552,"requires":["demon-flame-scholars"],"effects":{"march":0.12},"atlas":"demon","art_index":6,"description":"A demon tradition that strengthens the whole account. Heritage bonuses apply while this is your account faction."}'::jsonb),
('demon-demonic-warbands','Demonic Warbands','heritage',3,'demon',690,662,'["demon-abyssal-gates"]'::jsonb,'{"training":0.12}'::jsonb,'{"id":"demon-demonic-warbands","name":"Demonic Warbands","branch":"heritage","era":3,"stage":7,"lane":10,"faction":"demon","cost":690,"seconds":662,"requires":["demon-abyssal-gates"],"effects":{"training":0.12},"atlas":"demon","art_index":7,"description":"A demon tradition that strengthens the whole account. Heritage bonuses apply while this is your account faction."}'::jsonb),
('demon-infernal-dominion','Infernal Dominion','heritage',4,'demon',1150,977,'["demon-demonic-warbands","philosophy"]'::jsonb,'{"culture":0.12}'::jsonb,'{"id":"demon-infernal-dominion","name":"Infernal Dominion","branch":"heritage","era":4,"stage":8,"lane":10,"faction":"demon","cost":1150,"seconds":977,"requires":["demon-demonic-warbands","philosophy"],"effects":{"culture":0.12},"atlas":"demon","art_index":8,"description":"A demon tradition that strengthens the whole account. Heritage bonuses apply while this is your account faction."}'::jsonb),
('demon-archfiend-legacy','Archfiend Legacy','heritage',4,'demon',1380,1173,'["demon-infernal-dominion"]'::jsonb,'{"spell_power":0.12}'::jsonb,'{"id":"demon-archfiend-legacy","name":"Archfiend Legacy","branch":"heritage","era":4,"stage":9,"lane":10,"faction":"demon","cost":1380,"seconds":1173,"requires":["demon-infernal-dominion"],"effects":{"spell_power":0.12},"atlas":"demon","art_index":9,"description":"A demon tradition that strengthens the whole account. Heritage bonuses apply while this is your account faction."}'::jsonb)
on conflict(id)do update set name=excluded.name,branch=excluded.branch,era=excluded.era,faction=excluded.faction,cost=excluded.cost,seconds=excluded.seconds,prerequisites=excluded.prerequisites,effects=excluded.effects,metadata=excluded.metadata;

-- Canonical ten-role inventories in the existing realm. Legacy class totals remain compatible.
alter table public.armies add column if not exists unit_roster jsonb;
alter table public.armies add column if not exists carried_loot jsonb;
alter table public.armies add column if not exists farm_list_id bigint;
alter table public.battle_formations add column if not exists recruit_unit text;
create table if not exists public.peris_unit_research (
 settlement_id bigint not null references public.settlements(id) on delete cascade,
 unit text not null references public.peris_unit_catalog(unit), completes_at timestamptz not null,
 primary key(settlement_id,unit)
);
alter table public.peris_unit_research enable row level security;
revoke all on public.peris_unit_research from public,anon,authenticated;
grant select on public.peris_unit_research to authenticated;
drop policy if exists "own unit research" on public.peris_unit_research;
create policy "own unit research" on public.peris_unit_research for select to authenticated using(exists(select 1 from public.settlements s where s.id=settlement_id and s.owner_id=public.peris_player_id()));

create or replace function public.peris_roster(p jsonb) returns jsonb language plpgsql immutable set search_path='' as $$
declare unit_name text;value numeric;source jsonb:=coalesce(nullif(p->'unit_roster','null'::jsonb),p);result jsonb:='{}';
begin
 if jsonb_typeof(source) is distinct from 'object' then raise exception 'Choose whole troop counts';end if;
 foreach unit_name in array array['infantry','spearmen','archers','elite','cavalry','scout','heavyCavalry','ram','catapult','diplomat'] loop
  if source ? unit_name and jsonb_typeof(source->unit_name) is distinct from 'number' then raise exception 'Choose whole troop counts';end if;
  value:=coalesce((source->>unit_name)::numeric,0);
  if value<>trunc(value) or value<0 or value>1000000 then raise exception 'Choose nonnegative whole troop counts';end if;
  result:=result||jsonb_build_object(unit_name,value::integer);
 end loop;
 return result;
end $$;
create or replace function public.peris_roster_total(p jsonb) returns integer language sql immutable set search_path='' as $$
 select coalesce(sum(value::integer),0)::integer from jsonb_each_text(public.peris_roster(p))
$$;
create or replace function public.peris_roster_class(p jsonb,p_class text) returns integer language sql stable security definer set search_path='' as $$
 select coalesce(sum(coalesce((public.peris_roster(p)->>unit)::integer,0)),0)::integer from public.peris_unit_catalog where combat_class=p_class
$$;
create or replace function public.peris_roster_add(a jsonb,b jsonb,sign integer default 1) returns jsonb language sql immutable set search_path='' as $$
 select jsonb_object_agg(key,value::integer+sign*coalesce((public.peris_roster(b)->>key)::integer,0)) from jsonb_each_text(public.peris_roster(a))
$$;
create or replace function public.peris_write_roster(p_army bigint,p_roster jsonb) returns void language plpgsql security definer set search_path='' as $$
declare roster jsonb:=public.peris_roster(p_roster);
begin
 if public.peris_roster_total(roster)>1000 then raise exception 'Army capacity is 1,000 soldiers';end if;
 update public.armies set unit_roster=roster,infantry=public.peris_roster_class(roster,'infantry'),archers=public.peris_roster_class(roster,'archers'),cavalry=public.peris_roster_class(roster,'cavalry') where id=p_army;
end $$;
create or replace function public.peris_recruit_complete(p_army bigint,p_unit text,p_count integer) returns void language plpgsql security definer set search_path='' as $$
declare roster jsonb;
begin
 select public.peris_roster(to_jsonb(a)) into roster from public.armies a where id=p_army for update;
 if roster is null then raise exception 'Army missing';end if;
 roster:=jsonb_set(roster,array[p_unit],to_jsonb((roster->>p_unit)::integer+p_count));
 perform public.peris_write_roster(p_army,roster);
end $$;

-- Unit attributes are independent of hero and magical modifiers.
alter table public.battle_formations add column if not exists unit_attack numeric not null default 1 check(unit_attack between .1 and 20);
alter table public.battle_formations add column if not exists unit_defence numeric not null default 1 check(unit_defence between .5 and 20);
alter table public.battle_formations add column if not exists unit_speed numeric not null default 1 check(unit_speed between .15 and 3);
create or replace function public.peris_roster_take_classes(p_roster jsonb,p_classes jsonb)returns jsonb
language plpgsql security definer set search_path='' as $$
declare available jsonb:=public.peris_roster(p_roster);chosen jsonb:=public.peris_roster('{}');typ text;unit_name text;remaining integer;amount integer;
begin
 foreach typ in array array['infantry','archers','cavalry']loop
  remaining:=(p_classes->>typ)::integer;
  if remaining is null or remaining<0 then raise exception 'Choose available soldiers';end if;
  foreach unit_name in array array['infantry','spearmen','archers','elite','cavalry','scout','heavyCavalry','ram','catapult','diplomat']loop
   if (select combat_class from public.peris_unit_catalog where unit=unit_name)<>typ then continue;end if;
   amount:=least(remaining,(available->>unit_name)::integer);remaining:=remaining-amount;
   chosen:=jsonb_set(chosen,array[unit_name],to_jsonb(amount));
  end loop;
  if remaining>0 then raise exception 'Choose available soldiers';end if;
 end loop;
 return chosen;
end $$;

alter table public.battle_formations drop constraint if exists battle_formations_unit_attack_check;alter table public.battle_formations add constraint battle_formations_unit_attack_check check(unit_attack between .1 and 20);
-- Main is the legacy market building, separate from the Market caravan slot.
create or replace function public.peris_training_level(p_city bigint,p_unit text)returns integer
language sql stable security definer set search_path='' as $$
 select case when c.building='main'then coalesce((select max(level)from public.buildings where settlement_id=p_city and building_type='market'),0)
 else coalesce((select sum(level)from public.peris_city_slots where settlement_id=p_city and building_type=c.building),0)::integer end
 from public.peris_unit_catalog c where c.unit=p_unit
$$;
revoke all on function public.peris_training_level(bigint,text)from public,anon,authenticated;

-- Dedicated destination is recorded on the order; training is still queued in the
-- city's ordinary recruitment building and resolves on the same offline tick.
create or replace function public.peris_queue_recruit_to(p_type text,p_quantity integer,p_destination text)returns jsonb
language plpgsql security definer set search_path='' as $$
declare u uuid:=public.peris_player_id();s public.settlements%rowtype;a public.armies%rowtype;
 l integer;at_time timestamptz;duration numeric;queued integer;queue_size integer;home jsonb;r public.peris_unit_catalog%rowtype;
begin
 if u is null then raise exception 'Authentication required';end if;
 if p_destination not in('legion','garrison')or p_destination is null then raise exception 'Choose a recruitment destination';end if;
 select * into r from public.peris_unit_catalog where unit=p_type;
 if r.unit is null or p_quantity is null or p_quantity<1 or p_quantity>200 then raise exception 'Choose between 1 and 200 soldiers';end if;
 if p_type='diplomat'and to_regclass('public.peris_conquest_version')is null then raise exception 'City capture is unavailable on this world';end if;
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
 l:=public.peris_training_level(s.id,p_type);
 if p_type='diplomat'and l<2 then raise exception 'Main building level 2 is required';end if;
 if p_type='diplomat'and public.peris_research_bonus(u,'unlock_diplomat')=0 then raise exception 'Research Diplomacy first';end if;
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
revoke all on function public.peris_queue_recruit_to(text,integer,text) from public,anon,authenticated;

-- Maintain the existing public two-argument recruitment RPC for older clients.
create or replace function public.peris_queue_recruit(p_type text,p_quantity integer)returns jsonb
language sql security definer set search_path='' as $$
 select public.peris_queue_recruit_to(p_type,p_quantity,'legion')
$$;

create or replace function public.peris_research_unit(p_city bigint,p_unit text) returns jsonb language plpgsql security definer set search_path='' as $$
declare u uuid:=public.peris_player_id();s public.settlements%rowtype;r public.peris_unit_catalog%rowtype;at_time timestamptz;
begin
 if u is null then raise exception 'Authentication required';end if;
 perform public.peris_settle(u);
 if exists(select 1 from public.battles where status='active' and (attacker_owner_id=u or defender_owner_id=u))then raise exception 'Finish the current battle first';end if;
 select * into s from public.settlements where id=coalesce(p_city,public.peris_city_id(u)) and owner_id=u for update;
 select * into r from public.peris_unit_catalog where unit=p_unit;
 if s.id is null or r.unit is null then raise exception 'Choose your own village and a known unit';end if;
 if r.research_seconds=0 or exists(select 1 from public.peris_unit_research where settlement_id=s.id and unit=r.unit)then raise exception 'This unit is already researched or queued';end if;
 if p_unit='diplomat'then raise exception 'Research Diplomacy in the account research tree';end if;
 if public.peris_training_level(s.id,p_unit)<1 then raise exception 'Build % first',r.building;end if;
 if s.wood<(r.research_cost->>'wood')::integer or s.stone<(r.research_cost->>'stone')::integer or s.food<(r.research_cost->>'food')::integer or s.gold<(r.research_cost->>'gold')::integer then raise exception 'Your stores cannot cover this research';end if;
 select greatest(public.peris_game_now(),coalesce(max(research.completes_at),public.peris_game_now()))into at_time from public.peris_unit_research research join public.peris_unit_catalog c on c.unit=research.unit where research.settlement_id=s.id and c.building=r.building;
 update public.settlements set wood=wood-(r.research_cost->>'wood')::integer,stone=stone-(r.research_cost->>'stone')::integer,food=food-(r.research_cost->>'food')::integer,gold=gold-(r.research_cost->>'gold')::integer where id=s.id;
 insert into public.peris_unit_research values(s.id,r.unit,at_time+make_interval(secs=>r.research_seconds));
 return jsonb_build_object('ok',true);
end $$;

-- Hourly combat troop crop consumption. Private helpers; never a public economy feed.
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
 from unnest(array['infantry','spearmen','archers','elite','cavalry','scout','heavyCavalry','ram','catapult','diplomat'])unit
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
  source:=coalesce(case when r.status='stationed'then(select id from public.settlements where id=r.target_settlement_id and owner_id=r.recipient_id and ruined_at is null)else coalesce((select id from public.settlements where id=r.source_settlement_id and owner_id=r.owner_id and ruined_at is null),(select id from public.settlements where id=r.target_settlement_id and owner_id=r.owner_id and ruined_at is null))end,(select min(id)from public.settlements where owner_id=r.owner_id and ruined_at is null));
  if source=p_sid then kind:='guild';key:='guild:'||r.id;owner_id:=r.owner_id;tier:=case when r.status='stationed'then 1 else 4 end;troops:=public.peris_roster(r.troops);return next;end if;
 end loop;
 for r in select * from public.peris_optional_scout_missions() loop
  source:=coalesce((select id from public.settlements where id=r.source_settlement_id and owner_id=r.owner_id and ruined_at is null),(select min(id)from public.settlements where owner_id=r.owner_id and ruined_at is null));
  if source=p_sid then kind:='scout';key:='scout:'||r.id;owner_id:=r.owner_id;tier:=4;troops:=public.peris_roster(jsonb_build_object('scout',r.scouts));return next;end if;
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
  update public.settlements set food=least(food_capacity,food+credit)where id=source_city and owner_id=owner and ruined_at is null;
 end loop;
 update public.battles set food_settled=true where id=b.id;
end $$;

-- Allocate permanent combat deaths against captured survivors, excluding already-debited famine.
create or replace function public.peris_food_defender_losses(p_bid bigint,p_party jsonb)returns jsonb
language plpgsql stable security definer set search_path='' as $$
declare b public.battles%rowtype;party jsonb;unit_name text;source_key text;total integer;prefix integer;amount integer;survivors integer;lost integer;result jsonb:=public.peris_roster('{}');seen boolean;
begin
 select * into b from public.battles where id=p_bid;
 foreach unit_name in array array['infantry','spearmen','archers','elite','cavalry','scout','heavyCavalry','ram','catapult','diplomat']loop
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
 select role into casualty_unit from unnest(array['infantry','spearmen','archers','elite','cavalry','scout','heavyCavalry','ram','catapult','diplomat'])with ordinality u(role,seq)order by coalesce((r.troops->>role)::integer,0)desc,seq limit 1;
 roster:=jsonb_set(r.troops,array[casualty_unit],to_jsonb((r.troops->>casualty_unit)::integer-1));parts:=string_to_array(r.key,':');
 if r.kind='army'then perform public.peris_write_roster(parts[2]::bigint,roster);
 elsif r.kind='reserve'then update public.armies set raid_reserve=roster where id=parts[2]::bigint;
 elsif r.kind='city'then update public.peris_city_garrisons set unit_roster=roster where settlement_id=p_sid;
 elsif r.kind='station'then update public.peris_garrisons set unit_roster=roster,infantry=public.peris_roster_class(roster,'infantry'),archers=public.peris_roster_class(roster,'archers'),cavalry=public.peris_roster_class(roster,'cavalry')where owner_id=r.owner_id and col=parts[3]::integer and row=parts[4]::integer;
 elsif r.kind='reinforcement'then update public.peris_city_reinforcements set troops=roster where id=parts[2]::bigint;
 elsif r.kind='guild'then update public.peris_guild_reinforcements set troops=roster where id=parts[2]::bigint;
 elsif r.kind='scout'then execute 'update public.peris_scout_missions set scouts=$1 where id=$2'using(roster->>'scout')::integer,parts[2]::bigint;
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
 union select owner_id,recipient_id from public.peris_scout_edges()
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
 perform public.peris_optional_advance_scouts(participants,cursor_at);
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
   union all select arrival_at from public.peris_optional_scout_missions()where owner_id=any(participants)
   union all select p_until
  )events where at_time>cursor_at and at_time<=p_until;
  exit when event_at is null;
  for city in select id from public.settlements where owner_id=any(participants)and ruined_at is null order by id loop perform public.peris_population_accrue(city.id,event_at);end loop;
  foreach participant in array participants loop perform public.peris_settle_core(participant,event_at);end loop;
  for r in select id from public.peris_trade_caravans where owner_id=any(participants)and(status='outbound'and arrival_at<=event_at or status='returning'and least(return_at,case when public.peris_trade_volume(returning_resources)>0 then redirect_at end)<=event_at)order by id loop perform public.peris_trade_event(r.id,event_at);end loop;
  perform public.peris_optional_advance_scouts(participants,event_at);
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

-- Called after casualties and siege, under the ordinary participant/component locks.
-- It never creates a commander, restores a queue, or transfers an account's research.
alter table public.peris_map_plots drop constraint if exists peris_map_plots_settlement_id_owner_id_fkey;
alter table public.peris_map_plots add constraint peris_map_plots_settlement_id_owner_id_fkey
 foreign key(settlement_id,owner_id)references public.settlements(id,owner_id)on update cascade on delete cascade;

create or replace function public.peris_apply_city_conquest(p_city bigint,p_attacker uuid,p_diplomats integer,p_at timestamptz)returns jsonb
language plpgsql security definer set search_path='' as $$
declare city public.settlements%rowtype;before numeric;after numeric;reduction numeric:=0;cost integer:=0;expansion integer;reason text;
 receipt jsonb;old_fields text[];route jsonb;pool record;a public.armies%rowtype;pos jsonb;backup bigint;living integer;
begin
 select * into city from public.settlements where id=p_city for update;
 if city.id is null then return null;end if;
 perform public.peris_loyalty_accrue(city.id,p_at);
 select loyalty into before from public.settlements where id=city.id;
 after:=before;
 select count(*)into expansion from public.settlements where owner_id=p_attacker and ruined_at is null;
 expansion:=expansion+(select count(*)from public.peris_settler_expeditions where owner_id=p_attacker and status='travelling');
 cost:=300*expansion*expansion;
 if city.ruined_at is not null then reason:='city_ruined';
 elsif city.owner_id=p_attacker then reason:='ownership_changed';
 elsif exists(select 1 from public.players where id=p_attacker and defeated_at is not null)then reason:='ruler_defeated';
 elsif p_diplomats<=0 then reason:='no_surviving_diplomats';
 elsif expansion>=10 then reason:='city_limit';
 elsif not exists(select 1 from public.players where id=p_attacker and culture_points>=cost)then reason:='insufficient_culture';
 else reduction:=least(25,p_diplomats,before);after:=greatest(0,before-reduction);
 end if;
 receipt:=jsonb_build_object('city_id',city.id,'before',before,'after',after,'diplomats',greatest(0,p_diplomats),'reduction',reduction,'captured',false,'culture_cost',0,'former_owner_id',city.owner_id);
 if reason is not null then return receipt||jsonb_build_object('reason',reason);end if;
 update public.settlements set loyalty=after,loyalty_updated_at=p_at where id=city.id;
 if after>0 then return receipt;end if;
 -- Settle the culture boundary with the old ownership before changing the rate.
 perform public.peris_culture_accrue(city.owner_id,p_at);perform public.peris_culture_accrue(p_attacker,p_at);
 update public.players set culture_points=culture_points-cost where id=p_attacker;
 update public.players set research_faction=public.peris_account_faction(id)where id in(city.owner_id,p_attacker)and research_faction is null;
 select array_append(coalesce(array_agg(col||':'||row),array[]::text[]),floor(city.x/128.0)::integer||':'||floor(city.y/128.0)::integer)into old_fields from public.peris_map_plots where settlement_id=city.id;
 update public.settlements set owner_id=p_attacker,settlers=0,loyalty=0,loyalty_updated_at=p_at where id=city.id;
 update public.peris_map_plots set owner_id=p_attacker where settlement_id=city.id;
 delete from public.peris_orders where settlement_id=city.id and owner_id=city.owner_id;
 delete from public.peris_unit_research where settlement_id=city.id;
 delete from public.peris_spell_research where settlement_id=city.id;
 -- Evacuate native pools through the existing timed, commander-free transport.
 for pool in
  select city.x x,city.y y,unit_roster troops from public.peris_city_garrisons where settlement_id=city.id and owner_id=city.owner_id
  union all select col*128+64,row*128+64,public.peris_roster(to_jsonb(g))from public.peris_garrisons g where owner_id=city.owner_id and(col||':'||row)=any(old_fields)
 loop
  route:=public.peris_ruin_route(city.owner_id,pool.x,pool.y);
  if route is not null and public.peris_roster_total(pool.troops)>0 then
   insert into public.peris_ruin_evacuations(owner_id,origin_settlement_id,target_settlement_id,origin_x,origin_y,troops,departure_at,arrival_at)
   values(city.owner_id,city.id,(route->>'city_id')::bigint,pool.x,pool.y,pool.troops,p_at,p_at+make_interval(secs=>greatest(2,(route->>'distance')::numeric/22)::double precision));
  end if;
 end loop;
 delete from public.peris_city_garrisons where settlement_id=city.id and owner_id=city.owner_id;
 delete from public.peris_garrisons where owner_id=city.owner_id and(col||':'||row)=any(old_fields);
 select count(*),min(id)into living,backup from public.settlements where owner_id=city.owner_id and ruined_at is null;
 if living=0 then
  update public.players set defeated_at=coalesce(defeated_at,now())where id=city.owner_id;
  delete from public.peris_ruin_evacuations where owner_id=city.owner_id;
  delete from public.peris_city_reinforcements where owner_id=city.owner_id;
  delete from public.peris_guild_reinforcements where owner_id=city.owner_id;
  delete from public.peris_garrisons where owner_id=city.owner_id;
  delete from public.peris_city_garrisons where owner_id=city.owner_id;
  delete from public.peris_orders where owner_id=city.owner_id;
  update public.peris_settler_expeditions set status='returned'where owner_id=city.owner_id and status='travelling';
  update public.peris_campaign_farms set enabled=false where owner_id=city.owner_id;
  for a in select * from public.armies where owner_id=city.owner_id order by id for update loop
   perform public.peris_write_roster(a.id,public.peris_roster('{}'));
   update public.armies set status='idle',raid_city_id=null,raid_target_id=null,raid_reserve=null,march_path=null,march_distance=null,march_origin=null,march_returning=false,march_sent_at=null,march_cancel_until=null,carried_loot=null,updated_at=now()where id=a.id;
  end loop;
 else
  update public.peris_settler_expeditions set origin_settlement_id=backup
  where owner_id=city.owner_id and origin_settlement_id=city.id and status='travelling';
  for a in select * from public.armies where owner_id=city.owner_id order by id for update loop
   pos:=public.peris_army_position(a);
   if(floor(a.target_x/128.0)::integer||':'||floor(a.target_y/128.0)::integer)=any(old_fields)or(a.status='idle'and(floor((pos->>'x')::numeric/128.0)::integer||':'||floor((pos->>'y')::numeric/128.0)::integer)=any(old_fields))then
    -- The current city battle has finished applying casualties. Its native survivors can leave.
    route:=public.peris_ruin_route(city.owner_id,round((pos->>'x')::numeric)::integer,round((pos->>'y')::numeric)::integer);
    if route is not null then
     update public.armies set home_settlement_id=case when home_settlement_id=city.id then(route->>'city_id')::bigint else home_settlement_id end,
      start_x=round((pos->>'x')::numeric)::integer,start_y=round((pos->>'y')::numeric)::integer,target_x=(route->>'x')::integer,target_y=(route->>'y')::integer,
      march_path=route->'path',march_distance=(route->>'distance')::numeric,march_map_version=4,status='moving',raid_city_id=null,raid_target_id=null,raid_reserve=null,march_origin=null,march_returning=true,march_sent_at=null,march_cancel_until=null,
      departure_at=p_at,arrival_at=p_at+make_interval(secs=>greatest(2,(route->>'distance')::numeric/greatest(1,public.peris_march_speed(a.id)))::double precision),updated_at=now()where id=a.id;
    else perform public.peris_write_roster(a.id,'{}');end if;
   elsif a.home_settlement_id=city.id then update public.armies set home_settlement_id=backup where id=a.id;
   end if;
  end loop;
 end if;
 -- Arrival functions retain the original recipient/sender and reroute in-flight cargo.
 update public.peris_trade_routes set enabled=false,deliveries_left=0,last_status='City ownership changed',updated_at=p_at
 where enabled and(source_settlement_id=city.id or target_settlement_id=city.id);
 perform public.peris_city_economy(city.id);
 return receipt||jsonb_build_object('captured',true,'culture_cost',cost,'new_owner_id',p_attacker);
end $$;
revoke all on function public.peris_apply_city_conquest(bigint,uuid,integer,timestamptz)from public,anon,authenticated;

create or replace function public.peris_account_faction(p_owner uuid)returns text language plpgsql stable security definer set search_path='' as $$
begin
 return coalesce((select research_faction from public.players where id=p_owner),(select faction from public.settlements where owner_id=p_owner order by id limit 1),'roman');
end
$$;
create or replace function public.peris_research_bonus(p_owner uuid,p_key text)returns numeric language sql stable security definer set search_path='' as $$
 select least(3,coalesce(sum((c.effects->>p_key)::numeric),0))from public.peris_research_progress p join public.peris_technology_catalog c on c.id=p.technology_id
 where p.owner_id=p_owner and p.completed_at is not null and (c.faction is null or c.faction=public.peris_account_faction(p_owner))
$$;
create or replace function public.peris_research_command(p_command jsonb)returns jsonb language plpgsql security definer set search_path='' as $$
declare u uuid:=public.peris_player_id();s public.peris_account_science%rowtype;c public.peris_technology_catalog%rowtype;p public.peris_research_progress%rowtype;kind text:=p_command->>'type';
begin
 if u is null then raise exception 'Authentication required';end if;
 perform public.peris_science_advance(u,public.peris_game_now());select * into s from public.peris_account_science where owner_id=u for update;
 if kind='pauseResearch'then perform public.peris_research_pause(u,public.peris_game_now());
 elsif kind='debugResearch'then
  if not coalesce((select enabled from public.peris_debug_config where id),false)then raise exception 'Debug controls are disabled';end if;
  if p_command->>'action'='points'then update public.peris_account_science set points=least(1000000000,points+10000)where owner_id=u;
  elsif p_command->>'action'='complete'then
   if s.active_id is null then raise exception 'Start a technology first';end if;
   update public.peris_research_progress p set seconds=c.seconds from public.peris_technology_catalog c where c.id=s.active_id and p.owner_id=u and p.technology_id=c.id;
   update public.peris_account_science set active_since=public.peris_game_now()where owner_id=u;perform public.peris_science_advance(u,public.peris_game_now());
  else raise exception 'Unknown research debug action';end if;
 elsif kind='startResearch'then
  select * into c from public.peris_technology_catalog where id=p_command->>'technologyId';
  if c.id is null then raise exception 'Unknown technology';end if;
  if c.faction is not null and c.faction is distinct from public.peris_account_faction(u)then raise exception 'This technology belongs to another faction';end if;
  select * into p from public.peris_research_progress where owner_id=u and technology_id=c.id;
  if p.completed_at is not null then raise exception 'Already researched';end if;
  if exists(select 1 from jsonb_array_elements_text(c.prerequisites)r(id)where not exists(select 1 from public.peris_research_progress where owner_id=u and technology_id=r.id and completed_at is not null))then raise exception 'Research the prerequisites first';end if;
  if s.active_id=c.id then return jsonb_build_object('ok',true);end if;
  if p.technology_id is null and s.points<c.cost then raise exception 'You need % science points',c.cost;end if;
  perform public.peris_research_pause(u,public.peris_game_now());
  if p.technology_id is null then update public.peris_account_science set points=points-c.cost where owner_id=u;insert into public.peris_research_progress(owner_id,technology_id)values(u,c.id);end if;
  update public.peris_account_science set active_id=c.id,active_since=public.peris_game_now(),active_rate=public.peris_research_factor(u,'research_speed')where owner_id=u;
 else raise exception 'Unknown research command';end if;
 return jsonb_build_object('ok',true);
end $$;
create or replace function public.peris_set_faction(p_faction text)returns void language plpgsql security definer set search_path='' as $$
declare u uuid:=public.peris_player_id();city record;active_faction text;
begin
 if u is null then raise exception 'Authentication required';end if;
 if p_faction is null or p_faction not in ('roman','spartan','persian','egyptian','orc','elf','dwarf','gnome','pandaren','undead','demon')then raise exception 'Unknown faction';end if;
 perform public.peris_settle(u);
 if public.peris_city_id(u)=(select min(id)from public.settlements where owner_id=u)then
  select c.faction into active_faction from public.peris_account_science s join public.peris_technology_catalog c on c.id=s.active_id where s.owner_id=u;
  if active_faction is not null and active_faction<>p_faction then perform public.peris_research_pause(u,public.peris_game_now());end if;
  update public.players set research_faction=p_faction where id=u;
 end if;
 update public.settlements set faction=p_faction where id=public.peris_city_id(u);if not found then raise exception 'Settlement missing';end if;
 for city in select id from public.settlements where owner_id=u order by id loop perform public.peris_city_economy(city.id);end loop;
end $$;
create or replace function public.peris_garrison_collect_for(p_owner uuid,p_army bigint,p_troops jsonb default null)returns jsonb language plpgsql security definer set search_path='' as $$
declare a public.armies%rowtype;g public.peris_garrisons%rowtype;v_col integer;v_row integer;capacity integer;available jsonb;preset jsonb:='{}';unit_name text;amount integer;
begin
 select * into a from public.armies where id=p_army and owner_id=p_owner for update;
 if a.id is null then raise exception 'Choose one of your armies';end if;
 if a.status<>'idle' or a.raid_target_id is not null or a.raid_city_id is not null or exists(select 1 from public.battles b where b.status='active'and(b.attacker_army_id=a.id or b.defender_army_id=a.id))then raise exception 'Bring an idle legion to this station before collecting troops';end if;
 if exists(select 1 from public.peris_orders o where o.owner_id=p_owner and o.kind='recruit'and coalesce(o.army_id,(select min(id)from public.armies where owner_id=p_owner))=a.id)then raise exception 'Finish training before collecting stationed troops';end if;
 v_col:=public.peris_wrap_cell(floor(a.target_x/128.0)::integer);v_row:=public.peris_wrap_cell(floor(a.target_y/128.0)::integer);
 if not public.peris_station_owned(p_owner,v_col,v_row)then raise exception 'Troops can only station in your own villages and fields';end if;
 select * into g from public.peris_garrisons where owner_id=p_owner and col=v_col and row=v_row for update;
 if g.owner_id is null then
  if p_troops is not null and public.peris_roster_total(p_troops)>0 then raise exception 'No stationed troops are available here';end if;
  return public.peris_roster('{}');
 end if;
 available:=public.peris_roster(to_jsonb(g));capacity:=greatest(0,1000-a.infantry-a.archers-a.cavalry);
 if p_troops is not null then preset:=public.peris_garrison_troops(p_troops);if public.peris_roster_total(preset)>capacity then raise exception 'Choose available stationed troops within the legion capacity';end if;end if;
 foreach unit_name in array array['infantry','spearmen','archers','elite','cavalry','scout','heavyCavalry','ram','catapult','diplomat']loop
  amount:=case when p_troops is null then least(capacity,(available->>unit_name)::integer)else(preset->>unit_name)::integer end;
  if amount>(available->>unit_name)::integer then raise exception 'Choose available stationed troops within the legion capacity';end if;
  preset:=preset||jsonb_build_object(unit_name,amount);capacity:=capacity-amount;
 end loop;
 perform public.peris_write_roster(a.id,public.peris_roster_add(public.peris_roster(to_jsonb(a)),preset));
 available:=public.peris_roster_add(available,preset,-1);
 update public.peris_garrisons set unit_roster=available,infantry=public.peris_roster_class(available,'infantry'),archers=public.peris_roster_class(available,'archers'),cavalry=public.peris_roster_class(available,'cavalry')where owner_id=p_owner and col=v_col and row=v_row;
 delete from public.peris_garrisons where owner_id=p_owner and col=v_col and row=v_row and infantry=0 and archers=0 and cavalry=0;
 return preset;
end $$;
create or replace function public.peris_collect_garrison(p_army bigint,p_troops jsonb default null)
returns jsonb language plpgsql security definer set search_path='' as $$
declare u uuid:=public.peris_player_id();
begin
 if u is null then raise exception 'Authentication required';end if;
 if exists(select 1 from public.battles where status='active'and(attacker_owner_id=u or defender_owner_id=u))then raise exception 'Finish the current battle first';end if;
 return public.peris_garrison_collect_for(u,p_army,p_troops);
end $$;
create or replace function public.peris_cancel_march(p_army bigint,p_sent_at timestamptz)returns jsonb
language plpgsql security definer set search_path='' as $$
declare u uuid:=public.peris_player_id();a public.armies%rowtype;
begin
 if u is null then raise exception 'Authentication required';end if;
 perform public.peris_settle(u);
 select * into a from public.armies where id=p_army and owner_id=u for update;
 if a.id is null then raise exception 'Choose one of your armies';end if;
 if p_sent_at is null or a.march_sent_at is distinct from p_sent_at then raise exception 'This march is no longer the same order';end if;
 if a.status<>'moving' or a.march_cancel_until is null or public.peris_game_now()>=a.march_cancel_until or public.peris_game_now()<a.march_sent_at then
  raise exception 'Marches can only be cancelled during the first 30 seconds';
 end if;
 perform public.peris_restore_raid_reserve(a.id);
 update public.armies set status='idle',raid_target_id=null,raid_city_id=null,siege_target='auto',target_x=start_x,target_y=start_y,
  departure_at=public.peris_game_now(),arrival_at=public.peris_game_now(),march_path=null,march_distance=null,march_sent_at=null,march_cancel_until=null,march_origin=null,march_returning=false,updated_at=now()
  where id=a.id;
 perform public.peris_garrison_merge(a.id);
 return jsonb_build_object('ok',true);
end $$;
create or replace function public.peris_prepare_raid_for(p_owner uuid,p_army bigint,p_camp integer,p_path jsonb default null,p_troops jsonb default null)returns jsonb
language plpgsql security definer set search_path='' as $$
declare u uuid:=p_owner;a public.armies%rowtype;c public.peris_camps%rowtype;inf integer;arc integer;cav integer;route jsonb;steps integer;i integer;available jsonb;preset jsonb;unit_name text;
begin
 if u is null then raise exception 'Authentication required';end if;
 perform public.peris_settle(u);
 select * into a from public.armies where id=p_army and owner_id=u for update;
 select * into c from public.peris_camps where id=p_camp;
 if c.id is null then raise exception 'Camp not found';end if;
 if a.id is null or a.infantry+a.archers+a.cavalry=0 then raise exception 'Recruit soldiers before starting a raid';end if;
 if a.status<>'idle' or a.raid_target_id is not null or a.raid_city_id is not null or a.raid_reserve is not null then raise exception 'This legion already has a march or raid';end if;
 available:=public.peris_roster(to_jsonb(a));preset:=available;
 if p_troops is not null then
  if jsonb_typeof(p_troops)<>'object' then raise exception 'Choose troops currently available in this legion';end if;
  available:=public.peris_roster(to_jsonb(a));preset:=public.peris_garrison_troops(p_troops);
  foreach unit_name in array array['infantry','spearmen','archers','elite','cavalry','scout','heavyCavalry','ram','catapult','diplomat']loop
   if (preset->>unit_name)::integer>(available->>unit_name)::integer then raise exception 'Choose troops currently available in this legion';end if;
  end loop;
  if public.peris_roster_total(preset)=0 then raise exception 'Send at least one soldier';end if;
 end if;
 route:=p_path;
 if route is null then
  steps:=greatest(1,ceil(greatest(abs(public.peris_wrapped_delta(a.target_x,c.x)),abs(public.peris_wrapped_delta(a.target_y,c.y)))/64)::integer);
  route:=jsonb_build_array(jsonb_build_array(a.target_x,a.target_y));
  for i in 1..steps loop route:=route||jsonb_build_array(jsonb_build_array(public.peris_wrap_world(round(a.target_x+public.peris_wrapped_delta(a.target_x,c.x)*i/steps)::integer),public.peris_wrap_world(round(a.target_y+public.peris_wrapped_delta(a.target_y,c.y)*i/steps)::integer)));end loop;
 end if;
 if public.peris_roster_total(preset)>0 and public.peris_roster_total(preset)=coalesce((preset->>'scout')::integer,0)and to_regprocedure('public.peris_scout_command_for(uuid,jsonb)')is not null then
  return public.peris_scout_command_for(u,jsonb_build_object('type','scout','armyId',a.id,'campId',c.id,'quantity',(preset->>'scout')::integer,'mode','resources','route',route));
 end if;
 if not c.bandit and exists(select 1 from public.peris_progress where owner_id=u and camp_id=p_camp and available_at>public.peris_game_now())then raise exception 'The camp is still regrouping';end if;
 perform public.peris_march_for(u,a.id,c.x,c.y,route,c.id);
 update public.armies set raid_target_id=c.id where id=a.id;
 if p_troops is not null then
  perform public.peris_garrison_add(u,floor(a.target_x/128.0)::integer,floor(a.target_y/128.0)::integer,public.peris_roster_add(available,preset,-1));
  perform public.peris_write_roster(a.id,preset);
  -- The route was validated before selecting troops. Recompute the accepted deadline for the chosen party.
  update public.armies set arrival_at=departure_at+make_interval(secs=>greatest(2,march_distance/public.peris_march_speed(id))::double precision)where id=a.id;
 end if;
 return jsonb_build_object('ok',true);
end $$;
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
 foreach unit_name in array array['infantry','spearmen','archers','elite','cavalry','scout','heavyCavalry','ram','catapult','diplomat']loop
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
 foreach role in array array['infantry','spearmen','archers','elite','cavalry','scout','heavyCavalry','ram','catapult','diplomat']loop
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
 foreach role in array array['infantry','spearmen','archers','elite','cavalry','scout','heavyCavalry','ram','catapult','diplomat']loop
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
create or replace function public.peris_add_formations(p_battle bigint,p_owner uuid,p_side text,p_inf integer,p_arc integer,p_cav integer,p_morale numeric)
returns void language plpgsql security definer set search_path='' as $$
declare unit_name text;typ text;n integer;total integer;i integer;amount integer;px numeric;py numeric;cap integer;roster jsonb;rule public.peris_unit_catalog;aid bigint;v integer;faction text;stats jsonb;
begin
 select case when p_side='attacker' then attacker_army_id else defender_army_id end into aid from public.battles where id=p_battle;
 select balance_version,case when p_side='attacker'then coalesce(attacker_faction,'roman')else coalesce(defender_faction,'roman')end into v,faction from public.battles where id=p_battle;
 select public.peris_roster(to_jsonb(a))into roster from public.armies a where a.id=aid and a.owner_id=p_owner;
 roster:=coalesce(roster,public.peris_roster(jsonb_build_object('infantry',p_inf,'archers',p_arc,'cavalry',p_cav)));
 if p_side='defender'and exists(select 1 from public.battles where id=p_battle and raid_city_id is not null)then roster:=public.peris_city_defender_roster(p_battle);end if;
 foreach unit_name in array array['infantry','spearmen','archers','elite','cavalry','scout','heavyCavalry','ram','catapult','diplomat']loop
 select * into rule from public.peris_unit_catalog where unit=unit_name;typ:=rule.combat_class;total:=(roster->>unit_name)::integer;
 stats:=public.peris_unit_stats(unit_name,faction,v);
 cap:=case typ when 'infantry' then 60 when 'archers' then 40 else 24 end;
 n:=least(6,ceil(total::numeric/cap)::integer);if n<=0 then continue;end if;
 for i in 0..n-1 loop
 amount:=total/n+case when i<total%n then 1 else 0 end;
 px:=case when p_side='attacker' then case when typ='infantry'then 285 when typ='cavalry'then 205 else 175 end else case when typ='infantry'then 915 when typ='cavalry'then 995 else 1025 end end;
 px:=px+600*(sqrt(5)-1);
 py:=case when typ='cavalry' then case when i%2=0 then 75+(i/2)*65 else 625-(i/2)*65 end else round(350+(i-(n-1)/2.0)*least(105,490.0/greatest(1,n-1))) end;
 py:=py+350*(sqrt(5)-1);
 insert into public.battle_formations(battle_id,owner_id,side,unit_type,recruit_unit,unit_attack,unit_defence,unit_speed,label,initial_soldiers,soldiers,morale,x,y,target_x,target_y,facing,columns)
 values(p_battle,p_owner,p_side,typ,unit_name,(stats->>'attack')::numeric,(stats->>'defence')::numeric,rule.speed::numeric/case typ when 'infantry'then 40 when 'archers'then 34 else 76 end,unit_name||' '||(i+1),amount,amount,least(100,p_morale),px,py,px,py,case when p_side='attacker' then 0 else 180 end,case when typ='cavalry' then 6 else 10 end);
 end loop;end loop;
 -- Advanced formations share the same class lane without spawning on top of one another.
 if exists(select 1 from public.battle_formations where battle_id=p_battle and side=p_side and recruit_unit not in('infantry','archers','cavalry'))then
  with lanes as(select id,row_number()over(partition by unit_type order by id)-1 as i,count(*)over(partition by unit_type)as n from public.battle_formations where battle_id=p_battle and side=p_side)
  update public.battle_formations f set y=350*sqrt(5)+(l.i-(l.n-1)/2.0)*least(105,490.0/greatest(1,l.n-1)),target_y=350*sqrt(5)+(l.i-(l.n-1)/2.0)*least(105,490.0/greatest(1,l.n-1))from lanes l where f.id=l.id;
 end if;
 perform public.peris_apply_hero(p_battle,p_owner,p_side);
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

 available:=public.peris_roster(to_jsonb(a));chosen:=public.peris_garrison_troops(coalesce(nullif(p_troops,'null'::jsonb),available));
 if public.peris_roster_total(chosen)=0 then raise exception 'Send at least one soldier';end if;
 foreach unit_name in array array['infantry','spearmen','archers','elite','cavalry','scout','heavyCavalry','ram','catapult','diplomat']loop
  if(chosen->>unit_name)::integer>(available->>unit_name)::integer then raise exception 'Choose troops currently available in this legion';end if;
 end loop;
 if public.peris_roster_total(chosen)=coalesce((chosen->>'scout')::integer,0)and to_regprocedure('public.peris_scout_command_for(uuid,jsonb)')is not null then
  return public.peris_scout_command_for(p_owner,jsonb_build_object('type','scout','armyId',a.id,'targetCityId',c.id,'quantity',(chosen->>'scout')::integer,'mode','resources','route',p_path));
 end if;
 if public.peris_social_relation(p_owner,c.owner_id)in('guild','alliance','nap')then raise exception 'Your guild or diplomatic pact protects this city';end if;
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
create or replace function public.peris_finish_city_raid(p_bid bigint,p_winner text,p_reason text)returns void
language plpgsql security definer set search_path='' as $$
declare b public.battles%rowtype;c public.settlements%rowtype;a public.armies%rowtype;party jsonb;initial jsonb;survivors jsonb;def_initial jsonb;def_remaining jsonb;current_roster jsonb;losses jsonb;cumulative jsonb:=public.peris_roster('{}');engines jsonb;loot jsonb:=jsonb_build_object('wood',0,'stone',0,'food',0,'gold',0);r jsonb;damage jsonb;reward jsonb;receipt jsonb;conquest jsonb;unit_name text;key text;lost integer;start_count integer;party_count integer;total integer;ai integer;di integer;asur integer;dsur integer;carry numeric;owner uuid;winner uuid;commander bigint;side text;g public.peris_garrisons%rowtype;
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
  foreach unit_name in array array['infantry','spearmen','archers','elite','cavalry','scout','heavyCavalry','ram','catapult','diplomat']loop
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

 select coalesce(sum(f.soldiers*u.carry),0)into carry from public.battle_formations f join public.peris_unit_catalog u on u.unit=coalesce(f.recruit_unit,f.unit_type)where f.battle_id=b.id and f.side='attacker';
 carry:=floor(carry*public.peris_research_factor(b.attacker_owner_id,'carry'));
 if p_winner='attacker'and c.owner_id=b.defender_owner_id and c.ruined_at is null then
  -- Take loot before siege: destroying the last building clears all city stores.
  -- Keep the local game's ordering and never debit a pre-siege snapshot afterward.
  loot:=public.peris_take_camp_loot(jsonb_build_object('wood',floor(c.wood),'stone',floor(c.stone),'food',floor(c.food),'gold',floor(c.gold)),carry);
  update public.settlements set wood=wood-(loot->>'wood')::numeric,stone=stone-(loot->>'stone')::numeric,food=food-(loot->>'food')::numeric,gold=gold-(loot->>'gold')::numeric where id=c.id;
  select public.peris_roster(coalesce(jsonb_object_agg(unit,n),'{}'))into engines from(select coalesce(f.recruit_unit,f.unit_type)unit,sum(f.soldiers)n from public.battle_formations f where f.battle_id=b.id and f.side='attacker'and f.status<>'routed'group by coalesce(f.recruit_unit,f.unit_type))q;
  engines:=jsonb_set(jsonb_set(engines,'{ram}',to_jsonb(floor((engines->>'ram')::integer*public.peris_research_factor(b.attacker_owner_id,'siege'))::integer)),'{catapult}',to_jsonb(floor((engines->>'catapult')::integer*public.peris_research_factor(b.attacker_owner_id,'siege'))::integer));
  damage:=public.peris_damage_city(c.id,engines,b.siege_target);
  if coalesce((initial->>'diplomat')::integer,0)>0 and to_regprocedure('public.peris_apply_city_conquest(bigint,uuid,integer,timestamp with time zone)')is not null then
   conquest:=public.peris_apply_city_conquest(c.id,b.attacker_owner_id,coalesce((survivors->>'diplomat')::integer,0),public.peris_game_now());
  end if;
  if coalesce((conquest->>'captured')::boolean,false)then
   -- Captured cities retain their resources; no loot leaves with the attacker.
   update public.settlements set wood=wood+(loot->>'wood')::numeric,stone=stone+(loot->>'stone')::numeric,food=food+(loot->>'food')::numeric,gold=gold+(loot->>'gold')::numeric where id=c.id;
   loot:=jsonb_build_object('wood',0,'stone',0,'food',0,'gold',0);
  end if;
 else
  damage:='[]';
  if coalesce((initial->>'diplomat')::integer,0)>0 and to_regclass('public.peris_conquest_version')is not null then
   conquest:=jsonb_build_object('city_id',c.id,'before',c.loyalty,'after',c.loyalty,'diplomats',coalesce((survivors->>'diplomat')::integer,0),'reduction',0,'captured',false,'culture_cost',0,'former_owner_id',b.defender_owner_id,'reason',case when c.ruined_at is not null then 'city_ruined'when c.owner_id<>b.defender_owner_id then 'ownership_changed'else 'attacker_did_not_win'end);
  end if;
 end if;
 if coalesce((conquest->>'captured')::boolean,false)then
  current_roster:=jsonb_set(current_roster,'{diplomat}',to_jsonb(greatest(0,(current_roster->>'diplomat')::integer-1)));
  -- Old campaign reserves did not participate. Keep them at the original owned home.
  if public.peris_roster_total(coalesce(a.raid_reserve,'{}'))>0 then
   perform public.peris_garrison_add(b.attacker_owner_id,floor(s.x/128.0)::integer,floor(s.y/128.0)::integer,a.raid_reserve)
   from public.settlements s where s.id=a.home_settlement_id and s.owner_id=b.attacker_owner_id and s.ruined_at is null;
  end if;
  perform public.peris_write_roster(a.id,current_roster);
 else perform public.peris_write_roster(a.id,public.peris_roster_add(current_roster,coalesce(a.raid_reserve,'{}')));end if;
 winner:=case p_winner when 'attacker'then b.attacker_owner_id when 'defender'then b.defender_owner_id end;
 r:=jsonb_build_object('balance_version',b.balance_version,'attacker_initial',ai,'defender_initial',di,'attacker_survivors',asur,'defender_survivors',dsur,'attacker_losses',ai-asur,'defender_losses',di-dsur,'attacker_roster',initial,'attacker_survivor_roster',survivors,'defender_roster',def_initial,'defender_survivor_roster',def_remaining,'attacker_faction',coalesce(b.attacker_faction,(select faction from public.settlements where id=a.home_settlement_id)),'defender_faction',coalesce(b.defender_faction,c.faction),'loot',loot,'duration',round(b.elapsed),'reason',p_reason,'carrying_capacity',carry,'replacement_cost',public.peris_roster_loss_cost(initial,survivors,b.balance_version),'raid_city',jsonb_build_object('id',c.id,'name',c.name),'siege_damage',damage,
   'city_ruined',exists(select 1 from public.settlements where id=c.id and ruined_at is not null));
 if conquest is not null then r:=r||jsonb_build_object('conquest',conquest);end if;
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
 if coalesce((conquest->>'captured')::boolean,false)then
  update public.armies set start_x=(public.peris_home_army_position(c.x,c.y)->>'x')::integer,start_y=(public.peris_home_army_position(c.x,c.y)->>'y')::integer,
   target_x=(public.peris_home_army_position(c.x,c.y)->>'x')::integer,target_y=(public.peris_home_army_position(c.x,c.y)->>'y')::integer,
   departure_at=public.peris_game_now(),arrival_at=public.peris_game_now(),march_path=null,march_distance=null,march_returning=false,march_origin=null,carried_loot=null,loot_report_id=null where id=a.id;
 elsif not public.peris_return_raid(a.id)then
  update public.armies set start_x=(public.peris_home_army_position(s.x,s.y)->>'x')::integer,start_y=(public.peris_home_army_position(s.x,s.y)->>'y')::integer,target_x=(public.peris_home_army_position(s.x,s.y)->>'x')::integer,target_y=(public.peris_home_army_position(s.x,s.y)->>'y')::integer,march_path=null,march_distance=null,march_returning=false from public.settlements s where armies.id=a.id and s.id=a.home_settlement_id;
  perform public.peris_deliver_loot(a.id);
 end if;
end $$;
create or replace function public.peris_found_complete(p_id bigint)returns void language plpgsql security definer set search_path='' as $$
declare e public.peris_settler_expeditions%rowtype;s public.settlements%rowtype;sid bigint;reason text;
begin
 select * into e from public.peris_settler_expeditions where id=p_id for update;if e.id is null or e.status<>'travelling'then return;end if;
 if not exists(select 1 from public.settlements where id=e.origin_settlement_id and owner_id=e.owner_id and ruined_at is null)or exists(select 1 from public.players where id=e.owner_id and defeated_at is not null)then
  update public.peris_settler_expeditions set status='returned'where id=e.id;
  select * into s from public.settlements where owner_id=e.owner_id and ruined_at is null order by id limit 1 for update;
  if s.id is not null then
   perform public.peris_population_accrue(s.id,e.arrival_at);
   update public.settlements set settlers=least(6,settlers+3),wood=least(capacity,wood+500),stone=least(capacity,stone+400),food=least(food_capacity,food+600),gold=least(capacity,gold+150)where id=s.id and owner_id=e.owner_id;
   update public.players set culture_points=least(1000000000,culture_points+e.culture_cost)where id=e.owner_id;
  end if;return;
 end if;
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
 if to_regprocedure('public.peris_loyalty_accrue(bigint,timestamp with time zone)')is not null then perform public.peris_loyalty_accrue(s.id,p_until);end if;
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
create or replace function public.peris_settle(p_owner uuid,p_until timestamptz default public.peris_game_now())returns void
language plpgsql security definer set search_path='' as $$
begin
 if to_regprocedure('public.peris_market_settle(uuid,timestamp with time zone)')is not null then
  perform public.peris_market_settle(p_owner,p_until);
 else perform public.peris_settle_core(p_owner,p_until);end if;
end $$;
create or replace function public.peris_snapshot()returns jsonb language plpgsql security definer set search_path='' as $$
declare u uuid:=public.peris_player_id();result jsonb;
begin
 if u is null then raise exception 'Authentication required';end if;
 perform public.peris_note_account_activity();
 perform public.peris_science_ensure(u);
 if to_regprocedure('public.peris_loyalty_accrue(bigint,timestamp with time zone)')is not null then perform public.peris_loyalty_accrue(s.id,public.peris_game_now())from public.settlements s where s.owner_id=u;end if;
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
 if to_regclass('public.peris_conquest_version')is not null then result:=result||jsonb_build_object('conquest_version',1);end if;
 if to_regclass('public.peris_scout_missions')is not null and to_regclass('public.peris_crop_version')is not null then
  result:=result||jsonb_build_object('scouting_version',1);
  execute 'select $1||jsonb_build_object(''scouting_missions'',coalesce((select jsonb_agg(to_jsonb(m)order by m.id)from public.peris_scout_missions m where owner_id=$2 and(status in(''outbound'',''returning'')or id in(select id from public.peris_scout_missions where owner_id=$2 and status in(''completed'',''cancelled'')order by id desc limit 200))),''[]''::jsonb))'into result using result,u;
 end if;
 return result;
end $$;
revoke all on function public.peris_account_faction(uuid)from public,anon,authenticated;
revoke all on function public.peris_add_formations(bigint,uuid,text,integer,integer,integer,numeric),public.peris_prepare_city_raid(uuid,bigint,bigint,jsonb,jsonb,text),public.peris_start_city_raid(uuid,bigint),public.peris_finish_city_raid(bigint,text,text),public.peris_found_complete(bigint),public.peris_settle_core(uuid,timestamptz),public.peris_settle(uuid,timestamptz)from public,anon,authenticated;$conquest_definition$;end if;end $restore_conquest$;

do $restore_scouting$begin if to_regclass('public.peris_scout_missions')is not null and to_regclass('public.peris_crop_version')is not null then execute $scouting_definition$-- Optional hooks keep earlier focused migrations usable without enabling scouting.
create or replace function public.peris_optional_scout_missions()returns table(id bigint,owner_id uuid,target_owner_id uuid,source_settlement_id bigint,target_city_id bigint,status text,scouts integer,departure_at timestamptz,arrival_at timestamptz)
language plpgsql stable security definer set search_path='' as $$
begin
 if to_regclass('public.peris_scout_missions')is not null then return query execute 'select id,owner_id,target_owner_id,source_settlement_id,target_city_id,status,scouts,departure_at,arrival_at from public.peris_scout_missions where status in(''outbound'',''returning'')';end if;
end $$;
create or replace function public.peris_scout_edges()returns table(owner_id uuid,recipient_id uuid)
language plpgsql stable security definer set search_path='' as $$
begin
 return query select m.owner_id,m.target_owner_id from public.peris_optional_scout_missions()m where m.target_owner_id is not null
 union select m.owner_id,s.owner_id from public.peris_optional_scout_missions()m join public.settlements s on s.id=m.target_city_id;
 if to_regclass('public.peris_scout_missions')is not null then
  return query execute 'select m.owner_id,a.owner_id from public.peris_scout_missions m join public.armies a on a.raid_target_id=m.target_camp_id where m.status=''outbound''
   union select m.owner_id,b.attacker_owner_id from public.peris_scout_missions m join public.battles b on b.camp_id=m.target_camp_id and b.status=''active''where m.status=''outbound''
   union select m.owner_id,n.owner_id from public.peris_scout_missions m join public.peris_scout_missions n on n.target_camp_id=m.target_camp_id and n.id>m.id where m.status=''outbound''and n.status=''outbound''';
 end if;
end $$;
create or replace function public.peris_due_scouts()returns table(owner_id uuid,due timestamptz)
language sql stable security definer set search_path='' as $$select owner_id,min(arrival_at)from public.peris_optional_scout_missions()where arrival_at<=public.peris_game_now()group by owner_id$$;
create or replace function public.peris_optional_advance_scouts(p_owners uuid[],p_at timestamptz)returns void
language plpgsql security definer set search_path='' as $$
begin if to_regprocedure('public.peris_scout_advance(uuid[],timestamp with time zone)')is not null then execute 'select public.peris_scout_advance($1,$2)'using p_owners,p_at;end if;end $$;
revoke all on function public.peris_optional_scout_missions(),public.peris_scout_edges(),public.peris_due_scouts(),public.peris_optional_advance_scouts(uuid[],timestamptz)from public,anon,authenticated;

create or replace function public.peris_scout_camp_cutoff(p_camp integer,p_until timestamptz)returns timestamptz
language plpgsql stable security definer set search_path='' as $$
declare cutoff timestamptz;
begin
 if to_regclass('public.peris_scout_missions')is not null then execute 'select min(arrival_at)from public.peris_scout_missions where target_camp_id=$1 and status=''outbound'''into cutoff using p_camp;end if;
 return least(p_until,coalesce(cutoff,p_until));
end $$;
revoke all on function public.peris_scout_camp_cutoff(integer,timestamptz)from public,anon,authenticated;

create or replace function public.peris_optional_scout_camp_mutation(p_camp integer,p_at timestamptz,p_owner uuid)returns void
language plpgsql security definer set search_path='' as $$
begin if p_camp is not null and to_regprocedure('public.peris_scout_flush_camp(integer,timestamp with time zone,uuid)')is not null then execute 'select public.peris_scout_flush_camp($1,$2,$3)'using p_camp,p_at,p_owner;end if;end $$;
revoke all on function public.peris_optional_scout_camp_mutation(integer,timestamptz,uuid)from public,anon,authenticated;

-- Separate private scout detachments. Resolved battle rows are report receipts only.
create table if not exists public.peris_scout_missions(
 id bigint generated always as identity primary key,
 owner_id uuid not null references public.players(id)on delete cascade,
 source_settlement_id bigint not null references public.settlements(id),source_army_id bigint not null references public.armies(id),
 target_city_id bigint references public.settlements(id),target_camp_id integer references public.peris_camps(id),target_owner_id uuid references public.players(id),
 target_name text not null,faction text not null,mode text not null check(mode in('resources','defences')),
 initial_scouts integer not null check(initial_scouts between 1 and 1000),scouts integer not null check(scouts between 0 and 1000),
 status text not null default 'outbound'check(status in('outbound','returning','completed','cancelled')),
 origin_x integer not null,origin_y integer not null,target_x integer not null,target_y integer not null,
 sent_at timestamptz not null,departure_at timestamptz not null,arrival_at timestamptz not null,cancel_until timestamptz not null,
 march_path jsonb not null,march_distance numeric not null,report_battle_id bigint references public.battles(id),
 check((target_city_id is null)<>(target_camp_id is null)),check(scouts<=initial_scouts),check(arrival_at>=departure_at)
);
alter table public.battles drop constraint if exists peris_scout_receipt_only;
alter table public.battles add constraint peris_scout_receipt_only check(mode<>'scouting'or(status='resolved'and defender_owner_id is null and defender_army_id is null));
create index if not exists peris_scout_due on public.peris_scout_missions(owner_id,arrival_at)where status in('outbound','returning');
create index if not exists peris_scout_inbound on public.peris_scout_missions(target_owner_id,arrival_at)where status='outbound';
alter table public.peris_scout_missions enable row level security;
revoke all on public.peris_scout_missions from public,anon,authenticated;
grant select on public.peris_scout_missions to authenticated;
drop policy if exists "own scout missions"on public.peris_scout_missions;
create policy "own scout missions"on public.peris_scout_missions for select to authenticated using(owner_id=public.peris_player_id());

create or replace function public.peris_scout_speed(p_owner uuid)returns numeric
language sql stable security definer set search_path='' as $$select 22.0*speed/40*public.peris_research_factor(p_owner,'march')from public.peris_unit_catalog where unit='scout'$$;
create or replace function public.peris_scout_smithy(p_city bigint,p_owner uuid)returns numeric
language sql stable security definer set search_path='' as $$select 1+.04*coalesce(sum(c.level),0)from public.peris_city_slots c join public.settlements s on s.id=c.settlement_id where s.id=p_city and s.owner_id=p_owner and s.ruined_at is null and c.building_type='smithy'$$;

-- Return credits use the same authoritative city ownership and legion capacity checks.
create or replace function public.peris_scout_deliver(p_id bigint,p_city bigint)returns void
language plpgsql security definer set search_path='' as $$
declare m public.peris_scout_missions%rowtype;a public.armies%rowtype;s public.settlements%rowtype;room integer;merged integer:=0;pos jsonb;home jsonb;
begin
 select * into m from public.peris_scout_missions where id=p_id for update;
 select * into s from public.settlements where id=p_city and owner_id=m.owner_id and ruined_at is null for update;
 if s.id is null or m.scouts=0 then return;end if;
 select * into a from public.armies where id=m.source_army_id and owner_id=m.owner_id for update;
 pos:=public.peris_army_position(a);home:=public.peris_home_army_position(s.x,s.y);
 if floor((pos->>'x')::numeric/128)=floor(s.x/128.0)and floor((pos->>'y')::numeric/128)=floor(s.y/128.0)and a.status='idle'and a.raid_city_id is null and a.raid_target_id is null and a.raid_reserve is null and sqrt(power(public.peris_wrapped_delta((pos->>'x')::numeric,(home->>'x')::numeric),2)+power(public.peris_wrapped_delta((pos->>'y')::numeric,(home->>'y')::numeric),2))<=90 then
  room:=greatest(0,1000-public.peris_roster_total(public.peris_roster(to_jsonb(a)))-coalesce((select sum(quantity)::integer from public.peris_orders where army_id=a.id and kind='recruit'and recruit_destination='legion'),0));
  merged:=least(room,m.scouts);
  if merged>0 then perform public.peris_write_roster(a.id,public.peris_roster_add(public.peris_roster(to_jsonb(a)),jsonb_build_object('scout',merged)));end if;
 end if;
 if m.scouts>merged then perform public.peris_city_garrison_receive(m.owner_id,s.id,jsonb_build_object('scout',m.scouts-merged));end if;
 update public.peris_scout_missions set scouts=0 where id=m.id;
end $$;

-- Count only pools physically present at the observation deadline. Guild pools keep their own upgrades.
create or replace function public.peris_scout_defenders(p_city bigint,p_at timestamptz)returns table(owner_id uuid,smithy_city bigint,troops jsonb)
language plpgsql stable security definer set search_path='' as $$
#variable_conflict use_column
declare s public.settlements%rowtype;r record;position jsonb;
begin
 select * into s from public.settlements where id=p_city and ruined_at is null;if s.id is null then return;end if;
 for r in select * from public.armies a where a.owner_id=s.owner_id and(a.status='idle'or a.status='moving'and a.departure_at>p_at)loop
  position:=case when r.status='moving'then jsonb_build_object('x',r.start_x,'y',r.start_y)else jsonb_build_object('x',r.target_x,'y',r.target_y)end;
  if floor((position->>'x')::numeric/128)=floor(s.x/128.0)and floor((position->>'y')::numeric/128)=floor(s.y/128.0)then owner_id:=s.owner_id;smithy_city:=s.id;troops:=public.peris_roster(to_jsonb(r));return next;end if;
 end loop;
 for r in select * from public.peris_optional_scout_missions()m where m.owner_id=s.owner_id and m.source_settlement_id=s.id and m.status='outbound'and m.departure_at>p_at loop owner_id:=s.owner_id;smithy_city:=s.id;troops:=public.peris_roster(jsonb_build_object('scout',r.scouts));return next;end loop;
 for r in select * from public.peris_city_garrisons g where g.settlement_id=s.id and g.owner_id=s.owner_id loop owner_id:=s.owner_id;smithy_city:=s.id;troops:=public.peris_roster(r.unit_roster);return next;end loop;
 for r in select * from public.peris_garrisons g where g.owner_id=s.owner_id and g.col=floor(s.x/128.0)and g.row=floor(s.y/128.0)loop owner_id:=s.owner_id;smithy_city:=s.id;troops:=public.peris_roster(to_jsonb(r));return next;end loop;
 for r in select * from public.peris_guild_reinforcements g where g.status='stationed'and g.target_settlement_id=s.id and g.recipient_id=s.owner_id and exists(select 1 from public.peris_guild_members a join public.peris_guild_members b on b.guild_id=a.guild_id where a.player_id=g.owner_id and b.player_id=g.recipient_id)loop owner_id:=r.owner_id;smithy_city:=r.source_settlement_id;troops:=public.peris_roster(r.troops);return next;end loop;
end $$;

create or replace function public.peris_scout_event(p_id bigint,p_at timestamptz)returns void
language plpgsql security definer set search_path='' as $$
declare m public.peris_scout_missions%rowtype;s public.settlements%rowtype;c public.peris_camps%rowtype;r record;bag jsonb;troops jsonb:=public.peris_roster('{}');
 info jsonb;receipt jsonb;notice jsonb;target jsonb;bid bigint;route jsonb;path jsonb;city bigint;wall integer:=0;main integer:=0;attack numeric;defence numeric:=0;killed integer:=0;survivors integer;reason text;success boolean:=false;pace numeric;distance numeric;tx integer;ty integer;
begin
 select * into m from public.peris_scout_missions where id=p_id for update;
 if m.id is null or m.status not in('outbound','returning')or m.arrival_at>p_at then return;end if;
 if exists(select 1 from public.players where id=m.owner_id and defeated_at is not null)or not exists(select 1 from public.settlements where owner_id=m.owner_id and ruined_at is null)then update public.peris_scout_missions set scouts=0,status='completed'where id=m.id;return;end if;
 if m.status='returning'then
  select id into city from public.settlements where owner_id=m.owner_id and ruined_at is null and floor(x/128.0)=floor(m.target_x/128.0)and floor(y/128.0)=floor(m.target_y/128.0)order by id limit 1;
  if city is not null then perform public.peris_scout_deliver(m.id,city);update public.peris_scout_missions set status='completed'where id=m.id;return;end if;
 else
  target:=jsonb_build_object('kind',case when m.target_city_id is null then 'camp'else 'city'end,'id',coalesce(m.target_city_id,m.target_camp_id),'name',m.target_name,'owner_id',m.target_owner_id,'faction',coalesce((select faction from public.settlements where id=m.target_city_id),(select faction from public.peris_camps where id=m.target_camp_id),'orc'),'x',m.target_x,'y',m.target_y);
  if m.scouts=0 then reason:='no_surviving_scouts';
  elsif m.target_city_id is not null then
   select * into s from public.settlements where id=m.target_city_id;
   if s.id is null or s.ruined_at is not null then reason:='invalid_target';elsif s.owner_id is distinct from m.target_owner_id then reason:='ownership_changed';
   else
    select coalesce(level,0)into wall from public.buildings where settlement_id=s.id and building_type='wall';wall:=coalesce(wall,0);
    select coalesce(level,0)into main from public.buildings where settlement_id=s.id and building_type='market';main:=coalesce(main,0);
    for r in select * from public.peris_scout_defenders(s.id,m.arrival_at)loop
     troops:=public.peris_roster_add(troops,r.troops);
     defence:=defence+coalesce((r.troops->>'scout')::integer,0)*20*public.peris_scout_smithy(r.smithy_city,r.owner_id)*public.peris_research_factor(r.owner_id,'defence');
    end loop;
    defence:=defence*(1+public.peris_wall_defence_bonus(wall));bag:=jsonb_build_object('wood',s.wood,'stone',s.stone,'food',s.food,'gold',s.gold);
   end if;
  else
   perform public.peris_camp_accrue(m.target_camp_id,m.arrival_at);select * into c from public.peris_camps where id=m.target_camp_id;
   if c.id is null then reason:='invalid_target';else troops:=public.peris_roster(jsonb_build_object('infantry',c.infantry,'archers',c.archers,'cavalry',c.cavalry));select resources into bag from public.peris_camp_stock where camp_id=c.id;bag:=coalesce(bag,jsonb_build_object('wood',0,'stone',0,'food',0,'gold',0));end if;
  end if;
  if reason is null then
   city:=coalesce((select id from public.settlements where id=m.source_settlement_id and owner_id=m.owner_id and ruined_at is null),(select min(id)from public.settlements where owner_id=m.owner_id and ruined_at is null));
   attack:=m.scouts*35*public.peris_scout_smithy(city,m.owner_id)*public.peris_research_factor(m.owner_id,'attack');
   killed:=case when defence=0 then 0 else least(m.scouts,round(m.scouts*power(defence/greatest(attack,.000001),1.5))::integer)end;
  end if;
  if killed>0 then update public.settlements set food=least(food_capacity,food+killed*coalesce((select(rule#>>'{cost,food}')::numeric from public.peris_unit_balance where version=2 and unit='scout'),0))where id=city and owner_id=m.owner_id and ruined_at is null;end if;
  survivors:=m.scouts-killed;success:=reason is null and survivors>0;if reason is null and not success then reason:='all_scouts_lost';end if;
  info:=jsonb_build_object('mission_id',m.id,'mode',m.mode,'target',target,'observed_at',m.arrival_at,'scouts_sent',m.initial_scouts,'scouts_lost',m.initial_scouts-survivors,'scouts_survived',survivors,'detected',killed>0,'success',success);
  if reason is not null then info:=info||jsonb_build_object('reason',reason);end if;
  if success then info:=info||jsonb_build_object('troops',troops);if m.mode='resources'then info:=info||jsonb_build_object('resources',bag);else info:=info||jsonb_build_object('defences',jsonb_build_object('wall',wall,'main',main));end if;end if;
  receipt:=jsonb_build_object('report_side','attacker','balance_version',2,'attacker_initial',m.initial_scouts,'attacker_survivors',survivors,'attacker_losses',m.initial_scouts-survivors,'defender_initial',0,'defender_survivors',0,'defender_losses',0,'loot',jsonb_build_object('wood',0,'stone',0,'food',0,'gold',0),'duration',0,'reason','Scouting','scouting',info);
  insert into public.battles(attacker_owner_id,defender_owner_id,attacker_army_id,defender_army_id,status,mode,phase,enemy_name,started_at,ended_at,winner_side,result,food_settled)
   values(m.owner_id,null,m.source_army_id,null,'resolved','scouting','combat',m.target_name,m.arrival_at,m.arrival_at,case when success then 'attacker'else 'defender'end,receipt,true)returning id into bid;
  insert into public.peris_reports(owner_id,battle_id,title,won,result,created_at)values(m.owner_id,bid,'Scouting: '||m.target_name,success,receipt,m.arrival_at)on conflict do nothing;
  if killed>0 and m.target_owner_id is not null then
   notice:=receipt||jsonb_build_object('report_side','defender','attacker_initial',killed,'attacker_survivors',0,'attacker_losses',killed,'scouting',(info-'troops'-'resources'-'defences'-'reason')||jsonb_build_object('scouts_sent',killed,'scouts_lost',killed,'scouts_survived',0,'success',false,'reason','Enemy scouts intercepted.','sender_name',(select display_name from public.players where id=m.owner_id)));
   insert into public.peris_reports(owner_id,battle_id,title,won,result,created_at)values(m.target_owner_id,bid,'Scouts detected: '||m.target_name,true,notice,m.arrival_at)on conflict do nothing;
  end if;
  update public.peris_scout_missions set scouts=survivors,report_battle_id=bid where id=m.id;
  if survivors=0 then update public.peris_scout_missions set status='completed'where id=m.id;return;end if;
  if exists(select 1 from public.settlements where id=m.source_settlement_id and owner_id=m.owner_id and ruined_at is null)then
   select jsonb_agg(value order by ord desc)into path from jsonb_array_elements(m.march_path)with ordinality p(value,ord);
   tx:=m.origin_x;ty:=m.origin_y;distance:=m.march_distance;
  end if;
 end if;
 if path is null then
  route:=public.peris_ruin_route(m.owner_id,m.target_x,m.target_y);
  if route is null then update public.peris_scout_missions set scouts=0,status='completed'where id=m.id;return;end if;
  path:=route->'path';tx:=(route->>'x')::integer;ty:=(route->>'y')::integer;distance:=(route->>'distance')::numeric;
 end if;
 update public.peris_scout_missions set status='returning',march_path=path,march_distance=distance,target_x=tx,target_y=ty,departure_at=m.arrival_at,arrival_at=m.arrival_at+make_interval(secs=>greatest(2,distance/public.peris_scout_speed(m.owner_id))::double precision)where id=m.id;
end $$;

create or replace function public.peris_scout_advance(p_owners uuid[],p_at timestamptz)returns void
language plpgsql security definer set search_path='' as $$
declare m record;
begin
 for m in select id from public.peris_scout_missions where owner_id=any(p_owners)and status in('outbound','returning')and arrival_at<=p_at order by arrival_at,case when status='returning'then 0 else 1 end,id for update loop perform public.peris_scout_event(m.id,p_at);end loop;
end $$;

create or replace function public.peris_scout_command_for(p_owner uuid,p_command jsonb)returns jsonb
language plpgsql security definer set search_path='' as $$
declare u uuid:=p_owner;a public.armies%rowtype;s public.settlements%rowtype;t public.settlements%rowtype;c public.peris_camps%rowtype;m public.peris_scout_missions%rowtype;
 position jsonb;home jsonb;path jsonb;distance numeric;new_id bigint;quantity integer;target_x integer;target_y integer;target_name text;faction text;target_owner uuid;sent timestamptz;staging numeric;participants uuid[];steps integer;i integer;
begin
 if u is null then raise exception 'Authentication required';end if;
 if to_regclass('public.peris_crop_version')is null or to_regclass('public.peris_conquest_version')is null then raise exception 'Scouting is unavailable until the current crop and capture updates are installed';end if;
 if exists(select 1 from public.players where id=u and defeated_at is not null)then raise exception 'This ruler has been permanently defeated';end if;
 if p_command is null or jsonb_typeof(p_command)<>'object'then raise exception 'Choose a scouting order';end if;
 if not pg_try_advisory_xact_lock(72320)then raise lock_not_available;end if;
 if p_command->>'type'='cancelScouting'then
  perform public.peris_settle(u);
  select * into m from public.peris_scout_missions where id=(p_command->>'missionId')::bigint and owner_id=u for update;
  if m.id is null or m.sent_at is distinct from(p_command->>'sentAt')::timestamptz then raise exception 'This scouting mission is no longer the same order';end if;
  if m.status='cancelled'then return jsonb_build_object('ok',true);end if;
  if m.status<>'outbound'or public.peris_game_now()>=m.cancel_until or public.peris_game_now()<m.sent_at then raise exception 'Scouting can only be cancelled during the first 30 seconds';end if;
  if not exists(select 1 from public.settlements where id=m.source_settlement_id and owner_id=u and ruined_at is null)then raise exception 'The source city is no longer yours';end if;
  perform public.peris_scout_deliver(m.id,m.source_settlement_id);update public.peris_scout_missions set status='cancelled'where id=m.id;
  return jsonb_build_object('ok',true);
 elsif p_command->>'type'<>'scout'then raise exception 'Choose a scouting order';end if;
 if jsonb_typeof(p_command->'quantity')<>'number'or(p_command->>'quantity')::numeric<>trunc((p_command->>'quantity')::numeric)or(p_command->>'quantity')::numeric not between 1 and 1000 or p_command->>'mode'not in('resources','defences')then raise exception 'Choose 1-1000 scouts and an intelligence mode';end if;
 quantity:=(p_command->>'quantity')::integer;
 if(select count(*)from public.peris_scout_missions where owner_id=u and status in('outbound','returning'))>=100 then raise exception 'At most 100 active scouting missions are allowed';end if;
 if(p_command->>'targetCityId'is null)=(p_command->>'campId'is null)then raise exception 'Choose one scouting target';end if;
 if p_command->>'targetCityId'is not null then
  select * into t from public.settlements where id=(p_command->>'targetCityId')::bigint and ruined_at is null and owner_id<>u;
  if t.id is null then raise exception 'Choose a foreign living city';end if;
  target_x:=t.x;target_y:=t.y;target_name:=t.name;target_owner:=t.owner_id;faction:=t.faction;
 else
  select * into c from public.peris_camps where id=(p_command->>'campId')::integer;
  if c.id is null then raise exception 'Choose a camp';end if;
  target_x:=c.x;target_y:=c.y;target_name:=c.name;faction:='orc';
 end if;
 -- Lock both existing connected components before adding their new private edge.
 select array_agg(distinct id order by id)into participants from unnest(public.peris_trade_participants(u)||coalesce(public.peris_trade_participants(target_owner),array[]::uuid[]))id where id is not null;
 perform 1 from public.players where id=any(participants)order by id for update nowait;
 perform public.peris_settle(u);if target_owner is not null then perform public.peris_settle(target_owner);end if;
 select * into a from public.armies where id=(p_command->>'armyId')::bigint and owner_id=u for update;
 if a.id is null or a.status<>'idle'or a.raid_target_id is not null or a.raid_city_id is not null or a.raid_reserve is not null or exists(select 1 from public.battles where status='active'and(attacker_army_id=a.id or defender_army_id=a.id))then raise exception 'Choose an idle legion';end if;
 if exists(select 1 from public.peris_orders where army_id=a.id and kind='recruit'and recruit_destination='legion')then raise exception 'Finish training before sending scouts';end if;
 position:=public.peris_army_position(a);
 select city.* into s from public.settlements city cross join lateral(select public.peris_home_army_position(city.x,city.y)pos)q where city.owner_id=u and city.ruined_at is null and floor((position->>'x')::numeric/128)=floor(city.x/128.0)and floor((position->>'y')::numeric/128)=floor(city.y/128.0)and sqrt(power(public.peris_wrapped_delta((position->>'x')::numeric,(q.pos->>'x')::numeric),2)+power(public.peris_wrapped_delta((position->>'y')::numeric,(q.pos->>'y')::numeric),2))<=90 order by city.id limit 1 for update of city;
 if s.id is null then raise exception 'Depart from one of your living cities';end if;
 if coalesce((public.peris_roster(to_jsonb(a))->>'scout')::integer,0)<quantity then raise exception 'Choose available scouts from this legion';end if;
 if t.id is not null and not exists(select 1 from public.settlements where id=t.id and owner_id=target_owner and ruined_at is null)then raise exception 'Target ownership changed';end if;
 path:=nullif(p_command->'route','null'::jsonb);
 if path is null then
  steps:=greatest(1,ceil(greatest(abs(public.peris_wrapped_delta((position->>'x')::numeric,target_x)),abs(public.peris_wrapped_delta((position->>'y')::numeric,target_y)))/64)::integer);
  path:=jsonb_build_array(jsonb_build_array((position->>'x')::numeric,(position->>'y')::numeric));
  for i in 1..steps loop path:=path||jsonb_build_array(jsonb_build_array(public.peris_wrap_world(round((position->>'x')::numeric+public.peris_wrapped_delta((position->>'x')::numeric,target_x)*i/steps)::integer),public.peris_wrap_world(round((position->>'y')::numeric+public.peris_wrapped_delta((position->>'y')::numeric,target_y)*i/steps)::integer)));end loop;
 end if;
 distance:=public.peris_route_distance((position->>'x')::numeric,(position->>'y')::numeric,target_x,target_y,path);
 sent:=public.peris_game_now();select 30*rate into staging from public.peris_world_clock where id;
 perform public.peris_write_roster(a.id,public.peris_roster_add(public.peris_roster(to_jsonb(a)),jsonb_build_object('scout',quantity),-1));
 insert into public.peris_scout_missions(owner_id,source_settlement_id,source_army_id,target_city_id,target_camp_id,target_owner_id,target_name,faction,mode,initial_scouts,scouts,origin_x,origin_y,target_x,target_y,sent_at,departure_at,arrival_at,cancel_until,march_path,march_distance)
 values(u,s.id,a.id,t.id,c.id,target_owner,target_name,s.faction,p_command->>'mode',quantity,quantity,(position->>'x')::integer,(position->>'y')::integer,target_x,target_y,sent,sent+make_interval(secs=>staging::double precision),sent+make_interval(secs=>(staging+greatest(2,distance/public.peris_scout_speed(u)))::double precision),sent+make_interval(secs=>staging::double precision),path,distance)returning id into new_id;
 delete from public.peris_scout_missions old where old.owner_id=u and old.status in('completed','cancelled')and old.id not in(select id from public.peris_scout_missions where owner_id=u and status in('completed','cancelled')order by id desc limit 200);
 perform public.peris_supply_refresh(s.id,sent);
 return jsonb_build_object('ok',true,'mission_id',new_id);
end $$;

create or replace function public.peris_scout_command(p_command jsonb)returns jsonb
language plpgsql security definer set search_path='' as $$
begin return public.peris_scout_command_for(public.peris_player_id(),p_command);end $$;
revoke all on function public.peris_scout_command_for(uuid,jsonb)from public,anon,authenticated;

create or replace function public.peris_scout_defeat()returns trigger language plpgsql security definer set search_path='' as $$
begin if new.defeated_at is not null then update public.peris_scout_missions set scouts=0,status='completed'where owner_id=new.id and status in('outbound','returning');end if;return new;end $$;
drop trigger if exists peris_scout_defeat on public.players;
create trigger peris_scout_defeat after update of defeated_at on public.players for each row execute function public.peris_scout_defeat();
revoke all on function public.peris_scout_speed(uuid),public.peris_scout_smithy(bigint,uuid),public.peris_scout_deliver(bigint,bigint),public.peris_scout_defenders(bigint,timestamptz),public.peris_scout_event(bigint,timestamptz),public.peris_scout_advance(uuid[],timestamptz),public.peris_scout_command(jsonb),public.peris_scout_defeat()from public,anon,authenticated;
grant execute on function public.peris_scout_command(jsonb)to authenticated;

create or replace function public.peris_scout_no_formations()returns trigger language plpgsql security definer set search_path='' as $$
begin if exists(select 1 from public.battles where id=new.battle_id and mode='scouting')then raise exception 'Scouting receipts cannot have combat formations';end if;return new;end $$;
drop trigger if exists peris_scout_no_formations on public.battle_formations;
create trigger peris_scout_no_formations before insert or update of battle_id on public.battle_formations for each row execute function public.peris_scout_no_formations();
revoke all on function public.peris_scout_no_formations()from public,anon,authenticated;

-- Camp starts/finalizers also preserve earlier scout deadlines when called without march intent.
create or replace function public.peris_scout_flush_camp(p_camp integer,p_at timestamptz,p_owner uuid)returns void
language plpgsql security definer set search_path='' as $$
declare participants uuid[];participant uuid;
begin
 if not exists(select 1 from public.peris_scout_missions where target_camp_id=p_camp and status='outbound'and arrival_at<=p_at)then return;end if;
 if not pg_try_advisory_xact_lock(72320)then raise lock_not_available;end if;
 select array_agg(distinct id order by id)into participants from(
  select p_owner owner_id union select owner_id from public.peris_scout_missions where target_camp_id=p_camp and status='outbound'
 )owners cross join lateral unnest(public.peris_trade_participants(owners.owner_id))id;
 perform 1 from public.players where id=any(participants)order by id for update nowait;
 foreach participant in array participants loop perform public.peris_settle(participant,p_at);end loop;
end $$;
revoke all on function public.peris_scout_flush_camp(integer,timestamptz,uuid)from public,anon,authenticated;

-- Hourly combat troop crop consumption. Private helpers; never a public economy feed.
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
 from unnest(array['infantry','spearmen','archers','elite','cavalry','scout','heavyCavalry','ram','catapult','diplomat'])unit
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
  source:=coalesce(case when r.status='stationed'then(select id from public.settlements where id=r.target_settlement_id and owner_id=r.recipient_id and ruined_at is null)else coalesce((select id from public.settlements where id=r.source_settlement_id and owner_id=r.owner_id and ruined_at is null),(select id from public.settlements where id=r.target_settlement_id and owner_id=r.owner_id and ruined_at is null))end,(select min(id)from public.settlements where owner_id=r.owner_id and ruined_at is null));
  if source=p_sid then kind:='guild';key:='guild:'||r.id;owner_id:=r.owner_id;tier:=case when r.status='stationed'then 1 else 4 end;troops:=public.peris_roster(r.troops);return next;end if;
 end loop;
 for r in select * from public.peris_optional_scout_missions() loop
  source:=coalesce((select id from public.settlements where id=r.source_settlement_id and owner_id=r.owner_id and ruined_at is null),(select min(id)from public.settlements where owner_id=r.owner_id and ruined_at is null));
  if source=p_sid then kind:='scout';key:='scout:'||r.id;owner_id:=r.owner_id;tier:=4;troops:=public.peris_roster(jsonb_build_object('scout',r.scouts));return next;end if;
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
  update public.settlements set food=least(food_capacity,food+credit)where id=source_city and owner_id=owner and ruined_at is null;
 end loop;
 update public.battles set food_settled=true where id=b.id;
end $$;

-- Allocate permanent combat deaths against captured survivors, excluding already-debited famine.
create or replace function public.peris_food_defender_losses(p_bid bigint,p_party jsonb)returns jsonb
language plpgsql stable security definer set search_path='' as $$
declare b public.battles%rowtype;party jsonb;unit_name text;source_key text;total integer;prefix integer;amount integer;survivors integer;lost integer;result jsonb:=public.peris_roster('{}');seen boolean;
begin
 select * into b from public.battles where id=p_bid;
 foreach unit_name in array array['infantry','spearmen','archers','elite','cavalry','scout','heavyCavalry','ram','catapult','diplomat']loop
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
 select role into casualty_unit from unnest(array['infantry','spearmen','archers','elite','cavalry','scout','heavyCavalry','ram','catapult','diplomat'])with ordinality u(role,seq)order by coalesce((r.troops->>role)::integer,0)desc,seq limit 1;
 roster:=jsonb_set(r.troops,array[casualty_unit],to_jsonb((r.troops->>casualty_unit)::integer-1));parts:=string_to_array(r.key,':');
 if r.kind='army'then perform public.peris_write_roster(parts[2]::bigint,roster);
 elsif r.kind='reserve'then update public.armies set raid_reserve=roster where id=parts[2]::bigint;
 elsif r.kind='city'then update public.peris_city_garrisons set unit_roster=roster where settlement_id=p_sid;
 elsif r.kind='station'then update public.peris_garrisons set unit_roster=roster,infantry=public.peris_roster_class(roster,'infantry'),archers=public.peris_roster_class(roster,'archers'),cavalry=public.peris_roster_class(roster,'cavalry')where owner_id=r.owner_id and col=parts[3]::integer and row=parts[4]::integer;
 elsif r.kind='reinforcement'then update public.peris_city_reinforcements set troops=roster where id=parts[2]::bigint;
 elsif r.kind='guild'then update public.peris_guild_reinforcements set troops=roster where id=parts[2]::bigint;
 elsif r.kind='scout'then execute 'update public.peris_scout_missions set scouts=$1 where id=$2'using(roster->>'scout')::integer,parts[2]::bigint;
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
 union select owner_id,recipient_id from public.peris_scout_edges()
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
 perform public.peris_optional_advance_scouts(participants,cursor_at);
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
   union all select arrival_at from public.peris_optional_scout_missions()where owner_id=any(participants)
   union all select p_until
  )events where at_time>cursor_at and at_time<=p_until;
  exit when event_at is null;
  for city in select id from public.settlements where owner_id=any(participants)and ruined_at is null order by id loop perform public.peris_population_accrue(city.id,event_at);end loop;
  foreach participant in array participants loop perform public.peris_settle_core(participant,event_at);end loop;
  for r in select id from public.peris_trade_caravans where owner_id=any(participants)and(status='outbound'and arrival_at<=event_at or status='returning'and least(return_at,case when public.peris_trade_volume(returning_resources)>0 then redirect_at end)<=event_at)order by id loop perform public.peris_trade_event(r.id,event_at);end loop;
  perform public.peris_optional_advance_scouts(participants,event_at);
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

create or replace function public.peris_trade_participants(p_owner uuid)returns uuid[]
language sql stable security definer set search_path='' as $$
 with recursive participants(id)as(select p_owner union select case when r.owner_id=p.id then r.recipient_id else r.owner_id end
 from participants p join(select owner_id,recipient_id from public.peris_trade_caravans where status<>'completed' union select owner_id,recipient_id from public.peris_trade_route_edges()
 union select owner_id,recipient_id from public.peris_scout_edges()
 union select owner_id,recipient_id from public.peris_guild_reinforcements
 union select attacker_owner_id,defender_owner_id from public.battles where status='active'and defender_owner_id is not null)r on(r.owner_id=p.id or r.recipient_id=p.id))
 select array_agg(id order by id)from participants
$$;
create or replace function public.peris_prepare_raid_for(p_owner uuid,p_army bigint,p_camp integer,p_path jsonb default null,p_troops jsonb default null)returns jsonb
language plpgsql security definer set search_path='' as $$
declare u uuid:=p_owner;a public.armies%rowtype;c public.peris_camps%rowtype;inf integer;arc integer;cav integer;route jsonb;steps integer;i integer;available jsonb;preset jsonb;unit_name text;
begin
 if u is null then raise exception 'Authentication required';end if;
 perform public.peris_settle(u);
 select * into a from public.armies where id=p_army and owner_id=u for update;
 select * into c from public.peris_camps where id=p_camp;
 if c.id is null then raise exception 'Camp not found';end if;
 if a.id is null or a.infantry+a.archers+a.cavalry=0 then raise exception 'Recruit soldiers before starting a raid';end if;
 if a.status<>'idle' or a.raid_target_id is not null or a.raid_city_id is not null or a.raid_reserve is not null then raise exception 'This legion already has a march or raid';end if;
 available:=public.peris_roster(to_jsonb(a));preset:=available;
 if p_troops is not null then
  if jsonb_typeof(p_troops)<>'object' then raise exception 'Choose troops currently available in this legion';end if;
  available:=public.peris_roster(to_jsonb(a));preset:=public.peris_garrison_troops(p_troops);
  foreach unit_name in array array['infantry','spearmen','archers','elite','cavalry','scout','heavyCavalry','ram','catapult','diplomat']loop
   if (preset->>unit_name)::integer>(available->>unit_name)::integer then raise exception 'Choose troops currently available in this legion';end if;
  end loop;
  if public.peris_roster_total(preset)=0 then raise exception 'Send at least one soldier';end if;
 end if;
 route:=p_path;
 if route is null then
  steps:=greatest(1,ceil(greatest(abs(public.peris_wrapped_delta(a.target_x,c.x)),abs(public.peris_wrapped_delta(a.target_y,c.y)))/64)::integer);
  route:=jsonb_build_array(jsonb_build_array(a.target_x,a.target_y));
  for i in 1..steps loop route:=route||jsonb_build_array(jsonb_build_array(public.peris_wrap_world(round(a.target_x+public.peris_wrapped_delta(a.target_x,c.x)*i/steps)::integer),public.peris_wrap_world(round(a.target_y+public.peris_wrapped_delta(a.target_y,c.y)*i/steps)::integer)));end loop;
 end if;
 if public.peris_roster_total(preset)>0 and public.peris_roster_total(preset)=coalesce((preset->>'scout')::integer,0)and to_regprocedure('public.peris_scout_command_for(uuid,jsonb)')is not null then
  return public.peris_scout_command_for(u,jsonb_build_object('type','scout','armyId',a.id,'campId',c.id,'quantity',(preset->>'scout')::integer,'mode','resources','route',route));
 end if;
 if not c.bandit and exists(select 1 from public.peris_progress where owner_id=u and camp_id=p_camp and available_at>public.peris_game_now())then raise exception 'The camp is still regrouping';end if;
 perform public.peris_march_for(u,a.id,c.x,c.y,route,c.id);
 update public.armies set raid_target_id=c.id where id=a.id;
 if p_troops is not null then
  perform public.peris_garrison_add(u,floor(a.target_x/128.0)::integer,floor(a.target_y/128.0)::integer,public.peris_roster_add(available,preset,-1));
  perform public.peris_write_roster(a.id,preset);
  -- The route was validated before selecting troops. Recompute the accepted deadline for the chosen party.
  update public.armies set arrival_at=departure_at+make_interval(secs=>greatest(2,march_distance/public.peris_march_speed(id))::double precision)where id=a.id;
 end if;
 return jsonb_build_object('ok',true);
end $$;
create or replace function public.peris_campaign_farm_command(p_command jsonb)

returns jsonb language plpgsql security definer set search_path='' as $$

declare

 u uuid:=public.peris_player_id();kind text:=p_command->>'type';v_entry_id bigint;v_list_id bigint;v_camp_id integer;v_army_id bigint;

 preset jsonb;list_name text;losses_only boolean;list public.peris_campaign_farm_lists;farm public.peris_campaign_farms;v_duplicate_id bigint;

 started integer:=0;skipped jsonb:='[]';batch_path jsonb;preparation jsonb;previous_army text;previous_city text;target_army public.armies%rowtype;repeat_enabled boolean;repeat_interval integer;
 selected_ids bigint[];selected_id jsonb;selected_count integer;v_action text;

begin

 if u is null then raise exception 'Authentication required';end if;

 if jsonb_typeof(p_command) is distinct from 'object' then raise exception 'Choose a campaign farm command';end if;

 -- Settlement takes the global founding lock before its owner lock when needed.

 if kind='startCampaignFarmList' then perform public.peris_settle(u);end if;

 -- Serialize one owner's saves/deletes so list limits and duplicate checks are atomic.

 perform 1 from public.players where id=u for update;

 if not found then raise exception 'Create your realm first';end if;

 if p_command ? 'id' then

  if jsonb_typeof(p_command->'id') is distinct from 'number' or (p_command->>'id')::numeric<>trunc((p_command->>'id')::numeric) or (p_command->>'id')::numeric not between 1 and 9007199254740991 then raise exception 'Choose a valid saved farm';end if;

  v_entry_id:=(p_command->>'id')::bigint;

 end if;

 if kind='manageCampaignFarmTargets' then
  if jsonb_typeof(p_command->'ids') is distinct from 'array' then raise exception 'Choose saved targets';end if;
  selected_count:=jsonb_array_length(p_command->'ids');
  if selected_count not between 1 and 100 then raise exception 'Choose up to 100 targets';end if;
  selected_ids:=array[]::bigint[];
  for selected_id in select value from jsonb_array_elements(p_command->'ids')loop
   if jsonb_typeof(selected_id) is distinct from 'number' then raise exception 'Choose valid saved targets';end if;
   if selected_id::text::numeric<>trunc(selected_id::text::numeric) or selected_id::text::numeric not between 1 and 9007199254740991 then raise exception 'Choose valid saved targets';end if;
   selected_ids:=array_append(selected_ids,selected_id::text::bigint);
  end loop;
  if (select count(distinct id)from unnest(selected_ids)ids(id))<>selected_count or (select count(*)from public.peris_campaign_farms where owner_id=u and id=any(selected_ids))<>selected_count then raise exception 'Choose your own saved targets';end if;
  v_action:=p_command->>'action';
  if v_action='delete' then delete from public.peris_campaign_farms where owner_id=u and id=any(selected_ids);
  elsif v_action='move' then
   if jsonb_typeof(p_command->'listId') is distinct from 'number' then raise exception 'Choose your own destination list';end if;
   if (p_command->>'listId')::numeric<>trunc((p_command->>'listId')::numeric) then raise exception 'Choose your own destination list';end if;
   v_list_id:=(p_command->>'listId')::bigint;
   if not exists(select 1 from public.peris_campaign_farm_lists where id=v_list_id and owner_id=u)then raise exception 'Choose your own destination list';end if;
   if (select count(*)from public.peris_campaign_farms where list_id=v_list_id and not(id=any(selected_ids)))+selected_count>100 then raise exception 'A campaign farm list holds up to 100 targets';end if;
   if exists(select camp_id from public.peris_campaign_farms where (list_id=v_list_id and not(id=any(selected_ids)))or(owner_id=u and id=any(selected_ids))group by camp_id having count(*)>1)then raise exception 'A selected camp is already in the destination list';end if;
   update public.peris_campaign_farms set list_id=v_list_id where owner_id=u and id=any(selected_ids);
  else raise exception 'Choose move or delete';end if;
  return jsonb_build_object('ok',true,'changed',selected_count);
 elsif kind in('setCampaignFarmListEnabled','applyCampaignFarmListTroops')then
  select * into list from public.peris_campaign_farm_lists where id=v_entry_id and owner_id=u;
  if not found then raise exception 'Choose your own farm list';end if;
  if kind='applyCampaignFarmListTroops'then
   preset:=public.peris_campaign_farm_troops(list.troops,false);
   update public.peris_campaign_farms set troops=preset where list_id=list.id and owner_id=u;
  else
   if jsonb_typeof(p_command->'enabled') is distinct from 'boolean'then raise exception 'Choose a repeat preference';end if;
   repeat_enabled:=(p_command->>'enabled')::boolean;
   update public.peris_campaign_farms set enabled=repeat_enabled,next_at=case when repeat_enabled then public.peris_game_now()+make_interval(secs=>interval_seconds)else null end,last_status=case when repeat_enabled then 'Scheduled'else 'Paused'end where list_id=list.id and owner_id=u and enabled is distinct from repeat_enabled;
  end if;
  return jsonb_build_object('ok',true);
 elsif kind='startCampaignFarmList' then

  if not exists(select 1 from public.peris_campaign_farm_lists where id=v_entry_id and owner_id=u)then raise exception 'Choose your own farm list';end if;

  if p_command ? 'routes' and jsonb_typeof(p_command->'routes') is distinct from 'array' then raise exception 'Choose valid farm routes';end if;

  previous_army:=current_setting('peris.army_id',true);previous_city:=current_setting('peris.city_id',true);

  for farm in select f.* from public.peris_campaign_farms f where f.list_id=v_entry_id and f.owner_id=u order by f.id for update loop

   -- A failed target rolls back its own preparation; other available legions still depart.

   begin

    select * into target_army from public.armies where id=farm.army_id and owner_id=u for update;

    if target_army.id is null then raise exception 'Choose your own legion';end if;

    if not exists(select 1 from public.peris_camps where id=farm.camp_id and bandit)then raise exception 'Only bandit camps can be started from a farm list';end if;

    preset:=public.peris_campaign_farm_troops(farm.troops,false);

    batch_path:=null;

    if p_command ? 'routes' then

     select r->'path' into batch_path from jsonb_array_elements(p_command->'routes')r where r->>'targetId'=farm.id::text limit 1;

     if batch_path is null then raise exception 'No connected land route is available for this target';end if;

    end if;

    perform set_config('peris.army_id',farm.army_id::text,true);perform set_config('peris.city_id',target_army.home_settlement_id::text,true);

    preparation:=public.peris_prepare_raid(farm.camp_id,batch_path,preset);
    if preparation?'mission_id'then execute 'select march_path from public.peris_scout_missions where id=$1'into batch_path using(preparation->>'mission_id')::bigint;else select march_path into batch_path from public.armies where id=farm.army_id;end if;

    update public.armies set farm_list_id=farm.list_id where id=farm.army_id;

    update public.peris_campaign_farms set route=batch_path,last_status=case when preparation?'mission_id'then 'Scouting preparing'else 'Raid preparing'end,sent=sent+1 where id=farm.id;
    started:=started+1;

   exception when others then

    update public.peris_campaign_farms set last_status=sqlerrm,skipped=peris_campaign_farms.skipped+1 where id=farm.id;
    skipped:=skipped||jsonb_build_array(jsonb_build_object('targetId',farm.id,'reason',sqlerrm));

   end;

  end loop;

  perform set_config('peris.army_id',coalesce(previous_army,''),true);perform set_config('peris.city_id',coalesce(previous_city,''),true);

  if started=0 then raise exception 'No raids started. %',coalesce(skipped->0->>'reason','Add camp targets to this list first.');end if;

  return jsonb_build_object('started',started,'skipped',skipped);

 elsif kind='saveCampaignFarmList' then

  if jsonb_typeof(p_command->'name') is distinct from 'string' then raise exception 'Use a farm list name of 2–40 characters';end if;

  list_name:=btrim(p_command->>'name');

  if char_length(list_name) not between 2 and 40 then raise exception 'Use a farm list name of 2–40 characters';end if;

  if jsonb_typeof(p_command->'casualtiesOnly') is distinct from 'boolean' then raise exception 'Choose a report preference';end if;

  preset:=public.peris_campaign_farm_troops(p_command->'troops',true);losses_only:=(p_command->>'casualtiesOnly')::boolean;

  if v_entry_id is null then

   if (select count(*)from public.peris_campaign_farm_lists where owner_id=u)>=50 then raise exception 'You can save up to 50 campaign farm lists';end if;

   insert into public.peris_campaign_farm_lists(owner_id,name,troops,casualties_only)values(u,list_name,preset,losses_only)returning * into list;

  else

   update public.peris_campaign_farm_lists set name=list_name,troops=preset,casualties_only=losses_only where id=v_entry_id and owner_id=u returning * into list;

   if not found then raise exception 'Choose your own farm list';end if;

  end if;

  return to_jsonb(list);

 elsif kind='saveCampaignFarm' then

  foreach list_name in array array['listId','campId','armyId'] loop

   if jsonb_typeof(p_command->list_name) is distinct from 'number' or (p_command->>list_name)::numeric<>trunc((p_command->>list_name)::numeric) or (p_command->>list_name)::numeric not between 1 and 9007199254740991 then raise exception 'Choose a farm list, camp and legion';end if;

  end loop;

  v_list_id:=(p_command->>'listId')::bigint;v_camp_id:=(p_command->>'campId')::integer;v_army_id:=(p_command->>'armyId')::bigint;

  if not exists(select 1 from public.peris_campaign_farm_lists l where l.id=v_list_id and l.owner_id=u)then raise exception 'Choose your own farm list';end if;

  if not exists(select 1 from public.peris_camps c where c.id=v_camp_id and c.bandit)then raise exception 'Only bandit camps can be saved. Story locations are manual encounters';end if;

  perform 1 from public.armies a where a.id=v_army_id and a.owner_id=u for share;

  if not found then raise exception 'Choose your own legion';end if;

  preset:=public.peris_campaign_farm_troops(p_command->'troops',false);

  select f.id into v_duplicate_id from public.peris_campaign_farms f where f.owner_id=u and f.list_id=v_list_id and f.camp_id=v_camp_id;

  if v_entry_id is null then v_entry_id:=v_duplicate_id;

  else

   select * into farm from public.peris_campaign_farms f where f.id=v_entry_id and f.owner_id=u;

   if not found then raise exception 'Choose your own saved farm';end if;

   if v_duplicate_id is not null and v_duplicate_id<>v_entry_id then raise exception 'This camp is already in that farm list';end if;

  end if;

  if v_entry_id is not null and farm.id is null then select * into farm from public.peris_campaign_farms f where f.id=v_entry_id and f.owner_id=u;end if;

  if (farm.id is null or farm.list_id<>v_list_id) and (select count(*)from public.peris_campaign_farms f where f.list_id=v_list_id)>=100 then raise exception 'A campaign farm list holds up to 100 targets';end if;

  if v_entry_id is null then

   insert into public.peris_campaign_farms(owner_id,list_id,camp_id,army_id,troops)values(u,v_list_id,v_camp_id,v_army_id,preset)returning * into farm;

  else

   update public.peris_campaign_farms f set list_id=v_list_id,camp_id=v_camp_id,army_id=v_army_id,troops=preset,route=case when f.army_id=v_army_id and f.camp_id=v_camp_id then f.route else null end where f.id=v_entry_id and f.owner_id=u returning * into farm;

  end if;

  if p_command ? 'enabled' and jsonb_typeof(p_command->'enabled')<>'boolean'then raise exception 'Choose a repeat preference';end if;
  repeat_enabled:=coalesce((p_command->>'enabled')::boolean,farm.enabled,false);
  repeat_interval:=coalesce((p_command->>'intervalSeconds')::integer,farm.interval_seconds,300);
  if repeat_interval not between 60 and 86400 then raise exception 'Use a repeat interval of 60–86400 seconds';end if;
  update public.peris_campaign_farms set enabled=repeat_enabled,interval_seconds=repeat_interval,
   next_at=case when repeat_enabled then case when enabled and interval_seconds=repeat_interval then coalesce(next_at,public.peris_game_now()+make_interval(secs=>repeat_interval))else public.peris_game_now()+make_interval(secs=>repeat_interval)end else null end
   where id=farm.id returning * into farm;
  return to_jsonb(farm);

 elsif kind='deleteCampaignFarm' then

  delete from public.peris_campaign_farms where id=v_entry_id and owner_id=u;

  if not found then raise exception 'Choose your own saved farm';end if;

 elsif kind='deleteCampaignFarmList' then

  if not exists(select 1 from public.peris_campaign_farm_lists where id=v_entry_id and owner_id=u)then raise exception 'Choose your own farm list';end if;

  if exists(select 1 from public.peris_campaign_farms f where f.list_id=v_entry_id)then raise exception 'Remove or move this list’s targets before deleting it';end if;

  delete from public.peris_campaign_farm_lists where id=v_entry_id and owner_id=u;

 else raise exception 'Choose a campaign farm command';

 end if;

 return jsonb_build_object('ok',true);

end $$;
create or replace function public.peris_start_raid(p_owner uuid,p_camp integer) returns bigint
language plpgsql security definer set search_path='' as $$
declare a public.armies%rowtype;c public.peris_camps%rowtype;bid bigint;mor numeric;shared_stock boolean;
begin
 perform public.peris_optional_scout_camp_mutation(p_camp,public.peris_game_now(),p_owner);
 select * into a from public.armies where id=public.peris_army_id(p_owner) for update;
 select * into c from public.peris_camps where id=p_camp for update;
 if c.id is null or a.id is null then raise exception 'Army or camp not found';end if;
 shared_stock:=c.bandit and to_regclass('public.peris_camp_stock')is not null;
 if shared_stock then
  perform public.peris_camp_accrue(p_camp);
  if exists(select 1 from public.peris_camp_stock where camp_id=p_camp and engaged_battle_id is not null)then return null;end if;
  select * into c from public.peris_camps where id=p_camp;
 end if;
 if a.infantry+a.archers+a.cavalry=0 then raise exception 'Your army has no soldiers';end if;
 if exists(select 1 from public.battles where status='active' and (attacker_owner_id=p_owner or defender_owner_id=p_owner)) then raise exception 'Finish the current battle first';end if;
 if not shared_stock and exists(select 1 from public.peris_progress where owner_id=p_owner and camp_id=p_camp and available_at>public.peris_game_now()) then raise exception 'The camp is still regrouping';end if;
 insert into public.battles(attacker_owner_id,defender_owner_id,attacker_army_id,defender_army_id,mode,phase,camp_id,terrain,difficulty,enemy_name,defender_ready,defender_faction)
 values(p_owner,null,a.id,null,'pve','combat',c.id,public.peris_battle_terrain(c.x,c.y),case when c.tier>=6 then 'hard' when c.tier<=2 then 'easy' else 'normal' end,c.name,true,c.faction) returning id into bid;
 if shared_stock then update public.peris_camp_stock set engaged_battle_id=bid where camp_id=c.id;end if;
 select 90+2*level into mor from public.buildings where settlement_id=a.home_settlement_id and building_type='wall';
 perform public.peris_add_formations(bid,p_owner,'attacker',a.infantry,a.archers,a.cavalry,coalesce(mor,92));
 perform public.peris_add_formations(bid,null,'defender',c.infantry,c.archers,c.cavalry,case when c.tier>=6 then 100 when c.tier<=2 then 78 else 90 end);
 update public.armies set raid_target_id=null where id=a.id;
 return bid;
end $$;
create or replace function public.peris_finish(p_bid bigint,p_winner text,p_reason text) returns void
language plpgsql security definer set search_path='' as $$
declare b public.battles%rowtype;ai integer;di integer;asur integer;dsur integer;r jsonb;loot jsonb:='{"wood":0,"stone":0,"food":0,"gold":0}';tier integer;u uuid;name text;a public.armies%rowtype;s public.settlements%rowtype;winner uuid;home jsonb;camp public.peris_camps%rowtype;stock jsonb;remaining jsonb;carry numeric;take numeric;key text;delivered jsonb;overflow jsonb;
begin
 select * into b from public.battles where id=p_bid for update;if b.id is null or b.status='resolved' then return;end if;
 perform public.peris_optional_scout_camp_mutation(b.camp_id,public.peris_game_now(),b.attacker_owner_id);
 if to_regprocedure('public.peris_food_finish(bigint)')is not null then perform public.peris_food_finish(p_bid);select * into b from public.battles where id=p_bid;end if;
 if not public.peris_lock_battle_participants(b.attacker_owner_id,b.defender_owner_id)then raise lock_not_available;end if;
 if b.raid_city_id is not null then perform public.peris_finish_city_raid(p_bid,p_winner,p_reason);return;end if;
 select coalesce(sum(initial_soldiers)filter(where side='attacker'),0),coalesce(sum(initial_soldiers)filter(where side='defender'),0),
 coalesce(sum(soldiers)filter(where side='attacker'),0),coalesce(sum(soldiers)filter(where side='defender'),0) into ai,di,asur,dsur from public.battle_formations where battle_id=b.id;
 winner:=case p_winner when 'attacker' then b.attacker_owner_id when 'defender' then b.defender_owner_id else null end;
 select * into camp from public.peris_camps where id=b.camp_id;
 if b.mode='pve' and p_winner='attacker' and not camp.bandit then
 tier:=camp.tier;
 loot:=jsonb_build_object('wood',180*tier,'stone',140*tier,'food',220*tier,'gold',60*tier);
 insert into public.peris_progress(owner_id,camp_id,defeated,available_at) values(b.attacker_owner_id,b.camp_id,1,public.peris_game_now()+interval '2 minutes')
 on conflict(owner_id,camp_id)do update set defeated=peris_progress.defeated+1,available_at=excluded.available_at;
 end if;
 if camp.bandit then
  tier:=camp.tier;
  perform public.peris_camp_accrue(camp.id);
  select resources into stock from public.peris_camp_stock where camp_id=camp.id for update;
  if p_winner='attacker'then
   select coalesce(sum(f.soldiers*c.carry),0)into carry from public.battle_formations f join public.peris_unit_catalog c on c.unit=coalesce(f.recruit_unit,f.unit_type)where f.battle_id=b.id and f.side='attacker';
 carry:=floor(carry*public.peris_research_factor(b.attacker_owner_id,'carry'));
   loot:=public.peris_take_camp_loot(stock,carry);
   foreach key in array array['wood','stone','food','gold']loop stock:=jsonb_set(stock,array[key],to_jsonb((stock->>key)::numeric-(loot->>key)::numeric));end loop;
  end if;
  update public.peris_camp_stock set resources=stock,engaged_battle_id=null,next_recruit_at=public.peris_game_now()+make_interval(secs=>60+floor(random()*241)::integer)where camp_id=camp.id;
  update public.peris_camps set
   infantry=coalesce((select sum(soldiers)from public.battle_formations where battle_id=b.id and side='defender'and unit_type='infantry'),0),
   archers=coalesce((select sum(soldiers)from public.battle_formations where battle_id=b.id and side='defender'and unit_type='archers'),0),
   cavalry=coalesce((select sum(soldiers)from public.battle_formations where battle_id=b.id and side='defender'and unit_type='cavalry'),0)where id=camp.id;
 end if;
 r:=jsonb_build_object('balance_version',b.balance_version,'attacker_initial',ai,'defender_initial',di,'attacker_survivors',asur,'defender_survivors',dsur,'attacker_losses',ai-asur,'defender_losses',di-dsur,'loot',loot,'duration',round(b.elapsed),'reason',p_reason);
 r:=r||jsonb_build_object('attacker_roster',(select public.peris_roster(coalesce(jsonb_object_agg(unit,sum_initial),'{}'::jsonb))from(select coalesce(recruit_unit,unit_type)as unit,sum(initial_soldiers)as sum_initial from public.battle_formations where battle_id=b.id and side='attacker'group by coalesce(recruit_unit,unit_type))q),
  'attacker_survivor_roster',(select public.peris_roster(coalesce(jsonb_object_agg(unit,sum_remaining),'{}'::jsonb))from(select coalesce(recruit_unit,unit_type)as unit,sum(soldiers)as sum_remaining from public.battle_formations where battle_id=b.id and side='attacker'group by coalesce(recruit_unit,unit_type))q),
  'defender_roster',(select public.peris_roster(coalesce(jsonb_object_agg(unit,sum_initial),'{}'::jsonb))from(select coalesce(recruit_unit,unit_type)as unit,sum(initial_soldiers)as sum_initial from public.battle_formations where battle_id=b.id and side='defender'group by coalesce(recruit_unit,unit_type))q),
  'defender_survivor_roster',(select public.peris_roster(coalesce(jsonb_object_agg(unit,sum_remaining),'{}'::jsonb))from(select coalesce(recruit_unit,unit_type)as unit,sum(soldiers)as sum_remaining from public.battle_formations where battle_id=b.id and side='defender'group by coalesce(recruit_unit,unit_type))q),
  'defender_faction',coalesce(b.defender_faction,camp.faction),
  'attacker_faction',coalesce(b.attacker_faction,(select s0.faction from public.armies a0 join public.settlements s0 on s0.id=a0.home_settlement_id where a0.id=b.attacker_army_id)));
 select coalesce(sum(f.soldiers*c.carry),0)into carry from public.battle_formations f join public.peris_unit_catalog c on c.unit=coalesce(f.recruit_unit,f.unit_type)where f.battle_id=b.id and f.side='attacker';
 carry:=floor(carry*public.peris_research_factor(b.attacker_owner_id,'carry'));
 r:=r||jsonb_build_object('replacement_cost',public.peris_roster_loss_cost(r->'attacker_roster',r->'attacker_survivor_roster',b.balance_version),'carrying_capacity',carry);
 if (loot->>'wood')::numeric+(loot->>'stone')::numeric+(loot->>'food')::numeric+(loot->>'gold')::numeric=0 then r:=r||jsonb_build_object('estimated_profit',public.peris_resource_difference(loot,r->'replacement_cost'));end if;
 update public.battles set status='resolved' ,phase='finished',winner_side=p_winner,winner_owner_id=winner,ended_at=public.peris_game_now(),result=r where id=b.id;
 for u in select id from public.players where id in(b.attacker_owner_id,b.defender_owner_id) order by id loop
 perform public.peris_settle(u);
 select * into a from public.armies where id=case when u=b.attacker_owner_id then b.attacker_army_id else b.defender_army_id end;
 select * into s from public.settlements where id=a.home_settlement_id;
 home:=public.peris_home_army_position(s.x,s.y);
 select public.peris_roster(coalesce(jsonb_object_agg(unit_name,survivors),'{}'))into remaining from(select coalesce(recruit_unit,unit_type)as unit_name,sum(soldiers)as survivors from public.battle_formations where battle_id=b.id and owner_id=u group by coalesce(recruit_unit,unit_type))q;
 if to_regprocedure('public.peris_food_roster_after(bigint,text,jsonb)')is not null then
  remaining:=public.peris_food_roster_after(b.id,case when u=b.attacker_owner_id then 'attacker'else 'defender'end,public.peris_roster(to_jsonb(a)));
 end if;
 perform public.peris_write_roster(a.id,public.peris_roster_add(remaining,coalesce(a.raid_reserve,'{}')));
 update public.armies a0 set
 status='idle',raid_target_id=null,raid_reserve=null,march_sent_at=null,march_cancel_until=null,
 start_x=case when a.march_origin is null then (home->>'x')::integer else a.target_x end,start_y=case when a.march_origin is null then (home->>'y')::integer else a.target_y end,
 target_x=case when a.march_origin is null then (home->>'x')::integer else a.target_x end,target_y=case when a.march_origin is null then (home->>'y')::integer else a.target_y end,
 arrival_at=public.peris_game_now(),departure_at=public.peris_game_now(),updated_at=now() where id=a.id;
 if camp.bandit and u=b.attacker_owner_id then update public.armies set carried_loot=loot,loot_report_id=b.id where id=a.id;end if;
 if not public.peris_return_raid(a.id)then update public.armies set march_path=null,march_distance=null,march_returning=false where id=a.id;end if;
 if u=winner then update public.players set victories=victories+1,prestige=prestige+coalesce(tier,1)*25 where id=u;end if;
 if u=b.attacker_owner_id and b.mode='pve' and p_winner='attacker' and not camp.bandit then
 delivered:='{}';overflow:='{}';
 foreach key in array array['wood','stone','food','gold']loop
  take:=least((loot->>key)::numeric,greatest(0,case when key='food'then s.food_capacity else s.capacity end-(to_jsonb(s)->>key)::numeric));
  delivered:=delivered||jsonb_build_object(key,take);overflow:=overflow||jsonb_build_object(key,(loot->>key)::numeric-take);
 end loop;
 r:=r||jsonb_build_object('delivered',delivered,'overflow',overflow,'delivered_at',now(),'estimated_profit',public.peris_resource_difference(delivered,r->'replacement_cost'));
 update public.settlements set wood=least(capacity,wood+(loot->>'wood')::integer),stone=least(capacity,stone+(loot->>'stone')::integer),
 food=least(food_capacity,food+(loot->>'food')::integer),gold=least(capacity,gold+(loot->>'gold')::integer)where id=s.id;
 end if;
 if b.mode='pve' and u=b.attacker_owner_id then
  r:=r||jsonb_build_object('hero_reward',public.peris_battle_hero_reward(a.id,(di-dsur)*2+case when u=winner then 50 else 20 end,case when u=winner then b.camp_id else null end,b.id));
  update public.battles set result=r where id=b.id;
 else
  perform public.peris_hero_reward(a.id,case when u=b.attacker_owner_id then (di-dsur)*2 else(ai-asur)*2 end+case when u=winner then 50 else 20 end,null);
 end if;
 name:=case when b.mode='pve' then b.enemy_name else 'Duel against '||coalesce((select display_name from public.players where id=case when u=b.attacker_owner_id then b.defender_owner_id else b.attacker_owner_id end),'rival') end;
 insert into public.peris_reports(owner_id,battle_id,title,won,result,camp_id,farm_list_id)values(u,b.id,name,coalesce(u=winner,false),r,b.camp_id,a.farm_list_id)on conflict(owner_id,battle_id)do nothing;
 if camp.bandit and u=b.attacker_owner_id and not (select march_returning from public.armies where id=a.id)then perform public.peris_deliver_loot(a.id);end if;
 end loop;
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

 available:=public.peris_roster(to_jsonb(a));chosen:=public.peris_garrison_troops(coalesce(nullif(p_troops,'null'::jsonb),available));
 if public.peris_roster_total(chosen)=0 then raise exception 'Send at least one soldier';end if;
 foreach unit_name in array array['infantry','spearmen','archers','elite','cavalry','scout','heavyCavalry','ram','catapult','diplomat']loop
  if(chosen->>unit_name)::integer>(available->>unit_name)::integer then raise exception 'Choose troops currently available in this legion';end if;
 end loop;
 if public.peris_roster_total(chosen)=coalesce((chosen->>'scout')::integer,0)and to_regprocedure('public.peris_scout_command_for(uuid,jsonb)')is not null then
  return public.peris_scout_command_for(p_owner,jsonb_build_object('type','scout','armyId',a.id,'targetCityId',c.id,'quantity',(chosen->>'scout')::integer,'mode','resources','route',p_path));
 end if;
 if public.peris_social_relation(p_owner,c.owner_id)in('guild','alliance','nap')then raise exception 'Your guild or diplomatic pact protects this city';end if;
 perform public.peris_march_for_target(p_owner,a.id,c.x,c.y,p_path,null,c.id);
 perform public.peris_garrison_add(p_owner,floor(a.target_x/128.0)::integer,floor(a.target_y/128.0)::integer,public.peris_roster_add(available,chosen,-1));
 perform public.peris_write_roster(a.id,chosen);
 update public.armies set siege_target=p_target,arrival_at=departure_at+make_interval(secs=>greatest(2,march_distance/public.peris_march_speed(id))::double precision)where id=a.id;
 return jsonb_build_object('ok',true);
end $$;
create or replace function public.peris_camp_accrue(p_camp integer,p_until timestamptz default public.peris_game_now())returns void language plpgsql security definer set search_path='' as $$
declare c public.peris_camps%rowtype;s public.peris_camp_stock%rowtype;rates integer[];capacity integer;batch_min integer;batch_max integer;cap integer;minutes numeric;r text;i integer:=1;amount integer;steps integer:=0;stock jsonb;
begin
 p_until:=public.peris_scout_camp_cutoff(p_camp,p_until);
 select * into c from public.peris_camps where id=p_camp and bandit for update;if c.id is null then return;end if;
 select * into s from public.peris_camp_stock where camp_id=p_camp for update;
 if s.camp_id is null then return;end if;
 rates:=case when c.tier>=6 then array[24,15,15,6]when c.tier<=2 then array[3,2,2,1]else array[9,6,6,3]end;
 cap:=greatest(case when c.tier>=6 then 250 when c.tier<=2 then 30 else 100 end,ceil((array[30,50,80,120,180,260,360,480,610,720])[least(10,greatest(1,c.tier))]*1.08)::integer);
 batch_min:=case when c.tier>=6 then 4 when c.tier<=2 then 1 else 2 end;batch_max:=case when c.tier>=6 then 10 when c.tier<=2 then 3 else 6 end;
 if s.engaged_battle_id is null then
  while s.next_recruit_at<=p_until and steps<1024 loop
   steps:=steps+1;
   amount:=greatest(0,least(cap-c.infantry-c.archers-c.cavalry,batch_min+floor(random()*(batch_max-batch_min+1))::integer));
   case (s.recruit_sequence % case when c.tier<=2 then 2 else 3 end)
    when 0 then c.infantry:=c.infantry+amount;when 1 then c.archers:=c.archers+amount;else c.cavalry:=c.cavalry+amount;end case;
   s.recruit_sequence:=s.recruit_sequence+1;s.next_recruit_at:=s.next_recruit_at+make_interval(secs=>60+floor(random()*241)::integer);
   if c.infantry+c.archers+c.cavalry>=cap then s.next_recruit_at:=greatest(p_until,s.next_recruit_at)+make_interval(secs=>60+floor(random()*241)::integer);exit;end if;
  end loop;
  update public.peris_camps set infantry=c.infantry,archers=c.archers,cavalry=c.cavalry where id=c.id;
 end if;
 minutes:=greatest(0,extract(epoch from(p_until-s.stock_updated_at))/60);stock:=s.resources;
 foreach r in array array['wood','stone','food','gold']loop
  stock:=jsonb_set(stock,array[r],to_jsonb(least(rates[i]*30,coalesce((stock->>r)::numeric,0)+rates[i]*minutes)));i:=i+1;
 end loop;
 update public.peris_camp_stock set resources=stock,stock_updated_at=greatest(p_until,s.stock_updated_at),next_recruit_at=s.next_recruit_at,recruit_sequence=s.recruit_sequence where camp_id=c.id;
end $$;
create or replace function public.peris_snapshot()returns jsonb language plpgsql security definer set search_path='' as $$
declare u uuid:=public.peris_player_id();result jsonb;
begin
 if u is null then raise exception 'Authentication required';end if;
 perform public.peris_note_account_activity();
 perform public.peris_science_ensure(u);
 if to_regprocedure('public.peris_loyalty_accrue(bigint,timestamp with time zone)')is not null then perform public.peris_loyalty_accrue(s.id,public.peris_game_now())from public.settlements s where s.owner_id=u;end if;
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
 if to_regclass('public.peris_conquest_version')is not null then result:=result||jsonb_build_object('conquest_version',1);end if;
 if to_regclass('public.peris_scout_missions')is not null and to_regclass('public.peris_crop_version')is not null then
  result:=result||jsonb_build_object('scouting_version',1);
  execute 'select $1||jsonb_build_object(''scouting_missions'',coalesce((select jsonb_agg(to_jsonb(m)order by m.id)from public.peris_scout_missions m where owner_id=$2 and(status in(''outbound'',''returning'')or id in(select id from public.peris_scout_missions where owner_id=$2 and status in(''completed'',''cancelled'')order by id desc limit 200))),''[]''::jsonb))'into result using result,u;
 end if;
 return result;
end $$;
create or replace function public.peris_game_tick(p_limit integer default 40)returns jsonb
language plpgsql security definer set search_path='' as $$
declare owner uuid;farm public.peris_campaign_farms%rowtype;processed integer:=0;camp_id integer;preparation jsonb;
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
  union all select owner_id,due from public.peris_due_scouts()
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
     preparation:=public.peris_prepare_raid_for(owner,farm.army_id,farm.camp_id,farm.route,farm.troops);
     update public.armies set farm_list_id=farm.list_id where id=farm.army_id;
     update public.peris_campaign_farms set last_status=case when preparation?'mission_id'then 'Scouting preparing'else 'Raid preparing'end,sent=sent+1 where id=farm.id;
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
 when 'peris_scout_command' then answer:=public.peris_scout_command(p_args->'p_command');
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
revoke all on function public.peris_start_raid(uuid,integer),public.peris_finish(bigint,text,text),public.peris_prepare_raid_for(uuid,bigint,integer,jsonb,jsonb),public.peris_prepare_city_raid(uuid,bigint,bigint,jsonb,jsonb,text),public.peris_trade_participants(uuid),public.peris_game_tick(integer),public.peris_submit_command(uuid,text,jsonb),public.peris_snapshot()from public,anon,authenticated;
grant execute on function public.peris_game_tick(integer)to service_role;
grant execute on function public.peris_submit_command(uuid,text,jsonb),public.peris_snapshot(),public.peris_scout_command(jsonb)to authenticated;$scouting_definition$;end if;end $restore_scouting$;
commit;
