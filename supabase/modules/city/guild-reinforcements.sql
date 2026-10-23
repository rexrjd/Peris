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
