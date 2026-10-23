-- PERIS Market caravans. Apply after V19 + City Logistics + Guild Reinforcements. Review separately; never deployed automatically.
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

do $$begin if to_regprocedure('public.peris_game_tick(integer)')is null or to_regprocedure('public.peris_guild_reinforcements_advance(uuid,timestamp with time zone)')is null then raise exception 'Install V19, City Logistics and Guild Reinforcements first';end if;end $$;
alter table public.peris_city_slots drop constraint if exists peris_city_slots_building_type_check;
alter table public.peris_city_slots add constraint peris_city_slots_building_type_check check(building_type in('barracks','stables','workshop','smithy','warehouse','granary','fishery','mage_tower','housing','academy','bazaar'));
-- Private, authoritative merchant trips. The legacy market remains the Main building.
create unique index if not exists peris_one_bazaar on public.peris_city_slots(settlement_id)where building_type='bazaar';
create table if not exists public.peris_trade_caravans(
 id bigint generated always as identity primary key,
 owner_id uuid not null references public.players(id),recipient_id uuid not null references public.players(id),
 source_settlement_id bigint not null references public.settlements(id),target_settlement_id bigint not null references public.settlements(id),
 source_city text not null,target_city text not null,
 resources jsonb not null,returning_resources jsonb not null,delivered_resources jsonb not null default '{"wood":0,"stone":0,"food":0,"gold":0}',
 volume integer not null check(volume between 1 and 5000),march_path jsonb not null,
 departure_at timestamptz not null,arrival_at timestamptz not null,return_at timestamptz not null,
 status text not null default 'outbound'check(status in('outbound','returning','waiting','stranded','completed')),
 return_settlement_id bigint references public.settlements(id),return_path jsonb,return_departure_at timestamptz,
 completed_at timestamptz,check(arrival_at>=departure_at and return_at>=arrival_at)
);
alter table public.peris_trade_caravans add column if not exists redirect_at timestamptz;
-- Ruin audit dates use the real clock. Record the separate merchant event on the game clock.
create or replace function public.peris_trade_city_changed()returns trigger
language plpgsql security definer set search_path='' as $$
begin
 if(new.ruined_at is not null and old.ruined_at is null)or new.owner_id is distinct from old.owner_id then
  update public.peris_trade_caravans set redirect_at=greatest(arrival_at,public.peris_game_now())
  where return_settlement_id=new.id and status in('returning','waiting','stranded');
 end if;
 return new;
end $$;
drop trigger if exists peris_trade_city_changed on public.settlements;
create trigger peris_trade_city_changed after update of ruined_at,owner_id on public.settlements for each row execute function public.peris_trade_city_changed();
create index if not exists peris_trade_due on public.peris_trade_caravans(owner_id,arrival_at,return_at)where status<>'completed';
create index if not exists peris_trade_incoming on public.peris_trade_caravans(recipient_id,arrival_at)where status='outbound';
alter table public.peris_trade_caravans enable row level security;
revoke all on public.peris_trade_caravans from public,anon,authenticated;
grant select on public.peris_trade_caravans to authenticated;
drop policy if exists "sender trade cargo"on public.peris_trade_caravans;
-- Recipients use the redacted DTO. Raw return cargo belongs exclusively to the sender.
create policy "sender trade cargo"on public.peris_trade_caravans for select to authenticated using(owner_id=public.peris_player_id());

create or replace function public.peris_trade_targets()returns jsonb
language sql stable security definer set search_path='' as $$
 select coalesce(jsonb_agg(jsonb_build_object('id',s.id,'name',s.name,'owner_id',p.id,'owner_name',p.display_name,'x',s.x,'y',s.y)order by lower(p.display_name),lower(s.name),s.id),'[]'::jsonb)
 from public.settlements s join public.players p on p.id=s.owner_id
 where s.ruined_at is null and p.defeated_at is null and(public.peris_player_id()=p.id or exists(
 select 1 from public.peris_guild_members a join public.peris_guild_members b on b.guild_id=a.guild_id where a.player_id=public.peris_player_id()and b.player_id=p.id))
$$;

create or replace function public.peris_trade_status()returns jsonb
language sql stable security definer set search_path='' as $$
 select coalesce(jsonb_agg(case when r.owner_id=public.peris_player_id()then row.dto else(row.dto-'return_settlement_id')||jsonb_build_object('returning_resources','{"wood":0,"stone":0,"food":0,"gold":0}'::jsonb)end order by r.departure_at desc,r.id desc),'[]'::jsonb)
 from public.peris_trade_caravans r cross join lateral(select to_jsonb(r)-'return_path'-'return_departure_at'-'completed_at'-'redirect_at' as dto)row
 where(r.owner_id=public.peris_player_id()or r.recipient_id=public.peris_player_id())
 and(r.status<>'completed'or r.id in(select c.id from public.peris_trade_caravans c where c.status='completed'and(c.owner_id=public.peris_player_id()or c.recipient_id=public.peris_player_id())order by c.completed_at desc,c.id desc limit 50))
$$;

-- Acquires no locks. Caller locks the whole active connected component before advancing any stocks.
create or replace function public.peris_trade_participants(p_owner uuid)returns uuid[]
language sql stable security definer set search_path='' as $$
 with recursive participants(id)as(select p_owner union select case when r.owner_id=p.id then r.recipient_id else r.owner_id end
 from participants p join public.peris_trade_caravans r on(r.owner_id=p.id or r.recipient_id=p.id)and r.status<>'completed')
 select array_agg(id order by id)from participants
$$;

create or replace function public.peris_trade_credit(p_city bigint,p_bag jsonb)returns jsonb
language plpgsql security definer set search_path='' as $$
declare s public.settlements%rowtype;credited jsonb;
begin
 select * into s from public.settlements where id=p_city and ruined_at is null for update;
 if s.id is null then return '{"wood":0,"stone":0,"food":0,"gold":0}'::jsonb;end if;
 credited:=jsonb_build_object('wood',least((p_bag->>'wood')::integer,greatest(0,floor(s.capacity-s.wood))),
 'stone',least((p_bag->>'stone')::integer,greatest(0,floor(s.capacity-s.stone))),
 'food',least((p_bag->>'food')::integer,greatest(0,floor(s.food_capacity-s.food))),
 'gold',least((p_bag->>'gold')::integer,greatest(0,floor(s.capacity-s.gold))));
 update public.settlements set wood=wood+(credited->>'wood')::integer,stone=stone+(credited->>'stone')::integer,
 food=food+(credited->>'food')::integer,gold=gold+(credited->>'gold')::integer where id=s.id;
 return credited;
end $$;
create or replace function public.peris_trade_subtract(p_bag jsonb,p_taken jsonb)returns jsonb
language sql immutable set search_path='' as $$
 select jsonb_object_agg(key,(value::text)::integer-coalesce((p_taken->>key)::integer,0))from jsonb_each(p_bag)
$$;
create or replace function public.peris_trade_volume(p_bag jsonb)returns integer
language sql immutable set search_path='' as $$select coalesce(sum((value::text)::integer),0)::integer from jsonb_each(p_bag)$$;

-- Actual point along the current return leg, including wrapped seams.
create or replace function public.peris_trade_return_position(p_id bigint,p_at timestamptz)returns jsonb
language plpgsql stable security definer set search_path='' as $$
declare r public.peris_trade_caravans%rowtype;point jsonb;previous jsonb;dx numeric;dy numeric;distance numeric:=0;remaining numeric;length numeric;fraction numeric;
begin
 select * into r from public.peris_trade_caravans where id=p_id;
 for point in select value from jsonb_array_elements(r.return_path)loop
  if previous is not null then dx:=public.peris_wrapped_delta((previous->>0)::numeric,(point->>0)::numeric);dy:=public.peris_wrapped_delta((previous->>1)::numeric,(point->>1)::numeric);distance:=distance+sqrt(dx*dx+dy*dy);end if;previous:=point;
 end loop;
 fraction:=least(1,greatest(0,extract(epoch from(p_at-r.return_departure_at))/greatest(.000001,extract(epoch from(r.return_at-r.return_departure_at)))));remaining:=distance*fraction;previous:=null;
 for point in select value from jsonb_array_elements(r.return_path)loop
  if previous is not null then
   dx:=public.peris_wrapped_delta((previous->>0)::numeric,(point->>0)::numeric);dy:=public.peris_wrapped_delta((previous->>1)::numeric,(point->>1)::numeric);length:=sqrt(dx*dx+dy*dy);
   if remaining<=length then return jsonb_build_array(public.peris_wrap_world(round((previous->>0)::numeric+dx*remaining/greatest(length,.000001))),public.peris_wrap_world(round((previous->>1)::numeric+dy*remaining/greatest(length,.000001))));end if;
   remaining:=remaining-length;
  end if;previous:=point;
 end loop;
 return previous;
end $$;

create or replace function public.peris_trade_event(p_id bigint,p_at timestamptz)returns void
language plpgsql security definer set search_path='' as $$
declare r public.peris_trade_caravans%rowtype;s public.settlements%rowtype;credited jsonb;remaining jsonb;route jsonb;point jsonb;path jsonb;
begin
 select * into r from public.peris_trade_caravans where id=p_id for update;
 if r.status='outbound'then
  credited:='{"wood":0,"stone":0,"food":0,"gold":0}';
  if exists(select 1 from public.settlements where id=r.target_settlement_id and owner_id=r.recipient_id and ruined_at is null)
  and(r.owner_id=r.recipient_id or exists(select 1 from public.peris_guild_members a join public.peris_guild_members b on b.guild_id=a.guild_id where a.player_id=r.owner_id and b.player_id=r.recipient_id))then
   credited:=public.peris_trade_credit(r.target_settlement_id,r.resources);
  end if;
  select jsonb_agg(value order by ord desc)into path from jsonb_array_elements(r.march_path)with ordinality p(value,ord);
  update public.peris_trade_caravans set delivered_resources=credited,returning_resources=public.peris_trade_subtract(r.resources,credited),
   status='returning',return_path=path,return_departure_at=r.arrival_at,return_settlement_id=r.source_settlement_id,
   redirect_at=case when exists(select 1 from public.settlements home where home.id=r.source_settlement_id and home.owner_id=r.owner_id and home.ruined_at is null)then null else r.arrival_at end where id=r.id;
  return;
 end if;
 if r.status not in('returning','waiting','stranded')then return;end if;
 if public.peris_trade_volume(r.returning_resources)=0 then
  update public.peris_trade_caravans set status='completed',completed_at=p_at where id=r.id;return;
 end if;
 select * into s from public.settlements where id=r.return_settlement_id and owner_id=r.owner_id and ruined_at is null;
 if s.id is null then
  point:=public.peris_trade_return_position(r.id,p_at);
  route:=public.peris_ruin_route(r.owner_id,(point->>0)::integer,(point->>1)::integer);
  if route is null then update public.peris_trade_caravans set status='stranded'where id=r.id;return;end if;
  update public.peris_trade_caravans set status='returning',return_path=route->'path',return_departure_at=p_at,redirect_at=null,
   return_settlement_id=(route->>'city_id')::bigint,return_at=p_at+make_interval(secs=>greatest(2,(route->>'distance')::numeric/22)::double precision)where id=r.id;
  return;
 end if;
 credited:=public.peris_trade_credit(s.id,r.returning_resources);remaining:=public.peris_trade_subtract(r.returning_resources,credited);
 update public.peris_trade_caravans set returning_resources=remaining,
 status=case when public.peris_trade_volume(remaining)=0 then 'completed'else 'waiting'end,
 completed_at=case when public.peris_trade_volume(remaining)=0 then p_at else null end where id=r.id;
end $$;

create or replace function public.peris_market_settle(p_owner uuid,p_until timestamptz)returns void
language plpgsql security definer set search_path='' as $$
declare participants uuid[];participant uuid;event record;r record;
begin
 -- Same structural lock as guild mutations. NOWAIT avoids waiting while callers hold player rows.
 if not pg_try_advisory_xact_lock(72320)then raise lock_not_available using message='Guild or trade state is settling. Try again.';end if;
 participants:=public.peris_trade_participants(p_owner);
 if exists(select 1 from public.peris_settler_expeditions where owner_id=any(participants)and status='travelling'and arrival_at<=p_until)
 and not pg_try_advisory_xact_lock(204200)then raise lock_not_available;end if;
 perform 1 from public.players where id=any(participants)order by id for update nowait;
 if participants is distinct from public.peris_trade_participants(p_owner)then raise serialization_failure using message='Trade participants changed. Try again.';end if;
 perform 1 from public.settlements where owner_id=any(participants)order by id for update nowait;
 -- Advancing everyone only to each next deadline prevents sender/receiver recursion and time travel.
 loop
  select q.id,q.at_time into event from(
   select c.id,case when c.status='outbound'then c.arrival_at else least(c.return_at,case when public.peris_trade_volume(c.returning_resources)>0 then c.redirect_at else null end)end as at_time
   from public.peris_trade_caravans c left join public.settlements s on s.id=c.return_settlement_id
   where c.owner_id=any(participants)and c.status in('outbound','returning'))q where q.at_time<=p_until order by q.at_time,q.id limit 1;
  exit when not found;
  foreach participant in array participants loop perform public.peris_settle_core(participant,event.at_time);end loop;
  perform public.peris_trade_event(event.id,event.at_time);
 end loop;
 foreach participant in array participants loop perform public.peris_settle_core(participant,p_until);end loop;
 for r in select id from public.peris_trade_caravans where owner_id=any(participants)and status in('waiting','stranded')order by id loop perform public.peris_trade_event(r.id,p_until);end loop;
 -- Retain a useful bounded sender history; receipts remain separately journaled.
 delete from public.peris_trade_caravans c where c.owner_id=any(participants)and c.status='completed'and c.id not in(
  select keep.id from public.peris_trade_caravans keep where keep.owner_id=c.owner_id and keep.status='completed'order by keep.completed_at desc,keep.id desc limit 50);
end $$;

create or replace function public.peris_send_resources(p_source bigint,p_target bigint,p_resources jsonb,p_path jsonb)returns jsonb
language plpgsql security definer set search_path='' as $$
declare u uuid:=public.peris_player_id();s public.settlements%rowtype;d public.settlements%rowtype;bag jsonb:='{}';key text;amount numeric;volume integer:=0;used integer;capacity integer;origin jsonb;arrival jsonb;distance numeric;new_id bigint;
begin
 if u is null then raise exception 'Authentication required';end if;
 if exists(select 1 from public.players where id=u and defeated_at is not null)then raise exception 'This ruler has been permanently defeated';end if;
 if p_resources is null or jsonb_typeof(p_resources)<>'object'or octet_length(p_resources::text)>500 then raise exception 'Choose positive whole resource quantities';end if;
 if exists(select 1 from jsonb_object_keys(p_resources)k where k not in('wood','stone','food','gold'))then raise exception 'Unknown resource';end if;
 foreach key in array array['wood','stone','food','gold']loop
  if p_resources?key then
   if jsonb_typeof(p_resources->key)<>'number'then raise exception 'Choose positive whole resource quantities';end if;
   amount:=(p_resources->>key)::numeric;
   if amount<0 or amount<>trunc(amount)or amount>5000 then raise exception 'Choose positive whole resource quantities';end if;
  else amount:=0;end if;
  bag:=bag||jsonb_build_object(key,amount::integer);volume:=volume+amount::integer;
 end loop;
 if volume=0 then raise exception 'Choose positive whole resource quantities';end if;
 if not pg_try_advisory_xact_lock(72320)then raise lock_not_available;end if;
 select * into s from public.settlements where id=p_source and owner_id=u and ruined_at is null;
 if s.id is null then raise exception 'Choose your living source city';end if;
 select * into d from public.settlements where id=p_target and ruined_at is null;
 if d.id is null or d.id=s.id or not(d.owner_id=u or exists(select 1 from public.peris_guild_members a join public.peris_guild_members b on b.guild_id=a.guild_id where a.player_id=u and b.player_id=d.owner_id))then raise exception 'Choose another own or guild city';end if;
 if not public.peris_lock_battle_participants(u,d.owner_id)then raise lock_not_available;end if;
 perform public.peris_settle(u);perform public.peris_settle(d.owner_id);
 perform 1 from public.settlements where id in(p_source,p_target)order by id for update nowait;
 select * into s from public.settlements where id=p_source and owner_id=u and ruined_at is null;
 select * into d from public.settlements where id=p_target and ruined_at is null;
 if s.id is null or d.id is null then raise exception 'Choose living cities';end if;
 select coalesce(sum(level),0)*1000 into capacity from public.peris_city_slots where settlement_id=s.id and building_type='bazaar';
 select coalesce(sum(c.volume),0)into used from public.peris_trade_caravans c where c.source_settlement_id=s.id and c.status<>'completed';
 if volume>capacity-used then raise exception 'Insufficient free Market capacity';end if;
 if s.wood<(bag->>'wood')::integer or s.stone<(bag->>'stone')::integer or s.food<(bag->>'food')::integer or s.gold<(bag->>'gold')::integer then raise exception 'Insufficient resources';end if;
 origin:=public.peris_home_army_position(s.x,s.y);arrival:=public.peris_home_army_position(d.x,d.y);
 distance:=public.peris_route_distance((origin->>'x')::numeric,(origin->>'y')::numeric,(arrival->>'x')::numeric,(arrival->>'y')::numeric,p_path);
 update public.settlements set wood=wood-(bag->>'wood')::integer,stone=stone-(bag->>'stone')::integer,food=food-(bag->>'food')::integer,gold=gold-(bag->>'gold')::integer where id=s.id;
 insert into public.peris_trade_caravans(owner_id,recipient_id,source_settlement_id,target_settlement_id,source_city,target_city,resources,returning_resources,volume,march_path,departure_at,arrival_at,return_at)
 values(u,d.owner_id,s.id,d.id,s.name,d.name,bag,bag,volume,p_path,public.peris_game_now(),public.peris_game_now()+make_interval(secs=>greatest(2,distance/22)::double precision),public.peris_game_now()+make_interval(secs=>2*greatest(2,distance/22)::double precision))returning id into new_id;
 -- Sending can open storage for an earlier waiting return; it cannot create free merchant capacity retroactively.
 perform public.peris_settle(u);
 return jsonb_build_object('ok',true,'caravan_id',new_id);
end $$;

revoke all on function public.peris_trade_city_changed(),public.peris_trade_targets(),public.peris_trade_status(),public.peris_trade_participants(uuid),public.peris_trade_credit(bigint,jsonb),public.peris_trade_subtract(jsonb,jsonb),public.peris_trade_volume(jsonb),public.peris_trade_return_position(bigint,timestamptz),public.peris_trade_event(bigint,timestamptz),public.peris_market_settle(uuid,timestamptz),public.peris_send_resources(bigint,bigint,jsonb,jsonb)from public,anon,authenticated;
grant execute on function public.peris_trade_targets(),public.peris_trade_status()to authenticated;

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

create or replace function public.peris_queue_slot(p_slot integer,p_type text default null) returns jsonb language plpgsql security definer set search_path='' as $$
declare u uuid:=public.peris_player_id();s public.settlements%rowtype;l integer;main integer;t text;factor numeric;cw numeric;cs numeric;cf numeric;cg numeric;
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
  if p_type not in ('barracks','stables','workshop','smithy','warehouse','granary','fishery','mage_tower','housing','academy','bazaar') then raise exception 'Unknown building';end if;
  if p_type='mage_tower' and exists(select 1 from public.peris_city_slots where settlement_id=s.id and building_type='mage_tower') then raise exception 'Only one mage tower can be built in your city';end if;
  if p_type='bazaar' and exists(select 1 from public.peris_city_slots where settlement_id=s.id and building_type='bazaar') then raise exception 'Only one Market can be built in your city';end if;
  if p_type='barracks' and exists(select 1 from public.peris_city_slots where settlement_id=s.id and building_type='barracks') then raise exception 'Only one barracks can be built in your city';end if;
  if (p_type='fishery')<>(p_slot=16) then raise exception 'A fishery needs a riverside plot';end if;
  -- New fisheries need public map water in the same wrapped 3x3 neighbourhood as the client.
  -- Existing buildings and pending orders remain valid, including earlier inland fisheries.
  if p_type='fishery' and not exists(
   select 1 from generate_series(-1,1) dx cross join generate_series(-1,1) dy
   where public.peris_world_terrain(floor(public.peris_wrap_world(s.x)/128)::integer+dx,floor(public.peris_wrap_world(s.y)/128)::integer+dy) in (6,7,8,9)
  ) then raise exception 'A fishery needs nearby river, lake or coastal water';end if;
  t:=p_type;l:=0;
 elsif l is null or l=0 then raise exception 'This building is not ready';end if;
 if l>=(case when t='mage_tower' then 10 else 5 end) then raise exception 'Maximum building level reached';end if;
 factor:=power(case when t='mage_tower' then 1.38::numeric else 1.55::numeric end,l);
 cw:=ceil((case t when 'bazaar' then 220 when 'academy' then 220 when 'workshop' then 260 when 'housing' then 140 when 'mage_tower' then 260 when 'barracks' then 180 when 'stables' then 200 when 'smithy' then 180 when 'warehouse' then 200 else 160 end)*factor);
 cs:=ceil((case t when 'bazaar' then 180 when 'academy' then 260 when 'workshop' then 220 when 'housing' then 110 when 'mage_tower' then 340 when 'barracks' then 160 when 'stables' then 120 when 'smithy' then 220 when 'warehouse' then 150 when 'granary' then 120 else 80 end)*factor);
 cf:=ceil((case t when 'workshop' then 120 when 'housing' then 60 when 'barracks' then 100 when 'stables' then 180 when 'smithy' then 80 when 'warehouse' then 90 else 100 end)*factor);
 cg:=ceil((case t when 'bazaar' then 50 when 'academy' then 80 when 'mage_tower' then 160 when 'barracks' then 30 when 'stables' then 45 when 'smithy' then 60 when 'granary' then 15 else 20 end)*factor);
 if s.wood<cw or s.stone<cs or s.food<cf or s.gold<cg then raise exception 'Your stores cannot cover this cost';end if;
 update public.settlements set wood=wood-cw,stone=stone-cs,food=food-cf,gold=gold-cg where id=s.id;
 if p_type is not null then insert into public.peris_city_slots values(s.id,p_slot,t,0);end if;
 insert into public.peris_orders(owner_id,kind,item,quantity,started_at,finish_at)values(u,'upgrade','slot:'||p_slot||':'||t,1,public.peris_game_now(),public.peris_game_now()+make_interval(secs=>greatest(1,ceil((15+l*10)/public.peris_research_factor(u,'construction')))::double precision));
 return jsonb_build_object('ok',true);
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
  union all select owner_id,due from public.peris_due_trade_caravans()
  union all select owner_id,due from public.peris_due_guild_reinforcements()
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
revoke all on function public.peris_settle_core(uuid,timestamptz),public.peris_settle(uuid,timestamptz)from public,anon,authenticated;
notify pgrst,'reload schema';
commit;