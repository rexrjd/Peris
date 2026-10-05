-- PERIS v7 · Empire prototype. Run this entire file in Supabase SQL Editor.
-- Requires the v5 schema. Preserves players, settlements, resources and armies.
-- Safe to run again. No Auth users or campaign data are deleted.
begin;

alter table public.players add column if not exists prestige integer not null default 0;
alter table public.players add column if not exists victories integer not null default 0;
alter table public.players add column if not exists recruits integer not null default 0;
alter table public.players add column if not exists upgrades integer not null default 0;
alter table public.settlements add column if not exists capacity integer not null default 7500;
alter table public.settlements alter column wood type numeric(18,4);
alter table public.settlements alter column stone type numeric(18,4);
alter table public.settlements alter column food type numeric(18,4);
alter table public.settlements alter column gold type numeric(18,4);
alter table public.buildings drop constraint if exists buildings_building_type_check;
alter table public.buildings add constraint buildings_building_type_check check(building_type in ('lumber','quarry','farm','market','barracks','stables','wall','storehouse'));
insert into public.buildings(settlement_id,building_type,level)
select s.id,t,1 from public.settlements s cross join unnest(array['barracks','stables','wall','storehouse']) t
on conflict(settlement_id,building_type) do nothing;

create table if not exists public.peris_camps(
 id integer primary key,name text not null,x integer not null,y integer not null,tier integer not null,
 terrain text not null,infantry integer not null,archers integer not null,cavalry integer not null,description text not null
);
insert into public.peris_camps values
 (1,'The broken standard',305,405,1,'plains',48,18,0,'Deserters have claimed the old crossroads. An ideal first campaign.'),
 (2,'Oakwood raiders',460,155,2,'woods',90,45,12,'Bowmen hide beneath dense oak cover. Keep your cavalry out of the trees.'),
 (3,'The river watch',655,485,2,'river',100,40,15,'A fortified crossing. The shallows slow troops; use the stone bridge.'),
 (4,'Highland warband',790,160,3,'highlands',160,70,24,'Veteran spearmen defend the ridge. High ground favours their archers.'),
 (5,'Ashen legion',910,550,4,'plains',240,110,55,'A rebel legion controls the eastern road. You will need a larger host.'),
 (6,'The fallen capital',605,280,5,'highlands',340,160,80,'Break the last great host and restore the lost province of Peris.')
on conflict(id) do update set name=excluded.name,x=excluded.x,y=excluded.y,tier=excluded.tier,terrain=excluded.terrain,
 infantry=excluded.infantry,archers=excluded.archers,cavalry=excluded.cavalry,description=excluded.description;

alter table public.armies add column if not exists raid_target_id integer references public.peris_camps(id);
alter table public.battles alter column defender_owner_id drop not null;
alter table public.battles alter column defender_army_id drop not null;
alter table public.battles add column if not exists phase text not null default 'combat';
alter table public.battles add column if not exists mode text not null default 'pvp';
alter table public.battles add column if not exists camp_id integer references public.peris_camps(id);
alter table public.battles add column if not exists terrain text not null default 'plains';
alter table public.battles add column if not exists difficulty text not null default 'normal';
alter table public.battles add column if not exists enemy_name text not null default 'Rival army';
alter table public.battles add column if not exists winner_side text;
alter table public.battles add column if not exists attacker_ready boolean not null default false;
alter table public.battles add column if not exists defender_ready boolean not null default false;
alter table public.battles add column if not exists elapsed numeric not null default 0;
alter table public.battles add column if not exists rally_attacker boolean not null default false;
alter table public.battles add column if not exists rally_defender boolean not null default false;
alter table public.battle_formations alter column owner_id drop not null;
alter table public.battle_formations drop constraint if exists battle_formations_battle_id_owner_id_unit_type_key;
alter table public.battle_formations add column if not exists label text not null default 'Formation';
alter table public.battle_formations add column if not exists stamina numeric(6,2) not null default 100;
alter table public.battle_formations add column if not exists columns integer not null default 10;
alter table public.battle_formations add column if not exists stance text not null default 'balanced';
alter table public.battle_formations add column if not exists running boolean not null default false;
alter table public.battle_formations add column if not exists fire_at_will boolean not null default true;
alter table public.battle_formations add column if not exists target_facing numeric;

create table if not exists public.peris_orders(
 id bigint generated always as identity primary key,owner_id uuid not null references public.players(id) on delete cascade,
 kind text not null check(kind in ('upgrade','recruit')),item text not null,quantity integer not null check(quantity>0),
 started_at timestamptz not null,finish_at timestamptz not null
);
create index if not exists peris_orders_owner_idx on public.peris_orders(owner_id,finish_at);
create table if not exists public.peris_progress(
 owner_id uuid not null references public.players(id) on delete cascade,camp_id integer not null references public.peris_camps(id),
 defeated integer not null default 1,available_at timestamptz not null,primary key(owner_id,camp_id)
);
create table if not exists public.peris_claims(
 owner_id uuid not null references public.players(id) on delete cascade,quest_id text not null,primary key(owner_id,quest_id)
);
create table if not exists public.peris_reports(
 id bigint generated always as identity primary key,owner_id uuid not null references public.players(id) on delete cascade,
 battle_id bigint not null references public.battles(id) on delete cascade,title text not null,won boolean not null,
 result jsonb not null,created_at timestamptz not null default now(),unique(owner_id,battle_id)
);
create table if not exists public.peris_challenges(
 id bigint generated always as identity primary key,attacker_owner_id uuid not null references public.players(id) on delete cascade,
 defender_owner_id uuid not null references public.players(id) on delete cascade,status text not null default 'pending',
 created_at timestamptz not null default now(),expires_at timestamptz not null default now()+interval '90 seconds',
 check(attacker_owner_id<>defender_owner_id)
);
create index if not exists peris_challenges_lookup_idx on public.peris_challenges(defender_owner_id,status);

-- New tables expose read access only. All game changes are checked by RPC functions.
do $$ declare t text; begin
 foreach t in array array['peris_camps','peris_orders','peris_progress','peris_claims','peris_reports','peris_challenges'] loop
 execute format('alter table public.%I enable row level security',t);
 execute format('revoke all on public.%I from anon, authenticated',t);
 execute format('grant select on public.%I to authenticated',t);
 end loop;
end $$;
drop policy if exists "camp read" on public.peris_camps;
create policy "camp read" on public.peris_camps for select to authenticated using(true);
drop policy if exists "own orders" on public.peris_orders;
create policy "own orders" on public.peris_orders for select to authenticated using(owner_id=auth.uid());
drop policy if exists "own progress" on public.peris_progress;
create policy "own progress" on public.peris_progress for select to authenticated using(owner_id=auth.uid());
drop policy if exists "own claims" on public.peris_claims;
create policy "own claims" on public.peris_claims for select to authenticated using(owner_id=auth.uid());
drop policy if exists "own reports" on public.peris_reports;
create policy "own reports" on public.peris_reports for select to authenticated using(owner_id=auth.uid());
drop policy if exists "challenge participants" on public.peris_challenges;
create policy "challenge participants" on public.peris_challenges for select to authenticated
using(attacker_owner_id=auth.uid() or defender_owner_id=auth.uid());

-- Internal helpers are revoked from ALL client roles at the end of the file.
