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
 departure_at timestamptz not null default now(), arrival_at timestamptz,
 check(owner_id<>recipient_id)
);
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

create or replace function public.peris_guild_reinforcement_return(p_id bigint) returns boolean
language plpgsql security definer set search_path='' as $$
declare r public.peris_guild_reinforcements%rowtype;target jsonb;path jsonb;dest public.settlements%rowtype;start_x integer;start_y integer;pace numeric;
begin
 select * into r from public.peris_guild_reinforcements where id=p_id for update;
 if r.id is null then return false;end if;
 select * into dest from public.settlements where id=r.source_settlement_id and owner_id=r.owner_id and ruined_at is null;
 if dest.id is null then
  target:=public.peris_ruin_route(r.owner_id,r.target_x,r.target_y);
  if target is null then delete from public.peris_guild_reinforcements where id=r.id;return false;end if;
  select * into dest from public.settlements where id=(target->>'city_id')::bigint;
 end if;
 start_x:=r.target_x;start_y:=r.target_y;
 path:=public.peris_home_army_position(dest.x,dest.y);
 select coalesce(min(speed),40)into pace from public.peris_unit_catalog where coalesce((r.troops->>unit)::integer,0)>0;
 pace:=greatest(1,22*pace/40);
 -- The actual return path is authoritative; no instant transfer.
 target:=public.peris_ruin_route(r.owner_id,start_x,start_y);
 -- Return explicitly to the chosen source when reachable, otherwise to nearest safe home.
 if target is null then delete from public.peris_guild_reinforcements where id=r.id;return false;end if;
 update public.peris_guild_reinforcements set target_settlement_id=(target->>'city_id')::bigint,
  march_path=target->'path',target_x=(target->>'x')::integer,target_y=(target->>'y')::integer,
  status='returning',departure_at=now(),arrival_at=now()+make_interval(secs=>greatest(2,(target->>'distance')::numeric/pace)::double precision)
 where id=r.id;
 return true;
end $$;
revoke all on function public.peris_guild_reinforcement_return(bigint) from public,anon,authenticated;

create or replace function public.peris_recall_guild_reinforcements(p_id bigint) returns jsonb
language plpgsql security definer set search_path='' as $$
declare u uuid:=public.peris_player_id();r public.peris_guild_reinforcements%rowtype;
begin
 select * into r from public.peris_guild_reinforcements where id=p_id and owner_id=u for update;
 if r.id is null or r.status<>'stationed' then raise exception 'Only stationed reinforcements you sent can be recalled';end if;
 if exists(select 1 from public.battles where raid_city_id=r.target_settlement_id and status='active')then raise exception 'Wait for the city battle to end before recalling reinforcements';end if;
 perform public.peris_guild_reinforcement_return(r.id);
 return jsonb_build_object('ok',true);
end $$;
revoke all on function public.peris_recall_guild_reinforcements(bigint) from public,anon;
grant execute on function public.peris_recall_guild_reinforcements(bigint) to authenticated;

create or replace function public.peris_send_guild_reinforcements(p_source bigint,p_target bigint,p_troops jsonb,p_path jsonb) returns jsonb
language plpgsql security definer set search_path='' as $$
declare u uuid:=public.peris_player_id();s public.settlements%rowtype;d public.settlements%rowtype;
 selected jsonb;stock jsonb;remaining jsonb;origin jsonb;arrival jsonb;distance numeric;pace numeric;role text;new_id bigint;
begin
 if u is null then raise exception 'Authentication required';end if;
 select * into s from public.settlements where id=p_source and owner_id=u and ruined_at is null for update;
 select * into d from public.settlements where id=p_target and owner_id<>u and ruined_at is null for update;
 if s.id is null or d.id is null or not exists(select 1 from public.peris_guild_members a join public.peris_guild_members b on b.guild_id=a.guild_id
  where a.player_id=u and b.player_id=d.owner_id) then raise exception 'Choose your city and a living guild member city';end if;
 if exists(select 1 from public.players where id in(u,d.owner_id) and defeated_at is not null)then raise exception 'The ruler is defeated';end if;
 if exists(select 1 from public.battles where status='active'and (attacker_owner_id=u or defender_owner_id=u))then raise exception 'Finish the current battle first';end if;
 selected:=public.peris_garrison_troops(p_troops);
 if public.peris_roster_total(selected)=0 then raise exception 'Send at least one soldier';end if;
 select unit_roster into stock from public.peris_city_garrisons where owner_id=u and settlement_id=s.id for update;
 if stock is null then raise exception 'No permanent garrison troops available';end if;
 stock:=public.peris_roster(stock);
 foreach role in array array['infantry','spearmen','archers','elite','cavalry','scout','heavyCavalry','ram','catapult']loop
  if (selected->>role)::integer>(stock->>role)::integer then raise exception 'Insufficient troops in sending garrison';end if;
 end loop;
 origin:=public.peris_home_army_position(s.x,s.y);arrival:=public.peris_home_army_position(d.x,d.y);
 distance:=public.peris_route_distance((origin->>'x')::numeric,(origin->>'y')::numeric,(arrival->>'x')::numeric,(arrival->>'y')::numeric,p_path);
 select coalesce(min(speed),40)into pace from public.peris_unit_catalog where coalesce((selected->>unit)::integer,0)>0;
 pace:=greatest(1,22*pace/40);
 remaining:=public.peris_roster_add(stock,selected,-1);
 if public.peris_roster_total(remaining)=0 then delete from public.peris_city_garrisons where settlement_id=s.id and owner_id=u;
 else update public.peris_city_garrisons set unit_roster=remaining where settlement_id=s.id and owner_id=u;end if;
 insert into public.peris_guild_reinforcements(owner_id,recipient_id,source_settlement_id,target_settlement_id,troops,march_path,target_x,target_y,departure_at,arrival_at)
 values(u,d.owner_id,s.id,d.id,selected,p_path,(arrival->>'x')::integer,(arrival->>'y')::integer,now(),now()+make_interval(secs=>greatest(2,distance/pace)::double precision))returning id into new_id;
 return jsonb_build_object('ok',true,'reinforcement_id',new_id);
end $$;
revoke all on function public.peris_send_guild_reinforcements(bigint,bigint,jsonb,jsonb) from public,anon;
grant execute on function public.peris_send_guild_reinforcements(bigint,bigint,jsonb,jsonb) to authenticated;

create or replace function public.peris_guild_reinforcements_advance(p_owner uuid,p_until timestamptz)returns void
language plpgsql security definer set search_path='' as $$
declare r public.peris_guild_reinforcements%rowtype;city public.settlements%rowtype;is_guild boolean;
begin
 for r in select * from public.peris_guild_reinforcements where owner_id=p_owner and (status='stationed' or arrival_at<=p_until)
 order by id for update loop
  select * into city from public.settlements where id=r.target_settlement_id and owner_id=r.recipient_id and ruined_at is null;
  select exists(select 1 from public.peris_guild_members a join public.peris_guild_members b on b.guild_id=a.guild_id where a.player_id=r.owner_id and b.player_id=r.recipient_id)into is_guild;
  if r.status='stationed' then
   if exists(select 1 from public.battles where raid_city_id=r.target_settlement_id and status='active')then continue;end if;
   if not is_guild or city.id is null then perform public.peris_guild_reinforcement_return(r.id);end if;
  elsif r.status='outbound' then
   if is_guild and city.id is not null then
    update public.peris_guild_reinforcements set status='stationed',arrival_at=null where id=r.id;
   else perform public.peris_guild_reinforcement_return(r.id);end if;
  elsif r.status='returning' then
   select * into city from public.settlements where id=r.target_settlement_id and owner_id=r.owner_id and ruined_at is null;
   if city.id is null then perform public.peris_guild_reinforcement_return(r.id);
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
  'departure_at',r.departure_at,'arrival_at',r.arrival_at)
  order by r.departure_at desc),'[]'::jsonb)
 from public.peris_guild_reinforcements r
 join public.settlements s on s.id=r.source_settlement_id
 join public.settlements t on t.id=r.target_settlement_id
 where (r.owner_id=public.peris_player_id() or r.recipient_id=public.peris_player_id())
$$;
revoke all on function public.peris_guild_reinforcement_status() from public,anon;
grant execute on function public.peris_guild_reinforcement_status() to authenticated;
