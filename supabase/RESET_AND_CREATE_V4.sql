-- PERIS V4 - CLEAN PROTOTYPE RESET
-- Run this WHOLE file in Supabase > SQL Editor.
-- It intentionally deletes all existing Peris PUBLIC game data.
-- It does NOT delete Supabase Auth users, so browsers that are already signed in
-- can simply choose a new ruler name after the reset.

begin;

-- Remove the old prototype world and any dependent policies/triggers/functions.
drop table if exists public.armies cascade;
drop table if exists public.buildings cascade;
drop table if exists public.settlements cascade;
drop table if exists public.spawn_points cascade;
drop table if exists public.players cascade;

drop function if exists public.create_peris_world_for_player() cascade;
drop function if exists public.create_player(text) cascade;
drop function if exists public.sync_my_state() cascade;
drop function if exists public.upgrade_building(text) cascade;
drop function if exists public.recruit_units(integer, integer, integer) cascade;
drop function if exists public.move_army(integer, integer) cascade;

create table public.players (
  id uuid primary key references auth.users(id) on delete cascade,
  display_name text not null,
  created_at timestamptz not null default now()
);

create unique index players_display_name_lower_key
on public.players (lower(display_name));

create table public.spawn_points (
  id integer primary key,
  x integer not null,
  y integer not null
);

insert into public.spawn_points (id, x, y) values
  (1, 150, 285),
  (2, 1050, 280),
  (3, 210, 665),
  (4, 1000, 660),
  (5, 350, 205),
  (6, 855, 205),
  (7, 390, 670),
  (8, 815, 655),
  (9, 125, 420),
  (10, 1080, 405),
  (11, 455, 305),
  (12, 750, 305);

create table public.settlements (
  id bigint generated always as identity primary key,
  owner_id uuid not null unique references public.players(id) on delete cascade,
  spawn_point_id integer not null unique references public.spawn_points(id),
  name text not null,
  x integer not null check (x between 45 and 1155),
  y integer not null check (y between 55 and 715),
  wood integer not null default 900 check (wood >= 0),
  stone integer not null default 750 check (stone >= 0),
  food integer not null default 1100 check (food >= 0),
  gold integer not null default 300 check (gold >= 0),
  wood_rate integer not null default 22,
  stone_rate integer not null default 19,
  food_rate integer not null default 28,
  gold_rate integer not null default 6,
  resources_updated_at timestamptz not null default now(),
  created_at timestamptz not null default now()
);

create table public.buildings (
  id bigint generated always as identity primary key,
  settlement_id bigint not null references public.settlements(id) on delete cascade,
  building_type text not null check (building_type in ('lumber', 'quarry', 'farm', 'market')),
  level integer not null default 1 check (level between 1 and 20),
  updated_at timestamptz not null default now(),
  unique (settlement_id, building_type)
);

create table public.armies (
  id bigint generated always as identity primary key,
  owner_id uuid not null unique references public.players(id) on delete cascade,
  home_settlement_id bigint not null references public.settlements(id) on delete cascade,
  name text not null default '1st Host',
  infantry integer not null default 80 check (infantry >= 0),
  archers integer not null default 30 check (archers >= 0),
  cavalry integer not null default 5 check (cavalry >= 0),
  start_x integer not null,
  start_y integer not null,
  target_x integer not null,
  target_y integer not null,
  departure_at timestamptz not null default now(),
  arrival_at timestamptz not null default now(),
  status text not null default 'idle' check (status in ('idle', 'moving')),
  updated_at timestamptz not null default now()
);

alter table public.players enable row level security;
alter table public.spawn_points enable row level security;
alter table public.settlements enable row level security;
alter table public.buildings enable row level security;
alter table public.armies enable row level security;

-- Players can read the shared world, but game writes happen only through server-side RPCs.
create policy "world players readable" on public.players
for select to authenticated using (true);
create policy "world settlements readable" on public.settlements
for select to authenticated using (true);
create policy "world buildings readable" on public.buildings
for select to authenticated using (true);
create policy "world armies readable" on public.armies
for select to authenticated using (true);
create policy "spawn points readable" on public.spawn_points
for select to authenticated using (true);

grant select on public.players, public.settlements, public.buildings, public.armies, public.spawn_points to authenticated;

-- Create the authenticated player's realm. Spawn selection happens on the database,
-- so two players cannot be assigned the same starting position.
create or replace function public.create_player(p_display_name text)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_uid uuid := auth.uid();
  v_name text := btrim(p_display_name);
  v_spawn public.spawn_points%rowtype;
  v_settlement_id bigint;
begin
  if v_uid is null then
    raise exception 'Authentication required';
  end if;

  if exists (select 1 from public.players where id = v_uid) then
    return jsonb_build_object('ok', true, 'already_exists', true);
  end if;

  if v_name !~ '^[A-Za-z0-9 _-]{2,20}$' then
    raise exception 'Name must be 2-20 letters, numbers, spaces, _ or -';
  end if;

  if exists (select 1 from public.players where lower(display_name) = lower(v_name)) then
    raise exception 'That ruler name is already taken';
  end if;

  select sp.* into v_spawn
  from public.spawn_points sp
  left join public.settlements s on s.spawn_point_id = sp.id
  where s.id is null
  order by sp.id
  limit 1
  for update of sp skip locked;

  if v_spawn.id is null then
    raise exception 'Realm Alpha is full. Add more spawn points.';
  end if;

  insert into public.players (id, display_name)
  values (v_uid, v_name);

  insert into public.settlements (
    owner_id, spawn_point_id, name, x, y,
    wood, stone, food, gold,
    wood_rate, stone_rate, food_rate, gold_rate
  ) values (
    v_uid, v_spawn.id, v_name || '''s Keep', v_spawn.x, v_spawn.y,
    900, 750, 1100, 300,
    22, 19, 28, 6
  ) returning id into v_settlement_id;

  insert into public.buildings (settlement_id, building_type, level) values
    (v_settlement_id, 'lumber', 1),
    (v_settlement_id, 'quarry', 1),
    (v_settlement_id, 'farm', 1),
    (v_settlement_id, 'market', 1);

  insert into public.armies (
    owner_id, home_settlement_id, name,
    infantry, archers, cavalry,
    start_x, start_y, target_x, target_y,
    status
  ) values (
    v_uid, v_settlement_id, '1st Host',
    80, 30, 5,
    v_spawn.x + 42, v_spawn.y + 28,
    v_spawn.x + 42, v_spawn.y + 28,
    'idle'
  );

  return jsonb_build_object('ok', true, 'spawn', v_spawn.id);
exception
  when unique_violation then
    raise exception 'That ruler name is already taken';
end;
$$;

-- Settle offline resource production and completed movement for the current player.
create or replace function public.sync_my_state()
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_uid uuid := auth.uid();
  v_now timestamptz := now();
begin
  if v_uid is null then raise exception 'Authentication required'; end if;

  update public.settlements s
  set
    wood = s.wood + floor(s.wood_rate * extract(epoch from (v_now - s.resources_updated_at)) / 60.0)::integer,
    stone = s.stone + floor(s.stone_rate * extract(epoch from (v_now - s.resources_updated_at)) / 60.0)::integer,
    food = s.food + floor(s.food_rate * extract(epoch from (v_now - s.resources_updated_at)) / 60.0)::integer,
    gold = s.gold + floor(s.gold_rate * extract(epoch from (v_now - s.resources_updated_at)) / 60.0)::integer,
    resources_updated_at = v_now
  where s.owner_id = v_uid
    and s.resources_updated_at < v_now;

  update public.armies
  set status = 'idle',
      start_x = target_x,
      start_y = target_y,
      departure_at = v_now,
      arrival_at = v_now,
      updated_at = v_now
  where owner_id = v_uid
    and status = 'moving'
    and arrival_at <= v_now;

  return jsonb_build_object('ok', true);
end;
$$;

create or replace function public.upgrade_building(p_building_type text)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_uid uuid := auth.uid();
  v_settlement public.settlements%rowtype;
  v_level integer;
  v_new_level integer;
  v_factor numeric;
  c_wood integer;
  c_stone integer;
  c_food integer;
  c_gold integer;
begin
  if v_uid is null then raise exception 'Authentication required'; end if;
  if p_building_type not in ('lumber', 'quarry', 'farm', 'market') then raise exception 'Unknown building'; end if;

  perform public.sync_my_state();

  select * into v_settlement from public.settlements where owner_id = v_uid for update;
  select level into v_level from public.buildings
    where settlement_id = v_settlement.id and building_type = p_building_type for update;

  if v_level >= 20 then raise exception 'Building is already max level'; end if;
  v_factor := power(1.65::numeric, v_level - 1);

  if p_building_type = 'lumber' then
    c_wood := ceil(150 * v_factor); c_stone := ceil(90 * v_factor); c_food := ceil(70 * v_factor); c_gold := ceil(10 * v_factor);
  elsif p_building_type = 'quarry' then
    c_wood := ceil(110 * v_factor); c_stone := ceil(150 * v_factor); c_food := ceil(70 * v_factor); c_gold := ceil(10 * v_factor);
  elsif p_building_type = 'farm' then
    c_wood := ceil(100 * v_factor); c_stone := ceil(80 * v_factor); c_food := ceil(150 * v_factor); c_gold := ceil(8 * v_factor);
  else
    c_wood := ceil(140 * v_factor); c_stone := ceil(130 * v_factor); c_food := ceil(80 * v_factor); c_gold := ceil(25 * v_factor);
  end if;

  if v_settlement.wood < c_wood or v_settlement.stone < c_stone or v_settlement.food < c_food or v_settlement.gold < c_gold then
    raise exception 'Not enough resources';
  end if;

  update public.settlements
  set wood = wood - c_wood,
      stone = stone - c_stone,
      food = food - c_food,
      gold = gold - c_gold
  where id = v_settlement.id;

  update public.buildings
  set level = level + 1, updated_at = now()
  where settlement_id = v_settlement.id and building_type = p_building_type
  returning level into v_new_level;

  update public.settlements
  set
    wood_rate = case when p_building_type = 'lumber' then 14 + v_new_level * 8 else wood_rate end,
    stone_rate = case when p_building_type = 'quarry' then 12 + v_new_level * 7 else stone_rate end,
    food_rate = case when p_building_type = 'farm' then 18 + v_new_level * 10 else food_rate end,
    gold_rate = case when p_building_type = 'market' then 3 + v_new_level * 3 else gold_rate end
  where id = v_settlement.id;

  return jsonb_build_object(
    'ok', true,
    'building', p_building_type,
    'level', v_new_level,
    'cost', jsonb_build_object('wood', c_wood, 'stone', c_stone, 'food', c_food, 'gold', c_gold)
  );
end;
$$;

create or replace function public.recruit_units(
  p_infantry integer default 0,
  p_archers integer default 0,
  p_cavalry integer default 0
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_uid uuid := auth.uid();
  v_settlement public.settlements%rowtype;
  c_wood integer;
  c_stone integer;
  c_food integer;
  c_gold integer;
begin
  if v_uid is null then raise exception 'Authentication required'; end if;
  if p_infantry < 0 or p_archers < 0 or p_cavalry < 0 then raise exception 'Invalid unit count'; end if;
  if p_infantry + p_archers + p_cavalry <= 0 then raise exception 'Choose units to recruit'; end if;
  if p_infantry + p_archers + p_cavalry > 200 then raise exception 'Recruitment batch is too large'; end if;

  perform public.sync_my_state();
  select * into v_settlement from public.settlements where owner_id = v_uid for update;

  c_wood := p_infantry * 4 + p_archers * 6 + p_cavalry * 4;
  c_stone := p_infantry * 2 + p_archers * 2 + p_cavalry * 7;
  c_food := p_infantry * 6 + p_archers * 5 + p_cavalry * 12;
  c_gold := p_infantry * 1 + p_archers * 2 + p_cavalry * 4;

  if v_settlement.wood < c_wood or v_settlement.stone < c_stone or v_settlement.food < c_food or v_settlement.gold < c_gold then
    raise exception 'Not enough resources';
  end if;

  update public.settlements
  set wood = wood - c_wood,
      stone = stone - c_stone,
      food = food - c_food,
      gold = gold - c_gold
  where id = v_settlement.id;

  update public.armies
  set infantry = infantry + p_infantry,
      archers = archers + p_archers,
      cavalry = cavalry + p_cavalry,
      updated_at = now()
  where owner_id = v_uid;

  return jsonb_build_object('ok', true);
end;
$$;

create or replace function public.move_army(p_target_x integer, p_target_y integer)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_uid uuid := auth.uid();
  v_army public.armies%rowtype;
  v_now timestamptz := now();
  v_x numeric;
  v_y numeric;
  v_progress numeric;
  v_duration numeric;
  v_distance numeric;
  v_seconds numeric;
  v_target_x integer := greatest(45, least(1155, p_target_x));
  v_target_y integer := greatest(55, least(715, p_target_y));
begin
  if v_uid is null then raise exception 'Authentication required'; end if;

  select * into v_army from public.armies where owner_id = v_uid for update;
  if v_army.id is null then raise exception 'Army not found'; end if;

  if v_army.status = 'moving' and v_army.arrival_at > v_now then
    v_duration := greatest(0.001, extract(epoch from (v_army.arrival_at - v_army.departure_at)));
    v_progress := least(1, greatest(0, extract(epoch from (v_now - v_army.departure_at)) / v_duration));
    v_x := v_army.start_x + (v_army.target_x - v_army.start_x) * v_progress;
    v_y := v_army.start_y + (v_army.target_y - v_army.start_y) * v_progress;
  else
    v_x := v_army.target_x;
    v_y := v_army.target_y;
  end if;

  v_distance := sqrt(power(v_target_x - v_x, 2) + power(v_target_y - v_y, 2));
  v_seconds := greatest(5, v_distance / 12.0);

  update public.armies
  set start_x = round(v_x),
      start_y = round(v_y),
      target_x = v_target_x,
      target_y = v_target_y,
      departure_at = v_now,
      arrival_at = v_now + make_interval(secs => v_seconds),
      status = 'moving',
      updated_at = v_now
  where id = v_army.id;

  return jsonb_build_object(
    'ok', true,
    'travel_seconds', ceil(v_seconds),
    'target_x', v_target_x,
    'target_y', v_target_y
  );
end;
$$;

revoke all on function public.create_player(text) from public, anon;
revoke all on function public.sync_my_state() from public, anon;
revoke all on function public.upgrade_building(text) from public, anon;
revoke all on function public.recruit_units(integer, integer, integer) from public, anon;
revoke all on function public.move_army(integer, integer) from public, anon;

grant execute on function public.create_player(text) to authenticated;
grant execute on function public.sync_my_state() to authenticated;
grant execute on function public.upgrade_building(text) to authenticated;
grant execute on function public.recruit_units(integer, integer, integer) to authenticated;
grant execute on function public.move_army(integer, integer) to authenticated;

-- Shared world updates.
do $$
begin
  alter publication supabase_realtime add table public.players;
exception when duplicate_object then null;
end $$;
do $$
begin
  alter publication supabase_realtime add table public.settlements;
exception when duplicate_object then null;
end $$;
do $$
begin
  alter publication supabase_realtime add table public.buildings;
exception when duplicate_object then null;
end $$;
do $$
begin
  alter publication supabase_realtime add table public.armies;
exception when duplicate_object then null;
end $$;

commit;
