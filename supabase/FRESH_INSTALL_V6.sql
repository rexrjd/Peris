-- PERIS v6 fresh installation. ONLY for an EMPTY Supabase project.
-- This script refuses to run if player records already exist.
-- Existing v5 project: use UPGRADE_V5_TO_V6.sql instead.
begin;
do $$ declare occupied boolean;begin
 if to_regclass('public.players') is not null then
 execute 'select exists(select 1 from public.players)' into occupied;
 if occupied then raise exception 'A Peris campaign already exists. Use UPGRADE_V5_TO_V6.sql to preserve it.';end if;
 end if;
end $$;
-- PERIS V5 - TOTAL WAR STYLE BATTLE PROTOTYPE RESET
-- Run this WHOLE file in Supabase > SQL Editor.
-- It intentionally deletes all existing Peris PUBLIC game data.
-- It does NOT delete Supabase Auth users, so browsers that are already signed in
-- can simply choose a new ruler name after the reset.


-- Remove the old prototype world and any dependent policies/triggers/functions.
drop table if exists public.battle_formations cascade;
drop table if exists public.battles cascade;
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
drop function if exists public.create_battle(uuid) cascade;
drop function if exists public.issue_battle_move(bigint, bigint, integer, integer) cascade;
drop function if exists public.issue_battle_attack(bigint, bigint, bigint) cascade;
drop function if exists public.advance_battle(bigint) cascade;
drop function if exists public.retreat_from_battle(bigint) cascade;

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

-- Tactical battles are separate real-time instances. The strategic army counts are
-- copied into formations at battle start and written back when the battle resolves.
create table public.battles (
  id bigint generated always as identity primary key,
  attacker_owner_id uuid not null references public.players(id) on delete cascade,
  defender_owner_id uuid not null references public.players(id) on delete cascade,
  attacker_army_id bigint not null references public.armies(id) on delete cascade,
  defender_army_id bigint not null references public.armies(id) on delete cascade,
  status text not null default 'active' check (status in ('active', 'resolved')),
  winner_owner_id uuid references public.players(id) on delete set null,
  started_at timestamptz not null default now(),
  ended_at timestamptz,
  last_tick_at timestamptz not null default now(),
  result jsonb
);

create index battles_attacker_idx on public.battles(attacker_owner_id, status);
create index battles_defender_idx on public.battles(defender_owner_id, status);

create table public.battle_formations (
  id bigint generated always as identity primary key,
  battle_id bigint not null references public.battles(id) on delete cascade,
  owner_id uuid not null references public.players(id) on delete cascade,
  side text not null check (side in ('attacker', 'defender')),
  unit_type text not null check (unit_type in ('infantry', 'archers', 'cavalry')),
  initial_soldiers integer not null check (initial_soldiers >= 0),
  soldiers integer not null check (soldiers >= 0),
  kills integer not null default 0 check (kills >= 0),
  morale numeric(6,2) not null default 100 check (morale >= 0 and morale <= 100),
  facing numeric(7,2) not null default 0,
  charge_ready boolean not null default false,
  x numeric(9,2) not null,
  y numeric(9,2) not null,
  target_x numeric(9,2) not null,
  target_y numeric(9,2) not null,
  target_formation_id bigint references public.battle_formations(id) on delete set null,
  status text not null default 'idle' check (status in ('idle', 'moving', 'engaged', 'routed')),
  damage_pool numeric(12,4) not null default 0,
  updated_at timestamptz not null default now(),
  unique (battle_id, owner_id, unit_type)
);

create index battle_formations_battle_idx on public.battle_formations(battle_id);

alter table public.players enable row level security;
alter table public.spawn_points enable row level security;
alter table public.settlements enable row level security;
alter table public.buildings enable row level security;
alter table public.armies enable row level security;
alter table public.battles enable row level security;
alter table public.battle_formations enable row level security;

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
create policy "participants can read battles" on public.battles
for select to authenticated
using (auth.uid() = attacker_owner_id or auth.uid() = defender_owner_id);
create policy "participants can read battle formations" on public.battle_formations
for select to authenticated
using (exists (
  select 1 from public.battles b
  where b.id = battle_id
    and (auth.uid() = b.attacker_owner_id or auth.uid() = b.defender_owner_id)
));

grant select on public.players, public.settlements, public.buildings, public.armies, public.spawn_points, public.battles, public.battle_formations to authenticated;

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


-- Create an immediate tactical battle against another ruler. For this prototype the
-- challenge can be started from anywhere on the strategic map. Strategic interception
-- and sieges can be layered on top later without changing the tactical battle model.
create or replace function public.create_battle(p_defender_owner uuid)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_uid uuid := auth.uid();
  v_attacker public.armies%rowtype;
  v_defender public.armies%rowtype;
  v_battle_id bigint;
begin
  if v_uid is null then raise exception 'Authentication required'; end if;
  if p_defender_owner is null or p_defender_owner = v_uid then raise exception 'Choose another ruler'; end if;

  select * into v_attacker from public.armies where owner_id = v_uid for update;
  select * into v_defender from public.armies where owner_id = p_defender_owner for update;
  if v_attacker.id is null or v_defender.id is null then raise exception 'Army not found'; end if;
  if v_attacker.infantry + v_attacker.archers + v_attacker.cavalry <= 0 then raise exception 'Your army has no soldiers'; end if;
  if v_defender.infantry + v_defender.archers + v_defender.cavalry <= 0 then raise exception 'Enemy army has no soldiers'; end if;

  if exists (
    select 1 from public.battles b
    where b.status = 'active'
      and (b.attacker_army_id in (v_attacker.id, v_defender.id)
        or b.defender_army_id in (v_attacker.id, v_defender.id))
  ) then
    raise exception 'One of these armies is already in battle';
  end if;

  insert into public.battles (
    attacker_owner_id, defender_owner_id, attacker_army_id, defender_army_id
  ) values (
    v_uid, p_defender_owner, v_attacker.id, v_defender.id
  ) returning id into v_battle_id;

  insert into public.battle_formations (
    battle_id, owner_id, side, unit_type, initial_soldiers, soldiers,
    facing, charge_ready, x, y, target_x, target_y
  ) values
    (v_battle_id, v_uid, 'attacker', 'infantry', v_attacker.infantry, v_attacker.infantry, 0, false, 230, 350, 230, 350),
    (v_battle_id, v_uid, 'attacker', 'archers', v_attacker.archers, v_attacker.archers, 0, false, 170, 215, 170, 215),
    (v_battle_id, v_uid, 'attacker', 'cavalry', v_attacker.cavalry, v_attacker.cavalry, 0, false, 175, 500, 175, 500),
    (v_battle_id, p_defender_owner, 'defender', 'infantry', v_defender.infantry, v_defender.infantry, 180, false, 970, 350, 970, 350),
    (v_battle_id, p_defender_owner, 'defender', 'archers', v_defender.archers, v_defender.archers, 180, false, 1030, 215, 1030, 215),
    (v_battle_id, p_defender_owner, 'defender', 'cavalry', v_defender.cavalry, v_defender.cavalry, 180, false, 1025, 500, 1025, 500);

  return jsonb_build_object('ok', true, 'battle_id', v_battle_id);
end;
$$;

create or replace function public.issue_battle_move(
  p_battle_id bigint,
  p_formation_id bigint,
  p_target_x integer,
  p_target_y integer
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_uid uuid := auth.uid();
  v_battle public.battles%rowtype;
  v_formation public.battle_formations%rowtype;
  v_x integer := greatest(55, least(1145, p_target_x));
  v_y integer := greatest(60, least(640, p_target_y));
begin
  if v_uid is null then raise exception 'Authentication required'; end if;
  select * into v_battle from public.battles where id = p_battle_id and status = 'active';
  if v_battle.id is null then raise exception 'Battle is no longer active'; end if;
  if v_uid not in (v_battle.attacker_owner_id, v_battle.defender_owner_id) then raise exception 'Not your battle'; end if;

  select * into v_formation from public.battle_formations where id = p_formation_id and battle_id = p_battle_id for update;
  if v_formation.id is null or v_formation.owner_id <> v_uid then raise exception 'Not your formation'; end if;
  if v_formation.soldiers <= 0 or v_formation.status = 'routed' then raise exception 'Formation cannot receive orders'; end if;

  update public.battle_formations
  set target_x = v_x,
      target_y = v_y,
      target_formation_id = null,
      status = 'moving',
      charge_ready = false,
      facing = degrees(atan2(v_y - y, v_x - x)),
      updated_at = now()
  where id = p_formation_id;

  return jsonb_build_object('ok', true);
end;
$$;

create or replace function public.issue_battle_attack(
  p_battle_id bigint,
  p_formation_id bigint,
  p_target_formation_id bigint
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_uid uuid := auth.uid();
  v_battle public.battles%rowtype;
  v_formation public.battle_formations%rowtype;
  v_target public.battle_formations%rowtype;
begin
  if v_uid is null then raise exception 'Authentication required'; end if;
  select * into v_battle from public.battles where id = p_battle_id and status = 'active';
  if v_battle.id is null then raise exception 'Battle is no longer active'; end if;
  if v_uid not in (v_battle.attacker_owner_id, v_battle.defender_owner_id) then raise exception 'Not your battle'; end if;

  select * into v_formation from public.battle_formations where id = p_formation_id and battle_id = p_battle_id for update;
  select * into v_target from public.battle_formations where id = p_target_formation_id and battle_id = p_battle_id;
  if v_formation.id is null or v_formation.owner_id <> v_uid then raise exception 'Not your formation'; end if;
  if v_target.id is null or v_target.owner_id = v_uid then raise exception 'Choose an enemy formation'; end if;
  if v_formation.soldiers <= 0 or v_formation.status = 'routed' then raise exception 'Formation cannot receive orders'; end if;
  if v_target.soldiers <= 0 or v_target.status = 'routed' then raise exception 'Target formation is already broken'; end if;

  update public.battle_formations
  set target_formation_id = p_target_formation_id,
      target_x = v_target.x,
      target_y = v_target.y,
      status = 'moving',
      facing = degrees(atan2(v_target.y - y, v_target.x - x)),
      charge_ready = sqrt(power(v_target.x - x, 2) + power(v_target.y - y, 2)) >=
        case when unit_type = 'cavalry' then 145 when unit_type = 'infantry' then 95 else 99999 end,
      updated_at = now()
  where id = p_formation_id;

  return jsonb_build_object('ok', true);
end;
$$;

-- Advance the authoritative tactical simulation. Either participant may call this.
-- The battle row is locked so two browsers cannot double-advance the same time slice.
create or replace function public.advance_battle(p_battle_id bigint)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_uid uuid := auth.uid();
  v_battle public.battles%rowtype;
  v_f public.battle_formations%rowtype;
  v_t public.battle_formations%rowtype;
  v_now timestamptz := now();
  v_dt numeric;
  v_dx numeric;
  v_dy numeric;
  v_dist numeric;
  v_step numeric;
  v_speed numeric;
  v_range numeric;
  v_rate numeric;
  v_matchup numeric;
  v_flank numeric;
  v_charge numeric;
  v_dot numeric;
  v_damage numeric;
  v_casualties integer;
  v_morale_loss numeric;
  v_attacker_alive integer;
  v_defender_alive integer;
  v_winner uuid;
  v_att_inf integer; v_att_arc integer; v_att_cav integer;
  v_def_inf integer; v_def_arc integer; v_def_cav integer;
begin
  if v_uid is null then raise exception 'Authentication required'; end if;

  select * into v_battle from public.battles where id = p_battle_id for update;
  if v_battle.id is null then raise exception 'Battle not found'; end if;
  if v_uid not in (v_battle.attacker_owner_id, v_battle.defender_owner_id) then raise exception 'Not your battle'; end if;
  if v_battle.status <> 'active' then return jsonb_build_object('ok', true, 'resolved', true); end if;

  v_dt := extract(epoch from (v_now - v_battle.last_tick_at));
  if v_dt < 0.65 then return jsonb_build_object('ok', true, 'advanced', false); end if;
  v_dt := least(v_dt, 1.5);
  update public.battles set last_tick_at = v_now where id = p_battle_id;

  -- Movement / pursuit pass.
  for v_f in
    select * from public.battle_formations
    where battle_id = p_battle_id and soldiers > 0 and status <> 'routed'
    order by id
    for update
  loop
    v_speed := case v_f.unit_type when 'cavalry' then 86 when 'infantry' then 46 else 38 end;
    v_range := case v_f.unit_type when 'archers' then 215 when 'cavalry' then 58 else 48 end;

    if v_f.target_formation_id is not null then
      select * into v_t from public.battle_formations
      where id = v_f.target_formation_id and battle_id = p_battle_id;

      if v_t.id is null or v_t.soldiers <= 0 or v_t.status = 'routed' then
        update public.battle_formations
        set target_formation_id = null, target_x = x, target_y = y, status = 'idle', updated_at = v_now
        where id = v_f.id;
        continue;
      end if;

      v_dx := v_t.x - v_f.x;
      v_dy := v_t.y - v_f.y;
      v_dist := sqrt(v_dx * v_dx + v_dy * v_dy);

      if v_dist > v_range then
        v_step := least(v_speed * v_dt, greatest(0, v_dist - v_range * 0.82));
        if v_dist > 0 then
          update public.battle_formations
          set x = x + (v_dx / v_dist) * v_step,
              y = y + (v_dy / v_dist) * v_step,
              target_x = v_t.x,
              target_y = v_t.y,
              facing = degrees(atan2(v_dy, v_dx)),
              status = 'moving',
              updated_at = v_now
          where id = v_f.id;
        end if;
      else
        update public.battle_formations set status = 'engaged', updated_at = v_now where id = v_f.id;
      end if;
    else
      v_dx := v_f.target_x - v_f.x;
      v_dy := v_f.target_y - v_f.y;
      v_dist := sqrt(v_dx * v_dx + v_dy * v_dy);
      if v_dist > 5 then
        v_step := least(v_speed * v_dt, v_dist);
        update public.battle_formations
        set x = x + (v_dx / nullif(v_dist, 0)) * v_step,
            y = y + (v_dy / nullif(v_dist, 0)) * v_step,
            facing = degrees(atan2(v_dy, v_dx)),
            status = 'moving',
            updated_at = v_now
        where id = v_f.id;
      else
        update public.battle_formations
        set x = target_x, y = target_y, status = 'idle', updated_at = v_now
        where id = v_f.id;
      end if;
    end if;
  end loop;

  -- Combat pass. Damage accumulates fractionally so small formations do not magically
  -- inflict one casualty every tick. Morale can break a formation before it is destroyed.
  for v_f in
    select * from public.battle_formations
    where battle_id = p_battle_id
      and soldiers > 0
      and status <> 'routed'
      and target_formation_id is not null
    order by id
    for update
  loop
    select * into v_t from public.battle_formations
    where id = v_f.target_formation_id and battle_id = p_battle_id
    for update;
    if v_t.id is null or v_t.soldiers <= 0 or v_t.status = 'routed' then continue; end if;

    v_range := case v_f.unit_type when 'archers' then 215 when 'cavalry' then 58 else 48 end;
    v_dx := v_t.x - v_f.x;
    v_dy := v_t.y - v_f.y;
    v_dist := sqrt(v_dx * v_dx + v_dy * v_dy);
    if v_dist > v_range then continue; end if;

    v_rate := case v_f.unit_type when 'infantry' then 0.012 when 'archers' then 0.0085 else 0.021 end;
    v_matchup := case
      when v_f.unit_type = 'infantry' and v_t.unit_type = 'cavalry' then 0.78
      when v_f.unit_type = 'infantry' and v_t.unit_type = 'archers' then 1.18
      when v_f.unit_type = 'archers' and v_t.unit_type = 'cavalry' then 0.66
      when v_f.unit_type = 'archers' and v_t.unit_type = 'infantry' then 0.92
      when v_f.unit_type = 'cavalry' and v_t.unit_type = 'archers' then 1.58
      when v_f.unit_type = 'cavalry' and v_t.unit_type = 'infantry' then 1.22
      else 1.0
    end;

    -- Rome-style facing matters: rear and flank attacks hit harder and shock morale.
    if v_dist > 0 then
      v_dot := cos(radians(v_t.facing)) * ((v_f.x - v_t.x) / v_dist)
             + sin(radians(v_t.facing)) * ((v_f.y - v_t.y) / v_dist);
    else
      v_dot := 0;
    end if;
    v_flank := case when v_dot < -0.45 then 1.55 when abs(v_dot) < 0.35 then 1.24 else 1.0 end;
    v_charge := case
      when v_f.charge_ready and v_f.unit_type = 'cavalry' then 2.15
      when v_f.charge_ready and v_f.unit_type = 'infantry' then 1.22
      else 1.0
    end;

    v_damage := v_f.damage_pool + v_f.soldiers * v_rate * v_matchup * v_flank * v_charge * v_dt;
    v_casualties := least(v_t.soldiers, floor(v_damage)::integer);

    update public.battle_formations
    set damage_pool = v_damage - v_casualties,
        kills = kills + v_casualties,
        charge_ready = false,
        status = 'engaged',
        updated_at = v_now
    where id = v_f.id;

    if v_casualties > 0 then
      v_morale_loss := (v_casualties::numeric / greatest(1, v_t.initial_soldiers)) * 72
        + case when v_f.unit_type = 'cavalry' then 2.5 else 0 end
        + case when v_flank >= 1.5 then 10 when v_flank > 1 then 5 else 0 end
        + case when v_charge > 2 then 12 when v_charge > 1 then 4 else 0 end;

      update public.battle_formations
      set soldiers = greatest(0, soldiers - v_casualties),
          morale = greatest(0, morale - v_morale_loss),
          updated_at = v_now
      where id = v_t.id;

      select * into v_t from public.battle_formations where id = v_t.id;

      -- A melee formation that is charged will fight back even if its player has not
      -- manually issued a counter-order yet. This avoids passive units being helpless.
      if v_f.unit_type <> 'archers' and v_t.soldiers > 0 and v_t.status <> 'routed' and v_t.target_formation_id is null then
        update public.battle_formations
        set target_formation_id = v_f.id, target_x = v_f.x, target_y = v_f.y,
            facing = degrees(atan2(v_f.y - y, v_f.x - x)), status = 'engaged', charge_ready = false, updated_at = v_now
        where id = v_t.id;
      end if;

      if v_t.soldiers <= 0 or v_t.morale < 18 then
        update public.battle_formations
        set status = 'routed',
            target_formation_id = null,
            target_x = case when side = 'attacker' then 35 else 1165 end,
            target_y = y,
            updated_at = v_now
        where id = v_t.id;
      end if;
    end if;
  end loop;

  select count(*) into v_attacker_alive from public.battle_formations
    where battle_id = p_battle_id and side = 'attacker' and soldiers > 0 and status <> 'routed';
  select count(*) into v_defender_alive from public.battle_formations
    where battle_id = p_battle_id and side = 'defender' and soldiers > 0 and status <> 'routed';

  if v_attacker_alive = 0 or v_defender_alive = 0 then
    v_winner := case
      when v_attacker_alive > 0 then v_battle.attacker_owner_id
      when v_defender_alive > 0 then v_battle.defender_owner_id
      else null
    end;

    select
      coalesce(max(soldiers) filter (where unit_type = 'infantry'), 0),
      coalesce(max(soldiers) filter (where unit_type = 'archers'), 0),
      coalesce(max(soldiers) filter (where unit_type = 'cavalry'), 0)
    into v_att_inf, v_att_arc, v_att_cav
    from public.battle_formations
    where battle_id = p_battle_id and side = 'attacker';

    select
      coalesce(max(soldiers) filter (where unit_type = 'infantry'), 0),
      coalesce(max(soldiers) filter (where unit_type = 'archers'), 0),
      coalesce(max(soldiers) filter (where unit_type = 'cavalry'), 0)
    into v_def_inf, v_def_arc, v_def_cav
    from public.battle_formations
    where battle_id = p_battle_id and side = 'defender';

    update public.armies
    set infantry = v_att_inf, archers = v_att_arc, cavalry = v_att_cav, updated_at = v_now
    where id = v_battle.attacker_army_id;
    update public.armies
    set infantry = v_def_inf, archers = v_def_arc, cavalry = v_def_cav, updated_at = v_now
    where id = v_battle.defender_army_id;

    update public.battles
    set status = 'resolved', winner_owner_id = v_winner, ended_at = v_now,
        result = jsonb_build_object(
          'attacker', jsonb_build_object('infantry', v_att_inf, 'archers', v_att_arc, 'cavalry', v_att_cav),
          'defender', jsonb_build_object('infantry', v_def_inf, 'archers', v_def_arc, 'cavalry', v_def_cav)
        )
    where id = p_battle_id;

    return jsonb_build_object('ok', true, 'resolved', true, 'winner_owner_id', v_winner);
  end if;

  return jsonb_build_object('ok', true, 'advanced', true);
end;
$$;

create or replace function public.retreat_from_battle(p_battle_id bigint)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_uid uuid := auth.uid();
  v_battle public.battles%rowtype;
  v_winner uuid;
  v_now timestamptz := now();
  v_att_inf integer; v_att_arc integer; v_att_cav integer;
  v_def_inf integer; v_def_arc integer; v_def_cav integer;
begin
  if v_uid is null then raise exception 'Authentication required'; end if;
  select * into v_battle from public.battles where id = p_battle_id for update;
  if v_battle.id is null or v_battle.status <> 'active' then raise exception 'Battle is not active'; end if;
  if v_uid not in (v_battle.attacker_owner_id, v_battle.defender_owner_id) then raise exception 'Not your battle'; end if;

  v_winner := case when v_uid = v_battle.attacker_owner_id then v_battle.defender_owner_id else v_battle.attacker_owner_id end;
  update public.battle_formations
  set status = 'routed', target_formation_id = null, morale = least(morale, 10), updated_at = v_now
  where battle_id = p_battle_id and owner_id = v_uid;

  select
    coalesce(max(soldiers) filter (where unit_type = 'infantry'), 0),
    coalesce(max(soldiers) filter (where unit_type = 'archers'), 0),
    coalesce(max(soldiers) filter (where unit_type = 'cavalry'), 0)
  into v_att_inf, v_att_arc, v_att_cav
  from public.battle_formations where battle_id = p_battle_id and side = 'attacker';
  select
    coalesce(max(soldiers) filter (where unit_type = 'infantry'), 0),
    coalesce(max(soldiers) filter (where unit_type = 'archers'), 0),
    coalesce(max(soldiers) filter (where unit_type = 'cavalry'), 0)
  into v_def_inf, v_def_arc, v_def_cav
  from public.battle_formations where battle_id = p_battle_id and side = 'defender';

  update public.armies set infantry = v_att_inf, archers = v_att_arc, cavalry = v_att_cav, updated_at = v_now
  where id = v_battle.attacker_army_id;
  update public.armies set infantry = v_def_inf, archers = v_def_arc, cavalry = v_def_cav, updated_at = v_now
  where id = v_battle.defender_army_id;

  update public.battles
  set status = 'resolved', winner_owner_id = v_winner, ended_at = v_now,
      result = jsonb_build_object(
        'retreated_owner_id', v_uid,
        'attacker', jsonb_build_object('infantry', v_att_inf, 'archers', v_att_arc, 'cavalry', v_att_cav),
        'defender', jsonb_build_object('infantry', v_def_inf, 'archers', v_def_arc, 'cavalry', v_def_cav)
      )
  where id = p_battle_id;

  return jsonb_build_object('ok', true, 'winner_owner_id', v_winner);
end;
$$;

revoke all on function public.create_player(text) from public, anon;
revoke all on function public.sync_my_state() from public, anon;
revoke all on function public.upgrade_building(text) from public, anon;
revoke all on function public.recruit_units(integer, integer, integer) from public, anon;
revoke all on function public.move_army(integer, integer) from public, anon;
revoke all on function public.create_battle(uuid) from public, anon;
revoke all on function public.issue_battle_move(bigint, bigint, integer, integer) from public, anon;
revoke all on function public.issue_battle_attack(bigint, bigint, bigint) from public, anon;
revoke all on function public.advance_battle(bigint) from public, anon;
revoke all on function public.retreat_from_battle(bigint) from public, anon;

grant execute on function public.create_player(text) to authenticated;
grant execute on function public.sync_my_state() to authenticated;
grant execute on function public.upgrade_building(text) to authenticated;
grant execute on function public.recruit_units(integer, integer, integer) to authenticated;
grant execute on function public.move_army(integer, integer) to authenticated;
grant execute on function public.create_battle(uuid) to authenticated;
grant execute on function public.issue_battle_move(bigint, bigint, integer, integer) to authenticated;
grant execute on function public.issue_battle_attack(bigint, bigint, bigint) to authenticated;
grant execute on function public.advance_battle(bigint) to authenticated;
grant execute on function public.retreat_from_battle(bigint) to authenticated;

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
do $$
begin
  alter publication supabase_realtime add table public.battles;
exception when duplicate_object then null;
end $$;
do $$
begin
  alter publication supabase_realtime add table public.battle_formations;
exception when duplicate_object then null;
end $$;


-- PERIS v6 · Empire prototype. Run this entire file in Supabase SQL Editor.
-- Requires the v5 schema. Preserves players, settlements, resources and armies.
-- Safe to run again. No Auth users or campaign data are deleted.

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
create or replace function public.peris_settle(p_owner uuid,p_until timestamptz default now()) returns void
language plpgsql security definer set search_path='' as $$
declare s public.settlements%rowtype;o public.peris_orders%rowtype;minutes numeric;l integer;at_time timestamptz;
begin
 perform 1 from public.players where id=p_owner for update;
 select * into s from public.settlements where owner_id=p_owner for update;
 if s.id is null then return;end if;
 for o in select * from public.peris_orders where owner_id=p_owner and finish_at<=p_until order by finish_at,id for update loop
 at_time:=greatest(s.resources_updated_at,o.finish_at);minutes:=greatest(0,extract(epoch from(at_time-s.resources_updated_at)))/60;
 s.wood:=least(s.capacity,s.wood+s.wood_rate*minutes);s.stone:=least(s.capacity,s.stone+s.stone_rate*minutes);
 s.food:=least(s.capacity,s.food+s.food_rate*minutes);s.gold:=least(s.capacity,s.gold+s.gold_rate*minutes);
 s.resources_updated_at:=at_time;
 if o.kind='upgrade' then
 update public.buildings set level=least(20,level+1),updated_at=o.finish_at where settlement_id=s.id and building_type=o.item returning level into l;
 update public.players set upgrades=upgrades+1 where id=p_owner;
 if o.item='lumber' then s.wood_rate:=14+l*8;elsif o.item='quarry' then s.stone_rate:=12+l*7;
 elsif o.item='farm' then s.food_rate:=18+l*10;elsif o.item='market' then s.gold_rate:=3+l*3;
 elsif o.item='storehouse' then s.capacity:=5000+l*2500;end if;
 else
 update public.armies set infantry=infantry+case when o.item='infantry' then o.quantity else 0 end,
 archers=archers+case when o.item='archers' then o.quantity else 0 end,cavalry=cavalry+case when o.item='cavalry' then o.quantity else 0 end,
 updated_at=o.finish_at where owner_id=p_owner;
 update public.players set recruits=recruits+o.quantity where id=p_owner;
 end if;
 delete from public.peris_orders where id=o.id;
 end loop;
 minutes:=greatest(0,extract(epoch from(p_until-s.resources_updated_at)))/60;
 update public.settlements set wood=least(s.capacity,s.wood+s.wood_rate*minutes),stone=least(s.capacity,s.stone+s.stone_rate*minutes),
 food=least(s.capacity,s.food+s.food_rate*minutes),gold=least(s.capacity,s.gold+s.gold_rate*minutes),
 wood_rate=s.wood_rate,stone_rate=s.stone_rate,food_rate=s.food_rate,gold_rate=s.gold_rate,capacity=s.capacity,
 resources_updated_at=greatest(s.resources_updated_at,p_until) where id=s.id;
 update public.armies set status='idle',start_x=target_x,start_y=target_y,updated_at=p_until
 where owner_id=p_owner and status='moving' and arrival_at<=p_until;
end $$;

create or replace function public.peris_add_formations(p_battle bigint,p_owner uuid,p_side text,p_inf integer,p_arc integer,p_cav integer,p_morale numeric)
returns void language plpgsql security definer set search_path='' as $$
declare typ text;n integer;total integer;i integer;amount integer;px integer;py integer;cap integer;
begin
 foreach typ in array array['infantry','archers','cavalry'] loop
 total:=case typ when 'infantry' then p_inf when 'archers' then p_arc else p_cav end;
 cap:=case typ when 'infantry' then 60 when 'archers' then 40 else 24 end;
 n:=least(6,ceil(total::numeric/cap)::integer);if n<=0 then continue;end if;
 for i in 0..n-1 loop
 amount:=total/n+case when i<total%n then 1 else 0 end;
 px:=case when p_side='attacker' then case when typ='infantry' then 285 else 175 end else case when typ='infantry' then 915 else 1025 end end;
 py:=case when typ='cavalry' then case when i%2=0 then 110+i*15 else 590-i*15 end else round(350+(i-(n-1)/2.0)*105+case when typ='archers' then 15 else 0 end) end;
 insert into public.battle_formations(battle_id,owner_id,side,unit_type,label,initial_soldiers,soldiers,morale,x,y,target_x,target_y,facing,columns)
 values(p_battle,p_owner,p_side,typ,(case typ when 'infantry' then 'Legionaries' when 'archers' then 'Sagittarii' else 'Equites' end)||' '||(i+1),amount,amount,least(100,p_morale),px,py,px,py,case when p_side='attacker' then 0 else 180 end,case when typ='cavalry' then 6 else 10 end);
 end loop;
 end loop;
end $$;

create or replace function public.peris_start_raid(p_owner uuid,p_camp integer) returns bigint
language plpgsql security definer set search_path='' as $$
declare a public.armies%rowtype;c public.peris_camps%rowtype;bid bigint;mor numeric;
begin
 select * into a from public.armies where owner_id=p_owner for update;
 select * into c from public.peris_camps where id=p_camp;
 if c.id is null or a.id is null then raise exception 'Army or camp not found';end if;
 if a.infantry+a.archers+a.cavalry=0 then raise exception 'Your army has no soldiers';end if;
 if exists(select 1 from public.battles where status='active' and (attacker_owner_id=p_owner or defender_owner_id=p_owner)) then raise exception 'Finish the current battle first';end if;
 if exists(select 1 from public.peris_progress where owner_id=p_owner and camp_id=p_camp and available_at>now()) then raise exception 'The camp is still regrouping';end if;
 insert into public.battles(attacker_owner_id,defender_owner_id,attacker_army_id,defender_army_id,mode,phase,camp_id,terrain,difficulty,enemy_name,defender_ready)
 values(p_owner,null,a.id,null,'pve','deployment',c.id,c.terrain,case when c.tier>=4 then 'hard' when c.tier=1 then 'easy' else 'normal' end,c.name,true) returning id into bid;
 select 90+2*level into mor from public.buildings where settlement_id=a.home_settlement_id and building_type='wall';
 perform public.peris_add_formations(bid,p_owner,'attacker',a.infantry,a.archers,a.cavalry,coalesce(mor,92));
 perform public.peris_add_formations(bid,null,'defender',c.infantry,c.archers,c.cavalry,case when c.tier>=4 then 100 when c.tier=1 then 78 else 90 end);
 update public.armies set raid_target_id=null where id=a.id;
 return bid;
end $$;

create or replace function public.sync_my_state() returns jsonb language plpgsql security definer set search_path='' as $$
declare u uuid:=auth.uid();a public.armies%rowtype;
begin
 if u is null then raise exception 'Authentication required';end if;
 perform public.peris_settle(u);
 select * into a from public.armies where owner_id=u for update;
 if a.raid_target_id is not null and a.status='idle' then
 if not exists(select 1 from public.battles where status='active' and (attacker_owner_id=u or defender_owner_id=u)) then perform public.peris_start_raid(u,a.raid_target_id);end if;
 end if;
 return jsonb_build_object('ok',true);
end $$;

create or replace function public.peris_queue_upgrade(p_type text) returns jsonb language plpgsql security definer set search_path='' as $$
declare u uuid:=auth.uid();s public.settlements%rowtype;l integer;factor numeric;cw numeric;cs numeric;cf numeric;cg numeric;
begin
 if u is null then raise exception 'Authentication required';end if;
 perform public.peris_settle(u);
 if exists(select 1 from public.battles where status='active' and (attacker_owner_id=u or defender_owner_id=u)) then raise exception 'Finish the current battle first';end if;
 select * into s from public.settlements where owner_id=u for update;
 select level into l from public.buildings where settlement_id=s.id and building_type=p_type;
 if l is null then raise exception 'Building not found';end if;
 if l>=20 then raise exception 'Maximum level reached';end if;
 if exists(select 1 from public.peris_orders where owner_id=u and kind='upgrade') then raise exception 'Your builders are already working';end if;
 factor:=power(1.55::numeric,l-1);
 cw:=ceil((case p_type when 'lumber' then 150 when 'quarry' then 110 when 'farm' then 100 when 'market' then 140 when 'barracks' then 180 when 'stables' then 200 when 'wall' then 100 else 200 end)*factor);
 cs:=ceil((case p_type when 'lumber' then 90 when 'quarry' then 150 when 'farm' then 80 when 'market' then 130 when 'barracks' then 160 when 'stables' then 120 when 'wall' then 240 else 150 end)*factor);
 cf:=ceil((case p_type when 'lumber' then 70 when 'quarry' then 70 when 'farm' then 150 when 'market' then 80 when 'barracks' then 100 when 'stables' then 180 when 'wall' then 80 else 90 end)*factor);
 cg:=ceil((case p_type when 'lumber' then 10 when 'quarry' then 10 when 'farm' then 8 when 'market' then 25 when 'barracks' then 30 when 'stables' then 45 when 'wall' then 25 else 20 end)*factor);
 if s.wood<cw or s.stone<cs or s.food<cf or s.gold<cg then raise exception 'Your stores cannot cover this cost';end if;
 update public.settlements set wood=wood-cw,stone=stone-cs,food=food-cf,gold=gold-cg where id=s.id;
 insert into public.peris_orders(owner_id,kind,item,quantity,started_at,finish_at)values(u,'upgrade',p_type,1,now(),now()+make_interval(secs=>15+l*10));
 return jsonb_build_object('ok',true);
end $$;

create or replace function public.peris_queue_recruit(p_type text,p_quantity integer) returns jsonb language plpgsql security definer set search_path='' as $$
declare u uuid:=auth.uid();s public.settlements%rowtype;a public.armies%rowtype;l integer;at_time timestamptz;duration numeric;cw integer;cs integer;cf integer;cg integer;queued integer;
begin
 if u is null then raise exception 'Authentication required';end if;
 if p_type is null or p_type not in ('infantry','archers','cavalry') or p_quantity is null or p_quantity<1 or p_quantity>200 then raise exception 'Choose between 1 and 200 soldiers';end if;
 perform public.peris_settle(u);
 if exists(select 1 from public.battles where status='active' and (attacker_owner_id=u or defender_owner_id=u)) then raise exception 'Finish the current battle first';end if;
 select * into s from public.settlements where owner_id=u for update;
 select * into a from public.armies where owner_id=u for update;
 if s.id is null or a.id is null then raise exception 'Realm not found';end if;
 if a.status='moving' or sqrt(power(a.target_x-s.x-40,2)+power(a.target_y-s.y-30,2))>90 then raise exception 'Bring your army home to recruit';end if;
 if (select count(*) from public.peris_orders where owner_id=u and kind='recruit')>=3 then raise exception 'Training queue is full';end if;
 select coalesce(sum(quantity),0) into queued from public.peris_orders where owner_id=u and kind='recruit';
 if a.infantry+a.archers+a.cavalry+queued+p_quantity>1000 then raise exception 'Army capacity is 1,000 soldiers';end if;
 cw:=p_quantity*case when p_type='archers' then 6 else 4 end;cs:=p_quantity*case when p_type='cavalry' then 7 else 2 end;
 cf:=p_quantity*case p_type when 'infantry' then 6 when 'archers' then 5 else 12 end;cg:=p_quantity*case p_type when 'infantry' then 1 when 'archers' then 2 else 4 end;
 if s.wood<cw or s.stone<cs or s.food<cf or s.gold<cg then raise exception 'Your stores cannot cover this cost';end if;
 select level into l from public.buildings where settlement_id=s.id and building_type=case when p_type='cavalry' then 'stables' else 'barracks' end;
 select greatest(now(),coalesce(max(finish_at),now())) into at_time from public.peris_orders where owner_id=u and kind='recruit';
 duration:=greatest(5,ceil(p_quantity*case when p_type='cavalry' then 5 else 2 end/(1+(coalesce(l,1)-1)*0.18)));
 update public.settlements set wood=wood-cw,stone=stone-cs,food=food-cf,gold=gold-cg where id=s.id;
 insert into public.peris_orders(owner_id,kind,item,quantity,started_at,finish_at)values(u,'recruit',p_type,p_quantity,at_time,at_time+make_interval(secs=>duration::double precision));
 return jsonb_build_object('ok',true);
end $$;

create or replace function public.move_army(p_target_x integer,p_target_y integer) returns jsonb language plpgsql security definer set search_path='' as $$
declare u uuid:=auth.uid();a public.armies%rowtype;t numeric;x numeric;y numeric;tx integer:=greatest(45,least(1155,p_target_x));ty integer:=greatest(55,least(715,p_target_y));seconds numeric;
begin
 if u is null then raise exception 'Authentication required';end if;
 if p_target_x is null or p_target_y is null then raise exception 'Choose a destination';end if;
 perform public.peris_settle(u);
 if exists(select 1 from public.battles where status='active' and (attacker_owner_id=u or defender_owner_id=u)) then raise exception 'Finish the current battle first';end if;
 if exists(select 1 from public.peris_orders where owner_id=u and kind='recruit') then raise exception 'Let training finish before marching';end if;
 select * into a from public.armies where owner_id=u for update;if a.id is null then raise exception 'Army not found';end if;
 t:=case when a.status='moving' then greatest(0,least(1,extract(epoch from(now()-a.departure_at))/greatest(0.001,extract(epoch from(a.arrival_at-a.departure_at))))) else 1 end;
 x:=a.start_x+(a.target_x-a.start_x)*t;y:=a.start_y+(a.target_y-a.start_y)*t;seconds:=greatest(2,sqrt(power(tx-x,2)+power(ty-y,2))/22);
 update public.armies set start_x=round(x),start_y=round(y),target_x=tx,target_y=ty,departure_at=now(),arrival_at=now()+make_interval(secs=>seconds::double precision),status='moving',raid_target_id=null,updated_at=now() where id=a.id;
 return jsonb_build_object('ok',true);
end $$;

create or replace function public.peris_raid(p_camp_id integer) returns jsonb language plpgsql security definer set search_path='' as $$
declare u uuid:=auth.uid();c public.peris_camps%rowtype;a public.armies%rowtype;
begin
 if u is null then raise exception 'Authentication required';end if;
 select * into c from public.peris_camps where id=p_camp_id;if c.id is null then raise exception 'Camp not found';end if;
 perform public.peris_settle(u);
 select * into a from public.armies where owner_id=u for update;if a.id is null or a.infantry+a.archers+a.cavalry=0 then raise exception 'Recruit soldiers before starting a raid';end if;
 if exists(select 1 from public.peris_progress where owner_id=u and camp_id=p_camp_id and available_at>now()) then raise exception 'The camp is still regrouping';end if;
 perform public.move_army(c.x,c.y);update public.armies set raid_target_id=c.id where owner_id=u;
 return jsonb_build_object('ok',true);
end $$;

create or replace function public.peris_ready(p_battle_id bigint) returns jsonb language plpgsql security definer set search_path='' as $$
declare u uuid:=auth.uid();b public.battles%rowtype;
begin
 select * into b from public.battles where id=p_battle_id for update;
 if u is null or b.id is null or (u is distinct from b.attacker_owner_id and u is distinct from b.defender_owner_id) then raise exception 'Not your battle';end if;
 if b.status<>'active' or b.phase<>'deployment' then raise exception 'Battle has already started';end if;
 update public.battles set attacker_ready=attacker_ready or u=attacker_owner_id,defender_ready=defender_ready or u=defender_owner_id where id=b.id returning * into b;
 if b.attacker_ready and b.defender_ready then update public.battles set phase='combat',started_at=now(),last_tick_at=now() where id=b.id;end if;
 return jsonb_build_object('ok',true);
end $$;

create or replace function public.peris_order(p_battle_id bigint,p_order jsonb) returns jsonb language plpgsql security definer set search_path='' as $$
declare u uuid:=auth.uid();b public.battles%rowtype;f public.battle_formations%rowtype;t public.battle_formations%rowtype;k text:=p_order->>'kind';px numeric;py numeric;n integer;i integer:=0;col integer;face numeric;
begin
 select * into b from public.battles where id=p_battle_id for update;
 if u is null or b.id is null or (u is distinct from b.attacker_owner_id and u is distinct from b.defender_owner_id) then raise exception 'Not your battle';end if;
 if b.status<>'active' then raise exception 'Battle has ended';end if;
 if p_order is null or k is null or k not in ('move','attack','halt','stance','run','fire','width') then raise exception 'Invalid order';end if;
 if jsonb_typeof(p_order->'ids') is distinct from 'array' then raise exception 'Select a formation';end if;
 select count(*) into n from public.battle_formations where battle_id=b.id and owner_id=u and soldiers>0 and status<>'routed'
 and id in(select value::bigint from jsonb_array_elements_text(p_order->'ids'));
 if n<1 then raise exception 'Select a formation that can receive orders';end if;
 if k='attack' then
 if b.phase<>'combat' then raise exception 'Begin the battle before attacking';end if;
 select * into t from public.battle_formations where id=(p_order->>'target')::bigint and battle_id=b.id;
 if t.id is null or t.owner_id=u or t.soldiers<=0 or t.status='routed' then raise exception 'Choose an enemy formation';end if;
 end if;
 if k='stance' and coalesce(p_order->>'stance','') not in ('balanced','guard','aggressive') then raise exception 'Invalid stance';end if;
 for f in select * from public.battle_formations where battle_id=b.id and owner_id=u and soldiers>0 and status<>'routed'
 and id in(select value::bigint from jsonb_array_elements_text(p_order->'ids')) order by id for update loop
 if k='move' then
 if p_order->>'x' is null or p_order->>'y' is null then raise exception 'Choose a destination';end if;
 px:=greatest(35,least(1165,(p_order->>'x')::numeric+(i-(n-1)/2.0)*48));py:=greatest(40,least(660,(p_order->>'y')::numeric));
 if b.phase='deployment' and ((f.side='attacker' and px>365)or(f.side='defender' and px<835)) then raise exception 'Deploy inside your shaded zone';end if;
 face:=(p_order->>'facing')::numeric;col:=greatest(4,least(20,coalesce((p_order->>'columns')::integer,f.columns)));
 update public.battle_formations set target_x=px,target_y=py,target_facing=face,target_formation_id=null,charge_ready=false,columns=col,
 x=case when b.phase='deployment' then px else battle_formations.x end,y=case when b.phase='deployment' then py else battle_formations.y end,
 facing=case when b.phase='deployment' then coalesce(face,facing) else facing end,status=case when b.phase='deployment' then 'idle' else 'moving' end,updated_at=now() where id=f.id;
 elsif k='attack' then
 update public.battle_formations set target_formation_id=t.id,target_x=t.x,target_y=t.y,status='moving',target_facing=null,
 charge_ready=unit_type='cavalry' and stamina>35 and sqrt(power(t.x-x,2)+power(t.y-y,2))>140,updated_at=now() where id=f.id;
 elsif k='halt' then update public.battle_formations set target_formation_id=null,target_x=x,target_y=y,status='idle',charge_ready=false where id=f.id;
 elsif k='stance' then update public.battle_formations set stance=p_order->>'stance' where id=f.id;
 elsif k='run' then update public.battle_formations set running=coalesce((p_order->>'enabled')::boolean,not running) where id=f.id;
 elsif k='fire' then update public.battle_formations set fire_at_will=coalesce((p_order->>'enabled')::boolean,not fire_at_will) where id=f.id;
 elsif k='width' then update public.battle_formations set columns=greatest(4,least(20,(p_order->>'columns')::integer)) where id=f.id;
 end if;i:=i+1;
 end loop;
 return jsonb_build_object('ok',true);
end $$;

create or replace function public.peris_ground(p_terrain text,px numeric,py numeric) returns jsonb language sql immutable set search_path='' as $$
 select case
 when p_terrain='woods' and ((px>420 and px<630 and py>65 and py<310)or(px>690 and px<960 and py>405 and py<665)) then '{"kind":"Forest","speed":0.68,"cover":0.6,"height":0}'::jsonb
 when p_terrain='highlands' and power((px-650)/190,2)+power((py-285)/135,2)<1 then '{"kind":"High ground","speed":0.85,"cover":1,"height":1}'::jsonb
 when p_terrain='river' and abs(px-(600+sin(py/110)*32))<42 and (py<306 or py>395) then '{"kind":"Shallows","speed":0.42,"cover":1,"height":0}'::jsonb
 else '{"kind":"Open ground","speed":1,"cover":1,"height":0}'::jsonb end;
$$;

create or replace function public.peris_finish(p_bid bigint,p_winner text,p_reason text) returns void
language plpgsql security definer set search_path='' as $$
declare b public.battles%rowtype;ai integer;di integer;asur integer;dsur integer;r jsonb;loot jsonb:='{"wood":0,"stone":0,"food":0,"gold":0}';tier integer;u uuid;name text;a public.armies%rowtype;s public.settlements%rowtype;winner uuid;
begin
 select * into b from public.battles where id=p_bid for update;if b.id is null or b.status='resolved' then return;end if;
 select coalesce(sum(initial_soldiers)filter(where side='attacker'),0),coalesce(sum(initial_soldiers)filter(where side='defender'),0),
 coalesce(sum(soldiers)filter(where side='attacker'),0),coalesce(sum(soldiers)filter(where side='defender'),0) into ai,di,asur,dsur from public.battle_formations where battle_id=b.id;
 winner:=case p_winner when 'attacker' then b.attacker_owner_id when 'defender' then b.defender_owner_id else null end;
 -- Acquire both player locks in a stable order, even when two battles finish concurrently.
 perform 1 from public.players where id in(b.attacker_owner_id,b.defender_owner_id) order by id for update;
 if b.mode='pve' and p_winner='attacker' then
 select c.tier into tier from public.peris_camps c where id=b.camp_id;
 loot:=jsonb_build_object('wood',180*tier,'stone',140*tier,'food',220*tier,'gold',60*tier);
 insert into public.peris_progress(owner_id,camp_id,defeated,available_at) values(b.attacker_owner_id,b.camp_id,1,now()+interval '2 minutes')
 on conflict(owner_id,camp_id)do update set defeated=peris_progress.defeated+1,available_at=excluded.available_at;
 end if;
 r:=jsonb_build_object('attacker_initial',ai,'defender_initial',di,'attacker_survivors',asur,'defender_survivors',dsur,'attacker_losses',ai-asur,'defender_losses',di-dsur,'loot',loot,'duration',round(b.elapsed),'reason',p_reason);
 update public.battles set status='resolved',phase='finished',winner_side=p_winner,winner_owner_id=winner,ended_at=now(),result=r where id=b.id;
 for u in select id from public.players where id in(b.attacker_owner_id,b.defender_owner_id) order by id loop
 perform public.peris_settle(u);
 select * into s from public.settlements where owner_id=u;
 update public.armies a0 set
 infantry=coalesce((select sum(soldiers) from public.battle_formations where battle_id=b.id and owner_id=u and unit_type='infantry'),0),
 archers=coalesce((select sum(soldiers) from public.battle_formations where battle_id=b.id and owner_id=u and unit_type='archers'),0),
 cavalry=coalesce((select sum(soldiers) from public.battle_formations where battle_id=b.id and owner_id=u and unit_type='cavalry'),0),
 status='idle',raid_target_id=null,start_x=s.x+40,start_y=s.y+30,target_x=s.x+40,target_y=s.y+30,arrival_at=now(),departure_at=now(),updated_at=now() where owner_id=u;
 if u=winner then update public.players set victories=victories+1,prestige=prestige+coalesce(tier,1)*25 where id=u;end if;
 if u=b.attacker_owner_id and b.mode='pve' and p_winner='attacker' then
 update public.settlements set wood=least(capacity,wood+(loot->>'wood')::integer),stone=least(capacity,stone+(loot->>'stone')::integer),
 food=least(capacity,food+(loot->>'food')::integer),gold=least(capacity,gold+(loot->>'gold')::integer)where owner_id=u;
 end if;
 name:=case when b.mode='pve' then b.enemy_name else 'Duel against '||coalesce((select display_name from public.players where id=case when u=b.attacker_owner_id then b.defender_owner_id else b.attacker_owner_id end),'rival') end;
 insert into public.peris_reports(owner_id,battle_id,title,won,result)values(u,b.id,name,coalesce(u=winner,false),r)on conflict(owner_id,battle_id)do nothing;
 end loop;
end $$;

create or replace function public.peris_tick(p_battle_id bigint) returns jsonb language plpgsql security definer set search_path='' as $$
declare u uuid:=auth.uid();b public.battles%rowtype;f public.battle_formations%rowtype;t public.battle_formations%rowtype;
 remain numeric;dt numeric;dx numeric;dy numeric;distance numeric;speed numeric;reach numeric;move_step numeric;direction numeric;turn numeric;
 gf jsonb;gt jsonb;pending jsonb;entry jsonb;pair record;rate numeric;flank numeric;charge numeric;matchup numeric;stance_mult numeric;brace numeric;cover numeric;elevation numeric;melee_arc numeric;defence numeric;difficulty_mult numeric;relative numeric;damage numeric;cas integer;mor_loss numeric;alive_a integer;alive_d integer;strength_a integer;strength_d integer;
begin
 select * into b from public.battles where id=p_battle_id for update;
 if u is null or b.id is null or (u is distinct from b.attacker_owner_id and u is distinct from b.defender_owner_id) then raise exception 'Not your battle';end if;
 if b.status<>'active' or b.phase<>'combat' then return jsonb_build_object('ok',true);end if;
 remain:=least(2,greatest(0,extract(epoch from(now()-b.last_tick_at))));
 if remain<0.15 then return jsonb_build_object('ok',true);end if;
 update public.battles set last_tick_at=now() where id=b.id;
 while remain>0 loop
 dt:=least(0.1,remain);remain:=remain-dt;b.elapsed:=b.elapsed+dt;
 -- NPCs choose targets; archers pull away from melee and cavalry favours bowmen.
 if b.mode='pve' and floor(b.elapsed*2)<>floor((b.elapsed-dt)*2) then
 for f in select * from public.battle_formations where battle_id=b.id and owner_id is null and soldiers>0 and status<>'routed' order by id loop
 select * into t from public.battle_formations where battle_id=b.id and side<>f.side and soldiers>0 and status<>'routed'
 order by case when f.unit_type='cavalry' and b.difficulty<>'easy' and unit_type='archers' then 0 else 1 end,power(x-f.x,2)+power(y-f.y,2),id limit 1;
 if t.id is null then continue;end if;
 distance:=sqrt(power(t.x-f.x,2)+power(t.y-f.y,2));
 if f.unit_type='archers' and distance<80 and b.difficulty<>'easy' then
 update public.battle_formations set target_formation_id=null,target_x=greatest(50,least(1150,f.x+(f.x-t.x)*1.2)),target_y=greatest(50,least(650,f.y+(f.y-t.y)*1.2)),status='moving' where id=f.id;
 elsif f.target_formation_id is distinct from t.id then
 update public.battle_formations set target_formation_id=t.id,status='moving',running=unit_type='cavalry',
 charge_ready=unit_type='cavalry' and distance>140 and stamina>35 where id=f.id;
 end if;
 end loop;
 end if;
 -- Movement / self-defence pass.
 for f in select * from public.battle_formations where battle_id=b.id and soldiers>0 order by id for update loop
 if f.status='routed' then update public.battle_formations set x=greatest(12,least(1188,x+case when side='attacker' then -1 else 1 end*64*dt))where id=f.id;continue;end if;
 if f.target_formation_id is not null then
 select * into t from public.battle_formations where id=f.target_formation_id and soldiers>0 and status<>'routed';
 if t.id is null then f.target_formation_id:=null;f.target_x:=f.x;f.target_y:=f.y;f.charge_ready:=false;end if;
 end if;
 reach:=case f.unit_type when 'archers' then 220 when 'cavalry' then 50 else 44 end;
 if f.target_formation_id is null then
 select * into t from public.battle_formations where battle_id=b.id and side<>f.side and soldiers>0 and status<>'routed'
 and sqrt(power(x-f.x,2)+power(y-f.y,2))<case when f.unit_type='archers' and not f.fire_at_will then 0 else reach end
 order by power(x-f.x,2)+power(y-f.y,2),id limit 1;
 if t.id is not null then f.target_formation_id:=t.id;f.charge_ready:=false;end if;
 end if;
 if f.target_formation_id is not null then select * into t from public.battle_formations where id=f.target_formation_id;f.target_x:=t.x;f.target_y:=t.y;else reach:=0;end if;
 dx:=f.target_x-f.x;dy:=f.target_y-f.y;distance:=sqrt(dx*dx+dy*dy);gf:=public.peris_ground(b.terrain,f.x,f.y);
 if distance>reach+2 and not(f.target_formation_id is not null and f.stance='guard') then
 direction:=degrees(atan2(dy,dx));turn:=direction-f.facing;turn:=turn-360*floor((turn+180)/360);f.facing:=f.facing+greatest(-150*dt,least(150*dt,turn));
 speed:=(case f.unit_type when 'cavalry' then 76 when 'archers' then 34 else 40 end)*(gf->>'speed')::numeric*
 (case when f.unit_type='cavalry' and gf->>'kind'='Forest' then 0.65 else 1 end)*(case when f.running and f.stamina>8 then 1.45 else 1 end)*(case when f.stamina<15 then 0.75 else 1 end);
 move_step:=least(speed*dt,distance-reach);f.x:=greatest(25,least(1175,f.x+dx/distance*move_step));f.y:=greatest(30,least(670,f.y+dy/distance*move_step));f.status:='moving';
 f.stamina:=greatest(0,least(100,f.stamina-case when f.running then 1.9 else 0.12 end*dt));
 else
 f.status:=case when f.target_formation_id is null then 'idle' else 'engaged' end;
 f.stamina:=greatest(0,least(100,f.stamina+case when f.target_formation_id is null then 2 else -0.4 end*dt));
 if f.target_formation_id is null and f.target_facing is not null then
 turn:=f.target_facing-f.facing;turn:=turn-360*floor((turn+180)/360);f.facing:=f.facing+greatest(-150*dt,least(150*dt,turn));end if;
 if f.target_formation_id is null and f.morale<90 then f.morale:=least(100,f.morale+0.7*dt);end if;
 end if;
 update public.battle_formations set x=f.x,y=f.y,facing=f.facing,target_x=f.target_x,target_y=f.target_y,target_formation_id=f.target_formation_id,status=f.status,stamina=f.stamina,morale=f.morale,charge_ready=f.charge_ready,updated_at=now() where id=f.id;
 end loop;
 -- Accumulate attacks into a map, then apply both armies' losses together.
 pending:='{}'::jsonb;
 for f in select * from public.battle_formations where battle_id=b.id and soldiers>0 and status<>'routed' and target_formation_id is not null order by id loop
 select * into t from public.battle_formations where id=f.target_formation_id;if t.id is null or t.status='routed' or t.soldiers=0 then continue;end if;
 dx:=t.x-f.x;dy:=t.y-f.y;distance:=sqrt(dx*dx+dy*dy);reach:=case f.unit_type when 'archers' then 220 when 'cavalry' then 50 else 44 end;
 if distance>reach+4 then continue;end if;
 gf:=public.peris_ground(b.terrain,f.x,f.y);gt:=public.peris_ground(b.terrain,t.x,t.y);
 relative:=degrees(atan2(f.y-t.y,f.x-t.x))-t.facing;relative:=abs(relative-360*floor((relative+180)/360));
 flank:=case when f.unit_type='archers' and distance>65 then 1 when relative>135 then 1.65 when relative>65 then 1.28 else 1 end;
 charge:=case when f.charge_ready and f.unit_type='cavalry' and gf->>'kind'<>'Forest' then 2.4 else 1 end;
 matchup:=case when f.unit_type='cavalry' then case when t.unit_type='archers' then 1.65 else 0.9 end when f.unit_type='infantry' then case when t.unit_type='cavalry' then 1.25 else 1 end else case when t.unit_type='cavalry' then 0.75 else 1 end end;
 stance_mult:=case f.stance when 'aggressive' then 1.22 when 'guard' then 0.9 else 1 end;
 brace:=case when t.stance='guard' and t.unit_type='infantry' and relative<65 and f.unit_type='cavalry' then 0.5 else 1 end;
 defence:=case t.stance when 'guard' then 0.8 when 'aggressive' then 1.15 else 1 end;
 cover:=case when f.unit_type='archers' and distance>65 then (gt->>'cover')::numeric else 1 end;
 elevation:=case when f.unit_type='archers' and distance>65 and (gf->>'height')::numeric>(gt->>'height')::numeric then 1.25 when f.unit_type='archers' and distance>65 and (gf->>'height')::numeric<(gt->>'height')::numeric then 0.8 else 1 end;
 melee_arc:=case when f.unit_type='archers' and distance<=65 then 0.28 else 1 end;
 difficulty_mult:=case when f.owner_id is null then case b.difficulty when 'hard' then 1.13 when 'easy' then 0.8 else 1 end else 1 end;
 rate:=case f.unit_type when 'infantry' then 0.020 when 'archers' then 0.012 else 0.031 end;
 damage:=f.damage_pool+f.soldiers*rate*matchup*stance_mult*defence*brace*flank*charge*cover*elevation*melee_arc*difficulty_mult*(0.55+f.stamina/220)*dt;
 if charge>1 then damage:=damage+f.soldiers*0.06*brace*flank;end if;
 cas:=least(greatest(0,t.soldiers-coalesce((pending->t.id::text->>'loss')::integer,0)),floor(damage)::integer);mor_loss:=cas::numeric/greatest(1,t.initial_soldiers)*85+case when flank>1 then cas*1.2 else 0 end+case when charge>1 then 12 else 0 end;
 update public.battle_formations set damage_pool=damage-cas,kills=kills+cas,charge_ready=case when charge>1 then false else charge_ready end,
 stamina=case when charge>1 then greatest(0,stamina-12) else stamina end where id=f.id;
 entry:=coalesce(pending->t.id::text,'{"loss":0,"morale":0}'::jsonb);
 pending:=jsonb_set(pending,array[t.id::text],jsonb_build_object('loss',(entry->>'loss')::integer+cas,'morale',(entry->>'morale')::numeric+mor_loss),true);
 end loop;
 for pair in select key,value from jsonb_each(pending) loop
 update public.battle_formations set soldiers=greatest(0,soldiers-(pair.value->>'loss')::integer),morale=greatest(0,morale-(pair.value->>'morale')::numeric) where id=pair.key::bigint;
 update public.battle_formations set status='routed',target_formation_id=null where id=pair.key::bigint and (soldiers=0 or morale<18);
 end loop;
 select count(*)filter(where side='attacker'),count(*)filter(where side='defender'),coalesce(sum(soldiers)filter(where side='attacker'),0),coalesce(sum(soldiers)filter(where side='defender'),0)
 into alive_a,alive_d,strength_a,strength_d from public.battle_formations where battle_id=b.id and soldiers>0 and status<>'routed';
 update public.battles set elapsed=b.elapsed where id=b.id;
 if alive_a=0 or alive_d=0 then perform public.peris_finish(b.id,case when alive_a>0 then 'attacker' when alive_d>0 then 'defender' else 'draw' end,'Army routed');exit;end if;
 if b.elapsed>=900 then perform public.peris_finish(b.id,case when strength_a>strength_d then 'attacker' when strength_d>strength_a then 'defender' else 'draw' end,'Time limit');exit;end if;
 end loop;
 return jsonb_build_object('ok',true);
end $$;

create or replace function public.peris_rally(p_battle_id bigint) returns jsonb language plpgsql security definer set search_path='' as $$
declare u uuid:=auth.uid();b public.battles%rowtype;side_name text;
begin
 select * into b from public.battles where id=p_battle_id for update;
 if u is null or b.id is null or (u is distinct from b.attacker_owner_id and u is distinct from b.defender_owner_id)then raise exception 'Not your battle';end if;
 if b.status<>'active' or b.phase<>'combat' then raise exception 'Rally is available during combat';end if;
 side_name:=case when u=b.attacker_owner_id then 'attacker' else 'defender' end;
 if (side_name='attacker' and b.rally_attacker)or(side_name='defender' and b.rally_defender)then raise exception 'Your general has already rallied the army';end if;
 update public.battles set rally_attacker=rally_attacker or side_name='attacker',rally_defender=rally_defender or side_name='defender'where id=b.id;
 update public.battle_formations set morale=least(100,morale+25),status=case when status='routed' then 'idle' else status end,
 target_x=case when status='routed' then x else target_x end,target_y=case when status='routed' then y else target_y end where battle_id=b.id and owner_id=u and soldiers>0;
 return jsonb_build_object('ok',true);
end $$;

create or replace function public.retreat_from_battle(p_battle_id bigint)returns jsonb language plpgsql security definer set search_path='' as $$
declare u uuid:=auth.uid();b public.battles%rowtype;
begin
 select * into b from public.battles where id=p_battle_id for update;
 if u is null or b.id is null or (u is distinct from b.attacker_owner_id and u is distinct from b.defender_owner_id)then raise exception 'Not your battle';end if;
 perform public.peris_finish(b.id,case when u=b.attacker_owner_id then 'defender' else 'attacker' end,'Withdrawal');
 return jsonb_build_object('ok',true);
end $$;

create or replace function public.peris_challenge(p_defender uuid)returns jsonb language plpgsql security definer set search_path='' as $$
declare u uuid:=auth.uid();
begin
 if u is null or p_defender is null or u=p_defender then raise exception 'Choose another ruler';end if;
 perform 1 from public.players where id in(u,p_defender) order by id for update;
 if not exists(select 1 from public.players where id=p_defender)then raise exception 'Ruler not found';end if;
 if exists(select 1 from public.battles where status='active'and (attacker_owner_id in(u,p_defender)or defender_owner_id in(u,p_defender)))then raise exception 'One army is already fighting';end if;
 if exists(select 1 from public.peris_challenges where status='pending'and expires_at>now()and(attacker_owner_id=u or defender_owner_id=u))then raise exception 'You already have a pending challenge';end if;
 insert into public.peris_challenges(attacker_owner_id,defender_owner_id)values(u,p_defender);
 return jsonb_build_object('ok',true);
end $$;

create or replace function public.peris_respond(p_id bigint,p_accept boolean)returns jsonb language plpgsql security definer set search_path='' as $$
declare u uuid:=auth.uid();c public.peris_challenges%rowtype;a public.armies%rowtype;d public.armies%rowtype;bid bigint;
begin
 select * into c from public.peris_challenges where id=p_id for update;
 if u is null or c.id is null or c.defender_owner_id<>u then raise exception 'Not your invitation';end if;
 if c.status<>'pending' or c.expires_at<=now()then raise exception 'Challenge has expired';end if;
 if not p_accept then update public.peris_challenges set status='declined'where id=c.id;return jsonb_build_object('ok',true);end if;
 perform 1 from public.players where id in(c.attacker_owner_id,c.defender_owner_id)order by id for update;
 perform public.peris_settle(c.attacker_owner_id);perform public.peris_settle(c.defender_owner_id);
 perform 1 from public.armies where owner_id in(c.attacker_owner_id,c.defender_owner_id)order by owner_id for update;
 if exists(select 1 from public.battles where status='active'and(attacker_owner_id in(c.attacker_owner_id,c.defender_owner_id)or defender_owner_id in(c.attacker_owner_id,c.defender_owner_id)))then raise exception 'One army is already fighting';end if;
 if exists(select 1 from public.peris_orders where owner_id in(c.attacker_owner_id,c.defender_owner_id)and kind='recruit')then raise exception 'Finish training before a duel';end if;
 select * into a from public.armies where owner_id=c.attacker_owner_id;select * into d from public.armies where owner_id=c.defender_owner_id;
 if a.id is null or d.id is null or a.infantry+a.archers+a.cavalry=0 or d.infantry+d.archers+d.cavalry=0 then raise exception 'Both armies need soldiers';end if;
 insert into public.battles(attacker_owner_id,defender_owner_id,attacker_army_id,defender_army_id,mode,phase,terrain,enemy_name)
 values(a.owner_id,d.owner_id,a.id,d.id,'pvp','deployment','plains',(select display_name from public.players where id=d.owner_id))returning id into bid;
 perform public.peris_add_formations(bid,a.owner_id,'attacker',a.infantry,a.archers,a.cavalry,coalesce((select 90+2*level from public.buildings where settlement_id=a.home_settlement_id and building_type='wall'),92));
 perform public.peris_add_formations(bid,d.owner_id,'defender',d.infantry,d.archers,d.cavalry,coalesce((select 90+2*level from public.buildings where settlement_id=d.home_settlement_id and building_type='wall'),92));
 update public.armies set status='idle',raid_target_id=null where id in(a.id,d.id);
 update public.peris_challenges set status='accepted'where id=c.id;
 return jsonb_build_object('ok',true,'battle_id',bid);
end $$;

create or replace function public.peris_claim(p_quest_id text)returns jsonb language plpgsql security definer set search_path='' as $$
declare u uuid:=auth.uid();p public.players%rowtype;cw integer;cs integer;cf integer;cg integer;
begin
 if u is null then raise exception 'Authentication required';end if;perform public.peris_settle(u);select * into p from public.players where id=u for update;
 if exists(select 1 from public.peris_claims where owner_id=u and quest_id=p_quest_id)then raise exception 'Reward already claimed';end if;
 if p_quest_id='builder' and p.upgrades>=1 then cw:=250;cs:=200;cf:=200;cg:=50;
 elsif p_quest_id='recruiter' and p.recruits>=20 then cw:=200;cs:=150;cf:=300;cg:=75;
 elsif p_quest_id='victor' and p.victories>=1 then cw:=300;cs:=300;cf:=400;cg:=150;
 elsif p_quest_id='conqueror' and p.victories>=5 then cw:=1000;cs:=800;cf:=1000;cg:=500;
 else raise exception 'Complete the objective first';end if;
 insert into public.peris_claims(owner_id,quest_id)values(u,p_quest_id);
 update public.settlements set wood=least(capacity,wood+cw),stone=least(capacity,stone+cs),food=least(capacity,food+cf),gold=least(capacity,gold+cg)where owner_id=u;
 return jsonb_build_object('ok',true);
end $$;
create or replace function public.peris_rename(p_name text)returns jsonb language plpgsql security definer set search_path='' as $$
begin
 if auth.uid() is null then raise exception 'Authentication required';end if;
 if p_name is null or length(btrim(p_name))<2 or length(btrim(p_name))>32 then raise exception 'Use a name of 2-32 characters';end if;
 update public.settlements set name=btrim(p_name)where owner_id=auth.uid();return jsonb_build_object('ok',true);
end $$;

-- New players receive all eight structures; existing players keep their existing troops.
create or replace function public.create_player(p_display_name text)returns jsonb language plpgsql security definer set search_path='' as $$
declare u uuid:=auth.uid();n text:=btrim(p_display_name);sp public.spawn_points%rowtype;sid bigint;
begin
 if u is null then raise exception 'Authentication required';end if;
 if exists(select 1 from public.players where id=u)then return jsonb_build_object('ok',true);end if;
 if n is null or n!~'^[A-Za-z0-9 _-]{2,20}$'then raise exception 'Use 2-20 letters, numbers, spaces, _ or -';end if;
 select sp0.* into sp from public.spawn_points sp0 left join public.settlements s on s.spawn_point_id=sp0.id where s.id is null order by sp0.id limit 1 for update of sp0 skip locked;
 if sp.id is null then raise exception 'The 12-player prototype world is full';end if;
 insert into public.players(id,display_name)values(u,n);
 insert into public.settlements(owner_id,spawn_point_id,name,x,y,wood,stone,food,gold)values(u,sp.id,n||'''s Keep',sp.x,sp.y,1250,1000,1500,500)returning id into sid;
 insert into public.buildings(settlement_id,building_type,level)select sid,t,1 from unnest(array['lumber','quarry','farm','market','barracks','stables','wall','storehouse'])t;
 insert into public.armies(owner_id,home_settlement_id,name,infantry,archers,cavalry,start_x,start_y,target_x,target_y)values(u,sid,'Legio I · The Dawn',120,50,16,sp.x+40,sp.y+30,sp.x+40,sp.y+30);
 return jsonb_build_object('ok',true);
exception when unique_violation then raise exception 'That ruler name is already taken';
end $$;

create or replace function public.peris_snapshot()returns jsonb language plpgsql security definer set search_path='' as $$
declare u uuid:=auth.uid();result jsonb;
begin
 if u is null then raise exception 'Authentication required';end if;
 select jsonb_build_object('version',6,'server_now',now(),
 'players',coalesce((select jsonb_agg(p order by created_at)from public.players p),'[]'::jsonb),
 'settlements',coalesce((select jsonb_agg(s order by id)from public.settlements s),'[]'::jsonb),
 'buildings',coalesce((select jsonb_agg(b order by id)from public.buildings b),'[]'::jsonb),
 'armies',coalesce((select jsonb_agg(a order by id)from public.armies a),'[]'::jsonb),
 'camps',coalesce((select jsonb_agg(c order by id)from public.peris_camps c),'[]'::jsonb),
 'orders',coalesce((select jsonb_agg(o order by finish_at)from public.peris_orders o where owner_id=u),'[]'::jsonb),
 'battles',coalesce((select jsonb_agg(b order by id)from public.battles b where attacker_owner_id=u or defender_owner_id=u),'[]'::jsonb),
 'formations',coalesce((select jsonb_agg(f order by f.id)from public.battle_formations f join public.battles b on b.id=f.battle_id where b.status='active'and (b.attacker_owner_id=u or b.defender_owner_id=u)),'[]'::jsonb),
 'reports',coalesce((select jsonb_agg(r order by id desc)from (select * from public.peris_reports where owner_id=u order by id desc limit 50)r),'[]'::jsonb),
 'progress',coalesce((select jsonb_agg(p)from public.peris_progress p where owner_id=u),'[]'::jsonb),
 'claims',coalesce((select jsonb_agg(c)from public.peris_claims c where owner_id=u),'[]'::jsonb),
 'challenges',coalesce((select jsonb_agg(c)from public.peris_challenges c where (attacker_owner_id=u or defender_owner_id=u)and status='pending'and expires_at>now()),'[]'::jsonb))into result;
 return result;
end $$;

-- Retire v4/v5 bypasses: clients cannot use instant upgrades, instant recruitment,
-- unaccepted challenges, or the old tactical simulation to circumvent v6 rules.
revoke all on function public.upgrade_building(text) from public,anon,authenticated;
revoke all on function public.recruit_units(integer,integer,integer)from public,anon,authenticated;
revoke all on function public.create_battle(uuid)from public,anon,authenticated;
revoke all on function public.issue_battle_move(bigint,bigint,integer,integer)from public,anon,authenticated;
revoke all on function public.issue_battle_attack(bigint,bigint,bigint)from public,anon,authenticated;
revoke all on function public.advance_battle(bigint)from public,anon,authenticated;
-- Restrict helpers even when Supabase defaults grant function execution to clients.
do $$declare r record;signature text;begin
 for r in select p.oid from pg_proc p join pg_namespace n on n.oid=p.pronamespace where n.nspname='public'and p.proname like 'peris_%' loop
 signature:=r.oid::regprocedure::text;execute 'revoke all on function '||signature||' from public, anon, authenticated';
 end loop;
end $$;
revoke all on function public.create_player(text),public.sync_my_state(),public.move_army(integer,integer),public.retreat_from_battle(bigint)from public,anon;
grant execute on function public.create_player(text),public.sync_my_state(),public.move_army(integer,integer),public.retreat_from_battle(bigint)to authenticated;
grant execute on function public.peris_snapshot(),public.peris_queue_upgrade(text),public.peris_queue_recruit(text,integer),public.peris_raid(integer),public.peris_ready(bigint),
 public.peris_order(bigint,jsonb),public.peris_tick(bigint),public.peris_rally(bigint),public.peris_challenge(uuid),public.peris_respond(bigint,boolean),public.peris_claim(text),public.peris_rename(text)to authenticated;

do $$declare t text;begin
 foreach t in array array['peris_orders','peris_reports','peris_challenges']loop
 begin execute format('alter publication supabase_realtime add table public.%I',t);exception when duplicate_object then null;end;
 end loop;
end $$;

commit;
