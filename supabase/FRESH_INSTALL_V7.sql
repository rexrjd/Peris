-- PERIS v7 fresh installation. ONLY for an EMPTY Supabase project.
-- Existing v5/v6/v7 world: use UPGRADE_TO_V7.sql. This file refuses existing players.
begin;
do $$ declare occupied boolean;begin
 if to_regclass('public.players') is not null then
 execute 'select exists(select 1 from public.players)' into occupied;
 if occupied then raise exception 'A Peris campaign already exists. Use UPGRADE_TO_V7.sql to preserve it.';end if;
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
  wood_rate integer not null default 14,
  stone_rate integer not null default 12,
  food_rate integer not null default 18,
  gold_rate integer not null default 3,
  resources_updated_at timestamptz not null default now(),
  created_at timestamptz not null default now()
);

create table public.buildings (
  id bigint generated always as identity primary key,
  settlement_id bigint not null references public.settlements(id) on delete cascade,
  building_type text not null check (building_type in ('lumber', 'quarry', 'farm', 'market')),
  level integer not null default 0 check (level between 0 and 5),
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

  if v_level >= 5 then raise exception 'Building is already max level'; end if;
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

-- PERIS v7 · Empire prototype. Run this entire file in Supabase SQL Editor.
-- Requires the v5 schema. Preserves players, settlements, resources and armies.
-- Safe to run again. No Auth users or campaign data are deleted.

alter table public.players add column if not exists prestige integer not null default 0;
alter table public.players add column if not exists victories integer not null default 0;
alter table public.players add column if not exists recruits integer not null default 0;
alter table public.players add column if not exists upgrades integer not null default 0;
alter table public.settlements add column if not exists capacity integer not null default 5000;
alter table public.settlements alter column capacity set default 5000;
alter table public.settlements alter column wood_rate set default 14;
alter table public.settlements alter column stone_rate set default 12;
alter table public.settlements alter column food_rate set default 18;
alter table public.settlements alter column gold_rate set default 3;
alter table public.settlements alter column wood type numeric(18,4);
alter table public.settlements alter column stone type numeric(18,4);
alter table public.settlements alter column food type numeric(18,4);
alter table public.settlements alter column gold type numeric(18,4);
update public.buildings set level=least(5,greatest(0,level));
alter table public.buildings drop constraint if exists buildings_level_check;
alter table public.buildings add constraint buildings_level_check check(level between 0 and 5);
alter table public.buildings drop constraint if exists buildings_building_type_check;
alter table public.buildings add constraint buildings_building_type_check check(building_type in ('lumber','quarry','farm','market','barracks','stables','wall','storehouse'));
insert into public.buildings(settlement_id,building_type,level)
select s.id,t,0 from public.settlements s cross join unnest(array['barracks','stables','wall','storehouse']) t
on conflict(settlement_id,building_type) do nothing;

-- Five-stage city progression: level 0 is an unbuilt/ruined plot, levels 1-5 are the visual and mechanical upgrades.
update public.settlements s set
 wood_rate=14+coalesce((select level from public.buildings b where b.settlement_id=s.id and b.building_type='lumber'),0)*8,
 stone_rate=12+coalesce((select level from public.buildings b where b.settlement_id=s.id and b.building_type='quarry'),0)*7,
 food_rate=18+coalesce((select level from public.buildings b where b.settlement_id=s.id and b.building_type='farm'),0)*10,
 gold_rate=3+coalesce((select level from public.buildings b where b.settlement_id=s.id and b.building_type='market'),0)*3,
 capacity=5000+coalesce((select level from public.buildings b where b.settlement_id=s.id and b.building_type='storehouse'),0)*2500;

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
-- Repeatable city plots; legacy buildings are retained for save compatibility.
alter table public.settlements add column if not exists food_capacity integer not null default 5000;
alter table public.settlements add column if not exists city_slots_ready boolean not null default false;
alter table public.battle_formations add column if not exists attack_multiplier numeric not null default 1 check(attack_multiplier between 1 and 1.6);
create table if not exists public.peris_city_slots (
 settlement_id bigint not null references public.settlements(id) on delete cascade,
 slot_index integer not null check(slot_index between 0 and 16),
 building_type text not null check(building_type in ('barracks','stables','smithy','warehouse','granary','fishery','mage_tower')),
 level integer not null default 0 check(level between 0 and 5),
 primary key(settlement_id,slot_index),check((building_type='fishery')=(slot_index=16))
);
alter table public.peris_city_slots enable row level security;
drop policy if exists "own city slots" on public.peris_city_slots;
create policy "own city slots" on public.peris_city_slots for select to authenticated using(exists(select 1 from public.settlements s where s.id=settlement_id and s.owner_id=auth.uid()));
revoke all on public.peris_city_slots from public,anon,authenticated;
grant select on public.peris_city_slots to authenticated;
create or replace function public.peris_city_economy(p_sid bigint) returns void language plpgsql security definer set search_path='' as $$
begin
 update public.settlements s set
 wood_rate=14+8*coalesce((select level from public.buildings where settlement_id=s.id and building_type='lumber'),0),
 stone_rate=12+7*coalesce((select level from public.buildings where settlement_id=s.id and building_type='quarry'),0),
 food_rate=18+10*coalesce((select level from public.buildings where settlement_id=s.id and building_type='farm'),0)+8*coalesce((select sum(level) from public.peris_city_slots where settlement_id=s.id and building_type='fishery'),0),
 gold_rate=3+3*coalesce((select level from public.buildings where settlement_id=s.id and building_type='market'),0),
 capacity=5000+2500*coalesce((select sum(level) from public.peris_city_slots where settlement_id=s.id and building_type='warehouse'),0),
 food_capacity=5000+2500*coalesce((select sum(level) from public.peris_city_slots where settlement_id=s.id and building_type='granary'),0)
 where s.id=p_sid;
end $$;
create or replace function public.peris_city_migrate(p_sid bigint) returns void language plpgsql security definer set search_path='' as $$
begin
 perform 1 from public.settlements where id=p_sid and not city_slots_ready for update;
 if not found then return;end if;
 insert into public.peris_city_slots(settlement_id,slot_index,building_type,level)
 select b.settlement_id,case b.building_type when 'barracks' then 0 when 'stables' then 1 else 2 end,
 case b.building_type when 'storehouse' then 'warehouse' else b.building_type end,b.level
 from public.buildings b join public.settlements s on s.id=b.settlement_id
 where b.settlement_id=p_sid and b.building_type in ('barracks','stables','storehouse') and (b.level>0 or exists(select 1 from public.peris_orders o where o.owner_id=s.owner_id and o.kind='upgrade' and o.item=b.building_type)) on conflict do nothing;
 -- Preserve the food capacity of old combined storehouses as well.
 insert into public.peris_city_slots select p_sid,3,'granary',level from public.buildings where settlement_id=p_sid and building_type='storehouse' and level>0 on conflict do nothing;
 update public.peris_orders o set item='slot:'||(case item when 'barracks' then '0:barracks' when 'stables' then '1:stables' else '2:warehouse' end)
 where o.owner_id=(select owner_id from public.settlements where id=p_sid) and kind='upgrade' and item in ('barracks','stables','storehouse');
 update public.settlements set city_slots_ready=true where id=p_sid;
 perform public.peris_city_economy(p_sid);
end $$;
create or replace function public.peris_queue_slot(p_slot integer,p_type text default null) returns jsonb language plpgsql security definer set search_path='' as $$
declare u uuid:=auth.uid();s public.settlements%rowtype;l integer;main integer;t text;factor numeric;cw numeric;cs numeric;cf numeric;cg numeric;
begin
 if u is null then raise exception 'Authentication required';end if;
 perform public.peris_settle(u);
 if exists(select 1 from public.battles where status='active' and (attacker_owner_id=u or defender_owner_id=u)) then raise exception 'Finish the current battle first';end if;
 select * into s from public.settlements where owner_id=u for update;
 if s.id is null then raise exception 'Realm not found';end if;
 select level into main from public.buildings where settlement_id=s.id and building_type='market';
 if p_slot is null or p_slot<0 or p_slot<>16 and p_slot>=6+2*coalesce(main,0) then raise exception 'Upgrade the main building to unlock this plot';end if;
 if exists(select 1 from public.peris_orders where owner_id=u and kind='upgrade') then raise exception 'Your builders are already working';end if;
 select level,building_type into l,t from public.peris_city_slots where settlement_id=s.id and slot_index=p_slot;
 if p_type is not null then
  if l is not null then raise exception 'This plot is already occupied';end if;
  if p_type not in ('barracks','stables','smithy','warehouse','granary','fishery','mage_tower') then raise exception 'Unknown building';end if;
  if p_type='mage_tower' and exists(select 1 from public.peris_city_slots where settlement_id=s.id and building_type='mage_tower') then raise exception 'Only one mage tower can be built in your city';end if;
  if (p_type='fishery')<>(p_slot=16) then raise exception 'A fishery needs a riverside plot';end if;
  t:=p_type;l:=0;
 elsif l is null or l=0 then raise exception 'This building is not ready';end if;
 if l>=(case when t='mage_tower' then 10 else 5 end) then raise exception 'Maximum building level reached';end if;
 factor:=power(case when t='mage_tower' then 1.38::numeric else 1.55::numeric end,l);
 cw:=ceil((case t when 'mage_tower' then 260 when 'barracks' then 180 when 'stables' then 200 when 'smithy' then 180 when 'warehouse' then 200 else 160 end)*factor);
 cs:=ceil((case t when 'mage_tower' then 340 when 'barracks' then 160 when 'stables' then 120 when 'smithy' then 220 when 'warehouse' then 150 when 'granary' then 120 else 80 end)*factor);
 cf:=ceil((case t when 'barracks' then 100 when 'stables' then 180 when 'smithy' then 80 when 'warehouse' then 90 else 100 end)*factor);
 cg:=ceil((case t when 'mage_tower' then 160 when 'barracks' then 30 when 'stables' then 45 when 'smithy' then 60 when 'granary' then 15 else 20 end)*factor);
 if s.wood<cw or s.stone<cs or s.food<cf or s.gold<cg then raise exception 'Your stores cannot cover this cost';end if;
 update public.settlements set wood=wood-cw,stone=stone-cs,food=food-cf,gold=gold-cg where id=s.id;
 if p_type is not null then insert into public.peris_city_slots values(s.id,p_slot,t,0);end if;
 insert into public.peris_orders(owner_id,kind,item,quantity,started_at,finish_at)values(u,'upgrade','slot:'||p_slot||':'||t,1,now(),now()+make_interval(secs=>15+l*10));
 return jsonb_build_object('ok',true);
end $$;
revoke all on function public.peris_city_economy(bigint),public.peris_city_migrate(bigint),public.peris_queue_slot(integer,text) from public,anon,authenticated;
grant execute on function public.peris_queue_slot(integer,text) to authenticated;
-- Never shrink an occupied world silently. The enclosing transaction aborts
-- before changing constraints, terrain or positions when migration is needed.
alter table public.armies add column if not exists march_path jsonb;
alter table public.armies add column if not exists march_distance numeric;
do $$
declare outside_settlements integer;outside_armies integer;outside_routes integer;
begin
 select count(*) into outside_settlements from public.settlements
 where x < -12800 or x >= 12800 or y < -12800 or y >= 12800;
 select count(*) into outside_armies from public.armies
 where start_x < -12800 or start_x >= 12800 or start_y < -12800 or start_y >= 12800
    or target_x < -12800 or target_x >= 12800 or target_y < -12800 or target_y >= 12800;
 select count(*) into outside_routes from public.armies a
 where a.march_path is not null and exists (
  select 1 from jsonb_array_elements(a.march_path) p
  where (p->>0)::numeric < -12800 or (p->>0)::numeric >= 12800
     or (p->>1)::numeric < -12800 or (p->>1)::numeric >= 12800
 );
 if outside_settlements + outside_armies + outside_routes > 0 then
  raise exception '200 x 200 world upgrade requires manual migration: % settlements, % armies and % saved routes are outside [-12800, 12800). No positions were moved or deleted.',outside_settlements,outside_armies,outside_routes;
 end if;
end $$;
alter table public.settlements drop constraint if exists settlements_x_check;
alter table public.settlements add constraint settlements_x_check check(x >= -12800 and x < 12800);
alter table public.settlements drop constraint if exists settlements_y_check;
alter table public.settlements add constraint settlements_y_check check(y >= -12800 and y < 12800);

-- Original and historical generated spawn points retain their IDs/coordinates.
-- Current land-only sites are generated after the terrain mask is installed.
create index if not exists spawn_points_map_position_idx on public.spawn_points(x,y);

create index if not exists settlements_map_position_idx on public.settlements(x,y);
create index if not exists armies_map_status_idx on public.armies(status);
create index if not exists armies_map_position_idx on public.armies(target_x,target_y) where status='idle';
-- Generated by node --import tsx scripts/build-world.mjs. Do not edit the mask.
-- One bit per field (row-major, least-significant bit first), seed98213.
create table if not exists public.peris_world_map(
 id integer primary key check(id=1),seed integer not null,cols integer not null,rows integer not null,
 cell_size integer not null,walkable bytea not null
);
-- Replace the former 20 kB mask constraint before storing the new 5 kB mask.
alter table public.peris_world_map drop constraint if exists peris_world_map_walkable_check;
alter table public.peris_world_map enable row level security;
revoke all on public.peris_world_map from public,anon,authenticated;
insert into public.peris_world_map(id,seed,cols,rows,cell_size,walkable)
values(1,98213,200,200,128,decode('000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000080ff7f00000010000000000000000000000000000000000000e0ffff0100007c000000000000000000000000000000000000fcffff0f00e0ff010000000000000000000000000000000000ffffffff3ffcff070000000000000000000000000000000080ffffffffffffff1f00000000000000000000000000000000c0ffffffffffffff3f00000000000000000000000000000000f0ffffffffffffffff00000000000000000000000000000000feffffffffffffffff07000000000000000000000000000000ffffffffffffffffff1f0000000000000000000000000000f0ffffffffffffffffff3f0000000000000000000000000000feffffffffffffffffffff0000000000000000000000000080ffffffffffffffffffffff01000000000000000000000000c0ffffffffffffffffffffff03000000000000000000000000c0ffffffffffffffffffffff1f000000000000000000000000e0ffffffffffffffffffffffff010000000000000000000000e0ffffffffffffffffffffffff030000000000000000000000e0ffffffffffffffffffffffff1f0000000000000000000000f0ffffffffffffffffffffffff7f0000000000000000000000f8ffffffffffffffffffffffffff0000000000000000000000fcffffffffffffffffffffffffff0000000000000000000000feffffffffffffffffffffffffff0100000000000000000080ffffffffffffffffffffffffffff03000000000000000000e0ffffffffffffffffffffffffffff0f000000000000000000fcffffffffffffffffffffffffffff0f0000000000000000f0ffffffffffffffffffffffffffffff1f0000000000000000f8ffffffffffffffffffffffffffffff1f0000000000000000fcffffffffffffffffffffffffffffff3f0000000000000000fcffffffffffffffffffffffffffffff3f0000000000000000feffffffffffffffffffffffffffffff3f0000000000000000ffffffffffffffffffffffffffffffff7f00000000000000c0ffffffffffffffffffffffffffffffffff00000000000000f0ffffffffffffffffffffffffffffffffff01000000000000f8ffffffffffffffffffffffffffffffffff03000000000000fcffffffffffffffffffffffffffffffffff07000000000000fcffffffffffffffffffffffffffffffffff0f000000000000fcffffffffffffffffffffffffffffffffff1f000000000000fcffffffffffffffffffffffffffffffffff1f000000000000fcffffffffffffffffffffffffffffffffff3f000000000000f8ffffffffffffffffffffffffffffffffff7f000000000000f8ffffffffffffffffffffffffffffffffffff000000000000f8ffffffffffffffffffffffffffffffffffff010000000000f8ffffffffffffffffffffffffffffffffffff030000000000f0ffffffffffffffffffffffffffffffffffff070000000000f0ffffffffffffffffffffffffffffffffffff1f0000000000f0ffffffffffffffffffffffffffffffffffff1f0000000000f0ffffffffffffffffffffffffffffffffffff3f0000000000f0ffffffffffffffffffffffffffffffffffff7f0000000000f0ffffffffffffffffffffffffffffffffffff7f0000000000f8ffffffffffffffffffffffffffffffffffffff0000000000fcffffffffffffffffffffffffffffffffffffff0000000000feffffffffffffffffffffffffffffffffffffff0100000000feffffffffffffffffffffffffffffffffffffff0100000000ffffffffffffffffffffffffffffffffffffffff0100000000ffffffffffffffffffffffffffffffffffffffff0100000080ffffffffffffffffffffffffffffffffffffffff01000000c0ffffffffffffffffffffffffffffffffffffffff01000000c0ffffffffffffffffffffffffffffffffffffffff01000000e0ffffffffffffffffffffffffffffffffffffffff01000000f0ffffffffffffffffffffffffffffffffffffffff01000000fcffffffffffffffffffffffffffffffffffffffff01000000ffffffffffffffffffffffffffffffffffffffffff010000c0ffffffffffffffffffffffffffffffffffffffffff010000c0ffffffffffffffffffffffffffffffffffffffffff010000c0ffffffffffffffffffffffffffffffffffffffffff000000c0ffffffffffffffffffffffffffffffffffffffffff000000c0ffffffffffffffffffffffffffffffffffffffffff000000c0ffffffffffffffffffffffffffffffffffffffffff000000c0ffffffffffffffffffffffffffffffffffffffffff000000c0ffffffffffffffffffffffffffffffffffffffffff010000c0ffffffffffffffffffffffffffffffffffffffffff01000080ffffffffffffffffffffffffffffffffffffffffff03000080ffffffffffffffffffffffffffffffffffffffffff07000000ffffffffffffffffffffffffffffffffffffffffff07000000ffffffffffffffffffffffffffffffffffffffffff07000080ffffffffffffffffffffffffffffffffffffffffff0f000080ffffffffffffffffffffffffffffffffffffffffff1f0000c0ffffffffffffffffffffffffffffffffffffffffff1f0000c0ffffffffffffffffffffffffffffffffffffffffff3f0000c0ffffffffffffffffffffffffffffffffffffffffff3f0000c0ffffffffffffffffffffffffffffffffffffffffff3f0000c0ffffffffffffffffffffffffffffffffffffffffff1f0000c0ffffffffffffffffffffffffffffffffffffffffff1f0000c0ffffffffffffffffffffffffffffffffffffffffff1f0000c0ffffffffffffffffffffffffffffffffffffffffff1f0000c0ffffffffffffffffffffffffffffffffffffffffff1f0000c0ffffffffffffffffffffffffffffffffffffffffff1f0000c0ffffffffffffffffffffffffffffffffffffffffff1f0000c0ffffffffffffffffffffffffffffffffffffffffff1f0000c0ffffffffffffffffffffffffffffffffffffffffff1f000080ffffffffffffffffffffffffffffffffffffffffff0f000000ffffffffffffffffffffffffffffffffffffffffff0f000000feffffffffffffffffffffffffffffffffffffffff0f000000feffffffffffffffffffffffffffffffffffffffff07000000fcffffffffffffffffffffffffffffffffffffffff07000000fcffffffffffffffffffffffffffffffffffffffff07000000fcffffffffffffffffffffffffffffffffffffffff07000000fcffffffffffffffffffffffffffffffffffffffff07000000fcffffffffffffffffffffffffffffffffffffffff07000000f8ffffffffffffffffffffffffffffffffffffffff07000000f8ffffffffffffffffffffffffffffffffffffffff07000000fcffffffffffffffffffffffffffffffffffffffff07000000fcffffffffffffffffffffffffffffffffffffffff07000000feffffffffffffffffffffffffffffffffffffffff07000000feffffffffffffffffffffffffffffffffffffffff07000000ffffffffffffffffffffffffffffffffffffffffff07000000ffffffffffffffffffffffffffffffffffffffffff07000000ffffffffffffffffffffffffffffffffffffffffff07000080ffffffffffffffffffffffffffffffffffffffffff07000080ffffffffffffffffffffffffffffffffffffffffff07000080ffffffffffffffffffffffffffffffffffffffffff07000080ffffffffffffffffffffffffffffffffffffffffff07000080ffffffffffffffffffffffffffffffffffffffffff07000080ffffffffffffffffffffffffffffffffffffffffff03000080ffffffffffffffffffffffffffffffffffffffffff03000080ffffffffffffffffffffffffffffffffffffffffff01000000ffffffffffffffffffffffffffffffffffffffffff00000000ffffffffffffffffffffffffffffffffffffffff7f00000000ffffffffffffffffffffffffffffffffffffffff3f00000000ffffffffffffffffffffffffffffffffffffffff3f00000000feffffffffffffffffffffffffffffffffffffff1f00000000feffffffffffffffffffffffffffffffffffffff0f00000000fcffffffffffffffffffffffffffffffffffffff0f00000000fcffffffffffffffffffffffffffffffffffffff0700000000fcffffffffffffffffffffffffffffffffffffff0300000000f8ffffffffffffffffffffffffffffffffffffff0300000000f8ffffffffffffffffffffffffffffffffffffff0100000000f8ffffffffffffffffffffffffffffffffffffff0100000000f0ffffffffffffffffffffffffffffffffffffff0100000000e0ffffffffffffffffffffffffffffffffffffffc001000000e0ffffffffffffffffffffffffffffffffffff7fe003000000c0ffffffffffffffffffffffffffffffffffff1ff00700000080ffffffffffffffffffffffffffffffffffff07f80f00000080ffffffffffffffffffffffffffffffffffff03f80f00000000ffffffffffffffffffffffffffffffffffff01f80f00000000ffffffffffffffffffffffffffffffffffff00f80f00000000feffffffffffffffffffffffffffffffff7f00f80f00000000fcffffffffffffffffffffffffffffffff7f00f80f00000000f0ffffffffffffffffffffffffffffffff3f00f00700000000e0ffffffffffffffffffffffffffffffff3f00f00700000000c0ffffffffffffffffffffffffffffffff3f00e00300000000c0ffffffffffffffffffffffffffffffff1f00c00100000000c0ffffffffffffffffffffffffffffffff1f0000000000000080ffffffffffffffffffffffffffffffff0f0000000000000000ffffffffffffffffffffffefffffffff0f0000000000000000feffffffffffffffffffffc7ffffffff0f0000000000000000f0ffffffffffffffffffff87ffffffff070000000000000000c0ffffffffffffffffffff03ffffffff03000000000000000000ffffffffffffffffffff03feffffff01000000000000000000feffffffffffffffffff01feffffff01000000000000000000fcffffffffffffffffff01fcffffff01000000000000000000f8ffffffffffffffffff00f8ffffff00000000000000000000e0ffffffffffffffff7f00f8ffffff00000000000000000000c0ffffffffffffffff3f00f0ffff7f0000000000000000000080ffffffffffffffff1f00f0ffff7f0000000000000000000000ffffffffffffffff0f00f0ffff3f0000000000000000000000fcffffffffffffff0700e0ffff030000000000000000000000e0ffffffffffffff0700e0ffff000000000000000000000000c0ffffffffffffff0300e0ff3f00000000000000000000000080ffffffffffffff0300c0ff1f00000000000000000000000000ffffffffffffff030080ff1f00000000000000000000000000fcffffffffffff010080ff0f00000000000000000000000000f8ffffffffffff010000ff0300000000000000000000000000f0ffffffffffff000000fe0100000000000000000000000000e0ffffffffffff0000007c0000000000000000000000000000c0ffffffffff7f00000018000000000000000000000000000000ffffffffff3f00000008000000000000000000000000000000f8ffffffff3f00000000000000000000000000000000000000c0ffffffff1f000000000000000000000000000000000000000080ffffff0f0000000000000000000000000000000000000000000680ff0f0000000000000000000000000000000000000000000000fc070000000000000000000000000000000000000000000000f807000000f003000000000000000000000000000000000000e003000000f80f0000000000000000000000000000000000008003000000fc1f0000000000000000000000000000000000000000000000fe1f0000000000000000000000000000000000000000000000fe3f0000000000000000000000000000000000000000000000fe3f000000000000000000000000000000f803000000000000fe3f000000000000000000000000000000fe0f000000000000fe3f000000000000000000000000000000ff1f000000000000fe1f000000000000000000000000000000ff1f000000000000fc0f000000000000000000000000000080ff1f000000000000f807000000000000000000000000000080ff1f000000000000e001000000000000000000000000000000ff1f0000000000000000000000000000000000000000000000ff1f0000000000000000000000000000000000000000000000fe0f0000000000000000000000000000000000000000000000f80300000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000','hex'))
on conflict(id)do update set seed=excluded.seed,cols=excluded.cols,rows=excluded.rows,cell_size=excluded.cell_size,walkable=excluded.walkable;
alter table public.peris_world_map add constraint peris_world_map_walkable_check check(octet_length(walkable)=5000);

create or replace function public.peris_world_walkable(p_x numeric,p_y numeric)returns boolean
language sql stable security definer set search_path='' as $$
 select case when p_x>=-12800 and p_x<12800 and p_y>=-12800 and p_y<12800 then
  coalesce((select get_bit(walkable,((floor(p_y/128)::integer+100)*200+floor(p_x/128)::integer+100))=1 from public.peris_world_map where id=1),false)
 else false end
$$;

-- Reserve a new ID range so a former 400-field world's sites never move.
-- Keep all twelve original sites; only new land fields receive new sites.
insert into public.spawn_points(id,x,y)
select site.id,site.x,site.y from (
 select 10013 + row_index * 50 + column_index as id,
        (column_index * 4 - 98) * 128 + 64 as x,
        (row_index * 4 - 98) * 128 + 64 as y
 from generate_series(0,49) as rows(row_index)
 cross join generate_series(0,49) as columns(column_index)
) site
where public.peris_world_walkable(site.x,site.y)
 and not exists(select 1 from public.spawn_points existing where existing.x=site.x and existing.y=site.y)
on conflict(id) do nothing;

-- Interpolate by traveled route distance. Old saves and armies with no stored
-- route retain the original straight-line interpolation until their next march.
create or replace function public.peris_army_position(p_army public.armies,p_at timestamptz default now())returns jsonb
language plpgsql stable security definer set search_path='' as $$
declare t numeric;remaining numeric;point jsonb;previous jsonb;x numeric;y numeric;px numeric;py numeric;segment numeric;
begin
 if p_army.status<>'moving' then return jsonb_build_object('x',p_army.target_x,'y',p_army.target_y);end if;
 t:=greatest(0,least(1,extract(epoch from(p_at-p_army.departure_at))/greatest(0.001,extract(epoch from(p_army.arrival_at-p_army.departure_at)))));
 if p_army.march_path is null or jsonb_typeof(p_army.march_path)<>'array' or jsonb_array_length(p_army.march_path)<2 or coalesce(p_army.march_distance,0)<=0 then
  return jsonb_build_object('x',p_army.start_x+(p_army.target_x-p_army.start_x)*t,'y',p_army.start_y+(p_army.target_y-p_army.start_y)*t);
 end if;
 remaining:=p_army.march_distance*t;previous:=p_army.march_path->0;
 px:=(previous->>0)::numeric;py:=(previous->>1)::numeric;
 for point in select value from jsonb_array_elements(p_army.march_path)with ordinality as points(value,ordinal)where ordinal>1 order by ordinal loop
  x:=(point->>0)::numeric;y:=(point->>1)::numeric;segment:=sqrt(power(x-px,2)+power(y-py,2));
  if segment>0 and remaining<=segment then return jsonb_build_object('x',px+(x-px)*remaining/segment,'y',py+(y-py)*remaining/segment);end if;
  remaining:=remaining-segment;px:=x;py:=y;
 end loop;
 return jsonb_build_object('x',p_army.target_x,'y',p_army.target_y);
end $$;

-- Optional, unique mage tower and the twenty-spell research catalog.
alter table public.peris_city_slots drop constraint if exists peris_city_slots_building_type_check;
alter table public.peris_city_slots add constraint peris_city_slots_building_type_check check(building_type in ('barracks','stables','smithy','warehouse','granary','fishery','mage_tower'));
alter table public.peris_city_slots drop constraint if exists peris_city_slots_level_check;
alter table public.peris_city_slots add constraint peris_city_slots_level_check check(level between 0 and case when building_type='mage_tower' then 10 else 5 end);
create unique index if not exists peris_one_mage_tower on public.peris_city_slots(settlement_id) where building_type='mage_tower';
alter table public.battles add column if not exists mana_attacker integer;
alter table public.battles add column if not exists mana_defender integer;
alter table public.battles add column if not exists spell_ready_attacker numeric not null default 0;
alter table public.battles add column if not exists spell_ready_defender numeric not null default 0;
alter table public.battles add column if not exists last_spell jsonb;
alter table public.battle_formations add column if not exists magic_attack numeric not null default 1 check(magic_attack between 1 and 1.5);
alter table public.battle_formations add column if not exists magic_defence numeric not null default 0 check(magic_defence between 0 and .4);
alter table public.battle_formations add column if not exists magic_speed numeric not null default 1 check(magic_speed between 1 and 1.75);
create table if not exists public.peris_spell_catalog (
 id text primary key,name text not null,school text not null,level integer not null, mana integer not null,target text not null,
 damage integer not null,heal integer not null,morale integer not null,stamina integer not null,attack numeric not null,defence numeric not null,speed numeric not null,radius integer not null,chain integer not null,revive boolean not null
);
insert into public.peris_spell_catalog values
('spark','Spark','Fire',1,5,'enemy',8,0,0,0,0,0,0,0,0,false),
('mend','Mend','Light',1,5,'ally',0,8,0,0,0,0,0,0,0,false),
('ice-bolt','Ice Bolt','Water',2,8,'enemy',12,0,0,-12,0,0,0,0,0,false),
('stone-skin','Stone Skin','Earth',2,8,'ally',0,0,0,0,0,0.2,0,0,0,false),
('lightning','Lightning','Air',3,10,'enemy',18,0,0,0,0,0,0,0,0,false),
('haste','Haste','Air',3,10,'ally',0,0,0,0,0,0,0.25,0,0,false),
('fireball','Fireball','Fire',4,15,'enemy',12,0,0,0,0,0,0,100,0,false),
('bless','Bless','Light',4,12,'ally',0,0,0,0,0.15,0,0,0,0,false),
('terror','Terror','Shadow',5,15,'enemy',0,0,-25,0,0,0,0,0,0,false),
('courage','Courage','Light',5,18,'allies',0,0,12,0,0,0,0,0,0,false),
('chain-lightning','Chain Lightning','Air',6,22,'enemy',18,0,0,0,0,0,0,0,3,false),
('sanctuary','Sanctuary','Light',6,22,'allies',0,12,0,0,0,0,0,0,0,false),
('frost-nova','Frost Nova','Water',7,25,'enemy',12,0,0,-30,0,0,0,120,0,false),
('battle-trance','Battle Trance','Shadow',7,25,'allies',0,0,0,25,0.15,0,0,0,0,false),
('meteor','Meteor','Earth',8,32,'enemy',22,0,0,0,0,0,0,150,0,false),
('resurrection','Resurrection','Light',8,30,'ally',0,25,65,0,0,0,0,0,0,true),
('storm','Storm','Air',9,40,'enemies',18,0,0,0,0,0,0,0,0,false),
('aegis','Aegis','Earth',9,38,'allies',0,0,0,0,0,0.4,0,0,0,false),
('inferno','Inferno','Fire',10,50,'enemies',28,0,-15,0,0,0,0,0,0,false),
('phoenix','Phoenix','Light',10,50,'allies',0,30,80,0,0,0,0,0,0,true)
on conflict(id) do update set name=excluded.name,school=excluded.school,level=excluded.level,mana=excluded.mana,target=excluded.target,damage=excluded.damage,heal=excluded.heal,morale=excluded.morale,stamina=excluded.stamina,attack=excluded.attack,defence=excluded.defence,speed=excluded.speed,radius=excluded.radius,chain=excluded.chain,revive=excluded.revive;
create table if not exists public.peris_spell_research (
 settlement_id bigint not null references public.settlements(id) on delete cascade,
 spell_id text not null references public.peris_spell_catalog(id),researched_at timestamptz not null default now(),primary key(settlement_id,spell_id)
);
alter table public.peris_spell_catalog enable row level security;
alter table public.peris_spell_research enable row level security;
drop policy if exists "spell catalog" on public.peris_spell_catalog;
create policy "spell catalog" on public.peris_spell_catalog for select to authenticated using(true);
drop policy if exists "own researched spells" on public.peris_spell_research;
create policy "own researched spells" on public.peris_spell_research for select to authenticated using(exists(select 1 from public.settlements s where s.id=settlement_id and s.owner_id=auth.uid()));
revoke all on public.peris_spell_catalog,public.peris_spell_research from public,anon,authenticated;
grant select on public.peris_spell_catalog,public.peris_spell_research to authenticated;
create or replace function public.peris_research_spell(p_spell text) returns jsonb language plpgsql security definer set search_path='' as $$
declare u uuid:=auth.uid();s public.settlements%rowtype;sp public.peris_spell_catalog%rowtype;l integer;
begin
 if u is null then raise exception 'Authentication required';end if;
 perform public.peris_settle(u);
 if exists(select 1 from public.battles where status='active' and (attacker_owner_id=u or defender_owner_id=u)) then raise exception 'Finish the current battle first';end if;
 select * into s from public.settlements where owner_id=u for update;
 select * into sp from public.peris_spell_catalog where id=p_spell;
 if s.id is null or sp.id is null then raise exception 'Unknown spell or realm';end if;
 select level into l from public.peris_city_slots where settlement_id=s.id and building_type='mage_tower';
 if coalesce(l,0)<sp.level then raise exception 'Upgrade the mage tower to level %',sp.level;end if;
 if exists(select 1 from public.peris_spell_research where settlement_id=s.id and spell_id=sp.id) then raise exception 'This spell is already researched';end if;
 if s.wood<sp.level*40 or s.stone<sp.level*55 or s.gold<sp.level*70 then raise exception 'Your stores cannot cover this research';end if;
 update public.settlements set wood=wood-sp.level*40,stone=stone-sp.level*55,gold=gold-sp.level*70 where id=s.id;
 insert into public.peris_spell_research(settlement_id,spell_id)values(s.id,sp.id);
 return jsonb_build_object('ok',true);
end $$;
create or replace function public.peris_cast_spell(p_battle_id bigint,p_spell text,p_target bigint default null) returns jsonb language plpgsql security definer set search_path='' as $$
declare u uuid:=auth.uid();b public.battles%rowtype;s public.settlements%rowtype;sp public.peris_spell_catalog%rowtype;f public.battle_formations%rowtype;t public.battle_formations%rowtype;
 own_side text;friend boolean;single_target boolean;l integer;mana integer;ready numeric;idx integer:=0;cas integer;troops integer;mor numeric;alive_a boolean;alive_d boolean;
begin
 select * into b from public.battles where id=p_battle_id for update;
 if u is null or b.id is null or (u is distinct from b.attacker_owner_id and u is distinct from b.defender_owner_id) then raise exception 'Not your battle';end if;
 if b.status<>'active' or b.phase<>'combat' then raise exception 'Spells can only be cast during combat';end if;
 select * into s from public.settlements where owner_id=u;
 select * into sp from public.peris_spell_catalog where id=p_spell;
 select level into l from public.peris_city_slots where settlement_id=s.id and building_type='mage_tower';
 if sp.id is null or coalesce(l,0)<sp.level or not exists(select 1 from public.peris_spell_research where settlement_id=s.id and spell_id=sp.id) then raise exception 'Research this spell in your mage tower first';end if;
 perform public.peris_tick(b.id);
 select * into b from public.battles where id=p_battle_id;
 if b.status<>'active' then return jsonb_build_object('ok',true,'ended',true);end if;
 own_side:=case when b.attacker_owner_id=u then 'attacker' else 'defender' end;
 mana:=coalesce(case when own_side='attacker' then b.mana_attacker else b.mana_defender end,20+l*10);
 ready:=case when own_side='attacker' then b.spell_ready_attacker else b.spell_ready_defender end;
 if b.elapsed<ready then raise exception 'Your mage is recovering';end if;
 if mana<sp.mana then raise exception 'Not enough mana';end if;
 friend:=sp.target in ('ally','allies');single_target:=sp.target in ('ally','enemy');
 if single_target then
 select * into t from public.battle_formations where id=p_target and battle_id=b.id and (side=own_side)=friend and (sp.revive or soldiers>0 and status<>'routed');
 if t.id is null then raise exception 'Choose an eligible formation on the correct side';end if;
 end if;
 for f in select * from public.battle_formations where battle_id=b.id and (side=own_side)=friend and (sp.revive or soldiers>0 and status<>'routed')
 and (not single_target or id=t.id or sp.chain>0 or sp.radius>0 and power(x-t.x,2)+power(y-t.y,2)<=sp.radius*sp.radius)
 order by case when sp.chain>0 then case when id=t.id then -1 else power(x-t.x,2)+power(y-t.y,2) end else id end,id
 limit case when sp.chain>0 then sp.chain else 10000 end for update loop
 cas:=ceil(greatest(0,sp.damage-case when sp.chain>0 then idx*6 else 0 end)*(1-f.magic_defence));idx:=idx+1;
 troops:=greatest(0,least(f.initial_soldiers,f.soldiers-cas+sp.heal));
 mor:=case when sp.revive then greatest(f.morale,sp.morale) else greatest(0,least(100,f.morale+sp.morale)) end;
 update public.battle_formations set soldiers=troops,morale=mor,stamina=greatest(0,least(100,f.stamina+sp.stamina)),
 magic_attack=least(1.5,f.magic_attack+sp.attack),magic_defence=least(.4,f.magic_defence+sp.defence),magic_speed=least(1.75,f.magic_speed+sp.speed),
 status=case when troops=0 or mor<=18 then 'routed' when sp.revive then 'idle' else f.status end,
 target_formation_id=case when sp.revive then null else f.target_formation_id end,
 target_x=case when sp.revive then f.x else f.target_x end,target_y=case when sp.revive then f.y else f.target_y end where id=f.id;
 end loop;
 if idx=0 then raise exception 'No eligible formations';end if;
 update public.battles set mana_attacker=case when own_side='attacker' then mana-sp.mana else mana_attacker end,
 mana_defender=case when own_side='defender' then mana-sp.mana else mana_defender end,
 spell_ready_attacker=case when own_side='attacker' then b.elapsed+8 else spell_ready_attacker end,
 spell_ready_defender=case when own_side='defender' then b.elapsed+8 else spell_ready_defender end,
 last_spell=jsonb_build_object('id',sp.id,'name',sp.name,'owner_id',u,'at',b.elapsed,'target',t.id) where id=b.id;
 select exists(select 1 from public.battle_formations where battle_id=b.id and side='attacker' and soldiers>0 and status<>'routed'),exists(select 1 from public.battle_formations where battle_id=b.id and side='defender' and soldiers>0 and status<>'routed') into alive_a,alive_d;
 if not alive_a or not alive_d then perform public.peris_finish(b.id,case when alive_a then 'attacker' when alive_d then 'defender' else 'draw' end,'Army routed by magic');end if;
 return jsonb_build_object('ok',true);
end $$;
revoke all on function public.peris_research_spell(text),public.peris_cast_spell(bigint,text,bigint) from public,anon,authenticated;
grant execute on function public.peris_research_spell(text),public.peris_cast_spell(bigint,text,bigint) to authenticated;
create or replace function public.peris_settle(p_owner uuid,p_until timestamptz default now()) returns void
language plpgsql security definer set search_path='' as $$
declare s public.settlements%rowtype;o public.peris_orders%rowtype;minutes numeric;l integer;at_time timestamptz;target_slot integer;
begin
 perform 1 from public.players where id=p_owner for update;
 select * into s from public.settlements where owner_id=p_owner for update;
 if s.id is null then return;end if;
 perform public.peris_city_migrate(s.id);
 select * into s from public.settlements where id=s.id;
 for o in select * from public.peris_orders where owner_id=p_owner and finish_at<=p_until order by finish_at,id for update loop
 at_time:=greatest(s.resources_updated_at,o.finish_at);minutes:=greatest(0,extract(epoch from(at_time-s.resources_updated_at)))/60;
 s.wood:=least(s.capacity,s.wood+s.wood_rate*minutes);s.stone:=least(s.capacity,s.stone+s.stone_rate*minutes);
 s.food:=least(s.food_capacity,s.food+s.food_rate*minutes);s.gold:=least(s.capacity,s.gold+s.gold_rate*minutes);
 s.resources_updated_at:=at_time;
 if o.kind='upgrade' then
 if o.item like 'slot:%' then
 target_slot:=split_part(o.item,':',2)::integer;
 update public.peris_city_slots set level=least(case when building_type='mage_tower' then 10 else 5 end,level+1) where settlement_id=s.id and peris_city_slots.slot_index=target_slot;
 s.capacity:=5000+2500*coalesce((select sum(level) from public.peris_city_slots where settlement_id=s.id and building_type='warehouse'),0);
 s.food_capacity:=5000+2500*coalesce((select sum(level) from public.peris_city_slots where settlement_id=s.id and building_type='granary'),0);
 s.food_rate:=18+10*coalesce((select level from public.buildings where settlement_id=s.id and building_type='farm'),0)+8*coalesce((select sum(level) from public.peris_city_slots where settlement_id=s.id and building_type='fishery'),0);
 update public.players set upgrades=upgrades+1 where id=p_owner;
 else
 update public.buildings set level=least(5,level+1),updated_at=o.finish_at where settlement_id=s.id and building_type=o.item returning level into l;
 update public.players set upgrades=upgrades+1 where id=p_owner;
 if o.item='lumber' then s.wood_rate:=14+l*8;elsif o.item='quarry' then s.stone_rate:=12+l*7;
 elsif o.item='farm' then s.food_rate:=18+l*10+8*coalesce((select sum(level) from public.peris_city_slots where settlement_id=s.id and building_type='fishery'),0);elsif o.item='market' then s.gold_rate:=3+l*3;
 elsif o.item='storehouse' then s.capacity:=5000+l*2500;end if;
 end if;
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
 food=least(s.food_capacity,s.food+s.food_rate*minutes),gold=least(s.capacity,s.gold+s.gold_rate*minutes),
 wood_rate=s.wood_rate,stone_rate=s.stone_rate,food_rate=s.food_rate,gold_rate=s.gold_rate,capacity=s.capacity,food_capacity=s.food_capacity,
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
 update public.battle_formations set attack_multiplier=1+least(.6,coalesce((select sum(c.level)*.04 from public.peris_city_slots c join public.settlements s on s.id=c.settlement_id where s.owner_id=p_owner and c.building_type='smithy'),0)) where battle_id=p_battle and owner_id=p_owner;
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
 if p_type is null or p_type not in ('market','wall','lumber','quarry','farm') then raise exception 'Choose a building plot for this building';end if;
 perform public.peris_settle(u);
 if exists(select 1 from public.battles where status='active' and (attacker_owner_id=u or defender_owner_id=u)) then raise exception 'Finish the current battle first';end if;
 select * into s from public.settlements where owner_id=u for update;
 select level into l from public.buildings where settlement_id=s.id and building_type=p_type;
 if l is null then raise exception 'Building not found';end if;
 if l>=5 then raise exception 'Maximum level reached';end if;
 if exists(select 1 from public.peris_orders where owner_id=u and kind='upgrade') then raise exception 'Your builders are already working';end if;
 factor:=power(1.55::numeric,greatest(0,l));
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
 select coalesce(sum(level),0) into l from public.peris_city_slots where settlement_id=s.id and building_type=case when p_type='cavalry' then 'stables' else 'barracks' end;
 if l=0 then raise exception 'Build barracks or stables first';end if;
 select greatest(now(),coalesce(max(finish_at),now())) into at_time from public.peris_orders where owner_id=u and kind='recruit';
 duration:=greatest(5,ceil(p_quantity*case when p_type='cavalry' then 5 else 2 end/(1+(coalesce(l,1)-1)*0.18)));
 update public.settlements set wood=wood-cw,stone=stone-cs,food=food-cf,gold=gold-cg where id=s.id;
 insert into public.peris_orders(owner_id,kind,item,quantity,started_at,finish_at)values(u,'recruit',p_type,p_quantity,at_time,at_time+make_interval(secs=>duration::double precision));
 return jsonb_build_object('ok',true);
end $$;

create or replace function public.peris_march(p_target_x integer,p_target_y integer,p_path jsonb)returns jsonb
language plpgsql security definer set search_path='' as $$
declare u uuid:=auth.uid();a public.armies%rowtype;position jsonb;point jsonb;route jsonb;
 tx integer:=greatest(-12736,least(12736,p_target_x));ty integer:=greatest(-12736,least(12736,p_target_y));
 x numeric;y numeric;px numeric;py numeric;cx integer;cy integer;pcx integer;pcy integer;
 distance numeric:=0;segment numeric;seconds numeric;count_points integer;ordinal integer:=0;
begin
 if u is null then raise exception 'Authentication required';end if;
 if p_target_x is null or p_target_y is null then raise exception 'Choose a destination';end if;
 if p_path is null or jsonb_typeof(p_path)<>'array' then raise exception 'Choose a valid land route';end if;
 count_points:=jsonb_array_length(p_path);
 if count_points<2 or count_points>2000 then raise exception 'A march needs 2-2000 route points';end if;
 perform public.peris_settle(u);
 if exists(select 1 from public.battles where status='active' and (attacker_owner_id=u or defender_owner_id=u)) then raise exception 'Finish the current battle first';end if;
 if exists(select 1 from public.peris_orders where owner_id=u and kind='recruit') then raise exception 'Let training finish before marching';end if;
 select * into a from public.armies where owner_id=u for update;
 if a.id is null then raise exception 'Army not found';end if;
 position:=public.peris_army_position(a);
 px:=(position->>'x')::numeric;py:=(position->>'y')::numeric;
 if not public.peris_world_walkable(px,py) then raise exception 'The army must start on land';end if;
 pcx:=floor(px/128)::integer;pcy:=floor(py/128)::integer;
 route:=jsonb_build_array(jsonb_build_array(px,py));
 for point in select value from jsonb_array_elements(p_path)with ordinality as points(value,sequence)order by sequence loop
  ordinal:=ordinal+1;
  if jsonb_typeof(point)<>'array' then raise exception 'Choose a valid land route';end if;
  if jsonb_array_length(point)<>2 or jsonb_typeof(point->0)<>'number' or jsonb_typeof(point->1)<>'number' then raise exception 'Route points must be numeric coordinate pairs';end if;
  x:=(point->>0)::numeric;y:=(point->>1)::numeric;
  if x<-12800 or x>=12800 or y<-12800 or y>=12800 then raise exception 'Route leaves the world';end if;
  cx:=floor(x/128)::integer;cy:=floor(y/128)::integer;
  if ordinal=1 then
   if abs(cx-pcx)>1 or abs(cy-pcy)>1 then raise exception 'Route does not start at your army';end if;
   continue;
  end if;
  if abs(cx-pcx)>1 or abs(cy-pcy)>1 then raise exception 'Route points must pass through neighboring fields';end if;
  if not public.peris_world_walkable(x,y) then raise exception 'Armies cannot march across the sea';end if;
  if cx<>pcx and cy<>pcy and (not public.peris_world_walkable((cx+.5)*128,(pcy+.5)*128) or not public.peris_world_walkable((pcx+.5)*128,(cy+.5)*128)) then
   raise exception 'A route cannot cut a sea corner';
  end if;
  segment:=sqrt(power(x-px,2)+power(y-py,2));
  if segment=0 and count_points>2 then raise exception 'A route must advance through its fields';end if;
  distance:=distance+segment;route:=route||jsonb_build_array(jsonb_build_array(x,y));
  px:=x;py:=y;pcx:=cx;pcy:=cy;
 end loop;
 if px<>tx or py<>ty then raise exception 'Route must end at the chosen destination';end if;
 seconds:=greatest(2,distance/22);
 update public.armies set start_x=round((position->>'x')::numeric),start_y=round((position->>'y')::numeric),target_x=tx,target_y=ty,
  march_path=route,march_distance=distance,departure_at=now(),arrival_at=now()+make_interval(secs=>seconds::double precision),
  status='moving',raid_target_id=null,updated_at=now() where id=a.id;
 return jsonb_build_object('ok',true);
end $$;
-- Compatibility RPCs and raids still use the straight route. Sample every half
-- field so all traversed cells are validated by the authoritative land marcher.
create or replace function public.move_army(p_target_x integer,p_target_y integer)returns jsonb
language plpgsql security definer set search_path='' as $$
declare u uuid:=auth.uid();a public.armies%rowtype;position jsonb;route jsonb;x numeric;y numeric;
 tx integer:=greatest(-12736,least(12736,p_target_x));ty integer:=greatest(-12736,least(12736,p_target_y));steps integer;i integer;
begin
 if u is null then raise exception 'Authentication required';end if;
 if p_target_x is null or p_target_y is null then raise exception 'Choose a destination';end if;
 perform public.peris_settle(u);
 select * into a from public.armies where owner_id=u for update;
 if a.id is null then raise exception 'Army not found';end if;
 position:=public.peris_army_position(a);x:=(position->>'x')::numeric;y:=(position->>'y')::numeric;
 steps:=greatest(1,ceil(greatest(abs(tx-x),abs(ty-y))/64)::integer);
 route:=jsonb_build_array(jsonb_build_array(x,y));
 for i in 1..steps loop
  route:=route||jsonb_build_array(case when i=steps then jsonb_build_array(tx,ty)else jsonb_build_array(x+(tx-x)*i/steps,y+(ty-y)*i/steps)end);
 end loop;
 return public.peris_march(tx,ty,route);
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
declare u uuid:=auth.uid();b public.battles%rowtype;f public.battle_formations%rowtype;t public.battle_formations%rowtype;k text:=p_order->>'kind';px numeric;py numeric;n integer;i integer:=0;col integer;face numeric;cx numeric;cy numeric;spacing numeric;ang numeric;
begin
 select * into b from public.battles where id=p_battle_id for update;
 if u is null or b.id is null or (u is distinct from b.attacker_owner_id and u is distinct from b.defender_owner_id) then raise exception 'Not your battle';end if;
 if b.status<>'active' then raise exception 'Battle has ended';end if;
 if p_order is null or k is null or k not in ('move','attack','halt','stance','run','fire','width') then raise exception 'Invalid order';end if;
 if jsonb_typeof(p_order->'ids') is distinct from 'array' then raise exception 'Select a formation';end if;
 select count(*) into n from public.battle_formations where battle_id=b.id and owner_id=u and soldiers>0 and status<>'routed'
 and id in(select value::bigint from jsonb_array_elements_text(p_order->'ids'));
 if n<1 then raise exception 'Select a formation that can receive orders';end if;
 select avg(x),avg(y) into cx,cy from public.battle_formations where battle_id=b.id and owner_id=u and soldiers>0 and status<>'routed' and id in(select value::bigint from jsonb_array_elements_text(p_order->'ids'));
 spacing:=least(620.0/greatest(1,n-1),coalesce((p_order->>'columns')::integer,10)*8+24);
 ang:=coalesce((p_order->>'facing')::numeric,0)*pi()/180;
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
 px:=greatest(35,least(1165,(p_order->>'x')::numeric+case when p_order->>'facing' is null then f.x-cx else -sin(ang)*(i-(n-1)/2.0)*spacing end));
 py:=greatest(40,least(660,(p_order->>'y')::numeric+case when p_order->>'facing' is null then f.y-cy else cos(ang)*(i-(n-1)/2.0)*spacing end));
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
 food=least(food_capacity,food+(loot->>'food')::integer),gold=least(capacity,gold+(loot->>'gold')::integer)where owner_id=u;
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
 speed:=(case f.unit_type when 'cavalry' then 76 when 'archers' then 34 else 40 end)*f.magic_speed*(gf->>'speed')::numeric*
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
 damage:=f.damage_pool+f.soldiers*f.attack_multiplier*f.magic_attack*(1-t.magic_defence)*rate*matchup*stance_mult*defence*brace*flank*charge*cover*elevation*melee_arc*difficulty_mult*(0.55+f.stamina/220)*dt;
 if charge>1 then damage:=damage+f.soldiers*0.06*brace*flank*(1-t.magic_defence);end if;
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
 update public.settlements set wood=least(capacity,wood+cw),stone=least(capacity,stone+cs),food=least(food_capacity,food+cf),gold=least(capacity,gold+cg)where owner_id=u;
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
 select sp0.* into sp from public.spawn_points sp0 left join public.settlements s on s.spawn_point_id=sp0.id
 where s.id is null and public.peris_world_walkable(sp0.x,sp0.y)
 order by sp0.id limit 1 for update of sp0 skip locked;
 if sp.id is null then raise exception 'This world has no free settlement sites';end if;
 insert into public.players(id,display_name)values(u,n);
 insert into public.settlements(owner_id,spawn_point_id,name,x,y,wood,stone,food,gold)values(u,sp.id,n||'''s Keep',sp.x,sp.y,1250,1000,1500,500)returning id into sid;
 insert into public.buildings(settlement_id,building_type,level)select sid,t,0 from unnest(array['lumber','quarry','farm','market','barracks','stables','wall','storehouse'])t;
 insert into public.armies(owner_id,home_settlement_id,name,infantry,archers,cavalry,start_x,start_y,target_x,target_y)values(u,sid,'Legio I · The Dawn',120,50,16,sp.x+40,sp.y+30,sp.x+40,sp.y+30);
 return jsonb_build_object('ok',true);
exception when unique_violation then raise exception 'That ruler name is already taken';
end $$;

-- Low-poly city factions and explicit owner-scoped prototype debug controls.
alter table public.settlements add column if not exists faction text not null default 'roman';
alter table public.settlements drop constraint if exists settlements_faction_check;
alter table public.settlements add constraint settlements_faction_check check(faction in ('roman','spartan','persian','egyptian','orc','elf','dwarf','gnome','pandaren','undead','demon'));
create table if not exists public.peris_debug_config(id boolean primary key default true check(id),enabled boolean not null default true);
insert into public.peris_debug_config(id,enabled)values(true,true)on conflict(id)do nothing;
alter table public.peris_debug_config enable row level security;
revoke all on public.peris_debug_config from public,anon,authenticated;
-- This admin-owned flag can disable instant cheats without disabling faction selection.
create or replace function public.peris_set_faction(p_faction text)returns void language plpgsql security definer set search_path='' as $$
declare u uuid:=auth.uid();
begin
 if u is null then raise exception 'Authentication required';end if;
 if p_faction is null or p_faction not in ('roman','spartan','persian','egyptian','orc','elf','dwarf','gnome','pandaren','undead','demon')then raise exception 'Unknown faction';end if;
 update public.settlements set faction=p_faction where owner_id=u;if not found then raise exception 'Settlement missing';end if;
end $$;
create or replace function public.peris_debug_city(p_action text,p_target text default null,p_value integer default null)returns void language plpgsql security definer set search_path='' as $$
declare u uuid:=auth.uid();s public.settlements%rowtype;c public.peris_city_slots%rowtype;b public.buildings%rowtype;target_slot integer;l integer;max_level integer;lost_magic boolean:=false;count_slots integer;
begin
 if u is null then raise exception 'Authentication required';end if;
 if not coalesce((select enabled from public.peris_debug_config where id),false)then raise exception 'Debug tools are disabled';end if;
 perform 1 from public.players where id=u for update;
 select * into s from public.settlements where owner_id=u for update;if s.id is null then raise exception 'Settlement missing';end if;
 if exists(select 1 from public.battles where status='active' and (attacker_owner_id=u or defender_owner_id=u))then raise exception 'Finish the current battle first';end if;
 perform public.peris_settle(u);select * into s from public.settlements where id=s.id;
 if p_action='resources' then
  if p_value is null or p_value not in (0,1000)then raise exception 'Choose fill storage or +1,000 supplies';end if;
  update public.settlements set wood=case when p_value=0 then capacity else least(capacity,wood+1000)end,stone=case when p_value=0 then capacity else least(capacity,stone+1000)end,
   food=case when p_value=0 then food_capacity else least(food_capacity,food+1000)end,gold=case when p_value=0 then capacity else least(capacity,gold+1000)end,resources_updated_at=now() where id=s.id;return;
 elsif p_action='finish' then
  update public.peris_orders set started_at=least(started_at,now()),finish_at=now() where owner_id=u and kind='upgrade';perform public.peris_settle(u);return;
 end if;
 if p_action is null or p_action not in ('demolish','level')then raise exception 'Invalid debug action';end if;
 if p_target ~ '^slot:[0-9]{1,2}$' then
  target_slot:=split_part(p_target,':',2)::integer;select * into c from public.peris_city_slots where settlement_id=s.id and slot_index=target_slot for update;
  if c.settlement_id is null then raise exception 'Select a built building';end if;
  max_level:=case when c.building_type='mage_tower' then 10 else 5 end;
 else
  select * into b from public.buildings where settlement_id=s.id and building_type=p_target for update;if b.id is null then raise exception 'Select a built building';end if;max_level:=5;
 end if;
 l:=case when p_action='demolish' then 0 else p_value end;if l is null or l<0 or l>max_level then raise exception 'Invalid building level';end if;
 if c.settlement_id is not null then
  delete from public.peris_orders where owner_id=u and kind='upgrade' and item='slot:'||c.slot_index||':'||c.building_type;
  if l=0 then delete from public.peris_city_slots where settlement_id=s.id and slot_index=c.slot_index;lost_magic:=c.building_type='mage_tower';
  else update public.peris_city_slots set level=l where settlement_id=s.id and slot_index=c.slot_index;end if;
 else
  update public.buildings set level=l,updated_at=now() where id=b.id;
  delete from public.peris_orders where owner_id=u and kind='upgrade' and item=b.building_type;
  if b.building_type='market' then
   count_slots:=6+2*l;lost_magic:=exists(select 1 from public.peris_city_slots where settlement_id=s.id and slot_index>=count_slots and slot_index<>16 and building_type='mage_tower');
   delete from public.peris_orders o using public.peris_city_slots cs where cs.settlement_id=s.id and cs.slot_index>=count_slots and cs.slot_index<>16 and o.owner_id=u and o.kind='upgrade' and o.item='slot:'||cs.slot_index||':'||cs.building_type;
   delete from public.peris_city_slots where settlement_id=s.id and slot_index>=count_slots and slot_index<>16;
  end if;
 end if;
 if lost_magic then delete from public.peris_spell_research where settlement_id=s.id;end if;
 perform public.peris_city_economy(s.id);
 update public.settlements set wood=least(wood,capacity),stone=least(stone,capacity),food=least(food,food_capacity),gold=least(gold,capacity)where id=s.id;
end $$;
revoke all on function public.peris_set_faction(text),public.peris_debug_city(text,text,integer) from public,anon;
grant execute on function public.peris_set_faction(text),public.peris_debug_city(text,text,integer) to authenticated;
create or replace function public.peris_snapshot()returns jsonb language plpgsql security definer set search_path='' as $$
declare u uuid:=auth.uid();result jsonb;
begin
 if u is null then raise exception 'Authentication required';end if;
 perform public.peris_city_migrate(s.id) from public.settlements s where s.owner_id=u;
 select jsonb_build_object('version',6,'server_now',now(),
 'debug_enabled',coalesce((select enabled from public.peris_debug_config where id),false),
 'map',jsonb_build_object('version',3,'cols',200,'rows',200,'cell_size',128,'seed',98213,
   'total_players',(select count(*) from public.players),'total_settlements',(select count(*) from public.settlements)),
 'players',coalesce((select jsonb_agg(p order by created_at)from public.players p where p.id=u
   or exists(select 1 from public.battles b where (b.attacker_owner_id=u or b.defender_owner_id=u) and (b.attacker_owner_id=p.id or b.defender_owner_id=p.id))
   or exists(select 1 from public.peris_challenges c where c.status='pending' and c.expires_at>now() and (c.attacker_owner_id=u or c.defender_owner_id=u) and (c.attacker_owner_id=p.id or c.defender_owner_id=p.id))),'[]'::jsonb),
 'settlements',coalesce((select jsonb_agg(s order by id)from public.settlements s where s.owner_id=u),'[]'::jsonb),
 'buildings',coalesce((select jsonb_agg(b order by b.id)from public.buildings b join public.settlements s on s.id=b.settlement_id where s.owner_id=u),'[]'::jsonb),
 'spell_research',coalesce((select jsonb_agg(r order by r.spell_id)from public.peris_spell_research r join public.settlements s on s.id=r.settlement_id where s.owner_id=u),'[]'::jsonb),
 'city_slots',coalesce((select jsonb_agg(c order by c.slot_index)from public.peris_city_slots c join public.settlements s on s.id=c.settlement_id where s.owner_id=u),'[]'::jsonb),
 'armies',coalesce((select jsonb_agg(a order by id)from public.armies a where a.owner_id=u),'[]'::jsonb),
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

-- Public strategic visibility is bounded independently of the private campaign
-- snapshot. The caller's own markers remain available outside the viewport.
create or replace function public.peris_map_snapshot(p_min_x integer,p_min_y integer,p_max_x integer,p_max_y integer)
returns jsonb language plpgsql security definer set search_path='' as $$
declare u uuid:=auth.uid();min_x integer;min_y integer;max_x integer;max_y integer;result jsonb;
begin
 if u is null then raise exception 'Authentication required';end if;
 if p_min_x is null or p_min_y is null or p_max_x is null or p_max_y is null then raise exception 'Choose map bounds';end if;
 min_x:=greatest(-12800,p_min_x);min_y:=greatest(-12800,p_min_y);
 max_x:=least(12800,p_max_x);max_y:=least(12800,p_max_y);
 if min_x>=max_x or min_y>=max_y then raise exception 'Choose valid map bounds';end if;
 with visible_settlements as (
   select s.id,s.owner_id,s.name,s.x,s.y,s.faction from public.settlements s where s.owner_id=u
   union all
   select * from (select s.id,s.owner_id,s.name,s.x,s.y,s.faction from public.settlements s
     where s.owner_id<>u and s.x>=min_x and s.x<max_x and s.y>=min_y and s.y<max_y order by s.id limit 600) nearby
 ), army_positions as (
   select a.*,
     (travel.position->>'x')::numeric as map_x,
     (travel.position->>'y')::numeric as map_y
   from public.armies a cross join lateral (
     select public.peris_army_position(a) as position
   ) travel
   where a.owner_id=u or a.status='moving'
     or (a.target_x>=min_x and a.target_x<max_x and a.target_y>=min_y and a.target_y<max_y)
 ), visible_armies as (
   select a.* from army_positions a where a.owner_id=u
   union all
   select * from (select a.* from army_positions a where a.owner_id<>u
     and a.map_x>=min_x and a.map_x<max_x and a.map_y>=min_y and a.map_y<max_y order by a.id limit 600) nearby
 ), visible_owners as (
   select owner_id from visible_settlements union select owner_id from visible_armies union select u
 )
 select jsonb_build_object('server_now',now(),
   'players',coalesce((select jsonb_agg(jsonb_build_object('id',p.id,'display_name',p.display_name) order by p.id)
     from public.players p join visible_owners o on o.owner_id=p.id),'[]'::jsonb),
   'settlements',coalesce((select jsonb_agg(s order by s.id) from visible_settlements s),'[]'::jsonb),
   'armies',coalesce((select jsonb_agg(to_jsonb(a)-'map_x'-'map_y' order by a.id) from visible_armies a),'[]'::jsonb),
   'total_players',(select count(*) from public.players),'total_settlements',(select count(*) from public.settlements),
   'settlements_truncated',(select count(*)>600 from public.settlements s where s.owner_id<>u and s.x>=min_x and s.x<max_x and s.y>=min_y and s.y<max_y),
   'armies_truncated',(select count(*)>600 from army_positions a where a.owner_id<>u and a.map_x>=min_x and a.map_x<max_x and a.map_y>=min_y and a.map_y<max_y)) into result;
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
grant execute on function public.peris_set_faction(text),public.peris_debug_city(text,text,integer),public.peris_snapshot(),public.peris_map_snapshot(integer,integer,integer,integer),public.peris_march(integer,integer,jsonb),public.peris_queue_upgrade(text),public.peris_queue_slot(integer,text),public.peris_research_spell(text),public.peris_cast_spell(bigint,text,bigint),public.peris_queue_recruit(text,integer),public.peris_raid(integer),public.peris_ready(bigint),
 public.peris_order(bigint,jsonb),public.peris_tick(bigint),public.peris_rally(bigint),public.peris_challenge(uuid),public.peris_respond(bigint,boolean),public.peris_claim(text),public.peris_rename(text)to authenticated;

do $$declare t text;begin
 foreach t in array array['peris_orders','peris_reports','peris_challenges']loop
 begin execute format('alter publication supabase_realtime add table public.%I',t);exception when duplicate_object then null;end;
 end loop;
end $$;

commit;
