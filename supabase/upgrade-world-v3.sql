-- PERIS WORLD v3 UPGRADE
-- Safe to run on top of the existing anonymous-player prototype.
-- It keeps existing players and adds persistent settlements, resources and armies.

create table if not exists public.settlements (
  id bigint generated always as identity primary key,
  owner_id uuid not null unique references public.players(id) on delete cascade,
  name text not null,
  x integer not null check (x >= 0 and x <= 1100),
  y integer not null check (y >= 0 and y <= 700),
  wood integer not null default 1000,
  stone integer not null default 1000,
  food integer not null default 1000,
  gold integer not null default 500,
  wood_rate integer not null default 20,
  stone_rate integer not null default 15,
  food_rate integer not null default 25,
  gold_rate integer not null default 5,
  resources_updated_at timestamptz not null default now(),
  created_at timestamptz not null default now()
);

create table if not exists public.armies (
  id bigint generated always as identity primary key,
  owner_id uuid not null unique references public.players(id) on delete cascade,
  home_settlement_id bigint not null references public.settlements(id) on delete cascade,
  name text not null default '1st Army',
  infantry integer not null default 100,
  archers integer not null default 40,
  cavalry integer not null default 10,
  start_x integer not null,
  start_y integer not null,
  target_x integer not null,
  target_y integer not null,
  departure_at timestamptz not null default now(),
  arrival_at timestamptz not null default now(),
  status text not null default 'idle' check (status in ('idle', 'moving')),
  updated_at timestamptz not null default now()
);

alter table public.settlements enable row level security;
alter table public.armies enable row level security;

drop policy if exists "Authenticated users can see settlements" on public.settlements;
create policy "Authenticated users can see settlements"
on public.settlements for select
to authenticated
using (true);

drop policy if exists "Players can create their settlement" on public.settlements;
create policy "Players can create their settlement"
on public.settlements for insert
to authenticated
with check (auth.uid() = owner_id);

drop policy if exists "Players can update their settlement" on public.settlements;
create policy "Players can update their settlement"
on public.settlements for update
to authenticated
using (auth.uid() = owner_id)
with check (auth.uid() = owner_id);

drop policy if exists "Authenticated users can see armies" on public.armies;
create policy "Authenticated users can see armies"
on public.armies for select
to authenticated
using (true);

drop policy if exists "Players can create their army" on public.armies;
create policy "Players can create their army"
on public.armies for insert
to authenticated
with check (auth.uid() = owner_id);

drop policy if exists "Players can move their army" on public.armies;
create policy "Players can move their army"
on public.armies for update
to authenticated
using (auth.uid() = owner_id)
with check (auth.uid() = owner_id);

-- Existing prototype players receive a permanent settlement at their old map position.
insert into public.settlements (owner_id, name, x, y)
select p.id, p.display_name || '''s Hold', p.x, p.y
from public.players p
where not exists (
  select 1 from public.settlements s where s.owner_id = p.id
);

-- Existing players receive one starter army stationed at home.
insert into public.armies (
  owner_id,
  home_settlement_id,
  name,
  infantry,
  archers,
  cavalry,
  start_x,
  start_y,
  target_x,
  target_y,
  status
)
select
  s.owner_id,
  s.id,
  '1st Army',
  100,
  40,
  10,
  s.x,
  s.y,
  s.x,
  s.y,
  'idle'
from public.settlements s
where not exists (
  select 1 from public.armies a where a.owner_id = s.owner_id
);

-- Every future player automatically gets a settlement and starter army.
create or replace function public.create_peris_world_for_player()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  settlement_id bigint;
begin
  insert into public.settlements (owner_id, name, x, y)
  values (new.id, new.display_name || '''s Hold', new.x, new.y)
  returning id into settlement_id;

  insert into public.armies (
    owner_id,
    home_settlement_id,
    name,
    infantry,
    archers,
    cavalry,
    start_x,
    start_y,
    target_x,
    target_y,
    status
  )
  values (
    new.id,
    settlement_id,
    '1st Army',
    100,
    40,
    10,
    new.x,
    new.y,
    new.x,
    new.y,
    'idle'
  );

  return new;
end;
$$;

drop trigger if exists create_peris_world_after_player on public.players;
create trigger create_peris_world_after_player
after insert on public.players
for each row execute function public.create_peris_world_for_player();

-- Add new tables to Realtime if they are not already there.
do $$
begin
  alter publication supabase_realtime add table public.settlements;
exception
  when duplicate_object then null;
end $$;

do $$
begin
  alter publication supabase_realtime add table public.armies;
exception
  when duplicate_object then null;
end $$;
