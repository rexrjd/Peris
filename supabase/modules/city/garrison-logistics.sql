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
