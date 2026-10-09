-- Preserve the existing realm; permit additional independently owned cities/armies.
alter table public.settlements drop constraint if exists settlements_owner_id_key;
alter table public.armies drop constraint if exists armies_owner_id_key;
alter table public.settlements alter column spawn_point_id drop not null;
alter table public.settlements add column if not exists settlers integer not null default 0 check(settlers between 0 and 6);
alter table public.settlements add column if not exists development_points integer not null default 0;
alter table public.players add column if not exists culture_points numeric not null default 0 check(culture_points between 0 and 1000000000);
alter table public.players add column if not exists culture_updated_at timestamptz not null default now();
alter table public.peris_orders add column if not exists settlement_id bigint references public.settlements(id) on delete cascade;
alter table public.peris_orders add column if not exists army_id bigint references public.armies(id) on delete cascade;
update public.peris_orders o set settlement_id=(select min(s.id)from public.settlements s where s.owner_id=o.owner_id)where settlement_id is null;
update public.peris_orders o set army_id=(select min(a.id)from public.armies a where a.owner_id=o.owner_id)where army_id is null and kind='recruit';
create index if not exists peris_orders_city on public.peris_orders(settlement_id,kind);
create index if not exists peris_orders_army on public.peris_orders(army_id,kind);
create index if not exists settlements_owner on public.settlements(owner_id);
create index if not exists armies_owner on public.armies(owner_id);
create table if not exists public.peris_heroes(
 id bigint generated always as identity primary key,owner_id uuid not null references public.players(id)on delete cascade,
 army_id bigint not null unique references public.armies(id)on delete cascade,name text not null,
 class text not null default 'knight' check(class in('knight','ranger','mage')),
 experience integer not null default 0 check(experience between 0 and 19000),
 attack integer not null default 0 check(attack between 0 and 19),defence integer not null default 0 check(defence between 0 and 19),
 power integer not null default 0 check(power between 0 and 19),knowledge integer not null default 0 check(knowledge between 0 and 19)
);
create table if not exists public.peris_artifact_catalog(
 id text primary key,name text not null,slot text not null check(slot in('weapon','armour','head','boots','charm')),
 attack integer not null default 0,defence integer not null default 0,power integer not null default 0,knowledge integer not null default 0,speed numeric not null default 0,unique(id,slot)
);
insert into public.peris_artifact_catalog(id,name,slot,attack,defence,power,knowledge,speed)values
 ('iron_sword','Iron oath','weapon',2,0,0,0,0),('oak_staff','Staff of embers','weapon',0,0,2,0,0),
 ('warblade','Dawnblade','weapon',4,0,0,0,0),('runestaff','Staff of the archmage','weapon',0,0,4,0,0),
 ('chainmail','Guardian mail','armour',0,2,0,0,0),('plate','Crownforged plate','armour',0,4,0,0,0),
 ('circlet','Scholar’s circlet','head',0,0,0,2,0),('warhelm','Helm of command','head',2,1,0,0,0),
 ('boots','Wayfarer’s boots','boots',0,0,0,0,.15),('windboots','Windwalkers','boots',0,0,0,0,.25),
 ('talisman','Amber talisman','charm',0,0,1,1,0),('crown_seal','Seal of the lost crown','charm',2,2,2,2,0)
 on conflict(id)do update set name=excluded.name,slot=excluded.slot,attack=excluded.attack,defence=excluded.defence,power=excluded.power,knowledge=excluded.knowledge,speed=excluded.speed;
create table if not exists public.peris_hero_artifacts(
 id bigint generated always as identity primary key,owner_id uuid not null references public.players(id)on delete cascade,
 artifact_id text not null,slot text not null,hero_id bigint references public.peris_heroes(id)on delete set null,
 source_camp_id integer,foreign key(artifact_id,slot)references public.peris_artifact_catalog(id,slot),unique(owner_id,source_camp_id)
);
create unique index if not exists peris_hero_equipment_slot on public.peris_hero_artifacts(hero_id,slot)where hero_id is not null;
create table if not exists public.peris_settler_expeditions(
 id bigint generated always as identity primary key,owner_id uuid not null references public.players(id)on delete cascade,
 origin_settlement_id bigint not null references public.settlements(id)on delete cascade,col integer not null check(col between -100 and 99),row integer not null check(row between -100 and 99),name text not null check(length(name)between 2 and 32),
 departure_at timestamptz not null,arrival_at timestamptz not null,culture_cost integer not null check(culture_cost>0),march_path jsonb not null,
 status text not null default 'travelling'check(status in('travelling','founded','returned')),settlement_id bigint references public.settlements(id),check(arrival_at>=departure_at)
);
create unique index if not exists peris_settler_site on public.peris_settler_expeditions(col,row)where status='travelling';
create index if not exists peris_settler_due on public.peris_settler_expeditions(owner_id,status,arrival_at);
alter table public.battle_formations add column if not exists defence_multiplier numeric not null default 1 check(defence_multiplier between 1 and 3);

create or replace function public.peris_city_id(p_owner uuid)returns bigint language plpgsql security definer set search_path='' as $$
declare requested bigint:=nullif(current_setting('peris.city_id',true),'')::bigint;result bigint;
begin
 if requested is null then select min(id)into result from public.settlements where owner_id=p_owner;
 else select id into result from public.settlements where owner_id=p_owner and id=requested;end if;
 if result is null then raise exception 'Choose one of your cities';end if;return result;
end $$;
create or replace function public.peris_army_id(p_owner uuid)returns bigint language plpgsql security definer set search_path='' as $$
declare requested bigint:=nullif(current_setting('peris.army_id',true),'')::bigint;result bigint;
begin
 if requested is null then select min(id)into result from public.armies where owner_id=p_owner;
 else select id into result from public.armies where owner_id=p_owner and id=requested;end if;
 if result is null then raise exception 'Choose one of your armies';end if;return result;
end $$;
create or replace function public.peris_scope_order()returns trigger language plpgsql security definer set search_path='' as $$
begin
 new.settlement_id:=coalesce(new.settlement_id,public.peris_city_id(new.owner_id));
 if not exists(select 1 from public.settlements where id=new.settlement_id and owner_id=new.owner_id)then raise exception 'Order city ownership mismatch';end if;
 if new.kind='recruit' then
 new.army_id:=coalesce(new.army_id,public.peris_army_id(new.owner_id));
 if not exists(select 1 from public.armies where id=new.army_id and owner_id=new.owner_id)then raise exception 'Order army ownership mismatch';end if;
 end if;return new;
end $$;
drop trigger if exists peris_scope_order on public.peris_orders;
create trigger peris_scope_order before insert or update of settlement_id,army_id,owner_id,kind on public.peris_orders for each row execute function public.peris_scope_order();
create or replace function public.peris_new_army_hero()returns trigger language plpgsql security definer set search_path='' as $$
begin
 insert into public.peris_heroes(owner_id,army_id,name)values(new.owner_id,new.id,(select display_name from public.players where id=new.owner_id)||' · Captain '||(select count(*)+1 from public.peris_heroes where owner_id=new.owner_id))on conflict(army_id)do nothing;return new;
end $$;
drop trigger if exists peris_new_army_hero on public.armies;
create trigger peris_new_army_hero after insert on public.armies for each row execute function public.peris_new_army_hero();
insert into public.peris_heroes(owner_id,army_id,name)select a.owner_id,a.id,p.display_name||' · Captain '||row_number()over(partition by a.owner_id order by a.id)from public.armies a join public.players p on p.id=a.owner_id on conflict(army_id)do nothing;

-- These new tables are private read-only DTOs; the authoritative RPC owns writes.
do $$declare t text;begin
 foreach t in array array['peris_heroes','peris_hero_artifacts','peris_settler_expeditions']loop
 execute format('alter table public.%I enable row level security',t);
 execute format('revoke all on public.%I from public,anon,authenticated',t);
 execute format('grant select on public.%I to authenticated',t);
 execute format('drop policy if exists "own gameplay data" on public.%I',t);
 execute format('create policy "own gameplay data" on public.%I for select to authenticated using(owner_id=auth.uid())',t);
 end loop;
end $$;
alter table public.peris_artifact_catalog enable row level security;
revoke all on public.peris_artifact_catalog from public,anon,authenticated;
grant select on public.peris_artifact_catalog to authenticated;
drop policy if exists "artifact catalogue" on public.peris_artifact_catalog;
create policy "artifact catalogue" on public.peris_artifact_catalog for select to authenticated using(true);
