-- Canonical nine-role inventories in the existing realm. Legacy class totals remain compatible.
alter table public.armies add column if not exists unit_roster jsonb;
alter table public.armies add column if not exists carried_loot jsonb;
alter table public.armies add column if not exists farm_list_id bigint;
alter table public.battle_formations add column if not exists recruit_unit text;
create table if not exists public.peris_unit_catalog (
 unit text primary key, building text not null, combat_class text not null,
 cost jsonb not null, train_seconds integer not null, research_seconds integer not null,
 research_cost jsonb not null, attack numeric not null, defence numeric not null, speed integer not null, carry integer not null
);
insert into public.peris_unit_catalog values
 ('infantry','barracks','infantry','{"wood":4,"stone":2,"food":6,"gold":1}',2,0,'{"wood":0,"stone":0,"food":0,"gold":0}',1,1,40,20),
 ('spearmen','barracks','infantry','{"wood":5,"stone":3,"food":7,"gold":1}',3,30,'{"wood":40,"stone":30,"food":50,"gold":10}',.9,1.2,36,15),
 ('archers','barracks','archers','{"wood":6,"stone":2,"food":5,"gold":2}',2,0,'{"wood":0,"stone":0,"food":0,"gold":0}',1,1,34,15),
 ('elite','barracks','infantry','{"wood":8,"stone":6,"food":12,"gold":3}',4,60,'{"wood":100,"stone":80,"food":120,"gold":30}',1.4,1.35,38,15),
 ('cavalry','stables','cavalry','{"wood":4,"stone":7,"food":12,"gold":4}',5,0,'{"wood":0,"stone":0,"food":0,"gold":0}',1,1,76,40),
 ('scout','stables','cavalry','{"wood":3,"stone":5,"food":9,"gold":3}',4,30,'{"wood":40,"stone":20,"food":50,"gold":10}',.45,.75,92,10),
 ('heavyCavalry','stables','cavalry','{"wood":8,"stone":12,"food":20,"gold":7}',8,60,'{"wood":100,"stone":120,"food":150,"gold":40}',1.45,1.35,60,35),
 ('ram','workshop','infantry','{"wood":20,"stone":15,"food":15,"gold":6}',12,90,'{"wood":180,"stone":120,"food":80,"gold":35}',.6,2,16,0),
 ('catapult','workshop','archers','{"wood":30,"stone":20,"food":18,"gold":10}',18,120,'{"wood":220,"stone":180,"food":100,"gold":60}',2.4,.7,12,0)
 on conflict(unit) do update set building=excluded.building,combat_class=excluded.combat_class,cost=excluded.cost,train_seconds=excluded.train_seconds,research_seconds=excluded.research_seconds,research_cost=excluded.research_cost,attack=excluded.attack,defence=excluded.defence,speed=excluded.speed,carry=excluded.carry;
revoke all on public.peris_unit_catalog from public,anon,authenticated;
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
 foreach unit_name in array array['infantry','spearmen','archers','elite','cavalry','scout','heavyCavalry','ram','catapult'] loop
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
alter table public.battle_formations add column if not exists unit_attack numeric not null default 1 check(unit_attack between .4 and 20);
alter table public.battle_formations add column if not exists unit_defence numeric not null default 1 check(unit_defence between .5 and 20);
alter table public.battle_formations add column if not exists unit_speed numeric not null default 1 check(unit_speed between .15 and 3);
create or replace function public.peris_roster_take_classes(p_roster jsonb,p_classes jsonb)returns jsonb
language plpgsql security definer set search_path='' as $$
declare available jsonb:=public.peris_roster(p_roster);chosen jsonb:=public.peris_roster('{}');typ text;unit_name text;remaining integer;amount integer;
begin
 foreach typ in array array['infantry','archers','cavalry']loop
  remaining:=(p_classes->>typ)::integer;
  if remaining is null or remaining<0 then raise exception 'Choose available soldiers';end if;
  foreach unit_name in array array['infantry','spearmen','archers','elite','cavalry','scout','heavyCavalry','ram','catapult']loop
   if (select combat_class from public.peris_unit_catalog where unit=unit_name)<>typ then continue;end if;
   amount:=least(remaining,(available->>unit_name)::integer);remaining:=remaining-amount;
   chosen:=jsonb_set(chosen,array[unit_name],to_jsonb(amount));
  end loop;
  if remaining>0 then raise exception 'Choose available soldiers';end if;
 end loop;
 return chosen;
end $$;
