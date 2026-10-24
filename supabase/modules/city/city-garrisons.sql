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
revoke all on function public.peris_manage_city_garrison(uuid,bigint,bigint,text,jsonb) from public,anon,authenticated;
