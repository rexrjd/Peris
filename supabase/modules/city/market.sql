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
 from participants p join(select owner_id,recipient_id from public.peris_trade_caravans where status<>'completed' union select owner_id,recipient_id from public.peris_trade_route_edges() union select owner_id,recipient_id from public.peris_scout_edges())r on(r.owner_id=p.id or r.recipient_id=p.id))
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
 foreach participant in array participants loop perform public.peris_optional_advance_trade_routes(participant,p_until);end loop;
 -- Retain a useful bounded sender history; receipts remain separately journaled.
 delete from public.peris_trade_caravans c where c.owner_id=any(participants)and c.status='completed'and c.id not in(
  select keep.id from public.peris_trade_caravans keep where keep.owner_id=c.owner_id and keep.status='completed'order by keep.completed_at desc,keep.id desc limit 50);
end $$;

create or replace function public.peris_dispatch_caravan(p_owner uuid,p_source bigint,p_target bigint,p_resources jsonb,p_path jsonb,p_at timestamptz)returns jsonb
language plpgsql security definer set search_path='' as $$
declare u uuid:=p_owner;s public.settlements%rowtype;d public.settlements%rowtype;bag jsonb:='{}';key text;amount numeric;volume integer:=0;used integer;capacity integer;origin jsonb;arrival jsonb;distance numeric;new_id bigint;
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
 values(u,d.owner_id,s.id,d.id,s.name,d.name,bag,bag,volume,p_path,p_at,p_at+make_interval(secs=>greatest(2,distance/22)::double precision),p_at+make_interval(secs=>2*greatest(2,distance/22)::double precision))returning id into new_id;
 return jsonb_build_object('ok',true,'caravan_id',new_id);
end $$;


create or replace function public.peris_send_resources(p_source bigint,p_target bigint,p_resources jsonb,p_path jsonb)returns jsonb
language plpgsql security definer set search_path='' as $$
declare u uuid:=public.peris_player_id();recipient uuid;answer jsonb;
begin
 if u is null then raise exception 'Authentication required';end if;
 if not pg_try_advisory_xact_lock(72320)then raise lock_not_available;end if;
 select owner_id into recipient from public.settlements where id=p_target and ruined_at is null;
 if recipient is null then raise exception 'Choose another own or guild city';end if;
 if not public.peris_lock_battle_participants(u,recipient)then raise lock_not_available;end if;
 perform public.peris_settle(u);perform public.peris_settle(recipient);
 answer:=public.peris_dispatch_caravan(u,p_source,p_target,p_resources,p_path,public.peris_game_now());
 -- Sending can open storage for an earlier waiting return.
 perform public.peris_settle(u);
 return answer;
end $$;
revoke all on function public.peris_dispatch_caravan(uuid,bigint,bigint,jsonb,jsonb,timestamptz)from public,anon,authenticated;

revoke all on function public.peris_trade_city_changed(),public.peris_trade_targets(),public.peris_trade_status(),public.peris_trade_participants(uuid),public.peris_trade_credit(bigint,jsonb),public.peris_trade_subtract(jsonb,jsonb),public.peris_trade_volume(jsonb),public.peris_trade_return_position(bigint,timestamptz),public.peris_trade_event(bigint,timestamptz),public.peris_market_settle(uuid,timestamptz),public.peris_send_resources(bigint,bigint,jsonb,jsonb)from public,anon,authenticated;
grant execute on function public.peris_trade_targets(),public.peris_trade_status()to authenticated;
