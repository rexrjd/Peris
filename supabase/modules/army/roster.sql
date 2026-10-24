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
