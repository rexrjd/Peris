-- PERIS V15 fresh installation. ONLY for an EMPTY Supabase project.
-- Existing world: use UPGRADE_TO_V15.sql. This file refuses existing players.
begin;
do $$ declare occupied boolean;begin
 if to_regclass('public.players') is not null then
 execute 'select exists(select 1 from public.players)' into occupied;
 if occupied then raise exception 'A Peris campaign already exists. Use UPGRADE_TO_V15.sql to preserve it.';end if;
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
drop table if exists public.peris_account_sessions cascade;
drop table if exists public.peris_account_creations cascade;
drop table if exists public.peris_account_activity cascade;
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

-- PERIS v15 · Account directory and race selection. Run the complete generated file in Supabase SQL Editor.
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
insert into public.peris_camps(id,name,x,y,tier,terrain,infantry,archers,cavalry,description) values
 (1,'The broken standard',305,405,1,'plains',48,18,0,'Deserters have claimed the old crossroads. An ideal first campaign.'),
 (2,'Oakwood raiders',460,155,4,'woods',90,45,12,'Bowmen hide beneath dense oak cover. Keep your cavalry out of the trees.'),
 (3,'The river watch',655,485,4,'river',100,40,15,'A fortified crossing. The shallows slow troops; use the stone bridge.'),
 (4,'Highland warband',790,160,6,'highlands',160,70,24,'Veteran spearmen defend the ridge. High ground favours their archers.'),
 (5,'Ashen legion',910,550,8,'plains',240,110,55,'A rebel legion controls the eastern road. You will need a larger host.'),
 (6,'The fallen capital',605,280,10,'highlands',340,160,80,'Break the last great host and restore the lost province of Peris.')
on conflict(id) do update set name=excluded.name,x=excluded.x,y=excluded.y,tier=excluded.tier,terrain=excluded.terrain,
 description=excluded.description;

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
-- One backend is one world. Operational/security/audit clocks remain real UTC.
create table if not exists public.peris_world_clock(
 id boolean primary key default true check(id),
 version integer not null default 1 check(version=1),
 rate integer not null default 1 check(rate in(1,10,100)),
 profile_id text not null default 'normal-v1' check(profile_id in('normal-v1','accelerated-test-v1')),
 real_anchor timestamptz not null,game_anchor timestamptz not null,
 check(profile_id<>'normal-v1'or rate=1)
);
insert into public.peris_world_clock(id,real_anchor,game_anchor)values(true,now(),now())on conflict(id)do nothing;
alter table public.peris_world_clock enable row level security;
revoke all on public.peris_world_clock from public,anon,authenticated;

create or replace function public.peris_game_now()returns timestamptz
language sql stable security definer set search_path='' as $$
 select game_anchor+(now()-real_anchor)*rate from public.peris_world_clock where id
$$;
create or replace function public.peris_clock_snapshot()returns jsonb
language sql stable security definer set search_path='' as $$
 select jsonb_build_object('version',version,'rate',rate,'profile_id',profile_id,'real_now',now(),'game_now',public.peris_game_now())from public.peris_world_clock where id
$$;
-- Private operator setup, only before the first account in a disposable backend.
create or replace function public.peris_configure_test_clock(p_rate integer)returns void
language plpgsql security definer set search_path='' as $$
begin
 if p_rate is null or p_rate not in(1,10,100)then raise exception 'Invalid test clock rate';end if;
 perform pg_advisory_xact_lock(204200);
 if exists(select 1 from public.players)then raise exception 'Test clock configuration requires an empty world';end if;
 update public.peris_world_clock set rate=p_rate,profile_id='accelerated-test-v1',real_anchor=now(),game_anchor=now()where id;
end $$;
revoke all on function public.peris_game_now(),public.peris_clock_snapshot(),public.peris_configure_test_clock(integer)from public,anon,authenticated;
-- Core tables exist before this module, including on legacy upgrades.
-- Defaults affect new rows only; accepted dates and balances are untouched.
alter table public.armies alter column departure_at set default public.peris_game_now();
alter table public.armies alter column arrival_at set default public.peris_game_now();
alter table public.battles alter column started_at set default public.peris_game_now();
alter table public.battles alter column last_tick_at set default public.peris_game_now();
alter table public.settlements alter column resources_updated_at set default public.peris_game_now();
alter table public.peris_challenges alter column expires_at set default public.peris_game_now()+interval '90 seconds';
-- City ruins columns must exist before SQL-language helpers such as
-- peris_station_owned() are defined. The later city/ruins.sql repeats these
-- idempotent additions so UPGRADE_CITY_RUINS.sql remains self-contained.
-- Preserve existing settlements and players; no backfill or data rewrite.
alter table public.settlements add column if not exists ruined_at timestamptz;
alter table public.players add column if not exists defeated_at timestamptz;
-- A ruler survives the anonymous browser identity that first created it.
-- Preserve every existing player UUID and all gameplay foreign keys.
do $$declare constraint_name text;begin
 for constraint_name in select conname from pg_constraint
  where conrelid='public.players'::regclass and contype='f' and confrelid='auth.users'::regclass
 loop execute format('alter table public.players drop constraint %I',constraint_name);end loop;
end $$;
create table if not exists public.peris_account_sessions(
 auth_id uuid primary key references auth.users(id) on delete cascade,
 player_id uuid not null references public.players(id) on delete cascade,
 created_at timestamptz not null default now()
);
create index if not exists peris_account_sessions_player on public.peris_account_sessions(player_id);
alter table public.peris_account_sessions enable row level security;
revoke all on public.peris_account_sessions from public,anon,authenticated;

-- Legacy sessions keep their original ruler. New sessions resolve to the ruler
-- explicitly selected by name; clients cannot read or write these bindings.
create or replace function public.peris_player_id()returns uuid
language sql stable security definer set search_path='' as $$
 select coalesce((select player_id from public.peris_account_sessions where auth_id=auth.uid()),auth.uid())
$$;

-- Preserve the existing realm; permit additional independently owned cities/armies.
alter table public.settlements drop constraint if exists settlements_owner_id_key;
alter table public.armies drop constraint if exists armies_owner_id_key;
alter table public.settlements alter column spawn_point_id drop not null;
alter table public.settlements add column if not exists settlers integer not null default 0 check(settlers between 0 and 6);
alter table public.settlements add column if not exists development_points integer not null default 0;
alter table public.players add column if not exists culture_points numeric not null default 0 check(culture_points between 0 and 1000000000);
alter table public.players add column if not exists culture_updated_at timestamptz not null default public.peris_game_now();
alter table public.players alter column culture_updated_at set default public.peris_game_now();
alter table public.peris_orders add column if not exists settlement_id bigint references public.settlements(id) on delete cascade;
alter table public.peris_orders add column if not exists army_id bigint references public.armies(id) on delete cascade;
alter table public.peris_orders add column if not exists recruit_destination text not null default 'legion';
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
 if requested is null then select min(id)into result from public.settlements where owner_id=p_owner and ruined_at is null;
 else select id into result from public.settlements where owner_id=p_owner and id=requested and ruined_at is null;end if;
 if result is null then raise exception 'Choose one of your cities';end if;return result;
end $$;
create or replace function public.peris_army_id(p_owner uuid)returns bigint language plpgsql security definer set search_path='' as $$
declare requested bigint:=nullif(current_setting('peris.army_id',true),'')::bigint;result bigint;
begin
 if exists(select 1 from public.players where id=p_owner and defeated_at is not null)then raise exception 'This ruler has been defeated';end if;
 if requested is null then select min(id)into result from public.armies where owner_id=p_owner;
 else select id into result from public.armies where owner_id=p_owner and id=requested;end if;
 if result is null then raise exception 'Choose one of your armies';end if;return result;
end $$;
create or replace function public.peris_scope_order()returns trigger language plpgsql security definer set search_path='' as $$
begin
 new.settlement_id:=coalesce(new.settlement_id,public.peris_city_id(new.owner_id));
 if not exists(select 1 from public.settlements where id=new.settlement_id and owner_id=new.owner_id and ruined_at is null)then raise exception 'Order city ownership mismatch';end if;
 if new.kind='recruit' and coalesce(new.recruit_destination,'legion')<>'garrison' then
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
 execute format('create policy "own gameplay data" on public.%I for select to authenticated using(owner_id=public.peris_player_id())',t);
 end loop;
end $$;
alter table public.peris_artifact_catalog enable row level security;
revoke all on public.peris_artifact_catalog from public,anon,authenticated;
grant select on public.peris_artifact_catalog to authenticated;
drop policy if exists "artifact catalogue" on public.peris_artifact_catalog;
create policy "artifact catalogue" on public.peris_artifact_catalog for select to authenticated using(true);
-- V19 social state is separate from private campaign and public map snapshots.
create table if not exists public.peris_guilds(
 id uuid primary key default gen_random_uuid(), name text not null check(length(btrim(name)) between 3 and 32),
 tag text not null check(tag~'^[A-Z0-9]{2,5}$'), description text not null default '' check(length(description)<=1200),
 motd text not null default '' check(length(motd)<=800), leader_id uuid not null references public.players(id),
 recruitment text not null default 'application' check(recruitment in('open','application','invite')),
 focus text not null default 'balanced' check(focus in('balanced','warfare','economy','adventure')),
 crest jsonb not null default '{"color":"#637da3","sigil":"sun"}',
 treasury bigint not null default 0 check(treasury>=0), created_at timestamptz not null default now()
);
create unique index if not exists peris_guild_name_unique on public.peris_guilds(lower(name));
create unique index if not exists peris_guild_tag_unique on public.peris_guilds(lower(tag));
create table if not exists public.peris_guild_roles(
 id uuid primary key default gen_random_uuid(), guild_id uuid not null references public.peris_guilds(id) on delete cascade,
 key text not null, name text not null check(length(btrim(name)) between 2 and 24), rank integer not null check(rank between 1 and 100),
 permissions jsonb not null default '[]', unique(guild_id,key), unique(guild_id,id)
);
create table if not exists public.peris_guild_members(
 player_id uuid primary key references public.players(id) on delete cascade,
 guild_id uuid not null references public.peris_guilds(id) on delete cascade, role_id uuid not null,
 joined_at timestamptz not null default now(), last_read_id bigint not null default 0,
 specialization text not null default 'balanced' check(specialization in('balanced','offense','defense','economy')),
 foreign key(guild_id,role_id) references public.peris_guild_roles(guild_id,id)
);
create index if not exists peris_guild_members_guild on public.peris_guild_members(guild_id);
create table if not exists public.peris_guild_invitations(
 id uuid primary key default gen_random_uuid(), guild_id uuid not null references public.peris_guilds(id) on delete cascade,
 player_id uuid not null references public.players(id) on delete cascade, invited_by uuid not null references public.players(id),
 created_at timestamptz not null default now(), expires_at timestamptz not null default now()+interval '7 days',
 status text not null default 'pending' check(status in('pending','accepted','declined','cancelled'))
);
create unique index if not exists peris_guild_invite_pending on public.peris_guild_invitations(guild_id,player_id)where status='pending';
create table if not exists public.peris_guild_applications(
 id uuid primary key default gen_random_uuid(), guild_id uuid not null references public.peris_guilds(id) on delete cascade,
 player_id uuid not null references public.players(id) on delete cascade, body text not null default '' check(length(body)<=800),
 created_at timestamptz not null default now(), status text not null default 'pending' check(status in('pending','accepted','declined','cancelled'))
);
create unique index if not exists peris_guild_application_pending on public.peris_guild_applications(guild_id,player_id)where status='pending';
create table if not exists public.peris_guild_relations(
 id uuid primary key default gen_random_uuid(), left_id uuid not null references public.peris_guilds(id) on delete cascade,
 right_id uuid not null references public.peris_guilds(id) on delete cascade, proposer_id uuid not null references public.peris_guilds(id) on delete cascade,
 kind text not null check(kind in('alliance','nap','war')), status text not null check(status in('pending','active')),
 created_at timestamptz not null default now(), check(left_id<right_id), check(proposer_id in(left_id,right_id)), unique(left_id,right_id)
);
create table if not exists public.peris_guild_log(
 id bigint generated by default as identity primary key, guild_id uuid not null references public.peris_guilds(id) on delete cascade,
 text text not null, created_at timestamptz not null default now()
);
create index if not exists peris_guild_log_recent on public.peris_guild_log(guild_id,id desc);
create table if not exists public.peris_guild_ledger(
 id bigint generated by default as identity primary key, guild_id uuid not null references public.peris_guilds(id) on delete cascade,
 player_id uuid references public.players(id) on delete set null, player_name text not null, amount bigint not null, created_at timestamptz not null default now()
);
create index if not exists peris_guild_ledger_recent on public.peris_guild_ledger(guild_id,id desc);
create table if not exists public.peris_message_threads(
 id uuid primary key default gen_random_uuid(), player_a uuid not null references public.players(id) on delete cascade,
 player_b uuid not null references public.players(id) on delete cascade, created_at timestamptz not null default now(),
 check(player_a<player_b), unique(player_a,player_b)
);
create index if not exists peris_message_threads_a on public.peris_message_threads(player_a,id);
create index if not exists peris_message_threads_b on public.peris_message_threads(player_b,id);
create table if not exists public.peris_messages(
 id bigint generated by default as identity primary key,
 thread_id uuid references public.peris_message_threads(id) on delete cascade,
 guild_id uuid references public.peris_guilds(id) on delete cascade,
 sender_id uuid references public.players(id) on delete set null, sender_name text not null,
 kind text not null default 'message' check(kind in('message','announcement')), body text not null check(length(btrim(body)) between 1 and 2000),
 created_at timestamptz not null default now(), check((thread_id is null)<>(guild_id is null)), check(kind<>'announcement' or guild_id is not null)
);
create index if not exists peris_messages_direct_recent on public.peris_messages(thread_id,id desc)where thread_id is not null;
create index if not exists peris_messages_guild_recent on public.peris_messages(guild_id,id desc)where guild_id is not null;
create index if not exists peris_messages_sender_recent on public.peris_messages(sender_id,created_at desc);
create table if not exists public.peris_message_reads(
 owner_id uuid not null references public.players(id) on delete cascade, thread_id uuid not null references public.peris_message_threads(id) on delete cascade,
 last_read_id bigint not null default 0, archived boolean not null default false, primary key(owner_id,thread_id)
);
create table if not exists public.peris_message_blocks(
 owner_id uuid not null references public.players(id) on delete cascade, player_id uuid not null references public.players(id) on delete cascade,
 primary key(owner_id,player_id), check(owner_id<>player_id)
);
create table if not exists public.peris_social_receipts(
 owner_id uuid not null references public.players(id) on delete cascade, request_id uuid not null,
 command jsonb not null, result jsonb not null, created_at timestamptz not null default now(), primary key(owner_id,request_id)
);
do $$declare t text;begin
 foreach t in array array['peris_guilds','peris_guild_roles','peris_guild_members','peris_guild_invitations','peris_guild_applications','peris_guild_relations','peris_guild_log','peris_guild_ledger','peris_message_threads','peris_messages','peris_message_reads','peris_message_blocks','peris_social_receipts']loop
  execute format('alter table public.%I enable row level security',t);
  execute format('revoke all on public.%I from public,anon,authenticated',t);
 end loop;
end $$;
-- All social reads/mutations use bounded, ownership-checked RPCs. No client can
-- select the raw message table, rewrite permissions, or impersonate a sender.
create or replace function public.peris_social_relation(p_a uuid,p_b uuid)returns text
language sql stable security definer set search_path='' as $$
 select coalesce((select case when a.guild_id=b.guild_id then 'guild' else r.kind end
 from public.peris_guild_members a join public.peris_guild_members b on b.player_id=p_b
 left join public.peris_guild_relations r on r.left_id=least(a.guild_id,b.guild_id)and r.right_id=greatest(a.guild_id,b.guild_id)and r.status='active'
 where a.player_id=p_a),'neutral')
$$;
create or replace function public.peris_guild_permission(p_player uuid,p_guild uuid,p_permission text)returns boolean
language sql stable security definer set search_path='' as $$
 select exists(select 1 from public.peris_guild_members m join public.peris_guild_roles r on r.id=m.role_id
 where m.player_id=p_player and m.guild_id=p_guild and r.permissions ? p_permission)
$$;

-- Generated from heroes/domain/artifacts.ts. Keep catalog stats and loot pools identical.
insert into public.peris_artifact_catalog(id,name,slot,attack,defence,power,knowledge,speed)values
('iron_sword','Iron oath','weapon',2,0,0,0,0),
('oak_staff','Staff of embers','weapon',0,0,2,0,0),
('chainmail','Guardian mail','armour',0,2,0,0,0),
('circlet','Scholar’s circlet','head',0,0,0,2,0),
('boots','Wayfarer’s boots','boots',0,0,0,0,0.15),
('talisman','Amber talisman','charm',0,0,1,1,0),
('warblade','Dawnblade','weapon',4,0,0,0,0),
('runestaff','Staff of the archmage','weapon',0,0,4,0,0),
('plate','Crownforged plate','armour',0,4,0,0,0),
('warhelm','Helm of command','head',2,1,0,0,0),
('windboots','Windwalkers','boots',0,0,0,0,0.25),
('runic_amulet','Runic amulet','charm',0,0,2,2,0),
('sunblade','Sunfire edge','weapon',6,1,0,0,0),
('astral_staff','Astral staff','weapon',0,0,6,1,0),
('phoenix_mail','Phoenix mantle','armour',0,6,1,0,0),
('oracle_crown','Oracle’s crown','head',0,0,2,4,0),
('stormstride','Stormstriders','boots',0,1,0,0,0.35),
('moonstone_heart','Heart of the moon','charm',0,0,3,3,0),
('lionheart_blade','Lionheart','weapon',8,2,0,0,0),
('celestial_staff','Celestial spire','weapon',0,0,8,2,0),
('aegis_plate','Aegis of the dawn','armour',2,8,0,0,0),
('sovereign_crown','Sovereign’s crown','head',2,2,0,6,0),
('horizon_boots','Horizon treads','boots',0,0,0,2,0.45),
('crown_seal','Seal of the lost crown','charm',2,2,2,2,0)
on conflict(id)do update set name=excluded.name,slot=excluded.slot,attack=excluded.attack,defence=excluded.defence,power=excluded.power,knowledge=excluded.knowledge,speed=excluded.speed;

create or replace function public.peris_npc_artifact(p_tier integer,p_camp integer,p_battle bigint)returns text
language sql immutable set search_path='' as $$
 select pool[1+mod(abs(mod(p_battle,1000003))*17+abs(p_camp::bigint)*31,array_length(pool,1))::integer]
 from(select case when p_tier>=9 then array['lionheart_blade','celestial_staff','aegis_plate','sovereign_crown','horizon_boots','crown_seal'] when p_tier>=6 then array['sunblade','astral_staff','phoenix_mail','oracle_crown','stormstride','moonstone_heart'] when p_tier>=3 then array['warblade','runestaff','plate','warhelm','windboots','runic_amulet'] else array['iron_sword','oak_staff','chainmail','circlet','boots','talisman'] end pool)roll
$$;
-- Private account-wide research. Existing campaigns and accepted orders are retained.
create table if not exists public.peris_technology_catalog(
 id text primary key,name text not null,branch text not null,era integer not null,
 faction text,cost integer not null check(cost>0),seconds integer not null check(seconds>0),
 prerequisites jsonb not null,effects jsonb not null,metadata jsonb not null
);
create table if not exists public.peris_account_science(
 owner_id uuid primary key references public.players(id)on delete cascade,
 points numeric not null default 75 check(points between 0 and 1000000000),
 updated_at timestamptz not null default public.peris_game_now(),active_id text references public.peris_technology_catalog(id),
 active_since timestamptz,active_rate numeric not null default 1 check(active_rate between 1 and 4),
 check((active_id is null)=(active_since is null))
);
alter table public.peris_account_science alter column updated_at set default public.peris_game_now();
create table if not exists public.peris_research_progress(
 owner_id uuid not null references public.players(id)on delete cascade,
 technology_id text not null references public.peris_technology_catalog(id),
 seconds numeric not null default 0 check(seconds>=0),completed_at timestamptz,
 primary key(owner_id,technology_id)
);
alter table public.peris_account_science enable row level security;
alter table public.peris_research_progress enable row level security;
revoke all on public.peris_technology_catalog,public.peris_account_science,public.peris_research_progress from public,anon,authenticated;
grant select on public.peris_account_science,public.peris_research_progress to authenticated;
drop policy if exists "own science" on public.peris_account_science;
create policy "own science" on public.peris_account_science for select to authenticated using(owner_id=public.peris_player_id());
drop policy if exists "own technology progress" on public.peris_research_progress;
create policy "own technology progress" on public.peris_research_progress for select to authenticated using(owner_id=public.peris_player_id());
create or replace function public.peris_research_bonus(p_owner uuid,p_key text)returns numeric language sql stable security definer set search_path='' as $$
 select least(3,coalesce(sum((c.effects->>p_key)::numeric),0))from public.peris_research_progress p join public.peris_technology_catalog c on c.id=p.technology_id
 where p.owner_id=p_owner and p.completed_at is not null and (c.faction is null or c.faction=coalesce((select faction from public.settlements where owner_id=p_owner order by id limit 1),'roman'))
$$;
create or replace function public.peris_research_factor(p_owner uuid,p_key text)returns numeric language sql stable security definer set search_path='' as $$select 1+public.peris_research_bonus(p_owner,p_key)$$;
alter table public.settlements add column if not exists wood_research numeric not null default 1;
alter table public.settlements add column if not exists stone_research numeric not null default 1;
alter table public.settlements add column if not exists food_research numeric not null default 1;
alter table public.settlements add column if not exists gold_research numeric not null default 1;
alter table public.settlements add column if not exists trade_research numeric not null default 1;
-- Generated from the shared technology catalog. Do not hand edit.
insert into public.peris_technology_catalog(id,name,branch,era,faction,cost,seconds,prerequisites,effects,metadata)values
('drill-grounds','Drill Grounds','warfare',0,null,35,30,'[]'::jsonb,'{"training":0.05}'::jsonb,'{"id":"drill-grounds","name":"Drill Grounds","branch":"warfare","era":0,"stage":0,"lane":0,"faction":null,"cost":35,"seconds":30,"requires":[],"effects":{"training":0.05},"atlas":"warfare","art_index":0,"description":"Drill Grounds develops your empire’s warfare. This discovery benefits every owned city and army."}'::jsonb),
('spear-formations','Spear Formations','warfare',0,null,42,36,'["drill-grounds"]'::jsonb,'{"unlock_spearmen":1}'::jsonb,'{"id":"spear-formations","name":"Spear Formations","branch":"warfare","era":0,"stage":1,"lane":0,"faction":null,"cost":42,"seconds":36,"requires":["drill-grounds"],"effects":{"unlock_spearmen":1},"atlas":"warfare","art_index":1,"description":"Spear Formations develops your empire’s warfare. This discovery benefits every owned city and army."}'::jsonb),
('shieldcraft','Shieldcraft','warfare',1,null,90,90,'["spear-formations"]'::jsonb,'{"infantry_defence":0.05}'::jsonb,'{"id":"shieldcraft","name":"Shieldcraft","branch":"warfare","era":1,"stage":2,"lane":0,"faction":null,"cost":90,"seconds":90,"requires":["spear-formations"],"effects":{"infantry_defence":0.05},"atlas":"warfare","art_index":2,"description":"Shieldcraft develops your empire’s warfare. This discovery benefits every owned city and army."}'::jsonb),
('bronze-forging','Bronze Forging','warfare',1,null,108,108,'["shieldcraft"]'::jsonb,'{"infantry_attack":0.05}'::jsonb,'{"id":"bronze-forging","name":"Bronze Forging","branch":"warfare","era":1,"stage":3,"lane":0,"faction":null,"cost":108,"seconds":108,"requires":["shieldcraft"],"effects":{"infantry_attack":0.05},"atlas":"warfare","art_index":3,"description":"Bronze Forging develops your empire’s warfare. This discovery benefits every owned city and army."}'::jsonb),
('professional-soldiers','Professional Soldiers','warfare',2,null,220,240,'["bronze-forging","libraries"]'::jsonb,'{"unlock_elite":1}'::jsonb,'{"id":"professional-soldiers","name":"Professional Soldiers","branch":"warfare","era":2,"stage":4,"lane":0,"faction":null,"cost":220,"seconds":240,"requires":["bronze-forging","libraries"],"effects":{"unlock_elite":1},"atlas":"warfare","art_index":4,"description":"Professional Soldiers develops your empire’s warfare. This discovery benefits every owned city and army."}'::jsonb),
('iron-forging','Iron Forging','warfare',2,null,264,288,'["professional-soldiers"]'::jsonb,'{"attack":0.08}'::jsonb,'{"id":"iron-forging","name":"Iron Forging","branch":"warfare","era":2,"stage":5,"lane":0,"faction":null,"cost":264,"seconds":288,"requires":["professional-soldiers"],"effects":{"attack":0.08},"atlas":"warfare","art_index":5,"description":"Iron Forging develops your empire’s warfare. This discovery benefits every owned city and army."}'::jsonb),
('steel-shields','Steel Shields','warfare',3,null,500,480,'["iron-forging"]'::jsonb,'{"defence":0.08}'::jsonb,'{"id":"steel-shields","name":"Steel Shields","branch":"warfare","era":3,"stage":6,"lane":0,"faction":null,"cost":500,"seconds":480,"requires":["iron-forging"],"effects":{"defence":0.08},"atlas":"warfare","art_index":6,"description":"Steel Shields develops your empire’s warfare. This discovery benefits every owned city and army."}'::jsonb),
('officer-school','Officer School','warfare',3,null,600,576,'["steel-shields"]'::jsonb,'{"training":0.08}'::jsonb,'{"id":"officer-school","name":"Officer School","branch":"warfare","era":3,"stage":7,"lane":0,"faction":null,"cost":600,"seconds":576,"requires":["steel-shields"],"effects":{"training":0.08},"atlas":"warfare","art_index":7,"description":"Officer School develops your empire’s warfare. This discovery benefits every owned city and army."}'::jsonb),
('combined-arms','Combined Arms','warfare',4,null,1000,850,'["officer-school","philosophy"]'::jsonb,'{"attack":0.1}'::jsonb,'{"id":"combined-arms","name":"Combined Arms","branch":"warfare","era":4,"stage":8,"lane":0,"faction":null,"cost":1000,"seconds":850,"requires":["officer-school","philosophy"],"effects":{"attack":0.1},"atlas":"warfare","art_index":8,"description":"Combined Arms develops your empire’s warfare. This discovery benefits every owned city and army."}'::jsonb),
('veteran-guard','Veteran Guard','warfare',4,null,1200,1020,'["combined-arms"]'::jsonb,'{"infantry_defence":0.1}'::jsonb,'{"id":"veteran-guard","name":"Veteran Guard","branch":"warfare","era":4,"stage":9,"lane":0,"faction":null,"cost":1200,"seconds":1020,"requires":["combined-arms"],"effects":{"infantry_defence":0.1},"atlas":"warfare","art_index":9,"description":"Veteran Guard develops your empire’s warfare. This discovery benefits every owned city and army."}'::jsonb),
('bowcraft','Bowcraft','archery',0,null,35,30,'[]'::jsonb,'{"archers_attack":0.05}'::jsonb,'{"id":"bowcraft","name":"Bowcraft","branch":"archery","era":0,"stage":0,"lane":1,"faction":null,"cost":35,"seconds":30,"requires":[],"effects":{"archers_attack":0.05},"atlas":"archery","art_index":0,"description":"Bowcraft develops your empire’s archery. This discovery benefits every owned city and army."}'::jsonb),
('fletching','Fletching','archery',0,null,42,36,'["bowcraft"]'::jsonb,'{"training":0.05}'::jsonb,'{"id":"fletching","name":"Fletching","branch":"archery","era":0,"stage":1,"lane":1,"faction":null,"cost":42,"seconds":36,"requires":["bowcraft"],"effects":{"training":0.05},"atlas":"archery","art_index":1,"description":"Fletching develops your empire’s archery. This discovery benefits every owned city and army."}'::jsonb),
('target-practice','Target Practice','archery',1,null,90,90,'["fletching"]'::jsonb,'{"archers_defence":0.05}'::jsonb,'{"id":"target-practice","name":"Target Practice","branch":"archery","era":1,"stage":2,"lane":1,"faction":null,"cost":90,"seconds":90,"requires":["fletching"],"effects":{"archers_defence":0.05},"atlas":"archery","art_index":2,"description":"Target Practice develops your empire’s archery. This discovery benefits every owned city and army."}'::jsonb),
('composite-bows','Composite Bows','archery',1,null,108,108,'["target-practice"]'::jsonb,'{"archers_attack":0.05}'::jsonb,'{"id":"composite-bows","name":"Composite Bows","branch":"archery","era":1,"stage":3,"lane":1,"faction":null,"cost":108,"seconds":108,"requires":["target-practice"],"effects":{"archers_attack":0.05},"atlas":"archery","art_index":3,"description":"Composite Bows develops your empire’s archery. This discovery benefits every owned city and army."}'::jsonb),
('range-finding','Range Finding','archery',2,null,220,240,'["composite-bows","libraries"]'::jsonb,'{"archers_attack":0.08}'::jsonb,'{"id":"range-finding","name":"Range Finding","branch":"archery","era":2,"stage":4,"lane":1,"faction":null,"cost":220,"seconds":240,"requires":["composite-bows","libraries"],"effects":{"archers_attack":0.08},"atlas":"archery","art_index":4,"description":"Range Finding develops your empire’s archery. This discovery benefits every owned city and army."}'::jsonb),
('siege-arrows','Siege Arrows','archery',2,null,264,288,'["range-finding"]'::jsonb,'{"siege":0.08}'::jsonb,'{"id":"siege-arrows","name":"Siege Arrows","branch":"archery","era":2,"stage":5,"lane":1,"faction":null,"cost":264,"seconds":288,"requires":["range-finding"],"effects":{"siege":0.08},"atlas":"archery","art_index":5,"description":"Siege Arrows develops your empire’s archery. This discovery benefits every owned city and army."}'::jsonb),
('longbows','Longbows','archery',3,null,500,480,'["siege-arrows"]'::jsonb,'{"archers_attack":0.08}'::jsonb,'{"id":"longbows","name":"Longbows","branch":"archery","era":3,"stage":6,"lane":1,"faction":null,"cost":500,"seconds":480,"requires":["siege-arrows"],"effects":{"archers_attack":0.08},"atlas":"archery","art_index":6,"description":"Longbows develops your empire’s archery. This discovery benefits every owned city and army."}'::jsonb),
('bodkin-arrows','Bodkin Arrows','archery',3,null,600,576,'["longbows"]'::jsonb,'{"archers_attack":0.08}'::jsonb,'{"id":"bodkin-arrows","name":"Bodkin Arrows","branch":"archery","era":3,"stage":7,"lane":1,"faction":null,"cost":600,"seconds":576,"requires":["longbows"],"effects":{"archers_attack":0.08},"atlas":"archery","art_index":7,"description":"Bodkin Arrows develops your empire’s archery. This discovery benefits every owned city and army."}'::jsonb),
('volley-drill','Volley Drill','archery',4,null,1000,850,'["bodkin-arrows","philosophy"]'::jsonb,'{"training":0.1}'::jsonb,'{"id":"volley-drill","name":"Volley Drill","branch":"archery","era":4,"stage":8,"lane":1,"faction":null,"cost":1000,"seconds":850,"requires":["bodkin-arrows","philosophy"],"effects":{"training":0.1},"atlas":"archery","art_index":8,"description":"Volley Drill develops your empire’s archery. This discovery benefits every owned city and army."}'::jsonb),
('master-archers','Master Archers','archery',4,null,1200,1020,'["volley-drill"]'::jsonb,'{"archers_defence":0.1}'::jsonb,'{"id":"master-archers","name":"Master Archers","branch":"archery","era":4,"stage":9,"lane":1,"faction":null,"cost":1200,"seconds":1020,"requires":["volley-drill"],"effects":{"archers_defence":0.1},"atlas":"archery","art_index":9,"description":"Master Archers develops your empire’s archery. This discovery benefits every owned city and army."}'::jsonb),
('scouting','Scouting','cavalry',0,null,35,30,'[]'::jsonb,'{"unlock_scout":1}'::jsonb,'{"id":"scouting","name":"Scouting","branch":"cavalry","era":0,"stage":0,"lane":2,"faction":null,"cost":35,"seconds":30,"requires":[],"effects":{"unlock_scout":1},"atlas":"cavalry","art_index":0,"description":"Scouting develops your empire’s cavalry. This discovery benefits every owned city and army."}'::jsonb),
('saddles','Saddles','cavalry',0,null,42,36,'["scouting"]'::jsonb,'{"march":0.05}'::jsonb,'{"id":"saddles","name":"Saddles","branch":"cavalry","era":0,"stage":1,"lane":2,"faction":null,"cost":42,"seconds":36,"requires":["scouting"],"effects":{"march":0.05},"atlas":"cavalry","art_index":1,"description":"Saddles develops your empire’s cavalry. This discovery benefits every owned city and army."}'::jsonb),
('stirrups','Stirrups','cavalry',1,null,90,90,'["saddles"]'::jsonb,'{"cavalry_attack":0.05}'::jsonb,'{"id":"stirrups","name":"Stirrups","branch":"cavalry","era":1,"stage":2,"lane":2,"faction":null,"cost":90,"seconds":90,"requires":["saddles"],"effects":{"cavalry_attack":0.05},"atlas":"cavalry","art_index":2,"description":"Stirrups develops your empire’s cavalry. This discovery benefits every owned city and army."}'::jsonb),
('riding-schools','Riding Schools','cavalry',1,null,108,108,'["stirrups"]'::jsonb,'{"training":0.05}'::jsonb,'{"id":"riding-schools","name":"Riding Schools","branch":"cavalry","era":1,"stage":3,"lane":2,"faction":null,"cost":108,"seconds":108,"requires":["stirrups"],"effects":{"training":0.05},"atlas":"cavalry","art_index":3,"description":"Riding Schools develops your empire’s cavalry. This discovery benefits every owned city and army."}'::jsonb),
('barding','Barding','cavalry',2,null,220,240,'["riding-schools","libraries"]'::jsonb,'{"cavalry_defence":0.08}'::jsonb,'{"id":"barding","name":"Barding","branch":"cavalry","era":2,"stage":4,"lane":2,"faction":null,"cost":220,"seconds":240,"requires":["riding-schools","libraries"],"effects":{"cavalry_defence":0.08},"atlas":"cavalry","art_index":4,"description":"Barding develops your empire’s cavalry. This discovery benefits every owned city and army."}'::jsonb),
('heavy-cavalry','Heavy Cavalry','cavalry',2,null,264,288,'["barding"]'::jsonb,'{"unlock_heavyCavalry":1}'::jsonb,'{"id":"heavy-cavalry","name":"Heavy Cavalry","branch":"cavalry","era":2,"stage":5,"lane":2,"faction":null,"cost":264,"seconds":288,"requires":["barding"],"effects":{"unlock_heavyCavalry":1},"atlas":"cavalry","art_index":5,"description":"Heavy Cavalry develops your empire’s cavalry. This discovery benefits every owned city and army."}'::jsonb),
('swift-couriers','Swift Couriers','cavalry',3,null,500,480,'["heavy-cavalry"]'::jsonb,'{"march":0.08}'::jsonb,'{"id":"swift-couriers","name":"Swift Couriers","branch":"cavalry","era":3,"stage":6,"lane":2,"faction":null,"cost":500,"seconds":480,"requires":["heavy-cavalry"],"effects":{"march":0.08},"atlas":"cavalry","art_index":6,"description":"Swift Couriers develops your empire’s cavalry. This discovery benefits every owned city and army."}'::jsonb),
('mounted-tactics','Mounted Tactics','cavalry',3,null,600,576,'["swift-couriers"]'::jsonb,'{"cavalry_attack":0.08}'::jsonb,'{"id":"mounted-tactics","name":"Mounted Tactics","branch":"cavalry","era":3,"stage":7,"lane":2,"faction":null,"cost":600,"seconds":576,"requires":["swift-couriers"],"effects":{"cavalry_attack":0.08},"atlas":"cavalry","art_index":7,"description":"Mounted Tactics develops your empire’s cavalry. This discovery benefits every owned city and army."}'::jsonb),
('warhorse-breeding','Warhorse Breeding','cavalry',4,null,1000,850,'["mounted-tactics","philosophy"]'::jsonb,'{"training":0.1}'::jsonb,'{"id":"warhorse-breeding","name":"Warhorse Breeding","branch":"cavalry","era":4,"stage":8,"lane":2,"faction":null,"cost":1000,"seconds":850,"requires":["mounted-tactics","philosophy"],"effects":{"training":0.1},"atlas":"cavalry","art_index":8,"description":"Warhorse Breeding develops your empire’s cavalry. This discovery benefits every owned city and army."}'::jsonb),
('royal-cavalry','Royal Cavalry','cavalry',4,null,1200,1020,'["warhorse-breeding"]'::jsonb,'{"cavalry_defence":0.1}'::jsonb,'{"id":"royal-cavalry","name":"Royal Cavalry","branch":"cavalry","era":4,"stage":9,"lane":2,"faction":null,"cost":1200,"seconds":1020,"requires":["warhorse-breeding"],"effects":{"cavalry_defence":0.1},"atlas":"cavalry","art_index":9,"description":"Royal Cavalry develops your empire’s cavalry. This discovery benefits every owned city and army."}'::jsonb),
('carpentry','Carpentry','siege',0,null,35,30,'[]'::jsonb,'{"construction":0.05}'::jsonb,'{"id":"carpentry","name":"Carpentry","branch":"siege","era":0,"stage":0,"lane":3,"faction":null,"cost":35,"seconds":30,"requires":[],"effects":{"construction":0.05},"atlas":"siege","art_index":0,"description":"Carpentry develops your empire’s siege. This discovery benefits every owned city and army."}'::jsonb),
('battering-rams','Battering Rams','siege',0,null,42,36,'["carpentry"]'::jsonb,'{"unlock_ram":1}'::jsonb,'{"id":"battering-rams","name":"Battering Rams","branch":"siege","era":0,"stage":1,"lane":3,"faction":null,"cost":42,"seconds":36,"requires":["carpentry"],"effects":{"unlock_ram":1},"atlas":"siege","art_index":1,"description":"Battering Rams develops your empire’s siege. This discovery benefits every owned city and army."}'::jsonb),
('siege-logistics','Siege Logistics','siege',1,null,90,90,'["battering-rams"]'::jsonb,'{"march":0.05}'::jsonb,'{"id":"siege-logistics","name":"Siege Logistics","branch":"siege","era":1,"stage":2,"lane":3,"faction":null,"cost":90,"seconds":90,"requires":["battering-rams"],"effects":{"march":0.05},"atlas":"siege","art_index":2,"description":"Siege Logistics develops your empire’s siege. This discovery benefits every owned city and army."}'::jsonb),
('fortification-studies','Fortification Studies','siege',1,null,108,108,'["siege-logistics"]'::jsonb,'{"defence":0.05}'::jsonb,'{"id":"fortification-studies","name":"Fortification Studies","branch":"siege","era":1,"stage":3,"lane":3,"faction":null,"cost":108,"seconds":108,"requires":["siege-logistics"],"effects":{"defence":0.05},"atlas":"siege","art_index":3,"description":"Fortification Studies develops your empire’s siege. This discovery benefits every owned city and army."}'::jsonb),
('catapults','Catapults','siege',2,null,220,240,'["fortification-studies","libraries"]'::jsonb,'{"unlock_catapult":1}'::jsonb,'{"id":"catapults","name":"Catapults","branch":"siege","era":2,"stage":4,"lane":3,"faction":null,"cost":220,"seconds":240,"requires":["fortification-studies","libraries"],"effects":{"unlock_catapult":1},"atlas":"siege","art_index":4,"description":"Catapults develops your empire’s siege. This discovery benefits every owned city and army."}'::jsonb),
('counterweights','Counterweights','siege',2,null,264,288,'["catapults"]'::jsonb,'{"siege":0.08}'::jsonb,'{"id":"counterweights","name":"Counterweights","branch":"siege","era":2,"stage":5,"lane":3,"faction":null,"cost":264,"seconds":288,"requires":["catapults"],"effects":{"siege":0.08},"atlas":"siege","art_index":5,"description":"Counterweights develops your empire’s siege. This discovery benefits every owned city and army."}'::jsonb),
('reinforced-frames','Reinforced Frames','siege',3,null,500,480,'["counterweights"]'::jsonb,'{"siege":0.08}'::jsonb,'{"id":"reinforced-frames","name":"Reinforced Frames","branch":"siege","era":3,"stage":6,"lane":3,"faction":null,"cost":500,"seconds":480,"requires":["counterweights"],"effects":{"siege":0.08},"atlas":"siege","art_index":6,"description":"Reinforced Frames develops your empire’s siege. This discovery benefits every owned city and army."}'::jsonb),
('siege-engines','Siege Engines','siege',3,null,600,576,'["reinforced-frames"]'::jsonb,'{"training":0.08}'::jsonb,'{"id":"siege-engines","name":"Siege Engines","branch":"siege","era":3,"stage":7,"lane":3,"faction":null,"cost":600,"seconds":576,"requires":["reinforced-frames"],"effects":{"training":0.08},"atlas":"siege","art_index":7,"description":"Siege Engines develops your empire’s siege. This discovery benefits every owned city and army."}'::jsonb),
('siege-masters','Siege Masters','siege',4,null,1000,850,'["siege-engines","philosophy"]'::jsonb,'{"siege":0.1}'::jsonb,'{"id":"siege-masters","name":"Siege Masters","branch":"siege","era":4,"stage":8,"lane":3,"faction":null,"cost":1000,"seconds":850,"requires":["siege-engines","philosophy"],"effects":{"siege":0.1},"atlas":"siege","art_index":8,"description":"Siege Masters develops your empire’s siege. This discovery benefits every owned city and army."}'::jsonb),
('grand-bombardment','Grand Bombardment','siege',4,null,1200,1020,'["siege-masters"]'::jsonb,'{"siege":0.1}'::jsonb,'{"id":"grand-bombardment","name":"Grand Bombardment","branch":"siege","era":4,"stage":9,"lane":3,"faction":null,"cost":1200,"seconds":1020,"requires":["siege-masters"],"effects":{"siege":0.1},"atlas":"siege","art_index":9,"description":"Grand Bombardment develops your empire’s siege. This discovery benefits every owned city and army."}'::jsonb),
('crop-rotation','Crop Rotation','agriculture',0,null,35,30,'[]'::jsonb,'{"food":0.05}'::jsonb,'{"id":"crop-rotation","name":"Crop Rotation","branch":"agriculture","era":0,"stage":0,"lane":4,"faction":null,"cost":35,"seconds":30,"requires":[],"effects":{"food":0.05},"atlas":"agriculture","art_index":0,"description":"Crop Rotation develops your empire’s agriculture. This discovery benefits every owned city and army."}'::jsonb),
('irrigation','Irrigation','agriculture',0,null,42,36,'["crop-rotation"]'::jsonb,'{"food":0.05}'::jsonb,'{"id":"irrigation","name":"Irrigation","branch":"agriculture","era":0,"stage":1,"lane":4,"faction":null,"cost":42,"seconds":36,"requires":["crop-rotation"],"effects":{"food":0.05},"atlas":"agriculture","art_index":1,"description":"Irrigation develops your empire’s agriculture. This discovery benefits every owned city and army."}'::jsonb),
('seed-selection','Seed Selection','agriculture',1,null,90,90,'["irrigation"]'::jsonb,'{"food":0.05}'::jsonb,'{"id":"seed-selection","name":"Seed Selection","branch":"agriculture","era":1,"stage":2,"lane":4,"faction":null,"cost":90,"seconds":90,"requires":["irrigation"],"effects":{"food":0.05},"atlas":"agriculture","art_index":2,"description":"Seed Selection develops your empire’s agriculture. This discovery benefits every owned city and army."}'::jsonb),
('water-mills','Water Mills','agriculture',1,null,108,108,'["seed-selection"]'::jsonb,'{"food":0.05}'::jsonb,'{"id":"water-mills","name":"Water Mills","branch":"agriculture","era":1,"stage":3,"lane":4,"faction":null,"cost":108,"seconds":108,"requires":["seed-selection"],"effects":{"food":0.05},"atlas":"agriculture","art_index":3,"description":"Water Mills develops your empire’s agriculture. This discovery benefits every owned city and army."}'::jsonb),
('terrace-farming','Terrace Farming','agriculture',2,null,220,240,'["water-mills","libraries"]'::jsonb,'{"food":0.08}'::jsonb,'{"id":"terrace-farming","name":"Terrace Farming","branch":"agriculture","era":2,"stage":4,"lane":4,"faction":null,"cost":220,"seconds":240,"requires":["water-mills","libraries"],"effects":{"food":0.08},"atlas":"agriculture","art_index":4,"description":"Terrace Farming develops your empire’s agriculture. This discovery benefits every owned city and army."}'::jsonb),
('orchards','Orchards','agriculture',2,null,264,288,'["terrace-farming"]'::jsonb,'{"food":0.08}'::jsonb,'{"id":"orchards","name":"Orchards","branch":"agriculture","era":2,"stage":5,"lane":4,"faction":null,"cost":264,"seconds":288,"requires":["terrace-farming"],"effects":{"food":0.08},"atlas":"agriculture","art_index":5,"description":"Orchards develops your empire’s agriculture. This discovery benefits every owned city and army."}'::jsonb),
('animal-husbandry','Animal Husbandry','agriculture',3,null,500,480,'["orchards"]'::jsonb,'{"food":0.08}'::jsonb,'{"id":"animal-husbandry","name":"Animal Husbandry","branch":"agriculture","era":3,"stage":6,"lane":4,"faction":null,"cost":500,"seconds":480,"requires":["orchards"],"effects":{"food":0.08},"atlas":"agriculture","art_index":6,"description":"Animal Husbandry develops your empire’s agriculture. This discovery benefits every owned city and army."}'::jsonb),
('food-preservation','Food Preservation','agriculture',3,null,600,576,'["animal-husbandry"]'::jsonb,'{"storage":0.08}'::jsonb,'{"id":"food-preservation","name":"Food Preservation","branch":"agriculture","era":3,"stage":7,"lane":4,"faction":null,"cost":600,"seconds":576,"requires":["animal-husbandry"],"effects":{"storage":0.08},"atlas":"agriculture","art_index":7,"description":"Food Preservation develops your empire’s agriculture. This discovery benefits every owned city and army."}'::jsonb),
('agrarian-estates','Agrarian Estates','agriculture',4,null,1000,850,'["food-preservation","philosophy"]'::jsonb,'{"food":0.1}'::jsonb,'{"id":"agrarian-estates","name":"Agrarian Estates","branch":"agriculture","era":4,"stage":8,"lane":4,"faction":null,"cost":1000,"seconds":850,"requires":["food-preservation","philosophy"],"effects":{"food":0.1},"atlas":"agriculture","art_index":8,"description":"Agrarian Estates develops your empire’s agriculture. This discovery benefits every owned city and army."}'::jsonb),
('abundant-harvest','Abundant Harvest','agriculture',4,null,1200,1020,'["agrarian-estates"]'::jsonb,'{"food":0.1}'::jsonb,'{"id":"abundant-harvest","name":"Abundant Harvest","branch":"agriculture","era":4,"stage":9,"lane":4,"faction":null,"cost":1200,"seconds":1020,"requires":["agrarian-estates"],"effects":{"food":0.1},"atlas":"agriculture","art_index":9,"description":"Abundant Harvest develops your empire’s agriculture. This discovery benefits every owned city and army."}'::jsonb),
('forestry','Forestry','industry',0,null,35,30,'[]'::jsonb,'{"wood":0.05}'::jsonb,'{"id":"forestry","name":"Forestry","branch":"industry","era":0,"stage":0,"lane":5,"faction":null,"cost":35,"seconds":30,"requires":[],"effects":{"wood":0.05},"atlas":"industry","art_index":0,"description":"Forestry develops your empire’s industry. This discovery benefits every owned city and army."}'::jsonb),
('stonecutting','Stonecutting','industry',0,null,42,36,'["forestry"]'::jsonb,'{"stone":0.05}'::jsonb,'{"id":"stonecutting","name":"Stonecutting","branch":"industry","era":0,"stage":1,"lane":5,"faction":null,"cost":42,"seconds":36,"requires":["forestry"],"effects":{"stone":0.05},"atlas":"industry","art_index":1,"description":"Stonecutting develops your empire’s industry. This discovery benefits every owned city and army."}'::jsonb),
('improved-axes','Improved Axes','industry',1,null,90,90,'["stonecutting"]'::jsonb,'{"wood":0.05}'::jsonb,'{"id":"improved-axes","name":"Improved Axes","branch":"industry","era":1,"stage":2,"lane":5,"faction":null,"cost":90,"seconds":90,"requires":["stonecutting"],"effects":{"wood":0.05},"atlas":"industry","art_index":2,"description":"Improved Axes develops your empire’s industry. This discovery benefits every owned city and army."}'::jsonb),
('deep-quarrying','Deep Quarrying','industry',1,null,108,108,'["improved-axes"]'::jsonb,'{"stone":0.05}'::jsonb,'{"id":"deep-quarrying","name":"Deep Quarrying","branch":"industry","era":1,"stage":3,"lane":5,"faction":null,"cost":108,"seconds":108,"requires":["improved-axes"],"effects":{"stone":0.05},"atlas":"industry","art_index":3,"description":"Deep Quarrying develops your empire’s industry. This discovery benefits every owned city and army."}'::jsonb),
('ore-prospecting','Ore Prospecting','industry',2,null,220,240,'["deep-quarrying","libraries"]'::jsonb,'{"gold":0.08}'::jsonb,'{"id":"ore-prospecting","name":"Ore Prospecting","branch":"industry","era":2,"stage":4,"lane":5,"faction":null,"cost":220,"seconds":240,"requires":["deep-quarrying","libraries"],"effects":{"gold":0.08},"atlas":"industry","art_index":4,"description":"Ore Prospecting develops your empire’s industry. This discovery benefits every owned city and army."}'::jsonb),
('saw-mills','Saw Mills','industry',2,null,264,288,'["ore-prospecting"]'::jsonb,'{"wood":0.08}'::jsonb,'{"id":"saw-mills","name":"Saw Mills","branch":"industry","era":2,"stage":5,"lane":5,"faction":null,"cost":264,"seconds":288,"requires":["ore-prospecting"],"effects":{"wood":0.08},"atlas":"industry","art_index":5,"description":"Saw Mills develops your empire’s industry. This discovery benefits every owned city and army."}'::jsonb),
('precision-tools','Precision Tools','industry',3,null,500,480,'["saw-mills"]'::jsonb,'{"construction":0.08}'::jsonb,'{"id":"precision-tools","name":"Precision Tools","branch":"industry","era":3,"stage":6,"lane":5,"faction":null,"cost":500,"seconds":480,"requires":["saw-mills"],"effects":{"construction":0.08},"atlas":"industry","art_index":6,"description":"Precision Tools develops your empire’s industry. This discovery benefits every owned city and army."}'::jsonb),
('industrial-estates','Industrial Estates','industry',3,null,600,576,'["precision-tools"]'::jsonb,'{"stone":0.08}'::jsonb,'{"id":"industrial-estates","name":"Industrial Estates","branch":"industry","era":3,"stage":7,"lane":5,"faction":null,"cost":600,"seconds":576,"requires":["precision-tools"],"effects":{"stone":0.08},"atlas":"industry","art_index":7,"description":"Industrial Estates develops your empire’s industry. This discovery benefits every owned city and army."}'::jsonb),
('master-craftsmen','Master Craftsmen','industry',4,null,1000,850,'["industrial-estates","philosophy"]'::jsonb,'{"wood":0.1}'::jsonb,'{"id":"master-craftsmen","name":"Master Craftsmen","branch":"industry","era":4,"stage":8,"lane":5,"faction":null,"cost":1000,"seconds":850,"requires":["industrial-estates","philosophy"],"effects":{"wood":0.1},"atlas":"industry","art_index":8,"description":"Master Craftsmen develops your empire’s industry. This discovery benefits every owned city and army."}'::jsonb),
('great-foundries','Great Foundries','industry',4,null,1200,1020,'["master-craftsmen"]'::jsonb,'{"stone":0.1}'::jsonb,'{"id":"great-foundries","name":"Great Foundries","branch":"industry","era":4,"stage":9,"lane":5,"faction":null,"cost":1200,"seconds":1020,"requires":["master-craftsmen"],"effects":{"stone":0.1},"atlas":"industry","art_index":9,"description":"Great Foundries develops your empire’s industry. This discovery benefits every owned city and army."}'::jsonb),
('masonry','Masonry','engineering',0,null,35,30,'[]'::jsonb,'{"construction":0.05}'::jsonb,'{"id":"masonry","name":"Masonry","branch":"engineering","era":0,"stage":0,"lane":6,"faction":null,"cost":35,"seconds":30,"requires":[],"effects":{"construction":0.05},"atlas":"engineering","art_index":0,"description":"Masonry develops your empire’s engineering. This discovery benefits every owned city and army."}'::jsonb),
('road-building','Road Building','engineering',0,null,42,36,'["masonry"]'::jsonb,'{"march":0.05}'::jsonb,'{"id":"road-building","name":"Road Building","branch":"engineering","era":0,"stage":1,"lane":6,"faction":null,"cost":42,"seconds":36,"requires":["masonry"],"effects":{"march":0.05},"atlas":"engineering","art_index":1,"description":"Road Building develops your empire’s engineering. This discovery benefits every owned city and army."}'::jsonb),
('scaffolding','Scaffolding','engineering',1,null,90,90,'["road-building"]'::jsonb,'{"construction":0.05}'::jsonb,'{"id":"scaffolding","name":"Scaffolding","branch":"engineering","era":1,"stage":2,"lane":6,"faction":null,"cost":90,"seconds":90,"requires":["road-building"],"effects":{"construction":0.05},"atlas":"engineering","art_index":2,"description":"Scaffolding develops your empire’s engineering. This discovery benefits every owned city and army."}'::jsonb),
('architecture','Architecture','engineering',1,null,108,108,'["scaffolding"]'::jsonb,'{"storage":0.05}'::jsonb,'{"id":"architecture","name":"Architecture","branch":"engineering","era":1,"stage":3,"lane":6,"faction":null,"cost":108,"seconds":108,"requires":["scaffolding"],"effects":{"storage":0.05},"atlas":"engineering","art_index":3,"description":"Architecture develops your empire’s engineering. This discovery benefits every owned city and army."}'::jsonb),
('cranes','Cranes','engineering',2,null,220,240,'["architecture","libraries"]'::jsonb,'{"construction":0.08}'::jsonb,'{"id":"cranes","name":"Cranes","branch":"engineering","era":2,"stage":4,"lane":6,"faction":null,"cost":220,"seconds":240,"requires":["architecture","libraries"],"effects":{"construction":0.08},"atlas":"engineering","art_index":4,"description":"Cranes develops your empire’s engineering. This discovery benefits every owned city and army."}'::jsonb),
('surveying','Surveying','engineering',2,null,264,288,'["cranes"]'::jsonb,'{"construction":0.08}'::jsonb,'{"id":"surveying","name":"Surveying","branch":"engineering","era":2,"stage":5,"lane":6,"faction":null,"cost":264,"seconds":288,"requires":["cranes"],"effects":{"construction":0.08},"atlas":"engineering","art_index":5,"description":"Surveying develops your empire’s engineering. This discovery benefits every owned city and army."}'::jsonb),
('urban-planning','Urban Planning','engineering',3,null,500,480,'["surveying"]'::jsonb,'{"construction":0.08}'::jsonb,'{"id":"urban-planning","name":"Urban Planning","branch":"engineering","era":3,"stage":6,"lane":6,"faction":null,"cost":500,"seconds":480,"requires":["surveying"],"effects":{"construction":0.08},"atlas":"engineering","art_index":6,"description":"Urban Planning develops your empire’s engineering. This discovery benefits every owned city and army."}'::jsonb),
('concrete','Concrete','engineering',3,null,600,576,'["urban-planning"]'::jsonb,'{"defence":0.08}'::jsonb,'{"id":"concrete","name":"Concrete","branch":"engineering","era":3,"stage":7,"lane":6,"faction":null,"cost":600,"seconds":576,"requires":["urban-planning"],"effects":{"defence":0.08},"atlas":"engineering","art_index":7,"description":"Concrete develops your empire’s engineering. This discovery benefits every owned city and army."}'::jsonb),
('monuments','Monuments','engineering',4,null,1000,850,'["concrete","philosophy"]'::jsonb,'{"culture":0.1}'::jsonb,'{"id":"monuments","name":"Monuments","branch":"engineering","era":4,"stage":8,"lane":6,"faction":null,"cost":1000,"seconds":850,"requires":["concrete","philosophy"],"effects":{"culture":0.1},"atlas":"engineering","art_index":8,"description":"Monuments develops your empire’s engineering. This discovery benefits every owned city and army."}'::jsonb),
('master-builders','Master Builders','engineering',4,null,1200,1020,'["monuments"]'::jsonb,'{"construction":0.1}'::jsonb,'{"id":"master-builders","name":"Master Builders","branch":"engineering","era":4,"stage":9,"lane":6,"faction":null,"cost":1200,"seconds":1020,"requires":["monuments"],"effects":{"construction":0.1},"atlas":"engineering","art_index":9,"description":"Master Builders develops your empire’s engineering. This discovery benefits every owned city and army."}'::jsonb),
('barter','Barter','commerce',0,null,35,30,'[]'::jsonb,'{"trade":0.05}'::jsonb,'{"id":"barter","name":"Barter","branch":"commerce","era":0,"stage":0,"lane":7,"faction":null,"cost":35,"seconds":30,"requires":[],"effects":{"trade":0.05},"atlas":"commerce","art_index":0,"description":"Barter develops your empire’s commerce. This discovery benefits every owned city and army."}'::jsonb),
('currency','Currency','commerce',0,null,42,36,'["barter"]'::jsonb,'{"gold":0.05}'::jsonb,'{"id":"currency","name":"Currency","branch":"commerce","era":0,"stage":1,"lane":7,"faction":null,"cost":42,"seconds":36,"requires":["barter"],"effects":{"gold":0.05},"atlas":"commerce","art_index":1,"description":"Currency develops your empire’s commerce. This discovery benefits every owned city and army."}'::jsonb),
('trade-routes','Trade Routes','commerce',1,null,90,90,'["currency"]'::jsonb,'{"carry":0.05}'::jsonb,'{"id":"trade-routes","name":"Trade Routes","branch":"commerce","era":1,"stage":2,"lane":7,"faction":null,"cost":90,"seconds":90,"requires":["currency"],"effects":{"carry":0.05},"atlas":"commerce","art_index":2,"description":"Trade Routes develops your empire’s commerce. This discovery benefits every owned city and army."}'::jsonb),
('merchant-guilds','Merchant Guilds','commerce',1,null,108,108,'["trade-routes"]'::jsonb,'{"trade":0.05}'::jsonb,'{"id":"merchant-guilds","name":"Merchant Guilds","branch":"commerce","era":1,"stage":3,"lane":7,"faction":null,"cost":108,"seconds":108,"requires":["trade-routes"],"effects":{"trade":0.05},"atlas":"commerce","art_index":3,"description":"Merchant Guilds develops your empire’s commerce. This discovery benefits every owned city and army."}'::jsonb),
('caravans','Caravans','commerce',2,null,220,240,'["merchant-guilds","libraries"]'::jsonb,'{"carry":0.08}'::jsonb,'{"id":"caravans","name":"Caravans","branch":"commerce","era":2,"stage":4,"lane":7,"faction":null,"cost":220,"seconds":240,"requires":["merchant-guilds","libraries"],"effects":{"carry":0.08},"atlas":"commerce","art_index":4,"description":"Caravans develops your empire’s commerce. This discovery benefits every owned city and army."}'::jsonb),
('counting-houses','Counting Houses','commerce',2,null,264,288,'["caravans"]'::jsonb,'{"gold":0.08}'::jsonb,'{"id":"counting-houses","name":"Counting Houses","branch":"commerce","era":2,"stage":5,"lane":7,"faction":null,"cost":264,"seconds":288,"requires":["caravans"],"effects":{"gold":0.08},"atlas":"commerce","art_index":5,"description":"Counting Houses develops your empire’s commerce. This discovery benefits every owned city and army."}'::jsonb),
('banking','Banking','commerce',3,null,500,480,'["counting-houses"]'::jsonb,'{"storage":0.08}'::jsonb,'{"id":"banking","name":"Banking","branch":"commerce","era":3,"stage":6,"lane":7,"faction":null,"cost":500,"seconds":480,"requires":["counting-houses"],"effects":{"storage":0.08},"atlas":"commerce","art_index":6,"description":"Banking develops your empire’s commerce. This discovery benefits every owned city and army."}'::jsonb),
('customs-houses','Customs Houses','commerce',3,null,600,576,'["banking"]'::jsonb,'{"trade":0.08}'::jsonb,'{"id":"customs-houses","name":"Customs Houses","branch":"commerce","era":3,"stage":7,"lane":7,"faction":null,"cost":600,"seconds":576,"requires":["banking"],"effects":{"trade":0.08},"atlas":"commerce","art_index":7,"description":"Customs Houses develops your empire’s commerce. This discovery benefits every owned city and army."}'::jsonb),
('market-charters','Market Charters','commerce',4,null,1000,850,'["customs-houses","philosophy"]'::jsonb,'{"gold":0.1}'::jsonb,'{"id":"market-charters","name":"Market Charters","branch":"commerce","era":4,"stage":8,"lane":7,"faction":null,"cost":1000,"seconds":850,"requires":["customs-houses","philosophy"],"effects":{"gold":0.1},"atlas":"commerce","art_index":8,"description":"Market Charters develops your empire’s commerce. This discovery benefits every owned city and army."}'::jsonb),
('great-exchange','Great Exchange','commerce',4,null,1200,1020,'["market-charters"]'::jsonb,'{"trade":0.1}'::jsonb,'{"id":"great-exchange","name":"Great Exchange","branch":"commerce","era":4,"stage":9,"lane":7,"faction":null,"cost":1200,"seconds":1020,"requires":["market-charters"],"effects":{"trade":0.1},"atlas":"commerce","art_index":9,"description":"Great Exchange develops your empire’s commerce. This discovery benefits every owned city and army."}'::jsonb),
('writing','Writing','knowledge',0,null,35,30,'[]'::jsonb,'{"science":0.05}'::jsonb,'{"id":"writing","name":"Writing","branch":"knowledge","era":0,"stage":0,"lane":8,"faction":null,"cost":35,"seconds":30,"requires":[],"effects":{"science":0.05},"atlas":"knowledge","art_index":0,"description":"Writing develops your empire’s knowledge. This discovery benefits every owned city and army."}'::jsonb),
('mathematics','Mathematics','knowledge',0,null,42,36,'["writing"]'::jsonb,'{"science":0.05}'::jsonb,'{"id":"mathematics","name":"Mathematics","branch":"knowledge","era":0,"stage":1,"lane":8,"faction":null,"cost":42,"seconds":36,"requires":["writing"],"effects":{"science":0.05},"atlas":"knowledge","art_index":1,"description":"Mathematics develops your empire’s knowledge. This discovery benefits every owned city and army."}'::jsonb),
('libraries','Libraries','knowledge',1,null,90,90,'["mathematics"]'::jsonb,'{"science":0.05}'::jsonb,'{"id":"libraries","name":"Libraries","branch":"knowledge","era":1,"stage":2,"lane":8,"faction":null,"cost":90,"seconds":90,"requires":["mathematics"],"effects":{"science":0.05},"atlas":"knowledge","art_index":2,"description":"Libraries develops your empire’s knowledge. This discovery benefits every owned city and army."}'::jsonb),
('scholarship','Scholarship','knowledge',1,null,108,108,'["libraries"]'::jsonb,'{"research_speed":0.05}'::jsonb,'{"id":"scholarship","name":"Scholarship","branch":"knowledge","era":1,"stage":3,"lane":8,"faction":null,"cost":108,"seconds":108,"requires":["libraries"],"effects":{"research_speed":0.05},"atlas":"knowledge","art_index":3,"description":"Scholarship develops your empire’s knowledge. This discovery benefits every owned city and army."}'::jsonb),
('astronomy','Astronomy','knowledge',2,null,220,240,'["scholarship"]'::jsonb,'{"science":0.08}'::jsonb,'{"id":"astronomy","name":"Astronomy","branch":"knowledge","era":2,"stage":4,"lane":8,"faction":null,"cost":220,"seconds":240,"requires":["scholarship"],"effects":{"science":0.08},"atlas":"knowledge","art_index":4,"description":"Astronomy develops your empire’s knowledge. This discovery benefits every owned city and army."}'::jsonb),
('observatories','Observatories','knowledge',2,null,264,288,'["astronomy"]'::jsonb,'{"research_speed":0.08}'::jsonb,'{"id":"observatories","name":"Observatories","branch":"knowledge","era":2,"stage":5,"lane":8,"faction":null,"cost":264,"seconds":288,"requires":["astronomy"],"effects":{"research_speed":0.08},"atlas":"knowledge","art_index":5,"description":"Observatories develops your empire’s knowledge. This discovery benefits every owned city and army."}'::jsonb),
('philosophy','Philosophy','knowledge',3,null,500,480,'["observatories"]'::jsonb,'{"science":0.08}'::jsonb,'{"id":"philosophy","name":"Philosophy","branch":"knowledge","era":3,"stage":6,"lane":8,"faction":null,"cost":500,"seconds":480,"requires":["observatories"],"effects":{"science":0.08},"atlas":"knowledge","art_index":6,"description":"Philosophy develops your empire’s knowledge. This discovery benefits every owned city and army."}'::jsonb),
('paper-making','Paper Making','knowledge',3,null,600,576,'["philosophy"]'::jsonb,'{"science":0.08}'::jsonb,'{"id":"paper-making","name":"Paper Making","branch":"knowledge","era":3,"stage":7,"lane":8,"faction":null,"cost":600,"seconds":576,"requires":["philosophy"],"effects":{"science":0.08},"atlas":"knowledge","art_index":7,"description":"Paper Making develops your empire’s knowledge. This discovery benefits every owned city and army."}'::jsonb),
('universities','Universities','knowledge',4,null,1000,850,'["paper-making"]'::jsonb,'{"research_speed":0.1}'::jsonb,'{"id":"universities","name":"Universities","branch":"knowledge","era":4,"stage":8,"lane":8,"faction":null,"cost":1000,"seconds":850,"requires":["paper-making"],"effects":{"research_speed":0.1},"atlas":"knowledge","art_index":8,"description":"Universities develops your empire’s knowledge. This discovery benefits every owned city and army."}'::jsonb),
('enlightenment','Enlightenment','knowledge',4,null,1200,1020,'["universities"]'::jsonb,'{"science":0.1}'::jsonb,'{"id":"enlightenment","name":"Enlightenment","branch":"knowledge","era":4,"stage":9,"lane":8,"faction":null,"cost":1200,"seconds":1020,"requires":["universities"],"effects":{"science":0.1},"atlas":"knowledge","art_index":9,"description":"Enlightenment develops your empire’s knowledge. This discovery benefits every owned city and army."}'::jsonb),
('command','Command','leadership',0,null,35,30,'[]'::jsonb,'{"attack":0.05}'::jsonb,'{"id":"command","name":"Command","branch":"leadership","era":0,"stage":0,"lane":9,"faction":null,"cost":35,"seconds":30,"requires":[],"effects":{"attack":0.05},"atlas":"leadership","art_index":0,"description":"Command develops your empire’s leadership. This discovery benefits every owned city and army."}'::jsonb),
('logistics','Logistics','leadership',0,null,42,36,'["command"]'::jsonb,'{"carry":0.05}'::jsonb,'{"id":"logistics","name":"Logistics","branch":"leadership","era":0,"stage":1,"lane":9,"faction":null,"cost":42,"seconds":36,"requires":["command"],"effects":{"carry":0.05},"atlas":"leadership","art_index":1,"description":"Logistics develops your empire’s leadership. This discovery benefits every owned city and army."}'::jsonb),
('diplomacy','Diplomacy','leadership',1,null,90,90,'["logistics"]'::jsonb,'{"culture":0.05}'::jsonb,'{"id":"diplomacy","name":"Diplomacy","branch":"leadership","era":1,"stage":2,"lane":9,"faction":null,"cost":90,"seconds":90,"requires":["logistics"],"effects":{"culture":0.05},"atlas":"leadership","art_index":2,"description":"Diplomacy develops your empire’s leadership. This discovery benefits every owned city and army."}'::jsonb),
('war-council','War Council','leadership',1,null,108,108,'["diplomacy"]'::jsonb,'{"defence":0.05}'::jsonb,'{"id":"war-council","name":"War Council","branch":"leadership","era":1,"stage":3,"lane":9,"faction":null,"cost":108,"seconds":108,"requires":["diplomacy"],"effects":{"defence":0.05},"atlas":"leadership","art_index":3,"description":"War Council develops your empire’s leadership. This discovery benefits every owned city and army."}'::jsonb),
('heroic-deeds','Heroic Deeds','leadership',2,null,220,240,'["war-council","libraries"]'::jsonb,'{"hero_xp":0.08}'::jsonb,'{"id":"heroic-deeds","name":"Heroic Deeds","branch":"leadership","era":2,"stage":4,"lane":9,"faction":null,"cost":220,"seconds":240,"requires":["war-council","libraries"],"effects":{"hero_xp":0.08},"atlas":"leadership","art_index":4,"description":"Heroic Deeds develops your empire’s leadership. This discovery benefits every owned city and army."}'::jsonb),
('strategy','Strategy','leadership',2,null,264,288,'["heroic-deeds"]'::jsonb,'{"march":0.08}'::jsonb,'{"id":"strategy","name":"Strategy","branch":"leadership","era":2,"stage":5,"lane":9,"faction":null,"cost":264,"seconds":288,"requires":["heroic-deeds"],"effects":{"march":0.08},"atlas":"leadership","art_index":5,"description":"Strategy develops your empire’s leadership. This discovery benefits every owned city and army."}'::jsonb),
('chronicles','Chronicles','leadership',3,null,500,480,'["strategy"]'::jsonb,'{"culture":0.08}'::jsonb,'{"id":"chronicles","name":"Chronicles","branch":"leadership","era":3,"stage":6,"lane":9,"faction":null,"cost":500,"seconds":480,"requires":["strategy"],"effects":{"culture":0.08},"atlas":"leadership","art_index":6,"description":"Chronicles develops your empire’s leadership. This discovery benefits every owned city and army."}'::jsonb),
('arcane-command','Arcane Command','leadership',3,null,600,576,'["chronicles"]'::jsonb,'{"spell_power":0.08}'::jsonb,'{"id":"arcane-command","name":"Arcane Command","branch":"leadership","era":3,"stage":7,"lane":9,"faction":null,"cost":600,"seconds":576,"requires":["chronicles"],"effects":{"spell_power":0.08},"atlas":"leadership","art_index":7,"description":"Arcane Command develops your empire’s leadership. This discovery benefits every owned city and army."}'::jsonb),
('imperial-governance','Imperial Governance','leadership',4,null,1000,850,'["arcane-command","philosophy"]'::jsonb,'{"mana":0.1}'::jsonb,'{"id":"imperial-governance","name":"Imperial Governance","branch":"leadership","era":4,"stage":8,"lane":9,"faction":null,"cost":1000,"seconds":850,"requires":["arcane-command","philosophy"],"effects":{"mana":0.1},"atlas":"leadership","art_index":8,"description":"Imperial Governance develops your empire’s leadership. This discovery benefits every owned city and army."}'::jsonb),
('legendary-command','Legendary Command','leadership',4,null,1200,1020,'["imperial-governance"]'::jsonb,'{"hero_xp":0.1}'::jsonb,'{"id":"legendary-command","name":"Legendary Command","branch":"leadership","era":4,"stage":9,"lane":9,"faction":null,"cost":1200,"seconds":1020,"requires":["imperial-governance"],"effects":{"hero_xp":0.1},"atlas":"leadership","art_index":9,"description":"Legendary Command develops your empire’s leadership. This discovery benefits every owned city and army."}'::jsonb),
('roman-legion-discipline','Legion Discipline','heritage',0,'roman',40,34,'["writing"]'::jsonb,'{"infantry_attack":0.08}'::jsonb,'{"id":"roman-legion-discipline","name":"Legion Discipline","branch":"heritage","era":0,"stage":0,"lane":10,"faction":"roman","cost":40,"seconds":34,"requires":["writing"],"effects":{"infantry_attack":0.08},"atlas":"roman","art_index":0,"description":"A roman tradition that strengthens the whole account. Heritage bonuses apply while this is your account faction."}'::jsonb),
('roman-testudo','Testudo','heritage',0,'roman',48,41,'["roman-legion-discipline"]'::jsonb,'{"infantry_defence":0.08}'::jsonb,'{"id":"roman-testudo","name":"Testudo","branch":"heritage","era":0,"stage":1,"lane":10,"faction":"roman","cost":48,"seconds":41,"requires":["roman-legion-discipline"],"effects":{"infantry_defence":0.08},"atlas":"roman","art_index":1,"description":"A roman tradition that strengthens the whole account. Heritage bonuses apply while this is your account faction."}'::jsonb),
('roman-roman-roads','Roman Roads','heritage',1,'roman',103,103,'["roman-testudo"]'::jsonb,'{"march":0.08}'::jsonb,'{"id":"roman-roman-roads","name":"Roman Roads","branch":"heritage","era":1,"stage":2,"lane":10,"faction":"roman","cost":103,"seconds":103,"requires":["roman-testudo"],"effects":{"march":0.08},"atlas":"roman","art_index":2,"description":"A roman tradition that strengthens the whole account. Heritage bonuses apply while this is your account faction."}'::jsonb),
('roman-aqueducts','Aqueducts','heritage',1,'roman',124,124,'["roman-roman-roads"]'::jsonb,'{"food":0.08}'::jsonb,'{"id":"roman-aqueducts","name":"Aqueducts","branch":"heritage","era":1,"stage":3,"lane":10,"faction":"roman","cost":124,"seconds":124,"requires":["roman-roman-roads"],"effects":{"food":0.08},"atlas":"roman","art_index":3,"description":"A roman tradition that strengthens the whole account. Heritage bonuses apply while this is your account faction."}'::jsonb),
('roman-imperial-census','Imperial Census','heritage',2,'roman',253,276,'["roman-aqueducts","libraries"]'::jsonb,'{"gold":0.08}'::jsonb,'{"id":"roman-imperial-census","name":"Imperial Census","branch":"heritage","era":2,"stage":4,"lane":10,"faction":"roman","cost":253,"seconds":276,"requires":["roman-aqueducts","libraries"],"effects":{"gold":0.08},"atlas":"roman","art_index":4,"description":"A roman tradition that strengthens the whole account. Heritage bonuses apply while this is your account faction."}'::jsonb),
('roman-military-engineering','Military Engineering','heritage',2,'roman',304,331,'["roman-imperial-census"]'::jsonb,'{"construction":0.08}'::jsonb,'{"id":"roman-military-engineering","name":"Military Engineering","branch":"heritage","era":2,"stage":5,"lane":10,"faction":"roman","cost":304,"seconds":331,"requires":["roman-imperial-census"],"effects":{"construction":0.08},"atlas":"roman","art_index":5,"description":"A roman tradition that strengthens the whole account. Heritage bonuses apply while this is your account faction."}'::jsonb),
('roman-forum-trade','Forum Trade','heritage',3,'roman',575,552,'["roman-military-engineering"]'::jsonb,'{"trade":0.12}'::jsonb,'{"id":"roman-forum-trade","name":"Forum Trade","branch":"heritage","era":3,"stage":6,"lane":10,"faction":"roman","cost":575,"seconds":552,"requires":["roman-military-engineering"],"effects":{"trade":0.12},"atlas":"roman","art_index":6,"description":"A roman tradition that strengthens the whole account. Heritage bonuses apply while this is your account faction."}'::jsonb),
('roman-latin-scholarship','Latin Scholarship','heritage',3,'roman',690,662,'["roman-forum-trade"]'::jsonb,'{"science":0.12}'::jsonb,'{"id":"roman-latin-scholarship","name":"Latin Scholarship","branch":"heritage","era":3,"stage":7,"lane":10,"faction":"roman","cost":690,"seconds":662,"requires":["roman-forum-trade"],"effects":{"science":0.12},"atlas":"roman","art_index":7,"description":"A roman tradition that strengthens the whole account. Heritage bonuses apply while this is your account faction."}'::jsonb),
('roman-praetorian-training','Praetorian Training','heritage',4,'roman',1150,977,'["roman-latin-scholarship","philosophy"]'::jsonb,'{"training":0.12}'::jsonb,'{"id":"roman-praetorian-training","name":"Praetorian Training","branch":"heritage","era":4,"stage":8,"lane":10,"faction":"roman","cost":1150,"seconds":977,"requires":["roman-latin-scholarship","philosophy"],"effects":{"training":0.12},"atlas":"roman","art_index":8,"description":"A roman tradition that strengthens the whole account. Heritage bonuses apply while this is your account faction."}'::jsonb),
('roman-pax-imperium','Pax Imperium','heritage',4,'roman',1380,1173,'["roman-praetorian-training"]'::jsonb,'{"culture":0.12}'::jsonb,'{"id":"roman-pax-imperium","name":"Pax Imperium","branch":"heritage","era":4,"stage":9,"lane":10,"faction":"roman","cost":1380,"seconds":1173,"requires":["roman-praetorian-training"],"effects":{"culture":0.12},"atlas":"roman","art_index":9,"description":"A roman tradition that strengthens the whole account. Heritage bonuses apply while this is your account faction."}'::jsonb),
('spartan-agoge','Agoge','heritage',0,'spartan',40,34,'["writing"]'::jsonb,'{"training":0.08}'::jsonb,'{"id":"spartan-agoge","name":"Agoge","branch":"heritage","era":0,"stage":0,"lane":10,"faction":"spartan","cost":40,"seconds":34,"requires":["writing"],"effects":{"training":0.08},"atlas":"spartan","art_index":0,"description":"A spartan tradition that strengthens the whole account. Heritage bonuses apply while this is your account faction."}'::jsonb),
('spartan-phalanx','Phalanx','heritage',0,'spartan',48,41,'["spartan-agoge"]'::jsonb,'{"infantry_defence":0.08}'::jsonb,'{"id":"spartan-phalanx","name":"Phalanx","branch":"heritage","era":0,"stage":1,"lane":10,"faction":"spartan","cost":48,"seconds":41,"requires":["spartan-agoge"],"effects":{"infantry_defence":0.08},"atlas":"spartan","art_index":1,"description":"A spartan tradition that strengthens the whole account. Heritage bonuses apply while this is your account faction."}'::jsonb),
('spartan-bronze-hoplites','Bronze Hoplites','heritage',1,'spartan',103,103,'["spartan-phalanx"]'::jsonb,'{"infantry_attack":0.08}'::jsonb,'{"id":"spartan-bronze-hoplites","name":"Bronze Hoplites","branch":"heritage","era":1,"stage":2,"lane":10,"faction":"spartan","cost":103,"seconds":103,"requires":["spartan-phalanx"],"effects":{"infantry_attack":0.08},"atlas":"spartan","art_index":2,"description":"A spartan tradition that strengthens the whole account. Heritage bonuses apply while this is your account faction."}'::jsonb),
('spartan-laconic-orders','Laconic Orders','heritage',1,'spartan',124,124,'["spartan-bronze-hoplites"]'::jsonb,'{"march":0.08}'::jsonb,'{"id":"spartan-laconic-orders","name":"Laconic Orders","branch":"heritage","era":1,"stage":3,"lane":10,"faction":"spartan","cost":124,"seconds":124,"requires":["spartan-bronze-hoplites"],"effects":{"march":0.08},"atlas":"spartan","art_index":3,"description":"A spartan tradition that strengthens the whole account. Heritage bonuses apply while this is your account faction."}'::jsonb),
('spartan-shield-wall','Shield Wall','heritage',2,'spartan',253,276,'["spartan-laconic-orders","libraries"]'::jsonb,'{"defence":0.08}'::jsonb,'{"id":"spartan-shield-wall","name":"Shield Wall","branch":"heritage","era":2,"stage":4,"lane":10,"faction":"spartan","cost":253,"seconds":276,"requires":["spartan-laconic-orders","libraries"],"effects":{"defence":0.08},"atlas":"spartan","art_index":4,"description":"A spartan tradition that strengthens the whole account. Heritage bonuses apply while this is your account faction."}'::jsonb),
('spartan-warrior-houses','Warrior Houses','heritage',2,'spartan',304,331,'["spartan-shield-wall"]'::jsonb,'{"food":0.08}'::jsonb,'{"id":"spartan-warrior-houses","name":"Warrior Houses","branch":"heritage","era":2,"stage":5,"lane":10,"faction":"spartan","cost":304,"seconds":331,"requires":["spartan-shield-wall"],"effects":{"food":0.08},"atlas":"spartan","art_index":5,"description":"A spartan tradition that strengthens the whole account. Heritage bonuses apply while this is your account faction."}'::jsonb),
('spartan-battle-oaths','Battle Oaths','heritage',3,'spartan',575,552,'["spartan-warrior-houses"]'::jsonb,'{"attack":0.12}'::jsonb,'{"id":"spartan-battle-oaths","name":"Battle Oaths","branch":"heritage","era":3,"stage":6,"lane":10,"faction":"spartan","cost":575,"seconds":552,"requires":["spartan-warrior-houses"],"effects":{"attack":0.12},"atlas":"spartan","art_index":6,"description":"A spartan tradition that strengthens the whole account. Heritage bonuses apply while this is your account faction."}'::jsonb),
('spartan-iron-discipline','Iron Discipline','heritage',3,'spartan',690,662,'["spartan-battle-oaths"]'::jsonb,'{"training":0.12}'::jsonb,'{"id":"spartan-iron-discipline","name":"Iron Discipline","branch":"heritage","era":3,"stage":7,"lane":10,"faction":"spartan","cost":690,"seconds":662,"requires":["spartan-battle-oaths"],"effects":{"training":0.12},"atlas":"spartan","art_index":7,"description":"A spartan tradition that strengthens the whole account. Heritage bonuses apply while this is your account faction."}'::jsonb),
('spartan-royal-guard','Royal Guard','heritage',4,'spartan',1150,977,'["spartan-iron-discipline","philosophy"]'::jsonb,'{"infantry_defence":0.12}'::jsonb,'{"id":"spartan-royal-guard","name":"Royal Guard","branch":"heritage","era":4,"stage":8,"lane":10,"faction":"spartan","cost":1150,"seconds":977,"requires":["spartan-iron-discipline","philosophy"],"effects":{"infantry_defence":0.12},"atlas":"spartan","art_index":8,"description":"A spartan tradition that strengthens the whole account. Heritage bonuses apply while this is your account faction."}'::jsonb),
('spartan-spartan-legend','Spartan Legend','heritage',4,'spartan',1380,1173,'["spartan-royal-guard"]'::jsonb,'{"hero_xp":0.12}'::jsonb,'{"id":"spartan-spartan-legend","name":"Spartan Legend","branch":"heritage","era":4,"stage":9,"lane":10,"faction":"spartan","cost":1380,"seconds":1173,"requires":["spartan-royal-guard"],"effects":{"hero_xp":0.12},"atlas":"spartan","art_index":9,"description":"A spartan tradition that strengthens the whole account. Heritage bonuses apply while this is your account faction."}'::jsonb),
('persian-royal-roads','Royal Roads','heritage',0,'persian',40,34,'["writing"]'::jsonb,'{"march":0.08}'::jsonb,'{"id":"persian-royal-roads","name":"Royal Roads","branch":"heritage","era":0,"stage":0,"lane":10,"faction":"persian","cost":40,"seconds":34,"requires":["writing"],"effects":{"march":0.08},"atlas":"persian","art_index":0,"description":"A persian tradition that strengthens the whole account. Heritage bonuses apply while this is your account faction."}'::jsonb),
('persian-qanat-irrigation','Qanat Irrigation','heritage',0,'persian',48,41,'["persian-royal-roads"]'::jsonb,'{"food":0.08}'::jsonb,'{"id":"persian-qanat-irrigation","name":"Qanat Irrigation","branch":"heritage","era":0,"stage":1,"lane":10,"faction":"persian","cost":48,"seconds":41,"requires":["persian-royal-roads"],"effects":{"food":0.08},"atlas":"persian","art_index":1,"description":"A persian tradition that strengthens the whole account. Heritage bonuses apply while this is your account faction."}'::jsonb),
('persian-immortal-guard','Immortal Guard','heritage',1,'persian',103,103,'["persian-qanat-irrigation"]'::jsonb,'{"infantry_attack":0.08}'::jsonb,'{"id":"persian-immortal-guard","name":"Immortal Guard","branch":"heritage","era":1,"stage":2,"lane":10,"faction":"persian","cost":103,"seconds":103,"requires":["persian-qanat-irrigation"],"effects":{"infantry_attack":0.08},"atlas":"persian","art_index":2,"description":"A persian tradition that strengthens the whole account. Heritage bonuses apply while this is your account faction."}'::jsonb),
('persian-silk-caravans','Silk Caravans','heritage',1,'persian',124,124,'["persian-immortal-guard"]'::jsonb,'{"trade":0.08}'::jsonb,'{"id":"persian-silk-caravans","name":"Silk Caravans","branch":"heritage","era":1,"stage":3,"lane":10,"faction":"persian","cost":124,"seconds":124,"requires":["persian-immortal-guard"],"effects":{"trade":0.08},"atlas":"persian","art_index":3,"description":"A persian tradition that strengthens the whole account. Heritage bonuses apply while this is your account faction."}'::jsonb),
('persian-horse-archery','Horse Archery','heritage',2,'persian',253,276,'["persian-silk-caravans","libraries"]'::jsonb,'{"archers_attack":0.08}'::jsonb,'{"id":"persian-horse-archery","name":"Horse Archery","branch":"heritage","era":2,"stage":4,"lane":10,"faction":"persian","cost":253,"seconds":276,"requires":["persian-silk-caravans","libraries"],"effects":{"archers_attack":0.08},"atlas":"persian","art_index":4,"description":"A persian tradition that strengthens the whole account. Heritage bonuses apply while this is your account faction."}'::jsonb),
('persian-court-scholars','Court Scholars','heritage',2,'persian',304,331,'["persian-horse-archery"]'::jsonb,'{"science":0.08}'::jsonb,'{"id":"persian-court-scholars","name":"Court Scholars","branch":"heritage","era":2,"stage":5,"lane":10,"faction":"persian","cost":304,"seconds":331,"requires":["persian-horse-archery"],"effects":{"science":0.08},"atlas":"persian","art_index":5,"description":"A persian tradition that strengthens the whole account. Heritage bonuses apply while this is your account faction."}'::jsonb),
('persian-gardens-of-knowledge','Gardens of Knowledge','heritage',3,'persian',575,552,'["persian-court-scholars"]'::jsonb,'{"research_speed":0.12}'::jsonb,'{"id":"persian-gardens-of-knowledge","name":"Gardens of Knowledge","branch":"heritage","era":3,"stage":6,"lane":10,"faction":"persian","cost":575,"seconds":552,"requires":["persian-court-scholars"],"effects":{"research_speed":0.12},"atlas":"persian","art_index":6,"description":"A persian tradition that strengthens the whole account. Heritage bonuses apply while this is your account faction."}'::jsonb),
('persian-cataphract-armour','Cataphract Armour','heritage',3,'persian',690,662,'["persian-gardens-of-knowledge"]'::jsonb,'{"cavalry_defence":0.12}'::jsonb,'{"id":"persian-cataphract-armour","name":"Cataphract Armour","branch":"heritage","era":3,"stage":7,"lane":10,"faction":"persian","cost":690,"seconds":662,"requires":["persian-gardens-of-knowledge"],"effects":{"cavalry_defence":0.12},"atlas":"persian","art_index":7,"description":"A persian tradition that strengthens the whole account. Heritage bonuses apply while this is your account faction."}'::jsonb),
('persian-satrapal-estates','Satrapal Estates','heritage',4,'persian',1150,977,'["persian-cataphract-armour","philosophy"]'::jsonb,'{"gold":0.12}'::jsonb,'{"id":"persian-satrapal-estates","name":"Satrapal Estates","branch":"heritage","era":4,"stage":8,"lane":10,"faction":"persian","cost":1150,"seconds":977,"requires":["persian-cataphract-armour","philosophy"],"effects":{"gold":0.12},"atlas":"persian","art_index":8,"description":"A persian tradition that strengthens the whole account. Heritage bonuses apply while this is your account faction."}'::jsonb),
('persian-king-of-kings','King of Kings','heritage',4,'persian',1380,1173,'["persian-satrapal-estates"]'::jsonb,'{"culture":0.12}'::jsonb,'{"id":"persian-king-of-kings","name":"King of Kings","branch":"heritage","era":4,"stage":9,"lane":10,"faction":"persian","cost":1380,"seconds":1173,"requires":["persian-satrapal-estates"],"effects":{"culture":0.12},"atlas":"persian","art_index":9,"description":"A persian tradition that strengthens the whole account. Heritage bonuses apply while this is your account faction."}'::jsonb),
('egyptian-nile-irrigation','Nile Irrigation','heritage',0,'egyptian',40,34,'["writing"]'::jsonb,'{"food":0.08}'::jsonb,'{"id":"egyptian-nile-irrigation","name":"Nile Irrigation","branch":"heritage","era":0,"stage":0,"lane":10,"faction":"egyptian","cost":40,"seconds":34,"requires":["writing"],"effects":{"food":0.08},"atlas":"egyptian","art_index":0,"description":"A egyptian tradition that strengthens the whole account. Heritage bonuses apply while this is your account faction."}'::jsonb),
('egyptian-papyrus','Papyrus','heritage',0,'egyptian',48,41,'["egyptian-nile-irrigation"]'::jsonb,'{"science":0.08}'::jsonb,'{"id":"egyptian-papyrus","name":"Papyrus","branch":"heritage","era":0,"stage":1,"lane":10,"faction":"egyptian","cost":48,"seconds":41,"requires":["egyptian-nile-irrigation"],"effects":{"science":0.08},"atlas":"egyptian","art_index":1,"description":"A egyptian tradition that strengthens the whole account. Heritage bonuses apply while this is your account faction."}'::jsonb),
('egyptian-granary-scribes','Granary Scribes','heritage',1,'egyptian',103,103,'["egyptian-papyrus"]'::jsonb,'{"storage":0.08}'::jsonb,'{"id":"egyptian-granary-scribes","name":"Granary Scribes","branch":"heritage","era":1,"stage":2,"lane":10,"faction":"egyptian","cost":103,"seconds":103,"requires":["egyptian-papyrus"],"effects":{"storage":0.08},"atlas":"egyptian","art_index":2,"description":"A egyptian tradition that strengthens the whole account. Heritage bonuses apply while this is your account faction."}'::jsonb),
('egyptian-desert-scouts','Desert Scouts','heritage',1,'egyptian',124,124,'["egyptian-granary-scribes"]'::jsonb,'{"march":0.08}'::jsonb,'{"id":"egyptian-desert-scouts","name":"Desert Scouts","branch":"heritage","era":1,"stage":3,"lane":10,"faction":"egyptian","cost":124,"seconds":124,"requires":["egyptian-granary-scribes"],"effects":{"march":0.08},"atlas":"egyptian","art_index":3,"description":"A egyptian tradition that strengthens the whole account. Heritage bonuses apply while this is your account faction."}'::jsonb),
('egyptian-stone-obelisks','Stone Obelisks','heritage',2,'egyptian',253,276,'["egyptian-desert-scouts","libraries"]'::jsonb,'{"stone":0.08}'::jsonb,'{"id":"egyptian-stone-obelisks","name":"Stone Obelisks","branch":"heritage","era":2,"stage":4,"lane":10,"faction":"egyptian","cost":253,"seconds":276,"requires":["egyptian-desert-scouts","libraries"],"effects":{"stone":0.08},"atlas":"egyptian","art_index":4,"description":"A egyptian tradition that strengthens the whole account. Heritage bonuses apply while this is your account faction."}'::jsonb),
('egyptian-solar-temples','Solar Temples','heritage',2,'egyptian',304,331,'["egyptian-stone-obelisks"]'::jsonb,'{"culture":0.08}'::jsonb,'{"id":"egyptian-solar-temples","name":"Solar Temples","branch":"heritage","era":2,"stage":5,"lane":10,"faction":"egyptian","cost":304,"seconds":331,"requires":["egyptian-stone-obelisks"],"effects":{"culture":0.08},"atlas":"egyptian","art_index":5,"description":"A egyptian tradition that strengthens the whole account. Heritage bonuses apply while this is your account faction."}'::jsonb),
('egyptian-chariot-tactics','Chariot Tactics','heritage',3,'egyptian',575,552,'["egyptian-solar-temples"]'::jsonb,'{"cavalry_attack":0.12}'::jsonb,'{"id":"egyptian-chariot-tactics","name":"Chariot Tactics","branch":"heritage","era":3,"stage":6,"lane":10,"faction":"egyptian","cost":575,"seconds":552,"requires":["egyptian-solar-temples"],"effects":{"cavalry_attack":0.12},"atlas":"egyptian","art_index":6,"description":"A egyptian tradition that strengthens the whole account. Heritage bonuses apply while this is your account faction."}'::jsonb),
('egyptian-pyramid-engineering','Pyramid Engineering','heritage',3,'egyptian',690,662,'["egyptian-chariot-tactics"]'::jsonb,'{"construction":0.12}'::jsonb,'{"id":"egyptian-pyramid-engineering","name":"Pyramid Engineering","branch":"heritage","era":3,"stage":7,"lane":10,"faction":"egyptian","cost":690,"seconds":662,"requires":["egyptian-chariot-tactics"],"effects":{"construction":0.12},"atlas":"egyptian","art_index":7,"description":"A egyptian tradition that strengthens the whole account. Heritage bonuses apply while this is your account faction."}'::jsonb),
('egyptian-royal-necropolis','Royal Necropolis','heritage',4,'egyptian',1150,977,'["egyptian-pyramid-engineering","philosophy"]'::jsonb,'{"mana":0.12}'::jsonb,'{"id":"egyptian-royal-necropolis","name":"Royal Necropolis","branch":"heritage","era":4,"stage":8,"lane":10,"faction":"egyptian","cost":1150,"seconds":977,"requires":["egyptian-pyramid-engineering","philosophy"],"effects":{"mana":0.12},"atlas":"egyptian","art_index":8,"description":"A egyptian tradition that strengthens the whole account. Heritage bonuses apply while this is your account faction."}'::jsonb),
('egyptian-pharaonic-legacy','Pharaonic Legacy','heritage',4,'egyptian',1380,1173,'["egyptian-royal-necropolis"]'::jsonb,'{"hero_xp":0.12}'::jsonb,'{"id":"egyptian-pharaonic-legacy","name":"Pharaonic Legacy","branch":"heritage","era":4,"stage":9,"lane":10,"faction":"egyptian","cost":1380,"seconds":1173,"requires":["egyptian-royal-necropolis"],"effects":{"hero_xp":0.12},"atlas":"egyptian","art_index":9,"description":"A egyptian tradition that strengthens the whole account. Heritage bonuses apply while this is your account faction."}'::jsonb),
('orc-war-drums','War Drums','heritage',0,'orc',40,34,'["writing"]'::jsonb,'{"training":0.08}'::jsonb,'{"id":"orc-war-drums","name":"War Drums","branch":"heritage","era":0,"stage":0,"lane":10,"faction":"orc","cost":40,"seconds":34,"requires":["writing"],"effects":{"training":0.08},"atlas":"orc","art_index":0,"description":"A orc tradition that strengthens the whole account. Heritage bonuses apply while this is your account faction."}'::jsonb),
('orc-iron-tusks','Iron Tusks','heritage',0,'orc',48,41,'["orc-war-drums"]'::jsonb,'{"infantry_attack":0.08}'::jsonb,'{"id":"orc-iron-tusks","name":"Iron Tusks","branch":"heritage","era":0,"stage":1,"lane":10,"faction":"orc","cost":48,"seconds":41,"requires":["orc-war-drums"],"effects":{"infantry_attack":0.08},"atlas":"orc","art_index":1,"description":"A orc tradition that strengthens the whole account. Heritage bonuses apply while this is your account faction."}'::jsonb),
('orc-raider-packs','Raider Packs','heritage',1,'orc',103,103,'["orc-iron-tusks"]'::jsonb,'{"carry":0.08}'::jsonb,'{"id":"orc-raider-packs","name":"Raider Packs","branch":"heritage","era":1,"stage":2,"lane":10,"faction":"orc","cost":103,"seconds":103,"requires":["orc-iron-tusks"],"effects":{"carry":0.08},"atlas":"orc","art_index":2,"description":"A orc tradition that strengthens the whole account. Heritage bonuses apply while this is your account faction."}'::jsonb),
('orc-bone-armour','Bone Armour','heritage',1,'orc',124,124,'["orc-raider-packs"]'::jsonb,'{"defence":0.08}'::jsonb,'{"id":"orc-bone-armour","name":"Bone Armour","branch":"heritage","era":1,"stage":3,"lane":10,"faction":"orc","cost":124,"seconds":124,"requires":["orc-raider-packs"],"effects":{"defence":0.08},"atlas":"orc","art_index":3,"description":"A orc tradition that strengthens the whole account. Heritage bonuses apply while this is your account faction."}'::jsonb),
('orc-warg-riders','Warg Riders','heritage',2,'orc',253,276,'["orc-bone-armour","libraries"]'::jsonb,'{"cavalry_attack":0.08}'::jsonb,'{"id":"orc-warg-riders","name":"Warg Riders","branch":"heritage","era":2,"stage":4,"lane":10,"faction":"orc","cost":253,"seconds":276,"requires":["orc-bone-armour","libraries"],"effects":{"cavalry_attack":0.08},"atlas":"orc","art_index":4,"description":"A orc tradition that strengthens the whole account. Heritage bonuses apply while this is your account faction."}'::jsonb),
('orc-spoils-of-war','Spoils of War','heritage',2,'orc',304,331,'["orc-warg-riders"]'::jsonb,'{"gold":0.08}'::jsonb,'{"id":"orc-spoils-of-war","name":"Spoils of War","branch":"heritage","era":2,"stage":5,"lane":10,"faction":"orc","cost":304,"seconds":331,"requires":["orc-warg-riders"],"effects":{"gold":0.08},"atlas":"orc","art_index":5,"description":"A orc tradition that strengthens the whole account. Heritage bonuses apply while this is your account faction."}'::jsonb),
('orc-shaman-lore','Shaman Lore','heritage',3,'orc',575,552,'["orc-spoils-of-war"]'::jsonb,'{"spell_power":0.12}'::jsonb,'{"id":"orc-shaman-lore","name":"Shaman Lore","branch":"heritage","era":3,"stage":6,"lane":10,"faction":"orc","cost":575,"seconds":552,"requires":["orc-spoils-of-war"],"effects":{"spell_power":0.12},"atlas":"orc","art_index":6,"description":"A orc tradition that strengthens the whole account. Heritage bonuses apply while this is your account faction."}'::jsonb),
('orc-brutal-siege','Brutal Siege','heritage',3,'orc',690,662,'["orc-shaman-lore"]'::jsonb,'{"siege":0.12}'::jsonb,'{"id":"orc-brutal-siege","name":"Brutal Siege","branch":"heritage","era":3,"stage":7,"lane":10,"faction":"orc","cost":690,"seconds":662,"requires":["orc-shaman-lore"],"effects":{"siege":0.12},"atlas":"orc","art_index":7,"description":"A orc tradition that strengthens the whole account. Heritage bonuses apply while this is your account faction."}'::jsonb),
('orc-clan-forging','Clan Forging','heritage',4,'orc',1150,977,'["orc-brutal-siege","philosophy"]'::jsonb,'{"construction":0.12}'::jsonb,'{"id":"orc-clan-forging","name":"Clan Forging","branch":"heritage","era":4,"stage":8,"lane":10,"faction":"orc","cost":1150,"seconds":977,"requires":["orc-brutal-siege","philosophy"],"effects":{"construction":0.12},"atlas":"orc","art_index":8,"description":"A orc tradition that strengthens the whole account. Heritage bonuses apply while this is your account faction."}'::jsonb),
('orc-warchief-legacy','Warchief Legacy','heritage',4,'orc',1380,1173,'["orc-clan-forging"]'::jsonb,'{"attack":0.12}'::jsonb,'{"id":"orc-warchief-legacy","name":"Warchief Legacy","branch":"heritage","era":4,"stage":9,"lane":10,"faction":"orc","cost":1380,"seconds":1173,"requires":["orc-clan-forging"],"effects":{"attack":0.12},"atlas":"orc","art_index":9,"description":"A orc tradition that strengthens the whole account. Heritage bonuses apply while this is your account faction."}'::jsonb),
('elf-living-groves','Living Groves','heritage',0,'elf',40,34,'["writing"]'::jsonb,'{"wood":0.08}'::jsonb,'{"id":"elf-living-groves","name":"Living Groves","branch":"heritage","era":0,"stage":0,"lane":10,"faction":"elf","cost":40,"seconds":34,"requires":["writing"],"effects":{"wood":0.08},"atlas":"elf","art_index":0,"description":"A elf tradition that strengthens the whole account. Heritage bonuses apply while this is your account faction."}'::jsonb),
('elf-moon-arrows','Moon Arrows','heritage',0,'elf',48,41,'["elf-living-groves"]'::jsonb,'{"archers_attack":0.08}'::jsonb,'{"id":"elf-moon-arrows","name":"Moon Arrows","branch":"heritage","era":0,"stage":1,"lane":10,"faction":"elf","cost":48,"seconds":41,"requires":["elf-living-groves"],"effects":{"archers_attack":0.08},"atlas":"elf","art_index":1,"description":"A elf tradition that strengthens the whole account. Heritage bonuses apply while this is your account faction."}'::jsonb),
('elf-silver-bark','Silver Bark','heritage',1,'elf',103,103,'["elf-moon-arrows"]'::jsonb,'{"defence":0.08}'::jsonb,'{"id":"elf-silver-bark","name":"Silver Bark","branch":"heritage","era":1,"stage":2,"lane":10,"faction":"elf","cost":103,"seconds":103,"requires":["elf-moon-arrows"],"effects":{"defence":0.08},"atlas":"elf","art_index":2,"description":"A elf tradition that strengthens the whole account. Heritage bonuses apply while this is your account faction."}'::jsonb),
('elf-stag-riders','Stag Riders','heritage',1,'elf',124,124,'["elf-silver-bark"]'::jsonb,'{"cavalry_defence":0.08}'::jsonb,'{"id":"elf-stag-riders","name":"Stag Riders","branch":"heritage","era":1,"stage":3,"lane":10,"faction":"elf","cost":124,"seconds":124,"requires":["elf-silver-bark"],"effects":{"cavalry_defence":0.08},"atlas":"elf","art_index":3,"description":"A elf tradition that strengthens the whole account. Heritage bonuses apply while this is your account faction."}'::jsonb),
('elf-forest-wardens','Forest Wardens','heritage',2,'elf',253,276,'["elf-stag-riders","libraries"]'::jsonb,'{"march":0.08}'::jsonb,'{"id":"elf-forest-wardens","name":"Forest Wardens","branch":"heritage","era":2,"stage":4,"lane":10,"faction":"elf","cost":253,"seconds":276,"requires":["elf-stag-riders","libraries"],"effects":{"march":0.08},"atlas":"elf","art_index":4,"description":"A elf tradition that strengthens the whole account. Heritage bonuses apply while this is your account faction."}'::jsonb),
('elf-crystal-lore','Crystal Lore','heritage',2,'elf',304,331,'["elf-forest-wardens"]'::jsonb,'{"science":0.08}'::jsonb,'{"id":"elf-crystal-lore","name":"Crystal Lore","branch":"heritage","era":2,"stage":5,"lane":10,"faction":"elf","cost":304,"seconds":331,"requires":["elf-forest-wardens"],"effects":{"science":0.08},"atlas":"elf","art_index":5,"description":"A elf tradition that strengthens the whole account. Heritage bonuses apply while this is your account faction."}'::jsonb),
('elf-sylvan-harvest','Sylvan Harvest','heritage',3,'elf',575,552,'["elf-crystal-lore"]'::jsonb,'{"food":0.12}'::jsonb,'{"id":"elf-sylvan-harvest","name":"Sylvan Harvest","branch":"heritage","era":3,"stage":6,"lane":10,"faction":"elf","cost":575,"seconds":552,"requires":["elf-crystal-lore"],"effects":{"food":0.12},"atlas":"elf","art_index":6,"description":"A elf tradition that strengthens the whole account. Heritage bonuses apply while this is your account faction."}'::jsonb),
('elf-ancient-songs','Ancient Songs','heritage',3,'elf',690,662,'["elf-sylvan-harvest"]'::jsonb,'{"culture":0.12}'::jsonb,'{"id":"elf-ancient-songs","name":"Ancient Songs","branch":"heritage","era":3,"stage":7,"lane":10,"faction":"elf","cost":690,"seconds":662,"requires":["elf-sylvan-harvest"],"effects":{"culture":0.12},"atlas":"elf","art_index":7,"description":"A elf tradition that strengthens the whole account. Heritage bonuses apply while this is your account faction."}'::jsonb),
('elf-star-sight','Star Sight','heritage',4,'elf',1150,977,'["elf-ancient-songs","philosophy"]'::jsonb,'{"spell_power":0.12}'::jsonb,'{"id":"elf-star-sight","name":"Star Sight","branch":"heritage","era":4,"stage":8,"lane":10,"faction":"elf","cost":1150,"seconds":977,"requires":["elf-ancient-songs","philosophy"],"effects":{"spell_power":0.12},"atlas":"elf","art_index":8,"description":"A elf tradition that strengthens the whole account. Heritage bonuses apply while this is your account faction."}'::jsonb),
('elf-elder-wisdom','Elder Wisdom','heritage',4,'elf',1380,1173,'["elf-star-sight"]'::jsonb,'{"research_speed":0.12}'::jsonb,'{"id":"elf-elder-wisdom","name":"Elder Wisdom","branch":"heritage","era":4,"stage":9,"lane":10,"faction":"elf","cost":1380,"seconds":1173,"requires":["elf-star-sight"],"effects":{"research_speed":0.12},"atlas":"elf","art_index":9,"description":"A elf tradition that strengthens the whole account. Heritage bonuses apply while this is your account faction."}'::jsonb),
('dwarf-mountain-mining','Mountain Mining','heritage',0,'dwarf',40,34,'["writing"]'::jsonb,'{"stone":0.08}'::jsonb,'{"id":"dwarf-mountain-mining","name":"Mountain Mining","branch":"heritage","era":0,"stage":0,"lane":10,"faction":"dwarf","cost":40,"seconds":34,"requires":["writing"],"effects":{"stone":0.08},"atlas":"dwarf","art_index":0,"description":"A dwarf tradition that strengthens the whole account. Heritage bonuses apply while this is your account faction."}'::jsonb),
('dwarf-rune-carving','Rune Carving','heritage',0,'dwarf',48,41,'["dwarf-mountain-mining"]'::jsonb,'{"science":0.08}'::jsonb,'{"id":"dwarf-rune-carving","name":"Rune Carving","branch":"heritage","era":0,"stage":1,"lane":10,"faction":"dwarf","cost":48,"seconds":41,"requires":["dwarf-mountain-mining"],"effects":{"science":0.08},"atlas":"dwarf","art_index":1,"description":"A dwarf tradition that strengthens the whole account. Heritage bonuses apply while this is your account faction."}'::jsonb),
('dwarf-deep-vaults','Deep Vaults','heritage',1,'dwarf',103,103,'["dwarf-rune-carving"]'::jsonb,'{"storage":0.08}'::jsonb,'{"id":"dwarf-deep-vaults","name":"Deep Vaults","branch":"heritage","era":1,"stage":2,"lane":10,"faction":"dwarf","cost":103,"seconds":103,"requires":["dwarf-rune-carving"],"effects":{"storage":0.08},"atlas":"dwarf","art_index":2,"description":"A dwarf tradition that strengthens the whole account. Heritage bonuses apply while this is your account faction."}'::jsonb),
('dwarf-steel-axes','Steel Axes','heritage',1,'dwarf',124,124,'["dwarf-deep-vaults"]'::jsonb,'{"infantry_attack":0.08}'::jsonb,'{"id":"dwarf-steel-axes","name":"Steel Axes","branch":"heritage","era":1,"stage":3,"lane":10,"faction":"dwarf","cost":124,"seconds":124,"requires":["dwarf-deep-vaults"],"effects":{"infantry_attack":0.08},"atlas":"dwarf","art_index":3,"description":"A dwarf tradition that strengthens the whole account. Heritage bonuses apply while this is your account faction."}'::jsonb),
('dwarf-heavy-mail','Heavy Mail','heritage',2,'dwarf',253,276,'["dwarf-steel-axes","libraries"]'::jsonb,'{"infantry_defence":0.08}'::jsonb,'{"id":"dwarf-heavy-mail","name":"Heavy Mail","branch":"heritage","era":2,"stage":4,"lane":10,"faction":"dwarf","cost":253,"seconds":276,"requires":["dwarf-steel-axes","libraries"],"effects":{"infantry_defence":0.08},"atlas":"dwarf","art_index":4,"description":"A dwarf tradition that strengthens the whole account. Heritage bonuses apply while this is your account faction."}'::jsonb),
('dwarf-geared-siege','Geared Siege','heritage',2,'dwarf',304,331,'["dwarf-heavy-mail"]'::jsonb,'{"siege":0.08}'::jsonb,'{"id":"dwarf-geared-siege","name":"Geared Siege","branch":"heritage","era":2,"stage":5,"lane":10,"faction":"dwarf","cost":304,"seconds":331,"requires":["dwarf-heavy-mail"],"effects":{"siege":0.08},"atlas":"dwarf","art_index":5,"description":"A dwarf tradition that strengthens the whole account. Heritage bonuses apply while this is your account faction."}'::jsonb),
('dwarf-stone-halls','Stone Halls','heritage',3,'dwarf',575,552,'["dwarf-geared-siege"]'::jsonb,'{"construction":0.12}'::jsonb,'{"id":"dwarf-stone-halls","name":"Stone Halls","branch":"heritage","era":3,"stage":6,"lane":10,"faction":"dwarf","cost":575,"seconds":552,"requires":["dwarf-geared-siege"],"effects":{"construction":0.12},"atlas":"dwarf","art_index":6,"description":"A dwarf tradition that strengthens the whole account. Heritage bonuses apply while this is your account faction."}'::jsonb),
('dwarf-tunnel-roads','Tunnel Roads','heritage',3,'dwarf',690,662,'["dwarf-stone-halls"]'::jsonb,'{"march":0.12}'::jsonb,'{"id":"dwarf-tunnel-roads","name":"Tunnel Roads","branch":"heritage","era":3,"stage":7,"lane":10,"faction":"dwarf","cost":690,"seconds":662,"requires":["dwarf-stone-halls"],"effects":{"march":0.12},"atlas":"dwarf","art_index":7,"description":"A dwarf tradition that strengthens the whole account. Heritage bonuses apply while this is your account faction."}'::jsonb),
('dwarf-master-forging','Master Forging','heritage',4,'dwarf',1150,977,'["dwarf-tunnel-roads","philosophy"]'::jsonb,'{"training":0.12}'::jsonb,'{"id":"dwarf-master-forging","name":"Master Forging","branch":"heritage","era":4,"stage":8,"lane":10,"faction":"dwarf","cost":1150,"seconds":977,"requires":["dwarf-tunnel-roads","philosophy"],"effects":{"training":0.12},"atlas":"dwarf","art_index":8,"description":"A dwarf tradition that strengthens the whole account. Heritage bonuses apply while this is your account faction."}'::jsonb),
('dwarf-ancestral-runes','Ancestral Runes','heritage',4,'dwarf',1380,1173,'["dwarf-master-forging"]'::jsonb,'{"spell_power":0.12}'::jsonb,'{"id":"dwarf-ancestral-runes","name":"Ancestral Runes","branch":"heritage","era":4,"stage":9,"lane":10,"faction":"dwarf","cost":1380,"seconds":1173,"requires":["dwarf-master-forging"],"effects":{"spell_power":0.12},"atlas":"dwarf","art_index":9,"description":"A dwarf tradition that strengthens the whole account. Heritage bonuses apply while this is your account faction."}'::jsonb),
('gnome-clockwork-tools','Clockwork Tools','heritage',0,'gnome',40,34,'["writing"]'::jsonb,'{"construction":0.08}'::jsonb,'{"id":"gnome-clockwork-tools","name":"Clockwork Tools","branch":"heritage","era":0,"stage":0,"lane":10,"faction":"gnome","cost":40,"seconds":34,"requires":["writing"],"effects":{"construction":0.08},"atlas":"gnome","art_index":0,"description":"A gnome tradition that strengthens the whole account. Heritage bonuses apply while this is your account faction."}'::jsonb),
('gnome-precision-optics','Precision Optics','heritage',0,'gnome',48,41,'["gnome-clockwork-tools"]'::jsonb,'{"archers_attack":0.08}'::jsonb,'{"id":"gnome-precision-optics","name":"Precision Optics","branch":"heritage","era":0,"stage":1,"lane":10,"faction":"gnome","cost":48,"seconds":41,"requires":["gnome-clockwork-tools"],"effects":{"archers_attack":0.08},"atlas":"gnome","art_index":1,"description":"A gnome tradition that strengthens the whole account. Heritage bonuses apply while this is your account faction."}'::jsonb),
('gnome-automata','Automata','heritage',1,'gnome',103,103,'["gnome-precision-optics"]'::jsonb,'{"training":0.08}'::jsonb,'{"id":"gnome-automata","name":"Automata","branch":"heritage","era":1,"stage":2,"lane":10,"faction":"gnome","cost":103,"seconds":103,"requires":["gnome-precision-optics"],"effects":{"training":0.08},"atlas":"gnome","art_index":2,"description":"A gnome tradition that strengthens the whole account. Heritage bonuses apply while this is your account faction."}'::jsonb),
('gnome-gearworks','Gearworks','heritage',1,'gnome',124,124,'["gnome-automata"]'::jsonb,'{"gold":0.08}'::jsonb,'{"id":"gnome-gearworks","name":"Gearworks","branch":"heritage","era":1,"stage":3,"lane":10,"faction":"gnome","cost":124,"seconds":124,"requires":["gnome-automata"],"effects":{"gold":0.08},"atlas":"gnome","art_index":3,"description":"A gnome tradition that strengthens the whole account. Heritage bonuses apply while this is your account faction."}'::jsonb),
('gnome-mechanical-siege','Mechanical Siege','heritage',2,'gnome',253,276,'["gnome-gearworks","libraries"]'::jsonb,'{"siege":0.08}'::jsonb,'{"id":"gnome-mechanical-siege","name":"Mechanical Siege","branch":"heritage","era":2,"stage":4,"lane":10,"faction":"gnome","cost":253,"seconds":276,"requires":["gnome-gearworks","libraries"],"effects":{"siege":0.08},"atlas":"gnome","art_index":4,"description":"A gnome tradition that strengthens the whole account. Heritage bonuses apply while this is your account faction."}'::jsonb),
('gnome-workshop-science','Workshop Science','heritage',2,'gnome',304,331,'["gnome-mechanical-siege"]'::jsonb,'{"science":0.08}'::jsonb,'{"id":"gnome-workshop-science","name":"Workshop Science","branch":"heritage","era":2,"stage":5,"lane":10,"faction":"gnome","cost":304,"seconds":331,"requires":["gnome-mechanical-siege"],"effects":{"science":0.08},"atlas":"gnome","art_index":5,"description":"A gnome tradition that strengthens the whole account. Heritage bonuses apply while this is your account faction."}'::jsonb),
('gnome-rat-couriers','Rat Couriers','heritage',3,'gnome',575,552,'["gnome-workshop-science"]'::jsonb,'{"march":0.12}'::jsonb,'{"id":"gnome-rat-couriers","name":"Rat Couriers","branch":"heritage","era":3,"stage":6,"lane":10,"faction":"gnome","cost":575,"seconds":552,"requires":["gnome-workshop-science"],"effects":{"march":0.12},"atlas":"gnome","art_index":6,"description":"A gnome tradition that strengthens the whole account. Heritage bonuses apply while this is your account faction."}'::jsonb),
('gnome-alchemy','Alchemy','heritage',3,'gnome',690,662,'["gnome-rat-couriers"]'::jsonb,'{"spell_power":0.12}'::jsonb,'{"id":"gnome-alchemy","name":"Alchemy","branch":"heritage","era":3,"stage":7,"lane":10,"faction":"gnome","cost":690,"seconds":662,"requires":["gnome-rat-couriers"],"effects":{"spell_power":0.12},"atlas":"gnome","art_index":7,"description":"A gnome tradition that strengthens the whole account. Heritage bonuses apply while this is your account faction."}'::jsonb),
('gnome-patent-houses','Patent Houses','heritage',4,'gnome',1150,977,'["gnome-alchemy","philosophy"]'::jsonb,'{"trade":0.12}'::jsonb,'{"id":"gnome-patent-houses","name":"Patent Houses","branch":"heritage","era":4,"stage":8,"lane":10,"faction":"gnome","cost":1150,"seconds":977,"requires":["gnome-alchemy","philosophy"],"effects":{"trade":0.12},"atlas":"gnome","art_index":8,"description":"A gnome tradition that strengthens the whole account. Heritage bonuses apply while this is your account faction."}'::jsonb),
('gnome-grand-invention','Grand Invention','heritage',4,'gnome',1380,1173,'["gnome-patent-houses"]'::jsonb,'{"research_speed":0.12}'::jsonb,'{"id":"gnome-grand-invention","name":"Grand Invention","branch":"heritage","era":4,"stage":9,"lane":10,"faction":"gnome","cost":1380,"seconds":1173,"requires":["gnome-patent-houses"],"effects":{"research_speed":0.12},"atlas":"gnome","art_index":9,"description":"A gnome tradition that strengthens the whole account. Heritage bonuses apply while this is your account faction."}'::jsonb),
('pandaren-bamboo-craft','Bamboo Craft','heritage',0,'pandaren',40,34,'["writing"]'::jsonb,'{"wood":0.08}'::jsonb,'{"id":"pandaren-bamboo-craft","name":"Bamboo Craft","branch":"heritage","era":0,"stage":0,"lane":10,"faction":"pandaren","cost":40,"seconds":34,"requires":["writing"],"effects":{"wood":0.08},"atlas":"pandaren","art_index":0,"description":"A pandaren tradition that strengthens the whole account. Heritage bonuses apply while this is your account faction."}'::jsonb),
('pandaren-rice-terraces','Rice Terraces','heritage',0,'pandaren',48,41,'["pandaren-bamboo-craft"]'::jsonb,'{"food":0.08}'::jsonb,'{"id":"pandaren-rice-terraces","name":"Rice Terraces","branch":"heritage","era":0,"stage":1,"lane":10,"faction":"pandaren","cost":48,"seconds":41,"requires":["pandaren-bamboo-craft"],"effects":{"food":0.08},"atlas":"pandaren","art_index":1,"description":"A pandaren tradition that strengthens the whole account. Heritage bonuses apply while this is your account faction."}'::jsonb),
('pandaren-tea-houses','Tea Houses','heritage',1,'pandaren',103,103,'["pandaren-rice-terraces"]'::jsonb,'{"culture":0.08}'::jsonb,'{"id":"pandaren-tea-houses","name":"Tea Houses","branch":"heritage","era":1,"stage":2,"lane":10,"faction":"pandaren","cost":103,"seconds":103,"requires":["pandaren-rice-terraces"],"effects":{"culture":0.08},"atlas":"pandaren","art_index":2,"description":"A pandaren tradition that strengthens the whole account. Heritage bonuses apply while this is your account faction."}'::jsonb),
('pandaren-martial-forms','Martial Forms','heritage',1,'pandaren',124,124,'["pandaren-tea-houses"]'::jsonb,'{"infantry_defence":0.08}'::jsonb,'{"id":"pandaren-martial-forms","name":"Martial Forms","branch":"heritage","era":1,"stage":3,"lane":10,"faction":"pandaren","cost":124,"seconds":124,"requires":["pandaren-tea-houses"],"effects":{"infantry_defence":0.08},"atlas":"pandaren","art_index":3,"description":"A pandaren tradition that strengthens the whole account. Heritage bonuses apply while this is your account faction."}'::jsonb),
('pandaren-silk-markets','Silk Markets','heritage',2,'pandaren',253,276,'["pandaren-martial-forms","libraries"]'::jsonb,'{"trade":0.08}'::jsonb,'{"id":"pandaren-silk-markets","name":"Silk Markets","branch":"heritage","era":2,"stage":4,"lane":10,"faction":"pandaren","cost":253,"seconds":276,"requires":["pandaren-martial-forms","libraries"],"effects":{"trade":0.08},"atlas":"pandaren","art_index":4,"description":"A pandaren tradition that strengthens the whole account. Heritage bonuses apply while this is your account faction."}'::jsonb),
('pandaren-jade-wisdom','Jade Wisdom','heritage',2,'pandaren',304,331,'["pandaren-silk-markets"]'::jsonb,'{"science":0.08}'::jsonb,'{"id":"pandaren-jade-wisdom","name":"Jade Wisdom","branch":"heritage","era":2,"stage":5,"lane":10,"faction":"pandaren","cost":304,"seconds":331,"requires":["pandaren-silk-markets"],"effects":{"science":0.08},"atlas":"pandaren","art_index":5,"description":"A pandaren tradition that strengthens the whole account. Heritage bonuses apply while this is your account faction."}'::jsonb),
('pandaren-mountain-monasteries','Mountain Monasteries','heritage',3,'pandaren',575,552,'["pandaren-jade-wisdom"]'::jsonb,'{"training":0.12}'::jsonb,'{"id":"pandaren-mountain-monasteries","name":"Mountain Monasteries","branch":"heritage","era":3,"stage":6,"lane":10,"faction":"pandaren","cost":575,"seconds":552,"requires":["pandaren-jade-wisdom"],"effects":{"training":0.12},"atlas":"pandaren","art_index":6,"description":"A pandaren tradition that strengthens the whole account. Heritage bonuses apply while this is your account faction."}'::jsonb),
('pandaren-dragon-breath','Dragon Breath','heritage',3,'pandaren',690,662,'["pandaren-mountain-monasteries"]'::jsonb,'{"spell_power":0.12}'::jsonb,'{"id":"pandaren-dragon-breath","name":"Dragon Breath","branch":"heritage","era":3,"stage":7,"lane":10,"faction":"pandaren","cost":690,"seconds":662,"requires":["pandaren-mountain-monasteries"],"effects":{"spell_power":0.12},"atlas":"pandaren","art_index":7,"description":"A pandaren tradition that strengthens the whole account. Heritage bonuses apply while this is your account faction."}'::jsonb),
('pandaren-golden-harvest','Golden Harvest','heritage',4,'pandaren',1150,977,'["pandaren-dragon-breath","philosophy"]'::jsonb,'{"gold":0.12}'::jsonb,'{"id":"pandaren-golden-harvest","name":"Golden Harvest","branch":"heritage","era":4,"stage":8,"lane":10,"faction":"pandaren","cost":1150,"seconds":977,"requires":["pandaren-dragon-breath","philosophy"],"effects":{"gold":0.12},"atlas":"pandaren","art_index":8,"description":"A pandaren tradition that strengthens the whole account. Heritage bonuses apply while this is your account faction."}'::jsonb),
('pandaren-celestial-harmony','Celestial Harmony','heritage',4,'pandaren',1380,1173,'["pandaren-golden-harvest"]'::jsonb,'{"mana":0.12}'::jsonb,'{"id":"pandaren-celestial-harmony","name":"Celestial Harmony","branch":"heritage","era":4,"stage":9,"lane":10,"faction":"pandaren","cost":1380,"seconds":1173,"requires":["pandaren-golden-harvest"],"effects":{"mana":0.12},"atlas":"pandaren","art_index":9,"description":"A pandaren tradition that strengthens the whole account. Heritage bonuses apply while this is your account faction."}'::jsonb),
('undead-grave-lore','Grave Lore','heritage',0,'undead',40,34,'["writing"]'::jsonb,'{"science":0.08}'::jsonb,'{"id":"undead-grave-lore","name":"Grave Lore","branch":"heritage","era":0,"stage":0,"lane":10,"faction":"undead","cost":40,"seconds":34,"requires":["writing"],"effects":{"science":0.08},"atlas":"undead","art_index":0,"description":"A undead tradition that strengthens the whole account. Heritage bonuses apply while this is your account faction."}'::jsonb),
('undead-bone-legion','Bone Legion','heritage',0,'undead',48,41,'["undead-grave-lore"]'::jsonb,'{"infantry_defence":0.08}'::jsonb,'{"id":"undead-bone-legion","name":"Bone Legion","branch":"heritage","era":0,"stage":1,"lane":10,"faction":"undead","cost":48,"seconds":41,"requires":["undead-grave-lore"],"effects":{"infantry_defence":0.08},"atlas":"undead","art_index":1,"description":"A undead tradition that strengthens the whole account. Heritage bonuses apply while this is your account faction."}'::jsonb),
('undead-crypt-vaults','Crypt Vaults','heritage',1,'undead',103,103,'["undead-bone-legion"]'::jsonb,'{"storage":0.08}'::jsonb,'{"id":"undead-crypt-vaults","name":"Crypt Vaults","branch":"heritage","era":1,"stage":2,"lane":10,"faction":"undead","cost":103,"seconds":103,"requires":["undead-bone-legion"],"effects":{"storage":0.08},"atlas":"undead","art_index":2,"description":"A undead tradition that strengthens the whole account. Heritage bonuses apply while this is your account faction."}'::jsonb),
('undead-soul-binding','Soul Binding','heritage',1,'undead',124,124,'["undead-crypt-vaults"]'::jsonb,'{"mana":0.08}'::jsonb,'{"id":"undead-soul-binding","name":"Soul Binding","branch":"heritage","era":1,"stage":3,"lane":10,"faction":"undead","cost":124,"seconds":124,"requires":["undead-crypt-vaults"],"effects":{"mana":0.08},"atlas":"undead","art_index":3,"description":"A undead tradition that strengthens the whole account. Heritage bonuses apply while this is your account faction."}'::jsonb),
('undead-dark-scholars','Dark Scholars','heritage',2,'undead',253,276,'["undead-soul-binding","libraries"]'::jsonb,'{"research_speed":0.08}'::jsonb,'{"id":"undead-dark-scholars","name":"Dark Scholars","branch":"heritage","era":2,"stage":4,"lane":10,"faction":"undead","cost":253,"seconds":276,"requires":["undead-soul-binding","libraries"],"effects":{"research_speed":0.08},"atlas":"undead","art_index":4,"description":"A undead tradition that strengthens the whole account. Heritage bonuses apply while this is your account faction."}'::jsonb),
('undead-spectral-march','Spectral March','heritage',2,'undead',304,331,'["undead-dark-scholars"]'::jsonb,'{"march":0.08}'::jsonb,'{"id":"undead-spectral-march","name":"Spectral March","branch":"heritage","era":2,"stage":5,"lane":10,"faction":"undead","cost":304,"seconds":331,"requires":["undead-dark-scholars"],"effects":{"march":0.08},"atlas":"undead","art_index":5,"description":"A undead tradition that strengthens the whole account. Heritage bonuses apply while this is your account faction."}'::jsonb),
('undead-necromantic-rites','Necromantic Rites','heritage',3,'undead',575,552,'["undead-spectral-march"]'::jsonb,'{"spell_power":0.12}'::jsonb,'{"id":"undead-necromantic-rites","name":"Necromantic Rites","branch":"heritage","era":3,"stage":6,"lane":10,"faction":"undead","cost":575,"seconds":552,"requires":["undead-spectral-march"],"effects":{"spell_power":0.12},"atlas":"undead","art_index":6,"description":"A undead tradition that strengthens the whole account. Heritage bonuses apply while this is your account faction."}'::jsonb),
('undead-black-citadels','Black Citadels','heritage',3,'undead',690,662,'["undead-necromantic-rites"]'::jsonb,'{"construction":0.12}'::jsonb,'{"id":"undead-black-citadels","name":"Black Citadels","branch":"heritage","era":3,"stage":7,"lane":10,"faction":"undead","cost":690,"seconds":662,"requires":["undead-necromantic-rites"],"effects":{"construction":0.12},"atlas":"undead","art_index":7,"description":"A undead tradition that strengthens the whole account. Heritage bonuses apply while this is your account faction."}'::jsonb),
('undead-death-knights','Death Knights','heritage',4,'undead',1150,977,'["undead-black-citadels","philosophy"]'::jsonb,'{"cavalry_attack":0.12}'::jsonb,'{"id":"undead-death-knights","name":"Death Knights","branch":"heritage","era":4,"stage":8,"lane":10,"faction":"undead","cost":1150,"seconds":977,"requires":["undead-black-citadels","philosophy"],"effects":{"cavalry_attack":0.12},"atlas":"undead","art_index":8,"description":"A undead tradition that strengthens the whole account. Heritage bonuses apply while this is your account faction."}'::jsonb),
('undead-lich-ascendancy','Lich Ascendancy','heritage',4,'undead',1380,1173,'["undead-death-knights"]'::jsonb,'{"hero_xp":0.12}'::jsonb,'{"id":"undead-lich-ascendancy","name":"Lich Ascendancy","branch":"heritage","era":4,"stage":9,"lane":10,"faction":"undead","cost":1380,"seconds":1173,"requires":["undead-death-knights"],"effects":{"hero_xp":0.12},"atlas":"undead","art_index":9,"description":"A undead tradition that strengthens the whole account. Heritage bonuses apply while this is your account faction."}'::jsonb),
('demon-hellforging','Hellforging','heritage',0,'demon',40,34,'["writing"]'::jsonb,'{"infantry_attack":0.08}'::jsonb,'{"id":"demon-hellforging","name":"Hellforging","branch":"heritage","era":0,"stage":0,"lane":10,"faction":"demon","cost":40,"seconds":34,"requires":["writing"],"effects":{"infantry_attack":0.08},"atlas":"demon","art_index":0,"description":"A demon tradition that strengthens the whole account. Heritage bonuses apply while this is your account faction."}'::jsonb),
('demon-ember-bolts','Ember Bolts','heritage',0,'demon',48,41,'["demon-hellforging"]'::jsonb,'{"archers_attack":0.08}'::jsonb,'{"id":"demon-ember-bolts","name":"Ember Bolts","branch":"heritage","era":0,"stage":1,"lane":10,"faction":"demon","cost":48,"seconds":41,"requires":["demon-hellforging"],"effects":{"archers_attack":0.08},"atlas":"demon","art_index":1,"description":"A demon tradition that strengthens the whole account. Heritage bonuses apply while this is your account faction."}'::jsonb),
('demon-infernal-engines','Infernal Engines','heritage',1,'demon',103,103,'["demon-ember-bolts"]'::jsonb,'{"siege":0.08}'::jsonb,'{"id":"demon-infernal-engines","name":"Infernal Engines","branch":"heritage","era":1,"stage":2,"lane":10,"faction":"demon","cost":103,"seconds":103,"requires":["demon-ember-bolts"],"effects":{"siege":0.08},"atlas":"demon","art_index":2,"description":"A demon tradition that strengthens the whole account. Heritage bonuses apply while this is your account faction."}'::jsonb),
('demon-soul-bargains','Soul Bargains','heritage',1,'demon',124,124,'["demon-infernal-engines"]'::jsonb,'{"trade":0.08}'::jsonb,'{"id":"demon-soul-bargains","name":"Soul Bargains","branch":"heritage","era":1,"stage":3,"lane":10,"faction":"demon","cost":124,"seconds":124,"requires":["demon-infernal-engines"],"effects":{"trade":0.08},"atlas":"demon","art_index":3,"description":"A demon tradition that strengthens the whole account. Heritage bonuses apply while this is your account faction."}'::jsonb),
('demon-obsidian-armour','Obsidian Armour','heritage',2,'demon',253,276,'["demon-soul-bargains","libraries"]'::jsonb,'{"defence":0.08}'::jsonb,'{"id":"demon-obsidian-armour","name":"Obsidian Armour","branch":"heritage","era":2,"stage":4,"lane":10,"faction":"demon","cost":253,"seconds":276,"requires":["demon-soul-bargains","libraries"],"effects":{"defence":0.08},"atlas":"demon","art_index":4,"description":"A demon tradition that strengthens the whole account. Heritage bonuses apply while this is your account faction."}'::jsonb),
('demon-flame-scholars','Flame Scholars','heritage',2,'demon',304,331,'["demon-obsidian-armour"]'::jsonb,'{"science":0.08}'::jsonb,'{"id":"demon-flame-scholars","name":"Flame Scholars","branch":"heritage","era":2,"stage":5,"lane":10,"faction":"demon","cost":304,"seconds":331,"requires":["demon-obsidian-armour"],"effects":{"science":0.08},"atlas":"demon","art_index":5,"description":"A demon tradition that strengthens the whole account. Heritage bonuses apply while this is your account faction."}'::jsonb),
('demon-abyssal-gates','Abyssal Gates','heritage',3,'demon',575,552,'["demon-flame-scholars"]'::jsonb,'{"march":0.12}'::jsonb,'{"id":"demon-abyssal-gates","name":"Abyssal Gates","branch":"heritage","era":3,"stage":6,"lane":10,"faction":"demon","cost":575,"seconds":552,"requires":["demon-flame-scholars"],"effects":{"march":0.12},"atlas":"demon","art_index":6,"description":"A demon tradition that strengthens the whole account. Heritage bonuses apply while this is your account faction."}'::jsonb),
('demon-demonic-warbands','Demonic Warbands','heritage',3,'demon',690,662,'["demon-abyssal-gates"]'::jsonb,'{"training":0.12}'::jsonb,'{"id":"demon-demonic-warbands","name":"Demonic Warbands","branch":"heritage","era":3,"stage":7,"lane":10,"faction":"demon","cost":690,"seconds":662,"requires":["demon-abyssal-gates"],"effects":{"training":0.12},"atlas":"demon","art_index":7,"description":"A demon tradition that strengthens the whole account. Heritage bonuses apply while this is your account faction."}'::jsonb),
('demon-infernal-dominion','Infernal Dominion','heritage',4,'demon',1150,977,'["demon-demonic-warbands","philosophy"]'::jsonb,'{"culture":0.12}'::jsonb,'{"id":"demon-infernal-dominion","name":"Infernal Dominion","branch":"heritage","era":4,"stage":8,"lane":10,"faction":"demon","cost":1150,"seconds":977,"requires":["demon-demonic-warbands","philosophy"],"effects":{"culture":0.12},"atlas":"demon","art_index":8,"description":"A demon tradition that strengthens the whole account. Heritage bonuses apply while this is your account faction."}'::jsonb),
('demon-archfiend-legacy','Archfiend Legacy','heritage',4,'demon',1380,1173,'["demon-infernal-dominion"]'::jsonb,'{"spell_power":0.12}'::jsonb,'{"id":"demon-archfiend-legacy","name":"Archfiend Legacy","branch":"heritage","era":4,"stage":9,"lane":10,"faction":"demon","cost":1380,"seconds":1173,"requires":["demon-infernal-dominion"],"effects":{"spell_power":0.12},"atlas":"demon","art_index":9,"description":"A demon tradition that strengthens the whole account. Heritage bonuses apply while this is your account faction."}'::jsonb)
on conflict(id)do update set name=excluded.name,branch=excluded.branch,era=excluded.era,faction=excluded.faction,cost=excluded.cost,seconds=excluded.seconds,prerequisites=excluded.prerequisites,effects=excluded.effects,metadata=excluded.metadata;
-- Repeatable city plots; legacy buildings are retained for save compatibility.
alter table public.settlements add column if not exists food_capacity integer not null default 5000;
alter table public.settlements add column if not exists city_slots_ready boolean not null default false;
alter table public.battle_formations add column if not exists attack_multiplier numeric not null default 1 check(attack_multiplier between 1 and 1.6);
create table if not exists public.peris_city_slots (
 settlement_id bigint not null references public.settlements(id) on delete cascade,
 slot_index integer not null check(slot_index between 0 and 16),
 building_type text not null check(building_type in ('barracks','stables','workshop','smithy','warehouse','granary','fishery','mage_tower','housing','academy')),
 level integer not null default 0 check(level between 0 and 5),
 primary key(settlement_id,slot_index),check((building_type='fishery')=(slot_index=16))
);
alter table public.peris_city_slots drop constraint if exists peris_city_slots_building_type_check;
alter table public.peris_city_slots add constraint peris_city_slots_building_type_check check(building_type in('barracks','stables','workshop','smithy','warehouse','granary','fishery','mage_tower','housing','academy'));
alter table public.peris_city_slots enable row level security;
drop policy if exists "own city slots" on public.peris_city_slots;
create policy "own city slots" on public.peris_city_slots for select to authenticated using(exists(select 1 from public.settlements s where s.id=settlement_id and s.owner_id=public.peris_player_id()));
revoke all on public.peris_city_slots from public,anon,authenticated;
grant select on public.peris_city_slots to authenticated;
create or replace function public.peris_city_economy(p_sid bigint) returns void language plpgsql security definer set search_path='' as $$
declare fw numeric;fs numeric;ff numeric;fg numeric;
begin
 update public.settlements s set
 wood_rate=14+8*coalesce((select level from public.buildings where settlement_id=s.id and building_type='lumber'),0),
 stone_rate=12+7*coalesce((select level from public.buildings where settlement_id=s.id and building_type='quarry'),0),
 food_rate=18+10*coalesce((select level from public.buildings where settlement_id=s.id and building_type='farm'),0)+8*coalesce((select sum(level) from public.peris_city_slots where settlement_id=s.id and building_type='fishery'),0),
 gold_rate=3+3*coalesce((select level from public.buildings where settlement_id=s.id and building_type='market'),0),
 capacity=5000+2500*coalesce((select sum(level) from public.peris_city_slots where settlement_id=s.id and building_type='warehouse'),0),
 food_capacity=5000+2500*coalesce((select sum(level) from public.peris_city_slots where settlement_id=s.id and building_type='granary'),0)
 where s.id=p_sid;
 if to_regprocedure('public.peris_field_rates(bigint)')is not null then
  execute 'select wood,stone,food,gold from public.peris_field_rates($1)' into fw,fs,ff,fg using p_sid;
  update public.settlements set wood_rate=wood_rate+fw,stone_rate=stone_rate+fs,food_rate=food_rate+ff,gold_rate=gold_rate+fg where id=p_sid;
 end if;
end $$;
create or replace function public.peris_city_migrate(p_sid bigint) returns void language plpgsql security definer set search_path='' as $$
begin
 perform 1 from public.settlements where id=p_sid and not city_slots_ready for update;
 if not found then return;end if;
 insert into public.peris_city_slots(settlement_id,slot_index,building_type,level)
 select b.settlement_id,case b.building_type when 'barracks' then 0 when 'stables' then 1 else 2 end,
 case b.building_type when 'storehouse' then 'warehouse' else b.building_type end,b.level
 from public.buildings b join public.settlements s on s.id=b.settlement_id
 where b.settlement_id=p_sid and b.building_type in ('barracks','stables','storehouse') and (b.level>0 or exists(select 1 from public.peris_orders o where o.owner_id=s.owner_id and o.settlement_id=p_sid and o.kind='upgrade' and o.item=b.building_type)) on conflict do nothing;
 -- Preserve the food capacity of old combined storehouses as well.
 insert into public.peris_city_slots select p_sid,3,'granary',level from public.buildings where settlement_id=p_sid and building_type='storehouse' and level>0 on conflict do nothing;
 update public.peris_orders o set item='slot:'||(case item when 'barracks' then '0:barracks' when 'stables' then '1:stables' else '2:warehouse' end)
 where o.settlement_id=p_sid and kind='upgrade' and item in ('barracks','stables','storehouse');
 update public.settlements set city_slots_ready=true where id=p_sid;
 perform public.peris_city_economy(p_sid);
end $$;
create or replace function public.peris_queue_slot(p_slot integer,p_type text default null) returns jsonb language plpgsql security definer set search_path='' as $$
declare u uuid:=public.peris_player_id();s public.settlements%rowtype;l integer;main integer;t text;factor numeric;cw numeric;cs numeric;cf numeric;cg numeric;
begin
 if u is null then raise exception 'Authentication required';end if;
 perform public.peris_settle(u);
 if exists(select 1 from public.battles where status='active' and (attacker_owner_id=u or defender_owner_id=u)) then raise exception 'Finish the current battle first';end if;
 select * into s from public.settlements where id=public.peris_city_id(u) for update;
 if s.id is null then raise exception 'Realm not found';end if;
 select level into main from public.buildings where settlement_id=s.id and building_type='market';
 if p_slot is null or p_slot<0 or p_slot<>16 and p_slot>=6+2*coalesce(main,0) then raise exception 'Upgrade the main building to unlock this plot';end if;
 if exists(select 1 from public.peris_orders where owner_id=u and settlement_id=s.id and kind='upgrade') then raise exception 'Your builders are already working';end if;
 select level,building_type into l,t from public.peris_city_slots where settlement_id=s.id and slot_index=p_slot;
 if p_type is not null then
  if l is not null then raise exception 'This plot is already occupied';end if;
  if p_type not in ('barracks','stables','workshop','smithy','warehouse','granary','fishery','mage_tower','housing','academy') then raise exception 'Unknown building';end if;
  if p_type='mage_tower' and exists(select 1 from public.peris_city_slots where settlement_id=s.id and building_type='mage_tower') then raise exception 'Only one mage tower can be built in your city';end if;
  if p_type='barracks' and exists(select 1 from public.peris_city_slots where settlement_id=s.id and building_type='barracks') then raise exception 'Only one barracks can be built in your city';end if;
  if (p_type='fishery')<>(p_slot=16) then raise exception 'A fishery needs a riverside plot';end if;
  -- New fisheries need public map water in the same wrapped 3x3 neighbourhood as the client.
  -- Existing buildings and pending orders remain valid, including earlier inland fisheries.
  if p_type='fishery' and not exists(
   select 1 from generate_series(-1,1) dx cross join generate_series(-1,1) dy
   where public.peris_world_terrain(floor(public.peris_wrap_world(s.x)/128)::integer+dx,floor(public.peris_wrap_world(s.y)/128)::integer+dy) in (6,7,8,9)
  ) then raise exception 'A fishery needs nearby river, lake or coastal water';end if;
  t:=p_type;l:=0;
 elsif l is null or l=0 then raise exception 'This building is not ready';end if;
 if l>=(case when t='mage_tower' then 10 else 5 end) then raise exception 'Maximum building level reached';end if;
 factor:=power(case when t='mage_tower' then 1.38::numeric else 1.55::numeric end,l);
 cw:=ceil((case t when 'academy' then 220 when 'workshop' then 260 when 'housing' then 140 when 'mage_tower' then 260 when 'barracks' then 180 when 'stables' then 200 when 'smithy' then 180 when 'warehouse' then 200 else 160 end)*factor);
 cs:=ceil((case t when 'academy' then 260 when 'workshop' then 220 when 'housing' then 110 when 'mage_tower' then 340 when 'barracks' then 160 when 'stables' then 120 when 'smithy' then 220 when 'warehouse' then 150 when 'granary' then 120 else 80 end)*factor);
 cf:=ceil((case t when 'workshop' then 120 when 'housing' then 60 when 'barracks' then 100 when 'stables' then 180 when 'smithy' then 80 when 'warehouse' then 90 else 100 end)*factor);
 cg:=ceil((case t when 'academy' then 80 when 'mage_tower' then 160 when 'barracks' then 30 when 'stables' then 45 when 'smithy' then 60 when 'granary' then 15 else 20 end)*factor);
 if s.wood<cw or s.stone<cs or s.food<cf or s.gold<cg then raise exception 'Your stores cannot cover this cost';end if;
 update public.settlements set wood=wood-cw,stone=stone-cs,food=food-cf,gold=gold-cg where id=s.id;
 if p_type is not null then insert into public.peris_city_slots values(s.id,p_slot,t,0);end if;
 insert into public.peris_orders(owner_id,kind,item,quantity,started_at,finish_at)values(u,'upgrade','slot:'||p_slot||':'||t,1,public.peris_game_now(),public.peris_game_now()+make_interval(secs=>greatest(1,ceil((15+l*10)/public.peris_research_factor(u,'construction')))::double precision));
 return jsonb_build_object('ok',true);
end $$;
revoke all on function public.peris_city_economy(bigint),public.peris_city_migrate(bigint),public.peris_queue_slot(integer,text) from public,anon,authenticated;
grant execute on function public.peris_queue_slot(integer,text) to authenticated;
-- Never shrink an occupied world silently. The enclosing transaction aborts
-- before changing constraints, terrain or positions when migration is needed.
alter table public.armies add column if not exists march_path jsonb;
alter table public.armies add column if not exists march_distance numeric;
alter table public.armies add column if not exists march_map_version integer;
create or replace function public.peris_wrap_world(p_value numeric) returns numeric
language sql immutable set search_path='' as $$ select mod(mod(p_value+12800,25600)+25600,25600)-12800 $$;
create or replace function public.peris_wrapped_delta(p_from numeric,p_to numeric) returns numeric
language sql immutable set search_path='' as $$ select public.peris_wrap_world(p_to-p_from) $$;
create or replace function public.peris_wrap_cell(p_value integer) returns integer
language sql immutable set search_path='' as $$ select mod(mod(p_value+100,200)+200,200)-100 $$;
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
-- Generated by node --import tsx scripts/build-world.mjs. Do not edit these bytes.
-- Version 4, seed 1346720329; walkability bits and terrain bytes share row-major indexing.
create table if not exists public.peris_world_map(
 id integer primary key check(id=1),seed integer not null,cols integer not null,rows integer not null,
 cell_size integer not null,walkable bytea not null
);
alter table public.peris_world_map add column if not exists version integer not null default 3;
alter table public.peris_world_map add column if not exists terrain bytea;
alter table public.peris_world_map add column if not exists legacy_walkable bytea;
alter table public.peris_world_map drop constraint if exists peris_world_map_walkable_check;
alter table public.peris_world_map drop constraint if exists peris_world_map_terrain_check;
alter table public.peris_world_map enable row level security;
revoke all on public.peris_world_map from public,anon,authenticated;
-- Never silently relocate an existing player if their occupied field would become sea.
do $$ begin
 if exists(select 1 from public.settlements where get_bit(decode('fffffffffffffffff9ffffffffffffff0100000000f8fffffffffffffffffffffff9ffffffffffffff0100000000fcfffffffffffffffffffffff9ffffffffffffff0000000000fcfffffffffffffffffffffffbffffffffffffff0c00000000fffffffffffffffffffffffff3ffffffffffff7f7e000000c0fffffffffffffffffffffffff3ffffffffffff7fff010000f0ffffffffffffffffffffffffe7ffffffffffff3fff070000f8ffffffffffffffffffffffffe7ffffffffffff9fff3f0000feffffffffffffffffffffffffefffffffffffffcfffff00e0ffffffffffffffffffffffffffffffffffffffffdffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffefffffffffffefffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffeffeefffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffefffffefffffeffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffff01ffffffffffffffffffffffffffffffffffffffffffffff7f00feffffffffffffffffffffffffffffffffffffffffffff3f00fcffffffffffffffffffefffffffffffffffffffffffff1f00f8ffffffffffffffffffffffffffffffffffffffffffff0f00f0ffffffffffffffffffffffffffffffffffffffffffff0f00f0ffffffffffffffffffffffffffffffffffffffffffff0700e0ffffffffffffffffffffeffeffffffffffffffffffff0700c0ffffffffffffffffffffffffffffffffffffffffffff030040ffffffffffffffffffffffffffffffffffffffffffff030000ffffffffffffffffffffffffffffffffffffffffffff0300e0eefffffffffffffffffffffffeffffffffffffffffff0100f0ffffffffffffffffffffffffffffffffffffffffffff0100f0ffffffffffffffffffffffffffffffffffffffffffff0100f0ffffffffffffffffffffffffffffffffffffffffffff0100eeffffffffeefffffffffffffffffeffffffffffffffff0000ffffffffffffffffffffffffffffffffffffffffffffff0000ffffffffffffffffffffffffffffffffffffffffffffff0000ffffffffffffffffffffffffffffffffffffffffffffff0000eefffffffffffffffffffffffffffffeffffffffffffff0000f0ffffffffffffffffffffffffffffffffffffffffffff0000f0ffffffffffffffffffffffffffffffffffffffffffff0000f0ffffffffffffffffffffffffffffffffffffffffffff0000e0ffffffefffffffffffffffffffffffffffffffffffff0000f0ffffffffffffffffffffffffffffffffffffffffffff0000f0ffffffffffffffffffffffffffffffffffffffffffff0000f0ffffffffffffffffffffffffffffffffffffffffffff0100e0ffffffefffffffffffffffffffffefffffffffffffff0300f0ffffffffffffffffffffffffffffffffffffffffffff0300f0ffffffffffffffffffffffffffffffffffffffffffff0700f0ffffffffffffffffffffffffffffffffffffffffffff0f00eeffffffefffffffffffffffffffffffffffffffffffff0f00ffffffffffffffffffffffffffffffffffffffffffffff1f00ffffffffffffffffffffffffffffffffffffffffffffff3f00ffffffffffffffffffffffffffffffffffffffffffffff7fe0feffffffefffffffffffffeefffffffffffffffffffffffffdfffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffeffffffffffffffffffffffffffffffffffffffffffffff7ff0ffffffffffffffffffffffffffffffffffffffffffffff0fe0ffffffffffffffffffffffffffffffffffffffffffffff07c0ffffffffffffffffffffffffffffffffffffffffffffff07e0fffffffffffffffffffffffffffffffffffffffffeffff03f0ffffffffffffffffffffffffffffffffffffffffffffff01f0ffffffffffffffffffffffffffffffffffffffffffffff01f0ffffffffffffffffffffffffffffffffffffffffffffff00e0ffffffffffffffffffffffffffffffffffffffefffffff00f0ffffffffffffffffffffffffffffffffffffffffffff7f00f0ffffffffffffffffffffffffffffffffffffffffffff7f00f0ffffffffffffffffffffffffffffffffffffffffffff7f00e0fefffffffffeffffffffffffffffffffffffefffffff7f0000ffffffffffffffffffffffffffffffffffffffffffff3f0000ffffffffffffffffffffffffffffffffffffffffffff3f0000ffffffffffffffffffffffffffffffffffffffffffff3f00e0feffffffffffffffffffffffffffffffeffffeffffff3f00f0ffffffffffffffffffffffffffffffffffffffffffff3f00f0ffffffffffffffffffffffffffffffffffffffffffff7f00f0ffffffffffffffffffffffffffffffffffffffffffff7f00e0fffffffffffffeffffffffffffffffffffffeeffffffff00f0ffffffffffffffffffffffffffffffffffffffffffffff00f0ffffffffffffffffffffffffffffffffffffffffffffff01f0ffffffffffffffffffffffffffffffffffffffffffffff01f0fffffffffffffffefffffffffffffffffffeeeffffffff03f8ffffffffffffffffffffffffffffffffffffffffffffff0ffcffffffffffffffffffffffffffffffffffffffffffffff3ffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffefffffffffffffffffeffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffeffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffefffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffefffffffffffffefffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffeffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffefffefffffffffefffffffffeefefffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffeefffffffffffefffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffeffffeffeffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffefffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffff8ffffffffffffffffffffffffffffffffffffffffffffffffe0ffffffffffefffeffffffffffeffffffffffffffffffff7fc0ffffffffffffffffffffffffffffffffffffffffffffff3f80ffffffffffffffffffffffffffffffffffffffffffffff1f00ffffffffffffffffffffffffffffffffffffffffffffff0f00feffffffffffffffffffffffffefefffffffffffffffff0f00feffffffffffffffffffffffffffffffffffffffffffff0700fcffffffffffffffffffffffffffffffffffffffffffff0700fcffffffffffffffffffffffffffffffffffffffffffff0300fcfffffffffffeffffffffffffffeffeffffffffffffff0300f8ffffffffffffffffffffffffffffffffffffffffffff0300f0ffffffffffffffffffffffffffffffffffffffffffff0100f0ffffffffffffffffffffffffffffffffffffffffffff0100f0ffffffffefffffffffffffffffffeeffffffffffffff0100f0ffffffffffffffffffffffffffffffffffffffffffff0000f0ffffffffffffffffffffffffffffffffffffffffffff0000f0ffffffffffffffffffffffffffffffffffffffffffff0000e0ffffeffeefffffffffffffffffffffffffffffffffff0000e0ffffffffffffffffffffffffffffffffffffffffff7f0000e0ffffffffffffffffffffffffffffffffffffffffff7f0000e0ffffffffffffffffffffffffffffffffffffffffff7f0000e0ffffeffeffffffffffffffffffffffffffffffffff7f0000c0ffffffffffffffffffffffffffffffffffffffffff7f0000c0ffffffffffffffffffffffffffffffffffffffffff7f0000c0ffffffffffffffffffffffffffffffffffffffffff7f0000c0ffffffffffffffffffffffffffffffefffffffffff7f0000c0ffffffffffffffffffffffffffffffffffffffffff7f0000e0ffffffffffffffffffffffffffffffffffffffffff7f0006e0ffffffffffffffffffffffffffffffffffffffffff7f000fe0ffffffffffffffffffffffffffffffffffffffffff7f000fe0ffffffffffffffffffffffffffffffffffffffffffff000fe0ffffffffffffffffffffffffffffffffffffffffff7f000fe0ffffffffffffffffffffffffffffffffffffffffff7f0006e0fffffffffffeffffffffffffffffffffffffffffff7f0000e0ffffffffffffffffffffffffffffff3fffffffffff7f0000f0ffffffffffffffffffffffffffffff7fffffffffffff0000f0ffffffffffffffffffffffffffffff7fffffffffffff0000f0fffffffffffeffffffffffffffffff7ffeffffffffff0100f0ffffffffffffffffffffffffffffff7ffeffffffffff0100f8ffffffffffffffffffffffffffffff7ffeffffffffff0100f8ffffffffffffffffffffffffffffff7ffeffffffffff0100f0ffffffffffffffffffefeeffffffff7fffffffffffff0100f0fffffffffff3ffffffffdfffffffff7fffffffffffff0100f8fffffffffff3ffffffffdfffffffff7fffffffffffff0100f8ffffffffffe7ffffffffdfffffffff7fffffffffffff0300fcffffffffffe7ffffffffeeffffffff3fffffffffffff0300fcffffffffffcfffffffffffffffffff3fffffffffffff0700feffffffffffcfffffffffffffffffffbfffffffffffff0700feffffffffff9fffffffffffffffffffbfffffffffffff0f00ffffffffffff9fffffffffffffffffff9fffffffffffff0fe0ffffffffffff3fffffffffffffffffffdfffffffffffff1ff8ffffffffffff3fffffffffffffffffffdfffffffffffff3ffcffffffffffff3fffffffffffffffffffdfffffffffffffffffffffffffffff7ffeffffffffffffffffefffffffffffffffffffffffffffff7fffffffffffffffffffffffffffffffffffffffffffffffff7fffffffffffffffffffffffffffffffffffffffffffffffff7fffffffffffffffffff3f00e0fffffffffffffffffffffffffffeffffffffffffffff0f0080ffffffffffffffffffffffffffffffffffffffffffff000000feffffffffffffffffffffffffffffffffffffffff3f000000f0ffffffffffffffffffffffffffffffffffffffff1f000000c0fffffffffffffffffffffffffeffffffffffffff0f00000000fffffffffffffffffffffffffcffffffffffffff0700000000fffffffffffffffffffffffffcffffffffffffff0700000000fefffffffffffffffffffffffdffffffffffffff0700000000fcfffffffffffffffffffffffdffffffffffffff0300000000f8fffffffffffffffffffffffdffffffffffffff0300000000f8fffffffffffffffffffffffdffffffffffffff0100000000f8fffffffffffffffffffffffdffffffffffffff0100000000f0ffffff','hex'),(floor(y/128)::integer+100)*200+floor(x/128)::integer+100)=0) then
  raise exception 'An occupied settlement would become sea. Review its terrain before applying the map migration.';
 end if;
end $$;
update public.peris_world_map set legacy_walkable=walkable where version<4 and legacy_walkable is null;
insert into public.peris_world_map(id,seed,cols,rows,cell_size,walkable,terrain,version)
values(1,1346720329,200,200,128,decode('fffffffffffffffff9ffffffffffffff0100000000f8fffffffffffffffffffffff9ffffffffffffff0100000000fcfffffffffffffffffffffff9ffffffffffffff0000000000fcfffffffffffffffffffffffbffffffffffffff0c00000000fffffffffffffffffffffffff3ffffffffffff7f7e000000c0fffffffffffffffffffffffff3ffffffffffff7fff010000f0ffffffffffffffffffffffffe7ffffffffffff3fff070000f8ffffffffffffffffffffffffe7ffffffffffff9fff3f0000feffffffffffffffffffffffffefffffffffffffcfffff00e0ffffffffffffffffffffffffffffffffffffffffdffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffefffffffffffefffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffeffeefffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffefffffefffffeffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffff01ffffffffffffffffffffffffffffffffffffffffffffff7f00feffffffffffffffffffffffffffffffffffffffffffff3f00fcffffffffffffffffffefffffffffffffffffffffffff1f00f8ffffffffffffffffffffffffffffffffffffffffffff0f00f0ffffffffffffffffffffffffffffffffffffffffffff0f00f0ffffffffffffffffffffffffffffffffffffffffffff0700e0ffffffffffffffffffffeffeffffffffffffffffffff0700c0ffffffffffffffffffffffffffffffffffffffffffff030040ffffffffffffffffffffffffffffffffffffffffffff030000ffffffffffffffffffffffffffffffffffffffffffff0300e0eefffffffffffffffffffffffeffffffffffffffffff0100f0ffffffffffffffffffffffffffffffffffffffffffff0100f0ffffffffffffffffffffffffffffffffffffffffffff0100f0ffffffffffffffffffffffffffffffffffffffffffff0100eeffffffffeefffffffffffffffffeffffffffffffffff0000ffffffffffffffffffffffffffffffffffffffffffffff0000ffffffffffffffffffffffffffffffffffffffffffffff0000ffffffffffffffffffffffffffffffffffffffffffffff0000eefffffffffffffffffffffffffffffeffffffffffffff0000f0ffffffffffffffffffffffffffffffffffffffffffff0000f0ffffffffffffffffffffffffffffffffffffffffffff0000f0ffffffffffffffffffffffffffffffffffffffffffff0000e0ffffffefffffffffffffffffffffffffffffffffffff0000f0ffffffffffffffffffffffffffffffffffffffffffff0000f0ffffffffffffffffffffffffffffffffffffffffffff0000f0ffffffffffffffffffffffffffffffffffffffffffff0100e0ffffffefffffffffffffffffffffefffffffffffffff0300f0ffffffffffffffffffffffffffffffffffffffffffff0300f0ffffffffffffffffffffffffffffffffffffffffffff0700f0ffffffffffffffffffffffffffffffffffffffffffff0f00eeffffffefffffffffffffffffffffffffffffffffffff0f00ffffffffffffffffffffffffffffffffffffffffffffff1f00ffffffffffffffffffffffffffffffffffffffffffffff3f00ffffffffffffffffffffffffffffffffffffffffffffff7fe0feffffffefffffffffffffeefffffffffffffffffffffffffdfffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffeffffffffffffffffffffffffffffffffffffffffffffff7ff0ffffffffffffffffffffffffffffffffffffffffffffff0fe0ffffffffffffffffffffffffffffffffffffffffffffff07c0ffffffffffffffffffffffffffffffffffffffffffffff07e0fffffffffffffffffffffffffffffffffffffffffeffff03f0ffffffffffffffffffffffffffffffffffffffffffffff01f0ffffffffffffffffffffffffffffffffffffffffffffff01f0ffffffffffffffffffffffffffffffffffffffffffffff00e0ffffffffffffffffffffffffffffffffffffffefffffff00f0ffffffffffffffffffffffffffffffffffffffffffff7f00f0ffffffffffffffffffffffffffffffffffffffffffff7f00f0ffffffffffffffffffffffffffffffffffffffffffff7f00e0fefffffffffeffffffffffffffffffffffffefffffff7f0000ffffffffffffffffffffffffffffffffffffffffffff3f0000ffffffffffffffffffffffffffffffffffffffffffff3f0000ffffffffffffffffffffffffffffffffffffffffffff3f00e0feffffffffffffffffffffffffffffffeffffeffffff3f00f0ffffffffffffffffffffffffffffffffffffffffffff3f00f0ffffffffffffffffffffffffffffffffffffffffffff7f00f0ffffffffffffffffffffffffffffffffffffffffffff7f00e0fffffffffffffeffffffffffffffffffffffeeffffffff00f0ffffffffffffffffffffffffffffffffffffffffffffff00f0ffffffffffffffffffffffffffffffffffffffffffffff01f0ffffffffffffffffffffffffffffffffffffffffffffff01f0fffffffffffffffefffffffffffffffffffeeeffffffff03f8ffffffffffffffffffffffffffffffffffffffffffffff0ffcffffffffffffffffffffffffffffffffffffffffffffff3ffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffefffffffffffffffffeffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffeffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffefffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffefffffffffffffefffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffeffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffefffefffffffffefffffffffeefefffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffeefffffffffffefffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffeffffeffeffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffefffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffff8ffffffffffffffffffffffffffffffffffffffffffffffffe0ffffffffffefffeffffffffffeffffffffffffffffffff7fc0ffffffffffffffffffffffffffffffffffffffffffffff3f80ffffffffffffffffffffffffffffffffffffffffffffff1f00ffffffffffffffffffffffffffffffffffffffffffffff0f00feffffffffffffffffffffffffefefffffffffffffffff0f00feffffffffffffffffffffffffffffffffffffffffffff0700fcffffffffffffffffffffffffffffffffffffffffffff0700fcffffffffffffffffffffffffffffffffffffffffffff0300fcfffffffffffeffffffffffffffeffeffffffffffffff0300f8ffffffffffffffffffffffffffffffffffffffffffff0300f0ffffffffffffffffffffffffffffffffffffffffffff0100f0ffffffffffffffffffffffffffffffffffffffffffff0100f0ffffffffefffffffffffffffffffeeffffffffffffff0100f0ffffffffffffffffffffffffffffffffffffffffffff0000f0ffffffffffffffffffffffffffffffffffffffffffff0000f0ffffffffffffffffffffffffffffffffffffffffffff0000e0ffffeffeefffffffffffffffffffffffffffffffffff0000e0ffffffffffffffffffffffffffffffffffffffffff7f0000e0ffffffffffffffffffffffffffffffffffffffffff7f0000e0ffffffffffffffffffffffffffffffffffffffffff7f0000e0ffffeffeffffffffffffffffffffffffffffffffff7f0000c0ffffffffffffffffffffffffffffffffffffffffff7f0000c0ffffffffffffffffffffffffffffffffffffffffff7f0000c0ffffffffffffffffffffffffffffffffffffffffff7f0000c0ffffffffffffffffffffffffffffffefffffffffff7f0000c0ffffffffffffffffffffffffffffffffffffffffff7f0000e0ffffffffffffffffffffffffffffffffffffffffff7f0006e0ffffffffffffffffffffffffffffffffffffffffff7f000fe0ffffffffffffffffffffffffffffffffffffffffff7f000fe0ffffffffffffffffffffffffffffffffffffffffffff000fe0ffffffffffffffffffffffffffffffffffffffffff7f000fe0ffffffffffffffffffffffffffffffffffffffffff7f0006e0fffffffffffeffffffffffffffffffffffffffffff7f0000e0ffffffffffffffffffffffffffffff3fffffffffff7f0000f0ffffffffffffffffffffffffffffff7fffffffffffff0000f0ffffffffffffffffffffffffffffff7fffffffffffff0000f0fffffffffffeffffffffffffffffff7ffeffffffffff0100f0ffffffffffffffffffffffffffffff7ffeffffffffff0100f8ffffffffffffffffffffffffffffff7ffeffffffffff0100f8ffffffffffffffffffffffffffffff7ffeffffffffff0100f0ffffffffffffffffffefeeffffffff7fffffffffffff0100f0fffffffffff3ffffffffdfffffffff7fffffffffffff0100f8fffffffffff3ffffffffdfffffffff7fffffffffffff0100f8ffffffffffe7ffffffffdfffffffff7fffffffffffff0300fcffffffffffe7ffffffffeeffffffff3fffffffffffff0300fcffffffffffcfffffffffffffffffff3fffffffffffff0700feffffffffffcfffffffffffffffffffbfffffffffffff0700feffffffffff9fffffffffffffffffffbfffffffffffff0f00ffffffffffff9fffffffffffffffffff9fffffffffffff0fe0ffffffffffff3fffffffffffffffffffdfffffffffffff1ff8ffffffffffff3fffffffffffffffffffdfffffffffffff3ffcffffffffffff3fffffffffffffffffffdfffffffffffffffffffffffffffff7ffeffffffffffffffffefffffffffffffffffffffffffffff7fffffffffffffffffffffffffffffffffffffffffffffffff7fffffffffffffffffffffffffffffffffffffffffffffffff7fffffffffffffffffff3f00e0fffffffffffffffffffffffffffeffffffffffffffff0f0080ffffffffffffffffffffffffffffffffffffffffffff000000feffffffffffffffffffffffffffffffffffffffff3f000000f0ffffffffffffffffffffffffffffffffffffffff1f000000c0fffffffffffffffffffffffffeffffffffffffff0f00000000fffffffffffffffffffffffffcffffffffffffff0700000000fffffffffffffffffffffffffcffffffffffffff0700000000fefffffffffffffffffffffffdffffffffffffff0700000000fcfffffffffffffffffffffffdffffffffffffff0300000000f8fffffffffffffffffffffffdffffffffffffff0300000000f8fffffffffffffffffffffffdffffffffffffff0100000000f8fffffffffffffffffffffffdffffffffffffff0100000000f0ffffff','hex'),decode('0202010100000000000000000000000000000000000000000000010101000000020202020202020202040001010101010101010101010101010101010101010106080800000000000000000001010101010202020101000000000002020202020a0a0a0a0a04040404040404040404040404040404000002020200000000000000080808080808080808080808080808080808080808080808080808080808080808080808080808080808010101010000000000000000000202020202010101010101010202020202020101000000000000000000000000000000000000000000000101010000000202020202020202020202010101010101010101010101010101010101010100060808000000000000000000010101010102020201010000000000020202020a0a0a0a0a0a04040404040404040404040404040404040202020202020000000006080808080808080808080808080808080808080808080808080808080808080808080808080808080801010101000000000000000000000000010101010101010101010202020202020101000000000000000000000000000000000000000000000101010000020202020202020202020202010101010101010101010101010101010101010000060808060000000000000001010101010101010101010000000000000000000a0a0a0a0a0a04040404040404040404040404040404020202020202020000000008080808080808080808080808080808080808080808080808080808080808080808080808080808080800000000000000000000000000000000000101010101010101010202020202020200000000000000000000000000000000000000020202020202020202020202020202020202020200010101010101010101010202010101010101000000000608060000010101010101010101010101010101010000000000000000000a0a0a0a0a0a0a04040404040404040404040404040404020202020202000000060808060008080808080808080808080808080808080808080808080808080808080808080808080800000000000000000000000000000004040404000101010101010101020202020202020200000000000000000000000000000000000002020202020202020202020202020202020202000101010101010101010202020202010101010000000000060808060101010101010101010101010101010101000200000000000000000a0a0a0a0a0a0a04040404040404040404040404040402020202020202000608080600000000000808080808080808080808080808080808080808080808080808080808080800000000000000000000000000000000040404040404040000000000000000020202020202020200000000000000000000000000000000000202020202020202020202020202020202020200010101010202020202020202020202010101000400000000080806010101010101010202010101010101010102020200000000000000000000000000000a0404040404040404040404040000000000000002020006080600000000000000000808080808080808080808080808080808080808080808080808080000000000000000000000000000000000040404040404040404040400000000000000020202020202000000000000000000010101010101010102020202020200000000000002020202020202010101010102020202020202020202020202000404040000000608080601010101010101020101010101010101010200000000000000000000000000000000000a0a0a0a0a0a00000000000000000000000002020608080602020200000000000000080808080808080808080808080808080808080808080808000000000000000000000000000000000004040404040404040404040404040000000000000202020202000000000000000101010101010101010102020202020000000000000002020202020202010101010102020202020202020202020202020202040000000008080601010101010101010101010101010101010000000000000000000000000000000000000a0a0a0000000a000000000000000000000002060808060202020202000a0a0a0a000000000808080808080808080808080808080808080800000a000002000000000000000000000000000404040404040404040404040404040404040a02020202020200000000000001010202020201010101010102020200000000000000010102020202020201010101010101010101010102020202020202020202040000000608000601010101010101010101010101010101010000000202020000000000000000000000000000000000000000000000000000000000060808060202020000000a0a0a0a0a0a0000000000080808080808080808080808080104040404000a0a0202000000000000000000000000040404040404040404040404040404040404040402020202020200000000000001010202020202020101010101000000000000000000010102020202020202010101010101010101010101010101010004040404040000000106000001010101010101010101010101010101010000020202020200000000000000000000000000000000000000000000000000000000060008060000000000000a0a0a0a0a0202020200000101010101010101010101010101040404040a0a0a020a0a0a0a000000000000000004040404040404040404040404040404040404020202020202020200000000000101020202020202020202020101000000000000000001010101020202020202020202020101010101010101010101010004040404040000000106000006010101010101010101010101010101010000020202020200000000000000000000000000000000000000000000000000000006000006000000000000000a0a0a0a0a020202020000000101010101010101010101010104040404040a0a0a0a0a0a0a0a00000000000004040404040404040404040404040404040404020202020202020202000000010101020202020202020202020202010000000000000000010101010102020101010202020202010101010101010101010101000404040400000001010600000101010101010101010101010101010100000002020200000000000000000000000000000000000000000000000000000006000006000000000000000000000a0a0a020202020000000000000101010101010101010004040404040a0a0a0a0a0a0a0a0a00000000040404040404040404040404040404040404040202020202020202020204000101010102020202020202020202020200000000000000000001010101010101010101010202020201010101010101010101010100000004040000010101060000060101010101010101010101010101000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000a0a02020202000000040404000000000000000004040404040404040a0a0a0a0a020202000000040404040404040404040404040404040404040402020202020202020202040001010102020202020202020202010100000000000000000000010101010101010101010102020202010101010101010101010101010101010101010101010106000001010202020201010101010101000000000000000000000000000000000000000000000000000000000001010101010600000600000000000000000000000000000202020200000004040404040404040404040404040404040404040a0a0a0a020202020000040404040404040400000000000000000000040202020202020202020202040101010102020202020202020201010000000000000000000000010101010101010101010102020202020101010101000000010101010101010101010101010106000006010202020201010101010101000000000000000000000000010101010101010101010101010101010101010101060000060000000000000000000000000000000202020200000004040404040404040404040404040404040404040a0a0a0002020202000404040404040000000001010101010101010102020202020202020202020202010101010202020202020101010000000000000000000000000001010101010101010102020202020202010101010000000000010101010101010101010101010100000602020202020101010101010100000000000000000000000606010101010102020202020201010101010101010106000006000000000000000000000000000000020202020000000404040404040404040404040404040404040404020202020202020202040404040000010101010101010101010101010202020202020202020202020201010102020202020202000000000000000000000000000000000101010101010101020202020202020201010101000000000001010101010101010101010101020608060202020202020101010101010000000000000000000606000006010101010101020202020101010101010101010008060100000000000000000000000000000002020202000000040404040404040404040404040404040404040202020202020202020202040400000101010102020101010101010102020202020202020202020202020101010202020505020200000000000000000000000000000000010101010101010202020202020202020202020100000000000101010101010101010101010202060006020202020202010101010101000000000000000006000000060101010101010101020202010101010101010106000006010000000000000000000000000000000202020200000004040404040404040404040404040404040404020202020202020202020202040002020202020202020201010101010202020202020202050505020202010101020505050505020202000000000000000202020202020202020202020202020205050502020202020202020200000000010101010101010101010101020206000602020202020201010101010100000000000606000000000601010101010101010102020101010101010101010600000101000000000000000000000000000000020202020000000404040404040404040404040404040404040402020202020202020202020202020202020202020202020201010102020202020202050505050505020202020202050505050502020202020200000002020202050502020202020202020202020505020202020202020202020202000001010101010101010101010101020600060202020202020101010101010006060600000000000606010101010101010101010202010101010101010101000006010100000000000000000000000000000002020202020000040404040404040404040404040404040404040202020202020202020202020202020202020202020202020101010202020205050505050505050502020202020205050505020202020202020202020202020505050502020202020202020202020202020205050505050202020202000101010101010101010101010101060806020202020201010106060606000008000000080606000001010101010101010101020201010101010101010100000601010000000000000000000000000000000202020202000004040404040404040404040404040404040400000202020202020202020202020202020202020202020202010101020202020505050505050505050502020202050202050202020202020202020202020205050505050502020202020202020202020202020505050505050202020202020202020202010101010101010600000601010202060606000000000000000000000606000000000001010101010101010101010101010101010101010000060101000000000000000000000000000000020202020200000004040404040404040404040404040404000a0a02020202020202020202020505050202020202020202020101010202020202020205050205050505050502020202020202020202020202020202020202050505050505020202020202020202020202020205050505050505020202020202020202020202010101010106000600060606060000000000000006060606000000000006000000000000000101010101010101010101010101010100000601000000000000000000000000000000000202020202000000000000040404040404040404040000000a0a0a020505050202020202020505050505020202020202020202040202020202020202020202020202050502020202020000000000020202020202020202020505050505050202020202020202020202020202050505050505050202020202020202020202020202010106000006060000000000000606060600000000000006060000000006000000000000000001010101010101010101010101060006000000000000000000000000000000000202020202020000000000000000000000000000000000000202020202050505020202020202050505050502020202020202020202020202020202020202020202020205020202000000000000000000000202020202020202050505050502020202020202020202020202050505050505050505050202020202020202020202020202060000000800000006060600000000000000000000000000060600000806060000000000000000000000000000000000000006000800020000000000000002020202020202020202020202000000000000000000000000000000020202020202020202050202020202020202020505020202020202020202020202020202020202020202020202020202000000000000000000000000000202020202020202020505050505050202020202020202050505050505050505050505020202020202020202020202020600000000060606040404040400000000000000000000000000000606000000060002000000000000000000000000000000000600000602020001010101020202020202020202020202020000000000000000000002020002020202020202020202020202020202020202020202020202020202020202020202020202020202020202020202020202020000000008080808080808040000000202020505020205050505050505050202020202050505050505050505050505050505050505050502020202020202060000060602020202020202020402020000000000000000000000000006000000060000000000000000000000000000000000000600000602020101010102020202020202020202020202020000000002020202020202020202020202020202020202020202020202020202020202020202020202020202020202020202020202020202020202020100000008080808080808080808000000000205050502050505050505050502050502050505050505050505050505050505050505050505050505050505020600000602050502020202020202020505020200000000000000000000000006060000060000000000000000000000000000000000060000060001010202020202020202020202020202020200000202020202020202020202020202020202020202020202020202020202020202020202020202020202020202020202020202020202020202020202010000080808080808080808080808000000000205050202020505050202020205050505050505050505050505050505050505050505050505050505050206000006020505050502020202020202050505020202000000000000000000000006060800060600000000000000000000000000000000060000060102020202020202000004040404040404020202020202020202020202020202020202020202020202020202020202020202020202020202020202020202020202020202020202020202020202020100000808080808080808080808080808010101020505050202020202020205050505050505050505050505050505050505050505050505050505050505060000000605050505050505050202020205050505020202020000000000000202020000060000000606040404040000000000000000000000060000060202020202000000000404040202020202020202020202020205050505020202020202020202020202020202020202020202020202020202020202020202020202020202020202050202020202000008080808080808080808080808080808010102050505020202020505050505050505050505050505050505050505050505050505050505050505050600000600060505050505050505000000050505050505020202020202000002020202020200060600000000060604000000000000000000000000060000060205020200000002020202020202020202020202020202050505050505050502020202020202020202020202020202020202020202020202020202020202020202020202020505050202020000000808080808080808080808080808080801010202050505050202050505050505050505050505050505050505050505050505050505050505050506000006060006050505050505050500000005050505050502020202020202020202020202020200000606000000000606060000000000010101010106060000020505020202020202020202020202020202020202020505050505050505050505050505050202020202020202020202020202020202020202020202020202020202020202020202020202000008080808080808080808080808080808080801010205050501010106020505050505050505050505050505050505050505050505050505050505060000020506000605050505050505050000000505050505050505020202020202020205050502020202020006060608000000080606000101010102020206060006020502020202020202020202020202020505050505050505050505050505050505050505050202020202050505050202020202020202020202020202020202020202020202020202020200000808080808080808080808080808080808080801010101010000000006050505050505050505050505050505050505050505050505050505050600000205050600060505050505010101020202050505050505050505020202020202020202020202020202020202000606060000000000060601020202020206060006020202020202020202020205050505050505050505050505050505050505050505050505050202020505050505020202020202020202020202020202020202020202020202020202020a0808080808080808080808080808080808080808010800000000000000000205050505050505050505050505050505050505050505050505050600000205050506000605050505050101010200020505050505050505050502020202020202020202020202020202020202020206060600000000000606020202020206000606020202020202020505050505050505050505050505050505050505050505050505050502020205050505050202020202020202020202020202020202020202020202020202020a0a08080808080808080808080808080808080808080808000000000000000006050505050505050505050505050505050505050505050505050600000205050505060006050505050501010105020505050505050505050505050502020202020202020202020202020202020202020202060606000000000606020202020600000602020202050505050505050505050505050505050505050505050505050505050502020505050505050505020202020202020202020202020202020202020202020202020a0a0a08080808080808080808080808080808080808000000080000000800000006050505050505020505050505050505050505050505050505060000020505050505060006050505050505050506060605050505050505050505050505020202020202020202020202020202020202020202020202020606080000000602050206000006020205050505050505050505050505050505050505050505050505050505050202050505050505050505020202020202020202020202020202020202020202020202020a0a080808080808080808080808080808080808080000000000000000000000000205050505050502020202020202020202020205050505050600000605050505020600000605050505050505050606060505050505050505050505050505020202020202020202020202020505050502020202020202020202060000000606020206000002050505050505050505050505050505050505050505050505050505050505020205050505050505050202020202020202020202020202020202020202020202050502020a0808080808080808080808080808080808080800000000000000000000000102050505050502020202020202020202020202020505050200000605050506060000000605050505050505050506060605050505050505050505050505050502020202020505050505050505050505050202020202020205050502060000000602020600060205050505050505050505050505050505050505050505050505050505020205050505050505050505020202020202020202020202020202020202020205050505020a0008080808080808080808080808080808080808000000000000000001010102050505050505020202020202020202020202020205050506000602020600000006060205050505050505050505050505050505050505050505050505050505050202020505050505050505050505050502020202020505050505050502060000060202060006020505050505050505050505050505050505050505050505050502020202020505050505050505050202020202020202020202020202020202020205050505050200000808080808080808080808080808080800000008000000010101010101010202020505020202020202020202020202020202020505060008020600080006020505050505050505050505050505050505050505050505050505050505050505020505050505050505050505050505050502020505050505050505050502060008060202060006050505050505050505050505050505050505050505050505020202020202020505050505050505050202020202020202020202020202020202020505050502020008080808080808080808080808080808000000000000000001010101010101010202020202020202020202020101010100000202050200000600000006060505050505050505050505050505050505050505050505050505050505050505050505050505050505050505050505050505050205050505050505050505050505060000000602000006050505050505050505050505050505050505050505020202020202020202050505050505050505020202020202020202020202020202020205050505050202000808080808080808080808080808080800000000000000000101010101010100000202020202020202020202010101010000000202060006000006060202050505050505050505050505050505050505050505050505050505050505050505050505050505050505050505050505050505050505050505050505050505050505020600000006000002050505050505050505050505050505050502020505050202020202020202050505050505050502020201020202020202020202020205050505050502020000080808080808080808080808080808080000000000000000000101010101000000000000000202020202020202010101000000000200000000060602020202020202050505050505050505050505050505050505050505050505050505050505050505050505050505050505050505050505050505050505050505050505050505020606000000000605050505050505050505050502020202020202020505020202020202020205050505050505020202010101010202020202020505050505050502020202000008080808080808080808080808080808080000000800000001010101010100000000000000000202020202020201010100000000060000060602020202020202020202020505050505050505050505050505050505050505050505050505050505050505050505050505050505050505050505050505050505050505050505050505050506060000080605050505050202020202020202020202020202050202020202020202020505050505050202020201010101010102020205050505050502020202020200000808080808080808080808080808080808080808000000000101010202010000000000000000020202020202020101010000000006000602000000020202020202020202020202050505050505050505050505050505050505050505050505050505050505050505050505050505050505050505050505050505050505050505050505050505020600000205050505020202020202020202020202020205020202020202020202050505050505020202020101010101010202020505050502020202020202020000080808080808080808080808080808080808080800000000010102020202000000000000000002020202020202010101000000000600060200000000000202020202020202020202020205050505050505050505050505050505050505050505050505050505050505050505050505050505050505050505050505050505050505050505050505050600060505020202020202020202020202020202050502020202020202020205050505050202020202010101010101020205050502020202020202020000000008080808080808080808080808080808080808080000000001010202020200000000000000000202020202020101010100000006000006020000000000000002020202020202020202020202020505050505050505050505050505050505050505050505050505050505050505050505050505050505050505050505050505050505050505050505020000020202020202020202020202020202020205050202020202020202020205050505020202020201010101010102020505020202020202020000000000000808080808080808080808080808080808080808080000000101020202020000000000000000000202020101010101010000000608000600000000000000000a0a02020202020202020202020202050505020505050505050505050505050505050505050505050505050505050505050505050505050505050505050505050505050505050505050506000602020202020202020202020200000002050502020202020202020202020202020202020202020101010202020202020202020202020200000000000008080808080808080808080808080808080808080000000001010101010100000000000000000000000001010101010100000006000600000000000000000a0a0a0a000202020202020202020202020202020202050505050505050505050505050505050505050505050505050505050505050505050505050505050505050505050505050505050502000006020202020202020202020200000002020202020202020202010101000202020202020202020202020202020202020202020202020000000000000008080808080808080808080808080808080808080000000001010101010100000000000000000000000101010101010101000006000600000000000a0a0a0a0a0a0a0a0002020202020202020202020202020202020505050505050505050505050505050505050505050505050505050505050505050505050505050505050505050505050505050505060006020202020202020202020200000002020202020202020101010101040404040202020202020202020202020202020202020202020000000000000008080808080808080808080808080808080808080000000000000101010100000002020200000000010101010101010101000006000600000000000a0a0a0a0a0a0a0a000000020202020202020202020202020202020505050505050505050505050505050505050505050505050505050505050505050505050505050505050505050505050505050506000601020202020202020101010101010205020202020101010101010004040404020202020202020202020202020202020202020202000000000000000008080808080808080808080808080808080808080000000000000000000000000202020000000101010101010101010100000008060000000000000a0a0a0a0a0a0a0a0000000000020202020202020202020202020202050505050505050505050505050505050505050505050505050505050505050505050505050502020205050505050505050206000806020202020202020101010100010205020202010101010101010004040404020202020202020202020202020202020202020200000000000000000000080808080808080808080808080808080808000000000000000000000001010101010101010101010101010101010101000000060000000000000a0a0a0a0a0a0a0a0a00000000000000000001010102020202020202020205050505050505050505050505050505050505050505050505050505050505020202020202020205050505050502020202060006020202020202020101010101010202020201010101010101010000000000020202020202020202020202020202020202020200000000000000000000080808080808080808080808080808080808000000000000000000000001010101010101010101010101010101010101000000060000000000000a0a0a0a0a0a0a0a0a0000000000000000000101010102020202020202020202020202020202050505050505050505050505050205050505050505020202020202020202020205050505020202020206000601020202020202020201060606020202020101010101010101000000000000020202050505020202020202020202020202000000000000000000000000080808080808080808080808080808080800000000000000000000000101010101010101010101010101010202020200000006000000000000000a0a0a0a0a0a0a0a0000000000000404040101010101010202020202020202020202020202020205050505050505050505050205050505050505020202020202020202020202050202020202020206000006010101010202020201060606010201010101010101010101000000000000000202020505050202020202020202020200000000000000000000000000000808080808080808080808080800000008000000020200010101010101010101010101010101010101020202020200000806000000000000000a020202020a0a000000000002020204040101010101010102020202020202020202020202020202020202020200000002050505050505050502020202020202020202020202020202020202020201060006010101010101010101060606010101010101010101010101000000000000000000020205020202020202020202020000000000000000000000000000000808080808080808080808080000000000000002020202020101010101010101010101010101010102020202020202000006000000000000000002020202020000000000020202020204000101010101010101020202020202020202020202020202020006060000000002050505050505050202020202020202020202020202020202020201010106000601010101010101010101010101010101010101010101010100000000000000000000020502020202020202020000000000000000000000000000000000000808080808080808080808000000000000020202020201010101010101010101010101010101010202020202020000000600000000000000000202020202000000000002020202020404040000020202020000000202020202020202020202020000000000000000000002050505050505020202020202020202020202020202020101010101010600000100000001010101010101010101010101010101010101010102020202020200000002020202020202020200000000000000000000000000000000020000000808080808080808080800000001010102020202010101010101010101010101010101000000020202020202000600060000000000000000020202020200000000000004040404040404040402020202020000000000000202000002020202000000000000000000000205050505050502020202020202020202020202020400010101010101060000060404040000000000000000000102020101010101010102020202020202020101010202020202020200000000000000000000000000000000000002000000000808080808080000000800010101010101010101010101010101010101010101010000000002020202020200060806000000000000000002020202020200000000000404040404040204040002020202000000000000000000000000020000000008000000080000000202050505020202020202020202040404040202020401010101010102060006020404040404040400000000000202010101010101020202020202020202010101020202020202000000000000000000000000000000000000000200000000000008000000000001010101010101010101010101010101020101010101010100000000000202020202000006000000000000000000000202020202020202000004040404040402020202000000020000000000000000000000000000000000000000000000000000000202020202020202020202040404040404020202040001010101000206000602020202020404040404040400020202010101010102020202020202020201010102020202000000000000000000000000000000000000000000000000000000000000000001010101010101010101010101010101020202020101010101010000000000020202020000000600000600000000000000020202020202020202000404040404040202020200000000000000000000000000000000000000000000000000000000000000000004020202020202040404040404040202020202000001010102020600060202020202020404040404040402020202010101020202020202020202010101010102000000000000000000000000000000000000000000000000000000000000000000000101010101010101010101010101010202020202010101010101010000000002020202000000000000060000000000000002020202020202020000040404040404020202020200000000000000000000000000000000000000060000000006000000000000000004040404040404040404040402020202020204000101000202060006020202020202040404040404040202020202010102020202020202020201010101000000000000000000000000000000000000000000000008000000000000000000000000010101010101010101010101010102020202020201010101010101000000000202020200000000060000000000000000020202020202020000000004040404040402020202020000000000000a0a0a00000000000000000000000006060600000000000000000000000404040404040202020202020202020200000101020202060000020202020202040404040404040202020202020202020202020202020101010101000000000000000000000000000000000000000a000008080808080000000000000000000101010101020202020202020202020202020202020101010101010100000000020200000000000600000600000000000202020202020000000000040404040404040202020200000000000a0a0a0a020202000000000000000000000000000000000000000000000000000000000202020202020202020202040002020202020200000602020202020204040404040002020202020202020202020202010101010101010000000000000000000000000000000000000008080808080808080800000000000000000002020202020202020202020202020202020202020101010101010101000000000000000000000006000600000000020202020202000000000000040404040404040202020200000000000a0a0a02020202020000000000000101010101010100000000000000000000000000000202020202020202020202020202020202020206000602020202020204040000000000020202020202020202020206000601010101010000000000000000000000000000000000000808080808080808080808000000000000000002020202020202020202020202020202020202020201010101010101010100000000000000000006000006000202020202020202000000000004040404040404040202020200000000000a0a0a0202020202000000000000000001010000000000000000000000000000000000020202020202020202020202020202020202020600060202020202020200000000000002020202020202020202060000060101010100000000000000000000000000000000000000080808080808080808080000000000000000000202020202020202020202020202020202020202020201010101010101010101010101010101010100000602020202020202020200000000000404040404040404020202020400000000000a0a0a020202020000000000000000000000000000000000000000000000000000000a0a0002020202020202020202020202020202060006020202020202020000000000000202020202020202000608000006010101000000000000000000000000000000000000000808080808080808080800000000000000000000000000000000020202020202020202020202020201010101010101010101010101010101010101010600000602020202020202020000000000040404040404040402020202040000000000000a000202020000000000000000000000000000000000000000000000020000000a0a0a0a0a0202020202020202020202000000020600060202020202020202020000000002020202020202000600000606000000000002020202000000000000000001020201010808080808080808080808000000000000000000000000000000000002020202020202020202010101010101010101010101010101010101010101010202060006020202020202020202020000020404040404040402020202020400000000000000000002020000000000000000000000000000000000000000000202020200000a0a0a0a0a0a0202020202020202000000000002060006020202020202020202020202020202020200000606000006060000000002020202020200000000000000020202010101080808080808080808080800000000000000000000000000000000000202020202010101010101010101010101010101010101010101010101010101020206000006020202020202020202020202020202020404020202020202020000000000000000000000000000000101010000000000000000000000000000020202020a0a0a0a0a0a0a0a02020202020202000000000000000600060202020202020202020202020202020200060600000006000000000000020202020200000000000000020202020101080808080808080808080808080000000000000000000000000000000002020202020101010101010101010101010101010106060601010101010101010202020600060202020202020202020202020202020202020202020202020202000000000000000000000002020201010100000000000000000000000000000002020200000a0a0a0a0a0a02020202020000000000000000000600060202020202020202020202020202020606000008060600000000020202000000000000000000000002020202020101080808080808080808080808000000000000000000000000000000000002020202010101010101010101010101010101010106000006060101010202020202020600000602020202020202020202020202020202020202020202020202020000000000000000000002020201010101000000000000000000000000000000020200000a0a0a0a0a0a02020202000000000000000000000000060202020202020202020202020206060000000606000202020202020202000000000000000000000202020202010108080808080808080808080808000000000000000000000000000000000000000101010101010101010101010101010101010106000000000606020202020202020106000602020202020202020202020202020202020202020202020202020200000000000000000002020201010101000000000000000000000000000000000000000000000a0a0a0002020000000000000000000006000006020202020202020202020202060000000606040000020202020202020200000000000000000000020202020201010808080808080808080808080800000000000000000000000000000000000000010101010101010101010101010101010101010101060600000006060202020202020600000602020202020202020202020202020202020202020202020202020000000000000000000002020101010101010000000000000000000000000000000000000000000000000000000000000000000000000600060002020202020202020202060000000606040404040002020202020202020000000000000000000002020202020101080808080808080808080808080800000008000000000000000000000000000001010101010101010101010101010101010101010101010606080000060202020202020600060202000000020202020202020202020202020202020202020202000000000000000000010101010101010101010101000000000000000000000000000000000000000000000000000000000000000000060006000000020202020202060600080606000404040404000002020202020202000000000000000000000202020201010108080808080808080808080808080808080000010200000000000000000000000101010101010101010101010101010101010101010101010206060000060202020202060000060000000000020202020202020202020202020202020202020200000000000101010101010101010101010101010101010101010101000000000000000000000000000000000000000000000000000000000601010102020202020600000006000204040404040400000000020202020200000000000000000000020202020101080808080808080808080808080808080808000001020100000000000000000001010101010101010101010101010101010101010202020202020202060000060202020202060006000000000002020202020202020202020202020202020202020001010101010101010101010101010101010101010101010101010101010101010000000000000000000000000000000000000000060000060101010202020202060006060100000404040404040000000000020202020000000000000000000002020201010108080808080808080808080808080808080800010101010100000000000000000101010101010101010101010101010101010102020202020202020202060000060202020206000006000000000202020202020202020202020202020202020202010101010101010101010101010101010101010101010101010101010101010101010000000000000000020202000000000000000006000601010101020202020600000601000004040404040400000000000000020202000000000000000000020200010101010808080808080808080808080808080000000801010101010000000000000000010101010101010101010101010101010101020202020202020202020202060000060202010106000600000000020202020202020202020202020202020202020201010101010101010101010101010101010101010101010101010101010101010101010000000000000202020200000000000000060800060101010202020201000806010101010101040404000000000000000000020200000000000000000200000001010101080808080808080808080808080800000000000101010101000000000000000001010101010101010101010101010101010102020202020202020202020202060006020201010600000600000001010101010202020202020202020202020202020101010101010101010101010101010101010101010101010101010101010101010101000000000000020202020000000000000006000006010102020202020600000601010101010101040000000000000000000000000000000000000000000000000101010108080808080808080808080808080000000000010101010100000000000000000101010101010101010101010101010101010102020202020202020202020206000602020101010600060000000101010101020202020202020202020202020202010101020202020101010101010101010101010101010101010101010101010101010100000000000002020202000000000000000000060101020202020202060006010101010101010101000000000000000000000000000000000000000000000000010101010108080808080808080808080808000000000101010101010100000000000001010101010101010101010101010101010101010202020202020202020202020600060601010101060000060400010101010102020202020202020202020202020001010102020202020101010101010202020101010101010101010101010101010101010000000000000002020000000000000006000006010202020202020600000601010000000101010101000000000000000000000000000000000000000000000001010101010808080808080808080808080808000000010101010101010002000000010101010101010101010101010101010101010101010000000202020202020202060000080006060101060006000001010101010202020202020202020202020204040101010202020202010101010101020202020101010101010101010101010101010100000000000000000000000000000000000600060001020202020106000000080000000800000101010100000000000000000000000000000000000000000000000001010101010808080808080808080808080000000101010101010101010202010101010101010101010101010101010101010101010101000000020202020202020202060600000000060606000006010101010102020202020202020202020202040404000101020202020201010101010202020202010101010101010101010101010101010000000000000000000000000000000006000006000202020206060000000000000000000000000101000000000000000000000000000000000000010101010100000000000101080808080808080808080808000001010102010101010101020201010101010101010101010101010101010101010101010100000001010101010102020202020606060000000600000601010101020202020202020404020202020204040404000202020202020202010101020202020200000000000000000000000000000000000000000000000000000000000000000600060002020200060000000000000000000000000000010100000000000000000000000000000000000101010101010100000000000001080808080808080808080800000101020201010101010101020101010101010101010101010101010101010101010101010101010102020101010101020202020201060600000600000101010202020202020204040404040202020404040402020202020202020202010102020202020000000000000000000000000000000000000000000000000000000000000006000006020200060000000006010000000000000000000001000000000000000000000000000000000000010101010101010000000000000008080808080808080808080000000101010101010101010101010101010101010101010101010101010101010101010101010001020202010101010101020202020202010600000800060202020202020202040404040404040202040404040202020202020202020202020202020202000000000000000000000000000000000000000000000000000202020202020600060000060000080006020201000008000000080000010100000000000000000000000000000000000101010101010101000000000000000008080808080808080800000000000001010101010101010101010101010101010101010101010101010101010101010101010101020101010101010101010101020202010600060006020202020202020404040404040404020204040404020202020202020202020202020202020202000000000000000202020000000000000000000202020202020202020206000006060600000006020202020206000000000000000001010000000000000000000000000000000000010101010101010100000000000000000000080808080808000000000000000001010101010101010101010101010101010101010101010101000101010101010606060101010101010101010101010101010101060000000006020202020202040404040404040202020404040404020202020202020202020202020202020200000a0a0a000202020202000000000000000202020202020202020202060006060000000606020202020202010600000000000101010000000000000000000000000000000000000101010101020202020000000000000000000000080800000000000200000000000101010101010101010101010101010101010202010101000000010101010106060601010101010101010101010101010101010106000600060202020202040404040404040404020404040404040202020202020202020202020202020202020202020202020202020202000000000002020202020202020202020600000000000606020202020202020101010606060601010101000000000000000000000000000000000000010101020202020202020000000000000000000000000000000202020000000000010101010101010101010101010101010101020202020200000001010101010606060101010101010101010101010101010101020608000000060202020204040404040404040404040404040404020202020202020202020202020202020202020202020202020202020200000000000002020202020202020202060008000606020202020202020200010101010101010101010100000000000000000000000000000000000202020202020202020202000000000000000000000000020202020202000000000000010101010101010101010101010101010102020202020202010101010101010101010101010101010101010101010101010202020600000006020202040404040404040404040404040404040402020202020202020202020202020202020202020202020202020202020202020200000202020202020202020600000006020202020000020202020000010101010101010100000000000000000000000000000000000002020202020202020202020000000000000000000000020202020202020200000000000000000101010101010101010101010101010202020202020201010101010102020202020202020101010101010101010101020202010600000006020204040404040404040404040404040404040202020202020202020202020202020202020202020202020202020202020202020202020202020202020202060000060202020200000000020200000000000001010000000000000000000000000000000000000000000202020202020202020200000000000002020202020202020202020202020000000000000000000000000101010101010101010101010202020202020201010101010202020202020202010101010101010101010101010101010606000602020404040404040404040000000000000000020202020202020202020202020202020202020202020202020202020202020202020202020202020202020600000602020202000000000002000000000000000000000000000000000000000000000000000000000000020202020202000000000000000000020202020202020202020202020202020000000000000000000000000000000000000404000000020202020202020101010101020202020202020201010101010101010101010101010101000608000604040404040404040001010101010101010102020202020202020202020202020202020202020202020202020202020202020202020202020202020202060006020202020000000000000200000000000000000000000000000000000000000000000000000000000000000000000000000000000000000002020202020202020202020202020202000000000000000000000000000000000000040404040400020202020202010101010102020202020202020101010101010101010101010101010100040600060404040404040404000101010101010101010202020202020202020202020202020202020202020202020202020202020202020202020202020202020600000602020202000000000101020201000000000000000000000000000000000000000000000000000000000000000000000000000000000000000202020202020202020202020202020200000000000000000000000000000202020004040404040404000102020201010101010202020202020202010101010101010101020101010101010404060000060404040404040001010101010101010101020202020202020202020202020202020202020202020202020202020202020202020202020202020202060006020202020000000001010202020101000000000000000000000000000000000000000000000000000000000000000000000000000000000000020202020202020202020202020202020202020202000000000000000002020202020404040404040400000102010101010101010202020202020101010101010101010202010101010100040404000006040404040404000101010101010101010102020202020100020202020202020202020202020202020202020202020202020202020202020202020600000602020000000000000101020202010100000000000002020200000000000000000000000000000000000000000000000000000000000000000002020202020202020202020202020202020202020202000000000000000202020202040404040404040400010101010101010101010101010202010101010101010102020201010101010004040406000006040404000000010101010101010101010102020202010000000000020202020202020202020202020202020202020202020202020202020202060006000200000000000000010102020201010000000a0a0a02020202000000000000000000000000000000000000000000000000000000000000000002020202020202020101020202020202020202020202000000000000000202020202040404040404040400000001010101010101010101010101010101010101010102020101010101010004040404000006000000000000010101010101010101010102020201010000000000000202010202020202020202020202020202020202020202020202020206000006000000000000000000010102020201010000000a0a020202020202000000000000000000000000000000000000000000000000000000000000020202020202020201010100020202020202020202020200000000000000000000000004040404040404040404040000010101010101010101010101010101010101010101010101010101010004040406000000000000000001010101010101010101010202010100000000000000000002020202020202020202020202020202020202020202020202020600000000000000000000000001010202020201000000000a0a02020202020200000000000000000000000000000000000000000000000000000000000202020202020200000100000000000000000202020200000000000000000000000000040404040404040404040404000000010101010101010101010101010101010101010101010101010100040404060000060000000001010101010101010101010101020000000000000000000003000007020202020202020202020202020202020202020202020200000602000000000000000000010102020202000000000000000202020202020200000000000000000000000000000000000000000000000000000000020202020202000000000000000000000000000000000000000000000000000000000000000000020202020404040400000001010102020202020201010101010101010101010101010101010100000406000806000000010101010101010101010000000000000000000000000000000000000002000202020202020202020201010202020202020202060000020200000000000000000000010202020202000000000000000202020202020001010100000000000000000000000000000000000000000000000000020000000000000000000000000000000101010100000000000000000000000000000101010102020202040404000000020202020202020202020201010101010101010101010101010101010101010100000600010101010101010101010100000000000000000000000000000000000000000202020202020202020202020101010000000002020206000602020200000000000000000001020202020202020202000000000202020202010101010101000000000000000000000000000000000000000000000000000000000000000000000000000001010101010100000000000000000000000000010101010202020204040400000002020202020202020202020101010101010101010101010101010101010101010000060101010101010101010101000000000000000000000000000000000000000000000000000002020202020202020101000000020202020000060202020000000000000000000000020202020202020202000000000002020202010101010101000000000000000000000000000000000000000000000000000000000000000000000000010101010101010000000000000a0a00000000010101010102020202040404000000020202020202020202020201010100000000010101010101010101010101010100000601010101010101010101010000000000000000000000000000000000000000000000010101010102020202020201010000000202020600060202020200000000000000000000000202020202020202020200000000010102010101010101010000000000000000000000000000000000000000000000000000000000000000000000000101010101010101000000000a0a0a00000000010101010101010004040400000000020202020202020201010101010100040400000101010101010101010101010100080601010101010101010101010000000000000000000000000002000000000000000001010101010102020202020201000000000202020608060202020200000000000000000000000202020202020202020200000101010101010101010101010202020200000000000000000000000000000000000000000000000000000000000000000101010101010101000000000a0a0a00020200010101010101010404040400000000000002020202020101010101010100020202020202020202020201010101010100000601010101010101010101010000000000000000000000000000000000000000000001010101010102020202020200000000000202060000060202020200000000000000000000000002020202020202020202000101010101010101010101010202020202000000000000000000000200000000000000000000000000000000000000000101010101010101000000000a0202020202020201010101010104040404000000000000010202020201010101010101020202020202020202020202010101010106000006010101010101010101010100000006060000000000000000000000000000000000010101010101020202020202000000000000020600060202020202000000000000000000000000000000000202020202020000000101010101010101010102020202020000000000000000000202000000000000000000000000000000000000000101010101010101010000000002020202020202020101010101000404040400000000000001020202020201010101010100020202020202020202020202010101010600000101010101010101010101000000060000060002020200000000000000000202020000010101010101020202020100000404040400060006020202020200000000000000000000000000000000000202020202020000010101010101010101010202020202000000000000000002020200000000000000000000000000000002020000010101010101010101000000000202020202020202000000000404040404040000000000020202020202010101010101010100000101010202020202020201010106000006010101010101000000000000000600080600000002020200000000000000020202020202000000010101020202010100040404040600000600020202020200000000000000000101010100000000000202020202000101010101010101010101020202020202000000000000000202020000000000000000000000000000000202020001010101010101010100000000020202020202020200040404040404040404000000000202020202020101010101010101010101010101010202020202020101010600000600000000000000000000000006000006000000000000000000000000000000000202020200000000010101010101010004040404060000000002020202020000000000000101010101010100000000000202020202010101010000000000000102020202020200000000000002020202000000010101010101000000020202020200010101010101010101010000000000020202020202000004040404040202040400000000020202020202000000000101010101010101010101010202020202010106000006000000000000000000000000060000060000000000000000000000000000000000000000000000000000010101010101000404040400000600000202020202000000010101010101010101010000000000020202020200000000000000000000000602020202020000000000020202020200010101010101010101010202020202020001010101010101010101000000000002020202020200000404040402020202040000000002020202020000000000000101010101010101010101020202020202060000000000000000000000000000060000000600000001010101000000000000000000000000000000000000000001010101010100040404060000060400020202020101010101010101010101010101000000000000020202020200000000000000000000010202020202000000000002020202020101010101010101010102020202020200000101010101010101010100000000000202020202020000040404040202020204000000000002020200000000000000000101010101010101010102020202020606080006000000000000000000000600000806000001010101010101010000000000000000000000000000000000000101010101010004040408000604040a00020200010101010101010101010101010101000000000002020202020008000000080000000801020202020200000000000202020202010101010101010101010202020202020001010101010101010101010000000000020202020202000000040404020202040400000000000000000000000000000000010101010101010101010102020206060000060000000000000000000600000000060000000101010101010101010100000000000000000000000000000000010101010101000404060000060404000000000001010101010101010101010101010100000000000002020202000000000000000000000102020202020000000002020202020201010101010101010102020202020200000101010101010101010101000000000202020202020200000004040402020204040000000000000000000000000000000001010101010101010101010202060600000600000000000000000606000000060600000000010101010101010101010100000000000000000000000000000001010101010100040406000604040404000000000101010101010101010101010101010000000000000202020202000000000000000000010202020202020202020202020202020101010101010101010202020202020001010101010101010101010100000000020202020202020202000404020404040404000000000000000000000000000000000101010101010101010101010606000006000000000000000006000000000600000000000001010101010101010101010101010000000000000000000004000101010101010004060000060404040400000000010101010101010101010101010101000000000000020202020202000000000600000000010202020202020202020202020202010101010101010102020202020202010101010101010101010101010000000002020202020202020202020202040404040400010101000000000000000000000000010101010101010101010106060800060000000000000006000800000600000000000000000101010101010101010101010101010000000000000004040400010101010101000406000804040404040000000000010101010101010101010101010000000000000002020202020202000000000000000001000002020202020202020202020201010101010101010102020202020101010101010101010101010100000000020202020202020202020202020204040404000101010101000000000000000000000001010101010101010101060000000602000000000000060000000606000000000000000000000000010101010101010101010102020200000000040404040400010101010100040000060404040404000000000000000000000101010101010101000000000000000002020202020000000000000000000000000202020202020202020202010101010101010101010101010101010101010101010101000000000000000002020202020202020202020202020404040401010101010101000000000000000000000101010101010101000600000006020200000000000600000006000000000000000000000000060604000001010101010101010202020202040404040404040001010101010006000006040404040400000000000000000000000000000101000000000000000000000202020200000000000000000000000000000202020202020202020201010101010101010101010101010101010101010100000000000000000000000202020202020202020202020204040404000101010101010101000000000000000000000000000000000006000000060002020000000006000006000000000000000000000000000000000006060001010101010101020202020202020404040404000101010101010600000404040404040000000000000000000000000000000000000000000000000000020202020000000000000000000000000000020202020202000000000101010101010101010101010101010101010101000000000000000000000000000100000000000000000004040404040202010101010101010101010000000000000000000000000000060008000600020002000000060008060000000000000000000000000000000600000800060601010101010102020202020202040404040400010101010101000006040404040404000a0a0a0a0000000000000000000000000000000000000000000202020200000000000000000000000000000002020202000000000000010101010101010101010101010101010101010000000000000000000000000101010100000000000000000404040202020202020101010101010101010102010100000000000000060000060000020202000200060000060000000000000000000000000000000000060600000000060601010101020202020202020404040404000101010101010000060404040404040a0a0a0a0a0000000000000000000000000000000000000000000202020200000000000000000000000000000002020200000000000000010101010101010101010101010101010101010000000000000a00000000010101010100000000000000000004040202020202010101010101010101010202020200000000000006000006000002020202020000060000000000000000000000000000000000000000000000060000000006010101010102020202020404040404000101010101060000060404040404040a0a0a0a0a0a000000000000000000000000000000000000000002020202000000000000000000000000000000000202000000000000000101010101010101010101010101010101010100000000000a0a000000000101010101000000000a0000000000020202020201010101010101010101010202020202020000000600000600000002020202020000000006000000000000000000000000000000000000000000000006000000060101010104040402020404040404000101010101060000040404040404040a0a0a0a0a0a00000000000000000000000000000000000000000002020000000000000000000000000000000000020200000000000000010101010101010101010101010101010101010000000000000a00000000000101010100000000000000000000000202010101010101010101010101010202020202020200060008060000000002020202020a06000006000000000000000000000000000000000000000000000000060000000601010104040404040404040404000101010101060000040404040404000a0a0a0a0a0a0000000000000000000202020200000000000000000000000000040404000000040404000000000002020000000000000001010101020202020202010101010101010100000000000000000000000000010101000000000000000000000000000001010101010101010101010101020202020202020600000600000000000002020202000600000000000000000000000000000000000000000000000000000001060000000601000404040404040404040400010101010106000004040404040400000a0a0a0a0a00000000000000000202020202000000000101000000000404040404040000000404040404040400020200000000000000010202020202020202020202010101010101000000000000000000000000000000000000000000000000000a0a0000000101010101010101010100000000000000000006000006000000000000000202020200000006000000000000000000000000000000000000020202020200000001010600000006040404040404040404040101010101010600000604040404000000000000000000000000000000000202020202000000010101010000040404040404040000000402040404040404020000000000000001020202020202020202020202010101080808000000000000000000000000000000000000000000000000000a0a0000000101010101010101010000000000000000000006000006000000000000000202020206000006020202000404040404040000000000000002020202020200000000010106000000000606040404040404040101010101020200000602020202000000000000000000000000000000000202020200000001010101010100000404040101010404040202020202020202040404000000000102020202020202020202020201010100080808080800000000000000000000000002020202000000000000000a0a0000000101010101010101010000000000000000000608000600000000000000000202020600080600020202020404040404040404000000020000000202020200000000000000060600080000000606040202000101010101020206000602020202020000000000000000000000000000020202020000000101010101010101000404040101010404040202020202020202040404000001010102020202020202020202020101000408080808080808000000000000000000000202020202000000000000000a0a0000000101010101010101000000000000000000000000060101010000000000000002060000060001020202020004040404040404040002020000000202020000000000000000040406060000000000060606020201010101020206000006020202020000000000000000000000000000000202000000010101010101020201010004040101010404040202020202040404000001010101010101020202020202020202010100040808080808080808080000000000000000020202020200000000000000000a0a00000001010101010101010000000000000000000600000601010101000000000006060000060101010202020202000404040404040402020200000002020000000000000000000404040404060600000000000006060101010102010600060202020000000000000000000000000000000000000000000101010101020202010100000404040404040404020202000000010101010101010101010102020202020202020100040808080808080808080808000000000000000002020a0a00000000000000000202000000010101010101010100000000000000000006000601010101010100000006000000060202020202020202020004040404040402010101010002020000000000000000000004040404040404040606060000000000060601010106000006020000000000000001010101010100000004040404000101010101020202020101010004040404040404000001010101010101010101010101010101010202020202020101000808080808080808080808080800000000000000000a0a00000202020202020202020200000101010101010101020000000000000000000006010101010101000600000006060202020202020202020200040404040404020101010000000000000000000000000000040404040404040404040206060600080000000601010608060600000000000000010101010101010000000404040001010101010202020201010100040404040404040001010101010101010101010101010101010101020202020201010408080808080808080808080808000000000000000000000002020202020202020202020000010101010101010202020000000000000600000601010101010606000000060002020202020202020101010004040404040402010101000000000000000000000000000004040404040404040404040402020606060000000006060000060000000000000001010101010101000004040404000001010101020202020101010000040404040400000101010101010101010101010101010101010102020202010101080808080808080808080808080808000000000000000000000202020202020202020200000001010101010101020200000000000000060000060101010106000000060600020202020202020202010101000404040404040404000006060600000000000000000000000404040404040404040404040001010201060600000006060000060000000000000101010101010000040404040404000101010102020201010101010004040404000000000001010101010101010101010101010101010202020201010108080808080808080808080808080800000000000000000002020202020202020202000000000101010101010101020000000000000006000006010106060000000601000002020202020202020201010004040404040404040400000606060000000000000000000000040404040404040404040404040001010101010600000006060000060000000000010101010101000004040404040400010101010101010101010101000000000000000000000000000101010101010101010101010101010202020101080808080808080808080808080808080100000000000000000202020202020000000000000001010101010101010100000000000000000600000601060008000601010101010202020202020202020000040404040402020404040000060606000000000000000001010100040404040404040404040404000000010101000006000806060008060000000001010101010100020204040404040400010101010101010101010101010000000000040404040404040001010101010101010101010101010201010108080808080808080808080808080808080100000000000000020200000000000101010101010101010101010101000000000000000001060000060600000006020101010101020202020202020202020404040404020202020404000000000000000000010101010101010101040404040404040404040400000000000202000006000000000000060000000101010101020202020404040404040001010101010101010201010101010101000004040404040404040001010101010101010101010101010101010808080808080808080808080808080808080100000000000000000000000101010101010101010101010101010100000000000000010101000006000006060101010101010102020202020202020202040404040402020202040400000000000000000101010101010101010100040404040404040404040000000000020200000006000000000000060000010101010202020202000004040404040101010101010102020201010101010100000404040404040404040001010101010101010101010101010108080808080808080808080808080808080808010100020200000000000001010101010101010101010100000000000001010101010101010106000000060101010101010101010202020202020202020204040404040202020204040000000000000001010101010101010101010104040404040404040404000000000002020000000006060000000000060001010101020202020200000004040404010101010101020202020101010101010100040404040404040404040101010101010101010101010101010808080808080808080808080808080808080801010202020000000000010101010101010101010101000000000000000101010101010101010600080601010101010102020202020202020202020202020404040404020202020404000000000000000101010101010101010101010404040404040404040400000000000202000000000000060800000008060101010102020202020000000404040401010101010202020202010101010101010004040404040404040404000101010101010101020202010101080808080808080808080808080808080808080101020202000000000001010101010101010101010101010101010101010101010101010202060000060201010101010202020202020202020202020202020202020202040404040000000000000000010101010101010101010101040404040404040404000000000000020202000000000000000606000000060101010202020200000000040404040101010102020202020201010101010101000404040402020202020401010101010101020202020201010808080808080808080808080808080808080808010102020200000000000101010101010202020202020101010101010101010101010101020201060006020101010101020202020202020202000000000202020202020200000000000002020202000000010101010101010101010100000000000000000000000000040202020204040404000000000006000006060101020202020000000000040404010101020202020202020101010101010100040402020202020202020201010101010202020202020101080808080808080808080808080808080808080801010202000000000000020202020202020202020202020101010101010101010101010102020206000602010101010102020202020202020200000000020202020202020000000000040402020404040000010101010101010101010000000000000000000000040404020202020404040404000000000006000006010202020202000000000004040402020202020202020202010101010101010100020202020202020202020201010102020202020202010108080808080808080808080808080808080808080801000000000000000202020202020202020202020201010800000008000101010101020202020608000601010101010202020202020202020000000000020202020202000000000004040404040404040400000101010101010100000000000000000000000004040402020202040404040404000000000006000006000202020200000000000404020202020202020202020201010101010101010102020202020202020202020101010202020202020201010808080808080808080808080808080808080808080101000000000002020202020202020202020202010000000000000000000602020202020202010600060101010101010202020202020202000000000002020202020000000000000404040404040404040404040400000000000000000000000000000000000404040202020204040404040400000000000006000006020202020000000000040402020202020202020202020101010101010101020202020202020202020202020001020202020202020108080808080808080808080808080808080808080808010100000000000202020202020202020202020101000000000000000000010102020202020202060006000001010101020202020101010100000000000000000000000000000000040404040404040404040404040404040000000000000000000000000000040404040202000000010101010101000000000006000006000000000000000004040202020202020202020202010101010101010102020202020101010101000002020202000001020201010808080808080808080808080808080808080808080801010100000001020202020202020202020202010000000000000000000000010202020202020206000006040400010102020201010101010102020000000000000000000000000004040404040404040404040404040404000000000001010101010101010100000000020201010101010101010101000000020206000006000000000000000404020202020202020202020200010101010101020202020202010101010100000202020200000000000101080808080808080808080808080808080808080808080101010101010101010101010101010101010101010000080000000800000102020202000202020600000604040400010102020101010101010202010101000000000000000000000404040404040404040404040404040400000000000101010101010101010101010101010101010101010101010100000202020606000600000000020202020202040202020202020202020400010101010102020202020101010101010000020202020000000000000008080808080808080808080808080808080808080808080101010101010101010101010101010101010101000000000000000001010202010100040402020600060404040001010201010101010101020202010100000000000000000000040404040404040404040404040404040000000000010101010101010101010101010101010101010101010101010000020202020600000600000002020202020204040202020202020202020001010101010202020202010101010101000002020202000000000000000808080808080808080808080808080808080808080808010101010101010101010101010101010101010101000000000001010101010101010004040404060006040404000101010101010101010102020201010000000000000000000004040404040404040404040404040404000000000001010101010101010101010101010101010101010101010101000002020202020600000000000002020202040404040202020202020202000001010101010102020101010101010100000002020000000000000000080808080808080808080808080808080808080808080801010101010101010101010101010101010101010101010101010101010101010101000404040406000004040400010101010101010101010202020101000000000000000000000404040404040404040404040404040400000000000101010101010101010101010101010101010101010101010100000202020202060000060000000000040404040404040402020202020400000101010101010101010101010101010000000000000000000000000008080808080808080808080808080808080808080808080001010101010101010101010101010101010101010101010101010101010101010100040404040600000402020401010101010101010101020202010100000000000000000000040404040404040404040404040404000000000000010101010101010101010101010101010101010101010101010000020202020202060806000000000000040404040404040404020202040400000101010101010101010101010101000000000000000000000000000808080808080808080808080808080808080808080808010100000001010101010202010101010101010101010101010101010101010101010000040404060000060202040000010101010000000002020200000000000000000000000004040404040404040404040404040400000000000001010101010101010101000000000101010101010101010101000000020202020206000006020000000004040404040404040404020404040404000101010101010101010101010100000000000000000000000000080808080808080808080808080808080808080808080101000000000001010101020202010101010101000404010104040000010101010101010000000004000006020204040404040400000000000202020000000000000000000000000404040404040404040404040404000000000000000101010101010101000004040404040000010101010101010000000002020202020206000602000000000404040404040404040404040404040404000101010101010101010101010100000000000000000000000008080808080808080808040408080808080808080808010102000000000101010102020201010101010004040404040404000001010101010101010000000000000602040404040404040400000000020202000000000000000000000000040404040404040404040404040000000000000000010101010101010000000404040404040400000001010100000000000000000000000600000000000000000404040400000000000402040404040404000101010101010101010101010000000000000000000000000808080808080808080404040408080808080808080801010202000000000101010202020201010100040404040000000000000101010101010101010100000600060404040404040404040000000002020200000000000000000002020404040404040404040404040404000000000000000000010101010100000000000404040404040404040404040000000000000000000000060000060000000000000400010101010101000204040404040404010101010202020202020201000000000000000000000000080808080808080808020202020808080808080808080101020200000000010101010202020101010000000000000000000000000101010101010101010101060006040404040404040404040400000202020000000000000000020202020404040404040404040404040000020200000000000001010101010000000000040404040202020202020404000000000000000000000000000006000000000000000001010101010102020204040404040400010102020202020202020100000000000000000000000000080808080808080802020202080808080808080808010102020200000000010101020202010100000000000a0a0a0000000000010101010101010101010106000000040404040404040404040404020202000000000000000002020202040404040404040404040000000202020200000000000001020100000000000004040404020202020202040400000000000000000000000006000000000000000000010101010101010104040404040404040001010101010101010101010000000000000000000000000808080808080808080a0202000808080808080808080100020202000000000101010102020101000000000a0a0a0a000000000001010101010101010101010600000604040404040404040404040402020204040404040404040202020404040404040404040400000000020202020000000000000101010000000000000004040404020202020202040000000000000000000000000600000600000000000202020202020201010000000000000004040101010101010101010101000000000000000000000000080808080808080808080a00080808080808080808080100020202020000000001010102020101000000000a0a0a0a000000000001010101010101010101010600080600040404040404040404040402020204040404040404040404040404040400000000000000000000000200000000000000000101000000000000000004040404020202020202020202020000000000000000000000000600000000020202020202020202010000000000000000000101010101010101010101000000000000000000000000080808080808080808080808080808080808080808080000020202020000000001010102020200000000000a0a0a0a00000000010101010101010101010101010000060004040404040404040404020202020404040404040404040404040404000000000000000000000000000000000000000000010101000000000000000404040402020202020202020202020000000000000000000808060000000002020202020202020200000000000000000000010101010101010101010100000000000000000000000008080808080808080808080808080808080808080800000002020202020000000000000202020000000000000a0a0000000000010101010101010101010101010600060004040404040404040404020202020404040404040404040404040400000000000000000000000a000000000000000000000101010000000000000000040404020202020202020202020200000000000000000006080600000000020202020202020202020000000000000000000101010101010101010101000000000000000000000000000808080808080808080808080808080808080808000002020202020202000000020202020202000000000000000000000000010101010101010101010101010600000004040404040404040404020202020204040404040404040404040400000000000000000000000a0a0a000000000000000001010100000000000000000404040404020202020202020202020000000000000000060806000000000002020202020202020202000000000000000001010101010101010101010000000000000000000000000008080808080808080808080808080808080808080000020202020202020202020202020202020000000000000000000000010101010101010101010101010106080006040404040404040404040202020202040404040404040404040404000000000000000000000a0a0a0a000000000000000101010101000000000000000404040404040202020202020202020202020202000000060808000000000000000000000202020202020202020202020001010101010101010101010002020200000000000000000000080808080808080808080808080808080808080000020202020202020202020202020202020000000000000000000000010101010101010101010101010101000006040404040404040404040202020202020404040404040404040404000000000000000000000a0a0a0a0a0000000000000101010101010000000000000404040404040402020202020202020202020202020202060808000000000000000000000202020202020202020202020001010101010101010101010000020200000000000000000000080808080808080808080808080808080808000000020202020202020202020202020202020200000000000000000001010101010101010101010101010101060000000404040404040404040202020202020404040404040404040404000000000000000000000a0a0a0a0a00000101000001010101010100000000000004040404040404020202020202020202020202020202020608080000000000000000000a0a0202020202020202020200000101010101010101010101000000000000000000000000000008080808080808080808080808080808080800000002020202020202020202020202020202020000000000000000000101010101020202010101010101010106000006000000040404040404040202020202040404040404040404040400000000000a0a0a000000000000000600010100000101010101010100000000000404040404040404020202020202020202020202020202060808000202020000000000000a0a020202020202020200000001010101010101010101010000000000000000000000000000080808080808080808080808080808080808080000020202020202020000000a0a0202020202020000000000000001010101010202020201010101010101010100000600000000000004040404020202020202040404040404040404000000000000000800000008000000080000010100000101010101010101000002020004040404040404020202020202020202020202020202060806020202020202000000000000000000020202020200000001010101010101010101010000000000000000000000000000080808080808080808080808080808080808080000000202020202000000000a0a0202020202020200000000000001010101010202020201010101010101010106080806000000000000040404040404040202020202020404040400000000000000000000000000000000000806010101000101010101010100000202020004040404040404020202020202020202020202020202060806020202020202000000000000000000000202020200000001010101010101010101010000000000000000000a0a0a0000080808080808080808080808080808080808000000000202020202000000000a0a0a02020202020202020000000001010101010102020101010101010101010106080806000000000000000004040404040202020202020204040400000000000000000000000000000000000806010101000001010101010100000202020004040404040404020202020202020202020202020202060806020202020202000000000000000000000202020200000001010101010101010101010000000000000000000a0a0a0a00080808080808080808080808080808080808000000000202020202000000000a0a0a0202020202020202020000000101010101010101010101010101010101010106080800000000000000000004040404020202020202020204000000000000000000000000000000000000080102010000000000000000000000020202000404040404040402020202020202020202020202020206080602020202020200000000000000000000020202020000000101010101010101010101010000000000000000000a0a0a0000080808080808080808080808080808080a0a00000002020202020000000a0a0a0a0202020202020202020200010202020101010101010101010101010101010106080806000000000000000000000000020202020202020202020200000000000000000000000800000008010202020000000000000000000000020202000404040404040404000000000202020202020202020008080602020202020202000000000000000000020202020202000001010101010101010101010101010000000000000a0a0a0000080808080808080808080808080808080a0a0a000004020202000000000a0a0a0a000000020202020202020101020202020101010101010101010101010101010106080806000000000000010101010202020202020202020000020202000000000000000000000601010102020202000000000000000000000002020200000404040404040000000000000000020202020202060808060202020202020200000000000000000202020202020202000000010101010101010101010101010000000000000a0a00000008080808080808080808080808080a0a0a0a0a0004020200000000000000000000000000000202020202020202020201010101010101010101010101000000000608080600000000010101010202020202020202020200000000000000000000000000010101020202020202020200000000000000000000000000000000000404040000000000000000000000000002020206080602020202020202020000000000000000020202020202020200000000000000000101010101010101010000000000000000000008080808080808080808080808080a0a0a0a0a00040000000000000000000000000000000002020202020202020101000004040404000000000000000000000000060808060101010101010202020202020202020201010100000000000000000000010101020202020202020202020000000000000000000000000100000000000000000000000000000000000000000000060806020202020202020202000000000002020202020202020202000000000000000000010101010101010101000000000000000000000808080808080808080808080a0a0a0a0a0a00000000000000000000000000000000000002020202020202020100040404040404040400000000000000000000060808060101010101020202020202020202020201010101000000000000000000010101020202020202020202000000000000000000000000010101000000000000000000000000000000000404040406080806020202020202020202020202020202020202020202020202000000000000000000010101010101010101000000000000000000000808080808080808080a0a0a0a0a0a0a0a0a0a0000000000000000000000000000000000020202020202020201000404040404040404000000000000000000000106080801010101010202020202020202020202010101010100000000000000000000000202020202020202000000000000000000000000000101010000000000000000000000000404040404040404060806020202020202020202020202020202020202020202020202020000000000000000000101010101010101010000000000000000000000080808080808000a0a0a0a0a0a0a0a0a0a0a000000000000000000000000000000000000020202020202020100040404040404040404000000000000000000010608080601010101020202020202020202020201010101010000000000000000000000020202020200000000000000000000000000000000010101000000000000000000000004040404040404040600080602020202020202020202020202020202020202020202020202020000000000000000010101010101010101000000000000000000000000080808080000000a0a0a0a0a0a0a0a0a0a000000000000000000000000000000000000000202020202010004040404040404040404000000000000000000000108080601010101010202020202020202020201010101010000000000000000000000000202020000000000000000000000000000000000010101000000000000000000000404040404040404040600080001020202020202020202000002020202020202020202020202020000000000000000010101010101010101000000000000020202020000000000000000000a0a0a0a0a0a0a0a0a00000000000000000000000000000000000000000000020202000404040404040404040404000000000000000000000006080801010101010101010102020202020101010101010000000000000000000000000202000000000000000000000000000000000000000100000000000000000000000404040404040404060008060001010202020202020000000000000000020202020202020202020202000000000000010101010101010101000000000002020202020000000000000000000000020a0a0a00000000000000000000000000000000000000000000000000000000000404040404040404040404000000000000000000000006080006010101010101010101020202020101010101010100000000000000000000000002000000000000000000000000000000000000000000000000000000000000000004040404040404060000060000010101000000000000000000000000020202020202020202020202020000000001010101010101010101010000000000020202020200000000000000000002020000000000000000000000000000000000000000000000000000000000000000040404040404020404040400000000000000000000000008000600010101010101010101020202010101010101010000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000404040404040600000604040001010100000000000000000000000000020202020202020202020202020000010101010101010101010101000000000000000000000000000000000002020202020000000000000000000000000000000000000000000000000000000000000004040404040202020404040000000000000000000000000800060000010101010101010102020201010101010101010000000000000000000000000000000000000000000000000000000000000000000002020000000000000000000404040404000000040408080808080808080808080808080800000000000002020000020202020202010101010101010101010101010101000000000000000000000000000000000202020202000000000000000000000000000000000000000000000000000000000000000404040404040404040404000000000000000000000000060806000000010101010101010202020101010101010101020200000000000000000000000000000000000000000000000000000000000000000202020000000000000000000404040600000008080808080808080808080808080808080808000000000000000002020202020202010101010101010101010101010100000000000000000000000000000000020202020200000000000000010101010100000000000000000000000000000000000000040404040404040404040404000000000000000000000006000000000000010101010101020202010101010101010102020100000000000000000000000000000000000000000000000000000000000000000202020000000000000000000a0a080808080808080808080808080808080808080808080808080000000000010102020202020201010101010101010101010101010100000000000000000000000000000002020202020000000000010101010101010101010000000000000000000000000000000004040404040404040404040400000000000000000000000600000000000001010101010102020201010101010101010202010100000000000000000000000000000000000000000000000000000000000000020202000000000000000000080808080808080808080808080808080808080808080808080808080808000101010102020202020101010101010101010101010101010000000000000000000000000000000002020202000000000001010101010101010101000000000000000000000000000000000a040404040404040404040400000000000000000000000600000600000001010101010102020202010101010101010101010100000000000000000000000000000004040404040400000000000000000000000000000000000000000008080808080808080808080808080808080808080808080808080808080808080801010101010202020101010101010101010101010101010000000000000000000000000000000000020202000000000000000101010101000000000000000002020000000000000000000a040404040404040404040404000000000000020200000608000600000001010101010202020202020202020201010101000000000000000000000000000000040404040404040404040404000000000000000000000000000000000808080808080808080808080808080808080808080808080808080808080808080808080101010102020101010101010101010101010101010101010000000000000000000000000000020202000000000000000000000000000000000000000202020000000000000000000a04040404040202020202020202000002020202020200000808060000000101010101020202020202020202020201000000000000000000020202020000000404040404040404040404040404040000000000000000000000000008080808080808080808080808080808080808080808080808080808080808080808080808010101010101010101010101010101010101010101010202020000000000000000000000000002020202000000000000000000000000000000000101020200000000000000000000000404040402020202020202020202020202020202020000080806000000000101010202020202020202020202020100000000000000000002020202020a040404040404040402020204040404040400000000000000000000000008080808080808080808080808080808080808080808080808080808080808080808080808080101010101010201010101010101010101010101020202020202000000000000000000000002020202000000000000000000000000000000000101000000000000000000000000000404040202020202020202020202020202020202020000060806000000000000000202020202020202020202020000000000000000000002020202020a0404040404040404020202040404040404000000000000000000000000080808080808080808080808080808080808080808080808080808080808080808080808080808010101010102020101010101010101010101020202020202020101010100010101000000000202020000000000000000000000000000000001010100000000000202020202000004040402020202020202020202020202020202020200000608060000000000000000020202020202020202020200000000000000000000020202020a04040404040404040404040204040404040000000000000000000000000808080808080808080808080808080808080808080808080808080808080808080808080808080808010101010202000000000000000001010202020202020202020101010101010101000000000000000000000000000000000000000000000101010000000002020202020202000404000002020202020202020202020202020202020000060806000000000000000000010101020202020202010000000000000202020200000a0a0a0404040404040404040404040404040404000000000000000000000000080808080808080808080808080808080808080808080808080808080808080808080808080808080801010101020202000000000000000002020202020202020202020202020201010100000000000000000000000000000000000000000000010101000000020202020202020200040001010101010101010102020202020101020202000006080600000000000000000001010101020202020201000000000002020202020a0a0a0a0a0404040404040404040404040404040400000000000000000000000008080808080808080808080808080808080808080808080808080808080808080808080808080808080801010101020200000000000000000202020202020202010101020202020202010100000000000000000000000000000000000000000000010101000000020202020202020200040001010101010101010101020201010101010101010106080600000000000000000001010101010202020101000000000002020202020a0a0a0a0a040404040404040404040404040404040000000000000000000000000808080808080808080808080808080808080808080808080808080808080808080808080808080808080801010100000000000000000002020202020202010101010102020202','hex'),4)
on conflict(id)do update set seed=excluded.seed,cols=excluded.cols,rows=excluded.rows,cell_size=excluded.cell_size,
 walkable=excluded.walkable,terrain=excluded.terrain,version=excluded.version;
alter table public.peris_world_map add constraint peris_world_map_walkable_check check(octet_length(walkable)=5000);
alter table public.peris_world_map add constraint peris_world_map_terrain_check check(octet_length(terrain)=40000);

create or replace function public.peris_world_walkable(p_x numeric,p_y numeric)returns boolean
language sql stable security definer set search_path='' as $$
 select coalesce((select get_bit(walkable,(floor(public.peris_wrap_world(p_y)/128)::integer+100)*200+floor(public.peris_wrap_world(p_x)/128)::integer+100)=1
 from public.peris_world_map where id=1),false)
$$;

-- Preserve every old site ID and coordinate. New sites require eight dry neighbours.
insert into public.spawn_points(id,x,y)
select site.id,site.x,site.y from (
 select 10013+row_index*50+column_index as id,(column_index*4-98)*128+64 as x,(row_index*4-98)*128+64 as y
 from generate_series(0,49) as rows(row_index) cross join generate_series(0,49) as columns(column_index)
) site
where not exists(select 1 from generate_series(-1,1) dx cross join generate_series(-1,1) dy
 where not public.peris_world_walkable(site.x+dx*128,site.y+dy*128))
 and not exists(select 1 from public.spawn_points existing where existing.x=site.x and existing.y=site.y)
on conflict(id)do nothing;

-- Tactical terrain comes from the canonical field byte, never a caller-provided camp label.
alter table public.peris_camps add column if not exists bandit boolean not null default false;
alter table public.peris_camps add column if not exists faction text;
alter table public.battles add column if not exists defender_faction text;
create or replace function public.peris_battle_terrain(px numeric,py numeric)returns text
language sql stable security definer set search_path='' as $$
 select coalesce((select (array['plains','woods','highlands','farmland','desert','snow','marsh','river','coast','coast','darkland'])[1+get_byte(terrain,(floor(public.peris_wrap_world(py)/128)::integer+100)*200+floor(public.peris_wrap_world(px)/128)::integer+100)] from public.peris_world_map where id=1),'plains')
$$;
update public.peris_camps set terrain=public.peris_battle_terrain(x,y) where not bandit;
-- Persistent map claims are separate from the city's internal building slots.
create or replace function public.peris_wrap_world(p_value numeric) returns numeric
language sql immutable strict set search_path='' as $$
 select p_value-floor((p_value+12800)/25600)*25600
$$;
create or replace function public.peris_wrap_cell(p_value integer) returns integer
language sql immutable strict set search_path='' as $$
 select (((p_value::bigint+100)%200+200)%200-100)::integer
$$;
create or replace function public.peris_cell_distance(p_col integer,p_row integer,p_other_col integer,p_other_row integer) returns integer
language sql immutable strict set search_path='' as $$
 select greatest(least(abs(public.peris_wrap_cell(p_col)-public.peris_wrap_cell(p_other_col)),200-abs(public.peris_wrap_cell(p_col)-public.peris_wrap_cell(p_other_col))),
                 least(abs(public.peris_wrap_cell(p_row)-public.peris_wrap_cell(p_other_row)),200-abs(public.peris_wrap_cell(p_row)-public.peris_wrap_cell(p_other_row))))
$$;
-- Byte indices use the same eleven-terrain order as the generated world grid.
create or replace function public.peris_world_terrain(p_col integer,p_row integer) returns integer
language sql stable strict security definer set search_path='' as $$
 select get_byte(terrain,(public.peris_wrap_cell(p_row)+100)*200+public.peris_wrap_cell(p_col)+100)
 from public.peris_world_map where id=1
$$;

create unique index if not exists settlements_map_owner_key on public.settlements(id,owner_id);
create table if not exists public.peris_map_plots(
 col integer not null check(col>=-100 and col<100),row integer not null check(row>=-100 and row<100),
 settlement_id bigint not null,owner_id uuid not null references public.players(id) on delete cascade,
 building_type text check(building_type in ('lumber','quarry','farm','market')),
 level integer not null default 0 check(level between 0 and 5),primary key(col,row),
 foreign key(settlement_id,owner_id) references public.settlements(id,owner_id) on delete cascade,
 check(building_type is not null or level=0)
);
create index if not exists peris_map_plots_settlement_idx on public.peris_map_plots(settlement_id);
create index if not exists peris_map_plots_bounds_idx on public.peris_map_plots(row,col);
alter table public.peris_map_plots enable row level security;
drop policy if exists "own map plots" on public.peris_map_plots;
create policy "own map plots" on public.peris_map_plots for select to authenticated using(owner_id=public.peris_player_id());
revoke all on public.peris_map_plots from public,anon,authenticated;
grant select on public.peris_map_plots to authenticated;
alter table public.peris_orders drop constraint if exists peris_orders_kind_check;
alter table public.peris_orders add constraint peris_orders_kind_check check(kind in ('upgrade','recruit','field','settler'));
create unique index if not exists peris_orders_field_pending_key
 on public.peris_orders(owner_id,(split_part(item,':',2)),(split_part(item,':',3))) where kind='field';
-- Terrain modifiers produce fractional income; city base rates remain unchanged.
alter table public.settlements alter column wood_rate type numeric(18,4);
alter table public.settlements alter column stone_rate type numeric(18,4);
alter table public.settlements alter column food_rate type numeric(18,4);
alter table public.settlements alter column gold_rate type numeric(18,4);

create or replace function public.peris_field_modifier(p_type text,p_terrain integer) returns numeric
language sql immutable set search_path='' as $$
 select case p_type
 when 'farm' then case when p_terrain=2 then .75 when p_terrain in (0,3) then 1.1 when p_terrain in (4,5) then .85 else 1 end
 when 'lumber' then case when p_terrain=1 then 1.25 when p_terrain in (4,5) then .85 else 1 end
 when 'quarry' then case when p_terrain=2 then 1.3 when p_terrain=6 then .9 else 1 end
 when 'market' then case when p_terrain in (7,9) then 1.1 when p_terrain=5 then .9 else 1 end
 else 0 end
$$;
create or replace function public.peris_field_rates(p_sid bigint)
 returns table(wood numeric,stone numeric,food numeric,gold numeric)
language sql stable security definer set search_path='' as $$
 select coalesce(sum(6*level*public.peris_field_modifier(building_type,public.peris_world_terrain(col,row))) filter(where building_type='lumber'),0),
        coalesce(sum(5*level*public.peris_field_modifier(building_type,public.peris_world_terrain(col,row))) filter(where building_type='quarry'),0),
        coalesce(sum(8*level*public.peris_field_modifier(building_type,public.peris_world_terrain(col,row))) filter(where building_type='farm'),0),
        coalesce(sum(2*level*public.peris_field_modifier(building_type,public.peris_world_terrain(col,row))) filter(where building_type='market'),0)
 from public.peris_map_plots where settlement_id=p_sid and level>0
$$;
-- Existing city migration and debug calls must retain completed external income.
create or replace function public.peris_city_economy(p_sid bigint) returns void language plpgsql security definer set search_path='' as $$
begin
 update public.settlements s set
 wood_rate=14+8*coalesce((select level from public.buildings where settlement_id=s.id and building_type='lumber'),0)+f.wood,
 stone_rate=12+7*coalesce((select level from public.buildings where settlement_id=s.id and building_type='quarry'),0)+f.stone,
 food_rate=18+10*coalesce((select level from public.buildings where settlement_id=s.id and building_type='farm'),0)+8*coalesce((select sum(level) from public.peris_city_slots where settlement_id=s.id and building_type='fishery'),0)+f.food,
 gold_rate=3+3*coalesce((select level from public.buildings where settlement_id=s.id and building_type='market'),0)+f.gold,
 capacity=5000+2500*coalesce((select sum(level) from public.peris_city_slots where settlement_id=s.id and building_type='warehouse'),0),
 food_capacity=5000+2500*coalesce((select sum(level) from public.peris_city_slots where settlement_id=s.id and building_type='granary'),0)
 from public.peris_field_rates(p_sid) f where s.id=p_sid;
end $$;

create or replace function public.peris_claim_field(p_col integer,p_row integer) returns jsonb
language plpgsql security definer set search_path='' as $$
declare u uuid:=public.peris_player_id();s public.settlements%rowtype;c integer;r integer;home_col integer;home_row integer;distance integer;owned integer;population integer;allowance integer;
begin
 if u is null then raise exception 'Authentication required';end if;
 if p_col is null or p_row is null then raise exception 'Choose whole field coordinates';end if;
 -- Claim and spawn share one lock so neither can reserve another's starting land.
 perform pg_advisory_xact_lock(204200);
 perform public.peris_settle(u);
 if exists(select 1 from public.battles where status='active' and (attacker_owner_id=u or defender_owner_id=u)) then raise exception 'Finish the current battle first';end if;
 select * into s from public.settlements where id=public.peris_city_id(u) for update;
 if s.id is null then raise exception 'Settlement not found';end if;
 c:=public.peris_wrap_cell(p_col);r:=public.peris_wrap_cell(p_row);
 home_col:=floor(s.x/128::numeric)::integer;home_row:=floor(s.y/128::numeric)::integer;
 if exists(select 1 from public.peris_settler_expeditions where status='travelling'and public.peris_cell_distance(c,r,col,row)<=1)then raise exception 'Settlers have reserved this land';end if;
 if exists(select 1 from public.peris_map_plots where col=c and row=r) then raise exception 'This field is already owned';end if;
 if exists(select 1 from public.settlements where public.peris_cell_distance(c,r,floor(x/128::numeric)::integer,floor(y/128::numeric)::integer)=0) then raise exception 'This field contains a settlement';end if;
 if exists(select 1 from public.peris_camps where public.peris_cell_distance(c,r,floor(x/128::numeric)::integer,floor(y/128::numeric)::integer)=0) then raise exception 'An ancient campaign site protects this field';end if;
 if public.peris_world_terrain(c,r)=8 or not public.peris_world_walkable(c*128+64,r*128+64) then raise exception 'Resource buildings need dry land';end if;
 if exists(select 1 from public.settlements where id<>s.id and public.peris_cell_distance(c,r,floor(x/128::numeric)::integer,floor(y/128::numeric)::integer)<=1) then raise exception 'Another village protects its starting land';end if;
 distance:=public.peris_cell_distance(c,r,home_col,home_row);
 if distance>6 then raise exception 'Stay within 6 fields of your village';end if;
 select count(*) into owned from public.peris_map_plots where settlement_id=s.id;
 if owned<4 and distance<>1 then raise exception 'Choose your first four fields from the eight village neighbours';end if;
 select 80+10*greatest(0,case when(select count(*)from public.settlements where owner_id=u)=1 then upgrades else s.development_points end)into population from public.players where id=u;
 allowance:=4+case when population>=120 then 1+(population-120)/40 else 0 end;
 if owned>=allowance then raise exception 'More population is needed to claim another field';end if;
 if distance<>1 and not exists(select 1 from public.peris_map_plots where settlement_id=s.id and public.peris_cell_distance(c,r,col,row)=1) then raise exception 'Connect this field directly to your existing territory';end if;
 insert into public.peris_map_plots(col,row,settlement_id,owner_id) values(c,r,s.id,u);
 return jsonb_build_object('ok',true);
exception when unique_violation then raise exception 'This field is already owned';
end $$;

create or replace function public.peris_queue_field(p_col integer,p_row integer,p_type text) returns jsonb
language plpgsql security definer set search_path='' as $$
declare u uuid:=public.peris_player_id();s public.settlements%rowtype;p public.peris_map_plots%rowtype;c integer;r integer;factor numeric;cw numeric;cs numeric;cf numeric;cg numeric;
begin
 if u is null then raise exception 'Authentication required';end if;
 if p_col is null or p_row is null or p_type is null or p_type not in ('lumber','quarry','farm','market') then raise exception 'Choose a valid resource building and field';end if;
 perform public.peris_settle(u);
 if exists(select 1 from public.battles where status='active' and (attacker_owner_id=u or defender_owner_id=u)) then raise exception 'Finish the current battle first';end if;
 select * into s from public.settlements where id=public.peris_city_id(u) for update;
 if s.id is null then raise exception 'Settlement not found';end if;
 c:=public.peris_wrap_cell(p_col);r:=public.peris_wrap_cell(p_row);
 select * into p from public.peris_map_plots where col=c and row=r and owner_id=u and settlement_id=s.id for update;
 if p.settlement_id is null then raise exception 'Claim this field before constructing a building';end if;
 if p.level>=5 then raise exception 'This field has reached its maximum level';end if;
 if p.building_type is not null and p.building_type<>p_type then raise exception 'Upgrade the existing resource building';end if;
 if exists(select 1 from public.peris_orders where owner_id=u and kind='field' and item like 'field:'||c||':'||r||':%') then raise exception 'Construction is already underway on this field';end if;
 factor:=power(1.55::numeric,p.level);
 cw:=ceil((case p_type when 'lumber' then 80 when 'quarry' then 70 when 'farm' then 60 else 90 end)*factor);
 cs:=ceil((case p_type when 'lumber' then 50 when 'quarry' then 60 when 'farm' then 40 else 70 end)*factor);
 cf:=ceil((case p_type when 'farm' then 50 when 'market' then 40 else 30 end)*factor);
 cg:=ceil((case p_type when 'market' then 20 else 10 end)*factor);
 if s.wood<cw or s.stone<cs or s.food<cf or s.gold<cg then raise exception 'Your stores cannot cover this cost';end if;
 update public.settlements set wood=wood-cw,stone=stone-cs,food=food-cf,gold=gold-cg where id=s.id;
 update public.peris_map_plots set building_type=p_type where col=c and row=r;
 insert into public.peris_orders(owner_id,kind,item,quantity,started_at,finish_at) values(u,'field','field:'||c||':'||r||':'||p_type,1,public.peris_game_now(),public.peris_game_now()+make_interval(secs=>greatest(1,ceil((15+p.level*10)/public.peris_research_factor(u,'construction')))::double precision));
 return jsonb_build_object('ok',true);
end $$;

-- A modular upgrade may have refreshed city base formulas earlier in this file.
select public.peris_city_economy(id) from public.settlements where city_slots_ready;
revoke all on function public.peris_wrap_world(numeric),public.peris_wrap_cell(integer),public.peris_cell_distance(integer,integer,integer,integer),public.peris_world_terrain(integer,integer),public.peris_field_modifier(text,integer),public.peris_field_rates(bigint),public.peris_city_economy(bigint),public.peris_claim_field(integer,integer),public.peris_queue_field(integer,integer,text) from public,anon,authenticated;
grant execute on function public.peris_claim_field(integer,integer),public.peris_queue_field(integer,integer,text) to authenticated;
-- Interpolate by traveled route distance. Old saves and armies with no stored
-- route retain the original straight-line interpolation until their next march.
create or replace function public.peris_army_position(p_army public.armies,p_at timestamptz default public.peris_game_now())returns jsonb
language plpgsql stable security definer set search_path='' as $$
declare t numeric;remaining numeric;point jsonb;previous jsonb;x numeric;y numeric;px numeric;py numeric;dx numeric;dy numeric;segment numeric;
begin
 if p_army.status<>'moving' then return jsonb_build_object('x',p_army.target_x,'y',p_army.target_y);end if;
 t:=greatest(0,least(1,extract(epoch from(p_at-p_army.departure_at))/greatest(0.001,extract(epoch from(p_army.arrival_at-p_army.departure_at)))));
 if p_army.march_path is null or jsonb_typeof(p_army.march_path)<>'array' or jsonb_array_length(p_army.march_path)<2 or coalesce(p_army.march_distance,0)<=0 then
  if p_army.march_map_version=4 then return jsonb_build_object('x',public.peris_wrap_world(p_army.start_x+public.peris_wrapped_delta(p_army.start_x,p_army.target_x)*t),'y',public.peris_wrap_world(p_army.start_y+public.peris_wrapped_delta(p_army.start_y,p_army.target_y)*t));end if;
  return jsonb_build_object('x',p_army.start_x+(p_army.target_x-p_army.start_x)*t,'y',p_army.start_y+(p_army.target_y-p_army.start_y)*t);
 end if;
 remaining:=p_army.march_distance*t;previous:=p_army.march_path->0;
 px:=(previous->>0)::numeric;py:=(previous->>1)::numeric;
 for point in select value from jsonb_array_elements(p_army.march_path)with ordinality as points(value,ordinal)where ordinal>1 order by ordinal loop
  x:=(point->>0)::numeric;y:=(point->>1)::numeric;
  dx:=case when p_army.march_map_version=4 then public.peris_wrapped_delta(px,x) else x-px end;
  dy:=case when p_army.march_map_version=4 then public.peris_wrapped_delta(py,y) else y-py end;
  segment:=sqrt(power(dx,2)+power(dy,2));
  if segment>0 and remaining<=segment then
   if p_army.march_map_version=4 then return jsonb_build_object('x',public.peris_wrap_world(px+dx*remaining/segment),'y',public.peris_wrap_world(py+dy*remaining/segment));end if;
   return jsonb_build_object('x',px+dx*remaining/segment,'y',py+dy*remaining/segment);
  end if;
  remaining:=remaining-segment;px:=x;py:=y;
 end loop;
 return jsonb_build_object('x',p_army.target_x,'y',p_army.target_y);
end $$;
-- Optional, unique mage tower and the twenty-spell research catalog.
-- Existing population-era worlds already contain housing. Keep it valid at
-- every migration step, before the population module reapplies this constraint.
alter table public.peris_city_slots drop constraint if exists peris_city_slots_building_type_check;
alter table public.peris_city_slots add constraint peris_city_slots_building_type_check check(building_type in ('barracks','stables','workshop','smithy','warehouse','granary','fishery','mage_tower','housing','academy'));
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
 spell_id text not null references public.peris_spell_catalog(id),researched_at timestamptz not null default public.peris_game_now(),primary key(settlement_id,spell_id)
);
alter table public.peris_spell_catalog enable row level security;
alter table public.peris_spell_research enable row level security;
drop policy if exists "spell catalog" on public.peris_spell_catalog;
create policy "spell catalog" on public.peris_spell_catalog for select to authenticated using(true);
drop policy if exists "own researched spells" on public.peris_spell_research;
create policy "own researched spells" on public.peris_spell_research for select to authenticated using(exists(select 1 from public.settlements s where s.id=settlement_id and s.owner_id=public.peris_player_id()));
revoke all on public.peris_spell_catalog,public.peris_spell_research from public,anon,authenticated;
grant select on public.peris_spell_catalog,public.peris_spell_research to authenticated;
create or replace function public.peris_research_spell(p_spell text) returns jsonb language plpgsql security definer set search_path='' as $$
declare u uuid:=public.peris_player_id();s public.settlements%rowtype;sp public.peris_spell_catalog%rowtype;l integer;
begin
 if u is null then raise exception 'Authentication required';end if;
 perform public.peris_settle(u);
 if exists(select 1 from public.battles where status='active' and (attacker_owner_id=u or defender_owner_id=u)) then raise exception 'Finish the current battle first';end if;
 select * into s from public.settlements where id=public.peris_city_id(u) for update;
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
declare u uuid:=public.peris_player_id();b public.battles%rowtype;s public.settlements%rowtype;sp public.peris_spell_catalog%rowtype;f public.battle_formations%rowtype;t public.battle_formations%rowtype;
 own_side text;friend boolean;single_target boolean;l integer;mana integer;ready numeric;idx integer:=0;cas integer;troops integer;mor numeric;alive_a boolean;alive_d boolean;hero_bonus jsonb;
begin
 select * into b from public.battles where id=p_battle_id for update;
 if u is null or b.id is null or (u is distinct from b.attacker_owner_id and u is distinct from b.defender_owner_id) then raise exception 'Not your battle';end if;
 if b.status<>'active' or b.phase<>'combat' then raise exception 'Spells can only be cast during combat';end if;
 select * into sp from public.peris_spell_catalog where id=p_spell;
 select city.* into s from public.settlements city join public.peris_spell_research research on research.settlement_id=city.id join public.peris_city_slots tower on tower.settlement_id=city.id and tower.building_type='mage_tower'and tower.level>=sp.level where city.owner_id=u and research.spell_id=sp.id order by city.id limit 1;
 hero_bonus:=public.peris_hero_bonuses(case when b.attacker_owner_id=u then b.attacker_army_id else b.defender_army_id end);
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
 cas:=ceil(greatest(0,sp.damage-case when sp.chain>0 then idx*6 else 0 end)*(hero_bonus->>'spell')::numeric*(1-f.magic_defence));idx:=idx+1;
 troops:=greatest(0,least(f.initial_soldiers,f.soldiers-cas+ceil(sp.heal*(hero_bonus->>'spell')::numeric)::integer));
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
-- Catch up completed legacy construction and income before introducing consumption.
do $$declare city record;begin
 if to_regprocedure('public.peris_settle(uuid,timestamptz)')is not null and not exists(select 1 from information_schema.columns where table_schema='public' and table_name='settlements' and column_name='population')then
  for city in select owner_id from public.settlements loop perform public.peris_settle(city.owner_id,public.peris_game_now());end loop;
 end if;
end $$;
-- Civilian population, housing and production-worker economy.
-- External fields keep their terrain-adjusted income independently of city staffing.
alter table public.settlements add column if not exists population numeric(18,6) not null default 30 check(population between 10 and 2500);
alter table public.settlements add column if not exists population_capacity integer not null default 40;
alter table public.settlements add column if not exists workers_required integer not null default 0;
alter table public.settlements add column if not exists wood_bonus numeric not null default 0;
alter table public.settlements add column if not exists stone_bonus numeric not null default 0;
alter table public.settlements add column if not exists food_bonus numeric not null default 0;
alter table public.settlements add column if not exists gold_bonus numeric not null default 0;
alter table public.settlements add column if not exists food_gross_rate numeric not null default 18;
alter table public.settlements add column if not exists food_upkeep numeric not null default 3.6;
alter table public.settlements add column if not exists population_ready boolean not null default false;
alter table public.settlements add column if not exists field_wood_rate numeric not null default 0;
alter table public.settlements add column if not exists field_stone_rate numeric not null default 0;
alter table public.settlements add column if not exists field_food_rate numeric not null default 0;
alter table public.settlements add column if not exists field_gold_rate numeric not null default 0;
alter table public.settlements alter column wood_rate type numeric(18,8);
alter table public.settlements alter column stone_rate type numeric(18,8);
alter table public.settlements alter column food_rate type numeric(18,8);
alter table public.settlements alter column gold_rate type numeric(18,8);
alter table public.peris_city_slots drop constraint if exists peris_city_slots_building_type_check;
alter table public.peris_city_slots add constraint peris_city_slots_building_type_check check(building_type in ('barracks','stables','workshop','smithy','warehouse','granary','fishery','mage_tower','housing','academy'));
create or replace function public.peris_population_event(p_value double precision,p_rate double precision,p_slope double precision,p_target double precision,p_limit double precision)returns double precision language plpgsql immutable set search_path='' as $$
declare disc double precision;t double precision;result double precision:=p_limit;
begin
 if abs(p_slope)<1e-9 then if abs(p_rate)>1e-9 then t:=(p_target-p_value)/p_rate;if t>1e-9 then result:=least(result,t);end if;end if;
 else disc:=p_rate*p_rate-2*p_slope*(p_value-p_target);if disc>=0 then
  t:=(-p_rate-sqrt(disc))/p_slope;if t>1e-9 then result:=least(result,t);end if;
  t:=(-p_rate+sqrt(disc))/p_slope;if t>1e-9 then result:=least(result,t);end if;
 end if;end if;return result;
end $$;
create or replace function public.peris_population_accrue(p_sid bigint,p_until timestamptz)returns void language plpgsql security definer set search_path='' as $$
declare s public.settlements%rowtype;remaining double precision;p double precision;cap double precision;jobs double precision;staff double precision;growth double precision;factor double precision;food_slope double precision;net double precision;gross double precision;dt double precision;zero_at double precision;food_full boolean;i integer;
begin
 select * into s from public.settlements where id=p_sid for update;if s.id is null then return;end if;
 remaining:=greatest(0,extract(epoch from(p_until-s.resources_updated_at)))/60;
 if not s.population_ready then
  update public.settlements set wood=least(capacity,greatest(0,wood+wood_rate*remaining)),stone=least(capacity,greatest(0,stone+stone_rate*remaining)),
   food=least(food_capacity,greatest(0,food+food_rate*remaining)),gold=least(capacity,greatest(0,gold+gold_rate*remaining)),resources_updated_at=greatest(resources_updated_at,p_until)where id=s.id;return;
 end if;
 p:=greatest(10,least(s.population_capacity,s.population));cap:=s.population_capacity;jobs:=s.workers_required;
 for i in 1..64 loop
  exit when remaining<=1e-9;staff:=least(1,p/greatest(1,jobs));gross:=(18+s.field_food_rate+s.food_bonus*staff)*s.food_research;net:=gross-.12*p;
  growth:=case when s.food>1e-9 or net>1e-9 then case when p<cap-1e-9 then 1 else 0 end when net< -1e-9 and p>10+1e-9 then -1 else 0 end;
  factor:=case when jobs>0 and (p<jobs-1e-9 or abs(p-jobs)<1e-9 and growth<0)then growth/jobs else 0 end;food_slope:=s.food_bonus*factor*s.food_research-.12*growth;
  dt:=remaining;if growth>0 then dt:=least(dt,cap-p);elsif growth<0 then dt:=least(dt,p-10);end if;
  if growth<>0 and ((growth>0 and p<jobs-1e-9)or(growth<0 and p>jobs+1e-9))then dt:=least(dt,abs(jobs-p));end if;
  food_full:=s.food>=s.food_capacity-1e-9 and (net>1e-9 or abs(net)<=1e-9 and food_slope>=0);
  if not food_full then dt:=public.peris_population_event(s.food::double precision,net,food_slope,0,dt);dt:=public.peris_population_event(s.food::double precision,net,food_slope,s.food_capacity,dt);end if;
  if abs(food_slope)>1e-9 then zero_at:=-net/food_slope;if zero_at>1e-9 then dt:=least(dt,zero_at);end if;end if;exit when dt<=1e-9;
  s.wood:=least(s.capacity,greatest(0,s.wood+((14+s.field_wood_rate+s.wood_bonus*staff)*dt+s.wood_bonus*factor*dt*dt/2)*s.wood_research));
  s.stone:=least(s.capacity,greatest(0,s.stone+((12+s.field_stone_rate+s.stone_bonus*staff)*dt+s.stone_bonus*factor*dt*dt/2)*s.stone_research));
  s.gold:=least(s.capacity,greatest(0,s.gold+((3+s.field_gold_rate*s.trade_research+s.gold_bonus*staff)*dt+s.gold_bonus*factor*dt*dt/2)*s.gold_research));
  s.food:=greatest(0,least(s.food_capacity,case when food_full then s.food_capacity else s.food+net*dt+food_slope*dt*dt/2 end));
  p:=greatest(10,least(cap,p+growth*dt));remaining:=remaining-dt;
 end loop;
 staff:=least(1,p/greatest(1,jobs));gross:=(18+s.field_food_rate+s.food_bonus*staff)*s.food_research;
 update public.settlements set population=p,wood=s.wood,stone=s.stone,food=s.food,gold=s.gold,
  wood_rate=(14+s.field_wood_rate+s.wood_bonus*staff)*s.wood_research,stone_rate=(12+s.field_stone_rate+s.stone_bonus*staff)*s.stone_research,gold_rate=(3+s.field_gold_rate*s.trade_research+s.gold_bonus*staff)*s.gold_research,food_rate=gross-.12*p,food_gross_rate=gross,food_upkeep=.12*p,
  resources_updated_at=greatest(resources_updated_at,p_until)where id=s.id;
end $$;
create or replace function public.peris_city_economy(p_sid bigint)returns void language plpgsql security definer set search_path='' as $$
declare main integer;lumber integer;quarry integer;farm integer;fish integer;homes integer;s public.settlements%rowtype;staff numeric;fw numeric:=0;fs numeric:=0;ff numeric:=0;fg numeric:=0;
begin
 select * into s from public.settlements where id=p_sid for update;if s.id is null then return;end if;
 if not s.population_ready then perform public.peris_population_accrue(p_sid,public.peris_game_now());select * into s from public.settlements where id=p_sid;end if;
 select coalesce(max(level)filter(where building_type='market'),0),coalesce(max(level)filter(where building_type='lumber'),0),coalesce(max(level)filter(where building_type='quarry'),0),coalesce(max(level)filter(where building_type='farm'),0) into main,lumber,quarry,farm from public.buildings where settlement_id=p_sid;
 select coalesce(sum(level)filter(where building_type='fishery'),0),coalesce(sum(level)filter(where building_type='housing'),0) into fish,homes from public.peris_city_slots where settlement_id=p_sid;
 s.population_capacity:=40+10*main+30*homes;s.population:=greatest(10,least(s.population_capacity,s.population));s.workers_required:=4*main+6*lumber+6*quarry+5*farm+4*fish;
 if to_regprocedure('public.peris_field_rates(bigint)')is not null then execute 'select wood,stone,food,gold from public.peris_field_rates($1)' into fw,fs,ff,fg using p_sid;end if;
 s.wood_research:=public.peris_research_factor(s.owner_id,'wood');s.stone_research:=public.peris_research_factor(s.owner_id,'stone');s.food_research:=public.peris_research_factor(s.owner_id,'food');s.gold_research:=public.peris_research_factor(s.owner_id,'gold');s.trade_research:=public.peris_research_factor(s.owner_id,'trade');
 staff:=least(1,s.population/greatest(1,s.workers_required));
 update public.settlements set population=s.population,population_capacity=s.population_capacity,workers_required=s.workers_required,population_ready=true,
  wood_research=s.wood_research,stone_research=s.stone_research,food_research=s.food_research,gold_research=s.gold_research,trade_research=s.trade_research,
  field_wood_rate=fw,field_stone_rate=fs,field_food_rate=ff,field_gold_rate=fg,
  wood_bonus=8*lumber,stone_bonus=7*quarry,food_bonus=10*farm+8*fish,gold_bonus=3*main,
  wood_rate=(14+fw+8*lumber*staff)*s.wood_research,stone_rate=(12+fs+7*quarry*staff)*s.stone_research,food_gross_rate=(18+ff+(10*farm+8*fish)*staff)*s.food_research,food_upkeep=.12*s.population,food_rate=(18+ff+(10*farm+8*fish)*staff)*s.food_research-.12*s.population,gold_rate=(3+fg*s.trade_research+3*main*staff)*s.gold_research,
  capacity=floor((5000+2500*coalesce((select sum(level) from public.peris_city_slots where settlement_id=p_sid and building_type='warehouse'),0))*public.peris_research_factor(s.owner_id,'storage')),
  food_capacity=floor((5000+2500*coalesce((select sum(level) from public.peris_city_slots where settlement_id=p_sid and building_type='granary'),0))*public.peris_research_factor(s.owner_id,'storage'))where id=p_sid;
end $$;
-- Settle legacy income before initializing population; repeated upgrades preserve it.
do $$declare city record;begin for city in select id from public.settlements loop perform public.peris_city_migrate(city.id);perform public.peris_city_economy(city.id);end loop;end $$;
revoke all on function public.peris_population_event(double precision,double precision,double precision,double precision,double precision),public.peris_population_accrue(bigint,timestamptz),public.peris_city_economy(bigint) from public,anon,authenticated;
-- Versioned rules are private. Historical battles retain their captured values.
create table if not exists public.peris_unit_catalog (
 unit text primary key, building text not null, combat_class text not null,
 cost jsonb not null, train_seconds integer not null, research_seconds integer not null,
 research_cost jsonb not null, attack numeric not null, defence numeric not null, speed integer not null, carry integer not null
);
create table if not exists public.peris_unit_balance (
 version integer not null check(version in(1,2)),unit text not null,rule jsonb not null,
 primary key(version,unit)
);
create table if not exists public.peris_unit_profiles (
 faction text not null,combat_class text not null,attack numeric not null check(attack between .94 and 1.06),
 defence numeric not null check(defence between .94 and 1.06),primary key(faction,combat_class)
);
alter table public.peris_unit_catalog enable row level security;
alter table public.peris_unit_balance enable row level security;
alter table public.peris_unit_profiles enable row level security;
revoke all on public.peris_unit_catalog,public.peris_unit_balance,public.peris_unit_profiles from public,anon,authenticated;
alter table public.battles add column if not exists balance_version integer not null default 1 check(balance_version in(1,2));
alter table public.battles alter column balance_version set default 2;
alter table public.battles add column if not exists attacker_faction text;

create or replace function public.peris_unit_stats(p_unit text,p_faction text,p_version integer)returns jsonb
language plpgsql stable security definer set search_path='' as $$
declare r jsonb;p public.peris_unit_profiles%rowtype;
begin
 if p_version is null or p_version not in(1,2)then raise exception 'Unknown unit balance version';end if;
 select rule into r from public.peris_unit_balance where version=p_version and unit=p_unit;
 if r is null then raise exception 'Unknown unit role';end if;
 select * into p from public.peris_unit_profiles where faction=p_faction and combat_class=r->>'combatClass';
 if p.faction is null then raise exception 'Unknown unit faction';end if;
 return r||jsonb_build_object('attack',(r->>'attack')::numeric*case when p_version=2 then p.attack else 1 end,
 'defence',(r->>'defence')::numeric*case when p_version=2 then p.defence else 1 end);
end $$;
revoke all on function public.peris_unit_stats(text,text,integer)from public,anon,authenticated;
-- Generated by scripts/build-unit-balance.mjs; edit unitBalance.json.
insert into public.peris_unit_balance values
(1,'infantry','{"role":"line_infantry","building":"barracks","combatClass":"infantry","cost":{"wood":4,"stone":2,"food":6,"gold":1},"carry":20,"speed":40,"trainSeconds":2,"attack":1,"defence":1,"researchSeconds":0,"researchCost":{"wood":0,"stone":0,"food":0,"gold":0}}'::jsonb),
(1,'spearmen','{"role":"spear_guard","building":"barracks","combatClass":"infantry","cost":{"wood":5,"stone":3,"food":7,"gold":1},"carry":15,"speed":36,"trainSeconds":3,"attack":0.9,"defence":1.2,"researchSeconds":30,"researchCost":{"wood":40,"stone":30,"food":50,"gold":10}}'::jsonb),
(1,'archers','{"role":"archer","building":"barracks","combatClass":"archers","cost":{"wood":6,"stone":2,"food":5,"gold":2},"carry":15,"speed":34,"trainSeconds":2,"attack":1,"defence":1,"researchSeconds":0,"researchCost":{"wood":0,"stone":0,"food":0,"gold":0}}'::jsonb),
(1,'elite','{"role":"elite","building":"barracks","combatClass":"infantry","cost":{"wood":8,"stone":6,"food":12,"gold":3},"carry":15,"speed":38,"trainSeconds":4,"attack":1.4,"defence":1.35,"researchSeconds":60,"researchCost":{"wood":100,"stone":80,"food":120,"gold":30}}'::jsonb),
(1,'cavalry','{"role":"light_cavalry","building":"stables","combatClass":"cavalry","cost":{"wood":4,"stone":7,"food":12,"gold":4},"carry":40,"speed":76,"trainSeconds":5,"attack":1,"defence":1,"researchSeconds":0,"researchCost":{"wood":0,"stone":0,"food":0,"gold":0}}'::jsonb),
(1,'scout','{"role":"scout","building":"stables","combatClass":"cavalry","cost":{"wood":3,"stone":5,"food":9,"gold":3},"carry":10,"speed":92,"trainSeconds":4,"attack":0.45,"defence":0.75,"researchSeconds":30,"researchCost":{"wood":40,"stone":20,"food":50,"gold":10}}'::jsonb),
(1,'heavyCavalry','{"role":"heavy_cavalry","building":"stables","combatClass":"cavalry","cost":{"wood":8,"stone":12,"food":20,"gold":7},"carry":35,"speed":60,"trainSeconds":8,"attack":1.45,"defence":1.35,"researchSeconds":60,"researchCost":{"wood":100,"stone":120,"food":150,"gold":40}}'::jsonb),
(1,'ram','{"role":"ram","building":"workshop","combatClass":"infantry","cost":{"wood":20,"stone":15,"food":15,"gold":6},"carry":0,"speed":16,"trainSeconds":12,"attack":0.6,"defence":2,"researchSeconds":90,"researchCost":{"wood":180,"stone":120,"food":80,"gold":35}}'::jsonb),
(1,'catapult','{"role":"catapult","building":"workshop","combatClass":"archers","cost":{"wood":30,"stone":20,"food":18,"gold":10},"carry":0,"speed":12,"trainSeconds":18,"attack":2.4,"defence":0.7,"researchSeconds":120,"researchCost":{"wood":220,"stone":180,"food":100,"gold":60}}'::jsonb),
(2,'infantry','{"role":"line_infantry","building":"barracks","combatClass":"infantry","cost":{"wood":4,"stone":2,"food":6,"gold":1},"carry":20,"speed":40,"trainSeconds":2,"attack":1,"defence":1,"researchSeconds":0,"researchCost":{"wood":0,"stone":0,"food":0,"gold":0}}'::jsonb),
(2,'spearmen','{"role":"spear_guard","building":"barracks","combatClass":"infantry","cost":{"wood":5,"stone":3,"food":7,"gold":1},"carry":15,"speed":36,"trainSeconds":3,"attack":0.9,"defence":1.3,"researchSeconds":30,"researchCost":{"wood":40,"stone":30,"food":50,"gold":10}}'::jsonb),
(2,'archers','{"role":"archer","building":"barracks","combatClass":"archers","cost":{"wood":6,"stone":2,"food":5,"gold":1},"carry":15,"speed":34,"trainSeconds":3,"attack":1.25,"defence":0.9,"researchSeconds":0,"researchCost":{"wood":0,"stone":0,"food":0,"gold":0}}'::jsonb),
(2,'elite','{"role":"elite","building":"barracks","combatClass":"infantry","cost":{"wood":7,"stone":5,"food":10,"gold":1},"carry":15,"speed":38,"trainSeconds":4,"attack":1.6,"defence":1.6,"researchSeconds":60,"researchCost":{"wood":100,"stone":80,"food":120,"gold":30}}'::jsonb),
(2,'cavalry','{"role":"light_cavalry","building":"stables","combatClass":"cavalry","cost":{"wood":5,"stone":6,"food":10,"gold":3},"carry":40,"speed":76,"trainSeconds":5,"attack":1,"defence":1,"researchSeconds":0,"researchCost":{"wood":0,"stone":0,"food":0,"gold":0}}'::jsonb),
(2,'scout','{"role":"scout","building":"stables","combatClass":"cavalry","cost":{"wood":3,"stone":2,"food":4,"gold":1},"carry":10,"speed":92,"trainSeconds":2,"attack":0.45,"defence":0.75,"researchSeconds":30,"researchCost":{"wood":40,"stone":20,"food":50,"gold":10}}'::jsonb),
(2,'heavyCavalry','{"role":"heavy_cavalry","building":"stables","combatClass":"cavalry","cost":{"wood":8,"stone":10,"food":16,"gold":4},"carry":35,"speed":60,"trainSeconds":8,"attack":1.45,"defence":1.4,"researchSeconds":60,"researchCost":{"wood":100,"stone":120,"food":150,"gold":40}}'::jsonb),
(2,'ram','{"role":"ram","building":"workshop","combatClass":"infantry","cost":{"wood":18,"stone":12,"food":12,"gold":4},"carry":0,"speed":16,"trainSeconds":12,"attack":0.6,"defence":2,"researchSeconds":90,"researchCost":{"wood":180,"stone":120,"food":80,"gold":35}}'::jsonb),
(2,'catapult','{"role":"catapult","building":"workshop","combatClass":"archers","cost":{"wood":25,"stone":18,"food":14,"gold":6},"carry":0,"speed":12,"trainSeconds":18,"attack":2.4,"defence":0.7,"researchSeconds":120,"researchCost":{"wood":220,"stone":180,"food":100,"gold":60}}'::jsonb)
on conflict(version,unit)do update set rule=excluded.rule;
insert into public.peris_unit_profiles values
('roman','infantry',1,1),
('roman','archers',1,1),
('roman','cavalry',1,1),
('spartan','infantry',1,1.015),
('spartan','archers',0.98,0.98),
('spartan','cavalry',0.98,0.98),
('persian','infantry',0.98,0.98),
('persian','archers',1.04,1),
('persian','cavalry',1.04,1),
('egyptian','infantry',1,1.02),
('egyptian','archers',1,1.02),
('egyptian','cavalry',0.96,0.96),
('orc','infantry',1.02,0.99),
('orc','archers',0.965,0.965),
('orc','cavalry',1.03,0.99),
('elf','infantry',0.99,0.99),
('elf','archers',1.06,1.02),
('elf','cavalry',0.99,0.99),
('dwarf','infantry',0.99,1.05),
('dwarf','archers',0.99,0.99),
('dwarf','cavalry',0.965,0.965),
('gnome','infantry',1,0.99),
('gnome','archers',1.05,1.02),
('gnome','cavalry',1,0.99),
('pandaren','infantry',1,1.01),
('pandaren','archers',0.99,0.99),
('pandaren','cavalry',0.99,0.99),
('undead','infantry',0.98,1.012),
('undead','archers',0.97,0.97),
('undead','cavalry',1.015,1.01),
('demon','infantry',1.04,0.97),
('demon','archers',1.06,0.99),
('demon','cavalry',1,0.95)
on conflict(faction,combat_class)do update set attack=excluded.attack,defence=excluded.defence;
insert into public.peris_unit_catalog values
('infantry','barracks','infantry','{"wood":4,"stone":2,"food":6,"gold":1}'::jsonb,2,0,'{"wood":0,"stone":0,"food":0,"gold":0}'::jsonb,1,1,40,20),
('spearmen','barracks','infantry','{"wood":5,"stone":3,"food":7,"gold":1}'::jsonb,3,30,'{"wood":40,"stone":30,"food":50,"gold":10}'::jsonb,0.9,1.3,36,15),
('archers','barracks','archers','{"wood":6,"stone":2,"food":5,"gold":1}'::jsonb,3,0,'{"wood":0,"stone":0,"food":0,"gold":0}'::jsonb,1.25,0.9,34,15),
('elite','barracks','infantry','{"wood":7,"stone":5,"food":10,"gold":1}'::jsonb,4,60,'{"wood":100,"stone":80,"food":120,"gold":30}'::jsonb,1.6,1.6,38,15),
('cavalry','stables','cavalry','{"wood":5,"stone":6,"food":10,"gold":3}'::jsonb,5,0,'{"wood":0,"stone":0,"food":0,"gold":0}'::jsonb,1,1,76,40),
('scout','stables','cavalry','{"wood":3,"stone":2,"food":4,"gold":1}'::jsonb,2,30,'{"wood":40,"stone":20,"food":50,"gold":10}'::jsonb,0.45,0.75,92,10),
('heavyCavalry','stables','cavalry','{"wood":8,"stone":10,"food":16,"gold":4}'::jsonb,8,60,'{"wood":100,"stone":120,"food":150,"gold":40}'::jsonb,1.45,1.4,60,35),
('ram','workshop','infantry','{"wood":18,"stone":12,"food":12,"gold":4}'::jsonb,12,90,'{"wood":180,"stone":120,"food":80,"gold":35}'::jsonb,0.6,2,16,0),
('catapult','workshop','archers','{"wood":25,"stone":18,"food":14,"gold":6}'::jsonb,18,120,'{"wood":220,"stone":180,"food":100,"gold":60}'::jsonb,2.4,0.7,12,0)
on conflict(unit)do update set building=excluded.building,combat_class=excluded.combat_class,cost=excluded.cost,train_seconds=excluded.train_seconds,research_seconds=excluded.research_seconds,research_cost=excluded.research_cost,attack=excluded.attack,defence=excluded.defence,speed=excluded.speed,carry=excluded.carry;
-- Canonical nine-role inventories in the existing realm. Legacy class totals remain compatible.
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
-- City raids retain the same march, formation and report systems.
alter table public.armies add column if not exists raid_city_id bigint references public.settlements(id)on delete set null;
alter table public.armies add column if not exists siege_target text not null default 'auto';
alter table public.battles add column if not exists raid_city_id bigint references public.settlements(id)on delete set null;
alter table public.battles add column if not exists siege_target text not null default 'auto';
alter table public.battles add column if not exists city_defenders jsonb not null default '[]'::jsonb;
-- Unsent soldiers remain at their ruler's village or owned field.
-- Multiple legions share a location pool; metadata and troops remain private.
alter table public.armies add column if not exists march_origin jsonb;
alter table public.armies add column if not exists march_returning boolean not null default false;
create table if not exists public.peris_garrisons (
 owner_id uuid not null references public.players(id) on delete cascade,
 col integer not null check(col between -100 and 99), row integer not null check(row between -100 and 99),
 unit_roster jsonb,
 infantry integer not null default 0 check(infantry>=0),
 archers integer not null default 0 check(archers>=0),
 cavalry integer not null default 0 check(cavalry>=0),
 primary key(owner_id,col,row)
);
alter table public.peris_garrisons add column if not exists unit_roster jsonb;
alter table public.peris_garrisons enable row level security;
revoke all on public.peris_garrisons from public,anon,authenticated;
grant select on public.peris_garrisons to authenticated;
drop policy if exists "own garrisons" on public.peris_garrisons;
create policy "own garrisons" on public.peris_garrisons for select to authenticated using(owner_id=public.peris_player_id());

-- New legions keep the familiar offset without crossing their village's field edge.
-- Existing saved coordinates are never relocated by this helper.
create or replace function public.peris_home_army_position(p_x integer,p_y integer)
returns jsonb language sql immutable set search_path='' as $$
 select jsonb_build_object(
  'x',least(public.peris_wrap_world(p_x)+40,floor(public.peris_wrap_world(p_x)/128)*128+127)::integer,
  'y',least(public.peris_wrap_world(p_y)+30,floor(public.peris_wrap_world(p_y)/128)*128+127)::integer)
$$;

create or replace function public.peris_station_owned(p_owner uuid,p_col integer,p_row integer)
returns boolean language sql stable security definer set search_path='' as $$
 select exists(select 1 from public.settlements s where s.owner_id=p_owner and s.ruined_at is null
  and public.peris_wrap_cell(floor(s.x/128.0)::integer)=public.peris_wrap_cell(p_col)
  and public.peris_wrap_cell(floor(s.y/128.0)::integer)=public.peris_wrap_cell(p_row))
 or exists(select 1 from public.peris_map_plots p where p.owner_id=p_owner and p.col=public.peris_wrap_cell(p_col) and p.row=public.peris_wrap_cell(p_row))
$$;

create or replace function public.peris_garrison_troops(p_troops jsonb)returns jsonb language plpgsql immutable set search_path='' as $$
declare result jsonb:=public.peris_roster(p_troops);
begin if public.peris_roster_total(result)>1000 then raise exception 'Stay within the 1000 soldier legion capacity';end if;return result;end $$;
create or replace function public.peris_garrison_add(p_owner uuid,p_col integer,p_row integer,p_troops jsonb)returns void language plpgsql security definer set search_path='' as $$
declare troops jsonb:=public.peris_garrison_troops(p_troops);v_col integer:=public.peris_wrap_cell(p_col);v_row integer:=public.peris_wrap_cell(p_row);g public.peris_garrisons%rowtype;
begin
 if not public.peris_station_owned(p_owner,v_col,v_row)then raise exception 'Troops can only station in your own villages and fields';end if;
 if public.peris_roster_total(troops)=0 then return;end if;
 select * into g from public.peris_garrisons where owner_id=p_owner and col=v_col and row=v_row for update;
 if g.owner_id is not null then troops:=public.peris_roster_add(public.peris_roster(to_jsonb(g)),troops);end if;
 insert into public.peris_garrisons(owner_id,col,row,unit_roster,infantry,archers,cavalry)values(p_owner,v_col,v_row,troops,public.peris_roster_class(troops,'infantry'),public.peris_roster_class(troops,'archers'),public.peris_roster_class(troops,'cavalry'))
 on conflict(owner_id,col,row)do update set unit_roster=excluded.unit_roster,infantry=excluded.infantry,archers=excluded.archers,cavalry=excluded.cavalry;
end $$;
create or replace function public.peris_garrison_collect_for(p_owner uuid,p_army bigint,p_troops jsonb default null)returns jsonb language plpgsql security definer set search_path='' as $$
declare a public.armies%rowtype;g public.peris_garrisons%rowtype;v_col integer;v_row integer;capacity integer;available jsonb;preset jsonb:='{}';unit_name text;amount integer;
begin
 select * into a from public.armies where id=p_army and owner_id=p_owner for update;
 if a.id is null then raise exception 'Choose one of your armies';end if;
 if a.status<>'idle' or a.raid_target_id is not null or a.raid_city_id is not null or exists(select 1 from public.battles b where b.status='active'and(b.attacker_army_id=a.id or b.defender_army_id=a.id))then raise exception 'Bring an idle legion to this station before collecting troops';end if;
 if exists(select 1 from public.peris_orders o where o.owner_id=p_owner and o.kind='recruit'and coalesce(o.army_id,(select min(id)from public.armies where owner_id=p_owner))=a.id)then raise exception 'Finish training before collecting stationed troops';end if;
 v_col:=public.peris_wrap_cell(floor(a.target_x/128.0)::integer);v_row:=public.peris_wrap_cell(floor(a.target_y/128.0)::integer);
 if not public.peris_station_owned(p_owner,v_col,v_row)then raise exception 'Troops can only station in your own villages and fields';end if;
 select * into g from public.peris_garrisons where owner_id=p_owner and col=v_col and row=v_row for update;
 if g.owner_id is null then
  if p_troops is not null and public.peris_roster_total(p_troops)>0 then raise exception 'No stationed troops are available here';end if;
  return public.peris_roster('{}');
 end if;
 available:=public.peris_roster(to_jsonb(g));capacity:=greatest(0,1000-a.infantry-a.archers-a.cavalry);
 if p_troops is not null then preset:=public.peris_garrison_troops(p_troops);if public.peris_roster_total(preset)>capacity then raise exception 'Choose available stationed troops within the legion capacity';end if;end if;
 foreach unit_name in array array['infantry','spearmen','archers','elite','cavalry','scout','heavyCavalry','ram','catapult']loop
  amount:=case when p_troops is null then least(capacity,(available->>unit_name)::integer)else(preset->>unit_name)::integer end;
  if amount>(available->>unit_name)::integer then raise exception 'Choose available stationed troops within the legion capacity';end if;
  preset:=preset||jsonb_build_object(unit_name,amount);capacity:=capacity-amount;
 end loop;
 perform public.peris_write_roster(a.id,public.peris_roster_add(public.peris_roster(to_jsonb(a)),preset));
 available:=public.peris_roster_add(available,preset,-1);
 update public.peris_garrisons set unit_roster=available,infantry=public.peris_roster_class(available,'infantry'),archers=public.peris_roster_class(available,'archers'),cavalry=public.peris_roster_class(available,'cavalry')where owner_id=p_owner and col=v_col and row=v_row;
 delete from public.peris_garrisons where owner_id=p_owner and col=v_col and row=v_row and infantry=0 and archers=0 and cavalry=0;
 return preset;
end $$;

create or replace function public.peris_collect_garrison(p_army bigint,p_troops jsonb default null)
returns jsonb language plpgsql security definer set search_path='' as $$
declare u uuid:=public.peris_player_id();
begin
 if u is null then raise exception 'Authentication required';end if;
 if exists(select 1 from public.battles where status='active'and(attacker_owner_id=u or defender_owner_id=u))then raise exception 'Finish the current battle first';end if;
 return public.peris_garrison_collect_for(u,p_army,p_troops);
end $$;

create or replace function public.peris_garrison_merge(p_army bigint)
returns void language plpgsql security definer set search_path='' as $$
declare a public.armies%rowtype;
begin
 select * into a from public.armies where id=p_army for update;
 if a.id is null or a.status<>'idle' or a.raid_target_id is not null or a.raid_city_id is not null then return;end if;
 if not public.peris_station_owned(a.owner_id,floor(a.target_x/128.0)::integer,floor(a.target_y/128.0)::integer)then return;end if;
 if exists(select 1 from public.battles b where b.status='active' and (b.attacker_army_id=a.id or b.defender_army_id=a.id))then return;end if;
 perform public.peris_garrison_collect_for(a.owner_id,a.id);
end $$;
-- New orders wait thirty wall-clock seconds before leaving. Existing routes and saves retain their timing.
alter table public.armies add column if not exists march_sent_at timestamptz;
alter table public.armies add column if not exists march_cancel_until timestamptz;
alter table public.armies add column if not exists raid_reserve jsonb;

create or replace function public.peris_restore_raid_reserve(p_army bigint)returns void
language plpgsql security definer set search_path='' as $$
declare a public.armies%rowtype;
begin select * into a from public.armies where id=p_army for update;
 if a.raid_reserve is not null then perform public.peris_write_roster(a.id,public.peris_roster_add(public.peris_roster(to_jsonb(a)),a.raid_reserve));update public.armies set raid_reserve=null where id=a.id;end if;
end $$;

create or replace function public.peris_cancel_march(p_army bigint,p_sent_at timestamptz)returns jsonb
language plpgsql security definer set search_path='' as $$
declare u uuid:=public.peris_player_id();a public.armies%rowtype;
begin
 if u is null then raise exception 'Authentication required';end if;
 perform public.peris_settle(u);
 select * into a from public.armies where id=p_army and owner_id=u for update;
 if a.id is null then raise exception 'Choose one of your armies';end if;
 if p_sent_at is null or a.march_sent_at is distinct from p_sent_at then raise exception 'This march is no longer the same order';end if;
 if a.status<>'moving' or a.march_cancel_until is null or public.peris_game_now()>=a.march_cancel_until or public.peris_game_now()<a.march_sent_at then
  raise exception 'Marches can only be cancelled during the first 30 seconds';
 end if;
 perform public.peris_restore_raid_reserve(a.id);
 update public.armies set status='idle',raid_target_id=null,raid_city_id=null,siege_target='auto',target_x=start_x,target_y=start_y,
  departure_at=public.peris_game_now(),arrival_at=public.peris_game_now(),march_path=null,march_distance=null,march_sent_at=null,march_cancel_until=null,march_origin=null,march_returning=false,updated_at=now()
  where id=a.id;
 perform public.peris_garrison_merge(a.id);
 return jsonb_build_object('ok',true);
end $$;

create or replace function public.peris_prepare_raid_for(p_owner uuid,p_army bigint,p_camp integer,p_path jsonb default null,p_troops jsonb default null)returns jsonb
language plpgsql security definer set search_path='' as $$
declare u uuid:=p_owner;a public.armies%rowtype;c public.peris_camps%rowtype;inf integer;arc integer;cav integer;route jsonb;steps integer;i integer;available jsonb;preset jsonb;unit_name text;
begin
 if u is null then raise exception 'Authentication required';end if;
 perform public.peris_settle(u);
 select * into a from public.armies where id=p_army and owner_id=u for update;
 select * into c from public.peris_camps where id=p_camp;
 if c.id is null then raise exception 'Camp not found';end if;
 if a.id is null or a.infantry+a.archers+a.cavalry=0 then raise exception 'Recruit soldiers before starting a raid';end if;
 if a.status<>'idle' or a.raid_target_id is not null or a.raid_city_id is not null or a.raid_reserve is not null then raise exception 'This legion already has a march or raid';end if;
 if not c.bandit and exists(select 1 from public.peris_progress where owner_id=u and camp_id=p_camp and available_at>public.peris_game_now())then raise exception 'The camp is still regrouping';end if;
 if p_troops is not null then
  if jsonb_typeof(p_troops)<>'object' then raise exception 'Choose troops currently available in this legion';end if;
  available:=public.peris_roster(to_jsonb(a));preset:=public.peris_garrison_troops(p_troops);
  foreach unit_name in array array['infantry','spearmen','archers','elite','cavalry','scout','heavyCavalry','ram','catapult']loop
   if (preset->>unit_name)::integer>(available->>unit_name)::integer then raise exception 'Choose troops currently available in this legion';end if;
  end loop;
  if public.peris_roster_total(preset)=0 then raise exception 'Send at least one soldier';end if;
 end if;
 route:=p_path;
 if route is null then
  steps:=greatest(1,ceil(greatest(abs(public.peris_wrapped_delta(a.target_x,c.x)),abs(public.peris_wrapped_delta(a.target_y,c.y)))/64)::integer);
  route:=jsonb_build_array(jsonb_build_array(a.target_x,a.target_y));
  for i in 1..steps loop route:=route||jsonb_build_array(jsonb_build_array(public.peris_wrap_world(round(a.target_x+public.peris_wrapped_delta(a.target_x,c.x)*i/steps)::integer),public.peris_wrap_world(round(a.target_y+public.peris_wrapped_delta(a.target_y,c.y)*i/steps)::integer)));end loop;
 end if;
 perform public.peris_march_for(u,a.id,c.x,c.y,route,c.id);
 update public.armies set raid_target_id=c.id where id=a.id;
 if p_troops is not null then
  perform public.peris_garrison_add(u,floor(a.target_x/128.0)::integer,floor(a.target_y/128.0)::integer,public.peris_roster_add(available,preset,-1));
  perform public.peris_write_roster(a.id,preset);
  -- The route was validated before selecting troops. Recompute the accepted deadline for the chosen party.
  update public.armies set arrival_at=departure_at+make_interval(secs=>greatest(2,march_distance/public.peris_march_speed(id))::double precision)where id=a.id;
 end if;
 return jsonb_build_object('ok',true);
end $$;

create or replace function public.peris_prepare_raid(p_camp integer,p_path jsonb default null,p_troops jsonb default null)returns jsonb
language plpgsql security definer set search_path='' as $$
declare u uuid:=public.peris_player_id();
begin
 if u is null then raise exception 'Authentication required';end if;
 return public.peris_prepare_raid_for(u,public.peris_army_id(u),p_camp,p_path,p_troops);
end $$;

create or replace function public.peris_return_raid(p_army bigint)returns boolean
language plpgsql security definer set search_path='' as $$
declare a public.armies%rowtype;route jsonb;seconds numeric;
begin
 select * into a from public.armies where id=p_army for update;
 if a.march_returning then return true;end if;
 if a.id is null then return false;end if;
 if a.march_origin is not null and not public.peris_station_owned(a.owner_id,floor((a.march_origin->>'x')::numeric/128.0)::integer,floor((a.march_origin->>'y')::numeric/128.0)::integer)then perform public.peris_ruin_redirect_army(a.id);return true;end if;
 if a.march_origin is null or a.march_path is null or a.march_distance is null then perform public.peris_ruin_redirect_army(a.id);return true;end if;
 select jsonb_agg(value order by ordinal desc) into route from jsonb_array_elements(a.march_path)with ordinality as points(value,ordinal);
 seconds:=greatest(2,a.march_distance/public.peris_march_speed(a.id));
 update public.armies set start_x=a.target_x,start_y=a.target_y,target_x=(a.march_origin->>'x')::integer,target_y=(a.march_origin->>'y')::integer,
  march_path=route,status='moving',raid_target_id=null,raid_city_id=null,siege_target='auto',march_returning=true,march_sent_at=null,march_cancel_until=null,
  departure_at=public.peris_game_now(),arrival_at=public.peris_game_now()+make_interval(secs=>seconds::double precision),updated_at=now() where id=a.id;
 return true;
end $$;
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
 foreach unit_name in array array['infantry','spearmen','archers','elite','cavalry','scout','heavyCavalry','ram','catapult']loop
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
-- PERIS city ruins and permanent ruler defeat. All timestamps are authoritative.
-- These columns preserve existing IDs, reports, sessions, and older saves.
alter table public.settlements add column if not exists ruined_at timestamptz;
alter table public.players add column if not exists defeated_at timestamptz;
alter table public.settlements drop constraint if exists settlements_population_check;
alter table public.settlements add constraint settlements_population_check check(population between 0 and 2500);
create index if not exists peris_living_cities_owner on public.settlements(owner_id,id) where ruined_at is null;
create table if not exists public.peris_ruin_evacuations (
 id bigint generated always as identity primary key,
 owner_id uuid not null references public.players(id) on delete cascade,
 origin_settlement_id bigint not null references public.settlements(id) on delete cascade,
 target_settlement_id bigint not null references public.settlements(id) on delete cascade,
 origin_x integer not null,origin_y integer not null,
 troops jsonb not null,departure_at timestamptz not null,arrival_at timestamptz not null
);
create index if not exists peris_ruin_evacuations_due on public.peris_ruin_evacuations(owner_id,arrival_at);
alter table public.peris_ruin_evacuations enable row level security;
revoke all on public.peris_ruin_evacuations from public,anon,authenticated;
grant select on public.peris_ruin_evacuations to authenticated;
drop policy if exists "own ruin evacuations" on public.peris_ruin_evacuations;
create policy "own ruin evacuations" on public.peris_ruin_evacuations for select to authenticated using(owner_id=public.peris_player_id());

-- BFS over the same wrapped 200 x 200 land mask and no-corner-cut diagonals.
-- Return a validated route to the first reachable surviving city. Never teleport.
create or replace function public.peris_ruin_route(p_owner uuid,p_x integer,p_y integer)returns jsonb
language plpgsql stable security definer set search_path='' as $$
declare visited integer[]:=array_fill(0,array[40000]); parents integer[]:=array_fill(0,array[40000]); queue integer[]:=array_fill(0,array[40000]);
 start_col integer:=public.peris_wrap_cell(floor(p_x/128.0)::integer);
 start_row integer:=public.peris_wrap_cell(floor(p_y/128.0)::integer);
 start_idx integer;current_idx integer;next_idx integer;goal_idx integer:=0;cx integer;cy integer;nx integer;ny integer;
 dx integer;dy integer;head integer:=1;tail integer:=1;target public.settlements%rowtype; candidate public.settlements%rowtype;
 cells integer[]:='{}';point_idx integer;tx integer;ty integer;px integer:=p_x;py integer:=p_y;
 position jsonb;route jsonb;distance numeric:=0;change_x numeric;change_y numeric;
begin
 if p_x is null or p_y is null or not public.peris_world_walkable(p_x,p_y)then return null;end if;
 start_idx:=(start_row+100)*200+start_col+101;
 queue[1]:=start_idx;visited[start_idx]:=1;
 while head<=tail loop
  current_idx:=queue[head];head:=head+1;
  cx:=mod(current_idx-1,200)-100;cy:=floor((current_idx-1)/200.0)::integer-100;
  for candidate in select * from public.settlements s where s.owner_id=p_owner and s.ruined_at is null order by id loop
   if floor(candidate.x/128.0)::integer=cx and floor(candidate.y/128.0)::integer=cy then
    target:=candidate;goal_idx:=current_idx;exit;
   end if;
  end loop;
  exit when goal_idx>0;
  for dx in -1..1 loop for dy in -1..1 loop
   if dx=0 and dy=0 then continue;end if;
   nx:=public.peris_wrap_cell(cx+dx);ny:=public.peris_wrap_cell(cy+dy);
   next_idx:=(ny+100)*200+nx+101;
   if visited[next_idx]<>0 or not public.peris_world_walkable(nx*128+64,ny*128+64)then continue;end if;
   if dx<>0 and dy<>0 and (not public.peris_world_walkable(nx*128+64,cy*128+64)
     or not public.peris_world_walkable(cx*128+64,ny*128+64))then continue;end if;
   visited[next_idx]:=1;parents[next_idx]:=current_idx;tail:=tail+1;queue[tail]:=next_idx;
  end loop;end loop;
 end loop;
 if goal_idx=0 then return null;end if;
 current_idx:=goal_idx;
 while current_idx<>start_idx loop
  cells:=array_prepend(current_idx,cells);
  current_idx:=parents[current_idx];
  if current_idx=0 then return null;end if;
 end loop;
 route:=jsonb_build_array(jsonb_build_array(p_x,p_y));
 foreach point_idx in array cells loop
  tx:=(mod(point_idx-1,200)-100)*128+64;
  ty:=(floor((point_idx-1)/200.0)::integer-100)*128+64;
  change_x:=public.peris_wrapped_delta(px,tx);change_y:=public.peris_wrapped_delta(py,ty);
  distance:=distance+sqrt(change_x*change_x+change_y*change_y);
  route:=route||jsonb_build_array(jsonb_build_array(tx,ty));px:=tx;py:=ty;
 end loop;
 position:=public.peris_home_army_position(target.x,target.y);
 tx:=(position->>'x')::integer;ty:=(position->>'y')::integer;
 if px<>tx or py<>ty then
  change_x:=public.peris_wrapped_delta(px,tx);change_y:=public.peris_wrapped_delta(py,ty);
  distance:=distance+sqrt(change_x*change_x+change_y*change_y);
  route:=route||jsonb_build_array(jsonb_build_array(tx,ty));
 end if;
 return jsonb_build_object('city_id',target.id,'path',route,'distance',distance,'x',tx,'y',ty);
end $$;

-- Each hero remains attached to their existing army. Never spawn free commanders.
create or replace function public.peris_ruin_redirect_army(p_army bigint)returns boolean
language plpgsql security definer set search_path='' as $$
declare a public.armies%rowtype;position jsonb;route jsonb;owner_defeated boolean;
begin
 select * into a from public.armies where id=p_army for update;
 if a.id is null then return false;end if;
 select defeated_at is not null into owner_defeated from public.players where id=a.owner_id;
 if owner_defeated then
  perform public.peris_write_roster(a.id,public.peris_roster('{}'));
  update public.armies set status='idle',raid_city_id=null,raid_target_id=null,raid_reserve=null,march_path=null,march_distance=null,march_origin=null,march_returning=false,march_sent_at=null,march_cancel_until=null,carried_loot=null,updated_at=now()where id=a.id;
  return false;
 end if;
 if exists(select 1 from public.battles b where b.status='active'and (b.attacker_army_id=a.id or b.defender_army_id=a.id))then return false;end if;
 position:=public.peris_army_position(a);
 route:=public.peris_ruin_route(a.owner_id,round((position->>'x')::numeric)::integer,round((position->>'y')::numeric)::integer);
 if route is null then
  perform public.peris_write_roster(a.id,public.peris_roster('{}'));
  update public.armies set status='idle',raid_city_id=null,raid_target_id=null,raid_reserve=null,march_path=null,march_distance=null,march_origin=null,march_returning=false,march_sent_at=null,march_cancel_until=null,carried_loot=null,updated_at=now()where id=a.id;
  return false;
 end if;
 update public.armies set home_settlement_id=(route->>'city_id')::bigint,
  start_x=round((position->>'x')::numeric)::integer,start_y=round((position->>'y')::numeric)::integer,
  target_x=(route->>'x')::integer,target_y=(route->>'y')::integer,march_path=route->'path',march_distance=(route->>'distance')::numeric,march_map_version=4,
  status='moving',raid_city_id=null,raid_target_id=null,raid_reserve=null,march_origin=null,march_returning=true,march_sent_at=null,march_cancel_until=null,
  departure_at=public.peris_game_now(),arrival_at=public.peris_game_now()+make_interval(secs=>greatest(2,(route->>'distance')::numeric/greatest(1,public.peris_march_speed(a.id)))::double precision),updated_at=now()where id=a.id;
 return true;
end $$;

-- Deliver GARRISON evacuees as troops, not as new armies. One field can hold
-- multiple legions, so the ordinary 1000-per-legion input limit does not apply.
create or replace function public.peris_ruin_advance(p_owner uuid,p_until timestamptz)returns void
language plpgsql security definer set search_path='' as $$
declare e public.peris_ruin_evacuations%rowtype;s public.settlements%rowtype;route jsonb;existing jsonb;troops jsonb;cx integer;cy integer;
begin
 for e in select * from public.peris_ruin_evacuations where owner_id=p_owner and arrival_at<=p_until order by arrival_at,id for update loop
  select * into s from public.settlements where id=e.target_settlement_id and owner_id=p_owner and ruined_at is null;
  if s.id is null then
   route:=public.peris_ruin_route(p_owner,e.origin_x,e.origin_y);
   if route is null then delete from public.peris_ruin_evacuations where id=e.id;continue;end if;
   update public.peris_ruin_evacuations set target_settlement_id=(route->>'city_id')::bigint,departure_at=p_until,
    arrival_at=p_until+make_interval(secs=>greatest(2,(route->>'distance')::numeric/22)::double precision) where id=e.id;
   continue;
  end if;
  cx:=floor(s.x/128.0)::integer;cy:=floor(s.y/128.0)::integer;
  select public.peris_roster(to_jsonb(g))into existing from public.peris_garrisons g where g.owner_id=p_owner and g.col=cx and g.row=cy for update;
  troops:=public.peris_roster_add(coalesce(existing,public.peris_roster('{}')),e.troops);
  insert into public.peris_garrisons(owner_id,col,row,unit_roster,infantry,archers,cavalry)
   values(p_owner,cx,cy,troops,public.peris_roster_class(troops,'infantry'),public.peris_roster_class(troops,'archers'),public.peris_roster_class(troops,'cavalry'))
   on conflict(owner_id,col,row)do update set unit_roster=excluded.unit_roster,infantry=excluded.infantry,archers=excluded.archers,cavalry=excluded.cavalry;
  delete from public.peris_ruin_evacuations where id=e.id;
 end loop;
end $$;

-- Called exclusively after successful siege damage. Never delete the settlement,
-- account, history or location; ruined_at is permanent and applied only once.
create or replace function public.peris_ruin_city(p_city bigint)returns boolean
language plpgsql security definer set search_path='' as $$
declare city public.settlements%rowtype;garrison public.peris_city_garrisons%rowtype;g public.peris_garrisons%rowtype;a public.armies%rowtype;route jsonb;
 old_fields text[];city_key text;pos jsonb;target_key text;living_count integer;
begin
 select * into city from public.settlements where id=p_city for update;
 if city.id is null or city.ruined_at is not null then return false;end if;
 if exists(select 1 from public.buildings where settlement_id=p_city and level>0)
    or exists(select 1 from public.peris_city_slots where settlement_id=p_city and level>0)then return false;end if;
 city_key:=floor(city.x/128.0)::integer||':'||floor(city.y/128.0)::integer;
 select array_append(coalesce(array_agg(col||':'||row),array[]::text[]),city_key)into old_fields from public.peris_map_plots where settlement_id=p_city;
 update public.settlements set ruined_at=now(),wood=0,stone=0,food=0,gold=0,
    wood_rate=0,stone_rate=0,food_rate=0,gold_rate=0,settlers=0,population=0 where id=p_city;
 delete from public.peris_orders where settlement_id=p_city;
 update public.peris_settler_expeditions set status='returned' where origin_settlement_id=p_city and status='travelling';
 -- Dedicated city defenders evacuate using the same no-commander transport.
 for garrison in select * from public.peris_city_garrisons where settlement_id=p_city and owner_id=city.owner_id for update loop
  route:=public.peris_ruin_route(city.owner_id,city.x,city.y);
  if route is not null and public.peris_roster_total(garrison.unit_roster)>0 then
   insert into public.peris_ruin_evacuations(owner_id,origin_settlement_id,target_settlement_id,origin_x,origin_y,troops,departure_at,arrival_at)
   values(city.owner_id,city.id,(route->>'city_id')::bigint,city.x,city.y,public.peris_roster(garrison.unit_roster),public.peris_game_now(),
     public.peris_game_now()+make_interval(secs=>greatest(2,(route->>'distance')::numeric/22)::double precision));
  end if;
  delete from public.peris_city_garrisons where settlement_id=p_city and owner_id=city.owner_id;
 end loop;
 -- Transport surviving station pools before abandoning the claimed fields.
 for g in select * from public.peris_garrisons where owner_id=city.owner_id and (col||':'||row)=any(old_fields)for update loop
  route:=public.peris_ruin_route(city.owner_id,g.col*128+64,g.row*128+64);
  if route is not null and public.peris_roster_total(public.peris_roster(to_jsonb(g)))>0 then
   insert into public.peris_ruin_evacuations(owner_id,origin_settlement_id,target_settlement_id,origin_x,origin_y,troops,departure_at,arrival_at)
   values(city.owner_id,city.id,(route->>'city_id')::bigint,g.col*128+64,g.row*128+64,public.peris_roster(to_jsonb(g)),public.peris_game_now(),
    public.peris_game_now()+make_interval(secs=>greatest(2,(route->>'distance')::numeric/22)::double precision));
  end if;
  delete from public.peris_garrisons where owner_id=g.owner_id and col=g.col and row=g.row;
 end loop;
 delete from public.peris_map_plots where settlement_id=p_city;
 select count(*)into living_count from public.settlements where owner_id=city.owner_id and ruined_at is null;
 if living_count=0 then
  update public.players set defeated_at=coalesce(defeated_at,now()),culture_points=0 where id=city.owner_id;
  delete from public.peris_ruin_evacuations where owner_id=city.owner_id;
  delete from public.peris_city_reinforcements where owner_id=city.owner_id;
  if to_regclass('public.peris_guild_reinforcements')is not null then
   delete from public.peris_guild_reinforcements where owner_id=city.owner_id;
  end if;
  delete from public.peris_garrisons where owner_id=city.owner_id;
  delete from public.peris_orders where owner_id=city.owner_id;
  update public.peris_settler_expeditions set status='returned'where owner_id=city.owner_id and status='travelling';
  update public.peris_campaign_farms set enabled=false where owner_id=city.owner_id;
  for a in select * from public.armies where owner_id=city.owner_id for update loop
   perform public.peris_write_roster(a.id,public.peris_roster('{}'));
   update public.armies set status='idle',raid_city_id=null,raid_target_id=null,raid_reserve=null,march_path=null,march_distance=null,march_origin=null,march_returning=false,march_sent_at=null,march_cancel_until=null,carried_loot=null,updated_at=now()where id=a.id;
  end loop;
  return true;
 end if;
 for a in select * from public.armies where owner_id=city.owner_id order by id for update loop
  pos:=public.peris_army_position(a);
  target_key:=floor(a.target_x/128.0)::integer||':'||floor(a.target_y/128.0)::integer;
  if a.home_settlement_id=city.id or target_key=any(old_fields) or
   (a.status='idle' and (floor((pos->>'x')::numeric/128.0)::integer||':'||floor((pos->>'y')::numeric/128.0)::integer)=any(old_fields))then
   perform public.peris_ruin_redirect_army(a.id);
  end if;
 end loop;
 return true;
end $$;
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
-- Culture is integrated at each completed order/arrival before rates change.
alter table public.battle_formations drop constraint if exists battle_formations_attack_multiplier_check;
alter table public.battle_formations add constraint battle_formations_attack_multiplier_check check(attack_multiplier between 1 and 4);
alter table public.peris_orders drop constraint if exists peris_orders_kind_check;
alter table public.peris_orders add constraint peris_orders_kind_check check(kind in('upgrade','recruit','field','settler'));
update public.settlements s set development_points=p.upgrades from public.players p where p.id=s.owner_id and s.development_points=0 and (select count(*)from public.settlements own where own.owner_id=p.id)=1;
alter table public.peris_challenges add column if not exists attacker_army_id bigint references public.armies(id);

create or replace function public.peris_culture_rate(p_owner uuid)returns numeric language sql stable security definer set search_path='' as $$
 select coalesce(sum(5+2*coalesce((select sum(level)from public.buildings b where b.settlement_id=s.id),0)+3*coalesce((select sum(level)from public.peris_city_slots c where c.settlement_id=s.id),0)),0)*public.peris_research_factor(p_owner,'culture')from public.settlements s where s.owner_id=p_owner and s.ruined_at is null
$$;
create or replace function public.peris_culture_accrue(p_owner uuid,p_until timestamptz)returns void language plpgsql security definer set search_path='' as $$
begin update public.players set culture_points=least(1000000000,culture_points+greatest(0,extract(epoch from p_until-culture_updated_at))/60*public.peris_culture_rate(p_owner)),culture_updated_at=greatest(culture_updated_at,p_until)where id=p_owner;end $$;
create or replace function public.peris_hero_level(p_experience integer)returns integer language sql immutable set search_path='' as $$select least(20,floor((1+sqrt(1+8*greatest(0,p_experience)/100::numeric))/2)::integer)$$;
create or replace function public.peris_hero_bonuses(p_army bigint)returns jsonb language plpgsql stable security definer set search_path='' as $$
declare h public.peris_heroes%rowtype;a numeric:=0;d numeric:=0;p numeric:=0;k numeric:=0;march_speed numeric:=1;
begin
 select * into h from public.peris_heroes where army_id=p_army;
 if h.id is not null then
 a:=h.attack+case h.class when 'knight' then 3 when 'ranger' then 2 else 1 end;
 d:=h.defence+case h.class when 'knight' then 2 else 1 end;
 p:=h.power+case h.class when 'mage' then 3 else 1 end;
 k:=h.knowledge+case h.class when 'knight' then 1 else 2 end;
 if h.class='ranger'then march_speed:=1.1;end if;
 select a+coalesce(sum(c.attack),0),d+coalesce(sum(c.defence),0),p+coalesce(sum(c.power),0),k+coalesce(sum(c.knowledge),0),march_speed+coalesce(sum(c.speed),0)
 into a,d,p,k,march_speed from public.peris_hero_artifacts i join public.peris_artifact_catalog c on c.id=i.artifact_id where i.hero_id=h.id and i.owner_id=h.owner_id;
 end if;
 return jsonb_build_object('attack',a,'defence',d,'power',p,'knowledge',k,'speed',march_speed*public.peris_research_factor((select owner_id from public.armies where id=p_army),'march'),'damage',1+a*.02,'protection',1+d*.025,'morale',least(10,a+d),'mana',k*10,'spell',(1+p*.08)*public.peris_research_factor((select owner_id from public.armies where id=p_army),'spell_power'));
end $$;
create or replace function public.peris_apply_hero(p_battle bigint,p_owner uuid,p_side text)returns void language plpgsql security definer set search_path='' as $$
declare aid bigint;sid bigint;bonus jsonb;tower integer;v integer;faction text;
begin
 if p_owner is null then return;end if;
 select case when p_side='attacker'then attacker_army_id else defender_army_id end into aid from public.battles where id=p_battle;
 select balance_version,case when p_side='attacker'then coalesce(attacker_faction,'roman')else coalesce(defender_faction,'roman')end into v,faction from public.battles where id=p_battle;
 select home_settlement_id into sid from public.armies where id=aid and owner_id=p_owner;
 bonus:=public.peris_hero_bonuses(aid);
 update public.battle_formations f set unit_attack=(public.peris_unit_stats(coalesce(f.recruit_unit,f.unit_type),faction,v)->>'attack')::numeric*(1+public.peris_research_bonus(p_owner,'attack')+public.peris_research_bonus(p_owner,f.unit_type||'_attack')),
 unit_defence=(public.peris_unit_stats(coalesce(f.recruit_unit,f.unit_type),faction,v)->>'defence')::numeric*(1+public.peris_research_bonus(p_owner,'defence')+public.peris_research_bonus(p_owner,f.unit_type||'_defence')),attack_multiplier=(1+least(.6,coalesce((select sum(level)*.04 from public.peris_city_slots where settlement_id=sid and building_type='smithy'),0)))*(bonus->>'damage')::numeric,
 defence_multiplier=(bonus->>'protection')::numeric,morale=least(100,morale+(bonus->>'morale')::numeric)where battle_id=p_battle and side=p_side;
 select coalesce(max(c.level),0)into tower from public.peris_city_slots c join public.settlements s on s.id=c.settlement_id where s.owner_id=p_owner and c.building_type='mage_tower';
 update public.battles set mana_attacker=case when p_side='attacker'then floor(((case when tower>0 then 20+tower*10 else 0 end)+(bonus->>'mana')::integer)*public.peris_research_factor(p_owner,'mana'))::integer else mana_attacker end,
 mana_defender=case when p_side='defender'then floor(((case when tower>0 then 20+tower*10 else 0 end)+(bonus->>'mana')::integer)*public.peris_research_factor(p_owner,'mana'))::integer else mana_defender end where id=p_battle;
end $$;
create or replace function public.peris_hero_reward(p_army bigint,p_experience integer,p_camp integer default null)returns void language plpgsql security definer set search_path='' as $$
declare h public.peris_heroes%rowtype;artifact text;
begin
 select * into h from public.peris_heroes where army_id=p_army for update;if h.id is null then return;end if;
 update public.peris_heroes set experience=least(19000,experience+floor(greatest(0,p_experience)*public.peris_research_factor(h.owner_id,'hero_xp'))::integer)where id=h.id;
 if p_camp is not null and (p_camp<=6 or p_camp%7=0)and(select count(*)from public.peris_hero_artifacts where owner_id=h.owner_id)<200 then
 artifact:=(array['iron_sword','chainmail','boots','circlet','runestaff','crown_seal'])[least(6,greatest(1,case when p_camp>6 then (select tier from public.peris_camps where id=p_camp)else p_camp end))];
 insert into public.peris_hero_artifacts(owner_id,artifact_id,slot,source_camp_id)select h.owner_id,c.id,c.slot,p_camp from public.peris_artifact_catalog c where c.id=artifact on conflict(owner_id,source_camp_id)do nothing;
 end if;
end $$;

create or replace function public.peris_found_reason(p_col integer,p_row integer,p_expedition bigint default null)returns text language plpgsql stable security definer set search_path='' as $$
declare c integer:=public.peris_wrap_cell(p_col);r integer:=public.peris_wrap_cell(p_row);
begin
 if p_col is null or p_row is null then return 'Choose whole field coordinates';end if;
 if exists(select 1 from generate_series(-1,1) dx cross join generate_series(-1,1)dy where not public.peris_world_walkable(public.peris_wrap_world((c+dx)*128+64),public.peris_wrap_world((r+dy)*128+64)))then return 'Choose a site with dry neighbouring fields for your city';end if;
 if exists(select 1 from public.settlements where public.peris_cell_distance(c,r,floor(x/128::numeric)::integer,floor(y/128::numeric)::integer)<4)then return 'Stay at least four fields away from another city';end if;
 if exists(select 1 from public.peris_camps where public.peris_cell_distance(c,r,floor(x/128::numeric)::integer,floor(y/128::numeric)::integer)<=1)then return 'A campaign landmark protects this land';end if;
 if exists(select 1 from public.peris_map_plots where public.peris_cell_distance(c,r,col,row)<=1)then return 'Choose unclaimed land with free neighbouring fields';end if;
 if exists(select 1 from public.peris_settler_expeditions where status='travelling'and id is distinct from p_expedition and public.peris_cell_distance(c,r,col,row)<4)then return 'Another settler expedition has reserved a nearby site';end if;
 return null;
end $$;
create or replace function public.peris_route_distance(p_start_x numeric,p_start_y numeric,p_end_x numeric,p_end_y numeric,p_path jsonb)returns numeric language plpgsql stable security definer set search_path='' as $$
declare point jsonb;px numeric:=p_start_x;py numeric:=p_start_y;x numeric;y numeric;cx integer;cy integer;pcx integer;pcy integer;i integer:=0;distance numeric:=0;segment numeric;
begin
 if p_path is null or jsonb_typeof(p_path)<>'array' then raise exception 'Choose a connected land route';end if;
 if jsonb_array_length(p_path)<2 or jsonb_array_length(p_path)>2000 then raise exception 'A route needs 2-2000 points';end if;
 pcx:=floor(px/128)::integer;pcy:=floor(py/128)::integer;
 for point in select value from jsonb_array_elements(p_path)loop
 i:=i+1;
 if jsonb_typeof(point)<>'array'or jsonb_array_length(point)<>2 or jsonb_typeof(point->0)<>'number'or jsonb_typeof(point->1)<>'number'then raise exception 'Invalid route point';end if;
 x:=(point->>0)::numeric;y:=(point->>1)::numeric;
 if x< -12800 or x>=12800 or y< -12800 or y>=12800 then raise exception 'Route leaves the world';end if;
 if i=1 then if abs(x-px)>1 or abs(y-py)>1 then raise exception 'Route must start at your city';end if;continue;end if;
 cx:=floor(x/128)::integer;cy:=floor(y/128)::integer;
 if public.peris_cell_distance(cx,cy,pcx,pcy)>1 or not public.peris_world_walkable(x,y)then raise exception 'Route must follow neighbouring land fields';end if;
 if cx<>pcx and cy<>pcy and(not public.peris_world_walkable((cx+.5)*128,(pcy+.5)*128)or not public.peris_world_walkable((pcx+.5)*128,(cy+.5)*128))then raise exception 'Route cannot cross a sea corner';end if;
 segment:=sqrt(power(public.peris_wrapped_delta(px,x),2)+power(public.peris_wrapped_delta(py,y),2));if segment=0 then raise exception 'Route must advance';end if;
 distance:=distance+segment;px:=x;py:=y;pcx:=cx;pcy:=cy;
 end loop;
 if px<>p_end_x or py<>p_end_y then raise exception 'Route must end at the colony site';end if;return distance;
end $$;
create or replace function public.peris_found_complete(p_id bigint)returns void language plpgsql security definer set search_path='' as $$
declare e public.peris_settler_expeditions%rowtype;s public.settlements%rowtype;sid bigint;reason text;
begin
 select * into e from public.peris_settler_expeditions where id=p_id for update;if e.id is null or e.status<>'travelling'then return;end if;
 if exists(select 1 from public.players where id=e.owner_id and defeated_at is not null)or exists(select 1 from public.settlements where id=e.origin_settlement_id and ruined_at is not null)then update public.peris_settler_expeditions set status='returned' where id=e.id;return;end if;
 perform pg_advisory_xact_lock(204200);
 perform public.peris_population_accrue(e.origin_settlement_id,e.arrival_at);
 reason:=public.peris_found_reason(e.col,e.row,e.id);
 if reason is not null then
 update public.peris_settler_expeditions set status='returned'where id=e.id;
 update public.settlements set settlers=least(6,settlers+3),wood=least(capacity,wood+500),stone=least(capacity,stone+400),food=least(food_capacity,food+600),gold=least(capacity,gold+150)where id=e.origin_settlement_id;
 update public.players set culture_points=least(1000000000,culture_points+e.culture_cost)where id=e.owner_id;return;
 end if;
 select * into s from public.settlements where id=e.origin_settlement_id;
 insert into public.settlements(owner_id,name,x,y,faction,wood,stone,food,gold,resources_updated_at,created_at,city_slots_ready)
 values(e.owner_id,e.name,e.col*128+64,e.row*128+64,s.faction,750,600,800,250,e.arrival_at,e.arrival_at,true)returning id into sid;
 insert into public.buildings(settlement_id,building_type,level)select sid,t,0 from unnest(array['lumber','quarry','farm','market','barracks','stables','wall','storehouse'])t;
 perform public.peris_city_economy(sid);
 update public.peris_settler_expeditions set status='founded',settlement_id=sid where id=e.id;
end $$;

create or replace function public.peris_empire_command(p_command jsonb)returns jsonb language plpgsql security definer set search_path='' as $$
declare u uuid:=public.peris_player_id();command_kind text:=p_command->>'type';s public.settlements%rowtype;a public.armies%rowtype;t public.armies%rowtype;h public.peris_heroes%rowtype;item public.peris_hero_artifacts%rowtype;
 qty integer;main integer;count_cities integer;count_armies integer;cost integer;reason text;distance numeric;hero_class text;hero_name text;new_army_id bigint;stat text;inf integer;arc integer;cav integer;position jsonb;target jsonb;camp public.peris_camps%rowtype;chosen jsonb;available jsonb;reply jsonb;
begin
 if u is null then raise exception 'Authentication required';end if;
 if exists(select 1 from public.players where id=u and defeated_at is not null)then raise exception 'This ruler has been permanently defeated';end if;
 if p_command is null or jsonb_typeof(p_command)<>'object'or command_kind is null then raise exception 'Choose a valid command';end if;
 if command_kind in('foundCity','claimField')then perform pg_advisory_xact_lock(204200);end if;
 perform set_config('peris.city_id',coalesce(p_command->>'settlementId',''),true);perform set_config('peris.army_id',coalesce(p_command->>'armyId',''),true);
 -- Two-player RPCs own their stable lock order; do not lock this caller first.
 if command_kind in('challenge','respond')then
  perform public.peris_city_id(u);perform public.peris_army_id(u);
  if command_kind='challenge'then return public.peris_challenge((p_command->>'ownerId')::uuid);
  else return public.peris_respond((p_command->>'id')::bigint,(p_command->>'accept')::boolean);end if;
 end if;
 perform public.peris_settle(u);
 if command_kind in('startResearch','pauseResearch','debugResearch')then return public.peris_research_command(p_command);end if;
 if command_kind='cancelMarch'then return public.peris_cancel_march((p_command->>'armyId')::bigint,(p_command->>'sentAt')::timestamptz);end if;
 select * into s from public.settlements where id=public.peris_city_id(u)for update;
 select * into a from public.armies where id=public.peris_army_id(u)for update;
 if exists(select 1 from public.battles where status='active'and(attacker_owner_id=u or defender_owner_id=u))then raise exception 'Finish the current battle first';end if;
 case command_kind
 when 'manageCityGarrison'then return public.peris_manage_city_garrison(u,s.id,a.id,p_command->>'action',p_command->'troops');
 when 'reinforceCity'then return public.peris_send_city_reinforcements(u,s.id,(p_command->>'targetCityId')::bigint,p_command->'troops',p_command->'route');
 when 'upgrade'then return public.peris_queue_upgrade(p_command->>'item');
 when 'buildSlot'then return public.peris_queue_slot((p_command->>'slot')::integer,p_command->>'item');
 when 'upgradeSlot'then return public.peris_queue_slot((p_command->>'slot')::integer,null);
 when 'recruit'then return public.peris_queue_recruit_to(p_command->>'item',(p_command->>'quantity')::integer,coalesce(p_command->>'destination','legion'));
 when 'move'then
  if p_command ? 'troops'then
   if jsonb_typeof(p_command->'troops')is distinct from 'object'then raise exception 'Choose troops currently available in this legion';end if;
   chosen:=public.peris_garrison_troops(p_command->'troops');available:=public.peris_roster(to_jsonb(a));
   if public.peris_roster_total(chosen)=0 or exists(select 1 from jsonb_each_text(chosen)where value::integer>(available->>key)::integer)then raise exception 'Choose troops currently available in this legion';end if;
   position:=public.peris_army_position(a);
   if public.peris_roster_total(chosen)<public.peris_roster_total(available)and not public.peris_station_owned(u,floor((position->>'x')::numeric/128)::integer,floor((position->>'y')::numeric/128)::integer)then raise exception 'Leave reinforcements only at your own village or field';end if;
  end if;
  if p_command ? 'route'then reply:=public.peris_march(round((p_command->>'x')::numeric)::integer,round((p_command->>'y')::numeric)::integer,p_command->'route');else reply:=public.move_army(round((p_command->>'x')::numeric)::integer,round((p_command->>'y')::numeric)::integer);end if;
  if chosen is not null then
   if public.peris_roster_total(chosen)<public.peris_roster_total(available)then perform public.peris_garrison_add(u,floor((position->>'x')::numeric/128)::integer,floor((position->>'y')::numeric/128)::integer,public.peris_roster_add(available,chosen,-1));end if;
   perform public.peris_write_roster(a.id,chosen);
   update public.armies set arrival_at=departure_at+make_interval(secs=>greatest(2,march_distance/public.peris_march_speed(id))::double precision)where id=a.id;
  end if;
  return reply;
 when 'raid'then
  return public.peris_prepare_raid((p_command->>'campId')::integer,p_command->'route',p_command->'troops');
 when 'raidCity'then
  return public.peris_prepare_city_raid(u,a.id,(p_command->>'targetCityId')::bigint,p_command->'route',p_command->'troops',coalesce(p_command->>'siegeTarget','auto'));
 when 'claimField'then return public.peris_claim_field((p_command->>'col')::integer,(p_command->>'row')::integer);
 when 'buildField'then return public.peris_queue_field((p_command->>'col')::integer,(p_command->>'row')::integer,p_command->>'item');
 when 'researchSpell'then return public.peris_research_spell(p_command->>'spell');
 when 'rename'then return public.peris_rename(p_command->>'name');
 when 'claim'then return public.peris_claim(p_command->>'questId');
 when 'setFaction'then perform public.peris_set_faction(p_command->>'faction');
 when 'debugCity'then
  if p_command->>'action'='culture'then
   if not coalesce((select enabled from public.peris_debug_config where id),false)then raise exception 'Debug tools are disabled';end if;
   if (p_command->>'value')::integer is distinct from 1000 then raise exception 'Choose +1,000 culture';end if;
   update public.players set culture_points=least(1000000000,culture_points+1000)where id=u;
  else perform public.peris_debug_city(p_command->>'action',p_command->>'target',(p_command->>'value')::integer);end if;
 when 'challenge'then return public.peris_challenge((p_command->>'ownerId')::uuid);
 when 'respond'then return public.peris_respond((p_command->>'id')::bigint,(p_command->>'accept')::boolean);
 when 'trainSettlers'then
  qty:=(p_command->>'quantity')::integer;
  if qty is null or qty<1 or qty>3 then raise exception 'Train between one and three settlers';end if;
  select level into main from public.buildings where settlement_id=s.id and building_type='market';
  if coalesce(main,0)<2 then raise exception 'Upgrade the main building to level 2 to train settlers';end if;
  if exists(select 1 from public.peris_orders where settlement_id=s.id and kind='settler')then raise exception 'Settlers are already training in this city';end if;
  if s.settlers+qty+3*(select count(*)from public.peris_settler_expeditions where origin_settlement_id=s.id and status='travelling')>6 then raise exception 'A city can prepare up to six settlers';end if;
  if s.wood<350*qty or s.stone<250*qty or s.food<450*qty or s.gold<100*qty then raise exception 'More supplies are needed to train settlers';end if;
  update public.settlements set wood=wood-350*qty,stone=stone-250*qty,food=food-450*qty,gold=gold-100*qty where id=s.id;
  insert into public.peris_orders(owner_id,settlement_id,kind,item,quantity,started_at,finish_at)values(u,s.id,'settler','settlers',qty,public.peris_game_now(),public.peris_game_now()+make_interval(secs=>ceil(40*qty/(1+main*.15))::double precision));
 when 'foundCity'then
  perform pg_advisory_xact_lock(204200);
  reason:=public.peris_found_reason((p_command->>'col')::integer,(p_command->>'row')::integer);
  if reason is not null then raise exception '%',reason;end if;
  hero_name:=btrim(p_command->>'name');if hero_name is null or length(hero_name)<2 or length(hero_name)>32 then raise exception 'Use a city name of 2-32 characters';end if;
  select (select count(*)from public.settlements where owner_id=u and ruined_at is null)+(select count(*)from public.peris_settler_expeditions where owner_id=u and status='travelling')into count_cities;
  if count_cities>=10 then raise exception 'Your empire can hold up to ten cities';end if;
  cost:=300*count_cities*count_cities;
  if s.settlers<3 then raise exception 'Prepare three settlers in this city first';end if;
  if (select culture_points from public.players where id=u)<cost then raise exception 'Not enough culture points';end if;
  if s.wood<500 or s.stone<400 or s.food<600 or s.gold<150 then raise exception 'More supplies are needed for this colony';end if;
  distance:=public.peris_route_distance(s.x,s.y,public.peris_wrap_cell((p_command->>'col')::integer)*128+64,public.peris_wrap_cell((p_command->>'row')::integer)*128+64,p_command->'route');
  update public.settlements set settlers=settlers-3,wood=wood-500,stone=stone-400,food=food-600,gold=gold-150 where id=s.id;
  update public.players set culture_points=culture_points-cost where id=u;
  insert into public.peris_settler_expeditions(owner_id,origin_settlement_id,col,row,name,departure_at,arrival_at,culture_cost,march_path)
  values(u,s.id,public.peris_wrap_cell((p_command->>'col')::integer),public.peris_wrap_cell((p_command->>'row')::integer),hero_name,public.peris_game_now(),public.peris_game_now()+make_interval(secs=>greatest(5,distance/18)::double precision),cost,p_command->'route');
 when 'recruitHero'then
  hero_class:=p_command->>'heroClass';hero_name:=btrim(p_command->>'name');
  if hero_class is null or hero_class not in('knight','ranger','mage')then raise exception 'Choose a hero class';end if;
  if hero_name is null or length(hero_name)<2 or length(hero_name)>24 then raise exception 'Use a hero name of 2-24 characters';end if;
  select count(*)into count_cities from public.settlements where owner_id=u and ruined_at is null;select count(*)into count_armies from public.armies where owner_id=u;
  if count_armies>=least(20,count_cities*2)then raise exception 'Found another city to support more armies';end if;
  if s.gold<500 then raise exception 'Hiring a hero costs 500 gold';end if;
  update public.settlements set gold=gold-500 where id=s.id;
  position:=public.peris_home_army_position(s.x,s.y);
  insert into public.armies(owner_id,home_settlement_id,name,infantry,archers,cavalry,start_x,start_y,target_x,target_y)values(u,s.id,hero_name||'’s army',0,0,0,(position->>'x')::integer,(position->>'y')::integer,(position->>'x')::integer,(position->>'y')::integer)returning id into new_army_id;
  update public.peris_heroes set name=hero_name,class=hero_class where army_id=new_army_id;
 when 'heroSkill'then
  select * into h from public.peris_heroes where id=(p_command->>'heroId')::bigint and owner_id=u for update;
  stat:=p_command->>'stat';if h.id is null or stat is null or stat not in('attack','defence','power','knowledge')then raise exception 'Choose your hero and an attribute';end if;
  if public.peris_hero_level(h.experience)-1-h.attack-h.defence-h.power-h.knowledge<1 then raise exception 'Win battles to earn another skill point';end if;
  update public.peris_heroes set attack=attack+case when stat='attack'then 1 else 0 end,defence=defence+case when stat='defence'then 1 else 0 end,power=power+case when stat='power'then 1 else 0 end,knowledge=knowledge+case when stat='knowledge'then 1 else 0 end where id=h.id;
 when 'equipArtifact'then
  select * into h from public.peris_heroes where id=(p_command->>'heroId')::bigint and owner_id=u for update;
  select * into item from public.peris_hero_artifacts where id=(p_command->>'artifactId')::bigint and owner_id=u for update;
  if h.id is null or item.id is null then raise exception 'Choose an artifact from your own inventory';end if;
  if item.hero_id is not null and item.hero_id<>h.id then raise exception 'Unequip this artifact from its current hero first';end if;
  if coalesce((p_command->>'equip')::boolean,false)then update public.peris_hero_artifacts set hero_id=null where hero_id=h.id and slot=item.slot;update public.peris_hero_artifacts set hero_id=h.id where id=item.id;
  else update public.peris_hero_artifacts set hero_id=null where id=item.id;end if;
 when 'transferTroops'then
  select * into t from public.armies where id=(p_command->>'targetArmyId')::bigint and owner_id=u for update;
  if t.id is null or t.id=a.id then raise exception 'Choose a different army of your own';end if;
  position:=public.peris_army_position(a);target:=public.peris_army_position(t);
  if a.status<>'idle'or t.status<>'idle'or a.raid_reserve is not null or t.raid_reserve is not null or a.raid_target_id is not null or t.raid_target_id is not null or a.raid_city_id is not null or t.raid_city_id is not null or sqrt(power(public.peris_wrapped_delta((position->>'x')::numeric,(target->>'x')::numeric),2)+power(public.peris_wrapped_delta((position->>'y')::numeric,(target->>'y')::numeric),2))>90 then raise exception 'Bring both idle armies together first';end if;
  if exists(select 1 from public.peris_orders where kind='recruit'and army_id in(a.id,t.id))then raise exception 'Finish both training queues before transferring troops';end if;
  if p_command ? 'troops'then
   if jsonb_typeof(p_command->'troops')is distinct from 'object'then raise exception 'Choose available soldiers';end if;
   chosen:=public.peris_roster(p_command->'troops');
   if exists(select 1 from jsonb_each_text(chosen)where value::integer>(public.peris_roster(to_jsonb(a))->>key)::integer)then raise exception 'Choose available soldiers';end if;
  else
   inf:=(p_command->>'infantry')::integer;arc:=(p_command->>'archers')::integer;cav:=(p_command->>'cavalry')::integer;
   if inf is null or arc is null or cav is null or inf<0 or arc<0 or cav<0 or inf>a.infantry or arc>a.archers or cav>a.cavalry then raise exception 'Choose available soldiers';end if;
   chosen:=public.peris_roster_take_classes(public.peris_roster(to_jsonb(a)),jsonb_build_object('infantry',inf,'archers',arc,'cavalry',cav));
  end if;
  if public.peris_roster_total(chosen)=0 or public.peris_roster_total(chosen)+t.infantry+t.archers+t.cavalry>1000 then raise exception 'Stay within the 1000 soldier capacity';end if;
  perform public.peris_write_roster(a.id,public.peris_roster_add(public.peris_roster(to_jsonb(a)),chosen,-1));
  perform public.peris_write_roster(t.id,public.peris_roster_add(public.peris_roster(to_jsonb(t)),chosen));
 when 'rebaseArmy'then
  position:=public.peris_army_position(a);
  target:=public.peris_home_army_position(s.x,s.y);
  if a.status<>'idle'or a.raid_city_id is not null or sqrt(power(public.peris_wrapped_delta((position->>'x')::numeric,(target->>'x')::numeric),2)+power(public.peris_wrapped_delta((position->>'y')::numeric,(target->>'y')::numeric),2))>90 then raise exception 'Bring this army to the selected city first';end if;
  if exists(select 1 from public.peris_orders where kind='recruit'and army_id=a.id)then raise exception 'Finish training before changing the home city';end if;
  update public.armies set home_settlement_id=s.id where id=a.id;
 else raise exception 'Unknown empire command';
 end case;
 return jsonb_build_object('ok',true);
end $$;
-- Private campaign plans reference real bandit camps and owned legions.

-- Saved metadata has no recurring timer; manual starts reuse authoritative raid commands.

create table if not exists public.peris_campaign_farm_lists (

 id bigint generated always as identity primary key,

 owner_id uuid not null references public.players(id) on delete cascade,

 name text not null check(char_length(btrim(name)) between 2 and 40),

 troops jsonb not null, casualties_only boolean not null default false,

 unique(id,owner_id)

);

create table if not exists public.peris_campaign_farms (

 id bigint generated always as identity primary key,

 owner_id uuid not null references public.players(id) on delete cascade,

 list_id bigint not null, camp_id integer not null references public.peris_camps(id),

 army_id bigint not null references public.armies(id) on delete cascade,

 troops jsonb not null, created_at timestamptz not null default now(),

 foreign key(list_id,owner_id) references public.peris_campaign_farm_lists(id,owner_id) on delete cascade,

 unique(list_id,camp_id)

);

create index if not exists peris_campaign_farm_lists_owner on public.peris_campaign_farm_lists(owner_id,id);

create index if not exists peris_campaign_farms_owner on public.peris_campaign_farms(owner_id,list_id,id);

alter table public.peris_campaign_farms add column if not exists sent bigint not null default 0 check(sent>=0);
alter table public.peris_campaign_farms add column if not exists skipped bigint not null default 0 check(skipped>=0);

alter table public.peris_campaign_farm_lists enable row level security;

alter table public.peris_campaign_farms enable row level security;

revoke all on public.peris_campaign_farm_lists,public.peris_campaign_farms from public,anon,authenticated;

grant select on public.peris_campaign_farm_lists,public.peris_campaign_farms to authenticated;

drop policy if exists "own campaign farm lists" on public.peris_campaign_farm_lists;

create policy "own campaign farm lists" on public.peris_campaign_farm_lists for select to authenticated using(owner_id=public.peris_player_id());

drop policy if exists "own campaign farms" on public.peris_campaign_farms;

create policy "own campaign farms" on public.peris_campaign_farms for select to authenticated using(owner_id=public.peris_player_id());



create or replace function public.peris_campaign_farm_troops(p_troops jsonb,p_allow_empty boolean)

returns jsonb language plpgsql immutable set search_path='' as $$

declare result jsonb:=public.peris_roster(p_troops);

begin

 if public.peris_roster_total(result)>1000 or (not p_allow_empty and public.peris_roster_total(result)=0)then raise exception 'Save a party of 1–1000 soldiers';end if;

 return result;

end $$;



create or replace function public.peris_campaign_farm_command(p_command jsonb)

returns jsonb language plpgsql security definer set search_path='' as $$

declare

 u uuid:=public.peris_player_id();kind text:=p_command->>'type';v_entry_id bigint;v_list_id bigint;v_camp_id integer;v_army_id bigint;

 preset jsonb;list_name text;losses_only boolean;list public.peris_campaign_farm_lists;farm public.peris_campaign_farms;v_duplicate_id bigint;

 started integer:=0;skipped jsonb:='[]';batch_path jsonb;previous_army text;previous_city text;target_army public.armies%rowtype;repeat_enabled boolean;repeat_interval integer;
 selected_ids bigint[];selected_id jsonb;selected_count integer;v_action text;

begin

 if u is null then raise exception 'Authentication required';end if;

 if jsonb_typeof(p_command) is distinct from 'object' then raise exception 'Choose a campaign farm command';end if;

 -- Settlement takes the global founding lock before its owner lock when needed.

 if kind='startCampaignFarmList' then perform public.peris_settle(u);end if;

 -- Serialize one owner's saves/deletes so list limits and duplicate checks are atomic.

 perform 1 from public.players where id=u for update;

 if not found then raise exception 'Create your realm first';end if;

 if p_command ? 'id' then

  if jsonb_typeof(p_command->'id') is distinct from 'number' or (p_command->>'id')::numeric<>trunc((p_command->>'id')::numeric) or (p_command->>'id')::numeric not between 1 and 9007199254740991 then raise exception 'Choose a valid saved farm';end if;

  v_entry_id:=(p_command->>'id')::bigint;

 end if;

 if kind='manageCampaignFarmTargets' then
  if jsonb_typeof(p_command->'ids') is distinct from 'array' then raise exception 'Choose saved targets';end if;
  selected_count:=jsonb_array_length(p_command->'ids');
  if selected_count not between 1 and 100 then raise exception 'Choose up to 100 targets';end if;
  selected_ids:=array[]::bigint[];
  for selected_id in select value from jsonb_array_elements(p_command->'ids')loop
   if jsonb_typeof(selected_id) is distinct from 'number' then raise exception 'Choose valid saved targets';end if;
   if selected_id::text::numeric<>trunc(selected_id::text::numeric) or selected_id::text::numeric not between 1 and 9007199254740991 then raise exception 'Choose valid saved targets';end if;
   selected_ids:=array_append(selected_ids,selected_id::text::bigint);
  end loop;
  if (select count(distinct id)from unnest(selected_ids)ids(id))<>selected_count or (select count(*)from public.peris_campaign_farms where owner_id=u and id=any(selected_ids))<>selected_count then raise exception 'Choose your own saved targets';end if;
  v_action:=p_command->>'action';
  if v_action='delete' then delete from public.peris_campaign_farms where owner_id=u and id=any(selected_ids);
  elsif v_action='move' then
   if jsonb_typeof(p_command->'listId') is distinct from 'number' then raise exception 'Choose your own destination list';end if;
   if (p_command->>'listId')::numeric<>trunc((p_command->>'listId')::numeric) then raise exception 'Choose your own destination list';end if;
   v_list_id:=(p_command->>'listId')::bigint;
   if not exists(select 1 from public.peris_campaign_farm_lists where id=v_list_id and owner_id=u)then raise exception 'Choose your own destination list';end if;
   if (select count(*)from public.peris_campaign_farms where list_id=v_list_id and not(id=any(selected_ids)))+selected_count>100 then raise exception 'A campaign farm list holds up to 100 targets';end if;
   if exists(select camp_id from public.peris_campaign_farms where (list_id=v_list_id and not(id=any(selected_ids)))or(owner_id=u and id=any(selected_ids))group by camp_id having count(*)>1)then raise exception 'A selected camp is already in the destination list';end if;
   update public.peris_campaign_farms set list_id=v_list_id where owner_id=u and id=any(selected_ids);
  else raise exception 'Choose move or delete';end if;
  return jsonb_build_object('ok',true,'changed',selected_count);
 elsif kind in('setCampaignFarmListEnabled','applyCampaignFarmListTroops')then
  select * into list from public.peris_campaign_farm_lists where id=v_entry_id and owner_id=u;
  if not found then raise exception 'Choose your own farm list';end if;
  if kind='applyCampaignFarmListTroops'then
   preset:=public.peris_campaign_farm_troops(list.troops,false);
   update public.peris_campaign_farms set troops=preset where list_id=list.id and owner_id=u;
  else
   if jsonb_typeof(p_command->'enabled') is distinct from 'boolean'then raise exception 'Choose a repeat preference';end if;
   repeat_enabled:=(p_command->>'enabled')::boolean;
   update public.peris_campaign_farms set enabled=repeat_enabled,next_at=case when repeat_enabled then public.peris_game_now()+make_interval(secs=>interval_seconds)else null end,last_status=case when repeat_enabled then 'Scheduled'else 'Paused'end where list_id=list.id and owner_id=u and enabled is distinct from repeat_enabled;
  end if;
  return jsonb_build_object('ok',true);
 elsif kind='startCampaignFarmList' then

  if not exists(select 1 from public.peris_campaign_farm_lists where id=v_entry_id and owner_id=u)then raise exception 'Choose your own farm list';end if;

  if p_command ? 'routes' and jsonb_typeof(p_command->'routes') is distinct from 'array' then raise exception 'Choose valid farm routes';end if;

  previous_army:=current_setting('peris.army_id',true);previous_city:=current_setting('peris.city_id',true);

  for farm in select f.* from public.peris_campaign_farms f where f.list_id=v_entry_id and f.owner_id=u order by f.id for update loop

   -- A failed target rolls back its own preparation; other available legions still depart.

   begin

    select * into target_army from public.armies where id=farm.army_id and owner_id=u for update;

    if target_army.id is null then raise exception 'Choose your own legion';end if;

    if not exists(select 1 from public.peris_camps where id=farm.camp_id and bandit)then raise exception 'Only bandit camps can be started from a farm list';end if;

    preset:=public.peris_campaign_farm_troops(farm.troops,false);

    batch_path:=null;

    if p_command ? 'routes' then

     select r->'path' into batch_path from jsonb_array_elements(p_command->'routes')r where r->>'targetId'=farm.id::text limit 1;

     if batch_path is null then raise exception 'No connected land route is available for this target';end if;

    end if;

    perform set_config('peris.army_id',farm.army_id::text,true);perform set_config('peris.city_id',target_army.home_settlement_id::text,true);

    perform public.peris_prepare_raid(farm.camp_id,batch_path,preset);

    update public.armies set farm_list_id=farm.list_id where id=farm.army_id;

    update public.peris_campaign_farms set route=(select march_path from public.armies where id=farm.army_id),last_status='Raid preparing',sent=sent+1 where id=farm.id;
    started:=started+1;

   exception when others then

    update public.peris_campaign_farms set last_status=sqlerrm,skipped=peris_campaign_farms.skipped+1 where id=farm.id;
    skipped:=skipped||jsonb_build_array(jsonb_build_object('targetId',farm.id,'reason',sqlerrm));

   end;

  end loop;

  perform set_config('peris.army_id',coalesce(previous_army,''),true);perform set_config('peris.city_id',coalesce(previous_city,''),true);

  if started=0 then raise exception 'No raids started. %',coalesce(skipped->0->>'reason','Add camp targets to this list first.');end if;

  return jsonb_build_object('started',started,'skipped',skipped);

 elsif kind='saveCampaignFarmList' then

  if jsonb_typeof(p_command->'name') is distinct from 'string' then raise exception 'Use a farm list name of 2–40 characters';end if;

  list_name:=btrim(p_command->>'name');

  if char_length(list_name) not between 2 and 40 then raise exception 'Use a farm list name of 2–40 characters';end if;

  if jsonb_typeof(p_command->'casualtiesOnly') is distinct from 'boolean' then raise exception 'Choose a report preference';end if;

  preset:=public.peris_campaign_farm_troops(p_command->'troops',true);losses_only:=(p_command->>'casualtiesOnly')::boolean;

  if v_entry_id is null then

   if (select count(*)from public.peris_campaign_farm_lists where owner_id=u)>=50 then raise exception 'You can save up to 50 campaign farm lists';end if;

   insert into public.peris_campaign_farm_lists(owner_id,name,troops,casualties_only)values(u,list_name,preset,losses_only)returning * into list;

  else

   update public.peris_campaign_farm_lists set name=list_name,troops=preset,casualties_only=losses_only where id=v_entry_id and owner_id=u returning * into list;

   if not found then raise exception 'Choose your own farm list';end if;

  end if;

  return to_jsonb(list);

 elsif kind='saveCampaignFarm' then

  foreach list_name in array array['listId','campId','armyId'] loop

   if jsonb_typeof(p_command->list_name) is distinct from 'number' or (p_command->>list_name)::numeric<>trunc((p_command->>list_name)::numeric) or (p_command->>list_name)::numeric not between 1 and 9007199254740991 then raise exception 'Choose a farm list, camp and legion';end if;

  end loop;

  v_list_id:=(p_command->>'listId')::bigint;v_camp_id:=(p_command->>'campId')::integer;v_army_id:=(p_command->>'armyId')::bigint;

  if not exists(select 1 from public.peris_campaign_farm_lists l where l.id=v_list_id and l.owner_id=u)then raise exception 'Choose your own farm list';end if;

  if not exists(select 1 from public.peris_camps c where c.id=v_camp_id and c.bandit)then raise exception 'Only bandit camps can be saved. Story locations are manual encounters';end if;

  perform 1 from public.armies a where a.id=v_army_id and a.owner_id=u for share;

  if not found then raise exception 'Choose your own legion';end if;

  preset:=public.peris_campaign_farm_troops(p_command->'troops',false);

  select f.id into v_duplicate_id from public.peris_campaign_farms f where f.owner_id=u and f.list_id=v_list_id and f.camp_id=v_camp_id;

  if v_entry_id is null then v_entry_id:=v_duplicate_id;

  else

   select * into farm from public.peris_campaign_farms f where f.id=v_entry_id and f.owner_id=u;

   if not found then raise exception 'Choose your own saved farm';end if;

   if v_duplicate_id is not null and v_duplicate_id<>v_entry_id then raise exception 'This camp is already in that farm list';end if;

  end if;

  if v_entry_id is not null and farm.id is null then select * into farm from public.peris_campaign_farms f where f.id=v_entry_id and f.owner_id=u;end if;

  if (farm.id is null or farm.list_id<>v_list_id) and (select count(*)from public.peris_campaign_farms f where f.list_id=v_list_id)>=100 then raise exception 'A campaign farm list holds up to 100 targets';end if;

  if v_entry_id is null then

   insert into public.peris_campaign_farms(owner_id,list_id,camp_id,army_id,troops)values(u,v_list_id,v_camp_id,v_army_id,preset)returning * into farm;

  else

   update public.peris_campaign_farms f set list_id=v_list_id,camp_id=v_camp_id,army_id=v_army_id,troops=preset,route=case when f.army_id=v_army_id and f.camp_id=v_camp_id then f.route else null end where f.id=v_entry_id and f.owner_id=u returning * into farm;

  end if;

  if p_command ? 'enabled' and jsonb_typeof(p_command->'enabled')<>'boolean'then raise exception 'Choose a repeat preference';end if;
  repeat_enabled:=coalesce((p_command->>'enabled')::boolean,farm.enabled,false);
  repeat_interval:=coalesce((p_command->>'intervalSeconds')::integer,farm.interval_seconds,300);
  if repeat_interval not between 60 and 86400 then raise exception 'Use a repeat interval of 60–86400 seconds';end if;
  update public.peris_campaign_farms set enabled=repeat_enabled,interval_seconds=repeat_interval,
   next_at=case when repeat_enabled then case when enabled and interval_seconds=repeat_interval then coalesce(next_at,public.peris_game_now()+make_interval(secs=>repeat_interval))else public.peris_game_now()+make_interval(secs=>repeat_interval)end else null end
   where id=farm.id returning * into farm;
  return to_jsonb(farm);

 elsif kind='deleteCampaignFarm' then

  delete from public.peris_campaign_farms where id=v_entry_id and owner_id=u;

  if not found then raise exception 'Choose your own saved farm';end if;

 elsif kind='deleteCampaignFarmList' then

  if not exists(select 1 from public.peris_campaign_farm_lists where id=v_entry_id and owner_id=u)then raise exception 'Choose your own farm list';end if;

  if exists(select 1 from public.peris_campaign_farms f where f.list_id=v_entry_id)then raise exception 'Remove or move this list’s targets before deleting it';end if;

  delete from public.peris_campaign_farm_lists where id=v_entry_id and owner_id=u;

 else raise exception 'Choose a campaign farm command';

 end if;

 return jsonb_build_object('ok',true);

end $$;
-- Generated by scripts/build-bandits.mjs from the shared deterministic world seed.
insert into public.peris_camps(id,name,x,y,tier,terrain,infantry,archers,cavalry,description,bandit,faction)
select c.* from (values
(1000,'Elves outpost',-12224,-11840,1,'highlands',22,7,1,'Level 1 camp. Raid its stored supplies and defeat its defenders to earn an artifact and hero experience. Stock grows over time and defenders replenish unpredictably.',true,'elf'),
(1001,'Dwarves war camp',-11712,-12608,6,'plains',146,39,69,'Level 6 camp. Raid its stored supplies and defeat its defenders to earn an artifact and hero experience. Stock grows over time and defenders replenish unpredictably.',true,'dwarf'),
(1002,'Human · Spartan outpost',-9920,-12736,1,'plains',24,4,1,'Level 1 camp. Raid its stored supplies and defeat its defenders to earn an artifact and hero experience. Stock grows over time and defenders replenish unpredictably.',true,'spartan'),
(1003,'Human · Roman outpost',-9024,-12736,1,'plains',19,11,1,'Level 1 camp. Raid its stored supplies and defeat its defenders to earn an artifact and hero experience. Stock grows over time and defenders replenish unpredictably.',true,'roman'),
(1004,'Human · Roman outpost',-8128,-12352,1,'highlands',23,5,2,'Level 1 camp. Raid its stored supplies and defeat its defenders to earn an artifact and hero experience. Stock grows over time and defenders replenish unpredictably.',true,'roman'),
(1005,'Orcs outpost',-7360,-12224,1,'woods',22,4,2,'Level 1 camp. Raid its stored supplies and defeat its defenders to earn an artifact and hero experience. Stock grows over time and defenders replenish unpredictably.',true,'orc'),
(1006,'Gnomes raider camp',-6208,-12224,3,'highlands',34,23,18,'Level 3 camp. Raid its stored supplies and defeat its defenders to earn an artifact and hero experience. Stock grows over time and defenders replenish unpredictably.',true,'gnome'),
(1007,'Demons outpost',-5568,-11840,1,'highlands',20,9,2,'Level 1 camp. Raid its stored supplies and defeat its defenders to earn an artifact and hero experience. Stock grows over time and defenders replenish unpredictably.',true,'demon'),
(1008,'Human · Roman raider camp',-4032,-12736,5,'plains',84,67,31,'Level 5 camp. Raid its stored supplies and defeat its defenders to earn an artifact and hero experience. Stock grows over time and defenders replenish unpredictably.',true,'roman'),
(1009,'Human · Persian war camp',-3008,-12352,8,'woods',146,186,135,'Level 8 camp. Raid its stored supplies and defeat its defenders to earn an artifact and hero experience. Stock grows over time and defenders replenish unpredictably.',true,'persian'),
(1010,'Human · Roman outpost',-2112,-12736,1,'highlands',23,5,1,'Level 1 camp. Raid its stored supplies and defeat its defenders to earn an artifact and hero experience. Stock grows over time and defenders replenish unpredictably.',true,'roman'),
(1011,'Human · Persian outpost',-1344,-12224,1,'plains',24,7,0,'Level 1 camp. Raid its stored supplies and defeat its defenders to earn an artifact and hero experience. Stock grows over time and defenders replenish unpredictably.',true,'persian'),
(1012,'Human · Spartan outpost',64,-12480,1,'darkland',23,8,0,'Level 1 camp. Raid its stored supplies and defeat its defenders to earn an artifact and hero experience. Stock grows over time and defenders replenish unpredictably.',true,'spartan'),
(1013,'Human · Roman raider camp',1472,-12224,3,'desert',46,21,11,'Level 3 camp. Raid its stored supplies and defeat its defenders to earn an artifact and hero experience. Stock grows over time and defenders replenish unpredictably.',true,'roman'),
(1014,'Human · Roman raider camp',1856,-12224,4,'desert',74,27,26,'Level 4 camp. Raid its stored supplies and defeat its defenders to earn an artifact and hero experience. Stock grows over time and defenders replenish unpredictably.',true,'roman'),
(1015,'Elves raider camp',2624,-12736,5,'highlands',113,62,14,'Level 5 camp. Raid its stored supplies and defeat its defenders to earn an artifact and hero experience. Stock grows over time and defenders replenish unpredictably.',true,'elf'),
(1016,'Gnomes outpost',4160,-11968,2,'plains',39,11,2,'Level 2 camp. Raid its stored supplies and defeat its defenders to earn an artifact and hero experience. Stock grows over time and defenders replenish unpredictably.',true,'gnome'),
(1017,'Human · Egyptian raider camp',5184,-11840,4,'plains',62,42,8,'Level 4 camp. Raid its stored supplies and defeat its defenders to earn an artifact and hero experience. Stock grows over time and defenders replenish unpredictably.',true,'egyptian'),
(1020,'Pandaren outpost',8512,-12224,2,'plains',32,20,1,'Level 2 camp. Raid its stored supplies and defeat its defenders to earn an artifact and hero experience. Stock grows over time and defenders replenish unpredictably.',true,'pandaren'),
(1021,'Human · Egyptian raider camp',9408,-12224,3,'plains',55,19,7,'Level 3 camp. Raid its stored supplies and defeat its defenders to earn an artifact and hero experience. Stock grows over time and defenders replenish unpredictably.',true,'egyptian'),
(1022,'Demons raider camp',10304,-12736,4,'plains',47,33,31,'Level 4 camp. Raid its stored supplies and defeat its defenders to earn an artifact and hero experience. Stock grows over time and defenders replenish unpredictably.',true,'demon'),
(1023,'Human · Spartan raider camp',11328,-12480,5,'woods',110,61,17,'Level 5 camp. Raid its stored supplies and defeat its defenders to earn an artifact and hero experience. Stock grows over time and defenders replenish unpredictably.',true,'spartan'),
(1024,'Gnomes outpost',12352,-11968,2,'plains',31,18,4,'Level 2 camp. Raid its stored supplies and defeat its defenders to earn an artifact and hero experience. Stock grows over time and defenders replenish unpredictably.',true,'gnome'),
(1025,'Orcs raider camp',-12736,-11328,4,'highlands',77,37,15,'Level 4 camp. Raid its stored supplies and defeat its defenders to earn an artifact and hero experience. Stock grows over time and defenders replenish unpredictably.',true,'orc'),
(1026,'Elves raider camp',-11712,-11712,3,'plains',59,26,0,'Level 3 camp. Raid its stored supplies and defeat its defenders to earn an artifact and hero experience. Stock grows over time and defenders replenish unpredictably.',true,'elf'),
(1027,'Demons outpost',-9920,-11200,2,'highlands',38,10,4,'Level 2 camp. Raid its stored supplies and defeat its defenders to earn an artifact and hero experience. Stock grows over time and defenders replenish unpredictably.',true,'demon'),
(1028,'Human · Persian raider camp',-9152,-11456,3,'plains',60,23,2,'Level 3 camp. Raid its stored supplies and defeat its defenders to earn an artifact and hero experience. Stock grows over time and defenders replenish unpredictably.',true,'persian'),
(1029,'Human · Egyptian raider camp',-7744,-11712,3,'highlands',43,20,14,'Level 3 camp. Raid its stored supplies and defeat its defenders to earn an artifact and hero experience. Stock grows over time and defenders replenish unpredictably.',true,'egyptian'),
(1030,'Demons raider camp',-7104,-11072,3,'highlands',39,23,24,'Level 3 camp. Raid its stored supplies and defeat its defenders to earn an artifact and hero experience. Stock grows over time and defenders replenish unpredictably.',true,'demon'),
(1031,'Elves outpost',-6336,-11200,2,'woods',29,15,4,'Level 2 camp. Raid its stored supplies and defeat its defenders to earn an artifact and hero experience. Stock grows over time and defenders replenish unpredictably.',true,'elf'),
(1032,'Demons outpost',-4800,-11200,1,'desert',18,9,2,'Level 1 camp. Raid its stored supplies and defeat its defenders to earn an artifact and hero experience. Stock grows over time and defenders replenish unpredictably.',true,'demon'),
(1033,'Human · Persian war camp',-4416,-11712,8,'plains',256,130,66,'Level 8 camp. Raid its stored supplies and defeat its defenders to earn an artifact and hero experience. Stock grows over time and defenders replenish unpredictably.',true,'persian'),
(1034,'Elves raider camp',-2624,-11712,3,'woods',52,13,9,'Level 3 camp. Raid its stored supplies and defeat its defenders to earn an artifact and hero experience. Stock grows over time and defenders replenish unpredictably.',true,'elf'),
(1035,'Pandaren outpost',-1984,-11328,1,'woods',22,9,1,'Level 1 camp. Raid its stored supplies and defeat its defenders to earn an artifact and hero experience. Stock grows over time and defenders replenish unpredictably.',true,'pandaren'),
(1036,'Pandaren raider camp',-1088,-11712,3,'highlands',56,18,6,'Level 3 camp. Raid its stored supplies and defeat its defenders to earn an artifact and hero experience. Stock grows over time and defenders replenish unpredictably.',true,'pandaren'),
(1037,'Human · Roman raider camp',64,-11456,4,'plains',63,29,23,'Level 4 camp. Raid its stored supplies and defeat its defenders to earn an artifact and hero experience. Stock grows over time and defenders replenish unpredictably.',true,'roman'),
(1038,'Human · Persian raider camp',1088,-11200,5,'plains',136,55,2,'Level 5 camp. Raid its stored supplies and defeat its defenders to earn an artifact and hero experience. Stock grows over time and defenders replenish unpredictably.',true,'persian'),
(1039,'Gnomes war camp',2112,-10944,8,'woods',221,163,64,'Level 8 camp. Raid its stored supplies and defeat its defenders to earn an artifact and hero experience. Stock grows over time and defenders replenish unpredictably.',true,'gnome'),
(1040,'Pandaren stronghold',2624,-11072,9,'marsh',385,144,115,'Level 9 camp. Raid its stored supplies and defeat its defenders to earn an artifact and hero experience. Stock grows over time and defenders replenish unpredictably.',true,'pandaren'),
(1041,'Pandaren stronghold',4160,-11072,10,'plains',331,246,157,'Level 10 camp. Raid its stored supplies and defeat its defenders to earn an artifact and hero experience. Stock grows over time and defenders replenish unpredictably.',true,'pandaren'),
(1042,'Demons outpost',4672,-11456,1,'darkland',21,9,0,'Level 1 camp. Raid its stored supplies and defeat its defenders to earn an artifact and hero experience. Stock grows over time and defenders replenish unpredictably.',true,'demon'),
(1043,'Demons outpost',6336,-11200,1,'plains',18,8,2,'Level 1 camp. Raid its stored supplies and defeat its defenders to earn an artifact and hero experience. Stock grows over time and defenders replenish unpredictably.',true,'demon'),
(1044,'Orcs raider camp',6720,-11456,3,'woods',54,17,8,'Level 3 camp. Raid its stored supplies and defeat its defenders to earn an artifact and hero experience. Stock grows over time and defenders replenish unpredictably.',true,'orc'),
(1045,'Gnomes raider camp',7744,-11200,4,'desert',62,28,24,'Level 4 camp. Raid its stored supplies and defeat its defenders to earn an artifact and hero experience. Stock grows over time and defenders replenish unpredictably.',true,'gnome'),
(1046,'Human · Spartan raider camp',9664,-11200,5,'desert',128,39,4,'Level 5 camp. Raid its stored supplies and defeat its defenders to earn an artifact and hero experience. Stock grows over time and defenders replenish unpredictably.',true,'spartan'),
(1047,'Gnomes raider camp',9792,-10816,4,'desert',54,41,25,'Level 4 camp. Raid its stored supplies and defeat its defenders to earn an artifact and hero experience. Stock grows over time and defenders replenish unpredictably.',true,'gnome'),
(1048,'Orcs raider camp',11072,-11712,5,'desert',113,66,12,'Level 5 camp. Raid its stored supplies and defeat its defenders to earn an artifact and hero experience. Stock grows over time and defenders replenish unpredictably.',true,'orc'),
(1049,'Gnomes outpost',12352,-10816,2,'highlands',29,17,1,'Level 2 camp. Raid its stored supplies and defeat its defenders to earn an artifact and hero experience. Stock grows over time and defenders replenish unpredictably.',true,'gnome'),
(1050,'Gnomes outpost',-12352,-10688,2,'highlands',42,8,3,'Level 2 camp. Raid its stored supplies and defeat its defenders to earn an artifact and hero experience. Stock grows over time and defenders replenish unpredictably.',true,'gnome'),
(1051,'Necropolis raider camp',-11200,-10432,3,'snow',67,15,0,'Level 3 camp. Raid its stored supplies and defeat its defenders to earn an artifact and hero experience. Stock grows over time and defenders replenish unpredictably.',true,'undead'),
(1052,'Human · Roman raider camp',-10176,-10176,4,'highlands',79,25,14,'Level 4 camp. Raid its stored supplies and defeat its defenders to earn an artifact and hero experience. Stock grows over time and defenders replenish unpredictably.',true,'roman'),
(1053,'Human · Spartan raider camp',-8896,-10688,5,'plains',72,68,53,'Level 5 camp. Raid its stored supplies and defeat its defenders to earn an artifact and hero experience. Stock grows over time and defenders replenish unpredictably.',true,'spartan'),
(1054,'Human · Spartan war camp',-7744,-10176,7,'highlands',175,122,52,'Level 7 camp. Raid its stored supplies and defeat its defenders to earn an artifact and hero experience. Stock grows over time and defenders replenish unpredictably.',true,'spartan'),
(1055,'Gnomes raider camp',-6976,-10688,4,'highlands',47,45,29,'Level 4 camp. Raid its stored supplies and defeat its defenders to earn an artifact and hero experience. Stock grows over time and defenders replenish unpredictably.',true,'gnome'),
(1056,'Human · Roman outpost',-6080,-10304,2,'highlands',31,17,2,'Level 2 camp. Raid its stored supplies and defeat its defenders to earn an artifact and hero experience. Stock grows over time and defenders replenish unpredictably.',true,'roman'),
(1057,'Human · Spartan war camp',-5568,-10432,6,'plains',92,96,64,'Level 6 camp. Raid its stored supplies and defeat its defenders to earn an artifact and hero experience. Stock grows over time and defenders replenish unpredictably.',true,'spartan'),
(1058,'Gnomes raider camp',-4288,-10176,3,'woods',47,17,17,'Level 3 camp. Raid its stored supplies and defeat its defenders to earn an artifact and hero experience. Stock grows over time and defenders replenish unpredictably.',true,'gnome'),
(1059,'Gnomes outpost',-3008,-10176,1,'highlands',16,10,2,'Level 1 camp. Raid its stored supplies and defeat its defenders to earn an artifact and hero experience. Stock grows over time and defenders replenish unpredictably.',true,'gnome'),
(1060,'Human · Spartan outpost',-1728,-10176,1,'plains',19,11,2,'Level 1 camp. Raid its stored supplies and defeat its defenders to earn an artifact and hero experience. Stock grows over time and defenders replenish unpredictably.',true,'spartan'),
(1061,'Necropolis raider camp',-576,-10176,4,'plains',53,40,19,'Level 4 camp. Raid its stored supplies and defeat its defenders to earn an artifact and hero experience. Stock grows over time and defenders replenish unpredictably.',true,'undead'),
(1062,'Necropolis raider camp',-448,-9792,3,'marsh',56,11,9,'Level 3 camp. Raid its stored supplies and defeat its defenders to earn an artifact and hero experience. Stock grows over time and defenders replenish unpredictably.',true,'undead'),
(1063,'Dwarves raider camp',832,-10688,4,'highlands',70,18,34,'Level 4 camp. Raid its stored supplies and defeat its defenders to earn an artifact and hero experience. Stock grows over time and defenders replenish unpredictably.',true,'dwarf'),
(1064,'Orcs raider camp',2112,-10560,5,'woods',138,30,26,'Level 5 camp. Raid its stored supplies and defeat its defenders to earn an artifact and hero experience. Stock grows over time and defenders replenish unpredictably.',true,'orc'),
(1065,'Orcs outpost',2624,-9920,1,'marsh',27,5,0,'Level 1 camp. Raid its stored supplies and defeat its defenders to earn an artifact and hero experience. Stock grows over time and defenders replenish unpredictably.',true,'orc'),
(1066,'Demons raider camp',4160,-10176,3,'plains',33,33,19,'Level 3 camp. Raid its stored supplies and defeat its defenders to earn an artifact and hero experience. Stock grows over time and defenders replenish unpredictably.',true,'demon'),
(1067,'Human · Spartan raider camp',5184,-9920,4,'highlands',97,21,4,'Level 4 camp. Raid its stored supplies and defeat its defenders to earn an artifact and hero experience. Stock grows over time and defenders replenish unpredictably.',true,'spartan'),
(1068,'Human · Egyptian raider camp',6336,-10688,5,'desert',114,35,27,'Level 5 camp. Raid its stored supplies and defeat its defenders to earn an artifact and hero experience. Stock grows over time and defenders replenish unpredictably.',true,'egyptian'),
(1069,'Human · Spartan outpost',7232,-9792,2,'plains',44,9,0,'Level 2 camp. Raid its stored supplies and defeat its defenders to earn an artifact and hero experience. Stock grows over time and defenders replenish unpredictably.',true,'spartan'),
(1070,'Necropolis raider camp',8512,-10688,3,'highlands',52,13,12,'Level 3 camp. Raid its stored supplies and defeat its defenders to earn an artifact and hero experience. Stock grows over time and defenders replenish unpredictably.',true,'undead'),
(1071,'Gnomes outpost',9280,-10176,1,'highlands',18,9,1,'Level 1 camp. Raid its stored supplies and defeat its defenders to earn an artifact and hero experience. Stock grows over time and defenders replenish unpredictably.',true,'gnome'),
(1072,'Elves war camp',10304,-10048,6,'highlands',153,69,30,'Level 6 camp. Raid its stored supplies and defeat its defenders to earn an artifact and hero experience. Stock grows over time and defenders replenish unpredictably.',true,'elf'),
(1073,'Orcs outpost',10816,-10176,2,'highlands',29,16,2,'Level 2 camp. Raid its stored supplies and defeat its defenders to earn an artifact and hero experience. Stock grows over time and defenders replenish unpredictably.',true,'orc'),
(1074,'Dwarves raider camp',11840,-9920,3,'highlands',32,32,20,'Level 3 camp. Raid its stored supplies and defeat its defenders to earn an artifact and hero experience. Stock grows over time and defenders replenish unpredictably.',true,'dwarf'),
(1075,'Pandaren raider camp',-12608,-9664,4,'highlands',95,20,7,'Level 4 camp. Raid its stored supplies and defeat its defenders to earn an artifact and hero experience. Stock grows over time and defenders replenish unpredictably.',true,'pandaren'),
(1076,'Gnomes outpost',-11200,-9536,2,'plains',31,19,1,'Level 2 camp. Raid its stored supplies and defeat its defenders to earn an artifact and hero experience. Stock grows over time and defenders replenish unpredictably.',true,'gnome'),
(1077,'Demons outpost',-10688,-9408,1,'desert',20,6,2,'Level 1 camp. Raid its stored supplies and defeat its defenders to earn an artifact and hero experience. Stock grows over time and defenders replenish unpredictably.',true,'demon'),
(1078,'Necropolis outpost',-9280,-9664,2,'snow',36,10,3,'Level 2 camp. Raid its stored supplies and defeat its defenders to earn an artifact and hero experience. Stock grows over time and defenders replenish unpredictably.',true,'undead'),
(1079,'Dwarves raider camp',-8128,-9536,3,'highlands',62,17,4,'Level 3 camp. Raid its stored supplies and defeat its defenders to earn an artifact and hero experience. Stock grows over time and defenders replenish unpredictably.',true,'dwarf'),
(1080,'Pandaren outpost',-7104,-9152,2,'snow',33,15,0,'Level 2 camp. Raid its stored supplies and defeat its defenders to earn an artifact and hero experience. Stock grows over time and defenders replenish unpredictably.',true,'pandaren'),
(1081,'Human · Roman raider camp',-6080,-8896,3,'snow',38,26,10,'Level 3 camp. Raid its stored supplies and defeat its defenders to earn an artifact and hero experience. Stock grows over time and defenders replenish unpredictably.',true,'roman'),
(1082,'Human · Persian raider camp',-4928,-9664,4,'highlands',46,48,32,'Level 4 camp. Raid its stored supplies and defeat its defenders to earn an artifact and hero experience. Stock grows over time and defenders replenish unpredictably.',true,'persian'),
(1083,'Human · Persian outpost',-4032,-9664,2,'marsh',30,18,0,'Level 2 camp. Raid its stored supplies and defeat its defenders to earn an artifact and hero experience. Stock grows over time and defenders replenish unpredictably.',true,'persian'),
(1084,'Elves war camp',-3520,-9536,6,'marsh',179,43,52,'Level 6 camp. Raid its stored supplies and defeat its defenders to earn an artifact and hero experience. Stock grows over time and defenders replenish unpredictably.',true,'elf'),
(1085,'Human · Roman outpost',-1728,-9664,2,'plains',35,10,1,'Level 2 camp. Raid its stored supplies and defeat its defenders to earn an artifact and hero experience. Stock grows over time and defenders replenish unpredictably.',true,'roman'),
(1086,'Human · Roman outpost',-1472,-9024,1,'highlands',25,4,0,'Level 1 camp. Raid its stored supplies and defeat its defenders to earn an artifact and hero experience. Stock grows over time and defenders replenish unpredictably.',true,'roman'),
(1087,'Human · Persian outpost',-448,-9280,2,'plains',33,14,3,'Level 2 camp. Raid its stored supplies and defeat its defenders to earn an artifact and hero experience. Stock grows over time and defenders replenish unpredictably.',true,'persian'),
(1088,'Orcs outpost',576,-8896,2,'plains',33,15,0,'Level 2 camp. Raid its stored supplies and defeat its defenders to earn an artifact and hero experience. Stock grows over time and defenders replenish unpredictably.',true,'orc'),
(1089,'Gnomes raider camp',1728,-9664,3,'plains',37,25,12,'Level 3 camp. Raid its stored supplies and defeat its defenders to earn an artifact and hero experience. Stock grows over time and defenders replenish unpredictably.',true,'gnome'),
(1090,'Elves outpost',2624,-9280,1,'plains',19,9,3,'Level 1 camp. Raid its stored supplies and defeat its defenders to earn an artifact and hero experience. Stock grows over time and defenders replenish unpredictably.',true,'elf'),
(1091,'Human · Roman raider camp',3904,-9152,5,'highlands',137,28,16,'Level 5 camp. Raid its stored supplies and defeat its defenders to earn an artifact and hero experience. Stock grows over time and defenders replenish unpredictably.',true,'roman'),
(1092,'Dwarves outpost',5184,-9280,2,'highlands',42,9,1,'Level 2 camp. Raid its stored supplies and defeat its defenders to earn an artifact and hero experience. Stock grows over time and defenders replenish unpredictably.',true,'dwarf'),
(1093,'Human · Roman outpost',6080,-9664,2,'plains',34,12,1,'Level 2 camp. Raid its stored supplies and defeat its defenders to earn an artifact and hero experience. Stock grows over time and defenders replenish unpredictably.',true,'roman'),
(1094,'Human · Roman outpost',6720,-9408,1,'highlands',24,5,3,'Level 1 camp. Raid its stored supplies and defeat its defenders to earn an artifact and hero experience. Stock grows over time and defenders replenish unpredictably.',true,'roman'),
(1095,'Necropolis outpost',8256,-8896,2,'highlands',32,14,4,'Level 2 camp. Raid its stored supplies and defeat its defenders to earn an artifact and hero experience. Stock grows over time and defenders replenish unpredictably.',true,'undead'),
(1096,'Human · Roman raider camp',9280,-9664,3,'highlands',49,23,5,'Level 3 camp. Raid its stored supplies and defeat its defenders to earn an artifact and hero experience. Stock grows over time and defenders replenish unpredictably.',true,'roman'),
(1097,'Demons raider camp',10048,-9152,5,'highlands',106,52,25,'Level 5 camp. Raid its stored supplies and defeat its defenders to earn an artifact and hero experience. Stock grows over time and defenders replenish unpredictably.',true,'demon'),
(1098,'Elves raider camp',11584,-9152,5,'highlands',63,69,55,'Level 5 camp. Raid its stored supplies and defeat its defenders to earn an artifact and hero experience. Stock grows over time and defenders replenish unpredictably.',true,'elf'),
(1099,'Orcs raider camp',12224,-9664,3,'highlands',30,29,21,'Level 3 camp. Raid its stored supplies and defeat its defenders to earn an artifact and hero experience. Stock grows over time and defenders replenish unpredictably.',true,'orc'),
(1100,'Demons raider camp',-12736,-7872,4,'darkland',50,47,27,'Level 4 camp. Raid its stored supplies and defeat its defenders to earn an artifact and hero experience. Stock grows over time and defenders replenish unpredictably.',true,'demon'),
(1102,'Human · Spartan outpost',-9920,-8640,1,'woods',22,7,2,'Level 1 camp. Raid its stored supplies and defeat its defenders to earn an artifact and hero experience. Stock grows over time and defenders replenish unpredictably.',true,'spartan'),
(1103,'Elves raider camp',-9152,-8256,3,'plains',45,26,14,'Level 3 camp. Raid its stored supplies and defeat its defenders to earn an artifact and hero experience. Stock grows over time and defenders replenish unpredictably.',true,'elf'),
(1104,'Human · Persian raider camp',-8000,-8128,4,'snow',78,36,2,'Level 4 camp. Raid its stored supplies and defeat its defenders to earn an artifact and hero experience. Stock grows over time and defenders replenish unpredictably.',true,'persian'),
(1105,'Demons raider camp',-7488,-8128,4,'snow',61,43,25,'Level 4 camp. Raid its stored supplies and defeat its defenders to earn an artifact and hero experience. Stock grows over time and defenders replenish unpredictably.',true,'demon'),
(1106,'Human · Spartan outpost',-6592,-8000,2,'highlands',31,16,1,'Level 2 camp. Raid its stored supplies and defeat its defenders to earn an artifact and hero experience. Stock grows over time and defenders replenish unpredictably.',true,'spartan'),
(1107,'Human · Egyptian raider camp',-5056,-8384,5,'plains',113,26,28,'Level 5 camp. Raid its stored supplies and defeat its defenders to earn an artifact and hero experience. Stock grows over time and defenders replenish unpredictably.',true,'egyptian'),
(1108,'Human · Persian outpost',-4032,-8640,1,'marsh',21,10,0,'Level 1 camp. Raid its stored supplies and defeat its defenders to earn an artifact and hero experience. Stock grows over time and defenders replenish unpredictably.',true,'persian'),
(1109,'Pandaren outpost',-3008,-8000,1,'snow',26,6,0,'Level 1 camp. Raid its stored supplies and defeat its defenders to earn an artifact and hero experience. Stock grows over time and defenders replenish unpredictably.',true,'pandaren'),
(1110,'Demons outpost',-1984,-7744,2,'snow',38,12,2,'Level 2 camp. Raid its stored supplies and defeat its defenders to earn an artifact and hero experience. Stock grows over time and defenders replenish unpredictably.',true,'demon'),
(1111,'Dwarves war camp',-832,-8640,7,'highlands',215,118,4,'Level 7 camp. Raid its stored supplies and defeat its defenders to earn an artifact and hero experience. Stock grows over time and defenders replenish unpredictably.',true,'dwarf'),
(1112,'Human · Egyptian raider camp',192,-8128,3,'highlands',47,22,7,'Level 3 camp. Raid its stored supplies and defeat its defenders to earn an artifact and hero experience. Stock grows over time and defenders replenish unpredictably.',true,'egyptian'),
(1113,'Demons raider camp',1088,-8000,5,'snow',83,64,39,'Level 5 camp. Raid its stored supplies and defeat its defenders to earn an artifact and hero experience. Stock grows over time and defenders replenish unpredictably.',true,'demon'),
(1114,'Human · Persian war camp',1600,-7872,7,'highlands',272,56,44,'Level 7 camp. Raid its stored supplies and defeat its defenders to earn an artifact and hero experience. Stock grows over time and defenders replenish unpredictably.',true,'persian'),
(1115,'Human · Spartan raider camp',3392,-8640,3,'marsh',56,17,7,'Level 3 camp. Raid its stored supplies and defeat its defenders to earn an artifact and hero experience. Stock grows over time and defenders replenish unpredictably.',true,'spartan'),
(1116,'Human · Spartan outpost',3648,-8000,1,'highlands',22,4,2,'Level 1 camp. Raid its stored supplies and defeat its defenders to earn an artifact and hero experience. Stock grows over time and defenders replenish unpredictably.',true,'spartan'),
(1117,'Orcs outpost',4672,-7744,2,'snow',42,10,1,'Level 2 camp. Raid its stored supplies and defeat its defenders to earn an artifact and hero experience. Stock grows over time and defenders replenish unpredictably.',true,'orc'),
(1118,'Gnomes outpost',6208,-8256,2,'snow',32,18,1,'Level 2 camp. Raid its stored supplies and defeat its defenders to earn an artifact and hero experience. Stock grows over time and defenders replenish unpredictably.',true,'gnome'),
(1119,'Pandaren raider camp',6848,-8128,3,'snow',59,20,0,'Level 3 camp. Raid its stored supplies and defeat its defenders to earn an artifact and hero experience. Stock grows over time and defenders replenish unpredictably.',true,'pandaren'),
(1120,'Orcs war camp',7872,-8128,7,'snow',251,95,3,'Level 7 camp. Raid its stored supplies and defeat its defenders to earn an artifact and hero experience. Stock grows over time and defenders replenish unpredictably.',true,'orc'),
(1121,'Human · Persian raider camp',9024,-8640,5,'snow',86,62,44,'Level 5 camp. Raid its stored supplies and defeat its defenders to earn an artifact and hero experience. Stock grows over time and defenders replenish unpredictably.',true,'persian'),
(1122,'Human · Egyptian outpost',10304,-8000,2,'highlands',33,12,2,'Level 2 camp. Raid its stored supplies and defeat its defenders to earn an artifact and hero experience. Stock grows over time and defenders replenish unpredictably.',true,'egyptian'),
(1123,'Orcs war camp',11328,-8640,8,'highlands',175,185,123,'Level 8 camp. Raid its stored supplies and defeat its defenders to earn an artifact and hero experience. Stock grows over time and defenders replenish unpredictably.',true,'orc'),
(1124,'Necropolis outpost',12352,-7744,1,'snow',22,4,2,'Level 1 camp. Raid its stored supplies and defeat its defenders to earn an artifact and hero experience. Stock grows over time and defenders replenish unpredictably.',true,'undead'),
(1127,'Orcs outpost',-10304,-7104,2,'plains',25,18,4,'Level 2 camp. Raid its stored supplies and defeat its defenders to earn an artifact and hero experience. Stock grows over time and defenders replenish unpredictably.',true,'orc'),
(1128,'Gnomes raider camp',-8896,-7616,4,'woods',66,32,15,'Level 4 camp. Raid its stored supplies and defeat its defenders to earn an artifact and hero experience. Stock grows over time and defenders replenish unpredictably.',true,'gnome'),
(1129,'Demons war camp',-7872,-7616,7,'highlands',176,92,93,'Level 7 camp. Raid its stored supplies and defeat its defenders to earn an artifact and hero experience. Stock grows over time and defenders replenish unpredictably.',true,'demon'),
(1130,'Dwarves raider camp',-7616,-6720,5,'highlands',122,27,23,'Level 5 camp. Raid its stored supplies and defeat its defenders to earn an artifact and hero experience. Stock grows over time and defenders replenish unpredictably.',true,'dwarf'),
(1131,'Human · Persian outpost',-6592,-6720,1,'plains',17,11,1,'Level 1 camp. Raid its stored supplies and defeat its defenders to earn an artifact and hero experience. Stock grows over time and defenders replenish unpredictably.',true,'persian'),
(1132,'Elves outpost',-5568,-7488,1,'marsh',22,4,2,'Level 1 camp. Raid its stored supplies and defeat its defenders to earn an artifact and hero experience. Stock grows over time and defenders replenish unpredictably.',true,'elf'),
(1133,'Gnomes outpost',-4416,-7104,2,'highlands',42,10,1,'Level 2 camp. Raid its stored supplies and defeat its defenders to earn an artifact and hero experience. Stock grows over time and defenders replenish unpredictably.',true,'gnome'),
(1134,'Dwarves outpost',-2752,-7104,2,'snow',41,9,2,'Level 2 camp. Raid its stored supplies and defeat its defenders to earn an artifact and hero experience. Stock grows over time and defenders replenish unpredictably.',true,'dwarf'),
(1135,'Human · Roman raider camp',-2368,-7616,3,'snow',49,24,11,'Level 3 camp. Raid its stored supplies and defeat its defenders to earn an artifact and hero experience. Stock grows over time and defenders replenish unpredictably.',true,'roman'),
(1136,'Elves outpost',-1472,-7104,1,'snow',21,7,2,'Level 1 camp. Raid its stored supplies and defeat its defenders to earn an artifact and hero experience. Stock grows over time and defenders replenish unpredictably.',true,'elf'),
(1137,'Demons raider camp',-448,-7232,4,'snow',94,30,5,'Level 4 camp. Raid its stored supplies and defeat its defenders to earn an artifact and hero experience. Stock grows over time and defenders replenish unpredictably.',true,'demon'),
(1138,'Gnomes outpost',1088,-6720,1,'snow',20,10,0,'Level 1 camp. Raid its stored supplies and defeat its defenders to earn an artifact and hero experience. Stock grows over time and defenders replenish unpredictably.',true,'gnome'),
(1139,'Necropolis outpost',2112,-7488,1,'snow',18,10,1,'Level 1 camp. Raid its stored supplies and defeat its defenders to earn an artifact and hero experience. Stock grows over time and defenders replenish unpredictably.',true,'undead'),
(1140,'Human · Roman outpost',2624,-7360,1,'snow',22,5,1,'Level 1 camp. Raid its stored supplies and defeat its defenders to earn an artifact and hero experience. Stock grows over time and defenders replenish unpredictably.',true,'roman'),
(1141,'Necropolis raider camp',4160,-7232,3,'plains',44,25,16,'Level 3 camp. Raid its stored supplies and defeat its defenders to earn an artifact and hero experience. Stock grows over time and defenders replenish unpredictably.',true,'undead'),
(1142,'Elves raider camp',5440,-7616,3,'snow',45,17,19,'Level 3 camp. Raid its stored supplies and defeat its defenders to earn an artifact and hero experience. Stock grows over time and defenders replenish unpredictably.',true,'elf'),
(1143,'Necropolis raider camp',6208,-7616,3,'snow',43,16,21,'Level 3 camp. Raid its stored supplies and defeat its defenders to earn an artifact and hero experience. Stock grows over time and defenders replenish unpredictably.',true,'undead'),
(1144,'Dwarves outpost',6720,-7104,2,'highlands',31,19,1,'Level 2 camp. Raid its stored supplies and defeat its defenders to earn an artifact and hero experience. Stock grows over time and defenders replenish unpredictably.',true,'dwarf'),
(1145,'Human · Spartan stronghold',7744,-6720,9,'highlands',261,198,182,'Level 9 camp. Raid its stored supplies and defeat its defenders to earn an artifact and hero experience. Stock grows over time and defenders replenish unpredictably.',true,'spartan'),
(1146,'Human · Egyptian outpost',8768,-7488,1,'snow',20,10,0,'Level 1 camp. Raid its stored supplies and defeat its defenders to earn an artifact and hero experience. Stock grows over time and defenders replenish unpredictably.',true,'egyptian'),
(1147,'Human · Egyptian war camp',10304,-7488,7,'highlands',264,84,24,'Level 7 camp. Raid its stored supplies and defeat its defenders to earn an artifact and hero experience. Stock grows over time and defenders replenish unpredictably.',true,'egyptian'),
(1148,'Human · Spartan outpost',10816,-7616,2,'highlands',34,16,2,'Level 2 camp. Raid its stored supplies and defeat its defenders to earn an artifact and hero experience. Stock grows over time and defenders replenish unpredictably.',true,'spartan'),
(1149,'Pandaren outpost',12736,-7104,1,'plains',23,7,0,'Level 1 camp. Raid its stored supplies and defeat its defenders to earn an artifact and hero experience. Stock grows over time and defenders replenish unpredictably.',true,'pandaren'),
(1150,'Elves raider camp',-12736,-5824,4,'plains',67,21,34,'Level 4 camp. Raid its stored supplies and defeat its defenders to earn an artifact and hero experience. Stock grows over time and defenders replenish unpredictably.',true,'elf'),
(1152,'Human · Roman raider camp',-10176,-5696,3,'plains',43,20,19,'Level 3 camp. Raid its stored supplies and defeat its defenders to earn an artifact and hero experience. Stock grows over time and defenders replenish unpredictably.',true,'roman'),
(1153,'Pandaren outpost',-9152,-6464,1,'woods',22,9,0,'Level 1 camp. Raid its stored supplies and defeat its defenders to earn an artifact and hero experience. Stock grows over time and defenders replenish unpredictably.',true,'pandaren'),
(1154,'Orcs outpost',-8128,-5952,2,'woods',38,11,4,'Level 2 camp. Raid its stored supplies and defeat its defenders to earn an artifact and hero experience. Stock grows over time and defenders replenish unpredictably.',true,'orc'),
(1155,'Orcs raider camp',-7360,-6080,4,'woods',68,31,26,'Level 4 camp. Raid its stored supplies and defeat its defenders to earn an artifact and hero experience. Stock grows over time and defenders replenish unpredictably.',true,'orc'),
(1156,'Orcs outpost',-5824,-6592,2,'marsh',28,18,0,'Level 2 camp. Raid its stored supplies and defeat its defenders to earn an artifact and hero experience. Stock grows over time and defenders replenish unpredictably.',true,'orc'),
(1157,'Pandaren outpost',-5056,-6080,1,'darkland',22,7,1,'Level 1 camp. Raid its stored supplies and defeat its defenders to earn an artifact and hero experience. Stock grows over time and defenders replenish unpredictably.',true,'pandaren'),
(1158,'Pandaren raider camp',-3648,-6080,4,'plains',63,24,33,'Level 4 camp. Raid its stored supplies and defeat its defenders to earn an artifact and hero experience. Stock grows over time and defenders replenish unpredictably.',true,'pandaren'),
(1159,'Pandaren outpost',-3520,-6464,1,'highlands',20,9,2,'Level 1 camp. Raid its stored supplies and defeat its defenders to earn an artifact and hero experience. Stock grows over time and defenders replenish unpredictably.',true,'pandaren'),
(1160,'Human · Persian stronghold',-2496,-6464,9,'highlands',297,151,115,'Level 9 camp. Raid its stored supplies and defeat its defenders to earn an artifact and hero experience. Stock grows over time and defenders replenish unpredictably.',true,'persian'),
(1161,'Orcs outpost',-1472,-6208,1,'snow',22,9,0,'Level 1 camp. Raid its stored supplies and defeat its defenders to earn an artifact and hero experience. Stock grows over time and defenders replenish unpredictably.',true,'orc'),
(1162,'Elves raider camp',64,-6464,4,'snow',53,33,33,'Level 4 camp. Raid its stored supplies and defeat its defenders to earn an artifact and hero experience. Stock grows over time and defenders replenish unpredictably.',true,'elf'),
(1163,'Pandaren outpost',704,-6592,2,'snow',28,17,3,'Level 2 camp. Raid its stored supplies and defeat its defenders to earn an artifact and hero experience. Stock grows over time and defenders replenish unpredictably.',true,'pandaren'),
(1164,'Human · Roman stronghold',1600,-6208,9,'snow',244,169,169,'Level 9 camp. Raid its stored supplies and defeat its defenders to earn an artifact and hero experience. Stock grows over time and defenders replenish unpredictably.',true,'roman'),
(1165,'Human · Persian raider camp',3008,-6080,4,'snow',82,21,22,'Level 4 camp. Raid its stored supplies and defeat its defenders to earn an artifact and hero experience. Stock grows over time and defenders replenish unpredictably.',true,'persian'),
(1166,'Human · Roman raider camp',4544,-6080,3,'snow',57,20,3,'Level 3 camp. Raid its stored supplies and defeat its defenders to earn an artifact and hero experience. Stock grows over time and defenders replenish unpredictably.',true,'roman'),
(1167,'Dwarves war camp',5184,-6464,7,'marsh',228,80,37,'Level 7 camp. Raid its stored supplies and defeat its defenders to earn an artifact and hero experience. Stock grows over time and defenders replenish unpredictably.',true,'dwarf'),
(1168,'Necropolis outpost',6208,-6208,1,'highlands',22,8,2,'Level 1 camp. Raid its stored supplies and defeat its defenders to earn an artifact and hero experience. Stock grows over time and defenders replenish unpredictably.',true,'undead'),
(1169,'Pandaren raider camp',6720,-6464,3,'plains',40,23,12,'Level 3 camp. Raid its stored supplies and defeat its defenders to earn an artifact and hero experience. Stock grows over time and defenders replenish unpredictably.',true,'pandaren'),
(1170,'Human · Roman outpost',8256,-5952,1,'woods',23,8,0,'Level 1 camp. Raid its stored supplies and defeat its defenders to earn an artifact and hero experience. Stock grows over time and defenders replenish unpredictably.',true,'roman'),
(1171,'Pandaren raider camp',9280,-6464,3,'highlands',60,22,4,'Level 3 camp. Raid its stored supplies and defeat its defenders to earn an artifact and hero experience. Stock grows over time and defenders replenish unpredictably.',true,'pandaren'),
(1172,'Gnomes raider camp',10560,-6080,3,'highlands',46,33,7,'Level 3 camp. Raid its stored supplies and defeat its defenders to earn an artifact and hero experience. Stock grows over time and defenders replenish unpredictably.',true,'gnome'),
(1173,'Gnomes raider camp',11456,-6592,4,'highlands',72,19,31,'Level 4 camp. Raid its stored supplies and defeat its defenders to earn an artifact and hero experience. Stock grows over time and defenders replenish unpredictably.',true,'gnome'),
(1174,'Human · Roman raider camp',11840,-6592,5,'highlands',143,35,1,'Level 5 camp. Raid its stored supplies and defeat its defenders to earn an artifact and hero experience. Stock grows over time and defenders replenish unpredictably.',true,'roman'),
(1175,'Human · Persian war camp',-12736,-5184,8,'plains',297,104,57,'Level 8 camp. Raid its stored supplies and defeat its defenders to earn an artifact and hero experience. Stock grows over time and defenders replenish unpredictably.',true,'persian'),
(1176,'Pandaren raider camp',-11712,-4928,4,'plains',52,42,31,'Level 4 camp. Raid its stored supplies and defeat its defenders to earn an artifact and hero experience. Stock grows over time and defenders replenish unpredictably.',true,'pandaren'),
(1177,'Human · Persian raider camp',-10048,-5056,5,'woods',118,63,4,'Level 5 camp. Raid its stored supplies and defeat its defenders to earn an artifact and hero experience. Stock grows over time and defenders replenish unpredictably.',true,'persian'),
(1178,'Human · Persian raider camp',-9152,-4800,4,'woods',65,38,10,'Level 4 camp. Raid its stored supplies and defeat its defenders to earn an artifact and hero experience. Stock grows over time and defenders replenish unpredictably.',true,'persian'),
(1179,'Human · Roman raider camp',-8384,-5056,3,'woods',29,26,21,'Level 3 camp. Raid its stored supplies and defeat its defenders to earn an artifact and hero experience. Stock grows over time and defenders replenish unpredictably.',true,'roman'),
(1180,'Demons war camp',-7360,-5056,7,'plains',205,123,22,'Level 7 camp. Raid its stored supplies and defeat its defenders to earn an artifact and hero experience. Stock grows over time and defenders replenish unpredictably.',true,'demon'),
(1181,'Elves raider camp',-6208,-5568,5,'plains',117,29,39,'Level 5 camp. Raid its stored supplies and defeat its defenders to earn an artifact and hero experience. Stock grows over time and defenders replenish unpredictably.',true,'elf'),
(1182,'Gnomes war camp',-5056,-5184,6,'plains',201,49,7,'Level 6 camp. Raid its stored supplies and defeat its defenders to earn an artifact and hero experience. Stock grows over time and defenders replenish unpredictably.',true,'gnome'),
(1183,'Human · Spartan outpost',-3648,-5568,2,'plains',29,18,3,'Level 2 camp. Raid its stored supplies and defeat its defenders to earn an artifact and hero experience. Stock grows over time and defenders replenish unpredictably.',true,'spartan'),
(1184,'Demons outpost',-3008,-5056,2,'desert',34,16,4,'Level 2 camp. Raid its stored supplies and defeat its defenders to earn an artifact and hero experience. Stock grows over time and defenders replenish unpredictably.',true,'demon'),
(1185,'Human · Persian war camp',-1856,-5056,7,'highlands',242,79,56,'Level 7 camp. Raid its stored supplies and defeat its defenders to earn an artifact and hero experience. Stock grows over time and defenders replenish unpredictably.',true,'persian'),
(1186,'Elves outpost',-704,-5056,2,'plains',31,15,3,'Level 2 camp. Raid its stored supplies and defeat its defenders to earn an artifact and hero experience. Stock grows over time and defenders replenish unpredictably.',true,'elf'),
(1187,'Human · Spartan raider camp',192,-5056,5,'plains',64,62,40,'Level 5 camp. Raid its stored supplies and defeat its defenders to earn an artifact and hero experience. Stock grows over time and defenders replenish unpredictably.',true,'spartan'),
(1188,'Demons raider camp',1472,-5568,4,'snow',66,48,14,'Level 4 camp. Raid its stored supplies and defeat its defenders to earn an artifact and hero experience. Stock grows over time and defenders replenish unpredictably.',true,'demon'),
(1189,'Pandaren war camp',2240,-5568,8,'snow',199,200,108,'Level 8 camp. Raid its stored supplies and defeat its defenders to earn an artifact and hero experience. Stock grows over time and defenders replenish unpredictably.',true,'pandaren'),
(1190,'Human · Egyptian war camp',2624,-4928,8,'highlands',364,88,21,'Level 8 camp. Raid its stored supplies and defeat its defenders to earn an artifact and hero experience. Stock grows over time and defenders replenish unpredictably.',true,'egyptian'),
(1191,'Human · Spartan outpost',4160,-5568,2,'highlands',27,19,4,'Level 2 camp. Raid its stored supplies and defeat its defenders to earn an artifact and hero experience. Stock grows over time and defenders replenish unpredictably.',true,'spartan'),
(1192,'Gnomes war camp',4672,-4800,7,'woods',169,86,81,'Level 7 camp. Raid its stored supplies and defeat its defenders to earn an artifact and hero experience. Stock grows over time and defenders replenish unpredictably.',true,'gnome'),
(1193,'Human · Egyptian outpost',6336,-5056,1,'desert',20,10,2,'Level 1 camp. Raid its stored supplies and defeat its defenders to earn an artifact and hero experience. Stock grows over time and defenders replenish unpredictably.',true,'egyptian'),
(1194,'Orcs raider camp',7360,-5568,4,'woods',83,26,20,'Level 4 camp. Raid its stored supplies and defeat its defenders to earn an artifact and hero experience. Stock grows over time and defenders replenish unpredictably.',true,'orc'),
(1195,'Human · Egyptian raider camp',8128,-5568,4,'woods',73,38,2,'Level 4 camp. Raid its stored supplies and defeat its defenders to earn an artifact and hero experience. Stock grows over time and defenders replenish unpredictably.',true,'egyptian'),
(1196,'Dwarves raider camp',9280,-5312,5,'highlands',96,70,25,'Level 5 camp. Raid its stored supplies and defeat its defenders to earn an artifact and hero experience. Stock grows over time and defenders replenish unpredictably.',true,'dwarf'),
(1197,'Pandaren war camp',10304,-4928,6,'highlands',161,39,65,'Level 6 camp. Raid its stored supplies and defeat its defenders to earn an artifact and hero experience. Stock grows over time and defenders replenish unpredictably.',true,'pandaren'),
(1198,'Orcs outpost',11712,-5568,1,'plains',24,4,1,'Level 1 camp. Raid its stored supplies and defeat its defenders to earn an artifact and hero experience. Stock grows over time and defenders replenish unpredictably.',true,'orc'),
(1199,'Human · Roman outpost',12352,-5568,2,'plains',36,11,1,'Level 2 camp. Raid its stored supplies and defeat its defenders to earn an artifact and hero experience. Stock grows over time and defenders replenish unpredictably.',true,'roman'),
(1200,'Elves outpost',-11840,-4544,2,'plains',37,11,0,'Level 2 camp. Raid its stored supplies and defeat its defenders to earn an artifact and hero experience. Stock grows over time and defenders replenish unpredictably.',true,'elf'),
(1201,'Dwarves raider camp',-11200,-4160,3,'plains',64,14,0,'Level 3 camp. Raid its stored supplies and defeat its defenders to earn an artifact and hero experience. Stock grows over time and defenders replenish unpredictably.',true,'dwarf'),
(1202,'Pandaren raider camp',-9792,-4544,3,'woods',38,23,17,'Level 3 camp. Raid its stored supplies and defeat its defenders to earn an artifact and hero experience. Stock grows over time and defenders replenish unpredictably.',true,'pandaren'),
(1203,'Human · Spartan outpost',-9664,-3904,1,'highlands',23,4,1,'Level 1 camp. Raid its stored supplies and defeat its defenders to earn an artifact and hero experience. Stock grows over time and defenders replenish unpredictably.',true,'spartan'),
(1204,'Human · Persian raider camp',-8640,-4032,5,'highlands',93,69,28,'Level 5 camp. Raid its stored supplies and defeat its defenders to earn an artifact and hero experience. Stock grows over time and defenders replenish unpredictably.',true,'persian'),
(1205,'Necropolis outpost',-7104,-3648,1,'woods',17,10,1,'Level 1 camp. Raid its stored supplies and defeat its defenders to earn an artifact and hero experience. Stock grows over time and defenders replenish unpredictably.',true,'undead'),
(1206,'Human · Egyptian outpost',-6080,-4544,1,'marsh',23,5,1,'Level 1 camp. Raid its stored supplies and defeat its defenders to earn an artifact and hero experience. Stock grows over time and defenders replenish unpredictably.',true,'egyptian'),
(1207,'Gnomes outpost',-5568,-4416,1,'plains',18,9,1,'Level 1 camp. Raid its stored supplies and defeat its defenders to earn an artifact and hero experience. Stock grows over time and defenders replenish unpredictably.',true,'gnome'),
(1208,'Necropolis outpost',-4544,-4288,2,'highlands',35,9,2,'Level 2 camp. Raid its stored supplies and defeat its defenders to earn an artifact and hero experience. Stock grows over time and defenders replenish unpredictably.',true,'undead'),
(1209,'Human · Persian raider camp',-3136,-4544,3,'desert',50,21,10,'Level 3 camp. Raid its stored supplies and defeat its defenders to earn an artifact and hero experience. Stock grows over time and defenders replenish unpredictably.',true,'persian'),
(1210,'Human · Egyptian raider camp',-2112,-4032,3,'desert',50,18,16,'Level 3 camp. Raid its stored supplies and defeat its defenders to earn an artifact and hero experience. Stock grows over time and defenders replenish unpredictably.',true,'egyptian'),
(1211,'Gnomes raider camp',-960,-4032,5,'highlands',104,55,9,'Level 5 camp. Raid its stored supplies and defeat its defenders to earn an artifact and hero experience. Stock grows over time and defenders replenish unpredictably.',true,'gnome'),
(1212,'Gnomes raider camp',64,-4288,3,'plains',51,28,7,'Level 3 camp. Raid its stored supplies and defeat its defenders to earn an artifact and hero experience. Stock grows over time and defenders replenish unpredictably.',true,'gnome'),
(1213,'Dwarves war camp',576,-3648,8,'plains',364,117,33,'Level 8 camp. Raid its stored supplies and defeat its defenders to earn an artifact and hero experience. Stock grows over time and defenders replenish unpredictably.',true,'dwarf'),
(1214,'Human · Egyptian outpost',1856,-4544,1,'plains',21,6,2,'Level 1 camp. Raid its stored supplies and defeat its defenders to earn an artifact and hero experience. Stock grows over time and defenders replenish unpredictably.',true,'egyptian'),
(1215,'Gnomes outpost',2624,-4416,2,'plains',38,10,0,'Level 2 camp. Raid its stored supplies and defeat its defenders to earn an artifact and hero experience. Stock grows over time and defenders replenish unpredictably.',true,'gnome'),
(1216,'Pandaren outpost',3648,-4288,1,'highlands',19,9,0,'Level 1 camp. Raid its stored supplies and defeat its defenders to earn an artifact and hero experience. Stock grows over time and defenders replenish unpredictably.',true,'pandaren'),
(1217,'Dwarves outpost',5440,-4032,2,'marsh',37,12,1,'Level 2 camp. Raid its stored supplies and defeat its defenders to earn an artifact and hero experience. Stock grows over time and defenders replenish unpredictably.',true,'dwarf'),
(1218,'Necropolis outpost',5952,-4032,2,'highlands',43,8,1,'Level 2 camp. Raid its stored supplies and defeat its defenders to earn an artifact and hero experience. Stock grows over time and defenders replenish unpredictably.',true,'undead'),
(1219,'Human · Egyptian raider camp',6720,-3776,5,'highlands',102,54,11,'Level 5 camp. Raid its stored supplies and defeat its defenders to earn an artifact and hero experience. Stock grows over time and defenders replenish unpredictably.',true,'egyptian'),
(1220,'Necropolis war camp',8256,-4160,8,'highlands',235,179,56,'Level 8 camp. Raid its stored supplies and defeat its defenders to earn an artifact and hero experience. Stock grows over time and defenders replenish unpredictably.',true,'undead'),
(1221,'Elves war camp',9408,-4544,8,'woods',284,114,44,'Level 8 camp. Raid its stored supplies and defeat its defenders to earn an artifact and hero experience. Stock grows over time and defenders replenish unpredictably.',true,'elf'),
(1222,'Orcs raider camp',10048,-4544,3,'plains',43,29,12,'Level 3 camp. Raid its stored supplies and defeat its defenders to earn an artifact and hero experience. Stock grows over time and defenders replenish unpredictably.',true,'orc'),
(1223,'Human · Roman outpost',10816,-4288,1,'plains',22,8,1,'Level 1 camp. Raid its stored supplies and defeat its defenders to earn an artifact and hero experience. Stock grows over time and defenders replenish unpredictably.',true,'roman'),
(1224,'Elves war camp',12352,-4544,8,'darkland',304,91,84,'Level 8 camp. Raid its stored supplies and defeat its defenders to earn an artifact and hero experience. Stock grows over time and defenders replenish unpredictably.',true,'elf'),
(1225,'Elves raider camp',-12224,-3136,3,'plains',40,24,15,'Level 3 camp. Raid its stored supplies and defeat its defenders to earn an artifact and hero experience. Stock grows over time and defenders replenish unpredictably.',true,'elf'),
(1226,'Gnomes raider camp',-11200,-2752,4,'woods',52,33,31,'Level 4 camp. Raid its stored supplies and defeat its defenders to earn an artifact and hero experience. Stock grows over time and defenders replenish unpredictably.',true,'gnome'),
(1227,'Demons war camp',-10048,-3520,6,'highlands',143,76,21,'Level 6 camp. Raid its stored supplies and defeat its defenders to earn an artifact and hero experience. Stock grows over time and defenders replenish unpredictably.',true,'demon'),
(1228,'Pandaren raider camp',-9664,-2624,5,'woods',81,52,52,'Level 5 camp. Raid its stored supplies and defeat its defenders to earn an artifact and hero experience. Stock grows over time and defenders replenish unpredictably.',true,'pandaren'),
(1229,'Elves war camp',-8384,-3520,7,'woods',193,97,45,'Level 7 camp. Raid its stored supplies and defeat its defenders to earn an artifact and hero experience. Stock grows over time and defenders replenish unpredictably.',true,'elf'),
(1230,'Demons outpost',-7232,-3008,2,'woods',43,10,0,'Level 2 camp. Raid its stored supplies and defeat its defenders to earn an artifact and hero experience. Stock grows over time and defenders replenish unpredictably.',true,'demon'),
(1231,'Necropolis raider camp',-6592,-3392,3,'woods',41,16,23,'Level 3 camp. Raid its stored supplies and defeat its defenders to earn an artifact and hero experience. Stock grows over time and defenders replenish unpredictably.',true,'undead'),
(1232,'Demons raider camp',-5568,-3008,3,'highlands',60,18,5,'Level 3 camp. Raid its stored supplies and defeat its defenders to earn an artifact and hero experience. Stock grows over time and defenders replenish unpredictably.',true,'demon'),
(1233,'Human · Spartan raider camp',-4544,-2752,4,'plains',69,30,21,'Level 4 camp. Raid its stored supplies and defeat its defenders to earn an artifact and hero experience. Stock grows over time and defenders replenish unpredictably.',true,'spartan'),
(1234,'Human · Egyptian raider camp',-3392,-3520,5,'highlands',75,48,50,'Level 5 camp. Raid its stored supplies and defeat its defenders to earn an artifact and hero experience. Stock grows over time and defenders replenish unpredictably.',true,'egyptian'),
(1235,'Demons raider camp',-1984,-2624,4,'highlands',62,36,19,'Level 4 camp. Raid its stored supplies and defeat its defenders to earn an artifact and hero experience. Stock grows over time and defenders replenish unpredictably.',true,'demon'),
(1236,'Pandaren raider camp',-704,-3520,5,'plains',125,59,3,'Level 5 camp. Raid its stored supplies and defeat its defenders to earn an artifact and hero experience. Stock grows over time and defenders replenish unpredictably.',true,'pandaren'),
(1237,'Dwarves war camp',-448,-2880,6,'woods',160,62,29,'Level 6 camp. Raid its stored supplies and defeat its defenders to earn an artifact and hero experience. Stock grows over time and defenders replenish unpredictably.',true,'dwarf'),
(1238,'Human · Spartan raider camp',1088,-2880,5,'woods',123,44,8,'Level 5 camp. Raid its stored supplies and defeat its defenders to earn an artifact and hero experience. Stock grows over time and defenders replenish unpredictably.',true,'spartan'),
(1239,'Orcs outpost',1984,-3008,2,'plains',40,10,4,'Level 2 camp. Raid its stored supplies and defeat its defenders to earn an artifact and hero experience. Stock grows over time and defenders replenish unpredictably.',true,'orc'),
(1240,'Dwarves raider camp',3136,-2752,3,'plains',60,17,6,'Level 3 camp. Raid its stored supplies and defeat its defenders to earn an artifact and hero experience. Stock grows over time and defenders replenish unpredictably.',true,'dwarf'),
(1241,'Pandaren raider camp',4288,-3520,4,'plains',67,29,23,'Level 4 camp. Raid its stored supplies and defeat its defenders to earn an artifact and hero experience. Stock grows over time and defenders replenish unpredictably.',true,'pandaren'),
(1242,'Human · Roman raider camp',4800,-3008,5,'plains',96,47,27,'Level 5 camp. Raid its stored supplies and defeat its defenders to earn an artifact and hero experience. Stock grows over time and defenders replenish unpredictably.',true,'roman'),
(1243,'Demons outpost',6208,-3008,2,'highlands',40,11,1,'Level 2 camp. Raid its stored supplies and defeat its defenders to earn an artifact and hero experience. Stock grows over time and defenders replenish unpredictably.',true,'demon'),
(1244,'Gnomes raider camp',7104,-3520,5,'highlands',113,65,10,'Level 5 camp. Raid its stored supplies and defeat its defenders to earn an artifact and hero experience. Stock grows over time and defenders replenish unpredictably.',true,'gnome'),
(1245,'Orcs war camp',8256,-3392,6,'marsh',110,86,51,'Level 6 camp. Raid its stored supplies and defeat its defenders to earn an artifact and hero experience. Stock grows over time and defenders replenish unpredictably.',true,'orc'),
(1246,'Pandaren outpost',9664,-3008,2,'plains',27,19,2,'Level 2 camp. Raid its stored supplies and defeat its defenders to earn an artifact and hero experience. Stock grows over time and defenders replenish unpredictably.',true,'pandaren'),
(1247,'Demons war camp',10688,-3520,6,'plains',152,53,65,'Level 6 camp. Raid its stored supplies and defeat its defenders to earn an artifact and hero experience. Stock grows over time and defenders replenish unpredictably.',true,'demon'),
(1248,'Human · Egyptian outpost',11584,-3008,2,'woods',40,10,0,'Level 2 camp. Raid its stored supplies and defeat its defenders to earn an artifact and hero experience. Stock grows over time and defenders replenish unpredictably.',true,'egyptian'),
(1250,'Human · Spartan raider camp',-12224,-1600,3,'plains',42,27,6,'Level 3 camp. Raid its stored supplies and defeat its defenders to earn an artifact and hero experience. Stock grows over time and defenders replenish unpredictably.',true,'spartan'),
(1251,'Elves war camp',-10816,-1984,7,'plains',231,143,3,'Level 7 camp. Raid its stored supplies and defeat its defenders to earn an artifact and hero experience. Stock grows over time and defenders replenish unpredictably.',true,'elf'),
(1252,'Gnomes raider camp',-10688,-2368,5,'plains',102,71,17,'Level 5 camp. Raid its stored supplies and defeat its defenders to earn an artifact and hero experience. Stock grows over time and defenders replenish unpredictably.',true,'gnome'),
(1253,'Demons outpost',-9152,-1728,2,'woods',40,8,3,'Level 2 camp. Raid its stored supplies and defeat its defenders to earn an artifact and hero experience. Stock grows over time and defenders replenish unpredictably.',true,'demon'),
(1254,'Orcs outpost',-8128,-1728,2,'woods',27,18,2,'Level 2 camp. Raid its stored supplies and defeat its defenders to earn an artifact and hero experience. Stock grows over time and defenders replenish unpredictably.',true,'orc'),
(1255,'Gnomes raider camp',-7104,-2496,3,'highlands',46,14,25,'Level 3 camp. Raid its stored supplies and defeat its defenders to earn an artifact and hero experience. Stock grows over time and defenders replenish unpredictably.',true,'gnome'),
(1256,'Human · Egyptian war camp',-6336,-1984,7,'highlands',279,72,33,'Level 7 camp. Raid its stored supplies and defeat its defenders to earn an artifact and hero experience. Stock grows over time and defenders replenish unpredictably.',true,'egyptian'),
(1257,'Human · Roman war camp',-4928,-1984,6,'woods',138,60,58,'Level 6 camp. Raid its stored supplies and defeat its defenders to earn an artifact and hero experience. Stock grows over time and defenders replenish unpredictably.',true,'roman'),
(1258,'Elves outpost',-4160,-2496,2,'highlands',32,20,0,'Level 2 camp. Raid its stored supplies and defeat its defenders to earn an artifact and hero experience. Stock grows over time and defenders replenish unpredictably.',true,'elf'),
(1259,'Necropolis raider camp',-3136,-2496,3,'highlands',47,12,21,'Level 3 camp. Raid its stored supplies and defeat its defenders to earn an artifact and hero experience. Stock grows over time and defenders replenish unpredictably.',true,'undead'),
(1260,'Orcs outpost',-1600,-2496,2,'woods',39,7,4,'Level 2 camp. Raid its stored supplies and defeat its defenders to earn an artifact and hero experience. Stock grows over time and defenders replenish unpredictably.',true,'orc'),
(1261,'Necropolis outpost',-1472,-1728,2,'plains',31,17,1,'Level 2 camp. Raid its stored supplies and defeat its defenders to earn an artifact and hero experience. Stock grows over time and defenders replenish unpredictably.',true,'undead'),
(1262,'Human · Roman raider camp',-448,-2496,3,'woods',31,29,15,'Level 3 camp. Raid its stored supplies and defeat its defenders to earn an artifact and hero experience. Stock grows over time and defenders replenish unpredictably.',true,'roman'),
(1263,'Necropolis outpost',832,-1984,1,'woods',22,4,2,'Level 1 camp. Raid its stored supplies and defeat its defenders to earn an artifact and hero experience. Stock grows over time and defenders replenish unpredictably.',true,'undead'),
(1264,'Elves raider camp',1728,-1984,5,'woods',124,36,24,'Level 5 camp. Raid its stored supplies and defeat its defenders to earn an artifact and hero experience. Stock grows over time and defenders replenish unpredictably.',true,'elf'),
(1265,'Pandaren outpost',2624,-2496,1,'woods',25,5,1,'Level 1 camp. Raid its stored supplies and defeat its defenders to earn an artifact and hero experience. Stock grows over time and defenders replenish unpredictably.',true,'pandaren'),
(1266,'Human · Spartan outpost',4544,-2496,2,'plains',38,8,2,'Level 2 camp. Raid its stored supplies and defeat its defenders to earn an artifact and hero experience. Stock grows over time and defenders replenish unpredictably.',true,'spartan'),
(1267,'Dwarves outpost',5440,-1984,1,'woods',16,10,2,'Level 1 camp. Raid its stored supplies and defeat its defenders to earn an artifact and hero experience. Stock grows over time and defenders replenish unpredictably.',true,'dwarf'),
(1268,'Demons outpost',6208,-1856,1,'plains',18,10,2,'Level 1 camp. Raid its stored supplies and defeat its defenders to earn an artifact and hero experience. Stock grows over time and defenders replenish unpredictably.',true,'demon'),
(1269,'Elves outpost',7232,-2496,2,'woods',31,17,1,'Level 2 camp. Raid its stored supplies and defeat its defenders to earn an artifact and hero experience. Stock grows over time and defenders replenish unpredictably.',true,'elf'),
(1270,'Human · Spartan war camp',8384,-1984,8,'plains',315,97,86,'Level 8 camp. Raid its stored supplies and defeat its defenders to earn an artifact and hero experience. Stock grows over time and defenders replenish unpredictably.',true,'spartan'),
(1271,'Demons raider camp',9408,-1984,4,'plains',103,20,4,'Level 4 camp. Raid its stored supplies and defeat its defenders to earn an artifact and hero experience. Stock grows over time and defenders replenish unpredictably.',true,'demon'),
(1272,'Elves outpost',10304,-2368,1,'plains',23,8,0,'Level 1 camp. Raid its stored supplies and defeat its defenders to earn an artifact and hero experience. Stock grows over time and defenders replenish unpredictably.',true,'elf'),
(1273,'Human · Persian outpost',10816,-2112,2,'plains',35,17,1,'Level 2 camp. Raid its stored supplies and defeat its defenders to earn an artifact and hero experience. Stock grows over time and defenders replenish unpredictably.',true,'persian'),
(1275,'Gnomes outpost',-11968,-960,2,'plains',35,11,1,'Level 2 camp. Raid its stored supplies and defeat its defenders to earn an artifact and hero experience. Stock grows over time and defenders replenish unpredictably.',true,'gnome'),
(1276,'Demons outpost',-11712,-576,2,'plains',35,16,0,'Level 2 camp. Raid its stored supplies and defeat its defenders to earn an artifact and hero experience. Stock grows over time and defenders replenish unpredictably.',true,'demon'),
(1277,'Human · Spartan raider camp',-10688,-1216,3,'woods',42,27,9,'Level 3 camp. Raid its stored supplies and defeat its defenders to earn an artifact and hero experience. Stock grows over time and defenders replenish unpredictably.',true,'spartan'),
(1278,'Human · Egyptian raider camp',-9536,-960,4,'woods',44,42,26,'Level 4 camp. Raid its stored supplies and defeat its defenders to earn an artifact and hero experience. Stock grows over time and defenders replenish unpredictably.',true,'egyptian'),
(1279,'Necropolis outpost',-8128,-832,1,'woods',22,6,0,'Level 1 camp. Raid its stored supplies and defeat its defenders to earn an artifact and hero experience. Stock grows over time and defenders replenish unpredictably.',true,'undead'),
(1280,'Dwarves outpost',-7104,-1344,2,'woods',42,8,2,'Level 2 camp. Raid its stored supplies and defeat its defenders to earn an artifact and hero experience. Stock grows over time and defenders replenish unpredictably.',true,'dwarf'),
(1281,'Human · Egyptian outpost',-5696,-1472,2,'highlands',41,12,1,'Level 2 camp. Raid its stored supplies and defeat its defenders to earn an artifact and hero experience. Stock grows over time and defenders replenish unpredictably.',true,'egyptian'),
(1282,'Human · Egyptian outpost',-5568,-1088,2,'woods',30,19,3,'Level 2 camp. Raid its stored supplies and defeat its defenders to earn an artifact and hero experience. Stock grows over time and defenders replenish unpredictably.',true,'egyptian'),
(1283,'Orcs outpost',-4032,-576,2,'plains',35,14,3,'Level 2 camp. Raid its stored supplies and defeat its defenders to earn an artifact and hero experience. Stock grows over time and defenders replenish unpredictably.',true,'orc'),
(1284,'Dwarves outpost',-3008,-1216,2,'desert',35,15,0,'Level 2 camp. Raid its stored supplies and defeat its defenders to earn an artifact and hero experience. Stock grows over time and defenders replenish unpredictably.',true,'dwarf'),
(1285,'Pandaren raider camp',-1856,-960,3,'desert',41,26,10,'Level 3 camp. Raid its stored supplies and defeat its defenders to earn an artifact and hero experience. Stock grows over time and defenders replenish unpredictably.',true,'pandaren'),
(1286,'Necropolis outpost',-1472,-576,2,'plains',33,16,4,'Level 2 camp. Raid its stored supplies and defeat its defenders to earn an artifact and hero experience. Stock grows over time and defenders replenish unpredictably.',true,'undead'),
(1287,'Human · Persian raider camp',320,-1472,5,'highlands',147,28,13,'Level 5 camp. Raid its stored supplies and defeat its defenders to earn an artifact and hero experience. Stock grows over time and defenders replenish unpredictably.',true,'persian'),
(1288,'Dwarves raider camp',1088,-1344,3,'plains',61,23,0,'Level 3 camp. Raid its stored supplies and defeat its defenders to earn an artifact and hero experience. Stock grows over time and defenders replenish unpredictably.',true,'dwarf'),
(1289,'Human · Egyptian outpost',2112,-1472,2,'plains',39,14,1,'Level 2 camp. Raid its stored supplies and defeat its defenders to earn an artifact and hero experience. Stock grows over time and defenders replenish unpredictably.',true,'egyptian'),
(1290,'Pandaren outpost',2624,-576,1,'highlands',21,6,1,'Level 1 camp. Raid its stored supplies and defeat its defenders to earn an artifact and hero experience. Stock grows over time and defenders replenish unpredictably.',true,'pandaren'),
(1291,'Human · Roman outpost',3648,-1344,2,'highlands',35,14,3,'Level 2 camp. Raid its stored supplies and defeat its defenders to earn an artifact and hero experience. Stock grows over time and defenders replenish unpredictably.',true,'roman'),
(1292,'Human · Persian raider camp',4800,-960,3,'plains',53,24,3,'Level 3 camp. Raid its stored supplies and defeat its defenders to earn an artifact and hero experience. Stock grows over time and defenders replenish unpredictably.',true,'persian'),
(1293,'Human · Persian raider camp',6080,-960,5,'highlands',107,51,23,'Level 5 camp. Raid its stored supplies and defeat its defenders to earn an artifact and hero experience. Stock grows over time and defenders replenish unpredictably.',true,'persian'),
(1294,'Gnomes raider camp',6976,-1472,5,'plains',60,61,45,'Level 5 camp. Raid its stored supplies and defeat its defenders to earn an artifact and hero experience. Stock grows over time and defenders replenish unpredictably.',true,'gnome'),
(1295,'Elves outpost',8000,-960,1,'plains',16,11,2,'Level 1 camp. Raid its stored supplies and defeat its defenders to earn an artifact and hero experience. Stock grows over time and defenders replenish unpredictably.',true,'elf'),
(1296,'Elves outpost',8768,-576,1,'plains',19,9,3,'Level 1 camp. Raid its stored supplies and defeat its defenders to earn an artifact and hero experience. Stock grows over time and defenders replenish unpredictably.',true,'elf'),
(1297,'Elves war camp',9792,-960,7,'plains',276,58,25,'Level 7 camp. Raid its stored supplies and defeat its defenders to earn an artifact and hero experience. Stock grows over time and defenders replenish unpredictably.',true,'elf'),
(1298,'Elves outpost',11328,-1344,2,'plains',33,11,2,'Level 2 camp. Raid its stored supplies and defeat its defenders to earn an artifact and hero experience. Stock grows over time and defenders replenish unpredictably.',true,'elf'),
(1299,'Gnomes outpost',12480,-960,2,'plains',34,14,4,'Level 2 camp. Raid its stored supplies and defeat its defenders to earn an artifact and hero experience. Stock grows over time and defenders replenish unpredictably.',true,'gnome'),
(1300,'Elves raider camp',-11968,64,4,'highlands',78,35,1,'Level 4 camp. Raid its stored supplies and defeat its defenders to earn an artifact and hero experience. Stock grows over time and defenders replenish unpredictably.',true,'elf'),
(1301,'Human · Roman raider camp',-10944,-448,4,'plains',57,38,20,'Level 4 camp. Raid its stored supplies and defeat its defenders to earn an artifact and hero experience. Stock grows over time and defenders replenish unpredictably.',true,'roman'),
(1302,'Pandaren outpost',-10688,64,1,'plains',18,8,2,'Level 1 camp. Raid its stored supplies and defeat its defenders to earn an artifact and hero experience. Stock grows over time and defenders replenish unpredictably.',true,'pandaren'),
(1303,'Pandaren outpost',-9152,64,1,'desert',26,4,2,'Level 1 camp. Raid its stored supplies and defeat its defenders to earn an artifact and hero experience. Stock grows over time and defenders replenish unpredictably.',true,'pandaren'),
(1304,'Elves outpost',-8000,-448,1,'woods',21,10,0,'Level 1 camp. Raid its stored supplies and defeat its defenders to earn an artifact and hero experience. Stock grows over time and defenders replenish unpredictably.',true,'elf'),
(1305,'Necropolis outpost',-7616,-320,1,'woods',24,5,0,'Level 1 camp. Raid its stored supplies and defeat its defenders to earn an artifact and hero experience. Stock grows over time and defenders replenish unpredictably.',true,'undead'),
(1306,'Human · Spartan outpost',-6592,-64,2,'highlands',40,12,2,'Level 2 camp. Raid its stored supplies and defeat its defenders to earn an artifact and hero experience. Stock grows over time and defenders replenish unpredictably.',true,'spartan'),
(1307,'Necropolis raider camp',-5568,-192,5,'woods',97,62,17,'Level 5 camp. Raid its stored supplies and defeat its defenders to earn an artifact and hero experience. Stock grows over time and defenders replenish unpredictably.',true,'undead'),
(1308,'Elves raider camp',-4032,64,3,'desert',48,26,3,'Level 3 camp. Raid its stored supplies and defeat its defenders to earn an artifact and hero experience. Stock grows over time and defenders replenish unpredictably.',true,'elf'),
(1309,'Orcs raider camp',-3520,-64,4,'desert',42,44,36,'Level 4 camp. Raid its stored supplies and defeat its defenders to earn an artifact and hero experience. Stock grows over time and defenders replenish unpredictably.',true,'orc'),
(1310,'Demons war camp',-2112,64,6,'woods',179,99,1,'Level 6 camp. Raid its stored supplies and defeat its defenders to earn an artifact and hero experience. Stock grows over time and defenders replenish unpredictably.',true,'demon'),
(1311,'Gnomes war camp',-1472,448,8,'woods',207,167,99,'Level 8 camp. Raid its stored supplies and defeat its defenders to earn an artifact and hero experience. Stock grows over time and defenders replenish unpredictably.',true,'gnome'),
(1312,'Human · Egyptian outpost',64,-320,1,'highlands',23,5,2,'Level 1 camp. Raid its stored supplies and defeat its defenders to earn an artifact and hero experience. Stock grows over time and defenders replenish unpredictably.',true,'egyptian'),
(1313,'Human · Persian outpost',1088,-192,1,'highlands',16,10,2,'Level 1 camp. Raid its stored supplies and defeat its defenders to earn an artifact and hero experience. Stock grows over time and defenders replenish unpredictably.',true,'persian'),
(1314,'Human · Persian raider camp',2112,320,5,'highlands',116,49,12,'Level 5 camp. Raid its stored supplies and defeat its defenders to earn an artifact and hero experience. Stock grows over time and defenders replenish unpredictably.',true,'persian'),
(1315,'Demons raider camp',3264,-448,3,'highlands',39,21,22,'Level 3 camp. Raid its stored supplies and defeat its defenders to earn an artifact and hero experience. Stock grows over time and defenders replenish unpredictably.',true,'demon'),
(1316,'Human · Egyptian war camp',4032,64,7,'plains',186,110,51,'Level 7 camp. Raid its stored supplies and defeat its defenders to earn an artifact and hero experience. Stock grows over time and defenders replenish unpredictably.',true,'egyptian'),
(1317,'Human · Egyptian raider camp',5568,64,5,'woods',82,54,35,'Level 5 camp. Raid its stored supplies and defeat its defenders to earn an artifact and hero experience. Stock grows over time and defenders replenish unpredictably.',true,'egyptian'),
(1318,'Demons raider camp',6208,448,5,'plains',90,63,15,'Level 5 camp. Raid its stored supplies and defeat its defenders to earn an artifact and hero experience. Stock grows over time and defenders replenish unpredictably.',true,'demon'),
(1319,'Pandaren outpost',6720,-320,1,'plains',19,11,1,'Level 1 camp. Raid its stored supplies and defeat its defenders to earn an artifact and hero experience. Stock grows over time and defenders replenish unpredictably.',true,'pandaren'),
(1320,'Demons outpost',7744,-64,1,'plains',24,4,2,'Level 1 camp. Raid its stored supplies and defeat its defenders to earn an artifact and hero experience. Stock grows over time and defenders replenish unpredictably.',true,'demon'),
(1321,'Human · Roman war camp',9280,448,8,'plains',271,118,123,'Level 8 camp. Raid its stored supplies and defeat its defenders to earn an artifact and hero experience. Stock grows over time and defenders replenish unpredictably.',true,'roman'),
(1322,'Orcs outpost',9920,-448,2,'plains',39,11,3,'Level 2 camp. Raid its stored supplies and defeat its defenders to earn an artifact and hero experience. Stock grows over time and defenders replenish unpredictably.',true,'orc'),
(1323,'Gnomes outpost',11328,64,2,'plains',29,21,4,'Level 2 camp. Raid its stored supplies and defeat its defenders to earn an artifact and hero experience. Stock grows over time and defenders replenish unpredictably.',true,'gnome'),
(1324,'Pandaren raider camp',12096,64,4,'highlands',72,33,13,'Level 4 camp. Raid its stored supplies and defeat its defenders to earn an artifact and hero experience. Stock grows over time and defenders replenish unpredictably.',true,'pandaren'),
(1325,'Demons outpost',-11968,576,1,'plains',19,11,2,'Level 1 camp. Raid its stored supplies and defeat its defenders to earn an artifact and hero experience. Stock grows over time and defenders replenish unpredictably.',true,'demon'),
(1326,'Orcs outpost',-11584,576,1,'plains',17,10,1,'Level 1 camp. Raid its stored supplies and defeat its defenders to earn an artifact and hero experience. Stock grows over time and defenders replenish unpredictably.',true,'orc'),
(1327,'Orcs outpost',-10176,960,1,'plains',19,11,1,'Level 1 camp. Raid its stored supplies and defeat its defenders to earn an artifact and hero experience. Stock grows over time and defenders replenish unpredictably.',true,'orc'),
(1328,'Orcs outpost',-9152,704,1,'woods',26,5,1,'Level 1 camp. Raid its stored supplies and defeat its defenders to earn an artifact and hero experience. Stock grows over time and defenders replenish unpredictably.',true,'orc'),
(1329,'Pandaren outpost',-8000,576,2,'plains',38,8,1,'Level 2 camp. Raid its stored supplies and defeat its defenders to earn an artifact and hero experience. Stock grows over time and defenders replenish unpredictably.',true,'pandaren'),
(1330,'Necropolis outpost',-7616,1088,2,'highlands',41,8,2,'Level 2 camp. Raid its stored supplies and defeat its defenders to earn an artifact and hero experience. Stock grows over time and defenders replenish unpredictably.',true,'undead'),
(1331,'Human · Persian raider camp',-5824,1088,4,'desert',92,30,1,'Level 4 camp. Raid its stored supplies and defeat its defenders to earn an artifact and hero experience. Stock grows over time and defenders replenish unpredictably.',true,'persian'),
(1332,'Orcs outpost',-5184,1088,1,'woods',20,9,1,'Level 1 camp. Raid its stored supplies and defeat its defenders to earn an artifact and hero experience. Stock grows over time and defenders replenish unpredictably.',true,'orc'),
(1333,'Human · Spartan raider camp',-4032,1472,4,'woods',102,23,1,'Level 4 camp. Raid its stored supplies and defeat its defenders to earn an artifact and hero experience. Stock grows over time and defenders replenish unpredictably.',true,'spartan'),
(1334,'Necropolis outpost',-3520,960,1,'plains',22,10,0,'Level 1 camp. Raid its stored supplies and defeat its defenders to earn an artifact and hero experience. Stock grows over time and defenders replenish unpredictably.',true,'undead'),
(1335,'Human · Roman outpost',-2496,1216,1,'woods',19,11,1,'Level 1 camp. Raid its stored supplies and defeat its defenders to earn an artifact and hero experience. Stock grows over time and defenders replenish unpredictably.',true,'roman'),
(1336,'Dwarves outpost',-960,832,1,'plains',18,8,2,'Level 1 camp. Raid its stored supplies and defeat its defenders to earn an artifact and hero experience. Stock grows over time and defenders replenish unpredictably.',true,'dwarf'),
(1337,'Human · Egyptian outpost',-448,704,1,'plains',21,6,1,'Level 1 camp. Raid its stored supplies and defeat its defenders to earn an artifact and hero experience. Stock grows over time and defenders replenish unpredictably.',true,'egyptian'),
(1338,'Gnomes raider camp',832,1088,3,'plains',49,18,18,'Level 3 camp. Raid its stored supplies and defeat its defenders to earn an artifact and hero experience. Stock grows over time and defenders replenish unpredictably.',true,'gnome'),
(1339,'Human · Spartan outpost',2112,960,1,'highlands',21,5,2,'Level 1 camp. Raid its stored supplies and defeat its defenders to earn an artifact and hero experience. Stock grows over time and defenders replenish unpredictably.',true,'spartan'),
(1340,'Human · Roman war camp',3008,576,6,'highlands',148,69,37,'Level 6 camp. Raid its stored supplies and defeat its defenders to earn an artifact and hero experience. Stock grows over time and defenders replenish unpredictably.',true,'roman'),
(1341,'Human · Persian stronghold',4160,960,9,'highlands',247,174,149,'Level 9 camp. Raid its stored supplies and defeat its defenders to earn an artifact and hero experience. Stock grows over time and defenders replenish unpredictably.',true,'persian'),
(1342,'Elves outpost',5184,1216,1,'plains',22,10,0,'Level 1 camp. Raid its stored supplies and defeat its defenders to earn an artifact and hero experience. Stock grows over time and defenders replenish unpredictably.',true,'elf'),
(1343,'Gnomes outpost',6208,1344,2,'plains',26,17,4,'Level 2 camp. Raid its stored supplies and defeat its defenders to earn an artifact and hero experience. Stock grows over time and defenders replenish unpredictably.',true,'gnome'),
(1344,'Gnomes war camp',6720,832,6,'highlands',203,66,12,'Level 6 camp. Raid its stored supplies and defeat its defenders to earn an artifact and hero experience. Stock grows over time and defenders replenish unpredictably.',true,'gnome'),
(1345,'Human · Roman raider camp',8512,1088,3,'woods',53,13,9,'Level 3 camp. Raid its stored supplies and defeat its defenders to earn an artifact and hero experience. Stock grows over time and defenders replenish unpredictably.',true,'roman'),
(1346,'Dwarves raider camp',8768,704,4,'plains',41,43,27,'Level 4 camp. Raid its stored supplies and defeat its defenders to earn an artifact and hero experience. Stock grows over time and defenders replenish unpredictably.',true,'dwarf'),
(1347,'Elves raider camp',10688,576,5,'plains',130,43,9,'Level 5 camp. Raid its stored supplies and defeat its defenders to earn an artifact and hero experience. Stock grows over time and defenders replenish unpredictably.',true,'elf'),
(1348,'Gnomes war camp',10816,960,7,'plains',199,94,57,'Level 7 camp. Raid its stored supplies and defeat its defenders to earn an artifact and hero experience. Stock grows over time and defenders replenish unpredictably.',true,'gnome'),
(1349,'Necropolis outpost',11840,1216,1,'plains',18,8,2,'Level 1 camp. Raid its stored supplies and defeat its defenders to earn an artifact and hero experience. Stock grows over time and defenders replenish unpredictably.',true,'undead'),
(1350,'Pandaren raider camp',-12736,1728,5,'highlands',90,44,41,'Level 5 camp. Raid its stored supplies and defeat its defenders to earn an artifact and hero experience. Stock grows over time and defenders replenish unpredictably.',true,'pandaren'),
(1351,'Gnomes outpost',-11200,2368,2,'woods',36,11,1,'Level 2 camp. Raid its stored supplies and defeat its defenders to earn an artifact and hero experience. Stock grows over time and defenders replenish unpredictably.',true,'gnome'),
(1352,'Elves outpost',-10432,2112,2,'highlands',30,18,0,'Level 2 camp. Raid its stored supplies and defeat its defenders to earn an artifact and hero experience. Stock grows over time and defenders replenish unpredictably.',true,'elf'),
(1353,'Human · Roman outpost',-9024,2112,1,'desert',22,7,1,'Level 1 camp. Raid its stored supplies and defeat its defenders to earn an artifact and hero experience. Stock grows over time and defenders replenish unpredictably.',true,'roman'),
(1354,'Demons raider camp',-8256,1600,4,'plains',70,25,31,'Level 4 camp. Raid its stored supplies and defeat its defenders to earn an artifact and hero experience. Stock grows over time and defenders replenish unpredictably.',true,'demon'),
(1355,'Human · Spartan raider camp',-7104,1856,5,'highlands',127,42,12,'Level 5 camp. Raid its stored supplies and defeat its defenders to earn an artifact and hero experience. Stock grows over time and defenders replenish unpredictably.',true,'spartan'),
(1356,'Human · Egyptian war camp',-6080,2240,8,'woods',258,122,84,'Level 8 camp. Raid its stored supplies and defeat its defenders to earn an artifact and hero experience. Stock grows over time and defenders replenish unpredictably.',true,'egyptian'),
(1357,'Human · Roman raider camp',-5056,1600,3,'highlands',52,24,10,'Level 3 camp. Raid its stored supplies and defeat its defenders to earn an artifact and hero experience. Stock grows over time and defenders replenish unpredictably.',true,'roman'),
(1358,'Demons war camp',-4288,2112,7,'marsh',155,124,95,'Level 7 camp. Raid its stored supplies and defeat its defenders to earn an artifact and hero experience. Stock grows over time and defenders replenish unpredictably.',true,'demon'),
(1359,'Pandaren raider camp',-3008,2368,3,'plains',33,28,18,'Level 3 camp. Raid its stored supplies and defeat its defenders to earn an artifact and hero experience. Stock grows over time and defenders replenish unpredictably.',true,'pandaren'),
(1360,'Demons raider camp',-2368,2112,5,'marsh',103,66,21,'Level 5 camp. Raid its stored supplies and defeat its defenders to earn an artifact and hero experience. Stock grows over time and defenders replenish unpredictably.',true,'demon'),
(1361,'Human · Egyptian raider camp',-576,1600,4,'highlands',76,18,17,'Level 4 camp. Raid its stored supplies and defeat its defenders to earn an artifact and hero experience. Stock grows over time and defenders replenish unpredictably.',true,'egyptian'),
(1362,'Pandaren outpost',64,2240,1,'plains',20,9,3,'Level 1 camp. Raid its stored supplies and defeat its defenders to earn an artifact and hero experience. Stock grows over time and defenders replenish unpredictably.',true,'pandaren'),
(1363,'Pandaren war camp',576,2240,7,'plains',249,82,30,'Level 7 camp. Raid its stored supplies and defeat its defenders to earn an artifact and hero experience. Stock grows over time and defenders replenish unpredictably.',true,'pandaren'),
(1364,'Demons outpost',1600,2496,1,'desert',21,7,1,'Level 1 camp. Raid its stored supplies and defeat its defenders to earn an artifact and hero experience. Stock grows over time and defenders replenish unpredictably.',true,'demon'),
(1365,'Human · Roman raider camp',2624,2112,4,'plains',84,32,4,'Level 4 camp. Raid its stored supplies and defeat its defenders to earn an artifact and hero experience. Stock grows over time and defenders replenish unpredictably.',true,'roman'),
(1366,'Human · Spartan war camp',3648,1984,8,'desert',257,201,58,'Level 8 camp. Raid its stored supplies and defeat its defenders to earn an artifact and hero experience. Stock grows over time and defenders replenish unpredictably.',true,'spartan'),
(1367,'Elves raider camp',5184,1984,5,'woods',98,60,31,'Level 5 camp. Raid its stored supplies and defeat its defenders to earn an artifact and hero experience. Stock grows over time and defenders replenish unpredictably.',true,'elf'),
(1368,'Human · Persian war camp',6464,2112,7,'plains',227,109,6,'Level 7 camp. Raid its stored supplies and defeat its defenders to earn an artifact and hero experience. Stock grows over time and defenders replenish unpredictably.',true,'persian'),
(1369,'Dwarves raider camp',7616,1600,4,'woods',86,24,11,'Level 4 camp. Raid its stored supplies and defeat its defenders to earn an artifact and hero experience. Stock grows over time and defenders replenish unpredictably.',true,'dwarf'),
(1370,'Human · Roman raider camp',8128,1600,5,'woods',118,44,28,'Level 5 camp. Raid its stored supplies and defeat its defenders to earn an artifact and hero experience. Stock grows over time and defenders replenish unpredictably.',true,'roman'),
(1371,'Orcs war camp',9280,2496,8,'highlands',324,106,49,'Level 8 camp. Raid its stored supplies and defeat its defenders to earn an artifact and hero experience. Stock grows over time and defenders replenish unpredictably.',true,'orc'),
(1372,'Human · Persian outpost',10304,1600,2,'plains',35,17,0,'Level 2 camp. Raid its stored supplies and defeat its defenders to earn an artifact and hero experience. Stock grows over time and defenders replenish unpredictably.',true,'persian'),
(1373,'Human · Spartan raider camp',11712,2112,5,'woods',84,71,29,'Level 5 camp. Raid its stored supplies and defeat its defenders to earn an artifact and hero experience. Stock grows over time and defenders replenish unpredictably.',true,'spartan'),
(1374,'Human · Roman raider camp',12352,1728,3,'plains',41,18,19,'Level 3 camp. Raid its stored supplies and defeat its defenders to earn an artifact and hero experience. Stock grows over time and defenders replenish unpredictably.',true,'roman'),
(1375,'Human · Persian raider camp',-11840,2624,3,'woods',33,27,20,'Level 3 camp. Raid its stored supplies and defeat its defenders to earn an artifact and hero experience. Stock grows over time and defenders replenish unpredictably.',true,'persian'),
(1376,'Human · Persian war camp',-11328,3136,7,'plains',206,121,19,'Level 7 camp. Raid its stored supplies and defeat its defenders to earn an artifact and hero experience. Stock grows over time and defenders replenish unpredictably.',true,'persian'),
(1377,'Dwarves raider camp',-10688,3136,5,'plains',127,30,36,'Level 5 camp. Raid its stored supplies and defeat its defenders to earn an artifact and hero experience. Stock grows over time and defenders replenish unpredictably.',true,'dwarf'),
(1378,'Necropolis war camp',-9664,3392,6,'plains',218,50,1,'Level 6 camp. Raid its stored supplies and defeat its defenders to earn an artifact and hero experience. Stock grows over time and defenders replenish unpredictably.',true,'undead'),
(1379,'Orcs outpost',-8640,2624,2,'desert',29,17,3,'Level 2 camp. Raid its stored supplies and defeat its defenders to earn an artifact and hero experience. Stock grows over time and defenders replenish unpredictably.',true,'orc'),
(1380,'Pandaren outpost',-7616,3008,1,'woods',26,5,0,'Level 1 camp. Raid its stored supplies and defeat its defenders to earn an artifact and hero experience. Stock grows over time and defenders replenish unpredictably.',true,'pandaren'),
(1381,'Human · Spartan war camp',-5696,3136,7,'plains',170,96,109,'Level 7 camp. Raid its stored supplies and defeat its defenders to earn an artifact and hero experience. Stock grows over time and defenders replenish unpredictably.',true,'spartan'),
(1382,'Gnomes outpost',-5312,2624,2,'woods',34,16,2,'Level 2 camp. Raid its stored supplies and defeat its defenders to earn an artifact and hero experience. Stock grows over time and defenders replenish unpredictably.',true,'gnome'),
(1383,'Orcs raider camp',-3776,3136,5,'marsh',75,72,45,'Level 5 camp. Raid its stored supplies and defeat its defenders to earn an artifact and hero experience. Stock grows over time and defenders replenish unpredictably.',true,'orc'),
(1384,'Human · Roman raider camp',-3008,3136,4,'plains',62,42,10,'Level 4 camp. Raid its stored supplies and defeat its defenders to earn an artifact and hero experience. Stock grows over time and defenders replenish unpredictably.',true,'roman'),
(1385,'Human · Egyptian raider camp',-1984,3392,5,'plains',124,29,39,'Level 5 camp. Raid its stored supplies and defeat its defenders to earn an artifact and hero experience. Stock grows over time and defenders replenish unpredictably.',true,'egyptian'),
(1386,'Human · Egyptian outpost',-1472,3520,1,'plains',21,8,0,'Level 1 camp. Raid its stored supplies and defeat its defenders to earn an artifact and hero experience. Stock grows over time and defenders replenish unpredictably.',true,'egyptian'),
(1387,'Orcs outpost',192,2624,1,'woods',17,11,2,'Level 1 camp. Raid its stored supplies and defeat its defenders to earn an artifact and hero experience. Stock grows over time and defenders replenish unpredictably.',true,'orc'),
(1388,'Pandaren raider camp',832,3136,5,'highlands',118,52,24,'Level 5 camp. Raid its stored supplies and defeat its defenders to earn an artifact and hero experience. Stock grows over time and defenders replenish unpredictably.',true,'pandaren'),
(1389,'Demons raider camp',1600,2880,3,'desert',45,11,20,'Level 3 camp. Raid its stored supplies and defeat its defenders to earn an artifact and hero experience. Stock grows over time and defenders replenish unpredictably.',true,'demon'),
(1390,'Dwarves outpost',3264,3136,1,'desert',18,10,1,'Level 1 camp. Raid its stored supplies and defeat its defenders to earn an artifact and hero experience. Stock grows over time and defenders replenish unpredictably.',true,'dwarf'),
(1391,'Elves raider camp',4544,3136,3,'plains',30,26,23,'Level 3 camp. Raid its stored supplies and defeat its defenders to earn an artifact and hero experience. Stock grows over time and defenders replenish unpredictably.',true,'elf'),
(1392,'Orcs raider camp',4928,2624,4,'woods',53,38,30,'Level 4 camp. Raid its stored supplies and defeat its defenders to earn an artifact and hero experience. Stock grows over time and defenders replenish unpredictably.',true,'orc'),
(1393,'Demons war camp',5696,2624,6,'woods',106,109,62,'Level 6 camp. Raid its stored supplies and defeat its defenders to earn an artifact and hero experience. Stock grows over time and defenders replenish unpredictably.',true,'demon'),
(1394,'Gnomes outpost',6720,3520,1,'plains',23,4,1,'Level 1 camp. Raid its stored supplies and defeat its defenders to earn an artifact and hero experience. Stock grows over time and defenders replenish unpredictably.',true,'gnome'),
(1395,'Orcs outpost',8000,2624,1,'plains',23,5,2,'Level 1 camp. Raid its stored supplies and defeat its defenders to earn an artifact and hero experience. Stock grows over time and defenders replenish unpredictably.',true,'orc'),
(1396,'Human · Spartan outpost',9280,2880,2,'plains',42,9,2,'Level 2 camp. Raid its stored supplies and defeat its defenders to earn an artifact and hero experience. Stock grows over time and defenders replenish unpredictably.',true,'spartan'),
(1397,'Necropolis raider camp',9792,3008,5,'highlands',121,60,3,'Level 5 camp. Raid its stored supplies and defeat its defenders to earn an artifact and hero experience. Stock grows over time and defenders replenish unpredictably.',true,'undead'),
(1398,'Demons raider camp',11200,3136,3,'woods',42,24,16,'Level 3 camp. Raid its stored supplies and defeat its defenders to earn an artifact and hero experience. Stock grows over time and defenders replenish unpredictably.',true,'demon'),
(1399,'Human · Spartan raider camp',12352,3392,4,'woods',79,38,1,'Level 4 camp. Raid its stored supplies and defeat its defenders to earn an artifact and hero experience. Stock grows over time and defenders replenish unpredictably.',true,'spartan'),
(1400,'Human · Egyptian raider camp',-12224,3648,5,'plains',88,60,21,'Level 5 camp. Raid its stored supplies and defeat its defenders to earn an artifact and hero experience. Stock grows over time and defenders replenish unpredictably.',true,'egyptian'),
(1401,'Necropolis stronghold',-11200,4544,9,'plains',503,126,11,'Level 9 camp. Raid its stored supplies and defeat its defenders to earn an artifact and hero experience. Stock grows over time and defenders replenish unpredictably.',true,'undead'),
(1402,'Human · Persian outpost',-10176,3648,1,'plains',26,4,0,'Level 1 camp. Raid its stored supplies and defeat its defenders to earn an artifact and hero experience. Stock grows over time and defenders replenish unpredictably.',true,'persian'),
(1403,'Human · Spartan stronghold',-9152,3776,10,'plains',364,267,48,'Level 10 camp. Raid its stored supplies and defeat its defenders to earn an artifact and hero experience. Stock grows over time and defenders replenish unpredictably.',true,'spartan'),
(1404,'Demons outpost',-8640,3904,1,'plains',20,11,0,'Level 1 camp. Raid its stored supplies and defeat its defenders to earn an artifact and hero experience. Stock grows over time and defenders replenish unpredictably.',true,'demon'),
(1405,'Orcs outpost',-6720,4160,2,'plains',39,13,1,'Level 2 camp. Raid its stored supplies and defeat its defenders to earn an artifact and hero experience. Stock grows over time and defenders replenish unpredictably.',true,'orc'),
(1406,'Elves raider camp',-6336,3648,4,'highlands',69,34,10,'Level 4 camp. Raid its stored supplies and defeat its defenders to earn an artifact and hero experience. Stock grows over time and defenders replenish unpredictably.',true,'elf'),
(1407,'Human · Spartan raider camp',-5568,3904,5,'plains',131,30,15,'Level 5 camp. Raid its stored supplies and defeat its defenders to earn an artifact and hero experience. Stock grows over time and defenders replenish unpredictably.',true,'spartan'),
(1408,'Elves outpost',-4544,4416,2,'marsh',33,16,2,'Level 2 camp. Raid its stored supplies and defeat its defenders to earn an artifact and hero experience. Stock grows over time and defenders replenish unpredictably.',true,'elf'),
(1409,'Elves outpost',-3392,4160,1,'highlands',26,5,1,'Level 1 camp. Raid its stored supplies and defeat its defenders to earn an artifact and hero experience. Stock grows over time and defenders replenish unpredictably.',true,'elf'),
(1410,'Elves outpost',-1856,4160,1,'plains',21,8,1,'Level 1 camp. Raid its stored supplies and defeat its defenders to earn an artifact and hero experience. Stock grows over time and defenders replenish unpredictably.',true,'elf'),
(1411,'Human · Egyptian outpost',-960,3776,1,'plains',24,7,0,'Level 1 camp. Raid its stored supplies and defeat its defenders to earn an artifact and hero experience. Stock grows over time and defenders replenish unpredictably.',true,'egyptian'),
(1412,'Pandaren outpost',-64,4160,2,'plains',37,10,0,'Level 2 camp. Raid its stored supplies and defeat its defenders to earn an artifact and hero experience. Stock grows over time and defenders replenish unpredictably.',true,'pandaren'),
(1413,'Human · Roman raider camp',1088,4416,3,'plains',54,21,9,'Level 3 camp. Raid its stored supplies and defeat its defenders to earn an artifact and hero experience. Stock grows over time and defenders replenish unpredictably.',true,'roman'),
(1414,'Human · Persian raider camp',2112,3648,4,'woods',59,34,28,'Level 4 camp. Raid its stored supplies and defeat its defenders to earn an artifact and hero experience. Stock grows over time and defenders replenish unpredictably.',true,'persian'),
(1415,'Human · Egyptian raider camp',2880,4160,5,'plains',88,56,27,'Level 5 camp. Raid its stored supplies and defeat its defenders to earn an artifact and hero experience. Stock grows over time and defenders replenish unpredictably.',true,'egyptian'),
(1416,'Human · Roman raider camp',4160,4544,5,'plains',93,46,42,'Level 5 camp. Raid its stored supplies and defeat its defenders to earn an artifact and hero experience. Stock grows over time and defenders replenish unpredictably.',true,'roman'),
(1417,'Pandaren war camp',5440,3648,7,'plains',250,99,35,'Level 7 camp. Raid its stored supplies and defeat its defenders to earn an artifact and hero experience. Stock grows over time and defenders replenish unpredictably.',true,'pandaren'),
(1418,'Human · Egyptian raider camp',6208,3648,3,'highlands',49,12,23,'Level 3 camp. Raid its stored supplies and defeat its defenders to earn an artifact and hero experience. Stock grows over time and defenders replenish unpredictably.',true,'egyptian'),
(1419,'Gnomes outpost',6720,4288,2,'woods',36,10,2,'Level 2 camp. Raid its stored supplies and defeat its defenders to earn an artifact and hero experience. Stock grows over time and defenders replenish unpredictably.',true,'gnome'),
(1420,'Human · Roman raider camp',7744,3904,3,'desert',52,31,1,'Level 3 camp. Raid its stored supplies and defeat its defenders to earn an artifact and hero experience. Stock grows over time and defenders replenish unpredictably.',true,'roman'),
(1421,'Gnomes raider camp',8768,3648,3,'desert',52,21,11,'Level 3 camp. Raid its stored supplies and defeat its defenders to earn an artifact and hero experience. Stock grows over time and defenders replenish unpredictably.',true,'gnome'),
(1422,'Necropolis raider camp',10304,4160,3,'plains',53,28,4,'Level 3 camp. Raid its stored supplies and defeat its defenders to earn an artifact and hero experience. Stock grows over time and defenders replenish unpredictably.',true,'undead'),
(1423,'Human · Roman war camp',10944,4160,6,'highlands',157,78,16,'Level 6 camp. Raid its stored supplies and defeat its defenders to earn an artifact and hero experience. Stock grows over time and defenders replenish unpredictably.',true,'roman'),
(1424,'Dwarves raider camp',11840,4416,3,'highlands',54,25,6,'Level 3 camp. Raid its stored supplies and defeat its defenders to earn an artifact and hero experience. Stock grows over time and defenders replenish unpredictably.',true,'dwarf'),
(1426,'Demons raider camp',-11456,5184,3,'woods',36,23,19,'Level 3 camp. Raid its stored supplies and defeat its defenders to earn an artifact and hero experience. Stock grows over time and defenders replenish unpredictably.',true,'demon'),
(1427,'Elves outpost',-10048,5184,2,'highlands',32,15,2,'Level 2 camp. Raid its stored supplies and defeat its defenders to earn an artifact and hero experience. Stock grows over time and defenders replenish unpredictably.',true,'elf'),
(1428,'Human · Roman raider camp',-9152,4672,3,'highlands',56,16,2,'Level 3 camp. Raid its stored supplies and defeat its defenders to earn an artifact and hero experience. Stock grows over time and defenders replenish unpredictably.',true,'roman'),
(1429,'Human · Egyptian raider camp',-8128,4928,4,'woods',76,30,19,'Level 4 camp. Raid its stored supplies and defeat its defenders to earn an artifact and hero experience. Stock grows over time and defenders replenish unpredictably.',true,'egyptian'),
(1430,'Elves raider camp',-6976,5184,5,'plains',83,49,48,'Level 5 camp. Raid its stored supplies and defeat its defenders to earn an artifact and hero experience. Stock grows over time and defenders replenish unpredictably.',true,'elf'),
(1431,'Gnomes raider camp',-6080,4800,5,'marsh',114,64,6,'Level 5 camp. Raid its stored supplies and defeat its defenders to earn an artifact and hero experience. Stock grows over time and defenders replenish unpredictably.',true,'gnome'),
(1432,'Gnomes raider camp',-5568,5440,4,'marsh',69,19,23,'Level 4 camp. Raid its stored supplies and defeat its defenders to earn an artifact and hero experience. Stock grows over time and defenders replenish unpredictably.',true,'gnome'),
(1433,'Pandaren war camp',-4544,4800,6,'plains',125,77,39,'Level 6 camp. Raid its stored supplies and defeat its defenders to earn an artifact and hero experience. Stock grows over time and defenders replenish unpredictably.',true,'pandaren'),
(1434,'Orcs raider camp',-3136,4672,4,'highlands',43,43,26,'Level 4 camp. Raid its stored supplies and defeat its defenders to earn an artifact and hero experience. Stock grows over time and defenders replenish unpredictably.',true,'orc'),
(1435,'Elves outpost',-2496,4672,2,'desert',37,8,3,'Level 2 camp. Raid its stored supplies and defeat its defenders to earn an artifact and hero experience. Stock grows over time and defenders replenish unpredictably.',true,'elf'),
(1436,'Gnomes raider camp',-1472,4928,3,'marsh',64,18,4,'Level 3 camp. Raid its stored supplies and defeat its defenders to earn an artifact and hero experience. Stock grows over time and defenders replenish unpredictably.',true,'gnome'),
(1437,'Demons raider camp',-320,5184,4,'plains',74,30,21,'Level 4 camp. Raid its stored supplies and defeat its defenders to earn an artifact and hero experience. Stock grows over time and defenders replenish unpredictably.',true,'demon'),
(1438,'Human · Roman war camp',576,5312,8,'desert',176,195,146,'Level 8 camp. Raid its stored supplies and defeat its defenders to earn an artifact and hero experience. Stock grows over time and defenders replenish unpredictably.',true,'roman'),
(1439,'Human · Egyptian raider camp',1728,5184,5,'desert',125,56,3,'Level 5 camp. Raid its stored supplies and defeat its defenders to earn an artifact and hero experience. Stock grows over time and defenders replenish unpredictably.',true,'egyptian'),
(1440,'Human · Spartan stronghold',2752,5184,10,'plains',429,252,40,'Level 10 camp. Raid its stored supplies and defeat its defenders to earn an artifact and hero experience. Stock grows over time and defenders replenish unpredictably.',true,'spartan'),
(1441,'Gnomes raider camp',3648,5440,3,'plains',59,11,6,'Level 3 camp. Raid its stored supplies and defeat its defenders to earn an artifact and hero experience. Stock grows over time and defenders replenish unpredictably.',true,'gnome'),
(1442,'Demons outpost',5184,5568,2,'highlands',29,19,2,'Level 2 camp. Raid its stored supplies and defeat its defenders to earn an artifact and hero experience. Stock grows over time and defenders replenish unpredictably.',true,'demon'),
(1443,'Human · Spartan raider camp',6208,4928,3,'plains',44,13,19,'Level 3 camp. Raid its stored supplies and defeat its defenders to earn an artifact and hero experience. Stock grows over time and defenders replenish unpredictably.',true,'spartan'),
(1444,'Human · Egyptian raider camp',7360,5184,4,'woods',94,26,9,'Level 4 camp. Raid its stored supplies and defeat its defenders to earn an artifact and hero experience. Stock grows over time and defenders replenish unpredictably.',true,'egyptian'),
(1445,'Gnomes outpost',8256,5440,2,'woods',30,18,3,'Level 2 camp. Raid its stored supplies and defeat its defenders to earn an artifact and hero experience. Stock grows over time and defenders replenish unpredictably.',true,'gnome'),
(1446,'Human · Persian outpost',8768,5568,1,'desert',25,5,0,'Level 1 camp. Raid its stored supplies and defeat its defenders to earn an artifact and hero experience. Stock grows over time and defenders replenish unpredictably.',true,'persian'),
(1447,'Human · Persian raider camp',10688,4672,3,'woods',33,29,17,'Level 3 camp. Raid its stored supplies and defeat its defenders to earn an artifact and hero experience. Stock grows over time and defenders replenish unpredictably.',true,'persian'),
(1448,'Dwarves outpost',11072,4672,1,'woods',24,7,0,'Level 1 camp. Raid its stored supplies and defeat its defenders to earn an artifact and hero experience. Stock grows over time and defenders replenish unpredictably.',true,'dwarf'),
(1449,'Pandaren raider camp',12224,4672,4,'desert',62,47,18,'Level 4 camp. Raid its stored supplies and defeat its defenders to earn an artifact and hero experience. Stock grows over time and defenders replenish unpredictably.',true,'pandaren'),
(1451,'Human · Persian outpost',-10944,6208,1,'plains',18,12,2,'Level 1 camp. Raid its stored supplies and defeat its defenders to earn an artifact and hero experience. Stock grows over time and defenders replenish unpredictably.',true,'persian'),
(1452,'Orcs stronghold',-10176,5696,9,'plains',347,117,174,'Level 9 camp. Raid its stored supplies and defeat its defenders to earn an artifact and hero experience. Stock grows over time and defenders replenish unpredictably.',true,'orc'),
(1453,'Human · Persian raider camp',-9408,5696,5,'woods',105,42,38,'Level 5 camp. Raid its stored supplies and defeat its defenders to earn an artifact and hero experience. Stock grows over time and defenders replenish unpredictably.',true,'persian'),
(1454,'Orcs raider camp',-8640,5696,4,'woods',89,31,7,'Level 4 camp. Raid its stored supplies and defeat its defenders to earn an artifact and hero experience. Stock grows over time and defenders replenish unpredictably.',true,'orc'),
(1455,'Human · Spartan raider camp',-7104,5696,3,'woods',47,12,20,'Level 3 camp. Raid its stored supplies and defeat its defenders to earn an artifact and hero experience. Stock grows over time and defenders replenish unpredictably.',true,'spartan'),
(1456,'Demons outpost',-6208,6208,2,'marsh',33,19,0,'Level 2 camp. Raid its stored supplies and defeat its defenders to earn an artifact and hero experience. Stock grows over time and defenders replenish unpredictably.',true,'demon'),
(1457,'Human · Roman outpost',-5056,5824,2,'highlands',32,18,1,'Level 2 camp. Raid its stored supplies and defeat its defenders to earn an artifact and hero experience. Stock grows over time and defenders replenish unpredictably.',true,'roman'),
(1458,'Human · Persian raider camp',-4032,6208,3,'highlands',35,30,14,'Level 3 camp. Raid its stored supplies and defeat its defenders to earn an artifact and hero experience. Stock grows over time and defenders replenish unpredictably.',true,'persian'),
(1459,'Human · Spartan outpost',-3136,6208,1,'highlands',24,5,3,'Level 1 camp. Raid its stored supplies and defeat its defenders to earn an artifact and hero experience. Stock grows over time and defenders replenish unpredictably.',true,'spartan'),
(1460,'Dwarves raider camp',-1856,5696,5,'plains',135,37,20,'Level 5 camp. Raid its stored supplies and defeat its defenders to earn an artifact and hero experience. Stock grows over time and defenders replenish unpredictably.',true,'dwarf'),
(1461,'Demons outpost',-832,5696,1,'woods',20,8,1,'Level 1 camp. Raid its stored supplies and defeat its defenders to earn an artifact and hero experience. Stock grows over time and defenders replenish unpredictably.',true,'demon'),
(1462,'Orcs outpost',-448,5696,2,'woods',37,8,2,'Level 2 camp. Raid its stored supplies and defeat its defenders to earn an artifact and hero experience. Stock grows over time and defenders replenish unpredictably.',true,'orc'),
(1463,'Elves outpost',704,6208,1,'plains',24,4,0,'Level 1 camp. Raid its stored supplies and defeat its defenders to earn an artifact and hero experience. Stock grows over time and defenders replenish unpredictably.',true,'elf'),
(1464,'Orcs outpost',1600,5824,2,'desert',33,16,4,'Level 2 camp. Raid its stored supplies and defeat its defenders to earn an artifact and hero experience. Stock grows over time and defenders replenish unpredictably.',true,'orc'),
(1465,'Gnomes outpost',2624,6208,2,'highlands',33,17,1,'Level 2 camp. Raid its stored supplies and defeat its defenders to earn an artifact and hero experience. Stock grows over time and defenders replenish unpredictably.',true,'gnome'),
(1466,'Orcs war camp',4416,6208,7,'plains',237,72,60,'Level 7 camp. Raid its stored supplies and defeat its defenders to earn an artifact and hero experience. Stock grows over time and defenders replenish unpredictably.',true,'orc'),
(1467,'Human · Roman raider camp',4800,5696,4,'woods',94,18,1,'Level 4 camp. Raid its stored supplies and defeat its defenders to earn an artifact and hero experience. Stock grows over time and defenders replenish unpredictably.',true,'roman'),
(1468,'Dwarves raider camp',6208,6336,5,'desert',124,39,29,'Level 5 camp. Raid its stored supplies and defeat its defenders to earn an artifact and hero experience. Stock grows over time and defenders replenish unpredictably.',true,'dwarf'),
(1469,'Pandaren outpost',7232,5952,1,'highlands',19,8,1,'Level 1 camp. Raid its stored supplies and defeat its defenders to earn an artifact and hero experience. Stock grows over time and defenders replenish unpredictably.',true,'pandaren'),
(1470,'Gnomes war camp',8256,6208,6,'woods',154,45,58,'Level 6 camp. Raid its stored supplies and defeat its defenders to earn an artifact and hero experience. Stock grows over time and defenders replenish unpredictably.',true,'gnome'),
(1471,'Necropolis outpost',9280,5824,1,'highlands',20,7,1,'Level 1 camp. Raid its stored supplies and defeat its defenders to earn an artifact and hero experience. Stock grows over time and defenders replenish unpredictably.',true,'undead'),
(1472,'Human · Spartan outpost',10304,6080,2,'woods',32,16,5,'Level 2 camp. Raid its stored supplies and defeat its defenders to earn an artifact and hero experience. Stock grows over time and defenders replenish unpredictably.',true,'spartan'),
(1473,'Human · Egyptian outpost',11328,6464,2,'highlands',32,11,4,'Level 2 camp. Raid its stored supplies and defeat its defenders to earn an artifact and hero experience. Stock grows over time and defenders replenish unpredictably.',true,'egyptian'),
(1476,'Demons war camp',-10944,7232,6,'plains',185,50,39,'Level 6 camp. Raid its stored supplies and defeat its defenders to earn an artifact and hero experience. Stock grows over time and defenders replenish unpredictably.',true,'demon'),
(1477,'Dwarves outpost',-10688,7616,2,'plains',40,12,1,'Level 2 camp. Raid its stored supplies and defeat its defenders to earn an artifact and hero experience. Stock grows over time and defenders replenish unpredictably.',true,'dwarf'),
(1478,'Human · Spartan outpost',-9024,6720,1,'woods',19,9,2,'Level 1 camp. Raid its stored supplies and defeat its defenders to earn an artifact and hero experience. Stock grows over time and defenders replenish unpredictably.',true,'spartan'),
(1479,'Elves outpost',-8640,7104,2,'woods',32,13,2,'Level 2 camp. Raid its stored supplies and defeat its defenders to earn an artifact and hero experience. Stock grows over time and defenders replenish unpredictably.',true,'elf'),
(1480,'Pandaren war camp',-7616,7104,8,'woods',371,80,10,'Level 8 camp. Raid its stored supplies and defeat its defenders to earn an artifact and hero experience. Stock grows over time and defenders replenish unpredictably.',true,'pandaren'),
(1481,'Demons raider camp',-6464,6720,3,'highlands',45,27,9,'Level 3 camp. Raid its stored supplies and defeat its defenders to earn an artifact and hero experience. Stock grows over time and defenders replenish unpredictably.',true,'demon'),
(1482,'Human · Persian outpost',-5056,7104,1,'woods',23,5,1,'Level 1 camp. Raid its stored supplies and defeat its defenders to earn an artifact and hero experience. Stock grows over time and defenders replenish unpredictably.',true,'persian'),
(1483,'Human · Egyptian raider camp',-4288,7232,5,'woods',94,67,7,'Level 5 camp. Raid its stored supplies and defeat its defenders to earn an artifact and hero experience. Stock grows over time and defenders replenish unpredictably.',true,'egyptian'),
(1484,'Pandaren outpost',-3008,7616,1,'plains',21,7,2,'Level 1 camp. Raid its stored supplies and defeat its defenders to earn an artifact and hero experience. Stock grows over time and defenders replenish unpredictably.',true,'pandaren'),
(1485,'Dwarves outpost',-1728,6720,1,'desert',23,8,1,'Level 1 camp. Raid its stored supplies and defeat its defenders to earn an artifact and hero experience. Stock grows over time and defenders replenish unpredictably.',true,'dwarf'),
(1486,'Demons outpost',-960,7104,1,'desert',23,6,0,'Level 1 camp. Raid its stored supplies and defeat its defenders to earn an artifact and hero experience. Stock grows over time and defenders replenish unpredictably.',true,'demon'),
(1487,'Human · Spartan outpost',64,7360,2,'plains',31,12,3,'Level 2 camp. Raid its stored supplies and defeat its defenders to earn an artifact and hero experience. Stock grows over time and defenders replenish unpredictably.',true,'spartan'),
(1488,'Orcs raider camp',1216,6720,3,'woods',58,25,1,'Level 3 camp. Raid its stored supplies and defeat its defenders to earn an artifact and hero experience. Stock grows over time and defenders replenish unpredictably.',true,'orc'),
(1489,'Dwarves raider camp',2112,7232,5,'woods',107,50,21,'Level 5 camp. Raid its stored supplies and defeat its defenders to earn an artifact and hero experience. Stock grows over time and defenders replenish unpredictably.',true,'dwarf'),
(1490,'Pandaren raider camp',3392,7232,5,'woods',68,63,43,'Level 5 camp. Raid its stored supplies and defeat its defenders to earn an artifact and hero experience. Stock grows over time and defenders replenish unpredictably.',true,'pandaren'),
(1491,'Human · Persian raider camp',3648,7616,3,'woods',43,16,20,'Level 3 camp. Raid its stored supplies and defeat its defenders to earn an artifact and hero experience. Stock grows over time and defenders replenish unpredictably.',true,'persian'),
(1492,'Dwarves raider camp',5440,6720,3,'plains',47,16,23,'Level 3 camp. Raid its stored supplies and defeat its defenders to earn an artifact and hero experience. Stock grows over time and defenders replenish unpredictably.',true,'dwarf'),
(1493,'Orcs outpost',5696,7104,1,'plains',22,6,2,'Level 1 camp. Raid its stored supplies and defeat its defenders to earn an artifact and hero experience. Stock grows over time and defenders replenish unpredictably.',true,'orc'),
(1494,'Dwarves outpost',6720,7360,2,'desert',36,11,1,'Level 2 camp. Raid its stored supplies and defeat its defenders to earn an artifact and hero experience. Stock grows over time and defenders replenish unpredictably.',true,'dwarf'),
(1495,'Pandaren raider camp',7744,7104,4,'desert',71,47,2,'Level 4 camp. Raid its stored supplies and defeat its defenders to earn an artifact and hero experience. Stock grows over time and defenders replenish unpredictably.',true,'pandaren'),
(1496,'Pandaren raider camp',8768,7232,3,'woods',52,23,0,'Level 3 camp. Raid its stored supplies and defeat its defenders to earn an artifact and hero experience. Stock grows over time and defenders replenish unpredictably.',true,'pandaren'),
(1497,'Human · Persian raider camp',10048,7232,4,'plains',63,39,18,'Level 4 camp. Raid its stored supplies and defeat its defenders to earn an artifact and hero experience. Stock grows over time and defenders replenish unpredictably.',true,'persian'),
(1498,'Human · Persian raider camp',10816,7488,3,'plains',59,23,2,'Level 3 camp. Raid its stored supplies and defeat its defenders to earn an artifact and hero experience. Stock grows over time and defenders replenish unpredictably.',true,'persian'),
(1500,'Pandaren raider camp',-12608,8256,3,'darkland',40,32,13,'Level 3 camp. Raid its stored supplies and defeat its defenders to earn an artifact and hero experience. Stock grows over time and defenders replenish unpredictably.',true,'pandaren'),
(1501,'Human · Roman raider camp',-11072,8256,5,'woods',139,33,9,'Level 5 camp. Raid its stored supplies and defeat its defenders to earn an artifact and hero experience. Stock grows over time and defenders replenish unpredictably.',true,'roman'),
(1502,'Orcs raider camp',-10688,8256,4,'highlands',77,29,21,'Level 4 camp. Raid its stored supplies and defeat its defenders to earn an artifact and hero experience. Stock grows over time and defenders replenish unpredictably.',true,'orc'),
(1503,'Elves raider camp',-9152,8128,5,'woods',85,62,37,'Level 5 camp. Raid its stored supplies and defeat its defenders to earn an artifact and hero experience. Stock grows over time and defenders replenish unpredictably.',true,'elf'),
(1504,'Gnomes raider camp',-7872,8256,3,'plains',55,24,4,'Level 3 camp. Raid its stored supplies and defeat its defenders to earn an artifact and hero experience. Stock grows over time and defenders replenish unpredictably.',true,'gnome'),
(1505,'Gnomes outpost',-7104,8512,2,'woods',34,17,0,'Level 2 camp. Raid its stored supplies and defeat its defenders to earn an artifact and hero experience. Stock grows over time and defenders replenish unpredictably.',true,'gnome'),
(1506,'Human · Roman war camp',-5696,7744,6,'plains',92,87,70,'Level 6 camp. Raid its stored supplies and defeat its defenders to earn an artifact and hero experience. Stock grows over time and defenders replenish unpredictably.',true,'roman'),
(1507,'Human · Spartan outpost',-4928,8256,2,'desert',38,13,3,'Level 2 camp. Raid its stored supplies and defeat its defenders to earn an artifact and hero experience. Stock grows over time and defenders replenish unpredictably.',true,'spartan'),
(1508,'Elves outpost',-4544,8384,1,'desert',24,5,2,'Level 1 camp. Raid its stored supplies and defeat its defenders to earn an artifact and hero experience. Stock grows over time and defenders replenish unpredictably.',true,'elf'),
(1509,'Gnomes outpost',-3520,8512,1,'highlands',20,11,0,'Level 1 camp. Raid its stored supplies and defeat its defenders to earn an artifact and hero experience. Stock grows over time and defenders replenish unpredictably.',true,'gnome'),
(1510,'Elves raider camp',-2496,8512,3,'desert',56,21,2,'Level 3 camp. Raid its stored supplies and defeat its defenders to earn an artifact and hero experience. Stock grows over time and defenders replenish unpredictably.',true,'elf'),
(1511,'Human · Roman raider camp',-1216,8256,3,'plains',43,21,22,'Level 3 camp. Raid its stored supplies and defeat its defenders to earn an artifact and hero experience. Stock grows over time and defenders replenish unpredictably.',true,'roman'),
(1512,'Human · Persian war camp',192,8256,7,'plains',119,126,100,'Level 7 camp. Raid its stored supplies and defeat its defenders to earn an artifact and hero experience. Stock grows over time and defenders replenish unpredictably.',true,'persian'),
(1513,'Elves raider camp',960,7744,5,'woods',90,56,33,'Level 5 camp. Raid its stored supplies and defeat its defenders to earn an artifact and hero experience. Stock grows over time and defenders replenish unpredictably.',true,'elf'),
(1514,'Human · Persian raider camp',1600,8640,5,'plains',140,26,2,'Level 5 camp. Raid its stored supplies and defeat its defenders to earn an artifact and hero experience. Stock grows over time and defenders replenish unpredictably.',true,'persian'),
(1515,'Necropolis outpost',3136,8384,1,'highlands',19,12,1,'Level 1 camp. Raid its stored supplies and defeat its defenders to earn an artifact and hero experience. Stock grows over time and defenders replenish unpredictably.',true,'undead'),
(1516,'Human · Spartan outpost',4160,8640,1,'highlands',25,4,2,'Level 1 camp. Raid its stored supplies and defeat its defenders to earn an artifact and hero experience. Stock grows over time and defenders replenish unpredictably.',true,'spartan'),
(1517,'Human · Persian outpost',5440,8256,1,'plains',17,11,1,'Level 1 camp. Raid its stored supplies and defeat its defenders to earn an artifact and hero experience. Stock grows over time and defenders replenish unpredictably.',true,'persian'),
(1518,'Elves outpost',6464,8256,2,'highlands',36,10,2,'Level 2 camp. Raid its stored supplies and defeat its defenders to earn an artifact and hero experience. Stock grows over time and defenders replenish unpredictably.',true,'elf'),
(1519,'Demons outpost',7360,8256,2,'highlands',28,21,4,'Level 2 camp. Raid its stored supplies and defeat its defenders to earn an artifact and hero experience. Stock grows over time and defenders replenish unpredictably.',true,'demon'),
(1520,'Demons raider camp',8640,7744,4,'woods',79,34,10,'Level 4 camp. Raid its stored supplies and defeat its defenders to earn an artifact and hero experience. Stock grows over time and defenders replenish unpredictably.',true,'demon'),
(1521,'Necropolis outpost',9408,7744,2,'highlands',38,10,2,'Level 2 camp. Raid its stored supplies and defeat its defenders to earn an artifact and hero experience. Stock grows over time and defenders replenish unpredictably.',true,'undead'),
(1522,'Human · Egyptian stronghold',9792,8384,9,'woods',371,197,10,'Level 9 camp. Raid its stored supplies and defeat its defenders to earn an artifact and hero experience. Stock grows over time and defenders replenish unpredictably.',true,'egyptian'),
(1523,'Elves outpost',10816,8640,1,'plains',20,11,1,'Level 1 camp. Raid its stored supplies and defeat its defenders to earn an artifact and hero experience. Stock grows over time and defenders replenish unpredictably.',true,'elf'),
(1526,'Orcs war camp',-11200,8768,8,'plains',343,120,33,'Level 8 camp. Raid its stored supplies and defeat its defenders to earn an artifact and hero experience. Stock grows over time and defenders replenish unpredictably.',true,'orc'),
(1527,'Human · Egyptian raider camp',-10432,8768,4,'highlands',60,31,37,'Level 4 camp. Raid its stored supplies and defeat its defenders to earn an artifact and hero experience. Stock grows over time and defenders replenish unpredictably.',true,'egyptian'),
(1528,'Gnomes raider camp',-9152,9536,3,'highlands',53,14,11,'Level 3 camp. Raid its stored supplies and defeat its defenders to earn an artifact and hero experience. Stock grows over time and defenders replenish unpredictably.',true,'gnome'),
(1529,'Pandaren war camp',-8128,9408,7,'plains',168,108,78,'Level 7 camp. Raid its stored supplies and defeat its defenders to earn an artifact and hero experience. Stock grows over time and defenders replenish unpredictably.',true,'pandaren'),
(1530,'Demons outpost',-7104,9664,1,'woods',19,9,0,'Level 1 camp. Raid its stored supplies and defeat its defenders to earn an artifact and hero experience. Stock grows over time and defenders replenish unpredictably.',true,'demon'),
(1531,'Human · Roman raider camp',-6080,8896,4,'woods',93,35,1,'Level 4 camp. Raid its stored supplies and defeat its defenders to earn an artifact and hero experience. Stock grows over time and defenders replenish unpredictably.',true,'roman'),
(1532,'Human · Roman raider camp',-5056,9280,3,'plains',56,25,3,'Level 3 camp. Raid its stored supplies and defeat its defenders to earn an artifact and hero experience. Stock grows over time and defenders replenish unpredictably.',true,'roman'),
(1533,'Orcs outpost',-4032,9152,1,'desert',24,5,0,'Level 1 camp. Raid its stored supplies and defeat its defenders to earn an artifact and hero experience. Stock grows over time and defenders replenish unpredictably.',true,'orc'),
(1534,'Human · Spartan outpost',-2752,9280,1,'desert',24,6,1,'Level 1 camp. Raid its stored supplies and defeat its defenders to earn an artifact and hero experience. Stock grows over time and defenders replenish unpredictably.',true,'spartan'),
(1535,'Human · Roman outpost',-2496,8896,2,'desert',34,14,0,'Level 2 camp. Raid its stored supplies and defeat its defenders to earn an artifact and hero experience. Stock grows over time and defenders replenish unpredictably.',true,'roman'),
(1536,'Human · Persian war camp',-576,9280,6,'plains',162,71,32,'Level 6 camp. Raid its stored supplies and defeat its defenders to earn an artifact and hero experience. Stock grows over time and defenders replenish unpredictably.',true,'persian'),
(1537,'Orcs war camp',-448,9664,8,'plains',217,141,112,'Level 8 camp. Raid its stored supplies and defeat its defenders to earn an artifact and hero experience. Stock grows over time and defenders replenish unpredictably.',true,'orc'),
(1538,'Human · Spartan raider camp',1088,8768,5,'woods',102,37,32,'Level 5 camp. Raid its stored supplies and defeat its defenders to earn an artifact and hero experience. Stock grows over time and defenders replenish unpredictably.',true,'spartan'),
(1539,'Human · Spartan outpost',2112,9024,1,'plains',21,9,0,'Level 1 camp. Raid its stored supplies and defeat its defenders to earn an artifact and hero experience. Stock grows over time and defenders replenish unpredictably.',true,'spartan'),
(1540,'Dwarves stronghold',2624,9024,9,'desert',374,149,130,'Level 9 camp. Raid its stored supplies and defeat its defenders to earn an artifact and hero experience. Stock grows over time and defenders replenish unpredictably.',true,'dwarf'),
(1541,'Gnomes raider camp',4160,9536,4,'highlands',73,37,4,'Level 4 camp. Raid its stored supplies and defeat its defenders to earn an artifact and hero experience. Stock grows over time and defenders replenish unpredictably.',true,'gnome'),
(1542,'Human · Spartan outpost',5056,9280,1,'highlands',22,7,2,'Level 1 camp. Raid its stored supplies and defeat its defenders to earn an artifact and hero experience. Stock grows over time and defenders replenish unpredictably.',true,'spartan'),
(1543,'Dwarves raider camp',6080,9280,5,'highlands',141,44,5,'Level 5 camp. Raid its stored supplies and defeat its defenders to earn an artifact and hero experience. Stock grows over time and defenders replenish unpredictably.',true,'dwarf'),
(1544,'Necropolis war camp',7232,9536,7,'plains',218,96,51,'Level 7 camp. Raid its stored supplies and defeat its defenders to earn an artifact and hero experience. Stock grows over time and defenders replenish unpredictably.',true,'undead'),
(1545,'Human · Roman outpost',8256,8896,1,'highlands',19,8,2,'Level 1 camp. Raid its stored supplies and defeat its defenders to earn an artifact and hero experience. Stock grows over time and defenders replenish unpredictably.',true,'roman'),
(1546,'Human · Persian outpost',8768,9408,2,'woods',32,16,4,'Level 2 camp. Raid its stored supplies and defeat its defenders to earn an artifact and hero experience. Stock grows over time and defenders replenish unpredictably.',true,'persian'),
(1547,'Human · Persian raider camp',10304,9152,3,'plains',46,32,6,'Level 3 camp. Raid its stored supplies and defeat its defenders to earn an artifact and hero experience. Stock grows over time and defenders replenish unpredictably.',true,'persian'),
(1548,'Gnomes outpost',11584,8768,2,'plains',32,19,0,'Level 2 camp. Raid its stored supplies and defeat its defenders to earn an artifact and hero experience. Stock grows over time and defenders replenish unpredictably.',true,'gnome'),
(1549,'Elves war camp',11840,9408,7,'plains',176,99,92,'Level 7 camp. Raid its stored supplies and defeat its defenders to earn an artifact and hero experience. Stock grows over time and defenders replenish unpredictably.',true,'elf'),
(1551,'Human · Persian raider camp',-11712,10560,5,'darkland',138,43,8,'Level 5 camp. Raid its stored supplies and defeat its defenders to earn an artifact and hero experience. Stock grows over time and defenders replenish unpredictably.',true,'persian'),
(1552,'Elves war camp',-10688,9920,8,'highlands',283,125,77,'Level 8 camp. Raid its stored supplies and defeat its defenders to earn an artifact and hero experience. Stock grows over time and defenders replenish unpredictably.',true,'elf'),
(1553,'Demons raider camp',-9408,10304,3,'plains',60,15,3,'Level 3 camp. Raid its stored supplies and defeat its defenders to earn an artifact and hero experience. Stock grows over time and defenders replenish unpredictably.',true,'demon'),
(1554,'Human · Egyptian raider camp',-8640,10432,3,'highlands',65,15,5,'Level 3 camp. Raid its stored supplies and defeat its defenders to earn an artifact and hero experience. Stock grows over time and defenders replenish unpredictably.',true,'egyptian'),
(1555,'Pandaren raider camp',-7616,10048,5,'highlands',111,53,21,'Level 5 camp. Raid its stored supplies and defeat its defenders to earn an artifact and hero experience. Stock grows over time and defenders replenish unpredictably.',true,'pandaren'),
(1556,'Human · Roman raider camp',-6080,10688,3,'plains',44,33,8,'Level 3 camp. Raid its stored supplies and defeat its defenders to earn an artifact and hero experience. Stock grows over time and defenders replenish unpredictably.',true,'roman'),
(1557,'Elves raider camp',-5184,10304,4,'plains',83,18,15,'Level 4 camp. Raid its stored supplies and defeat its defenders to earn an artifact and hero experience. Stock grows over time and defenders replenish unpredictably.',true,'elf'),
(1558,'Gnomes raider camp',-4032,10560,5,'woods',94,32,41,'Level 5 camp. Raid its stored supplies and defeat its defenders to earn an artifact and hero experience. Stock grows over time and defenders replenish unpredictably.',true,'gnome'),
(1559,'Demons war camp',-3008,9792,6,'highlands',196,60,16,'Level 6 camp. Raid its stored supplies and defeat its defenders to earn an artifact and hero experience. Stock grows over time and defenders replenish unpredictably.',true,'demon'),
(1560,'Elves outpost',-2496,9792,2,'highlands',32,15,4,'Level 2 camp. Raid its stored supplies and defeat its defenders to earn an artifact and hero experience. Stock grows over time and defenders replenish unpredictably.',true,'elf'),
(1561,'Demons raider camp',-1216,10304,4,'plains',62,37,21,'Level 4 camp. Raid its stored supplies and defeat its defenders to earn an artifact and hero experience. Stock grows over time and defenders replenish unpredictably.',true,'demon'),
(1562,'Human · Roman raider camp',64,10048,4,'highlands',46,36,35,'Level 4 camp. Raid its stored supplies and defeat its defenders to earn an artifact and hero experience. Stock grows over time and defenders replenish unpredictably.',true,'roman'),
(1563,'Gnomes outpost',1088,10304,2,'plains',34,12,4,'Level 2 camp. Raid its stored supplies and defeat its defenders to earn an artifact and hero experience. Stock grows over time and defenders replenish unpredictably.',true,'gnome'),
(1564,'Demons raider camp',2496,10304,3,'woods',48,30,2,'Level 3 camp. Raid its stored supplies and defeat its defenders to earn an artifact and hero experience. Stock grows over time and defenders replenish unpredictably.',true,'demon'),
(1565,'Elves raider camp',2880,9792,4,'desert',63,30,28,'Level 4 camp. Raid its stored supplies and defeat its defenders to earn an artifact and hero experience. Stock grows over time and defenders replenish unpredictably.',true,'elf'),
(1566,'Human · Egyptian raider camp',3648,9792,5,'plains',92,31,43,'Level 5 camp. Raid its stored supplies and defeat its defenders to earn an artifact and hero experience. Stock grows over time and defenders replenish unpredictably.',true,'egyptian'),
(1567,'Pandaren outpost',5184,10688,2,'plains',31,15,2,'Level 2 camp. Raid its stored supplies and defeat its defenders to earn an artifact and hero experience. Stock grows over time and defenders replenish unpredictably.',true,'pandaren'),
(1568,'Elves outpost',6464,9792,2,'highlands',34,17,0,'Level 2 camp. Raid its stored supplies and defeat its defenders to earn an artifact and hero experience. Stock grows over time and defenders replenish unpredictably.',true,'elf'),
(1569,'Human · Roman raider camp',6848,10304,5,'highlands',150,33,0,'Level 5 camp. Raid its stored supplies and defeat its defenders to earn an artifact and hero experience. Stock grows over time and defenders replenish unpredictably.',true,'roman'),
(1570,'Human · Roman raider camp',7744,9792,3,'plains',46,22,16,'Level 3 camp. Raid its stored supplies and defeat its defenders to earn an artifact and hero experience. Stock grows over time and defenders replenish unpredictably.',true,'roman'),
(1571,'Orcs raider camp',9152,10304,3,'plains',36,28,19,'Level 3 camp. Raid its stored supplies and defeat its defenders to earn an artifact and hero experience. Stock grows over time and defenders replenish unpredictably.',true,'orc'),
(1572,'Elves war camp',10304,10304,7,'woods',206,120,15,'Level 7 camp. Raid its stored supplies and defeat its defenders to earn an artifact and hero experience. Stock grows over time and defenders replenish unpredictably.',true,'elf'),
(1573,'Pandaren raider camp',11328,9792,5,'plains',118,26,28,'Level 5 camp. Raid its stored supplies and defeat its defenders to earn an artifact and hero experience. Stock grows over time and defenders replenish unpredictably.',true,'pandaren'),
(1574,'Orcs outpost',11968,10304,1,'plains',22,5,2,'Level 1 camp. Raid its stored supplies and defeat its defenders to earn an artifact and hero experience. Stock grows over time and defenders replenish unpredictably.',true,'orc'),
(1575,'Elves stronghold',-12096,11328,9,'highlands',486,129,32,'Level 9 camp. Raid its stored supplies and defeat its defenders to earn an artifact and hero experience. Stock grows over time and defenders replenish unpredictably.',true,'elf'),
(1576,'Elves outpost',-11328,10816,2,'darkland',32,19,1,'Level 2 camp. Raid its stored supplies and defeat its defenders to earn an artifact and hero experience. Stock grows over time and defenders replenish unpredictably.',true,'elf'),
(1577,'Human · Persian raider camp',-10176,11072,3,'plains',32,27,16,'Level 3 camp. Raid its stored supplies and defeat its defenders to earn an artifact and hero experience. Stock grows over time and defenders replenish unpredictably.',true,'persian'),
(1578,'Elves war camp',-8768,11328,7,'plains',197,98,50,'Level 7 camp. Raid its stored supplies and defeat its defenders to earn an artifact and hero experience. Stock grows over time and defenders replenish unpredictably.',true,'elf'),
(1579,'Gnomes raider camp',-8128,11584,3,'plains',56,13,14,'Level 3 camp. Raid its stored supplies and defeat its defenders to earn an artifact and hero experience. Stock grows over time and defenders replenish unpredictably.',true,'gnome'),
(1580,'Human · Persian raider camp',-7616,10816,4,'desert',68,43,8,'Level 4 camp. Raid its stored supplies and defeat its defenders to earn an artifact and hero experience. Stock grows over time and defenders replenish unpredictably.',true,'persian'),
(1581,'Orcs raider camp',-6592,11072,5,'desert',73,68,31,'Level 5 camp. Raid its stored supplies and defeat its defenders to earn an artifact and hero experience. Stock grows over time and defenders replenish unpredictably.',true,'orc'),
(1582,'Demons outpost',-5056,11712,1,'plains',20,12,0,'Level 1 camp. Raid its stored supplies and defeat its defenders to earn an artifact and hero experience. Stock grows over time and defenders replenish unpredictably.',true,'demon'),
(1583,'Demons raider camp',-4416,10816,4,'woods',50,40,35,'Level 4 camp. Raid its stored supplies and defeat its defenders to earn an artifact and hero experience. Stock grows over time and defenders replenish unpredictably.',true,'demon'),
(1584,'Orcs outpost',-3520,10944,2,'woods',31,20,1,'Level 2 camp. Raid its stored supplies and defeat its defenders to earn an artifact and hero experience. Stock grows over time and defenders replenish unpredictably.',true,'orc'),
(1585,'Necropolis outpost',-2368,10816,1,'woods',20,12,0,'Level 1 camp. Raid its stored supplies and defeat its defenders to earn an artifact and hero experience. Stock grows over time and defenders replenish unpredictably.',true,'undead'),
(1586,'Elves outpost',-576,11328,1,'plains',23,4,2,'Level 1 camp. Raid its stored supplies and defeat its defenders to earn an artifact and hero experience. Stock grows over time and defenders replenish unpredictably.',true,'elf'),
(1587,'Gnomes raider camp',64,10816,3,'plains',33,27,22,'Level 3 camp. Raid its stored supplies and defeat its defenders to earn an artifact and hero experience. Stock grows over time and defenders replenish unpredictably.',true,'gnome'),
(1588,'Necropolis raider camp',1088,11072,4,'plains',67,42,10,'Level 4 camp. Raid its stored supplies and defeat its defenders to earn an artifact and hero experience. Stock grows over time and defenders replenish unpredictably.',true,'undead'),
(1589,'Human · Roman war camp',2240,11328,6,'plains',102,96,49,'Level 6 camp. Raid its stored supplies and defeat its defenders to earn an artifact and hero experience. Stock grows over time and defenders replenish unpredictably.',true,'roman'),
(1590,'Human · Roman outpost',3520,10816,1,'plains',20,10,0,'Level 1 camp. Raid its stored supplies and defeat its defenders to earn an artifact and hero experience. Stock grows over time and defenders replenish unpredictably.',true,'roman'),
(1591,'Gnomes outpost',4032,10816,1,'desert',23,5,2,'Level 1 camp. Raid its stored supplies and defeat its defenders to earn an artifact and hero experience. Stock grows over time and defenders replenish unpredictably.',true,'gnome'),
(1592,'Gnomes outpost',5056,11328,1,'plains',24,4,1,'Level 1 camp. Raid its stored supplies and defeat its defenders to earn an artifact and hero experience. Stock grows over time and defenders replenish unpredictably.',true,'gnome'),
(1593,'Pandaren raider camp',6336,10816,3,'highlands',54,20,8,'Level 3 camp. Raid its stored supplies and defeat its defenders to earn an artifact and hero experience. Stock grows over time and defenders replenish unpredictably.',true,'pandaren'),
(1594,'Human · Roman raider camp',7616,10816,3,'highlands',46,25,14,'Level 3 camp. Raid its stored supplies and defeat its defenders to earn an artifact and hero experience. Stock grows over time and defenders replenish unpredictably.',true,'roman'),
(1595,'Dwarves outpost',8640,11328,1,'highlands',26,5,1,'Level 1 camp. Raid its stored supplies and defeat its defenders to earn an artifact and hero experience. Stock grows over time and defenders replenish unpredictably.',true,'dwarf'),
(1596,'Orcs outpost',9280,11072,2,'highlands',41,8,3,'Level 2 camp. Raid its stored supplies and defeat its defenders to earn an artifact and hero experience. Stock grows over time and defenders replenish unpredictably.',true,'orc'),
(1597,'Elves outpost',9792,11072,2,'woods',33,13,4,'Level 2 camp. Raid its stored supplies and defeat its defenders to earn an artifact and hero experience. Stock grows over time and defenders replenish unpredictably.',true,'elf'),
(1598,'Necropolis outpost',11712,10816,1,'highlands',22,5,1,'Level 1 camp. Raid its stored supplies and defeat its defenders to earn an artifact and hero experience. Stock grows over time and defenders replenish unpredictably.',true,'undead'),
(1599,'Human · Roman outpost',12352,11200,2,'plains',38,9,0,'Level 2 camp. Raid its stored supplies and defeat its defenders to earn an artifact and hero experience. Stock grows over time and defenders replenish unpredictably.',true,'roman'),
(1600,'Gnomes outpost',-12224,11840,2,'plains',33,18,1,'Level 2 camp. Raid its stored supplies and defeat its defenders to earn an artifact and hero experience. Stock grows over time and defenders replenish unpredictably.',true,'gnome'),
(1601,'Elves outpost',-11328,11840,2,'plains',34,12,1,'Level 2 camp. Raid its stored supplies and defeat its defenders to earn an artifact and hero experience. Stock grows over time and defenders replenish unpredictably.',true,'elf'),
(1602,'Gnomes raider camp',-10176,12096,3,'plains',45,24,16,'Level 3 camp. Raid its stored supplies and defeat its defenders to earn an artifact and hero experience. Stock grows over time and defenders replenish unpredictably.',true,'gnome'),
(1603,'Demons raider camp',-9152,12352,4,'woods',83,39,0,'Level 4 camp. Raid its stored supplies and defeat its defenders to earn an artifact and hero experience. Stock grows over time and defenders replenish unpredictably.',true,'demon'),
(1604,'Necropolis raider camp',-7744,12352,3,'plains',59,17,7,'Level 3 camp. Raid its stored supplies and defeat its defenders to earn an artifact and hero experience. Stock grows over time and defenders replenish unpredictably.',true,'undead'),
(1605,'Pandaren outpost',-7616,12736,2,'plains',27,16,4,'Level 2 camp. Raid its stored supplies and defeat its defenders to earn an artifact and hero experience. Stock grows over time and defenders replenish unpredictably.',true,'pandaren'),
(1606,'Necropolis outpost',-6080,11840,1,'desert',21,6,1,'Level 1 camp. Raid its stored supplies and defeat its defenders to earn an artifact and hero experience. Stock grows over time and defenders replenish unpredictably.',true,'undead'),
(1607,'Human · Spartan raider camp',-5056,12096,4,'highlands',74,33,4,'Level 4 camp. Raid its stored supplies and defeat its defenders to earn an artifact and hero experience. Stock grows over time and defenders replenish unpredictably.',true,'spartan'),
(1608,'Human · Spartan raider camp',-3904,12352,4,'plains',91,30,6,'Level 4 camp. Raid its stored supplies and defeat its defenders to earn an artifact and hero experience. Stock grows over time and defenders replenish unpredictably.',true,'spartan'),
(1609,'Human · Spartan raider camp',-3520,12096,3,'woods',50,18,7,'Level 3 camp. Raid its stored supplies and defeat its defenders to earn an artifact and hero experience. Stock grows over time and defenders replenish unpredictably.',true,'spartan'),
(1610,'Human · Egyptian raider camp',-2496,12352,4,'highlands',65,36,26,'Level 4 camp. Raid its stored supplies and defeat its defenders to earn an artifact and hero experience. Stock grows over time and defenders replenish unpredictably.',true,'egyptian'),
(1611,'Dwarves raider camp',-960,12608,4,'highlands',76,28,8,'Level 4 camp. Raid its stored supplies and defeat its defenders to earn an artifact and hero experience. Stock grows over time and defenders replenish unpredictably.',true,'dwarf'),
(1612,'Pandaren war camp',-320,11840,7,'plains',181,121,49,'Level 7 camp. Raid its stored supplies and defeat its defenders to earn an artifact and hero experience. Stock grows over time and defenders replenish unpredictably.',true,'pandaren'),
(1613,'Human · Roman war camp',1472,11840,7,'desert',252,98,30,'Level 7 camp. Raid its stored supplies and defeat its defenders to earn an artifact and hero experience. Stock grows over time and defenders replenish unpredictably.',true,'roman'),
(1614,'Human · Persian raider camp',2368,11840,3,'plains',58,16,10,'Level 3 camp. Raid its stored supplies and defeat its defenders to earn an artifact and hero experience. Stock grows over time and defenders replenish unpredictably.',true,'persian'),
(1615,'Dwarves raider camp',3136,11968,3,'plains',53,14,10,'Level 3 camp. Raid its stored supplies and defeat its defenders to earn an artifact and hero experience. Stock grows over time and defenders replenish unpredictably.',true,'dwarf'),
(1616,'Human · Persian war camp',3648,12096,6,'plains',152,72,52,'Level 6 camp. Raid its stored supplies and defeat its defenders to earn an artifact and hero experience. Stock grows over time and defenders replenish unpredictably.',true,'persian'),
(1621,'Human · Roman war camp',9280,11840,7,'highlands',228,110,45,'Level 7 camp. Raid its stored supplies and defeat its defenders to earn an artifact and hero experience. Stock grows over time and defenders replenish unpredictably.',true,'roman'),
(1622,'Human · Egyptian raider camp',10560,11840,3,'woods',38,26,21,'Level 3 camp. Raid its stored supplies and defeat its defenders to earn an artifact and hero experience. Stock grows over time and defenders replenish unpredictably.',true,'egyptian'),
(1623,'Gnomes raider camp',11328,11968,3,'woods',35,23,21,'Level 3 camp. Raid its stored supplies and defeat its defenders to earn an artifact and hero experience. Stock grows over time and defenders replenish unpredictably.',true,'gnome'),
(1624,'Human · Persian raider camp',11840,12352,3,'highlands',60,16,1,'Level 3 camp. Raid its stored supplies and defeat its defenders to earn an artifact and hero experience. Stock grows over time and defenders replenish unpredictably.',true,'persian')
) as c(id,name,x,y,tier,terrain,infantry,archers,cavalry,description,bandit,faction)
where not exists(select 1 from public.settlements s where public.peris_cell_distance(floor(s.x/128)::integer,floor(s.y/128)::integer,floor(c.x/128)::integer,floor(c.y/128)::integer)<=1)
 and not exists(select 1 from public.peris_map_plots p where p.col=floor(c.x/128)::integer and p.row=floor(c.y/128)::integer)
 and not exists(select 1 from public.peris_settler_expeditions e where e.status='travelling' and public.peris_cell_distance(e.col,e.row,floor(c.x/128)::integer,floor(c.y/128)::integer)<=1)
on conflict(id) do update set name=excluded.name,terrain=excluded.terrain,faction=excluded.faction,bandit=true,tier=excluded.tier,description=excluded.description
where not exists(select 1 from public.battles b where b.camp_id=peris_camps.id and b.status='active')
 and not exists(select 1 from public.armies a where a.raid_target_id=peris_camps.id and a.status='moving');
-- Camp stock and private random recruitment belong to the existing Peris world.
create table if not exists public.peris_camp_stock (
 camp_id integer primary key references public.peris_camps(id) on delete cascade,
 resources jsonb not null default '{"wood":0,"stone":0,"food":0,"gold":0}',
 stock_updated_at timestamptz not null default public.peris_game_now(),
 next_recruit_at timestamptz not null default public.peris_game_now()+interval '1 minute',
 recruit_sequence bigint not null default 0, engaged_battle_id bigint
);
revoke all on public.peris_camp_stock from public,anon,authenticated;
alter table public.peris_camp_stock alter column stock_updated_at set default public.peris_game_now();
alter table public.peris_camp_stock alter column next_recruit_at set default public.peris_game_now()+interval '1 minute';
alter table public.peris_camp_stock enable row level security;
insert into public.peris_camp_stock(camp_id,next_recruit_at)select id,public.peris_game_now()+make_interval(secs=>60+floor(random()*241)::integer)from public.peris_camps where bandit on conflict do nothing;
alter table public.peris_reports add column if not exists camp_id integer;
alter table public.peris_reports add column if not exists farm_list_id bigint;
alter table public.armies add column if not exists loot_report_id bigint;
alter table public.peris_campaign_farms add column if not exists route jsonb;
alter table public.peris_campaign_farms add column if not exists enabled boolean not null default false;
alter table public.peris_campaign_farms add column if not exists interval_seconds integer not null default 300 check(interval_seconds between 60 and 86400);
alter table public.peris_campaign_farms add column if not exists next_at timestamptz;
alter table public.peris_campaign_farms add column if not exists last_status text;
create index if not exists peris_farms_due on public.peris_campaign_farms(next_at,id)where enabled;

create or replace function public.peris_camp_accrue(p_camp integer,p_until timestamptz default public.peris_game_now())returns void language plpgsql security definer set search_path='' as $$
declare c public.peris_camps%rowtype;s public.peris_camp_stock%rowtype;rates integer[];capacity integer;batch_min integer;batch_max integer;cap integer;minutes numeric;r text;i integer:=1;amount integer;steps integer:=0;stock jsonb;
begin
 select * into c from public.peris_camps where id=p_camp and bandit for update;if c.id is null then return;end if;
 select * into s from public.peris_camp_stock where camp_id=p_camp for update;
 if s.camp_id is null then return;end if;
 rates:=case when c.tier>=6 then array[24,15,15,6]when c.tier<=2 then array[3,2,2,1]else array[9,6,6,3]end;
 cap:=greatest(case when c.tier>=6 then 250 when c.tier<=2 then 30 else 100 end,ceil((array[30,50,80,120,180,260,360,480,610,720])[least(10,greatest(1,c.tier))]*1.08)::integer);
 batch_min:=case when c.tier>=6 then 4 when c.tier<=2 then 1 else 2 end;batch_max:=case when c.tier>=6 then 10 when c.tier<=2 then 3 else 6 end;
 if s.engaged_battle_id is null then
  while s.next_recruit_at<=p_until and steps<1024 loop
   steps:=steps+1;
   amount:=greatest(0,least(cap-c.infantry-c.archers-c.cavalry,batch_min+floor(random()*(batch_max-batch_min+1))::integer));
   case (s.recruit_sequence % case when c.tier<=2 then 2 else 3 end)
    when 0 then c.infantry:=c.infantry+amount;when 1 then c.archers:=c.archers+amount;else c.cavalry:=c.cavalry+amount;end case;
   s.recruit_sequence:=s.recruit_sequence+1;s.next_recruit_at:=s.next_recruit_at+make_interval(secs=>60+floor(random()*241)::integer);
   if c.infantry+c.archers+c.cavalry>=cap then s.next_recruit_at:=greatest(p_until,s.next_recruit_at)+make_interval(secs=>60+floor(random()*241)::integer);exit;end if;
  end loop;
  update public.peris_camps set infantry=c.infantry,archers=c.archers,cavalry=c.cavalry where id=c.id;
 end if;
 minutes:=greatest(0,extract(epoch from(p_until-s.stock_updated_at))/60);stock:=s.resources;
 foreach r in array array['wood','stone','food','gold']loop
  stock:=jsonb_set(stock,array[r],to_jsonb(least(rates[i]*30,coalesce((stock->>r)::numeric,0)+rates[i]*minutes)));i:=i+1;
 end loop;
 update public.peris_camp_stock set resources=stock,stock_updated_at=greatest(p_until,s.stock_updated_at),next_recruit_at=s.next_recruit_at,recruit_sequence=s.recruit_sequence where camp_id=c.id;
end $$;

-- Persist battle-time casualty value; signed profit is calculated only from delivery.
create or replace function public.peris_roster_loss_cost(p_initial jsonb,p_survivors jsonb,p_version integer)returns jsonb
language sql stable security definer set search_path='' as $$
 select jsonb_object_agg(resource,amount)from(
  select resource,coalesce(sum(greatest(0,coalesce((p_initial->>c.unit)::integer,0)-coalesce((p_survivors->>c.unit)::integer,0))*(public.peris_unit_stats(c.unit,'roman',p_version)->'cost'->>resource)::numeric),0)as amount
  from unnest(array['wood','stone','food','gold'])keys(resource)cross join public.peris_unit_catalog c group by resource
 )costs where jsonb_typeof(p_initial)='object'and jsonb_typeof(p_survivors)='object'
$$;
create or replace function public.peris_roster_loss_cost(p_initial jsonb,p_survivors jsonb)returns jsonb
language sql stable security definer set search_path='' as $$select public.peris_roster_loss_cost(p_initial,p_survivors,2)$$;
create or replace function public.peris_resource_difference(p_received jsonb,p_spent jsonb)returns jsonb
language sql immutable set search_path='' as $$
 select jsonb_object_agg(resource,coalesce((p_received->>resource)::numeric,0)-coalesce((p_spent->>resource)::numeric,0))from unnest(array['wood','stone','food','gold'])keys(resource)
$$;

create or replace function public.peris_deliver_loot(p_army bigint)returns void language plpgsql security definer set search_path='' as $$
declare a public.armies%rowtype;s public.settlements%rowtype;delivered jsonb:='{}';overflow jsonb:='{}';r text;amount numeric;remaining numeric;
begin
 select * into a from public.armies where id=p_army for update;
 if a.carried_loot is null then return;end if;
 select * into s from public.settlements where id=a.home_settlement_id and owner_id=a.owner_id for update;
 foreach r in array array['wood','stone','food','gold']loop
  amount:=coalesce((a.carried_loot->>r)::numeric,0);remaining:=greatest(0,case when r='food'then s.food_capacity else s.capacity end-(to_jsonb(s)->>r)::numeric);
  delivered:=delivered||jsonb_build_object(r,least(amount,remaining));overflow:=overflow||jsonb_build_object(r,greatest(0,amount-remaining));
 end loop;
 update public.settlements set wood=wood+(delivered->>'wood')::numeric,stone=stone+(delivered->>'stone')::numeric,food=food+(delivered->>'food')::numeric,gold=gold+(delivered->>'gold')::numeric where id=s.id;
 update public.peris_reports set result=result||jsonb_build_object('delivered',delivered,'overflow',overflow,'delivered_at',now())||
  case when coalesce(result->'replacement_cost',public.peris_roster_loss_cost(result->'attacker_roster',result->'attacker_survivor_roster',coalesce((result->>'balance_version')::integer,1)))is not null then jsonb_build_object('estimated_profit',public.peris_resource_difference(delivered,coalesce(result->'replacement_cost',public.peris_roster_loss_cost(result->'attacker_roster',result->'attacker_survivor_roster',coalesce((result->>'balance_version')::integer,1)))))else '{}'::jsonb end where battle_id=a.loot_report_id and owner_id=a.owner_id;
 update public.battles set result=result||jsonb_build_object('delivered',delivered,'overflow',overflow,'delivered_at',now())||
  case when coalesce(result->'replacement_cost',public.peris_roster_loss_cost(result->'attacker_roster',result->'attacker_survivor_roster',coalesce((result->>'balance_version')::integer,1)))is not null then jsonb_build_object('estimated_profit',public.peris_resource_difference(delivered,coalesce(result->'replacement_cost',public.peris_roster_loss_cost(result->'attacker_roster',result->'attacker_survivor_roster',coalesce((result->>'balance_version')::integer,1)))))else '{}'::jsonb end where id=a.loot_report_id and attacker_owner_id=a.owner_id;
 update public.armies set carried_loot=null,loot_report_id=null where id=a.id;
end $$;

create or replace function public.peris_take_camp_loot(p_stock jsonb,p_capacity numeric)returns jsonb
language plpgsql immutable set search_path='' as $$
declare result jsonb:='{}';total numeric;target numeric;assigned numeric:=0;entry record;share numeric;
begin
 select sum(floor(greatest(0,(p_stock->>key)::numeric)))into total from unnest(array['wood','stone','food','gold'])keys(key);
 target:=least(floor(greatest(0,p_capacity)),total);
 if total<=0 then return '{"wood":0,"stone":0,"food":0,"gold":0}';end if;
 for entry in select key,ordinal,floor(greatest(0,(p_stock->>key)::numeric))as amount from unnest(array['wood','stone','food','gold'])with ordinality keys(key,ordinal)loop
  share:=floor(entry.amount*target/total);assigned:=assigned+share;result:=jsonb_set(result,array[entry.key],to_jsonb(share));
 end loop;
 for entry in select key,ordinal,floor(greatest(0,(p_stock->>key)::numeric))as amount from unnest(array['wood','stone','food','gold'])with ordinality keys(key,ordinal)order by mod(floor(greatest(0,(p_stock->>key)::numeric))*target,total)desc,ordinal loop
  exit when assigned>=target;
  if (result->>entry.key)::numeric<entry.amount then result:=jsonb_set(result,array[entry.key],to_jsonb((result->>entry.key)::numeric+1));assigned:=assigned+1;end if;
 end loop;
 return result;
end $$;
-- Repeated camp victories can award gear without reusing a first-clear key.
alter table public.peris_hero_artifacts add column if not exists source_battle_id bigint references public.battles(id) on delete set null;
create unique index if not exists peris_hero_battle_drop on public.peris_hero_artifacts(owner_id,source_battle_id);

create or replace function public.peris_battle_hero_reward(p_army bigint,p_experience integer,p_camp integer,p_battle bigint)returns jsonb
language plpgsql security definer set search_path='' as $$
declare h public.peris_heroes%rowtype;after_xp integer;drop_id bigint;artifact text;tier integer;full_bag boolean:=false;items jsonb:='[]';existing jsonb;faction text;
begin
 select result->'hero_reward' into existing from public.battles where id=p_battle and mode='pve';
 if existing is not null and existing<>'null'::jsonb then return existing;end if;
 select * into h from public.peris_heroes where army_id=p_army for update;
 if h.id is null then return null;end if;
 perform public.peris_hero_reward(p_army,p_experience,null);
 select experience into after_xp from public.peris_heroes where id=h.id;
 select s.faction into faction from public.armies a join public.settlements s on s.id=a.home_settlement_id where a.id=p_army;
 if p_camp is not null then
  select count(*)>=200 into full_bag from public.peris_hero_artifacts where owner_id=h.owner_id;
  if not full_bag then
   select c.tier into tier from public.peris_camps c where c.id=p_camp;
   artifact:=public.peris_npc_artifact(tier,p_camp,p_battle);
   insert into public.peris_hero_artifacts(owner_id,artifact_id,slot,source_battle_id)
   select h.owner_id,c.id,c.slot,p_battle from public.peris_artifact_catalog c where c.id=artifact
   on conflict(owner_id,source_battle_id)do nothing returning id into drop_id;
   if drop_id is not null then items:=jsonb_build_array(jsonb_build_object('id',drop_id,'artifact_id',artifact));end if;
  end if;
 end if;
 return jsonb_build_object('hero_id',h.id,'hero_name',h.name,'hero_class',h.class,'faction',faction,
 'experience',after_xp-h.experience,'experience_before',h.experience,'experience_after',after_xp,
 'level_before',public.peris_hero_level(h.experience),'level_after',public.peris_hero_level(after_xp),
 'artifacts',items,'inventory_full',full_bag);
end $$;
create or replace function public.peris_science_ensure(p_owner uuid)returns void language sql security definer set search_path='' as $$
 insert into public.peris_account_science(owner_id)select id from public.players where id=p_owner on conflict do nothing
$$;
create or replace function public.peris_science_rate(p_owner uuid)returns numeric language sql stable security definer set search_path='' as $$
 select (6+coalesce(sum(case c.level when 1 then 12 when 2 then 28 when 3 then 48 when 4 then 72 when 5 then 100 else 0 end),0))*public.peris_research_factor(p_owner,'science')
 from public.peris_city_slots c join public.settlements s on s.id=c.settlement_id where s.owner_id=p_owner and c.building_type='academy'
$$;
create or replace function public.peris_science_deadline(p_owner uuid)returns timestamptz language sql stable security definer set search_path='' as $$
 select s.active_since+make_interval(secs=>ceil((c.seconds-p.seconds)/s.active_rate*1000-1e-7)::double precision/1000)
 from public.peris_account_science s join public.peris_technology_catalog c on c.id=s.active_id join public.peris_research_progress p on p.owner_id=s.owner_id and p.technology_id=s.active_id where s.owner_id=p_owner
$$;
create or replace function public.peris_science_accrue(p_owner uuid,p_until timestamptz)returns void language plpgsql security definer set search_path='' as $$
begin
 perform public.peris_science_ensure(p_owner);
 update public.peris_account_science set points=least(1000000000,points+greatest(0,extract(epoch from(p_until-updated_at)))/60*public.peris_science_rate(p_owner)),updated_at=greatest(updated_at,p_until)where owner_id=p_owner;
end $$;
create or replace function public.peris_science_advance(p_owner uuid,p_until timestamptz)returns void language plpgsql security definer set search_path='' as $$
declare s public.peris_account_science%rowtype;due timestamptz;c public.peris_technology_catalog%rowtype;city record;
begin
 perform public.peris_science_ensure(p_owner);select * into s from public.peris_account_science where owner_id=p_owner for update;
 due:=public.peris_science_deadline(p_owner);
 if due is not null and due<=p_until then
  perform public.peris_science_accrue(p_owner,due);perform public.peris_culture_accrue(p_owner,due);
  for city in select id from public.settlements where owner_id=p_owner order by id loop perform public.peris_population_accrue(city.id,due);end loop;
  select * into c from public.peris_technology_catalog where id=s.active_id;
  update public.peris_research_progress set seconds=c.seconds,completed_at=due where owner_id=p_owner and technology_id=c.id and completed_at is null;
  update public.peris_account_science set active_id=null,active_since=null where owner_id=p_owner;
  for city in select id from public.settlements where owner_id=p_owner order by id loop perform public.peris_city_economy(city.id);end loop;
 end if;
 perform public.peris_science_accrue(p_owner,p_until);
end $$;
create or replace function public.peris_research_pause(p_owner uuid,p_until timestamptz)returns void language plpgsql security definer set search_path='' as $$
declare s public.peris_account_science%rowtype;
begin
 perform public.peris_science_advance(p_owner,p_until);select * into s from public.peris_account_science where owner_id=p_owner for update;
 if s.active_id is not null then
  update public.peris_research_progress p set seconds=least(c.seconds,p.seconds+greatest(0,extract(epoch from(p_until-s.active_since)))*s.active_rate)from public.peris_technology_catalog c where c.id=s.active_id and p.owner_id=p_owner and p.technology_id=c.id;
 end if;
 update public.peris_account_science set active_id=null,active_since=null where owner_id=p_owner;
end $$;
create or replace function public.peris_research_command(p_command jsonb)returns jsonb language plpgsql security definer set search_path='' as $$
declare u uuid:=public.peris_player_id();s public.peris_account_science%rowtype;c public.peris_technology_catalog%rowtype;p public.peris_research_progress%rowtype;kind text:=p_command->>'type';
begin
 if u is null then raise exception 'Authentication required';end if;
 perform public.peris_science_advance(u,public.peris_game_now());select * into s from public.peris_account_science where owner_id=u for update;
 if kind='pauseResearch'then perform public.peris_research_pause(u,public.peris_game_now());
 elsif kind='debugResearch'then
  if not coalesce((select enabled from public.peris_debug_config where id),false)then raise exception 'Debug controls are disabled';end if;
  if p_command->>'action'='points'then update public.peris_account_science set points=least(1000000000,points+10000)where owner_id=u;
  elsif p_command->>'action'='complete'then
   if s.active_id is null then raise exception 'Start a technology first';end if;
   update public.peris_research_progress p set seconds=c.seconds from public.peris_technology_catalog c where c.id=s.active_id and p.owner_id=u and p.technology_id=c.id;
   update public.peris_account_science set active_since=public.peris_game_now()where owner_id=u;perform public.peris_science_advance(u,public.peris_game_now());
  else raise exception 'Unknown research debug action';end if;
 elsif kind='startResearch'then
  select * into c from public.peris_technology_catalog where id=p_command->>'technologyId';
  if c.id is null then raise exception 'Unknown technology';end if;
  if c.faction is not null and c.faction is distinct from coalesce((select faction from public.settlements where owner_id=u order by id limit 1),'roman')then raise exception 'This technology belongs to another faction';end if;
  select * into p from public.peris_research_progress where owner_id=u and technology_id=c.id;
  if p.completed_at is not null then raise exception 'Already researched';end if;
  if exists(select 1 from jsonb_array_elements_text(c.prerequisites)r(id)where not exists(select 1 from public.peris_research_progress where owner_id=u and technology_id=r.id and completed_at is not null))then raise exception 'Research the prerequisites first';end if;
  if s.active_id=c.id then return jsonb_build_object('ok',true);end if;
  if p.technology_id is null and s.points<c.cost then raise exception 'You need % science points',c.cost;end if;
  perform public.peris_research_pause(u,public.peris_game_now());
  if p.technology_id is null then update public.peris_account_science set points=points-c.cost where owner_id=u;insert into public.peris_research_progress(owner_id,technology_id)values(u,c.id);end if;
  update public.peris_account_science set active_id=c.id,active_since=public.peris_game_now(),active_rate=public.peris_research_factor(u,'research_speed')where owner_id=u;
 else raise exception 'Unknown research command';end if;
 return jsonb_build_object('ok',true);
end $$;
-- Private worker deadlines and owner-filtered realtime invalidation.
create index if not exists peris_science_active on public.peris_account_science(active_since)where active_id is not null;

alter table public.battle_formations drop constraint if exists battle_formations_unit_attack_check;
alter table public.battle_formations add constraint battle_formations_unit_attack_check check(unit_attack between .4 and 20);
alter table public.battle_formations drop constraint if exists battle_formations_unit_defence_check;
alter table public.battle_formations add constraint battle_formations_unit_defence_check check(unit_defence between .5 and 20);
create or replace function public.peris_settle(p_owner uuid,p_until timestamptz default public.peris_game_now()) returns void
language plpgsql security definer set search_path='' as $$
declare s public.settlements%rowtype;o public.peris_orders%rowtype;event record;target_slot integer;field_col integer;field_row integer;arriving_army bigint;
begin
 -- Cell reservation lock precedes player locks everywhere, including offline arrivals.
 if exists(select 1 from public.peris_settler_expeditions where owner_id=p_owner and status='travelling'and arrival_at<=p_until)then perform pg_advisory_xact_lock(204200);end if;
 perform 1 from public.players where id=p_owner for update;
 if not found then return;end if;
 if exists(select 1 from public.players where id=p_owner and defeated_at is not null)then return;end if;
 perform public.peris_ruin_advance(p_owner,p_until);
 perform public.peris_city_reinforcements_advance(p_owner,p_until);
 if to_regprocedure('public.peris_guild_reinforcements_advance(uuid,timestamp with time zone)')is not null then
  perform public.peris_guild_reinforcements_advance(p_owner,p_until);
 end if;
 for s in select * from public.settlements where owner_id=p_owner and ruined_at is null order by id for update loop
 perform public.peris_city_migrate(s.id);if not s.population_ready then perform public.peris_city_economy(s.id);end if;
 end loop;
 for event in select id,finish_at as at_time,false as expedition from public.peris_orders where owner_id=p_owner and finish_at<=p_until
 union all select id,arrival_at as at_time,true as expedition from public.peris_settler_expeditions where owner_id=p_owner and status='travelling'and arrival_at<=p_until
 order by at_time,expedition,id loop
 perform public.peris_science_advance(p_owner,event.at_time);
 perform public.peris_culture_accrue(p_owner,event.at_time);
 if event.expedition then perform public.peris_found_complete(event.id);continue;end if;
 select * into o from public.peris_orders where id=event.id for update;
 select * into s from public.settlements where id=coalesce(o.settlement_id,(select min(id)from public.settlements where owner_id=p_owner and ruined_at is null))and owner_id=p_owner for update;
 if s.id is null or s.ruined_at is not null then delete from public.peris_orders where id=o.id;continue;end if;
 perform public.peris_population_accrue(s.id,o.finish_at);
 if o.kind='upgrade' then
  if o.item like 'slot:%' then
   target_slot:=split_part(o.item,':',2)::integer;
   update public.peris_city_slots set level=least(case when building_type='mage_tower' then 10 else 5 end,level+1)where settlement_id=s.id and slot_index=target_slot;
  else update public.buildings set level=least(5,level+1),updated_at=o.finish_at where settlement_id=s.id and building_type=o.item;end if;
  update public.players set upgrades=upgrades+1 where id=p_owner;update public.settlements set development_points=development_points+1 where id=s.id;perform public.peris_city_economy(s.id);
 elsif o.kind='field' then
  field_col:=split_part(o.item,':',2)::integer;field_row:=split_part(o.item,':',3)::integer;
  update public.peris_map_plots set level=level+1 where col=field_col and row=field_row and owner_id=p_owner and settlement_id=s.id and building_type=split_part(o.item,':',4) and level<5;
  if not found then raise exception 'Queued external field no longer matches its owner or building';end if;
  update public.players set upgrades=upgrades+1 where id=p_owner;update public.settlements set development_points=development_points+1 where id=s.id;perform public.peris_city_economy(s.id);
 elsif o.kind='settler'then update public.settlements set settlers=settlers+o.quantity where id=s.id;
 elsif o.kind='recruit' then
  if o.recruit_destination='garrison' then
   perform public.peris_city_garrison_receive(p_owner,s.id,jsonb_build_object(o.item,o.quantity));
  else
   perform public.peris_recruit_complete(coalesce(o.army_id,(select min(id)from public.armies where owner_id=p_owner)),o.item,o.quantity);
  end if;
  update public.players set recruits=recruits+o.quantity where id=p_owner;
 end if;
 delete from public.peris_orders where id=o.id;
 end loop;
 perform public.peris_science_advance(p_owner,p_until);
 perform public.peris_culture_accrue(p_owner,p_until);
 for s in select * from public.settlements where owner_id=p_owner and ruined_at is null order by id loop perform public.peris_population_accrue(s.id,p_until);end loop;
 for arriving_army in select id from public.armies where owner_id=p_owner and status='moving' and raid_target_id is null and raid_city_id is null and arrival_at<=p_until order by id for update loop
  if not exists(select 1 from public.armies a where a.id=arriving_army and public.peris_station_owned(p_owner,floor(a.target_x/128.0)::integer,floor(a.target_y/128.0)::integer))then
   perform public.peris_ruin_redirect_army(arriving_army);continue;
  end if;
  perform public.peris_deliver_loot(arriving_army);
  update public.armies set status='idle',start_x=target_x,start_y=target_y,march_path=null,march_distance=null,
   march_sent_at=null,march_cancel_until=null,march_origin=null,march_returning=false,updated_at=p_until where id=arriving_army;
  if not exists(select 1 from public.battles b join public.settlements c on c.id=b.raid_city_id join public.armies a on a.id=arriving_army where b.status='active'and b.defender_owner_id=p_owner and floor(c.x/128.0)=floor(a.target_x/128.0)and floor(c.y/128.0)=floor(a.target_y/128.0))then perform public.peris_garrison_merge(arriving_army);end if;
 end loop;
 -- Attack arrivals retain their outbound route for the eventual return.
 update public.armies set status='idle',start_x=target_x,start_y=target_y,updated_at=p_until where owner_id=p_owner and status='moving'and arrival_at<=p_until;
end $$;
create or replace function public.peris_add_formations(p_battle bigint,p_owner uuid,p_side text,p_inf integer,p_arc integer,p_cav integer,p_morale numeric)
returns void language plpgsql security definer set search_path='' as $$
declare unit_name text;typ text;n integer;total integer;i integer;amount integer;px numeric;py numeric;cap integer;roster jsonb;rule public.peris_unit_catalog;aid bigint;v integer;faction text;stats jsonb;
begin
 select case when p_side='attacker' then attacker_army_id else defender_army_id end into aid from public.battles where id=p_battle;
 select balance_version,case when p_side='attacker'then coalesce(attacker_faction,'roman')else coalesce(defender_faction,'roman')end into v,faction from public.battles where id=p_battle;
 select public.peris_roster(to_jsonb(a))into roster from public.armies a where a.id=aid and a.owner_id=p_owner;
 roster:=coalesce(roster,public.peris_roster(jsonb_build_object('infantry',p_inf,'archers',p_arc,'cavalry',p_cav)));
 if p_side='defender'and exists(select 1 from public.battles where id=p_battle and raid_city_id is not null)then roster:=public.peris_city_defender_roster(p_battle);end if;
 foreach unit_name in array array['infantry','spearmen','archers','elite','cavalry','scout','heavyCavalry','ram','catapult']loop
 select * into rule from public.peris_unit_catalog where unit=unit_name;typ:=rule.combat_class;total:=(roster->>unit_name)::integer;
 stats:=public.peris_unit_stats(unit_name,faction,v);
 cap:=case typ when 'infantry' then 60 when 'archers' then 40 else 24 end;
 n:=least(6,ceil(total::numeric/cap)::integer);if n<=0 then continue;end if;
 for i in 0..n-1 loop
 amount:=total/n+case when i<total%n then 1 else 0 end;
 px:=case when p_side='attacker' then case when typ='infantry'then 285 when typ='cavalry'then 205 else 175 end else case when typ='infantry'then 915 when typ='cavalry'then 995 else 1025 end end;
 px:=px+600*(sqrt(5)-1);
 py:=case when typ='cavalry' then case when i%2=0 then 75+(i/2)*65 else 625-(i/2)*65 end else round(350+(i-(n-1)/2.0)*least(105,490.0/greatest(1,n-1))) end;
 py:=py+350*(sqrt(5)-1);
 insert into public.battle_formations(battle_id,owner_id,side,unit_type,recruit_unit,unit_attack,unit_defence,unit_speed,label,initial_soldiers,soldiers,morale,x,y,target_x,target_y,facing,columns)
 values(p_battle,p_owner,p_side,typ,unit_name,(stats->>'attack')::numeric,(stats->>'defence')::numeric,rule.speed::numeric/case typ when 'infantry'then 40 when 'archers'then 34 else 76 end,unit_name||' '||(i+1),amount,amount,least(100,p_morale),px,py,px,py,case when p_side='attacker' then 0 else 180 end,case when typ='cavalry' then 6 else 10 end);
 end loop;end loop;
 -- Advanced formations share the same class lane without spawning on top of one another.
 if exists(select 1 from public.battle_formations where battle_id=p_battle and side=p_side and recruit_unit not in('infantry','archers','cavalry'))then
  with lanes as(select id,row_number()over(partition by unit_type order by id)-1 as i,count(*)over(partition by unit_type)as n from public.battle_formations where battle_id=p_battle and side=p_side)
  update public.battle_formations f set y=350*sqrt(5)+(l.i-(l.n-1)/2.0)*least(105,490.0/greatest(1,l.n-1)),target_y=350*sqrt(5)+(l.i-(l.n-1)/2.0)*least(105,490.0/greatest(1,l.n-1))from lanes l where f.id=l.id;
 end if;
 perform public.peris_apply_hero(p_battle,p_owner,p_side);
end $$;
create or replace function public.peris_start_raid(p_owner uuid,p_camp integer) returns bigint
language plpgsql security definer set search_path='' as $$
declare a public.armies%rowtype;c public.peris_camps%rowtype;bid bigint;mor numeric;shared_stock boolean;
begin
 select * into a from public.armies where id=public.peris_army_id(p_owner) for update;
 select * into c from public.peris_camps where id=p_camp for update;
 if c.id is null or a.id is null then raise exception 'Army or camp not found';end if;
 shared_stock:=c.bandit and to_regclass('public.peris_camp_stock')is not null;
 if shared_stock then
  perform public.peris_camp_accrue(p_camp);
  if exists(select 1 from public.peris_camp_stock where camp_id=p_camp and engaged_battle_id is not null)then return null;end if;
  select * into c from public.peris_camps where id=p_camp;
 end if;
 if a.infantry+a.archers+a.cavalry=0 then raise exception 'Your army has no soldiers';end if;
 if exists(select 1 from public.battles where status='active' and (attacker_owner_id=p_owner or defender_owner_id=p_owner)) then raise exception 'Finish the current battle first';end if;
 if not shared_stock and exists(select 1 from public.peris_progress where owner_id=p_owner and camp_id=p_camp and available_at>public.peris_game_now()) then raise exception 'The camp is still regrouping';end if;
 insert into public.battles(attacker_owner_id,defender_owner_id,attacker_army_id,defender_army_id,mode,phase,camp_id,terrain,difficulty,enemy_name,defender_ready,defender_faction)
 values(p_owner,null,a.id,null,'pve','combat',c.id,public.peris_battle_terrain(c.x,c.y),case when c.tier>=6 then 'hard' when c.tier<=2 then 'easy' else 'normal' end,c.name,true,c.faction) returning id into bid;
 if shared_stock then update public.peris_camp_stock set engaged_battle_id=bid where camp_id=c.id;end if;
 select 90+2*level into mor from public.buildings where settlement_id=a.home_settlement_id and building_type='wall';
 perform public.peris_add_formations(bid,p_owner,'attacker',a.infantry,a.archers,a.cavalry,coalesce(mor,92));
 perform public.peris_add_formations(bid,null,'defender',c.infantry,c.archers,c.cavalry,case when c.tier>=6 then 100 when c.tier<=2 then 78 else 90 end);
 update public.armies set raid_target_id=null where id=a.id;
 return bid;
end $$;

create or replace function public.peris_sync_owner(p_owner uuid)returns jsonb language plpgsql security definer set search_path='' as $$
declare u uuid:=p_owner;a public.armies%rowtype;
begin
 if u is null then raise exception 'Authentication required';end if;
 perform public.peris_settle(u);
 if not exists(select 1 from public.battles where status='active'and(attacker_owner_id=u or defender_owner_id=u))then
 for a in select * from public.armies where owner_id=u and raid_city_id is not null and status='idle'order by arrival_at,id for update loop
  if a.infantry+a.archers+a.cavalry=0 or not exists(select 1 from public.settlements where id=a.raid_city_id and owner_id<>u and ruined_at is null)then perform public.peris_return_raid(a.id);continue;end if;
  if public.peris_start_city_raid(u,a.id)is not null then exit;end if;
 end loop;
 end if;
 if not exists(select 1 from public.battles where status='active'and(attacker_owner_id=u or defender_owner_id=u))then
 for a in select * from public.armies where owner_id=u and raid_target_id is not null and status='idle'order by arrival_at,id for update loop
  if (not exists(select 1 from public.peris_camps where id=a.raid_target_id and bandit) and exists(select 1 from public.peris_progress where owner_id=u and camp_id=a.raid_target_id and available_at>public.peris_game_now()))or a.infantry+a.archers+a.cavalry=0 then
   perform public.peris_restore_raid_reserve(a.id);perform public.peris_return_raid(a.id);update public.armies set raid_target_id=null where id=a.id;continue;
  end if;
  perform set_config('peris.army_id',a.id::text,true);perform public.peris_start_raid(u,a.raid_target_id);exit;
 end loop;
 end if;
 return jsonb_build_object('ok',true);
end $$;

create or replace function public.sync_my_state()returns jsonb language plpgsql security definer set search_path='' as $$
begin return public.peris_sync_owner(public.peris_player_id());end $$;
create or replace function public.peris_queue_upgrade(p_type text) returns jsonb language plpgsql security definer set search_path='' as $$
declare u uuid:=public.peris_player_id();s public.settlements%rowtype;l integer;factor numeric;cw numeric;cs numeric;cf numeric;cg numeric;
begin
 if u is null then raise exception 'Authentication required';end if;
 if p_type is null or p_type not in ('market','wall','lumber','quarry','farm') then raise exception 'Choose a building plot for this building';end if;
 perform public.peris_settle(u);
 if exists(select 1 from public.battles where status='active' and (attacker_owner_id=u or defender_owner_id=u)) then raise exception 'Finish the current battle first';end if;
 select * into s from public.settlements where id=public.peris_city_id(u) for update;
 select level into l from public.buildings where settlement_id=s.id and building_type=p_type;
 if l is null then raise exception 'Building not found';end if;
 if l>=5 then raise exception 'Maximum level reached';end if;
 if exists(select 1 from public.peris_orders where owner_id=u and settlement_id=s.id and kind='upgrade') then raise exception 'Your builders are already working';end if;
 factor:=power(1.55::numeric,greatest(0,l));
 cw:=ceil((case p_type when 'lumber' then 150 when 'quarry' then 110 when 'farm' then 100 when 'market' then 140 when 'barracks' then 180 when 'stables' then 200 when 'wall' then 100 else 200 end)*factor);
 cs:=ceil((case p_type when 'lumber' then 90 when 'quarry' then 150 when 'farm' then 80 when 'market' then 130 when 'barracks' then 160 when 'stables' then 120 when 'wall' then 240 else 150 end)*factor);
 cf:=ceil((case p_type when 'lumber' then 70 when 'quarry' then 70 when 'farm' then 150 when 'market' then 80 when 'barracks' then 100 when 'stables' then 180 when 'wall' then 80 else 90 end)*factor);
 cg:=ceil((case p_type when 'lumber' then 10 when 'quarry' then 10 when 'farm' then 8 when 'market' then 25 when 'barracks' then 30 when 'stables' then 45 when 'wall' then 25 else 20 end)*factor);
 if s.wood<cw or s.stone<cs or s.food<cf or s.gold<cg then raise exception 'Your stores cannot cover this cost';end if;
 update public.settlements set wood=wood-cw,stone=stone-cs,food=food-cf,gold=gold-cg where id=s.id;
 insert into public.peris_orders(owner_id,kind,item,quantity,started_at,finish_at)values(u,'upgrade',p_type,1,public.peris_game_now(),public.peris_game_now()+make_interval(secs=>greatest(1,ceil((15+l*10)/public.peris_research_factor(u,'construction')))::double precision));
 return jsonb_build_object('ok',true);
end $$;

-- Dedicated destination is recorded on the order; training is still queued in the
-- city's ordinary recruitment building and resolves on the same offline tick.
create or replace function public.peris_queue_recruit_to(p_type text,p_quantity integer,p_destination text)returns jsonb
language plpgsql security definer set search_path='' as $$
declare u uuid:=public.peris_player_id();s public.settlements%rowtype;a public.armies%rowtype;
 l integer;at_time timestamptz;duration numeric;queued integer;queue_size integer;home jsonb;r public.peris_unit_catalog%rowtype;
begin
 if u is null then raise exception 'Authentication required';end if;
 if p_destination not in('legion','garrison')or p_destination is null then raise exception 'Choose a recruitment destination';end if;
 select * into r from public.peris_unit_catalog where unit=p_type;
 if r.unit is null or p_quantity is null or p_quantity<1 or p_quantity>200 then raise exception 'Choose between 1 and 200 soldiers';end if;
 perform public.peris_settle(u);
 if exists(select 1 from public.battles where status='active'and(attacker_owner_id=u or defender_owner_id=u))then raise exception 'Finish the current battle first';end if;
 select * into s from public.settlements where id=public.peris_city_id(u) and owner_id=u and ruined_at is null for update;
 if s.id is null then raise exception 'Choose your own living city';end if;
 if p_destination='legion' then
  select * into a from public.armies where id=public.peris_army_id(u) and owner_id=u for update;
  if a.id is null then raise exception 'Choose your legion';end if;
  home:=public.peris_home_army_position(s.x,s.y);
  if a.status='moving' or a.raid_target_id is not null or a.raid_city_id is not null or a.raid_reserve is not null
   or sqrt(power(a.target_x-(home->>'x')::integer,2)+power(a.target_y-(home->>'y')::integer,2))>90 then
   raise exception 'Bring your army home to recruit';end if;
  select count(*),coalesce(sum(quantity),0)into queue_size,queued from public.peris_orders
   where owner_id=u and army_id=a.id and kind='recruit'and recruit_destination='legion';
  if queue_size>=3 then raise exception 'Training queue is full';end if;
  if a.infantry+a.archers+a.cavalry+queued+p_quantity>1000 then raise exception 'Army capacity is 1,000 soldiers';end if;
 else
  select count(*)into queue_size from public.peris_orders where owner_id=u and settlement_id=s.id and kind='recruit'and recruit_destination='garrison';
  if queue_size>=3 then raise exception 'Garrison training queue is full';end if;
 end if;
 select coalesce(sum(level),0)into l from public.peris_city_slots where settlement_id=s.id and building_type=r.building;
 if l=0 then raise exception 'Build % first',r.building;end if;
 if r.research_seconds>0 and public.peris_research_bonus(u,'unlock_'||p_type)=0
  and not exists(select 1 from public.peris_unit_research where settlement_id=s.id and unit=p_type and completes_at<=public.peris_game_now())then
  raise exception 'Research this unit in this village first';end if;
 if s.wood<(r.cost->>'wood')::integer*p_quantity or s.stone<(r.cost->>'stone')::integer*p_quantity or
    s.food<(r.cost->>'food')::integer*p_quantity or s.gold<(r.cost->>'gold')::integer*p_quantity then raise exception 'Your stores cannot cover this cost';end if;
 select greatest(public.peris_game_now(),coalesce(max(o.finish_at),public.peris_game_now()))into at_time from public.peris_orders o
 join public.peris_unit_catalog c on c.unit=o.item where o.settlement_id=s.id and o.kind='recruit'and c.building=r.building;
 duration:=greatest(5,ceil(p_quantity*r.train_seconds/((1+(l-1)*.18)*public.peris_research_factor(u,'training'))));
 update public.settlements set wood=wood-(r.cost->>'wood')::integer*p_quantity,
  stone=stone-(r.cost->>'stone')::integer*p_quantity,food=food-(r.cost->>'food')::integer*p_quantity,
  gold=gold-(r.cost->>'gold')::integer*p_quantity where id=s.id;
 insert into public.peris_orders(owner_id,settlement_id,army_id,recruit_destination,kind,item,quantity,started_at,finish_at)
 values(u,s.id,case when p_destination='legion'then a.id else null end,p_destination,'recruit',p_type,p_quantity,
  at_time,at_time+make_interval(secs=>duration::double precision));
 return jsonb_build_object('ok',true,'destination',p_destination);
end $$;
revoke all on function public.peris_queue_recruit_to(text,integer,text) from public,anon,authenticated;

-- Maintain the existing public two-argument recruitment RPC for older clients.
create or replace function public.peris_queue_recruit(p_type text,p_quantity integer)returns jsonb
language sql security definer set search_path='' as $$
 select public.peris_queue_recruit_to(p_type,p_quantity,'legion')
$$;

create or replace function public.peris_research_unit(p_city bigint,p_unit text) returns jsonb language plpgsql security definer set search_path='' as $$
declare u uuid:=public.peris_player_id();s public.settlements%rowtype;r public.peris_unit_catalog%rowtype;at_time timestamptz;
begin
 if u is null then raise exception 'Authentication required';end if;
 perform public.peris_settle(u);
 if exists(select 1 from public.battles where status='active' and (attacker_owner_id=u or defender_owner_id=u))then raise exception 'Finish the current battle first';end if;
 select * into s from public.settlements where id=coalesce(p_city,public.peris_city_id(u)) and owner_id=u for update;
 select * into r from public.peris_unit_catalog where unit=p_unit;
 if s.id is null or r.unit is null then raise exception 'Choose your own village and a known unit';end if;
 if r.research_seconds=0 or exists(select 1 from public.peris_unit_research where settlement_id=s.id and unit=r.unit)then raise exception 'This unit is already researched or queued';end if;
 if not exists(select 1 from public.peris_city_slots where settlement_id=s.id and building_type=r.building and level>0)then raise exception 'Build % first',r.building;end if;
 if s.wood<(r.research_cost->>'wood')::integer or s.stone<(r.research_cost->>'stone')::integer or s.food<(r.research_cost->>'food')::integer or s.gold<(r.research_cost->>'gold')::integer then raise exception 'Your stores cannot cover this research';end if;
 select greatest(public.peris_game_now(),coalesce(max(research.completes_at),public.peris_game_now()))into at_time from public.peris_unit_research research join public.peris_unit_catalog c on c.unit=research.unit where research.settlement_id=s.id and c.building=r.building;
 update public.settlements set wood=wood-(r.research_cost->>'wood')::integer,stone=stone-(r.research_cost->>'stone')::integer,food=food-(r.research_cost->>'food')::integer,gold=gold-(r.research_cost->>'gold')::integer where id=s.id;
 insert into public.peris_unit_research values(s.id,r.unit,at_time+make_interval(secs=>r.research_seconds));
 return jsonb_build_object('ok',true);
end $$;
-- Catalog pace applies only when accepting a new journey; saved journey deadlines remain unchanged.
create or replace function public.peris_march_speed(p_army bigint,p_troops jsonb default null)returns numeric
language sql stable security definer set search_path='' as $$
 select 22*coalesce((select min(c.speed)from public.peris_unit_catalog c where coalesce((coalesce(p_troops,public.peris_roster(to_jsonb(a)))->>c.unit)::integer,0)>0),40)/40::numeric*(public.peris_hero_bonuses(a.id)->>'speed')::numeric
 from public.armies a where a.id=p_army
$$;
revoke all on function public.peris_march_speed(bigint,jsonb)from public,anon,authenticated;

create or replace function public.peris_march_for_target(p_owner uuid,p_army bigint,p_target_x integer,p_target_y integer,p_path jsonb,p_raid integer,p_city bigint)returns jsonb
language plpgsql security definer set search_path='' as $$
declare u uuid:=p_owner;a public.armies%rowtype;position jsonb;point jsonb;route jsonb;
 tx integer:=public.peris_wrap_world(p_target_x);ty integer:=public.peris_wrap_world(p_target_y);
 x numeric;y numeric;px numeric;py numeric;cx integer;cy integer;pcx integer;pcy integer;
 distance numeric:=0;segment numeric;seconds numeric;count_points integer;ordinal integer:=0;raid_target integer:=p_raid;
begin
 if u is null then raise exception 'Authentication required';end if;
 if p_target_x is null or p_target_y is null then raise exception 'Choose a destination';end if;
 if p_path is null or jsonb_typeof(p_path)<>'array' then raise exception 'Choose a valid land route';end if;
 count_points:=jsonb_array_length(p_path);
 if count_points<2 or count_points>2000 then raise exception 'A march needs 2-2000 route points';end if;
 perform public.peris_settle(u);
 if exists(select 1 from public.battles where status='active' and (attacker_owner_id=u or defender_owner_id=u)) then raise exception 'Finish the current battle first';end if;
 if exists(select 1 from public.peris_orders where owner_id=u and army_id=p_army and kind='recruit') then raise exception 'Let training finish before marching';end if;
 select * into a from public.armies where id=p_army and owner_id=u for update;
 if a.id is null then raise exception 'Army not found';end if;
 if a.status<>'idle' or a.raid_target_id is not null or a.raid_city_id is not null or a.raid_reserve is not null then raise exception 'This legion already has a march or raid. Cancel within 30 seconds or wait for its return';end if;
 position:=public.peris_army_position(a);
 px:=(position->>'x')::numeric;py:=(position->>'y')::numeric;
 if (raid_target is not null or p_city is not null) and not public.peris_station_owned(u,floor(px/128)::integer,floor(py/128)::integer)then raise exception 'Depart from one of your own villages or claimed fields';end if;
 if p_city is not null and not exists(select 1 from public.settlements c where c.id=p_city and c.owner_id<>u and c.ruined_at is null and c.x=tx and c.y=ty)then raise exception 'Choose another player''s city';end if;
 if not public.peris_station_owned(u,floor(tx/128.0)::integer,floor(ty/128.0)::integer) and not exists(select 1 from public.peris_camps c where c.id=raid_target and c.x=tx and c.y=ty)and p_city is null then raise exception 'Troops can only station in your own villages and fields';end if;
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
   if abs(public.peris_wrap_cell(cx-pcx))>1 or abs(public.peris_wrap_cell(cy-pcy))>1 then raise exception 'Route does not start at your army';end if;
   continue;
  end if;
  if abs(public.peris_wrap_cell(cx-pcx))>1 or abs(public.peris_wrap_cell(cy-pcy))>1 then raise exception 'Route points must pass through neighboring fields';end if;
  if not public.peris_world_walkable(x,y) then raise exception 'Armies cannot march across the sea';end if;
  if cx<>pcx and cy<>pcy and (not public.peris_world_walkable((cx+.5)*128,(pcy+.5)*128) or not public.peris_world_walkable((pcx+.5)*128,(cy+.5)*128)) then
   raise exception 'A route cannot cut a sea corner';
  end if;
  segment:=sqrt(power(public.peris_wrapped_delta(px,x),2)+power(public.peris_wrapped_delta(py,y),2));
  if segment=0 and count_points>2 then raise exception 'A route must advance through its fields';end if;
  distance:=distance+segment;route:=route||jsonb_build_array(jsonb_build_array(x,y));
  px:=x;py:=y;pcx:=cx;pcy:=cy;
 end loop;
 if px<>tx or py<>ty then raise exception 'Route must end at the chosen destination';end if;
 seconds:=greatest(2,distance/public.peris_march_speed(a.id));
 update public.armies set start_x=round((position->>'x')::numeric),start_y=round((position->>'y')::numeric),target_x=tx,target_y=ty,
  march_path=route,march_distance=distance,march_map_version=4,march_sent_at=public.peris_game_now(),march_cancel_until=public.peris_game_now()+interval '30 seconds',
  march_origin=jsonb_build_object('col',floor((position->>'x')::numeric/128),'row',floor((position->>'y')::numeric/128),'x',round((position->>'x')::numeric),'y',round((position->>'y')::numeric)),march_returning=false,
  departure_at=public.peris_game_now()+interval '30 seconds',arrival_at=public.peris_game_now()+interval '30 seconds'+make_interval(secs=>seconds::double precision),
  status='moving',raid_target_id=null,raid_city_id=p_city,siege_target='auto',farm_list_id=null,updated_at=now() where id=a.id;
 return jsonb_build_object('ok',true);
end $$;

create or replace function public.peris_march_for(p_owner uuid,p_army bigint,p_target_x integer,p_target_y integer,p_path jsonb,p_raid integer default null)returns jsonb
language sql security definer set search_path='' as $$
 select public.peris_march_for_target(p_owner,p_army,p_target_x,p_target_y,p_path,p_raid,null)
$$;

create or replace function public.peris_march(p_target_x integer,p_target_y integer,p_path jsonb)returns jsonb
language plpgsql security definer set search_path='' as $$
declare u uuid:=public.peris_player_id();
begin
 if u is null then raise exception 'Authentication required';end if;
 return public.peris_march_for(u,public.peris_army_id(u),p_target_x,p_target_y,p_path,nullif(current_setting('peris.raid_target',true),'')::integer);
end $$;
-- Compatibility RPCs and raids still use the straight route. Sample every half
-- field so all traversed cells are validated by the authoritative land marcher.
create or replace function public.move_army(p_target_x integer,p_target_y integer)returns jsonb
language plpgsql security definer set search_path='' as $$
declare u uuid:=public.peris_player_id();a public.armies%rowtype;position jsonb;route jsonb;x numeric;y numeric;
 tx integer:=greatest(-12736,least(12736,p_target_x));ty integer:=greatest(-12736,least(12736,p_target_y));steps integer;i integer;
begin
 if u is null then raise exception 'Authentication required';end if;
 if p_target_x is null or p_target_y is null then raise exception 'Choose a destination';end if;
 perform public.peris_settle(u);
 select * into a from public.armies where id=public.peris_army_id(u) for update;
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
begin
 return public.peris_prepare_raid(p_camp_id);
end $$;

create or replace function public.peris_ready(p_battle_id bigint) returns jsonb language plpgsql security definer set search_path='' as $$
declare u uuid:=public.peris_player_id();b public.battles%rowtype;
begin
 select * into b from public.battles where id=p_battle_id for update;
 if u is null or b.id is null or (u is distinct from b.attacker_owner_id and u is distinct from b.defender_owner_id) then raise exception 'Not your battle';end if;
 if b.status='active'and b.phase='deployment'then update public.battles set phase='combat',attacker_ready=true,defender_ready=true,last_tick_at=now()where id=b.id;end if;
 return jsonb_build_object('ok',true);
end $$;
create or replace function public.peris_order(p_battle_id bigint,p_order jsonb) returns jsonb language plpgsql security definer set search_path='' as $$
declare u uuid:=public.peris_player_id();b public.battles%rowtype;f public.battle_formations%rowtype;t public.battle_formations%rowtype;k text:=p_order->>'kind';px numeric;py numeric;n integer;i integer:=0;col integer;face numeric;cx numeric;cy numeric;spacing numeric;ang numeric;
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
 when p_terrain='woods' and ((nx>260 and nx<650 and ny>45 and ny<310)or(nx>660 and nx<1040 and ny>405 and ny<665)) then '{"kind":"Forest","speed":0.68,"cover":0.6,"height":0}'::jsonb
 when p_terrain='highlands' and power((nx-650)/240,2)+power((ny-285)/180,2)<1 then '{"kind":"High ground","speed":0.85,"cover":1,"height":1}'::jsonb
 when p_terrain='river' and abs(nx-(600+sin(ny/110)*32))<42 and (ny<306 or ny>395) then '{"kind":"Shallows","speed":0.42,"cover":1,"height":0}'::jsonb
 when p_terrain='marsh' and sin(nx/95)+cos(ny/70)>.3 then '{"kind":"Marsh","speed":0.62,"cover":0.9,"height":0}'::jsonb
 when p_terrain='snow' then '{"kind":"Snow","speed":0.88,"cover":1,"height":0}'::jsonb
 when p_terrain='desert' then '{"kind":"Sand","speed":0.9,"cover":1,"height":0}'::jsonb
 when p_terrain='coast' then '{"kind":"Coastal ground","speed":1,"cover":1,"height":0}'::jsonb
 when p_terrain='farmland' then '{"kind":"Farmland","speed":1,"cover":1,"height":0}'::jsonb
 when p_terrain='darkland' then '{"kind":"Volcanic ground","speed":1,"cover":1,"height":0}'::jsonb
 else '{"kind":"Open ground","speed":1,"cover":1,"height":0}'::jsonb end from(select px/sqrt(5) nx,py/sqrt(5) ny) coordinates;
$$;

-- Never wait for a player while retaining another participant's row/land lock.
-- Exception rollback releases every lock acquired in this helper on contention.
create or replace function public.peris_lock_battle_participants(p_attacker uuid,p_defender uuid)returns boolean
language plpgsql security definer set search_path='' as $$
begin
 if exists(select 1 from public.peris_settler_expeditions where owner_id in(p_attacker,p_defender)and status='travelling'and arrival_at<=public.peris_game_now())
  and not pg_try_advisory_xact_lock(204200)then raise lock_not_available;end if;
 perform 1 from public.players where id in(p_attacker,p_defender)order by id for update nowait;
 return true;
exception when lock_not_available then return false;
end $$;
revoke all on function public.peris_lock_battle_participants(uuid,uuid)from public,anon,authenticated;
create or replace function public.peris_finish(p_bid bigint,p_winner text,p_reason text) returns void
language plpgsql security definer set search_path='' as $$
declare b public.battles%rowtype;ai integer;di integer;asur integer;dsur integer;r jsonb;loot jsonb:='{"wood":0,"stone":0,"food":0,"gold":0}';tier integer;u uuid;name text;a public.armies%rowtype;s public.settlements%rowtype;winner uuid;home jsonb;camp public.peris_camps%rowtype;stock jsonb;remaining jsonb;carry numeric;take numeric;key text;delivered jsonb;overflow jsonb;
begin
 select * into b from public.battles where id=p_bid for update;if b.id is null or b.status='resolved' then return;end if;
 if not public.peris_lock_battle_participants(b.attacker_owner_id,b.defender_owner_id)then raise lock_not_available;end if;
 if b.raid_city_id is not null then perform public.peris_finish_city_raid(p_bid,p_winner,p_reason);return;end if;
 select coalesce(sum(initial_soldiers)filter(where side='attacker'),0),coalesce(sum(initial_soldiers)filter(where side='defender'),0),
 coalesce(sum(soldiers)filter(where side='attacker'),0),coalesce(sum(soldiers)filter(where side='defender'),0) into ai,di,asur,dsur from public.battle_formations where battle_id=b.id;
 winner:=case p_winner when 'attacker' then b.attacker_owner_id when 'defender' then b.defender_owner_id else null end;
 select * into camp from public.peris_camps where id=b.camp_id;
 if b.mode='pve' and p_winner='attacker' and not camp.bandit then
 tier:=camp.tier;
 loot:=jsonb_build_object('wood',180*tier,'stone',140*tier,'food',220*tier,'gold',60*tier);
 insert into public.peris_progress(owner_id,camp_id,defeated,available_at) values(b.attacker_owner_id,b.camp_id,1,public.peris_game_now()+interval '2 minutes')
 on conflict(owner_id,camp_id)do update set defeated=peris_progress.defeated+1,available_at=excluded.available_at;
 end if;
 if camp.bandit then
  tier:=camp.tier;
  perform public.peris_camp_accrue(camp.id);
  select resources into stock from public.peris_camp_stock where camp_id=camp.id for update;
  if p_winner='attacker'then
   select coalesce(sum(f.soldiers*c.carry),0)into carry from public.battle_formations f join public.peris_unit_catalog c on c.unit=coalesce(f.recruit_unit,f.unit_type)where f.battle_id=b.id and f.side='attacker';
 carry:=floor(carry*public.peris_research_factor(b.attacker_owner_id,'carry'));
   loot:=public.peris_take_camp_loot(stock,carry);
   foreach key in array array['wood','stone','food','gold']loop stock:=jsonb_set(stock,array[key],to_jsonb((stock->>key)::numeric-(loot->>key)::numeric));end loop;
  end if;
  update public.peris_camp_stock set resources=stock,engaged_battle_id=null,next_recruit_at=public.peris_game_now()+make_interval(secs=>60+floor(random()*241)::integer)where camp_id=camp.id;
  update public.peris_camps set
   infantry=coalesce((select sum(soldiers)from public.battle_formations where battle_id=b.id and side='defender'and unit_type='infantry'),0),
   archers=coalesce((select sum(soldiers)from public.battle_formations where battle_id=b.id and side='defender'and unit_type='archers'),0),
   cavalry=coalesce((select sum(soldiers)from public.battle_formations where battle_id=b.id and side='defender'and unit_type='cavalry'),0)where id=camp.id;
 end if;
 r:=jsonb_build_object('balance_version',b.balance_version,'attacker_initial',ai,'defender_initial',di,'attacker_survivors',asur,'defender_survivors',dsur,'attacker_losses',ai-asur,'defender_losses',di-dsur,'loot',loot,'duration',round(b.elapsed),'reason',p_reason);
 r:=r||jsonb_build_object('attacker_roster',(select public.peris_roster(coalesce(jsonb_object_agg(unit,sum_initial),'{}'::jsonb))from(select coalesce(recruit_unit,unit_type)as unit,sum(initial_soldiers)as sum_initial from public.battle_formations where battle_id=b.id and side='attacker'group by coalesce(recruit_unit,unit_type))q),
  'attacker_survivor_roster',(select public.peris_roster(coalesce(jsonb_object_agg(unit,sum_remaining),'{}'::jsonb))from(select coalesce(recruit_unit,unit_type)as unit,sum(soldiers)as sum_remaining from public.battle_formations where battle_id=b.id and side='attacker'group by coalesce(recruit_unit,unit_type))q),
  'defender_roster',(select public.peris_roster(coalesce(jsonb_object_agg(unit,sum_initial),'{}'::jsonb))from(select coalesce(recruit_unit,unit_type)as unit,sum(initial_soldiers)as sum_initial from public.battle_formations where battle_id=b.id and side='defender'group by coalesce(recruit_unit,unit_type))q),
  'defender_survivor_roster',(select public.peris_roster(coalesce(jsonb_object_agg(unit,sum_remaining),'{}'::jsonb))from(select coalesce(recruit_unit,unit_type)as unit,sum(soldiers)as sum_remaining from public.battle_formations where battle_id=b.id and side='defender'group by coalesce(recruit_unit,unit_type))q),
  'defender_faction',coalesce(b.defender_faction,camp.faction),
  'attacker_faction',coalesce(b.attacker_faction,(select s0.faction from public.armies a0 join public.settlements s0 on s0.id=a0.home_settlement_id where a0.id=b.attacker_army_id)));
 select coalesce(sum(f.soldiers*c.carry),0)into carry from public.battle_formations f join public.peris_unit_catalog c on c.unit=coalesce(f.recruit_unit,f.unit_type)where f.battle_id=b.id and f.side='attacker';
 carry:=floor(carry*public.peris_research_factor(b.attacker_owner_id,'carry'));
 r:=r||jsonb_build_object('replacement_cost',public.peris_roster_loss_cost(r->'attacker_roster',r->'attacker_survivor_roster',b.balance_version),'carrying_capacity',carry);
 if (loot->>'wood')::numeric+(loot->>'stone')::numeric+(loot->>'food')::numeric+(loot->>'gold')::numeric=0 then r:=r||jsonb_build_object('estimated_profit',public.peris_resource_difference(loot,r->'replacement_cost'));end if;
 update public.battles set status='resolved' ,phase='finished',winner_side=p_winner,winner_owner_id=winner,ended_at=public.peris_game_now(),result=r where id=b.id;
 for u in select id from public.players where id in(b.attacker_owner_id,b.defender_owner_id) order by id loop
 perform public.peris_settle(u);
 select * into a from public.armies where id=case when u=b.attacker_owner_id then b.attacker_army_id else b.defender_army_id end;
 select * into s from public.settlements where id=a.home_settlement_id;
 home:=public.peris_home_army_position(s.x,s.y);
 select public.peris_roster(coalesce(jsonb_object_agg(unit_name,survivors),'{}'))into remaining from(select coalesce(recruit_unit,unit_type)as unit_name,sum(soldiers)as survivors from public.battle_formations where battle_id=b.id and owner_id=u group by coalesce(recruit_unit,unit_type))q;
 perform public.peris_write_roster(a.id,public.peris_roster_add(remaining,coalesce(a.raid_reserve,'{}')));
 update public.armies a0 set
 status='idle',raid_target_id=null,raid_reserve=null,march_sent_at=null,march_cancel_until=null,
 start_x=case when a.march_origin is null then (home->>'x')::integer else a.target_x end,start_y=case when a.march_origin is null then (home->>'y')::integer else a.target_y end,
 target_x=case when a.march_origin is null then (home->>'x')::integer else a.target_x end,target_y=case when a.march_origin is null then (home->>'y')::integer else a.target_y end,
 arrival_at=public.peris_game_now(),departure_at=public.peris_game_now(),updated_at=now() where id=a.id;
 if camp.bandit and u=b.attacker_owner_id then update public.armies set carried_loot=loot,loot_report_id=b.id where id=a.id;end if;
 if not public.peris_return_raid(a.id)then update public.armies set march_path=null,march_distance=null,march_returning=false where id=a.id;end if;
 if u=winner then update public.players set victories=victories+1,prestige=prestige+coalesce(tier,1)*25 where id=u;end if;
 if u=b.attacker_owner_id and b.mode='pve' and p_winner='attacker' and not camp.bandit then
 delivered:='{}';overflow:='{}';
 foreach key in array array['wood','stone','food','gold']loop
  take:=least((loot->>key)::numeric,greatest(0,case when key='food'then s.food_capacity else s.capacity end-(to_jsonb(s)->>key)::numeric));
  delivered:=delivered||jsonb_build_object(key,take);overflow:=overflow||jsonb_build_object(key,(loot->>key)::numeric-take);
 end loop;
 r:=r||jsonb_build_object('delivered',delivered,'overflow',overflow,'delivered_at',now(),'estimated_profit',public.peris_resource_difference(delivered,r->'replacement_cost'));
 update public.settlements set wood=least(capacity,wood+(loot->>'wood')::integer),stone=least(capacity,stone+(loot->>'stone')::integer),
 food=least(food_capacity,food+(loot->>'food')::integer),gold=least(capacity,gold+(loot->>'gold')::integer)where id=s.id;
 end if;
 if b.mode='pve' and u=b.attacker_owner_id then
  r:=r||jsonb_build_object('hero_reward',public.peris_battle_hero_reward(a.id,(di-dsur)*2+case when u=winner then 50 else 20 end,case when u=winner then b.camp_id else null end,b.id));
  update public.battles set result=r where id=b.id;
 else
  perform public.peris_hero_reward(a.id,case when u=b.attacker_owner_id then (di-dsur)*2 else(ai-asur)*2 end+case when u=winner then 50 else 20 end,null);
 end if;
 name:=case when b.mode='pve' then b.enemy_name else 'Duel against '||coalesce((select display_name from public.players where id=case when u=b.attacker_owner_id then b.defender_owner_id else b.attacker_owner_id end),'rival') end;
 insert into public.peris_reports(owner_id,battle_id,title,won,result,camp_id,farm_list_id)values(u,b.id,name,coalesce(u=winner,false),r,b.camp_id,a.farm_list_id)on conflict(owner_id,battle_id)do nothing;
 if camp.bandit and u=b.attacker_owner_id and not (select march_returning from public.armies where id=a.id)then perform public.peris_deliver_loot(a.id);end if;
 end loop;
end $$;

create or replace function public.peris_tick_for(p_battle_id bigint,p_owner uuid)returns jsonb language plpgsql security definer set search_path='' as $$
declare u uuid:=p_owner;b public.battles%rowtype;f public.battle_formations%rowtype;t public.battle_formations%rowtype;threat public.battle_formations%rowtype;
 bw numeric:=1200*sqrt(5);bh numeric:=700*sqrt(5);remain numeric;processed numeric;dt numeric;dx numeric;dy numeric;distance numeric;speed numeric;reach numeric;move_step numeric;direction numeric;turn numeric;contact numeric;minimum numeric;push numeric;interval_sec numeric;ranged boolean;
 gf jsonb;gt jsonb;snapshot jsonb;positions jsonb;correction jsonb;pending jsonb;entry jsonb;pair record;rate numeric;flank numeric;charge numeric;matchup numeric;stance_mult numeric;brace numeric;cover numeric;elevation numeric;melee_arc numeric;defence numeric;difficulty_mult numeric;relative numeric;damage numeric;cas integer;mor_loss numeric;alive_a integer;alive_d integer;strength_a integer;strength_d integer;own_side text;average numeric;
begin
 select * into b from public.battles where id=p_battle_id for update;
 if u is null or b.id is null or(u is distinct from b.attacker_owner_id and u is distinct from b.defender_owner_id)then raise exception 'Not your battle';end if;
 if b.status<>'active'then return jsonb_build_object('ok',true);end if;
 if not public.peris_lock_battle_participants(b.attacker_owner_id,b.defender_owner_id)then return jsonb_build_object('busy',true);end if;
 if b.phase='deployment'then b.phase:='combat';update public.battles set phase='combat',attacker_ready=true,defender_ready=true where id=b.id;end if;
 remain:=least(10,greatest(0,extract(epoch from(public.peris_game_now()-b.last_tick_at))));
 if remain<.15 then return jsonb_build_object('ok',true);end if;
 processed:=remain;update public.battles set last_tick_at=last_tick_at+make_interval(secs=>processed::double precision)where id=b.id;
 while remain>0 loop
 dt:=least(.1,remain);remain:=remain-dt;b.elapsed:=b.elapsed+dt;
 if b.elapsed<=dt or floor(b.elapsed*2)<>floor((b.elapsed-dt)*2)then perform public.peris_auto_orders(b.id);end if;
 select jsonb_object_agg(id::text,to_jsonb(q))into snapshot from(select * from public.battle_formations where battle_id=b.id)q;
 positions:='{}';
 -- Plan both sides from one immutable position snapshot, then commit together.
 for f in select * from public.battle_formations where battle_id=b.id and soldiers>0 order by id loop
 if f.status='routed'then f.x:=greatest(12,least(bw-12,f.x+case when f.side='attacker'then -1 else 1 end*64*dt));f.facing:=case when f.side='attacker'then 180 else 0 end;
 else
 t:=jsonb_populate_record(null::public.battle_formations,snapshot->f.target_formation_id::text);
 if t.id is null or t.soldiers<=0 or t.status='routed'then f.target_formation_id:=null;f.target_x:=f.x;f.target_y:=f.y;f.status:='idle';
 else
 dx:=t.x-f.x;dy:=t.y-f.y;distance:=sqrt(dx*dx+dy*dy);contact:=public.peris_contact(f,t);
 f.target_x:=t.x;f.target_y:=t.y;reach:=case when f.unit_type='archers'then 208 else contact end;
 select * into threat from jsonb_populate_recordset(null::public.battle_formations,(select jsonb_agg(value)from jsonb_each(snapshot)))e where e.side<>f.side and e.soldiers>0 and e.status<>'routed'and e.unit_type<>'archers'order by power(e.x-f.x,2)+power(e.y-f.y,2),e.id limit 1;
 if f.unit_type='archers'and threat.id is not null and sqrt(power(threat.x-f.x,2)+power(threat.y-f.y,2))<public.peris_contact(f,threat)+65 then
 distance:=greatest(1,sqrt(power(threat.x-f.x,2)+power(threat.y-f.y,2)));
 f.target_x:=greatest(40,least(bw-40,f.x+(f.x-threat.x)/distance*85));f.target_y:=greatest(45,least(bh-45,f.y+(f.y-threat.y)/distance*85));
 if sqrt(power(f.target_x-f.x,2)+power(f.target_y-f.y,2))>12 then reach:=0;else f.target_x:=t.x;f.target_y:=t.y;reach:=contact;end if;
 elsif f.unit_type='cavalry'and distance>240 and abs(f.y-t.y)<85 then
 f.target_y:=greatest(65,least(bh-65,t.y+case when f.y<bh/2 then -120 else 120 end));f.target_x:=t.x+case when f.side='attacker'then -145 else 145 end;reach:=0;
 end if;
 dx:=f.target_x-f.x;dy:=f.target_y-f.y;distance:=sqrt(dx*dx+dy*dy);
 direction:=degrees(atan2(case when distance>reach+2 then dy else t.y-f.y end,case when distance>reach+2 then dx else t.x-f.x end));
 turn:=direction-f.facing;turn:=turn-360*floor((turn+180)/360);f.facing:=f.facing+greatest(-120*dt,least(120*dt,turn));
 gf:=public.peris_ground(b.terrain,f.x,f.y);
 if distance>reach+2 then
 turn:=direction-f.facing;turn:=abs(turn-360*floor((turn+180)/360));
 speed:=(case f.unit_type when 'cavalry'then 76 when 'archers'then 34 else 40 end)*f.unit_speed*f.magic_speed*(gf->>'speed')::numeric*(case when f.unit_type='cavalry'and gf->>'kind'='Forest'then .65 else 1 end)*(case when f.running and f.stamina>8 then 1.35 else 1 end)*(case when f.stamina<15 then .75 else 1 end)*(case when turn>75 then .25 when turn>40 then .65 else 1 end);
 move_step:=least(speed*dt,greatest(0,distance-reach));f.x:=greatest(35,least(bw-35,f.x+dx/distance*move_step));f.y:=greatest(45,least(bh-45,f.y+dy/distance*move_step));f.status:='moving';f.stamina:=greatest(0,least(100,f.stamina-case when f.running then 1.4 else .1 end*dt));
 if f.unit_type='cavalry'and f.running and gf->>'kind'<>'Forest'and turn<40 then f.charge_distance:=f.charge_distance+move_step;if f.charge_distance>=100 and f.stamina>35 then f.charge_ready:=true;end if;end if;
 else f.status:='engaged';f.running:=false;f.stamina:=greatest(0,least(100,f.stamina-case when f.unit_type='archers'then .12 else .3 end*dt));end if;
 end if;end if;
 positions:=jsonb_set(positions,array[f.id::text],to_jsonb(f),true);
 end loop;
 for pair in select key,value from jsonb_each(positions)loop
 f:=jsonb_populate_record(null::public.battle_formations,pair.value);
 update public.battle_formations set x=f.x,y=f.y,facing=f.facing,target_x=f.target_x,target_y=f.target_y,target_formation_id=f.target_formation_id,status=f.status,running=f.running,stamina=f.stamina,charge_ready=f.charge_ready,charge_distance=f.charge_distance,updated_at=now()where id=f.id;
 end loop;
 -- Symmetric soft separation based on the actual regiment footprint.
 correction:='{}';
 for f in select * from public.battle_formations where battle_id=b.id and soldiers>0 and status<>'routed'order by id loop
 for t in select * from public.battle_formations where battle_id=b.id and id>f.id and soldiers>0 and status<>'routed'order by id loop
 dx:=t.x-f.x;dy:=t.y-f.y;distance:=sqrt(dx*dx+dy*dy);if distance<.001 then dx:=0;dy:=1;distance:=1;end if;
 minimum:=public.peris_extent(f,dx,dy)+public.peris_extent(t,-dx,-dy)+case when f.side=t.side then 10 else 4 end;
 if distance>=minimum then continue;end if;push:=least((minimum-distance)*.5,50*dt);dx:=dx/distance*push;dy:=dy/distance*push;
 entry:=coalesce(correction->f.id::text,'{"x":0,"y":0}'::jsonb);correction:=jsonb_set(correction,array[f.id::text],jsonb_build_object('x',(entry->>'x')::numeric-dx,'y',(entry->>'y')::numeric-dy),true);
 entry:=coalesce(correction->t.id::text,'{"x":0,"y":0}'::jsonb);correction:=jsonb_set(correction,array[t.id::text],jsonb_build_object('x',(entry->>'x')::numeric+dx,'y',(entry->>'y')::numeric+dy),true);
 end loop;end loop;
 for pair in select key,value from jsonb_each(correction)loop update public.battle_formations set x=greatest(35,least(bw-35,x+(pair.value->>'x')::numeric)),y=greatest(45,least(bh-45,y+(pair.value->>'y')::numeric))where id=pair.key::bigint;end loop;
 -- Accumulate attacks into a map, then apply both armies' losses together.
 pending:='{}'::jsonb;
 for f in select * from public.battle_formations where battle_id=b.id and soldiers>0 and status<>'routed' and target_formation_id is not null order by id loop
 select * into t from public.battle_formations where id=f.target_formation_id;if t.id is null or t.status='routed' or t.soldiers=0 then continue;end if;
 dx:=t.x-f.x;dy:=t.y-f.y;distance:=sqrt(dx*dx+dy*dy);reach:=case when f.unit_type='archers'then 220 else public.peris_contact(f,t)end;
 if distance>reach+4 or b.elapsed<f.attack_ready_at then continue;end if;
 ranged:=f.unit_type='archers'and distance>public.peris_contact(f,t)+20;
 if ranged and f.status='moving'then continue;end if;
 direction:=degrees(atan2(t.y-f.y,t.x-f.x))-f.facing;direction:=abs(direction-360*floor((direction+180)/360));if direction>65 then continue;end if;
 interval_sec:=case when ranged then 2.5 when f.unit_type='cavalry'then 1.4 else 1.2 end;
 if f.damage_target_id is distinct from t.id then f.damage_pool:=0;end if;
 gf:=public.peris_ground(b.terrain,f.x,f.y);gt:=public.peris_ground(b.terrain,t.x,t.y);
 relative:=degrees(atan2(f.y-t.y,f.x-t.x))-t.facing;relative:=abs(relative-360*floor((relative+180)/360));
 flank:=case when ranged then 1 when relative>135 then 1.65 when relative>65 then 1.28 else 1 end;
 charge:=case when f.charge_ready and f.unit_type='cavalry' and gf->>'kind'<>'Forest' then 2.4 else 1 end;
 matchup:=case when f.unit_type='cavalry' then case when t.unit_type='archers' then 1.65 else 0.9 end when f.unit_type='infantry' then case when t.unit_type='cavalry' then 1.25 else 1 end else case when t.unit_type='cavalry' then 0.75 else 1 end end;
 stance_mult:=case f.stance when 'aggressive' then 1.22 when 'guard' then 0.9 else 1 end;
 brace:=case when t.stance='guard' and t.unit_type='infantry' and relative<65 and f.unit_type='cavalry' then 0.5 else 1 end;
 defence:=case t.stance when 'guard' then 0.8 when 'aggressive' then 1.15 else 1 end;
 cover:=case when ranged then (gt->>'cover')::numeric else 1 end;
 elevation:=case when ranged and (gf->>'height')::numeric>(gt->>'height')::numeric then 1.25 when ranged and (gf->>'height')::numeric<(gt->>'height')::numeric then 0.8 else 1 end;
 melee_arc:=case when f.unit_type='archers'and not ranged then 0.28 else 1 end;
 difficulty_mult:=1;
 rate:=case f.unit_type when 'infantry' then 0.020 when 'archers' then 0.012 else 0.031 end;
 damage:=f.damage_pool+f.soldiers*f.unit_attack*f.attack_multiplier*f.magic_attack*(1-t.magic_defence)*rate*matchup*stance_mult*defence*brace*flank*charge*cover*elevation*melee_arc*difficulty_mult*(0.55+f.stamina/220)*interval_sec/(t.unit_defence*t.defence_multiplier);
 if charge>1 then damage:=damage+f.soldiers*0.06*brace*flank*(1-t.magic_defence)/(t.unit_defence*t.defence_multiplier);end if;
 cas:=least(greatest(0,t.soldiers-coalesce((pending->t.id::text->>'loss')::integer,0)),floor(damage)::integer);mor_loss:=cas::numeric/greatest(1,t.initial_soldiers)*125+case when flank>1 then cas::numeric/greatest(1,t.initial_soldiers)*35 else 0 end+case when charge>1 then 8 else 0 end;
 update public.battle_formations set damage_pool=mod(damage-cas,1),damage_target_id=t.id,attack_ready_at=b.elapsed+interval_sec,kills=kills+cas,charge_distance=case when charge>1 then 0 else charge_distance end,charge_ready=case when charge>1 then false else charge_ready end,
 stamina=case when charge>1 then greatest(0,stamina-12) else stamina end where id=f.id;
 entry:=coalesce(pending->t.id::text,'{"loss":0,"morale":0}'::jsonb);
 pending:=jsonb_set(pending,array[t.id::text],jsonb_build_object('loss',(entry->>'loss')::integer+cas,'morale',(entry->>'morale')::numeric+mor_loss),true);
 end loop;
 for pair in select key,value from jsonb_each(pending) loop
 update public.battle_formations set soldiers=greatest(0,soldiers-(pair.value->>'loss')::integer),morale=greatest(0,morale-(pair.value->>'morale')::numeric) where id=pair.key::bigint;
 update public.battle_formations set status='routed',target_formation_id=null where id=pair.key::bigint and (soldiers=0 or morale<18);
 end loop;

 -- One automatic rally per side, with morale weighted by remaining manpower.
 foreach own_side in array array['attacker','defender']loop
 if (case when own_side='attacker'then b.rally_attacker else b.rally_defender end) then continue;end if;
 select sum(morale*soldiers)/nullif(sum(soldiers),0)into average from public.battle_formations where battle_id=b.id and side=own_side and soldiers>0;
 if average<42 then
 update public.battle_formations set morale=least(100,morale+25),status=case when status='routed'then 'idle'else status end,target_x=case when status='routed'then x else target_x end,target_y=case when status='routed'then y else target_y end where battle_id=b.id and side=own_side and soldiers>0;
 if own_side='attacker'then b.rally_attacker:=true;else b.rally_defender:=true;end if;
 end if;
 end loop;
 update public.battles set elapsed=b.elapsed,rally_attacker=b.rally_attacker,rally_defender=b.rally_defender where id=b.id;
 perform public.peris_auto_magic(b.id);select * into b from public.battles where id=b.id;
 if b.status<>'active'then exit;end if;
 select count(*)filter(where side='attacker'),count(*)filter(where side='defender'),coalesce(sum(soldiers)filter(where side='attacker'),0),coalesce(sum(soldiers)filter(where side='defender'),0)
 into alive_a,alive_d,strength_a,strength_d from public.battle_formations where battle_id=b.id and soldiers>0 and status<>'routed';
 if alive_a=0 or alive_d=0 then perform public.peris_finish(b.id,case when alive_a>0 then 'attacker'when alive_d>0 then 'defender'else 'draw'end,'Army routed');exit;end if;
 if b.elapsed>=900 then perform public.peris_finish(b.id,case when strength_a>strength_d then 'attacker'when strength_d>strength_a then 'defender'else 'draw'end,'Time limit');exit;end if;
 end loop;
 return jsonb_build_object('ok',true);
end $$;

create or replace function public.peris_tick(p_battle_id bigint)returns jsonb language plpgsql security definer set search_path='' as $$
begin return public.peris_tick_for(p_battle_id,public.peris_player_id());end $$;
create or replace function public.peris_rally(p_battle_id bigint) returns jsonb language plpgsql security definer set search_path='' as $$
declare u uuid:=public.peris_player_id();b public.battles%rowtype;side_name text;
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
declare u uuid:=public.peris_player_id();b public.battles%rowtype;
begin
 select * into b from public.battles where id=p_battle_id for update;
 if u is null or b.id is null or (u is distinct from b.attacker_owner_id and u is distinct from b.defender_owner_id)then raise exception 'Not your battle';end if;
 perform public.peris_finish(b.id,case when u=b.attacker_owner_id then 'defender' else 'attacker' end,'Withdrawal');
 return jsonb_build_object('ok',true);
end $$;

create or replace function public.peris_challenge(p_defender uuid)returns jsonb language plpgsql security definer set search_path='' as $$
declare u uuid:=public.peris_player_id();
begin
 if u is null or p_defender is null or u=p_defender then raise exception 'Choose another ruler';end if;
 perform 1 from public.players where id in(u,p_defender) order by id for update;
 if not exists(select 1 from public.players where id=p_defender)then raise exception 'Ruler not found';end if;
 if exists(select 1 from public.battles where status='active'and (attacker_owner_id in(u,p_defender)or defender_owner_id in(u,p_defender)))then raise exception 'One army is already fighting';end if;
 if exists(select 1 from public.armies where id=public.peris_army_id(u)and raid_city_id is not null)then raise exception 'This legion already has a city raid';end if;
 if exists(select 1 from public.peris_challenges where status='pending'and expires_at>public.peris_game_now()and(attacker_owner_id=u or defender_owner_id=u))then raise exception 'You already have a pending challenge';end if;
 insert into public.peris_challenges(attacker_owner_id,defender_owner_id,attacker_army_id)values(u,p_defender,public.peris_army_id(u));
 return jsonb_build_object('ok',true);
end $$;

create or replace function public.peris_respond(p_id bigint,p_accept boolean)returns jsonb language plpgsql security definer set search_path='' as $$
declare u uuid:=public.peris_player_id();c public.peris_challenges%rowtype;a public.armies%rowtype;d public.armies%rowtype;bid bigint;
begin
 select * into c from public.peris_challenges where id=p_id for update;
 if u is null or c.id is null or c.defender_owner_id<>u then raise exception 'Not your invitation';end if;
 if c.status<>'pending' or c.expires_at<=public.peris_game_now()then raise exception 'Challenge has expired';end if;
 if not p_accept then update public.peris_challenges set status='declined'where id=c.id;return jsonb_build_object('ok',true);end if;
 if exists(select 1 from public.peris_settler_expeditions where owner_id in(c.attacker_owner_id,c.defender_owner_id)and status='travelling'and arrival_at<=public.peris_game_now())then perform pg_advisory_xact_lock(204200);end if;
 perform 1 from public.players where id in(c.attacker_owner_id,c.defender_owner_id)order by id for update;
 perform public.peris_settle(c.attacker_owner_id);perform public.peris_settle(c.defender_owner_id);
 perform 1 from public.armies where owner_id in(c.attacker_owner_id,c.defender_owner_id)order by owner_id for update;
 if exists(select 1 from public.battles where status='active'and(attacker_owner_id in(c.attacker_owner_id,c.defender_owner_id)or defender_owner_id in(c.attacker_owner_id,c.defender_owner_id)))then raise exception 'One army is already fighting';end if;

 select * into a from public.armies where id=coalesce(c.attacker_army_id,(select min(id)from public.armies where owner_id=c.attacker_owner_id))and owner_id=c.attacker_owner_id;select * into d from public.armies where id=public.peris_army_id(u);
 if a.raid_city_id is not null or d.raid_city_id is not null then raise exception 'Finish the city raid before accepting a duel';end if;
 if exists(select 1 from public.peris_orders where army_id in(a.id,d.id)and kind='recruit')then raise exception 'Finish training before a duel';end if;
 if a.id is null or d.id is null or a.infantry+a.archers+a.cavalry=0 or d.infantry+d.archers+d.cavalry=0 then raise exception 'Both armies need soldiers';end if;
 insert into public.battles(attacker_owner_id,defender_owner_id,attacker_army_id,defender_army_id,mode,phase,terrain,enemy_name)
 values(a.owner_id,d.owner_id,a.id,d.id,'pvp','combat',public.peris_battle_terrain(d.target_x,d.target_y),(select display_name from public.players where id=d.owner_id))returning id into bid;
 perform public.peris_add_formations(bid,a.owner_id,'attacker',a.infantry,a.archers,a.cavalry,coalesce((select 90+2*level from public.buildings where settlement_id=a.home_settlement_id and building_type='wall'),92));
 perform public.peris_add_formations(bid,d.owner_id,'defender',d.infantry,d.archers,d.cavalry,coalesce((select 90+2*level from public.buildings where settlement_id=d.home_settlement_id and building_type='wall'),92));
 update public.armies set status='idle',raid_target_id=null where id in(a.id,d.id);
 update public.peris_challenges set status='accepted'where id=c.id;
 return jsonb_build_object('ok',true,'battle_id',bid);
end $$;

create or replace function public.peris_claim(p_quest_id text)returns jsonb language plpgsql security definer set search_path='' as $$
declare u uuid:=public.peris_player_id();p public.players%rowtype;cw integer;cs integer;cf integer;cg integer;
begin
 if u is null then raise exception 'Authentication required';end if;perform public.peris_settle(u);select * into p from public.players where id=u for update;
 if exists(select 1 from public.peris_claims where owner_id=u and quest_id=p_quest_id)then raise exception 'Reward already claimed';end if;
 if p_quest_id='builder' and p.upgrades>=1 then cw:=250;cs:=200;cf:=200;cg:=50;
 elsif p_quest_id='recruiter' and p.recruits>=20 then cw:=200;cs:=150;cf:=300;cg:=75;
 elsif p_quest_id='victor' and p.victories>=1 then cw:=300;cs:=300;cf:=400;cg:=150;
 elsif p_quest_id='conqueror' and p.victories>=5 then cw:=1000;cs:=800;cf:=1000;cg:=500;
 else raise exception 'Complete the objective first';end if;
 insert into public.peris_claims(owner_id,quest_id)values(u,p_quest_id);
 update public.settlements set wood=least(capacity,wood+cw),stone=least(capacity,stone+cs),food=least(food_capacity,food+cf),gold=least(capacity,gold+cg)where id=public.peris_city_id(u);
 return jsonb_build_object('ok',true);
end $$;
-- Additive read receipts belong to the ruler, including recovered name-only sessions.
alter table public.peris_reports add column if not exists read_at timestamptz;
create or replace function public.peris_read_reports(p_report_ids bigint[])returns void
language plpgsql security definer set search_path='' as $$
declare u uuid:=public.peris_player_id();
begin
 if auth.uid() is null or u is null then raise exception 'Authentication required' using errcode='42501';end if;
 if p_report_ids is null or cardinality(p_report_ids)<1 or cardinality(p_report_ids)>50 or array_position(p_report_ids,null)is not null then
  raise exception 'Choose valid reports' using errcode='22023';end if;
 if exists(select 1 from unnest(p_report_ids)as requested(report_id) where requested.report_id<=0 or not exists(select 1 from public.peris_reports r where r.id=requested.report_id and r.owner_id=u))then
  raise exception 'These reports are not available to this ruler' using errcode='42501';end if;
 update public.peris_reports set read_at=now() where owner_id=u and id=any(p_report_ids) and read_at is null;
end $$;
revoke all on function public.peris_read_reports(bigint[]) from public,anon;
grant execute on function public.peris_read_reports(bigint[]) to authenticated;

-- Bulk reads include historical receipts beyond the bounded snapshot page.
create or replace function public.peris_read_all_reports()returns void
language plpgsql security definer set search_path='' as $$
declare u uuid:=public.peris_player_id();
begin
 if auth.uid() is null or u is null then raise exception 'Authentication required' using errcode='42501';end if;
 update public.peris_reports set read_at=now() where owner_id=u and read_at is null;
end $$;
revoke all on function public.peris_read_all_reports() from public,anon;
grant execute on function public.peris_read_all_reports() to authenticated;

create or replace function public.peris_report_page(p_before_id bigint default null)returns jsonb
language plpgsql security definer set search_path='' as $$
declare u uuid:=public.peris_player_id();
begin
 if auth.uid() is null or u is null then raise exception 'Authentication required' using errcode='42501';end if;
 if p_before_id is not null and p_before_id<=0 then raise exception 'Choose a valid report page' using errcode='22023';end if;
 return coalesce((select jsonb_agg(r order by r.id desc)from(
  select * from public.peris_reports r where r.owner_id=u and (p_before_id is null or r.id<p_before_id)
   and (coalesce((r.result->>'attacker_losses')::integer,0)>0 or not exists(select 1 from public.peris_campaign_farm_lists l where l.id=r.farm_list_id and l.owner_id=u and l.casualties_only))
  order by r.id desc limit 50
 )r),'[]'::jsonb);
end $$;
revoke all on function public.peris_report_page(bigint) from public,anon;
grant execute on function public.peris_report_page(bigint) to authenticated;
create or replace function public.peris_rename(p_name text)returns jsonb language plpgsql security definer set search_path='' as $$
begin
 if public.peris_player_id() is null then raise exception 'Authentication required';end if;
 if p_name is null or length(btrim(p_name))<2 or length(btrim(p_name))>32 then raise exception 'Use a name of 2-32 characters';end if;
 update public.settlements set name=btrim(p_name)where id=public.peris_city_id(public.peris_player_id());return jsonb_build_object('ok',true);
end $$;

-- New players receive all eight structures; existing players keep their existing troops.
-- Proximity lookups use bounded wrapped fields rather than every camp/city.
create index if not exists peris_signup_city_cell on public.settlements
 ((public.peris_wrap_cell(floor(x/128::numeric)::integer)),(public.peris_wrap_cell(floor(y/128::numeric)::integer)));
create index if not exists peris_signup_camp_cell on public.peris_camps
 ((public.peris_wrap_cell(floor(x/128::numeric)::integer)),(public.peris_wrap_cell(floor(y/128::numeric)::integer)));

create or replace function public.create_player(p_display_name text)returns jsonb language plpgsql security definer set search_path='' as $$
declare u uuid:=auth.uid();n text:=btrim(p_display_name);sp public.spawn_points%rowtype;candidate public.spawn_points%rowtype;sid bigint;land bytea;cx integer;cy integer;home jsonb;
begin
 if u is null then raise exception 'Authentication required';end if;
 -- Older clients may retry allocation after a name-based account recovery.
 -- The guard also keeps the standalone V10-V13 signup hotfix compatible.
 if to_regprocedure('public.peris_player_id()') is not null then
  execute 'select public.peris_player_id()'into u;
 end if;
 if exists(select 1 from public.players where id=u)then return jsonb_build_object('ok',true);end if;
 if n is null or n!~'^[A-Za-z0-9 _-]{2,20}$'then raise exception 'Use 2-20 letters, numbers, spaces, _ or -';end if;
 -- Try sites in ID order before running proximity checks. A single sorted
 -- anti-join lets the planner test the entire realm before applying LIMIT 1.
 perform pg_advisory_xact_lock(204200);
 -- Another request for the same account may have finished while we waited.
 if exists(select 1 from public.players where id=u)then return jsonb_build_object('ok',true);end if;
 select walkable into land from public.peris_world_map where id=1;
 for candidate in
  select sp0.* from public.spawn_points sp0
  where not exists(select 1 from public.settlements s where s.spawn_point_id=sp0.id)
  order by sp0.id for update of sp0 skip locked
 loop
  cx:=public.peris_wrap_cell(floor(candidate.x/128::numeric)::integer);
  cy:=public.peris_wrap_cell(floor(candidate.y/128::numeric)::integer);
  if land is null or exists(select 1 from generate_series(-1,1)dx cross join generate_series(-1,1)dy
   where get_bit(land,(public.peris_wrap_cell(cy+dy)+100)*200+public.peris_wrap_cell(cx+dx)+100)=0)then continue;end if;
  if exists(select 1 from generate_series(-1,1)dx cross join generate_series(-1,1)dy join public.peris_map_plots p
   on p.col=public.peris_wrap_cell(cx+dx)and p.row=public.peris_wrap_cell(cy+dy))then continue;end if;
  if exists(select 1 from generate_series(-2,2)dx cross join generate_series(-2,2)dy join public.settlements s
   on public.peris_wrap_cell(floor(s.x/128::numeric)::integer)=public.peris_wrap_cell(cx+dx)
   and public.peris_wrap_cell(floor(s.y/128::numeric)::integer)=public.peris_wrap_cell(cy+dy))then continue;end if;
  if exists(select 1 from generate_series(-1,1)dx cross join generate_series(-1,1)dy join public.peris_camps c
   on public.peris_wrap_cell(floor(c.x/128::numeric)::integer)=public.peris_wrap_cell(cx+dx)
   and public.peris_wrap_cell(floor(c.y/128::numeric)::integer)=public.peris_wrap_cell(cy+dy))then continue;end if;
  if exists(select 1 from generate_series(-3,3)dx cross join generate_series(-3,3)dy join public.peris_settler_expeditions e
   on e.col=public.peris_wrap_cell(cx+dx)and e.row=public.peris_wrap_cell(cy+dy)where e.status='travelling')then continue;end if;
  sp:=candidate;exit;
 end loop;
 if sp.id is null then raise exception 'This world has no free settlement sites';end if;
 insert into public.players(id,display_name)values(u,n);
 insert into public.settlements(owner_id,spawn_point_id,name,x,y,wood,stone,food,gold)values(u,sp.id,n||'''s Keep',sp.x,sp.y,1250,1000,1500,500)returning id into sid;
 insert into public.buildings(settlement_id,building_type,level)select sid,t,0 from unnest(array['lumber','quarry','farm','market','barracks','stables','wall','storehouse'])t;
 home:=public.peris_home_army_position(sp.x,sp.y);
 insert into public.armies(owner_id,home_settlement_id,name,infantry,archers,cavalry,start_x,start_y,target_x,target_y)values(u,sid,'Legio I · The Dawn',120,50,16,(home->>'x')::integer,(home->>'y')::integer,(home->>'x')::integer,(home->>'y')::integer);
 return jsonb_build_object('ok',true);
exception when unique_violation then raise exception 'That ruler name is already taken';
end $$;

-- Intentionally name-only: entering an existing name grants that ruler's control.
create or replace function public.peris_login(p_display_name text)returns jsonb
language plpgsql security definer set search_path='' as $$
declare u uuid:=auth.uid();n text:=btrim(p_display_name);r public.players%rowtype;bound uuid;created boolean:=false;
begin
 if u is null then raise exception 'Authentication required' using errcode='42501';end if;
 if n is null or n!~'^[A-Za-z0-9 _-]{2,20}$'then
  raise exception 'Use 2-20 letters, numbers, spaces, _ or -' using errcode='22023';end if;
 -- Serialize this browser identity first, then the requested name. Concurrent
 -- first logins with the same name reuse one ruler and one starting estate.
 perform pg_advisory_xact_lock(hashtextextended(u::text,72215));
 select player_id into bound from public.peris_account_sessions where auth_id=u;
 if bound is null and exists(select 1 from public.players where id=u)then bound:=u;end if;
 if bound is not null then
  select * into r from public.players where id=bound;
  if lower(r.display_name)<>lower(n)then
   raise exception 'Choose a fresh browser session to switch rulers' using errcode='PT409';end if;
 else
  perform pg_advisory_xact_lock(hashtextextended(lower(n),72214));
  select * into r from public.players where lower(display_name)=lower(n);
  if r.id is null then
   perform public.create_player(n);
   select * into r from public.players where id=u;
   created:=true;
  end if;
 end if;
 if r.id is null then raise exception 'The ruler account could not be opened';end if;
 insert into public.peris_account_sessions(auth_id,player_id)values(u,r.id)
 on conflict(auth_id)do nothing;
 return jsonb_build_object('player_id',r.id,'display_name',r.display_name,'created',created);
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
declare u uuid:=public.peris_player_id();city record;active_faction text;
begin
 if u is null then raise exception 'Authentication required';end if;
 if p_faction is null or p_faction not in ('roman','spartan','persian','egyptian','orc','elf','dwarf','gnome','pandaren','undead','demon')then raise exception 'Unknown faction';end if;
 perform public.peris_settle(u);
 if public.peris_city_id(u)=(select min(id)from public.settlements where owner_id=u)then
  select c.faction into active_faction from public.peris_account_science s join public.peris_technology_catalog c on c.id=s.active_id where s.owner_id=u;
  if active_faction is not null and active_faction<>p_faction then perform public.peris_research_pause(u,public.peris_game_now());end if;
 end if;
 update public.settlements set faction=p_faction where id=public.peris_city_id(u);if not found then raise exception 'Settlement missing';end if;
 for city in select id from public.settlements where owner_id=u order by id loop perform public.peris_city_economy(city.id);end loop;
end $$;
create or replace function public.peris_debug_city(p_action text,p_target text default null,p_value integer default null)returns void language plpgsql security definer set search_path='' as $$
declare u uuid:=public.peris_player_id();s public.settlements%rowtype;c public.peris_city_slots%rowtype;b public.buildings%rowtype;target_slot integer;l integer;max_level integer;lost_magic boolean:=false;count_slots integer;
begin
 if u is null then raise exception 'Authentication required';end if;
 if not coalesce((select enabled from public.peris_debug_config where id),false)then raise exception 'Debug tools are disabled';end if;
 perform 1 from public.players where id=u for update;
 select * into s from public.settlements where id=public.peris_city_id(u) for update;if s.id is null then raise exception 'Settlement missing';end if;
 if exists(select 1 from public.battles where status='active' and (attacker_owner_id=u or defender_owner_id=u))then raise exception 'Finish the current battle first';end if;
 perform public.peris_settle(u);select * into s from public.settlements where id=s.id;
 if p_action='resources' then
  if p_value is null or p_value not in (0,1000)then raise exception 'Choose fill storage or +1,000 supplies';end if;
  update public.settlements set wood=case when p_value=0 then capacity else least(capacity,wood+1000)end,stone=case when p_value=0 then capacity else least(capacity,stone+1000)end,
   food=case when p_value=0 then food_capacity else least(food_capacity,food+1000)end,gold=case when p_value=0 then capacity else least(capacity,gold+1000)end,resources_updated_at=public.peris_game_now() where id=s.id;return;
 elsif p_action='population' then
  if p_value is null or p_value not in (0,10)then raise exception 'Choose fill housing or +10 residents';end if;
  update public.settlements set population=case when p_value=0 then population_capacity else least(population_capacity,population+10)end where id=s.id;perform public.peris_city_economy(s.id);return;
 elsif p_action='finish' then
  update public.peris_orders set started_at=least(started_at,public.peris_game_now()),finish_at=public.peris_game_now() where owner_id=u and settlement_id=s.id and kind='upgrade';perform public.peris_settle(u);return;
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
  delete from public.peris_orders where owner_id=u and settlement_id=s.id and kind='upgrade' and item='slot:'||c.slot_index||':'||c.building_type;
  if l=0 then delete from public.peris_city_slots where settlement_id=s.id and slot_index=c.slot_index;lost_magic:=c.building_type='mage_tower';
  else update public.peris_city_slots set level=l where settlement_id=s.id and slot_index=c.slot_index;end if;
 else
  update public.buildings set level=l,updated_at=now() where id=b.id;
  delete from public.peris_orders where owner_id=u and settlement_id=s.id and kind='upgrade' and item=b.building_type;
  if b.building_type='market' then
   count_slots:=6+2*l;lost_magic:=exists(select 1 from public.peris_city_slots where settlement_id=s.id and slot_index>=count_slots and slot_index<>16 and building_type='mage_tower');
   delete from public.peris_orders o using public.peris_city_slots cs where cs.settlement_id=s.id and cs.slot_index>=count_slots and cs.slot_index<>16 and o.owner_id=u and o.settlement_id=s.id and o.kind='upgrade' and o.item='slot:'||cs.slot_index||':'||cs.building_type;
   delete from public.peris_city_slots where settlement_id=s.id and slot_index>=count_slots and slot_index<>16;
  end if;
 end if;
 if lost_magic then delete from public.peris_spell_research where settlement_id=s.id;end if;
 perform public.peris_city_economy(s.id);
 update public.settlements set wood=least(wood,capacity),stone=least(stone,capacity),food=least(food,food_capacity),gold=least(gold,capacity)where id=s.id;
end $$;
revoke all on function public.peris_set_faction(text),public.peris_debug_city(text,text,integer) from public,anon;
grant execute on function public.peris_set_faction(text),public.peris_debug_city(text,text,integer) to authenticated;
-- All server battle entry points capture home-city doctrine before formations.
create or replace function public.peris_capture_battle_doctrine()returns trigger
language plpgsql security definer set search_path='' as $$
begin
 if new.balance_version=2 then
  new.attacker_faction:=coalesce(new.attacker_faction,(select s.faction from public.armies a join public.settlements s on s.id=a.home_settlement_id where a.id=new.attacker_army_id),'roman');
  new.defender_faction:=coalesce(new.defender_faction,
   (select s.faction from public.settlements s where s.id=new.raid_city_id),
   (select s.faction from public.armies a join public.settlements s on s.id=a.home_settlement_id where a.id=new.defender_army_id),'roman');
 end if;
 return new;
end $$;
revoke all on function public.peris_capture_battle_doctrine()from public,anon,authenticated;
drop trigger if exists peris_capture_battle_doctrine on public.battles;
create trigger peris_capture_battle_doctrine before insert on public.battles for each row execute function public.peris_capture_battle_doctrine();
-- Public ruler summaries only; connection IDs, resources, troops and orders stay private.
create table if not exists public.peris_account_activity(
 player_id uuid primary key references public.players(id) on delete cascade,
 last_seen_at timestamptz not null default now()
);
create table if not exists public.peris_account_creations(
 request_id uuid primary key,player_id uuid not null unique references public.players(id) on delete cascade,
 faction text not null
);
alter table public.peris_account_activity enable row level security;
alter table public.peris_account_creations enable row level security;
revoke all on public.peris_account_activity,public.peris_account_creations from public,anon,authenticated;
create index if not exists peris_account_activity_recent on public.peris_account_activity(last_seen_at desc);
create index if not exists peris_heroes_owner on public.peris_heroes(owner_id);
insert into public.peris_account_activity(player_id,last_seen_at)
 select player_id,max(created_at) from public.peris_account_sessions group by player_id
 on conflict(player_id)do nothing;

create or replace function public.peris_note_account_activity()returns void
language plpgsql security definer set search_path='' as $$
declare u uuid:=public.peris_player_id();
begin
 if u is null or not exists(select 1 from public.players where id=u)then return;end if;
 insert into public.peris_account_activity(player_id,last_seen_at)values(u,now())
 on conflict(player_id)do update set last_seen_at=excluded.last_seen_at
 where public.peris_account_activity.last_seen_at<now()-interval '30 seconds';
end $$;

create or replace function public.peris_account_directory(
 p_search text default '',p_faction text default null,p_activity text default 'all',
 p_sort text default 'active',p_offset integer default 0,p_limit integer default 24
)returns jsonb language plpgsql stable security definer set search_path='' as $$
declare result jsonb;
begin
 if p_search is null or length(p_search)>40 or p_offset is null or p_offset<0 or p_offset>1000000
 or p_limit is null or p_limit<1 or p_limit>100 or p_activity is null or p_activity not in('all','online','recent')
 or p_sort is null or p_sort not in('active','name','cities','hero')
 or(p_faction is not null and p_faction not in('roman','spartan','persian','egyptian','orc','elf','dwarf','gnome','pandaren','undead','demon'))
 then raise exception 'Invalid account filters' using errcode='22023';end if;
 with summaries as (
  select p.id player_id,p.display_name,p.created_at joined_at,a.last_seen_at,
   coalesce(a.last_seen_at>now()-interval '2 minutes',false)online,
   cap.faction,cap.name capital_name,c.city_count,c.population,
   (select count(*)::integer from public.armies ar where ar.owner_id=p.id)army_count,
   h.id hero_id,h.class hero_class,coalesce(h.faction,cap.faction)hero_faction,
   case when h.id is null then 0 else(select max(l)from generate_series(1,20)l where 50*l*(l-1)<=h.experience)end hero_level
  from public.players p
  join lateral(select s.name,s.faction from public.settlements s where s.owner_id=p.id order by s.id limit 1)cap on true
  join lateral(select count(*)::integer city_count,coalesce(sum(s.population),0)::bigint population from public.settlements s where s.owner_id=p.id)c on true
  left join public.peris_account_activity a on a.player_id=p.id
  left join lateral(select hero.id,hero.class,hero.experience,home.faction from public.peris_heroes hero
   left join public.armies army on army.id=hero.army_id
   left join public.settlements home on home.id=army.home_settlement_id
   where hero.owner_id=p.id order by hero.experience desc,hero.id limit 1)h on true
  where strpos(lower(p.display_name),lower(btrim(p_search)))>0
   and(p_faction is null or cap.faction=p_faction)
   and(p_activity='all' or p_activity='online' and a.last_seen_at>now()-interval '2 minutes'
    or p_activity='recent' and a.last_seen_at>now()-interval '24 hours')
 ),ordered as (
  select s.*,row_number()over(order by
   case when p_sort='active' then s.last_seen_at end desc nulls last,
   case when p_sort='cities' then s.city_count end desc,
   case when p_sort='hero' then s.hero_level end desc,
   lower(s.display_name),s.player_id)ordinal from summaries s
 ),page as(select * from ordered order by ordinal offset p_offset limit p_limit)
 select jsonb_build_object('server_now',now(),'total',(select count(*)from summaries),
  'accounts',coalesce((select jsonb_agg(to_jsonb(page)-'ordinal' order by ordinal)from page),'[]'::jsonb))into result;
 return result;
end $$;
-- Login never allocates; creation never silently takes over an occupied name.
-- A creation UUID makes a lost-response retry safe even after reconnecting.
create or replace function public.peris_enter_account(
 p_display_name text,p_mode text default 'login',p_faction text default null,p_creation_id uuid default null
)returns jsonb language plpgsql security definer set search_path='' as $$
declare u uuid:=auth.uid();n text:=btrim(p_display_name);r public.players%rowtype;
 bound uuid;prior public.peris_account_creations%rowtype;receipt jsonb;created boolean:=false;
begin
 if u is null then raise exception 'Authentication required' using errcode='42501';end if;
 if n is null or n!~'^[A-Za-z0-9 _-]{2,20}$'or p_mode is null or p_mode not in('login','create')then
  raise exception 'Choose a valid ruler name and account action' using errcode='22023';end if;
 if p_mode='create' and(p_creation_id is null or p_faction is null or p_faction not in('roman','spartan','persian','egyptian','orc','elf','dwarf','gnome','pandaren','undead','demon'))then
  raise exception 'Choose a race for your new account' using errcode='22023';end if;
 perform pg_advisory_xact_lock(hashtextextended(u::text,72215));
 select player_id into bound from public.peris_account_sessions where auth_id=u;
 if bound is null and exists(select 1 from public.players where id=u)then bound:=u;end if;
 if bound is not null and not exists(select 1 from public.players where id=bound and lower(display_name)=lower(n))then
  raise exception 'Choose a fresh browser session to switch rulers' using errcode='PT409';end if;
 perform pg_advisory_xact_lock(hashtextextended(lower(n),72214));
 select * into r from public.players where lower(display_name)=lower(n);
 if p_mode='login' then
  if r.id is null then raise exception 'No account has that name. Choose Create account to start a realm.' using errcode='PT404';end if;
 else
  perform pg_advisory_xact_lock(hashtextextended(p_creation_id::text,72216));
  select * into prior from public.peris_account_creations where request_id=p_creation_id;
  if prior.player_id is not null then
   if r.id is distinct from prior.player_id or prior.faction<>p_faction then
    raise exception 'This creation request belongs to another name or race' using errcode='22023';end if;
  elsif r.id is not null then
   raise exception 'That name already belongs to a ruler. Log in or choose another name.' using errcode='PT422';
  else
   receipt:=public.peris_login(n);
   select * into r from public.players where id=(receipt->>'player_id')::uuid;
   update public.settlements set faction=p_faction where owner_id=r.id;
   update public.armies set name='First host' where owner_id=r.id;
   insert into public.peris_account_creations(request_id,player_id,faction)values(p_creation_id,r.id,p_faction);
  end if;
  created:=true;
 end if;
 receipt:=public.peris_login(n);
 perform public.peris_note_account_activity();
 return receipt||jsonb_build_object('created',created);
end $$;
create or replace function public.peris_guild_card(p_id uuid,p_private boolean default false)returns jsonb
language sql stable security definer set search_path='' as $$
 select jsonb_build_object('id',g.id,'name',g.name,'tag',g.tag,'description',g.description,
  'motd',case when p_private then g.motd else '' end,'treasury',case when p_private then g.treasury else null end,
  'leader_id',g.leader_id,'recruitment',g.recruitment,'focus',g.focus,'crest',g.crest,'created_at',g.created_at,
  'members',(select count(*)from public.peris_guild_members where guild_id=g.id),
  'cities',(select count(*)from public.settlements s join public.peris_guild_members m on m.player_id=s.owner_id where m.guild_id=g.id),
  'population',(select coalesce(sum(s.population),0)from public.settlements s join public.peris_guild_members m on m.player_id=s.owner_id where m.guild_id=g.id),
  'online',(select count(*)from public.peris_guild_members m join public.peris_account_activity a on a.player_id=m.player_id where m.guild_id=g.id and a.last_seen_at>now()-interval '2 minutes'))
 from public.peris_guilds g where g.id=p_id
$$;

create or replace function public.peris_social_directory(p_kind text default 'guilds',p_search text default '',p_focus text default 'all',p_offset integer default 0)returns jsonb
language plpgsql stable security definer set search_path='' as $$
declare u uuid:=public.peris_player_id();rows jsonb;total bigint;
begin
 if u is null or not exists(select 1 from public.players where id=u)then raise exception 'Enter a ruler account first' using errcode='42501';end if;
 if p_kind is null or p_kind not in('guilds','players')or p_search is null or length(p_search)>40 or p_offset is null or p_offset<0 or p_offset>1000000
 or p_focus is null or p_focus not in('all','balanced','warfare','economy','adventure')then raise exception 'Invalid directory filters' using errcode='22023';end if;
 if p_kind='guilds'then
  select count(*)into total from public.peris_guilds where(strpos(lower(name),lower(btrim(p_search)))>0 or strpos(lower(tag),lower(btrim(p_search)))>0)and(p_focus='all'or focus=p_focus);
  select coalesce(jsonb_agg(card order by n),'[]')into rows from(
   select public.peris_guild_card(g.id)card,row_number()over(order by (select count(*)from public.peris_guild_members where guild_id=g.id)desc,lower(g.name),g.id)n
   from public.peris_guilds g where(strpos(lower(name),lower(btrim(p_search)))>0 or strpos(lower(tag),lower(btrim(p_search)))>0)and(p_focus='all'or focus=p_focus)
   order by n offset p_offset limit 24)q;
 else
  select count(*)into total from public.players where id<>u and strpos(lower(display_name),lower(btrim(p_search)))>0;
  select coalesce(jsonb_agg(to_jsonb(q)-'n'order by n),'[]')into rows from(
   select p.id,p.display_name as name,cap.faction,m.guild_id,g.tag guild_tag,a.last_seen_at,
    coalesce(a.last_seen_at>now()-interval '2 minutes',false)online,
    (select count(*)from public.settlements where owner_id=p.id)cities,
    (select coalesce(sum(population),0)from public.settlements where owner_id=p.id)population,
    row_number()over(order by a.last_seen_at desc nulls last,lower(p.display_name),p.id)n
   from public.players p left join public.peris_guild_members m on m.player_id=p.id left join public.peris_guilds g on g.id=m.guild_id
   left join public.peris_account_activity a on a.player_id=p.id
   left join lateral(select faction from public.settlements where owner_id=p.id order by id limit 1)cap on true
   where p.id<>u and strpos(lower(p.display_name),lower(btrim(p_search)))>0 order by n offset p_offset limit 24)q;
 end if;
 return jsonb_build_object('items',rows,'total',total,'server_now',now());
end $$;

create or replace function public.peris_social_guild(p_id uuid)returns jsonb
language plpgsql stable security definer set search_path='' as $$
declare u uuid:=public.peris_player_id();own boolean;perms jsonb;result jsonb;
begin
 if u is null or not exists(select 1 from public.players where id=u)then raise exception 'Enter a ruler account first' using errcode='42501';end if;
 if not exists(select 1 from public.peris_guilds where id=p_id)then raise exception 'This guild no longer exists' using errcode='PT404';end if;
 select exists(select 1 from public.peris_guild_members where player_id=u and guild_id=p_id)into own;
 select coalesce(r.permissions,'[]')into perms from public.peris_guild_members m join public.peris_guild_roles r on r.id=m.role_id where m.player_id=u and m.guild_id=p_id;perms:=coalesce(perms,'[]');
 select jsonb_build_object('guild',public.peris_guild_card(p_id,own),'permissions',perms,
  'members',coalesce((select jsonb_agg(to_jsonb(q)order by q.rank desc,lower(q.name))from(
   select p.id,p.display_name name,m.role_id,r.name role_name,r.rank,m.joined_at,m.specialization,cap.faction,
    (select count(*)from public.settlements where owner_id=p.id)cities,(select coalesce(sum(population),0)from public.settlements where owner_id=p.id)population,
    coalesce(a.last_seen_at>now()-interval '2 minutes',false)online,case when own then a.last_seen_at else null end last_seen_at
   from public.peris_guild_members m join public.players p on p.id=m.player_id join public.peris_guild_roles r on r.id=m.role_id
   left join public.peris_account_activity a on a.player_id=p.id left join lateral(select faction from public.settlements where owner_id=p.id order by id limit 1)cap on true where m.guild_id=p_id)q),'[]'),
  'roles',case when own then coalesce((select jsonb_agg(to_jsonb(r)order by rank desc)from public.peris_guild_roles r where guild_id=p_id),'[]')else '[]'::jsonb end,
  'relations',coalesce((select jsonb_agg(to_jsonb(q))from(select r.id,r.left_id,r.right_id,r.proposer_id,r.kind,r.status,g.id other_id,g.name other_name,g.tag other_tag,g.crest
   from public.peris_guild_relations r join public.peris_guilds g on g.id=case when r.left_id=p_id then r.right_id else r.left_id end
   where p_id in(r.left_id,r.right_id)and(r.status='active'or own))q),'[]'),
  'invitations',case when perms ? 'invite'then coalesce((select jsonb_agg(to_jsonb(q))from(
   select i.id,i.guild_id,i.player_id,p.display_name player_name,g.name guild_name,g.tag guild_tag,g.crest,i.created_at,i.expires_at
   from public.peris_guild_invitations i join public.players p on p.id=i.player_id join public.peris_guilds g on g.id=i.guild_id
   where i.guild_id=p_id and i.status='pending'and i.expires_at>now())q),'[]')else '[]'::jsonb end,
  'applications',case when perms ? 'recruitment'then coalesce((select jsonb_agg(to_jsonb(q))from(
   select a.id,a.guild_id,a.player_id,p.display_name player_name,a.body,a.created_at from public.peris_guild_applications a join public.players p on p.id=a.player_id
   where a.guild_id=p_id and a.status='pending'order by a.created_at limit 100)q),'[]')else '[]'::jsonb end,
  'log',case when own then coalesce((select jsonb_agg(to_jsonb(q)order by id desc)from(select id,text,created_at from public.peris_guild_log where guild_id=p_id order by id desc limit 30)q),'[]')else '[]'::jsonb end,
  'ledger',case when own then coalesce((select jsonb_agg(to_jsonb(q)order by id desc)from(select id,player_name,amount,created_at from public.peris_guild_ledger where guild_id=p_id order by id desc limit 30)q),'[]')else '[]'::jsonb end)into result;
 return result;
end $$;

create or replace function public.peris_social_thread(p_kind text,p_id uuid,p_before bigint default null)returns jsonb
language plpgsql stable security definer set search_path='' as $$
declare u uuid:=public.peris_player_id();messages jsonb;first_id bigint;older bigint;
begin
 if u is null or p_kind is null or p_kind not in('direct','guild')then raise exception 'Choose a conversation' using errcode='22023';end if;
 if p_kind='direct'and not exists(select 1 from public.peris_message_threads where id=p_id and u in(player_a,player_b))
 or p_kind='guild'and not exists(select 1 from public.peris_guild_members where guild_id=p_id and player_id=u)then raise exception 'This conversation is private' using errcode='42501';end if;
 select coalesce(jsonb_agg(to_jsonb(q)order by id),'[]'),min(id)into messages,first_id from(
  select id,sender_id,sender_name,body,kind,created_at from public.peris_messages
  where(case when p_kind='direct'then thread_id=p_id else guild_id=p_id end)and(p_before is null or id<p_before)
  order by id desc limit 50)q;
 if exists(select 1 from public.peris_messages where(case when p_kind='direct'then thread_id=p_id else guild_id=p_id end)and id<first_id)then older:=first_id;end if;
 return jsonb_build_object('messages',messages,'before',older,'server_now',now());
end $$;

create or replace function public.peris_social_snapshot()returns jsonb
language plpgsql stable security definer set search_path='' as $$
declare u uuid:=public.peris_player_id();gid uuid;tag text;threads jsonb;invites jsonb;applications jsonb;unread bigint;attention bigint;blocked jsonb;
begin
 if u is null or not exists(select 1 from public.players where id=u)then raise exception 'Enter a ruler account first' using errcode='42501';end if;
 select m.guild_id,g.tag into gid,tag from public.peris_guild_members m join public.peris_guilds g on g.id=m.guild_id where m.player_id=u;
 with inbox as(
  select t.id,'direct'kind,p.display_name name,p.id player_id,null::text guild_tag,null::jsonb crest,last.body last_body,last.created_at last_at,
   (select count(*)from public.peris_messages m where m.thread_id=t.id and m.sender_id is distinct from u and m.id>coalesce(r.last_read_id,0))unread,coalesce(r.archived,false)archived,
   exists(select 1 from public.peris_message_blocks where owner_id=u and player_id=p.id)blocked
  from public.peris_message_threads t join public.players p on p.id=case when t.player_a=u then t.player_b else t.player_a end
  left join public.peris_message_reads r on r.owner_id=u and r.thread_id=t.id
  left join lateral(select body,created_at from public.peris_messages where thread_id=t.id order by id desc limit 1)last on true where u in(t.player_a,t.player_b)
  union all
  select g.id,'guild',g.name,null,g.tag,g.crest,last.body,last.created_at,
   (select count(*)from public.peris_messages msg where guild_id=g.id and sender_id is distinct from u and id>m.last_read_id),false,false
  from public.peris_guilds g join public.peris_guild_members m on m.guild_id=g.id and m.player_id=u
  left join lateral(select body,created_at from public.peris_messages where guild_id=g.id order by id desc limit 1)last on true
 )select coalesce((select jsonb_agg(to_jsonb(q)order by kind desc,last_at desc nulls last)from(select * from inbox order by kind desc,last_at desc nulls last limit 100)q),'[]'),(select coalesce(sum(inbox.unread),0)from inbox)into threads,unread;
 select coalesce(jsonb_agg(to_jsonb(q)order by created_at desc),'[]')into invites from(
  select i.id,i.guild_id,i.player_id,p.display_name player_name,g.name guild_name,g.tag guild_tag,g.crest,i.created_at,i.expires_at
  from public.peris_guild_invitations i join public.peris_guilds g on g.id=i.guild_id join public.players p on p.id=i.player_id
  where i.player_id=u and i.status='pending'and i.expires_at>now())q;
 select coalesce(jsonb_agg(to_jsonb(q)),'[]')into applications from(
  select a.id,a.guild_id,a.player_id,p.display_name player_name,a.body,a.created_at from public.peris_guild_applications a join public.players p on p.id=a.player_id where a.player_id=u and a.status='pending')q;
 select jsonb_array_length(invites)+(select count(*)from public.peris_guild_applications where guild_id=gid and status='pending'and public.peris_guild_permission(u,gid,'recruitment'))+
  (select count(*)from public.peris_guild_relations where gid in(left_id,right_id)and proposer_id<>gid and status='pending'and public.peris_guild_permission(u,gid,'diplomacy'))into attention;
 select coalesce(jsonb_agg(jsonb_build_object('id',p.id,'name',p.display_name)),'[]')into blocked from public.peris_message_blocks b join public.players p on p.id=b.player_id where owner_id=u;
 return jsonb_build_object('server_now',now(),'guild_id',gid,'guild_tag',tag,'threads',threads,'invitations',invites,'applications',applications,'attention',attention,'unread',unread,'blocked',blocked);
end $$;

create or replace function public.peris_social_log(p_guild uuid,p_text text)returns void
language sql security definer set search_path='' as $$
 insert into public.peris_guild_log(guild_id,text)values(p_guild,p_text)
$$;
create or replace function public.peris_guild_join(p_guild uuid,p_player uuid)returns void
language plpgsql security definer set search_path='' as $$
declare role uuid;v_name text;
begin
 if exists(select 1 from public.peris_guild_members where player_id=p_player)then raise exception 'This ruler already belongs to a guild' using errcode='PT409';end if;
 if(select count(*)from public.peris_guild_members where guild_id=p_guild)>=60 then raise exception 'This guild is full (60 members)' using errcode='PT409';end if;
 select id into role from public.peris_guild_roles where guild_id=p_guild and key='member';
 if role is null then raise exception 'This guild no longer exists' using errcode='PT404';end if;
 insert into public.peris_guild_members(player_id,guild_id,role_id,last_read_id)
 values(p_player,p_guild,role,coalesce((select max(id)from public.peris_messages where guild_id=p_guild),0));
 update public.peris_guild_invitations set status='cancelled'where player_id=p_player and status='pending';
 update public.peris_guild_applications set status='cancelled'where player_id=p_player and status='pending';
 select display_name into v_name from public.players where id=p_player;
 perform public.peris_social_log(p_guild,v_name||' joined the guild.');
end $$;

create or replace function public.peris_social_command(p_request_id uuid,p_command jsonb)returns jsonb
language plpgsql security definer set search_path='' as $$
declare u uuid:=public.peris_player_id();v_name text;t text:=p_command->>'type';gid uuid;target uuid;other uuid;role uuid;rid uuid;mid bigint;
 g public.peris_guilds%rowtype;m public.peris_guild_members%rowtype;actor public.peris_guild_roles%rowtype;r public.peris_guild_roles%rowtype;
 inv public.peris_guild_invitations%rowtype;app public.peris_guild_applications%rowtype;rel public.peris_guild_relations%rowtype;
 old public.peris_social_receipts%rowtype;result jsonb:='{"ok":true}';perms jsonb;body text;n text;v_tag text;sigil text;color text;kind text;amount bigint;city bigint;last_id bigint;
begin
 if u is null or not exists(select 1 from public.players where id=u)then raise exception 'Enter a ruler account first' using errcode='42501';end if;
 if p_request_id is null or p_command is null or jsonb_typeof(p_command)<>'object'or length(p_command::text)>10000 or t is null then raise exception 'Invalid social request' using errcode='22023';end if;
 perform pg_advisory_xact_lock(hashtextextended(u::text,72319));
 select * into old from public.peris_social_receipts where owner_id=u and request_id=p_request_id;
 if old.request_id is not null then
  if old.command<>p_command then raise exception 'A retry must use the original action' using errcode='22023';end if;
  return old.result;
 end if;
 select display_name into v_name from public.players where id=u;
 -- Only guild structural changes share this short lock. DMs and read receipts
 -- for unrelated rulers remain independent. Game ticks never take this lock.
 if t not in('send','read','read_all','archive','block','unblock')then perform pg_advisory_xact_lock(72320);end if;
 select * into m from public.peris_guild_members where player_id=u;gid:=m.guild_id;
 select * into actor from public.peris_guild_roles where id=m.role_id;
 select * into g from public.peris_guilds where id=gid;

 if t='create'or t='edit'then
  n:=btrim(p_command->>'name');v_tag:=upper(btrim(p_command->>'tag'));
  color:=p_command->'crest'->>'color';sigil:=p_command->'crest'->>'sigil';
  if n is null or length(n)not between 3 and 32 or v_tag is null or v_tag!~'^[A-Z0-9]{2,5}$'
  or color is null or color!~'^#[0-9a-fA-F]{6}$'or sigil is null or sigil not in('sun','moon','swords','mountain','star','tower')
  or p_command->>'recruitment'is null or p_command->>'recruitment'not in('open','application','invite')
  or p_command->>'focus'is null or p_command->>'focus'not in('balanced','warfare','economy','adventure')
  or length(coalesce(p_command->>'description',''))>1200 or length(coalesce(p_command->>'motd',''))>800 then raise exception 'Check the guild name, tag and profile' using errcode='22023';end if;
  if exists(select 1 from public.peris_guilds where (lower(peris_guilds.name)=lower(n)or lower(peris_guilds.tag)=lower(v_tag))and(t='create'or id<>gid))then raise exception 'That guild name or tag is already taken' using errcode='PT409';end if;
  if t='create'then
   if gid is not null then raise exception 'Leave your current guild first' using errcode='PT409';end if;
   insert into public.peris_guilds(name,tag,description,motd,leader_id,recruitment,focus,crest)
   values(n,v_tag,coalesce(p_command->>'description',''),coalesce(p_command->>'motd',''),u,p_command->>'recruitment',p_command->>'focus',p_command->'crest')returning id into gid;
   insert into public.peris_guild_roles(guild_id,key,name,rank,permissions)values
   (gid,'leader','Guildmaster',100,'["invite","recruitment","kick","roles","edit","diplomacy","announce","treasury"]'),
   (gid,'officer','Officer',80,'["invite","recruitment","kick","announce"]'),(gid,'member','Member',20,'[]'),(gid,'recruit','Recruit',10,'[]');
   select id into role from public.peris_guild_roles where guild_id=gid and key='leader';
   insert into public.peris_guild_members(player_id,guild_id,role_id)values(u,gid,role);
   update public.peris_guild_invitations set status='cancelled'where player_id=u and status='pending';
   update public.peris_guild_applications set status='cancelled'where player_id=u and status='pending';
   perform public.peris_social_log(gid,v_name||' founded '||n||'.');result:=result||jsonb_build_object('guild_id',gid);
  else
   if not public.peris_guild_permission(u,gid,'edit')then raise exception 'Your rank cannot edit this guild' using errcode='42501';end if;
   update public.peris_guilds set name=n,tag=v_tag,description=coalesce(p_command->>'description',''),motd=coalesce(p_command->>'motd',''),recruitment=p_command->>'recruitment',focus=p_command->>'focus',crest=p_command->'crest'where id=gid;
   perform public.peris_social_log(gid,v_name||' updated the guild profile.');
  end if;
 elsif t='join'or t='apply'then
  target:=(p_command->>'guild_id')::uuid;
  if gid is not null then raise exception 'You already belong to a guild' using errcode='PT409';end if;
  select * into g from public.peris_guilds where id=target;
  if g.id is null then raise exception 'This guild no longer exists' using errcode='PT404';end if;
  if t='join'then
   if g.recruitment<>'open'then raise exception 'This guild requires an application or invitation' using errcode='42501';end if;
   perform public.peris_guild_join(target,u);result:=result||jsonb_build_object('guild_id',target);
  else
   if g.recruitment<>'application'then raise exception 'This guild is not accepting applications' using errcode='PT409';end if;
   if(select count(*)from public.peris_guild_applications where player_id=u and status='pending')>=5 then raise exception 'You can have five pending applications' using errcode='PT409';end if;
   if length(coalesce(p_command->>'body',''))>800 then raise exception 'Keep your application under 800 characters' using errcode='22023';end if;
   insert into public.peris_guild_applications(guild_id,player_id,body)values(target,u,coalesce(p_command->>'body',''))on conflict(guild_id,player_id)where status='pending'do update set body=excluded.body;
  end if;
 elsif t='invite'then
  if not public.peris_guild_permission(u,gid,'invite')then raise exception 'Your rank cannot invite players' using errcode='42501';end if;
  target:=(p_command->>'player_id')::uuid;
  if not exists(select 1 from public.players where id=target)then raise exception 'Ruler not found' using errcode='PT404';end if;
  if exists(select 1 from public.peris_guild_members where player_id=target)then raise exception 'This ruler already belongs to a guild' using errcode='PT409';end if;
  if(select count(*)from public.peris_guild_invitations where guild_id=gid and status='pending'and expires_at>now())>=100 then raise exception 'Review your pending invitations first' using errcode='PT409';end if;
  insert into public.peris_guild_invitations(guild_id,player_id,invited_by)values(gid,target,u)
  on conflict(guild_id,player_id)where status='pending'do update set expires_at=now()+interval '7 days',invited_by=u;
  perform public.peris_social_log(gid,v_name||' invited '||(select display_name from public.players where id=target)||'.');
 elsif t='invitation'or t='cancel_invite'then
  select * into inv from public.peris_guild_invitations where id=(p_command->>'id')::uuid for update;
  if inv.id is null or inv.status<>'pending'then raise exception 'This invitation is no longer pending' using errcode='PT409';end if;
  if t='cancel_invite'then
   if not public.peris_guild_permission(u,inv.guild_id,'invite')then raise exception 'Your rank cannot withdraw this invitation' using errcode='42501';end if;
   update public.peris_guild_invitations set status='cancelled'where id=inv.id;
  else
   if inv.player_id<>u then raise exception 'This is not your invitation' using errcode='42501';end if;
   if inv.expires_at<=now()then raise exception 'This invitation expired' using errcode='PT409';end if;
   if coalesce((p_command->>'accept')::boolean,false)then perform public.peris_guild_join(inv.guild_id,u);result:=result||jsonb_build_object('guild_id',inv.guild_id);end if;
   update public.peris_guild_invitations set status=case when coalesce((p_command->>'accept')::boolean,false)then 'accepted'else 'declined'end where id=inv.id;
  end if;
 elsif t='application'or t='cancel_application'then
  select * into app from public.peris_guild_applications where id=(p_command->>'id')::uuid for update;
  if app.id is null or app.status<>'pending'then raise exception 'This application is no longer pending' using errcode='PT409';end if;
  if t='cancel_application'then
   if app.player_id<>u then raise exception 'This is not your application' using errcode='42501';end if;
   update public.peris_guild_applications set status='cancelled'where id=app.id;
  else
   if not public.peris_guild_permission(u,app.guild_id,'recruitment')then raise exception 'Your rank cannot review applications' using errcode='42501';end if;
   if coalesce((p_command->>'accept')::boolean,false)then perform public.peris_guild_join(app.guild_id,app.player_id);end if;
   update public.peris_guild_applications set status=case when coalesce((p_command->>'accept')::boolean,false)then 'accepted'else 'declined'end where id=app.id;
  end if;
 elsif t='leave'or t='kick'then
  target:=case when t='leave'then u else(p_command->>'player_id')::uuid end;
  select gr.* into r from public.peris_guild_members gm join public.peris_guild_roles gr on gr.id=gm.role_id where gm.player_id=target and gm.guild_id=gid;
  if r.id is null then raise exception 'This ruler is not in your guild' using errcode='PT404';end if;
  if t='kick'and(not public.peris_guild_permission(u,gid,'kick')or target=u or r.rank>=actor.rank)then raise exception 'Your rank cannot remove this member' using errcode='42501';end if;
  if g.leader_id=target then raise exception 'Transfer leadership, or disband the guild, before leaving' using errcode='PT409';end if;
  delete from public.peris_guild_members where player_id=target;
  perform public.peris_social_log(gid,(select display_name from public.players where id=target)||case when t='leave'then ' left the guild.'else ' was removed by '||v_name||'.'end);
 elsif t='role_save'or t='role_delete'then
  if not public.peris_guild_permission(u,gid,'roles')then raise exception 'Your rank cannot manage ranks' using errcode='42501';end if;
  role:=nullif(p_command->>'id','')::uuid;select * into r from public.peris_guild_roles where id=role and guild_id=gid;
  if role is not null and(r.id is null or r.rank>=actor.rank or r.key='leader')then raise exception 'You cannot change this rank' using errcode='42501';end if;
  if t='role_delete'then
   if role is null or r.key in('leader','officer','member','recruit')then raise exception 'Default ranks cannot be deleted' using errcode='22023';end if;
   update public.peris_guild_members set role_id=(select id from public.peris_guild_roles where guild_id=gid and key='member')where role_id=role;
   delete from public.peris_guild_roles where id=role;
  else
   n:=btrim(p_command->>'name');perms:=p_command->'permissions';
   if n is null or length(n)not between 2 and 24 or jsonb_typeof(perms)is distinct from 'array'
   or p_command->>'rank'is null or(p_command->>'rank')::integer not between 1 and 99 or(p_command->>'rank')::integer>=actor.rank
   or exists(select 1 from jsonb_array_elements_text(perms)permission where permission not in('invite','recruitment','kick','roles','edit','diplomacy','announce','treasury')or not(actor.permissions ? permission))then raise exception 'Choose a lower rank and permissions you hold' using errcode='42501';end if;
   if role is null then
    if(select count(*)from public.peris_guild_roles where guild_id=gid)>=12 then raise exception 'You can have 12 ranks' using errcode='PT409';end if;
    insert into public.peris_guild_roles(guild_id,key,name,rank,permissions)values(gid,p_request_id::text,n,(p_command->>'rank')::integer,perms);
   else update public.peris_guild_roles set name=n,rank=(p_command->>'rank')::integer,permissions=perms where id=role;end if;
  end if;
  perform public.peris_social_log(gid,v_name||' updated guild ranks.');
 elsif t='assign_role'or t='specialization'then
  target:=(p_command->>'player_id')::uuid;select gr.* into r from public.peris_guild_members gm join public.peris_guild_roles gr on gr.id=gm.role_id where gm.player_id=target and gm.guild_id=gid;
  if not public.peris_guild_permission(u,gid,'roles')or r.id is null or r.rank>=actor.rank then raise exception 'Your rank cannot manage this member' using errcode='42501';end if;
  if t='specialization'then
   if p_command->>'specialization'is null or p_command->>'specialization'not in('balanced','offense','defense','economy')then raise exception 'Choose a valid specialization' using errcode='22023';end if;
   update public.peris_guild_members set specialization=p_command->>'specialization'where player_id=target;
  else
   select * into r from public.peris_guild_roles where id=(p_command->>'role_id')::uuid and guild_id=gid;
   if r.id is null or r.rank>=actor.rank or r.key='leader'or exists(select 1 from jsonb_array_elements_text(r.permissions)permission where not(actor.permissions ? permission))then raise exception 'Choose a lower rank with permissions you hold' using errcode='42501';end if;
   update public.peris_guild_members set role_id=r.id where player_id=target;
   perform public.peris_social_log(gid,v_name||' changed '||(select display_name from public.players where id=target)||'''s rank to '||r.name||'.');
  end if;
 elsif t='transfer'then
  if g.id is null or g.leader_id<>u then raise exception 'Only the guildmaster can transfer leadership' using errcode='42501';end if;
  target:=(p_command->>'player_id')::uuid;
  if target=u or not exists(select 1 from public.peris_guild_members where player_id=target and guild_id=gid)then raise exception 'Choose another guild member' using errcode='22023';end if;
  update public.peris_guild_members set role_id=(select id from public.peris_guild_roles where guild_id=gid and key=case when player_id=target then 'leader'else 'officer'end)where player_id in(u,target);
  update public.peris_guilds set leader_id=target where id=gid;
  perform public.peris_social_log(gid,v_name||' transferred leadership to '||(select display_name from public.players where id=target)||'.');
 elsif t='disband'then
  if g.id is null or g.leader_id<>u then raise exception 'Only the guildmaster can disband this guild' using errcode='42501';end if;
  if p_command->>'confirmation'is distinct from g.tag then raise exception 'Type the guild tag to confirm' using errcode='22023';end if;
  if g.treasury>0 then raise exception 'Withdraw the guild treasury before disbanding' using errcode='PT409';end if;
  delete from public.peris_guilds where id=gid;
 elsif t='diplomacy'then
  if not public.peris_guild_permission(u,gid,'diplomacy')then raise exception 'Your rank cannot manage diplomacy' using errcode='42501';end if;
  target:=(p_command->>'guild_id')::uuid;kind:=p_command->>'kind';
  if target is null or target=gid or not exists(select 1 from public.peris_guilds where id=target)or kind is null or kind not in('alliance','nap','war')then raise exception 'Choose another guild and a diplomatic relation' using errcode='22023';end if;
  if exists(select 1 from public.peris_guild_relations where left_id=least(gid,target)and right_id=greatest(gid,target))then raise exception 'End or withdraw the existing relation first' using errcode='PT409';end if;
  insert into public.peris_guild_relations(left_id,right_id,proposer_id,kind,status)values(least(gid,target),greatest(gid,target),gid,kind,case when kind='war'then 'active'else 'pending'end);
  perform public.peris_social_log(gid,v_name||case when kind='war'then ' declared war on 'else ' proposed '||case when kind='nap'then 'a non-aggression pact with 'else 'an alliance with 'end end||(select peris_guilds.name from public.peris_guilds where id=target)||'.');
  perform public.peris_social_log(target,'['||g.tag||'] '||g.name||case when kind='war'then ' declared war.'else ' proposed '||case when kind='nap'then 'a non-aggression pact.'else 'an alliance.'end end);
 elsif t='relation_reply'or t='relation_end'then
  select * into rel from public.peris_guild_relations where id=(p_command->>'id')::uuid for update;
  if not public.peris_guild_permission(u,gid,'diplomacy')or rel.id is null or gid not in(rel.left_id,rel.right_id)then raise exception 'Your rank cannot manage this relation' using errcode='42501';end if;
  if t='relation_reply'then
   if rel.status<>'pending'or rel.proposer_id=gid then raise exception 'Only the invited guild can answer this offer' using errcode='42501';end if;
   if coalesce((p_command->>'accept')::boolean,false)then update public.peris_guild_relations set status='active'where id=rel.id;
   else delete from public.peris_guild_relations where id=rel.id;end if;
  else delete from public.peris_guild_relations where id=rel.id;end if;
  perform public.peris_social_log(rel.left_id,v_name||case when t='relation_end'then ' ended the diplomatic relation.'when coalesce((p_command->>'accept')::boolean,false)then ' accepted the diplomatic offer.'else ' declined the diplomatic offer.'end);
  perform public.peris_social_log(rel.right_id,v_name||case when t='relation_end'then ' ended the diplomatic relation.'when coalesce((p_command->>'accept')::boolean,false)then ' accepted the diplomatic offer.'else ' declined the diplomatic offer.'end);
 elsif t='donate'or t='withdraw'then
  amount:=(p_command->>'amount')::bigint;city:=(p_command->>'settlement_id')::bigint;
  if gid is null or amount is null or amount<1 or amount>100000 or not exists(select 1 from public.settlements where id=city and owner_id=u)then raise exception 'Choose your city and 1–100,000 gold' using errcode='22023';end if;
  perform public.peris_settle(u);perform 1 from public.settlements where id=city for update;
  if t='donate'then
   if(select gold from public.settlements where id=city)<amount then raise exception 'This city has insufficient gold' using errcode='PT409';end if;
   update public.settlements set gold=gold-amount where id=city;
   update public.peris_guilds set treasury=treasury+amount where id=gid;
  else
   if not public.peris_guild_permission(u,gid,'treasury')then raise exception 'Your rank cannot withdraw gold' using errcode='42501';end if;
   if g.treasury<amount then raise exception 'Insufficient guild gold' using errcode='PT409';end if;
   if(select gold+amount>capacity from public.settlements where id=city)then raise exception 'This city has insufficient storage space' using errcode='PT409';end if;
   update public.peris_guilds set treasury=treasury-amount where id=gid;
   update public.settlements set gold=gold+amount where id=city;
  end if;
  insert into public.peris_guild_ledger(guild_id,player_id,player_name,amount)values(gid,u,v_name,case when t='donate'then amount else -amount end);
 elsif t='send'or t='announce'then
  body:=btrim(p_command->>'body');kind:=coalesce(p_command->>'kind','direct');
  if body is null or length(body)not between 1 and 2000 or kind not in('direct','guild')then raise exception 'Write a message of 1–2,000 characters' using errcode='22023';end if;
  if(select count(*)from public.peris_messages where sender_id=u and created_at>now()-interval '1 minute')>=30 then raise exception 'You are sending too quickly. Wait a moment.' using errcode='PT429';end if;
  if kind='guild'or t='announce'then
   if gid is null then raise exception 'Join a guild to use its channel' using errcode='42501';end if;
   if t='announce'and not public.peris_guild_permission(u,gid,'announce')then raise exception 'Your rank cannot post announcements' using errcode='42501';end if;
   -- Membership deletion waits until this send finishes.
   perform 1 from public.peris_guild_members where player_id=u and guild_id=gid for key share;
   if not found then raise exception 'Join a guild to use its channel' using errcode='42501';end if;
   insert into public.peris_messages(guild_id,sender_id,sender_name,body,kind)values(gid,u,v_name,body,case when t='announce'then 'announcement'else 'message'end)returning id into mid;
   result:=result||jsonb_build_object('thread_id',gid,'kind','guild','message_id',mid);
  else
   target:=(p_command->>'player_id')::uuid;
   if target is null or target=u or not exists(select 1 from public.players where id=target)then raise exception 'Choose another ruler to message' using errcode='22023';end if;
   if exists(select 1 from public.peris_message_blocks where(owner_id=u and player_id=target)or(owner_id=target and player_id=u))then raise exception 'Messages are blocked between these rulers' using errcode='PT403';end if;
   insert into public.peris_message_threads(player_a,player_b)values(least(u,target),greatest(u,target))on conflict(player_a,player_b)do update set player_a=excluded.player_a returning id into rid;
   insert into public.peris_messages(thread_id,sender_id,sender_name,body)values(rid,u,v_name,body)returning id into mid;
   insert into public.peris_message_reads(owner_id,thread_id,last_read_id)values(u,rid,0),(target,rid,0)
   on conflict(owner_id,thread_id)do update set archived=false;
   result:=result||jsonb_build_object('thread_id',rid,'kind','direct','message_id',mid);
  end if;
 elsif t='read'or t='archive'then
  rid:=(p_command->>'id')::uuid;kind:=p_command->>'kind';
  if kind is null or kind not in('direct','guild')then raise exception 'Choose a conversation' using errcode='22023';end if;
  if kind='direct'then
   if not exists(select 1 from public.peris_message_threads where id=rid and u in(player_a,player_b))then raise exception 'This conversation is private' using errcode='42501';end if;
   select coalesce(max(id),0)into last_id from public.peris_messages where thread_id=rid;
   if t='read'then last_id:=least(last_id,greatest(0,coalesce((p_command->>'up_to')::bigint,0)));end if;
   insert into public.peris_message_reads(owner_id,thread_id,last_read_id,archived)values(u,rid,last_id,case when t='archive'then coalesce((p_command->>'archived')::boolean,true)else false end)
   on conflict(owner_id,thread_id)do update set last_read_id=greatest(public.peris_message_reads.last_read_id,excluded.last_read_id),archived=case when t='archive'then excluded.archived else public.peris_message_reads.archived end;
  else
   if gid is null or rid<>gid or t='archive'then raise exception 'Join this guild to read its channel' using errcode='42501';end if;
   select least(coalesce(max(id),0),greatest(0,coalesce((p_command->>'up_to')::bigint,0)))into last_id from public.peris_messages where guild_id=gid;
   update public.peris_guild_members set last_read_id=greatest(last_read_id,last_id)where player_id=u;
  end if;
 elsif t='read_all'then
  insert into public.peris_message_reads(owner_id,thread_id,last_read_id)
  select u,t.id,coalesce((select max(id)from public.peris_messages where thread_id=t.id),0)from public.peris_message_threads t where u in(t.player_a,t.player_b)
  on conflict(owner_id,thread_id)do update set last_read_id=greatest(public.peris_message_reads.last_read_id,excluded.last_read_id);
  update public.peris_guild_members set last_read_id=greatest(last_read_id,coalesce((select max(id)from public.peris_messages where guild_id=gid),0))where player_id=u;
 elsif t='block'or t='unblock'then
  target:=(p_command->>'player_id')::uuid;
  if target is null or target=u or not exists(select 1 from public.players where id=target)then raise exception 'Choose another ruler' using errcode='22023';end if;
  if t='block'then insert into public.peris_message_blocks(owner_id,player_id)values(u,target)on conflict do nothing;
  else delete from public.peris_message_blocks where owner_id=u and player_id=target;end if;
 else raise exception 'Unknown social action' using errcode='22023';
 end if;
 insert into public.peris_social_receipts(owner_id,request_id,command,result)values(u,p_request_id,p_command,result);
 return result;
end $$;

-- Guild support: troops belong to their sender, never to the city receiving help.
create table if not exists public.peris_guild_reinforcements (
 id bigint generated always as identity primary key,
 owner_id uuid not null references public.players(id) on delete cascade,
 recipient_id uuid not null references public.players(id) on delete cascade,
 source_settlement_id bigint not null references public.settlements(id),
 target_settlement_id bigint not null references public.settlements(id),
 troops jsonb not null,
 march_path jsonb not null,
 target_x integer not null, target_y integer not null,
 status text not null default 'outbound' check(status in('outbound','stationed','returning')),
 departure_at timestamptz not null default public.peris_game_now(), arrival_at timestamptz,
 check(owner_id<>recipient_id)
);
alter table public.peris_guild_reinforcements add column if not exists faction text;
alter table public.peris_guild_reinforcements add column if not exists recipient_settlement_id bigint references public.settlements(id);
update public.peris_guild_reinforcements set recipient_settlement_id=target_settlement_id where recipient_settlement_id is null and status<>'returning';
create index if not exists peris_guild_reinforcements_due on public.peris_guild_reinforcements(owner_id,arrival_at)
 where status in('outbound','returning');
create index if not exists peris_guild_reinforcements_city on public.peris_guild_reinforcements(target_settlement_id)where status='stationed';
alter table public.peris_guild_reinforcements enable row level security;
revoke all on public.peris_guild_reinforcements from public,anon,authenticated;
grant select on public.peris_guild_reinforcements to authenticated;
drop policy if exists "guild reinforcement participants" on public.peris_guild_reinforcements;
create policy "guild reinforcement participants" on public.peris_guild_reinforcements for select to authenticated
 using(owner_id=public.peris_player_id() or recipient_id=public.peris_player_id());

-- Only guildmates and their living city locations; no inventory or private queues.
create or replace function public.peris_guild_reinforcement_targets() returns jsonb
language sql stable security definer set search_path='' as $$
 select coalesce(jsonb_agg(jsonb_build_object('id',s.id,'name',s.name,'owner_id',p.id,'owner_name',p.display_name,'x',s.x,'y',s.y)
 order by lower(p.display_name),lower(s.name),s.id),'[]'::jsonb)
 from public.peris_guild_members own
 join public.peris_guild_members other on other.guild_id=own.guild_id and other.player_id<>own.player_id
 join public.players p on p.id=other.player_id and p.defeated_at is null
 join public.settlements s on s.owner_id=p.id and s.ruined_at is null
 where own.player_id=public.peris_player_id()
$$;
revoke all on function public.peris_guild_reinforcement_targets() from public,anon;
grant execute on function public.peris_guild_reinforcement_targets() to authenticated;

create or replace function public.peris_guild_reinforcement_return(p_id bigint) returns boolean
language plpgsql security definer set search_path='' as $$
declare r public.peris_guild_reinforcements%rowtype;target jsonb;pace numeric;
begin
 select * into r from public.peris_guild_reinforcements where id=p_id for update;
 if r.id is null then return false;end if;
 select coalesce(min(speed),40)into pace from public.peris_unit_catalog where coalesce((r.troops->>unit)::integer,0)>0;
 pace:=greatest(1,22*pace/40);
 -- The actual return path is authoritative; no instant transfer.
 target:=public.peris_ruin_route(r.owner_id,r.target_x,r.target_y);
 -- The nearest reachable living home city receives the surviving troops.
 if target is null then delete from public.peris_guild_reinforcements where id=r.id;return false;end if;
 update public.peris_guild_reinforcements set target_settlement_id=(target->>'city_id')::bigint,
  march_path=target->'path',target_x=(target->>'x')::integer,target_y=(target->>'y')::integer,
  status='returning',departure_at=public.peris_game_now(),arrival_at=public.peris_game_now()+make_interval(secs=>greatest(2,(target->>'distance')::numeric/pace)::double precision)
 where id=r.id;
 return true;
end $$;
revoke all on function public.peris_guild_reinforcement_return(bigint) from public,anon,authenticated;

create or replace function public.peris_recall_guild_reinforcements(p_id bigint) returns jsonb
language plpgsql security definer set search_path='' as $$
declare u uuid:=public.peris_player_id();r public.peris_guild_reinforcements%rowtype;
begin
 select * into r from public.peris_guild_reinforcements where id=p_id and owner_id=u;
 if r.id is null then raise exception 'Only stationed reinforcements you sent can be recalled';end if;
 if not public.peris_lock_battle_participants(u,r.recipient_id)then raise exception 'Another order is settling. Try recalling again.'using errcode='55P03';end if;
 select * into r from public.peris_guild_reinforcements where id=p_id and owner_id=u for update;
 if r.id is null or r.status<>'stationed' then raise exception 'Only stationed reinforcements you sent can be recalled';end if;
 if exists(select 1 from public.battles where raid_city_id=r.target_settlement_id and status='active')then raise exception 'Wait for the city battle to end before recalling reinforcements';end if;
 perform public.peris_guild_reinforcement_return(r.id);
 return jsonb_build_object('ok',true);
end $$;
revoke all on function public.peris_recall_guild_reinforcements(bigint) from public,anon;
grant execute on function public.peris_recall_guild_reinforcements(bigint) to authenticated;

drop function if exists public.peris_send_guild_reinforcements(bigint,bigint,jsonb,jsonb);
create or replace function public.peris_send_guild_reinforcements(p_source bigint,p_target bigint,p_troops jsonb,p_path jsonb,p_army bigint default null) returns jsonb
language plpgsql security definer set search_path='' as $$
declare u uuid:=public.peris_player_id();s public.settlements%rowtype;d public.settlements%rowtype;
 selected jsonb;stock jsonb;remaining jsonb;origin jsonb;arrival jsonb;distance numeric;pace numeric;role text;new_id bigint;army public.armies%rowtype;
begin
 if u is null then raise exception 'Authentication required';end if;
 -- Stable participant locks serialize opposite dispatches and guild/army changes.
 select * into d from public.settlements where id=p_target;
 if not public.peris_lock_battle_participants(u,d.owner_id)then raise exception 'Another order is settling. Try sending again.'using errcode='55P03';end if;
 perform 1 from public.peris_guild_members where player_id in(u,d.owner_id)order by player_id for share;
 perform public.peris_settle(u,public.peris_game_now());
 select * into s from public.settlements where id=p_source and owner_id=u and ruined_at is null for update;
 select * into d from public.settlements where id=p_target and owner_id<>u and ruined_at is null for update;
 if s.id is null or d.id is null or not exists(select 1 from public.peris_guild_members a join public.peris_guild_members b on b.guild_id=a.guild_id
  where a.player_id=u and b.player_id=d.owner_id) then raise exception 'Choose your city and a living guild member city';end if;
 if exists(select 1 from public.players where id in(u,d.owner_id) and defeated_at is not null)then raise exception 'The ruler is defeated';end if;
 if exists(select 1 from public.battles where status='active'and (attacker_owner_id=u or defender_owner_id=u))then raise exception 'Finish the current battle first';end if;
 selected:=public.peris_garrison_troops(p_troops);
 if public.peris_roster_total(selected)=0 then raise exception 'Send at least one soldier';end if;
 if p_army is null then
  select unit_roster into stock from public.peris_city_garrisons where owner_id=u and settlement_id=s.id for update;
  if stock is null then raise exception 'No permanent garrison troops available';end if;
  stock:=public.peris_roster(stock);
  origin:=public.peris_home_army_position(s.x,s.y);
 else
  select * into army from public.armies where id=p_army and owner_id=u for update;
  if army.id is null or army.status<>'idle' or army.raid_target_id is not null or army.raid_city_id is not null or army.raid_reserve is not null then raise exception 'Choose an idle army in your sending city';end if;
  if exists(select 1 from public.peris_orders where owner_id=u and kind='recruit'and coalesce(recruit_destination,'legion')<>'garrison'and coalesce(army_id,(select min(id)from public.armies where owner_id=u))=army.id)then raise exception 'Finish this army''s recruitment first';end if;
  origin:=public.peris_army_position(army);
  if public.peris_wrap_cell(floor((origin->>'x')::numeric/128)::integer)<>public.peris_wrap_cell(floor(s.x/128.0)::integer)or public.peris_wrap_cell(floor((origin->>'y')::numeric/128)::integer)<>public.peris_wrap_cell(floor(s.y/128.0)::integer)then raise exception 'Bring the army into your sending city first';end if;
  stock:=public.peris_roster(to_jsonb(army));
 end if;
 foreach role in array array['infantry','spearmen','archers','elite','cavalry','scout','heavyCavalry','ram','catapult']loop
  if (selected->>role)::integer>(stock->>role)::integer then raise exception 'Insufficient troops in the selected source';end if;
 end loop;
 arrival:=public.peris_home_army_position(d.x,d.y);
 distance:=public.peris_route_distance((origin->>'x')::numeric,(origin->>'y')::numeric,(arrival->>'x')::numeric,(arrival->>'y')::numeric,p_path);
 select coalesce(min(speed),40)into pace from public.peris_unit_catalog where coalesce((selected->>unit)::integer,0)>0;
 pace:=greatest(1,22*pace/40);
 remaining:=public.peris_roster_add(stock,selected,-1);
 if p_army is not null then
  perform public.peris_write_roster(p_army,remaining);
  update public.armies set updated_at=now()where id=p_army;
 elsif public.peris_roster_total(remaining)=0 then delete from public.peris_city_garrisons where settlement_id=s.id and owner_id=u;
 else update public.peris_city_garrisons set unit_roster=remaining where settlement_id=s.id and owner_id=u;end if;
 insert into public.peris_guild_reinforcements(owner_id,recipient_id,source_settlement_id,target_settlement_id,troops,march_path,target_x,target_y,departure_at,arrival_at,faction,recipient_settlement_id)
 values(u,d.owner_id,s.id,d.id,selected,p_path,(arrival->>'x')::integer,(arrival->>'y')::integer,public.peris_game_now(),public.peris_game_now()+make_interval(secs=>greatest(2,distance/pace)::double precision),
  case when p_army is null then s.faction else coalesce((select faction from public.settlements where id=army.home_settlement_id),s.faction)end,d.id)returning id into new_id;
 return jsonb_build_object('ok',true,'reinforcement_id',new_id);
end $$;
revoke all on function public.peris_send_guild_reinforcements(bigint,bigint,jsonb,jsonb,bigint) from public,anon,authenticated;


create or replace function public.peris_guild_reinforcements_advance(p_owner uuid,p_until timestamptz)returns void
language plpgsql security definer set search_path='' as $$
declare r public.peris_guild_reinforcements%rowtype;city public.settlements%rowtype;is_guild boolean;
begin
 for r in select * from public.peris_guild_reinforcements where owner_id=p_owner and (status='stationed' or arrival_at<=p_until)
 order by id for update loop
  -- Serialize arrival and automatic return with the receiver's battle capture.
  if r.status in('outbound','stationed')and not public.peris_lock_battle_participants(r.owner_id,r.recipient_id)then continue;end if;
  select * into city from public.settlements where id=r.target_settlement_id and owner_id=r.recipient_id and ruined_at is null;
  select exists(select 1 from public.peris_guild_members a join public.peris_guild_members b on b.guild_id=a.guild_id where a.player_id=r.owner_id and b.player_id=r.recipient_id)into is_guild;
  if r.status='stationed' then
   if exists(select 1 from public.battles where raid_city_id=r.target_settlement_id and status='active')then continue;end if;
   if not is_guild or city.id is null then perform public.peris_guild_reinforcement_return(r.id);end if;
  elsif r.status='outbound' then
   if is_guild and city.id is not null then
    update public.peris_guild_reinforcements set status='stationed',arrival_at=null where id=r.id;
   else perform public.peris_guild_reinforcement_return(r.id);end if;
  elsif r.status='returning' then
   select * into city from public.settlements where id=r.target_settlement_id and owner_id=r.owner_id and ruined_at is null;
   if city.id is null then perform public.peris_guild_reinforcement_return(r.id);
   else perform public.peris_city_garrison_receive(r.owner_id,city.id,r.troops);
    delete from public.peris_guild_reinforcements where id=r.id;end if;
  end if;
 end loop;
end $$;
revoke all on function public.peris_guild_reinforcements_advance(uuid,timestamptz) from public,anon,authenticated;

-- Only the participating rulers can inspect their own reinforcements.
create or replace function public.peris_guild_reinforcement_status() returns jsonb
language sql stable security definer set search_path='' as $$
 select coalesce(jsonb_agg(jsonb_build_object(
  'id',r.id,'status',r.status,'owner_id',r.owner_id,'recipient_id',r.recipient_id,
  'source_city',s.name,'target_city',t.name,'troops',r.troops,
  'source_settlement_id',s.id,'target_settlement_id',t.id,'target_x',r.target_x,'target_y',r.target_y,
  'recipient_city_id',r.recipient_settlement_id,'recipient_city',supported.name,
  'owner_name',sender.display_name,'recipient_name',receiver.display_name,'faction',coalesce(r.faction,s.faction),
  'departure_at',r.departure_at,'arrival_at',r.arrival_at)
  order by r.departure_at desc),'[]'::jsonb)
 from public.peris_guild_reinforcements r
 join public.settlements s on s.id=r.source_settlement_id
 join public.settlements t on t.id=r.target_settlement_id
 left join public.settlements supported on supported.id=r.recipient_settlement_id
 join public.players sender on sender.id=r.owner_id
 join public.players receiver on receiver.id=r.recipient_id
 where (r.owner_id=public.peris_player_id() or r.recipient_id=public.peris_player_id())
$$;
revoke all on function public.peris_guild_reinforcement_status() from public,anon;
grant execute on function public.peris_guild_reinforcement_status() to authenticated;
-- Optional hooks keep focused upgrades usable before guild support is installed.
-- No public reads, schema mutation, or synthetic troop state on older worlds.
create or replace function public.peris_optional_guild_reinforcements()returns jsonb
language plpgsql stable security definer set search_path='' as $$
begin
 if to_regprocedure('public.peris_guild_reinforcement_status()')is null then return '[]'::jsonb;end if;
 return public.peris_guild_reinforcement_status();
end $$;
revoke all on function public.peris_optional_guild_reinforcements()from public,anon,authenticated;

create or replace function public.peris_due_guild_reinforcements()returns table(owner_id uuid,due timestamptz)
language plpgsql stable security definer set search_path='' as $$
begin
 if to_regclass('public.peris_guild_reinforcements')is null then return;end if;
 return query
 select r.owner_id,min(r.arrival_at)from public.peris_guild_reinforcements r
 where r.status in('outbound','returning')and r.arrival_at<=public.peris_game_now()group by r.owner_id
 union all
 select r.owner_id,min(public.peris_game_now())from public.peris_guild_reinforcements r
 join public.settlements s on s.id=r.target_settlement_id
 where r.status='stationed'and (s.ruined_at is not null or not exists(
  select 1 from public.peris_guild_members a join public.peris_guild_members b on b.guild_id=a.guild_id
  where a.player_id=r.owner_id and b.player_id=r.recipient_id))group by r.owner_id;
end $$;
revoke all on function public.peris_due_guild_reinforcements()from public,anon,authenticated;
create or replace function public.peris_snapshot()returns jsonb language plpgsql security definer set search_path='' as $$
declare u uuid:=public.peris_player_id();result jsonb;
begin
 if u is null then raise exception 'Authentication required';end if;
 perform public.peris_note_account_activity();
 perform public.peris_science_ensure(u);
 perform public.peris_city_migrate(s.id) from public.settlements s where s.owner_id=u;
 select jsonb_build_object('version',6,'server_now',public.peris_game_now(),'game_clock',public.peris_clock_snapshot(),
 'debug_enabled',coalesce((select enabled from public.peris_debug_config where id),false),
 'map',jsonb_build_object('version',4,'cols',200,'rows',200,'cell_size',128,'seed',1346720329,
   'total_players',(select count(*) from public.players),'total_settlements',(select count(*) from public.settlements)),
 'gameplay_version',1,'unit_balance_version',2,
 'account_science',coalesce((select jsonb_agg(s)from public.peris_account_science s where s.owner_id=u),'[]'::jsonb),
 'research_progress',coalesce((select jsonb_agg(p order by technology_id)from public.peris_research_progress p where p.owner_id=u),'[]'::jsonb),
 'heroes',coalesce((select jsonb_agg(h order by id)from public.peris_heroes h where owner_id=u),'[]'::jsonb),
 'hero_artifacts',coalesce((select jsonb_agg(i order by id)from public.peris_hero_artifacts i where owner_id=u),'[]'::jsonb),
 'settler_expeditions',coalesce((select jsonb_agg(e order by id)from public.peris_settler_expeditions e where owner_id=u),'[]'::jsonb),
 'campaign_farm_lists',coalesce((select jsonb_agg(l order by id)from public.peris_campaign_farm_lists l where owner_id=u),'[]'::jsonb),
 'campaign_farms',coalesce((select jsonb_agg(f order by id)from public.peris_campaign_farms f where owner_id=u),'[]'::jsonb),
 'campaign_farm_stats',coalesce((select jsonb_agg(jsonb_build_object('owner_id',u,'camp_id',s.camp_id,'raids',s.raids,'last_raid_at',coalesce(s.result->>'delivered_at',s.created_at::text),'last_loot',s.delivered,'total_loot',s.total_loot,'last_result',coalesce(s.winner_side,case when s.won then 'attacker'else 'defender'end),'last_losses',coalesce((s.result->>'attacker_losses')::integer,0))order by s.camp_id)from(
   select r.*,b.winner_side,coalesce((r.result#>>'{delivered,wood}')::numeric,0)+coalesce((r.result#>>'{delivered,stone}')::numeric,0)+coalesce((r.result#>>'{delivered,food}')::numeric,0)+coalesce((r.result#>>'{delivered,gold}')::numeric,0)as delivered,
    count(*)over(partition by r.camp_id)as raids,
    sum(coalesce((r.result#>>'{delivered,wood}')::numeric,0)+coalesce((r.result#>>'{delivered,stone}')::numeric,0)+coalesce((r.result#>>'{delivered,food}')::numeric,0)+coalesce((r.result#>>'{delivered,gold}')::numeric,0))over(partition by r.camp_id)as total_loot,
    row_number()over(partition by r.camp_id order by coalesce((r.result->>'delivered_at')::timestamptz,r.created_at)desc,r.id desc)as rank
   from public.peris_reports r join public.peris_camps c on c.id=r.camp_id and c.bandit left join public.battles b on b.id=r.battle_id where r.owner_id=u and r.result?'delivered'
  )s where s.rank=1),'[]'::jsonb),
 'garrisons',coalesce((select jsonb_agg(g order by row,col)from public.peris_garrisons g where owner_id=u),'[]'::jsonb),
 'guild_reinforcements',public.peris_optional_guild_reinforcements(),
 'city_reinforcements',coalesce((select jsonb_agg(r order by r.arrival_at,r.id)from public.peris_city_reinforcements r where r.owner_id=u),'[]'::jsonb),
 'city_garrisons',coalesce((select jsonb_agg(to_jsonb(g)||jsonb_build_object('infantry',public.peris_roster_class(g.unit_roster,'infantry'),'archers',public.peris_roster_class(g.unit_roster,'archers'),'cavalry',public.peris_roster_class(g.unit_roster,'cavalry'))order by g.settlement_id)from public.peris_city_garrisons g where g.owner_id=u),'[]'::jsonb),
 'ruin_evacuations',coalesce((select jsonb_agg(e order by e.arrival_at)from public.peris_ruin_evacuations e where e.owner_id=u),'[]'::jsonb),
 'players',coalesce((select jsonb_agg(p order by created_at)from public.players p where p.id=u
   or exists(select 1 from public.battles b where (b.attacker_owner_id=u or b.defender_owner_id=u) and (b.attacker_owner_id=p.id or b.defender_owner_id=p.id))
   or exists(select 1 from public.peris_challenges c where c.status='pending' and c.expires_at>public.peris_game_now() and (c.attacker_owner_id=u or c.defender_owner_id=u) and (c.attacker_owner_id=p.id or c.defender_owner_id=p.id))),'[]'::jsonb),
 'settlements',coalesce((select jsonb_agg(s order by id)from public.settlements s where s.owner_id=u),'[]'::jsonb),
 'buildings',coalesce((select jsonb_agg(b order by b.id)from public.buildings b join public.settlements s on s.id=b.settlement_id where s.owner_id=u),'[]'::jsonb),
 'unit_research',coalesce((select jsonb_agg(r order by r.unit)from public.peris_unit_research r join public.settlements s on s.id=r.settlement_id where s.owner_id=u),'[]'::jsonb),
 'spell_research',coalesce((select jsonb_agg(r order by r.spell_id)from public.peris_spell_research r join public.settlements s on s.id=r.settlement_id where s.owner_id=u),'[]'::jsonb),
 'city_slots',coalesce((select jsonb_agg(c order by c.slot_index)from public.peris_city_slots c join public.settlements s on s.id=c.settlement_id where s.owner_id=u),'[]'::jsonb),
 'map_plots',coalesce((select jsonb_agg(p order by p.row,p.col)from public.peris_map_plots p where p.owner_id=u),'[]'::jsonb),
 'armies',coalesce((select jsonb_agg(a order by id)from public.armies a where a.owner_id=u),'[]'::jsonb),
 'camps',coalesce((select jsonb_agg(to_jsonb(c)||jsonb_build_object('resources',stock.resources,'stock_updated_at',stock.stock_updated_at)order by c.id)from public.peris_camps c left join public.peris_camp_stock stock on stock.camp_id=c.id),'[]'::jsonb),
 'orders',coalesce((select jsonb_agg(o order by finish_at)from public.peris_orders o where owner_id=u),'[]'::jsonb),
 'battles',coalesce((select jsonb_agg(b order by id)from public.battles b where attacker_owner_id=u or defender_owner_id=u),'[]'::jsonb),
 'formations',coalesce((select jsonb_agg(f order by f.id)from public.battle_formations f join public.battles b on b.id=f.battle_id where b.status='active'and (b.attacker_owner_id=u or b.defender_owner_id=u)),'[]'::jsonb),
 'reports',coalesce((select jsonb_agg(r order by id desc)from (select * from public.peris_reports where owner_id=u and (coalesce((peris_reports.result->>'attacker_losses')::integer,0)>0 or not exists(select 1 from public.peris_campaign_farm_lists l where l.id=peris_reports.farm_list_id and l.owner_id=u and l.casualties_only)) order by id desc limit 50)r),'[]'::jsonb),
 'report_count',(select count(*)from public.peris_reports r where owner_id=u and (coalesce((r.result->>'attacker_losses')::integer,0)>0 or not exists(select 1 from public.peris_campaign_farm_lists l where l.id=r.farm_list_id and l.owner_id=u and l.casualties_only))),
 'hidden_report_count',(select count(*)from public.peris_reports r where owner_id=u and coalesce((r.result->>'attacker_losses')::integer,0)=0 and exists(select 1 from public.peris_campaign_farm_lists l where l.id=r.farm_list_id and l.owner_id=u and l.casualties_only)),
 'unread_report_count',(select count(*)from public.peris_reports r where owner_id=u and r.read_at is null and (coalesce((r.result->>'attacker_losses')::integer,0)>0 or not exists(select 1 from public.peris_campaign_farm_lists l where l.id=r.farm_list_id and l.owner_id=u and l.casualties_only))),
 'progress',coalesce((select jsonb_agg(p)from public.peris_progress p where owner_id=u),'[]'::jsonb),
 'claims',coalesce((select jsonb_agg(c)from public.peris_claims c where owner_id=u),'[]'::jsonb),
 'challenges',coalesce((select jsonb_agg(c)from public.peris_challenges c where (attacker_owner_id=u or defender_owner_id=u)and status='pending'and expires_at>public.peris_game_now()),'[]'::jsonb))into result;
 return result;
end $$;

-- Translated viewport intervals retain entities on both sides of a periodic seam.
create or replace function public.peris_map_development(p_sid bigint) returns integer
language sql stable security definer set search_path='' as $$
 select least(5,greatest(1,
 coalesce((select least(5,greatest(0,level)) from public.buildings where settlement_id=p_sid and building_type='market'),0),
 1+floor((coalesce((select sum(least(5,greatest(0,level))) from public.buildings where settlement_id=p_sid and building_type in ('lumber','quarry','farm','wall')),0)
 +coalesce((select sum(least(5,greatest(0,level))) from public.peris_city_slots where settlement_id=p_sid),0))/8)::integer))
$$;
create or replace function public.peris_map_axis_visible(p_value numeric,p_min integer,p_max integer) returns boolean
language sql immutable set search_path='' as $$
 select p_max-p_min>=25600 or exists(select 1 from generate_series(-1,1) shift
 where p_value+shift*25600>=p_min and p_value+shift*25600<p_max)
$$;
create or replace function public.peris_map_snapshot(p_min_x integer,p_min_y integer,p_max_x integer,p_max_y integer)
returns jsonb language plpgsql security definer set search_path='' as $$
declare u uuid:=public.peris_player_id();min_x integer:=p_min_x;min_y integer:=p_min_y;max_x integer:=p_max_x;max_y integer:=p_max_y;result jsonb;
begin
 if u is null then raise exception 'Authentication required';end if;
 if min_x is null or min_y is null or max_x is null or max_y is null
 or min_x>=max_x or min_y>=max_y or min_x < -38400 or min_y < -38400 or max_x > 38400 or max_y > 38400 then raise exception 'Choose valid map bounds';end if;
 with nearby_settlements as materialized (
   select s.id,s.owner_id,s.name,s.x,s.y,s.faction,s.ruined_at from public.settlements s where s.owner_id<>u
   and public.peris_map_axis_visible(s.x,min_x,max_x) and public.peris_map_axis_visible(s.y,min_y,max_y)
   order by s.id limit 601
 ), visible_settlements as (
   select s.id,s.owner_id,s.name,s.x,s.y,s.faction,s.ruined_at from public.settlements s where s.owner_id=u
   union all select * from (select * from nearby_settlements order by id limit 600) nearby
 ), army_positions as materialized (
   select a.*,(travel.position->>'x')::numeric as map_x,(travel.position->>'y')::numeric as map_y
   from public.armies a cross join lateral (select public.peris_army_position(a) as position) travel
   where a.owner_id=u or a.status='moving'
   or (public.peris_map_axis_visible(a.target_x,min_x,max_x) and public.peris_map_axis_visible(a.target_y,min_y,max_y))
 ), nearby_armies as materialized (
   select a.* from army_positions a where a.owner_id<>u
   and public.peris_map_axis_visible(a.map_x,min_x,max_x) and public.peris_map_axis_visible(a.map_y,min_y,max_y)
   order by a.id limit 601
 ), visible_armies as (
   select a.* from army_positions a where a.owner_id=u
   union all select * from (select * from nearby_armies order by id limit 600) nearby
 ), nearby_plots as materialized (
   select p.*,s.faction from public.peris_map_plots p join public.settlements s on s.id=p.settlement_id where p.owner_id<>u
   and public.peris_map_axis_visible(p.col*128+64,min_x,max_x) and public.peris_map_axis_visible(p.row*128+64,min_y,max_y)
   order by p.row,p.col limit 2001
 ), visible_plots as (
   select p.*,s.faction from public.peris_map_plots p join public.settlements s on s.id=p.settlement_id where p.owner_id=u
   union all select * from (select * from nearby_plots order by row,col limit 2000) nearby
 ), visible_owners as (
   select owner_id from visible_settlements union select owner_id from visible_armies union select owner_id from visible_plots union select u
 )
 select jsonb_build_object('server_now',public.peris_game_now(),'game_clock',public.peris_clock_snapshot(),
   'players',coalesce((select jsonb_agg(jsonb_build_object('id',p.id,'display_name',p.display_name) order by p.id)
     from public.players p join visible_owners o on o.owner_id=p.id),'[]'::jsonb),
   'settlements',coalesce((select jsonb_agg(to_jsonb(s)||jsonb_build_object('map_development',public.peris_map_development(s.id)) order by s.id) from visible_settlements s),'[]'::jsonb),
   'armies',coalesce((select jsonb_agg(case when a.owner_id=u then to_jsonb(a)-'map_x'-'map_y' else to_jsonb(a)-'map_x'-'map_y'-'raid_reserve'-'march_sent_at'-'march_cancel_until'-'march_origin'-'march_returning' end order by a.id) from visible_armies a),'[]'::jsonb),
   'map_plots',coalesce((select jsonb_agg(p order by p.row,p.col) from visible_plots p),'[]'::jsonb),
   'total_players',(select count(*) from public.players),'total_settlements',(select count(*) from public.settlements),
   'settlements_truncated',(select count(*)>600 from nearby_settlements),
   'armies_truncated',(select count(*)>600 from nearby_armies),
   'plots_truncated',(select count(*)>2000 from nearby_plots)) into result;
 return result;
end $$;
-- Automatic battles: persistent cooldowns, mirrored AI and read-only spectators.
alter table public.battle_formations add column if not exists attack_ready_at numeric not null default 0;
alter table public.battle_formations add column if not exists damage_target_id bigint;
alter table public.battle_formations add column if not exists charge_distance numeric not null default 0;
alter table public.battles alter column phase set default 'combat';
alter table public.battles alter column attacker_ready set default true;
alter table public.battles alter column defender_ready set default true;
update public.battles set phase='combat',attacker_ready=true,defender_ready=true,last_tick_at=public.peris_game_now() where status='active' and phase='deployment';

create or replace function public.peris_extent(f public.battle_formations,dx numeric,dy numeric)returns numeric language plpgsql immutable set search_path='' as $$
declare len numeric:=greatest(.001,sqrt(dx*dx+dy*dy));a numeric:=radians(f.facing);cols numeric:=least(f.columns,greatest(1,f.initial_soldiers));width numeric:=cols*8+12;depth numeric:=ceil(least(f.initial_soldiers,120)::numeric/cols)*8+12;
begin return sqrt(power((dx*cos(a)+dy*sin(a))/len*depth/2,2)+power((-dx*sin(a)+dy*cos(a))/len*width/2,2));end $$;
create or replace function public.peris_contact(f public.battle_formations,t public.battle_formations)returns numeric language sql immutable set search_path='' as $$select public.peris_extent(f,t.x-f.x,t.y-f.y)+public.peris_extent(t,f.x-t.x,f.y-t.y)+8$$;

create or replace function public.peris_auto_orders(p_battle bigint)returns void language plpgsql security definer set search_path='' as $$
declare f public.battle_formations%rowtype;t public.battle_formations%rowtype;old public.battle_formations%rowtype;loads jsonb:='{}';best numeric;previous numeric;distance numeric;
begin
 for f in select * from public.battle_formations where battle_id=p_battle and soldiers>0 and status<>'routed' order by id loop
 select e.* into t
 from public.battle_formations e where e.battle_id=p_battle and e.side<>f.side and e.soldiers>0 and e.status<>'routed'
 order by greatest(0,sqrt(power(e.x-f.x,2)+power(e.y-f.y,2))-public.peris_contact(f,e))+coalesce((loads->>e.id::text)::integer,0)*45-case when f.unit_type='cavalry' and e.unit_type='archers' then 110 else 0 end,e.id limit 1;
 if t.id is null then continue;end if;
 best:=greatest(0,sqrt(power(t.x-f.x,2)+power(t.y-f.y,2))-public.peris_contact(f,t))+coalesce((loads->>t.id::text)::integer,0)*45-case when f.unit_type='cavalry'and t.unit_type='archers'then 110 else 0 end;
 select * into old from public.battle_formations where id=f.target_formation_id and soldiers>0 and status<>'routed';
 if old.id is not null then
 previous:=greatest(0,sqrt(power(old.x-f.x,2)+power(old.y-f.y,2))-public.peris_contact(f,old))+coalesce((loads->>old.id::text)::integer,0)*45-case when f.unit_type='cavalry'and old.unit_type='archers'then 110 else 0 end;
 if sqrt(power(old.x-f.x,2)+power(old.y-f.y,2))<=public.peris_contact(f,old)+30 or previous<=best*1.3+15 then t:=old;end if;
 end if;
 distance:=sqrt(power(t.x-f.x,2)+power(t.y-f.y,2));
 update public.battle_formations set target_formation_id=t.id,target_x=t.x,target_y=t.y,fire_at_will=true,
 running=unit_type='cavalry' and distance>public.peris_contact(f,t)+70 and stamina>35,
 stance=case when unit_type='infantry' and t.unit_type='cavalry' and distance<180 then 'guard' else 'balanced' end,
 damage_pool=case when target_formation_id is distinct from t.id then 0 else damage_pool end,damage_target_id=t.id where id=f.id;
 loads:=jsonb_set(loads,array[t.id::text],to_jsonb(coalesce((loads->>t.id::text)::integer,0)+1),true);
 end loop;
end $$;

create or replace function public.peris_cast_spell_for(p_owner uuid,p_battle_id bigint,p_spell text,p_target bigint default null) returns jsonb language plpgsql security definer set search_path='' as $$
declare u uuid:=p_owner;b public.battles%rowtype;s public.settlements%rowtype;sp public.peris_spell_catalog%rowtype;f public.battle_formations%rowtype;t public.battle_formations%rowtype;
 own_side text;friend boolean;single_target boolean;l integer;mana integer;ready numeric;idx integer:=0;cas integer;troops integer;mor numeric;alive_a boolean;alive_d boolean;hero_bonus jsonb;
begin
 select * into b from public.battles where id=p_battle_id for update;
 if u is null or b.id is null or (u is distinct from b.attacker_owner_id and u is distinct from b.defender_owner_id) then raise exception 'Not your battle';end if;
 if b.status<>'active' or b.phase<>'combat' then raise exception 'Spells can only be cast during combat';end if;
 select * into sp from public.peris_spell_catalog where id=p_spell;
 select city.* into s from public.settlements city join public.peris_spell_research research on research.settlement_id=city.id join public.peris_city_slots tower on tower.settlement_id=city.id and tower.building_type='mage_tower'and tower.level>=sp.level where city.owner_id=u and research.spell_id=sp.id order by city.id limit 1;
 hero_bonus:=public.peris_hero_bonuses(case when b.attacker_owner_id=u then b.attacker_army_id else b.defender_army_id end);
 select level into l from public.peris_city_slots where settlement_id=s.id and building_type='mage_tower';
 if sp.id is null or coalesce(l,0)<sp.level or not exists(select 1 from public.peris_spell_research where settlement_id=s.id and spell_id=sp.id) then raise exception 'Research this spell in your mage tower first';end if;

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
 cas:=ceil(greatest(0,sp.damage-case when sp.chain>0 then idx*6 else 0 end)*(hero_bonus->>'spell')::numeric*(1-f.magic_defence));idx:=idx+1;
 troops:=greatest(0,least(f.initial_soldiers,f.soldiers-cas+ceil(sp.heal*(hero_bonus->>'spell')::numeric)::integer));
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
-- Public tactical command endpoints remain as explicit rejections for old clients.
create or replace function public.peris_order(p_battle_id bigint,p_order jsonb)returns jsonb language plpgsql security definer set search_path='' as $$begin raise exception 'Both armies are controlled automatically';end $$;
create or replace function public.peris_rally(p_battle_id bigint)returns jsonb language plpgsql security definer set search_path='' as $$begin raise exception 'Both armies are controlled automatically';end $$;
create or replace function public.peris_cast_spell(p_battle_id bigint,p_spell text,p_target bigint default null)returns jsonb language plpgsql security definer set search_path='' as $$begin raise exception 'The AI controls battle spells automatically';end $$;

create or replace function public.peris_auto_magic(p_battle bigint)returns void language plpgsql security definer set search_path='' as $$
declare b public.battles%rowtype;owner uuid;own_side text;sp public.peris_spell_catalog%rowtype;t public.battle_formations%rowtype;f public.battle_formations%rowtype;friendly boolean;all_targets boolean;mana_available integer;power_bonus numeric;utility numeric;score numeric;best numeric;choice text;target_id bigint;idx integer;missing integer;threat boolean;hero jsonb;
begin
 foreach own_side in array array['attacker','defender'] loop
 select * into b from public.battles where id=p_battle;
 if b.status<>'active' or b.elapsed<1 then return;end if;
 owner:=case when own_side='attacker'then b.attacker_owner_id else b.defender_owner_id end;
 if owner is null or b.elapsed<(case when own_side='attacker'then b.spell_ready_attacker else b.spell_ready_defender end) then continue;end if;
 mana_available:=coalesce(case when own_side='attacker'then b.mana_attacker else b.mana_defender end,0);
 hero:=public.peris_hero_bonuses(case when own_side='attacker'then b.attacker_army_id else b.defender_army_id end);power_bonus:=coalesce((hero->>'spell')::numeric,1);best:=0;choice:=null;
 for sp in select c.* from public.peris_spell_catalog c where c.mana<=mana_available and exists(select 1 from public.peris_spell_research r join public.settlements s on s.id=r.settlement_id join public.peris_city_slots tower on tower.settlement_id=s.id and tower.building_type='mage_tower' and tower.level>=c.level where s.owner_id=owner and r.spell_id=c.id) order by c.level,c.id loop
 friendly:=sp.target in('ally','allies');all_targets:=sp.target in('allies','enemies');
 for t in select * from public.battle_formations where battle_id=b.id and (side=own_side)=friendly and (sp.revive or soldiers>0 and status<>'routed') order by id loop
 utility:=0;idx:=0;
 for f in select * from public.battle_formations where battle_id=b.id and (side=own_side)=friendly and (sp.revive or soldiers>0 and status<>'routed')
 and (all_targets or id=t.id or sp.chain>0 or sp.radius>0 and power(x-t.x,2)+power(y-t.y,2)<=sp.radius*sp.radius)
 order by case when sp.chain>0 then case when id=t.id then -1 else power(x-t.x,2)+power(y-t.y,2)end else id end,id limit case when sp.chain>0 then sp.chain else 10000 end loop
 if friendly then
 missing:=f.initial_soldiers-f.soldiers;
 if missing>=least(sp.heal*power_bonus*.5,greatest(1,f.initial_soldiers*.15))then utility:=utility+least(missing,ceil(sp.heal*power_bonus))*case when f.status='routed'and sp.revive then 1.5 else 1.1 end;end if;
 if f.soldiers>0 then
 utility:=utility+case when sp.morale>0 then least(sp.morale,greatest(0,70-f.morale))*.3 else 0 end;
 select exists(select 1 from public.battle_formations e where e.battle_id=b.id and e.side<>own_side and e.soldiers>0 and e.status<>'routed' and power(e.x-f.x,2)+power(e.y-f.y,2)<260*260) into threat;
 if threat then utility:=utility+f.soldiers*(least(sp.attack,1.5-f.magic_attack)*.3+least(sp.defence,.4-f.magic_defence)*.4);end if;
 if f.status='moving'then utility:=utility+f.soldiers*least(sp.speed,1.75-f.magic_speed)*.12;end if;
 end if;
 elsif exists(select 1 from public.battle_formations a where a.battle_id=b.id and a.side=own_side and a.soldiers>0 and a.status<>'routed' and power(a.x-f.x,2)+power(a.y-f.y,2)<300*300)then
 utility:=utility+least(f.soldiers,ceil(greatest(0,sp.damage-case when sp.chain>0 then idx*6 else 0 end)*power_bonus*(1-f.magic_defence)))+case when sp.morale<0 then least(-sp.morale,f.morale)*.15 else 0 end;
 end if;idx:=idx+1;
 end loop;
 score:=utility/sqrt(sp.mana);
 if utility>=3 and score>best then best:=score;choice:=sp.id;target_id:=t.id;end if;
 if all_targets then exit;end if;
 end loop;
 end loop;
 if choice is not null then perform public.peris_cast_spell_for(owner,b.id,choice,target_id);end if;
 end loop;
end $$;
create or replace function public.peris_siege_reduction(p_engines integer,p_level integer,p_weapon text)returns integer
language plpgsql immutable set search_path='' as $$
declare remaining integer:=greatest(0,p_engines);after_level integer:=greatest(0,p_level);needed integer;
begin
 for i in 1..2 loop
  exit when after_level=0;
  needed:=case when p_weapon='ram'then 6+after_level*4 else 4+after_level*3 end;
  exit when remaining<needed;remaining:=remaining-needed;after_level:=after_level-1;
 end loop;
 return p_level-after_level;
end $$;

create or replace function public.peris_city_defender_roster(p_battle bigint)returns jsonb
language sql stable security definer set search_path='' as $$
 select jsonb_object_agg(unit,total)from(
  select c.unit,coalesce((select sum((party->'troops'->>c.unit)::integer)from public.battles b cross join lateral jsonb_array_elements(b.city_defenders)party where b.id=p_battle),0)as total
  from public.peris_unit_catalog c
 )q
$$;

create or replace function public.peris_prepare_city_raid(p_owner uuid,p_army bigint,p_city bigint,p_path jsonb,p_troops jsonb,p_target text default 'auto')returns jsonb
language plpgsql security definer set search_path='' as $$
declare a public.armies%rowtype;c public.settlements%rowtype;available jsonb;chosen jsonb;unit_name text;
begin
 if p_owner is null then raise exception 'Authentication required';end if;
 if p_target not in('auto','market','barracks','stables','workshop','smithy','warehouse','granary','housing','mage_tower','fishery','lumber','quarry','farm','storehouse','trading_post')then raise exception 'Choose a valid catapult target';end if;
 perform public.peris_settle(p_owner);
 select * into a from public.armies where id=p_army and owner_id=p_owner for update;
 select * into c from public.settlements where id=p_city and owner_id<>p_owner;
 if a.id is null or c.id is null or to_jsonb(c)->>'ruined_at' is not null then raise exception 'Choose your legion and another player''s living city';end if;
 if public.peris_social_relation(p_owner,c.owner_id)in('guild','alliance','nap')then raise exception 'Your guild or diplomatic pact protects this city';end if;
 available:=public.peris_roster(to_jsonb(a));chosen:=public.peris_garrison_troops(coalesce(nullif(p_troops,'null'::jsonb),available));
 if public.peris_roster_total(chosen)=0 then raise exception 'Send at least one soldier';end if;
 foreach unit_name in array array['infantry','spearmen','archers','elite','cavalry','scout','heavyCavalry','ram','catapult']loop
  if(chosen->>unit_name)::integer>(available->>unit_name)::integer then raise exception 'Choose troops currently available in this legion';end if;
 end loop;
 perform public.peris_march_for_target(p_owner,a.id,c.x,c.y,p_path,null,c.id);
 perform public.peris_garrison_add(p_owner,floor(a.target_x/128.0)::integer,floor(a.target_y/128.0)::integer,public.peris_roster_add(available,chosen,-1));
 perform public.peris_write_roster(a.id,chosen);
 update public.armies set siege_target=p_target,arrival_at=departure_at+make_interval(secs=>greatest(2,march_distance/public.peris_march_speed(id))::double precision)where id=a.id;
 return jsonb_build_object('ok',true);
end $$;

create or replace function public.peris_start_city_raid(p_owner uuid,p_army bigint)returns bigint
language plpgsql security definer set search_path='' as $$
declare a public.armies%rowtype;c public.settlements%rowtype;defenders jsonb;roster jsonb;leader bigint;bid bigint;wall integer;bonus jsonb;
begin
 select * into a from public.armies where id=p_army and owner_id=p_owner;
 select * into c from public.settlements where id=a.raid_city_id and owner_id<>p_owner;
 if a.id is null or c.id is null or to_jsonb(c)->>'ruined_at' is not null or a.status<>'idle'or a.target_x<>c.x or a.target_y<>c.y then return null;end if;
 -- A pact accepted during travel protects the city when the raid arrives.
 if public.peris_social_relation(p_owner,c.owner_id)in('guild','alliance','nap')then perform public.peris_return_raid(a.id);return null;end if;
 -- Avoid waiting on another ruler while the caller already holds its own lock.
 if exists(select 1 from public.peris_settler_expeditions where owner_id in(p_owner,c.owner_id)and status='travelling'and arrival_at<=public.peris_game_now())and not pg_try_advisory_xact_lock(204200)then return null;end if;
 begin perform 1 from public.players where id in(p_owner,c.owner_id)order by id for update nowait;
 exception when lock_not_available then return null;end;
 if exists(select 1 from public.battles where status='active'and(attacker_owner_id in(p_owner,c.owner_id)or defender_owner_id in(p_owner,c.owner_id)))then return null;end if;
 perform public.peris_settle(c.owner_id);
 perform 1 from public.armies where id=a.id for update;
 select * into c from public.settlements where id=c.id for update;
 select coalesce(jsonb_agg(jsonb_build_object('army_id',d.id,'troops',public.peris_roster(to_jsonb(d)))order by d.id),'[]')into defenders
 from public.armies d where d.owner_id=c.owner_id and d.status='idle'and d.raid_target_id is null and d.raid_city_id is null
 and floor(d.target_x/128.0)=floor(c.x/128.0)and floor(d.target_y/128.0)=floor(c.y/128.0);
 select d.id into leader from public.armies d left join public.peris_heroes h on h.army_id=d.id
 where d.owner_id=c.owner_id and d.status='idle'and d.raid_target_id is null and d.raid_city_id is null
 and floor(d.target_x/128.0)=floor(c.x/128.0)and floor(d.target_y/128.0)=floor(c.y/128.0)order by coalesce(h.experience,0)desc,d.id limit 1;
 select public.peris_roster(to_jsonb(g))into roster from public.peris_garrisons g where owner_id=c.owner_id and col=floor(c.x/128.0)::integer and row=floor(c.y/128.0)::integer for update;
 if roster is not null then defenders:=defenders||jsonb_build_array(jsonb_build_object('col',floor(c.x/128.0),'row',floor(c.y/128.0),'troops',roster));end if;
 -- Guild troops remain owned by their sender, and are accounted for individually.
 if to_regclass('public.peris_guild_reinforcements')is not null then
 select defenders||coalesce(jsonb_agg(jsonb_build_object('guild_reinforcement_id',r.id,'troops',r.troops)order by r.id),'[]'::jsonb) into defenders
 from public.peris_guild_reinforcements r
 join public.peris_guild_members sender on sender.player_id=r.owner_id
 join public.peris_guild_members receiver on receiver.player_id=r.recipient_id and receiver.guild_id=sender.guild_id
 where r.target_settlement_id=c.id and r.recipient_id=c.owner_id and r.status='stationed';
 end if;
 select public.peris_roster(g.unit_roster)into roster from public.peris_city_garrisons g where g.settlement_id=c.id and g.owner_id=c.owner_id for update;
 if roster is not null and public.peris_roster_total(roster)>0 then defenders:=defenders||jsonb_build_array(jsonb_build_object('city_garrison_id',c.id,'troops',roster));end if;
 insert into public.battles(attacker_owner_id,defender_owner_id,attacker_army_id,defender_army_id,mode,phase,terrain,difficulty,enemy_name,attacker_ready,defender_ready,defender_faction,raid_city_id,siege_target,city_defenders)
 values(p_owner,c.owner_id,a.id,leader,'pvp','combat',public.peris_battle_terrain(c.x,c.y),'normal',c.name,true,true,c.faction,c.id,a.siege_target,defenders)returning id into bid;
 perform public.peris_add_formations(bid,p_owner,'attacker',a.infantry,a.archers,a.cavalry,90);
 perform public.peris_add_formations(bid,c.owner_id,'defender',0,0,0,90);
 select coalesce(level,0)into wall from public.buildings where settlement_id=c.id and building_type='wall';wall:=coalesce(wall,0);
 bonus:=public.peris_hero_bonuses(leader);
 update public.battle_formations set defence_multiplier=defence_multiplier*(1+public.peris_wall_defence_bonus(wall)),
 attack_multiplier=(1+least(.6,coalesce((select sum(level)*.04 from public.peris_city_slots where settlement_id=c.id and building_type='smithy'),0)))*(bonus->>'damage')::numeric where battle_id=bid and side='defender';
 update public.armies set raid_city_id=null where id=a.id;
 return bid;
end $$;

create or replace function public.peris_damage_city(p_city bigint,p_engines jsonb,p_target text)returns jsonb
language plpgsql security definer set search_path='' as $$
declare wall public.buildings%rowtype;chosen record;loss integer;damage jsonb:='[]';
begin
 if exists(select 1 from public.settlements where id=p_city and ruined_at is not null)then return '[]'::jsonb;end if;
 select * into wall from public.buildings where settlement_id=p_city and building_type='wall'for update;
 if wall.id is not null then
  loss:=public.peris_siege_reduction(coalesce((p_engines->>'ram')::integer,0),wall.level,'ram');
  if loss>0 then damage:=damage||jsonb_build_array(jsonb_build_object('building_type','wall','name','Walls','before',wall.level,'after',wall.level-loss,'weapon','ram'));update public.buildings set level=level-loss,updated_at=now()where id=wall.id;end if;
 end if;
 select * into chosen from(
  select building_type,level,slot_index,null::bigint as building_id,null::integer as field_col,null::integer as field_row from public.peris_city_slots where settlement_id=p_city
  union all select building_type,level,null::integer,id,null::integer,null::integer from public.buildings where settlement_id=p_city and building_type<>'wall'
  union all select case when building_type='market'then 'trading_post'else building_type end,level,null::integer,null::bigint,col,row from public.peris_map_plots where settlement_id=p_city and building_type is not null
 )q where level>0 and(p_target='auto'or building_type=p_target)order by level desc,building_type collate "C",coalesce(slot_index,999),coalesce(field_col,999),coalesce(field_row,999)limit 1;
 if chosen.level is not null then
  loss:=public.peris_siege_reduction(coalesce((p_engines->>'catapult')::integer,0),chosen.level,'catapult');
  if loss>0 then
   damage:=damage||jsonb_build_array(jsonb_strip_nulls(jsonb_build_object('building_type',chosen.building_type,'name',case chosen.building_type when 'mage_tower'then 'Mage tower'when 'lumber'then 'Lumber mill'when 'trading_post'then 'Trading post'else initcap(chosen.building_type)end,'slot_index',chosen.slot_index,'col',chosen.field_col,'row',chosen.field_row,'before',chosen.level,'after',chosen.level-loss,'weapon','catapult')));
   if chosen.slot_index is not null then update public.peris_city_slots set level=level-loss where settlement_id=p_city and slot_index=chosen.slot_index;
   elsif chosen.field_col is not null then update public.peris_map_plots set level=level-loss where settlement_id=p_city and col=chosen.field_col and row=chosen.field_row;
   else update public.buildings set level=level-loss,updated_at=now()where id=chosen.building_id;end if;
  end if;
 end if;
 if jsonb_array_length(damage)>0 then perform public.peris_city_economy(p_city);end if;
 if coalesce((p_engines->>'catapult')::integer,0)>0 or coalesce((p_engines->>'ram')::integer,0)>0 then perform public.peris_ruin_city(p_city);end if;
 return damage;
end $$;

create or replace function public.peris_finish_city_raid(p_bid bigint,p_winner text,p_reason text)returns void
language plpgsql security definer set search_path='' as $$
declare b public.battles%rowtype;c public.settlements%rowtype;a public.armies%rowtype;party jsonb;initial jsonb;survivors jsonb;def_initial jsonb;def_remaining jsonb;current_roster jsonb;losses jsonb;cumulative jsonb:=public.peris_roster('{}');engines jsonb;loot jsonb:=jsonb_build_object('wood',0,'stone',0,'food',0,'gold',0);r jsonb;damage jsonb;reward jsonb;receipt jsonb;unit_name text;key text;lost integer;start_count integer;party_count integer;total integer;ai integer;di integer;asur integer;dsur integer;carry numeric;owner uuid;winner uuid;commander bigint;side text;g public.peris_garrisons%rowtype;
begin
 select * into b from public.battles where id=p_bid for update;if b.id is null or b.status<>'active'or b.raid_city_id is null then return;end if;
 if p_winner not in('attacker','defender','draw')then raise exception 'Invalid battle outcome';end if;
 if not public.peris_lock_battle_participants(b.attacker_owner_id,b.defender_owner_id)then raise lock_not_available;end if;
 perform public.peris_settle(b.attacker_owner_id);perform public.peris_settle(b.defender_owner_id);
 select * into c from public.settlements where id=b.raid_city_id for update;
 select * into a from public.armies where id=b.attacker_army_id for update;
 select coalesce(sum(f.initial_soldiers)filter(where f.side='attacker'),0),coalesce(sum(f.initial_soldiers)filter(where f.side='defender'),0),coalesce(sum(f.soldiers)filter(where f.side='attacker'),0),coalesce(sum(f.soldiers)filter(where f.side='defender'),0)into ai,di,asur,dsur from public.battle_formations f where f.battle_id=b.id;
 select public.peris_roster(coalesce(jsonb_object_agg(unit,n),'{}'))into initial from(select coalesce(f.recruit_unit,f.unit_type)unit,sum(f.initial_soldiers)n from public.battle_formations f where f.battle_id=b.id and f.side='attacker'group by coalesce(f.recruit_unit,f.unit_type))q;
 select public.peris_roster(coalesce(jsonb_object_agg(unit,n),'{}'))into survivors from(select coalesce(f.recruit_unit,f.unit_type)unit,sum(f.soldiers)n from public.battle_formations f where f.battle_id=b.id and f.side='attacker'group by coalesce(f.recruit_unit,f.unit_type))q;
 def_initial:=public.peris_city_defender_roster(b.id);
 select public.peris_roster(coalesce(jsonb_object_agg(unit,n),'{}'))into def_remaining from(select coalesce(f.recruit_unit,f.unit_type)unit,sum(f.soldiers)n from public.battle_formations f where f.battle_id=b.id and f.side='defender'group by coalesce(f.recruit_unit,f.unit_type))q;
 for party in select value from jsonb_array_elements(b.city_defenders)loop
  losses:=public.peris_roster('{}');
  foreach unit_name in array array['infantry','spearmen','archers','elite','cavalry','scout','heavyCavalry','ram','catapult']loop
   total:=(def_initial->>unit_name)::integer;lost:=total-(def_remaining->>unit_name)::integer;start_count:=(cumulative->>unit_name)::integer;party_count:=(party->'troops'->>unit_name)::integer;
   losses:=jsonb_set(losses,array[unit_name],to_jsonb(case when total=0 then 0 else floor(lost::numeric*(start_count+party_count)/total)::integer-floor(lost::numeric*start_count/total)::integer end));
   cumulative:=jsonb_set(cumulative,array[unit_name],to_jsonb(start_count+party_count));
  end loop;
  if party ? 'army_id'then
   select public.peris_roster(to_jsonb(d))into current_roster from public.armies d where id=(party->>'army_id')::bigint and owner_id=b.defender_owner_id for update;
   perform public.peris_write_roster((party->>'army_id')::bigint,public.peris_roster_add(current_roster,losses,-1));
  elsif party ? 'guild_reinforcement_id' then
   select public.peris_roster(troops)into current_roster from public.peris_guild_reinforcements
    where id=(party->>'guild_reinforcement_id')::bigint and status='stationed' for update;
   if current_roster is not null then
    current_roster:=public.peris_roster_add(current_roster,losses,-1);
    if public.peris_roster_total(current_roster)=0 then
     delete from public.peris_guild_reinforcements where id=(party->>'guild_reinforcement_id')::bigint;
    else update public.peris_guild_reinforcements set troops=current_roster where id=(party->>'guild_reinforcement_id')::bigint;end if;
   end if;
  elsif party ? 'city_garrison_id'then
   select public.peris_roster(garrison.unit_roster)into current_roster from public.peris_city_garrisons garrison where garrison.settlement_id=(party->>'city_garrison_id')::bigint and garrison.owner_id=b.defender_owner_id for update;
   if current_roster is not null then
    current_roster:=public.peris_roster_add(current_roster,losses,-1);
    if public.peris_roster_total(current_roster)=0 then delete from public.peris_city_garrisons where settlement_id=(party->>'city_garrison_id')::bigint and owner_id=b.defender_owner_id;
    else update public.peris_city_garrisons set unit_roster=current_roster where settlement_id=(party->>'city_garrison_id')::bigint and owner_id=b.defender_owner_id;end if;
   end if;
  else
   select * into g from public.peris_garrisons where owner_id=b.defender_owner_id and col=(party->>'col')::integer and row=(party->>'row')::integer for update;
   if g.owner_id is not null then
    current_roster:=public.peris_roster_add(public.peris_roster(to_jsonb(g)),losses,-1);
    update public.peris_garrisons set unit_roster=current_roster,infantry=public.peris_roster_class(current_roster,'infantry'),archers=public.peris_roster_class(current_roster,'archers'),cavalry=public.peris_roster_class(current_roster,'cavalry')where owner_id=g.owner_id and col=g.col and row=g.row;
    delete from public.peris_garrisons where owner_id=g.owner_id and col=g.col and row=g.row and infantry+archers+cavalry=0;
   end if;
  end if;
 end loop;
 perform public.peris_write_roster(a.id,public.peris_roster_add(survivors,coalesce(a.raid_reserve,'{}')));
 select coalesce(sum(f.soldiers*u.carry),0)into carry from public.battle_formations f join public.peris_unit_catalog u on u.unit=coalesce(f.recruit_unit,f.unit_type)where f.battle_id=b.id and f.side='attacker';
 carry:=floor(carry*public.peris_research_factor(b.attacker_owner_id,'carry'));
 if p_winner='attacker'then
  loot:=public.peris_take_camp_loot(jsonb_build_object('wood',floor(c.wood),'stone',floor(c.stone),'food',floor(c.food),'gold',floor(c.gold)),carry);
  update public.settlements set wood=wood-(loot->>'wood')::numeric,stone=stone-(loot->>'stone')::numeric,food=food-(loot->>'food')::numeric,gold=gold-(loot->>'gold')::numeric where id=c.id;
  select public.peris_roster(coalesce(jsonb_object_agg(unit,n),'{}'))into engines from(select coalesce(f.recruit_unit,f.unit_type)unit,sum(f.soldiers)n from public.battle_formations f where f.battle_id=b.id and f.side='attacker'and f.status<>'routed'group by coalesce(f.recruit_unit,f.unit_type))q;
  engines:=jsonb_set(jsonb_set(engines,'{ram}',to_jsonb(floor((engines->>'ram')::integer*public.peris_research_factor(b.attacker_owner_id,'siege'))::integer)),'{catapult}',to_jsonb(floor((engines->>'catapult')::integer*public.peris_research_factor(b.attacker_owner_id,'siege'))::integer));
  damage:=public.peris_damage_city(c.id,engines,b.siege_target);
 else damage:='[]';end if;
 winner:=case p_winner when 'attacker'then b.attacker_owner_id when 'defender'then b.defender_owner_id end;
 r:=jsonb_build_object('balance_version',b.balance_version,'attacker_initial',ai,'defender_initial',di,'attacker_survivors',asur,'defender_survivors',dsur,'attacker_losses',ai-asur,'defender_losses',di-dsur,'attacker_roster',initial,'attacker_survivor_roster',survivors,'defender_roster',def_initial,'defender_survivor_roster',def_remaining,'attacker_faction',coalesce(b.attacker_faction,(select faction from public.settlements where id=a.home_settlement_id)),'defender_faction',coalesce(b.defender_faction,c.faction),'loot',loot,'duration',round(b.elapsed),'reason',p_reason,'carrying_capacity',carry,'replacement_cost',public.peris_roster_loss_cost(initial,survivors,b.balance_version),'raid_city',jsonb_build_object('id',c.id,'name',c.name),'siege_damage',damage,
   'city_ruined',exists(select 1 from public.settlements where id=c.id and ruined_at is not null));
 if carry=0 or(loot->>'wood')::numeric+(loot->>'stone')::numeric+(loot->>'food')::numeric+(loot->>'gold')::numeric=0 then r:=r||jsonb_build_object('estimated_profit',public.peris_resource_difference(loot,r->'replacement_cost'));end if;
 update public.armies set status='idle',raid_city_id=null,raid_target_id=null,raid_reserve=null,march_sent_at=null,march_cancel_until=null,carried_loot=loot,loot_report_id=b.id,updated_at=now()where id=a.id;
 for side in select unnest(array['attacker','defender'])loop
  owner:=case side when 'attacker'then b.attacker_owner_id else b.defender_owner_id end;
  commander:=case side when 'attacker'then a.id else b.defender_army_id end;
  reward:=case when commander is not null then public.peris_battle_hero_reward(commander,case side when 'attacker'then(di-dsur)*2 else(ai-asur)*2 end+case when owner=winner then 50 else 20 end,null,b.id)end;
  receipt:=r||jsonb_build_object('report_side',side,'hero_reward',reward);
  if side='attacker'then r:=r||jsonb_build_object('hero_reward',reward);end if;
  if owner=winner then update public.players set victories=victories+1,prestige=prestige+25 where id=owner;end if;
  insert into public.peris_reports(owner_id,battle_id,title,won,result)values(owner,b.id,case side when 'attacker'then c.name else 'Defence of '||c.name end,coalesce(owner=winner,false),receipt)on conflict(owner_id,battle_id)do nothing;
 end loop;
 update public.battles set status='resolved',phase='finished',winner_side=p_winner,winner_owner_id=winner,ended_at=public.peris_game_now(),result=r where id=b.id;
 if not public.peris_return_raid(a.id)then
  update public.armies set start_x=(public.peris_home_army_position(s.x,s.y)->>'x')::integer,start_y=(public.peris_home_army_position(s.x,s.y)->>'y')::integer,target_x=(public.peris_home_army_position(s.x,s.y)->>'x')::integer,target_y=(public.peris_home_army_position(s.x,s.y)->>'y')::integer,march_path=null,march_distance=null,march_returning=false from public.settlements s where armies.id=a.id and s.id=a.home_settlement_id;
  perform public.peris_deliver_loot(a.id);
 end if;
end $$;
-- Rewrite the existing ownership predicates, preserving every policy name,
-- role, command and other condition. This includes the original battle policies
-- on upgraded databases, not only policies declared in this release's modules.
do $$declare p record;predicate text;check_predicate text;statement text;begin
 for p in select pol.polname,ns.nspname,t.relname,
  pg_get_expr(pol.polqual,pol.polrelid)as qual,
  pg_get_expr(pol.polwithcheck,pol.polrelid)as check_qual
  from pg_policy pol join pg_class t on t.oid=pol.polrelid
  join pg_namespace ns on ns.oid=t.relnamespace where ns.nspname='public'
  and (left(t.relname,6)='peris_' or t.relname in('players','spawn_points','settlements','buildings','armies','battles','battle_formations'))
 loop
  predicate:=replace(p.qual,'auth.uid()','public.peris_player_id()');
  check_predicate:=replace(p.check_qual,'auth.uid()','public.peris_player_id()');
  if predicate is distinct from p.qual or check_predicate is distinct from p.check_qual then
   statement:=format('alter policy %I on %I.%I',p.polname,p.nspname,p.relname);
   if predicate is not null then statement:=statement||' using ('||predicate||')';end if;
   if check_predicate is not null then statement:=statement||' with check ('||check_predicate||')';end if;
   execute statement;
  end if;
 end loop;
end $$;

-- Scheduling timestamps are operational real time, never accelerated game time.
create table if not exists public.peris_battle_work(
 battle_id bigint primary key,
 last_attempt_at timestamptz not null,next_attempt_at timestamptz not null,
 consecutive_failures integer not null default 0,last_sqlstate text
);
-- A failed/rolled-back item must not wait on an FK lock while recording its retry.
alter table public.peris_battle_work drop constraint if exists peris_battle_work_battle_id_fkey;
alter table public.peris_battle_work enable row level security;
revoke all on public.peris_battle_work from public,anon,authenticated;
create index if not exists peris_active_battles_due on public.battles(last_tick_at,id)where status='active';
create or replace function public.peris_advance_battles(p_limit integer default 20,p_budget_ms integer default 2000)returns jsonb
language plpgsql security definer set search_path='' as $$
declare started timestamptz:=clock_timestamp();bid bigint;owner uuid;visited bigint[]:='{}';
 attempted integer:=0;processed integer:=0;failed integer:=0;busy integer:=0;outcome jsonb;
begin
 if p_limit is null or p_limit not between 1 and 100 or p_budget_ms is null or p_budget_ms not between 1 and 5000 then raise exception 'Invalid battle worker budget';end if;
 delete from public.peris_battle_work w where not exists(select 1 from public.battles b where b.id=w.battle_id);
 while attempted<p_limit and extract(epoch from(clock_timestamp()-started))*1000<p_budget_ms loop
  bid:=null;
  begin
   select b.id,b.attacker_owner_id into bid,owner from public.battles b left join public.peris_battle_work w on w.battle_id=b.id
    where b.status='active'and b.last_tick_at<=public.peris_game_now()-interval '150 milliseconds'
     and not(b.id=any(visited))and(w.next_attempt_at is null or w.next_attempt_at<=clock_timestamp())
    order by w.last_attempt_at nulls first,b.last_tick_at,b.id limit 1 for update of b skip locked;
   if bid is null then exit;end if;
   visited:=array_append(visited,bid);attempted:=attempted+1;
   outcome:=public.peris_tick_for(bid,owner);
   if coalesce((outcome->>'busy')::boolean,false)then raise lock_not_available;end if;
   insert into public.peris_battle_work values(bid,clock_timestamp(),clock_timestamp(),0,null)
    on conflict(battle_id)do update set last_attempt_at=excluded.last_attempt_at,next_attempt_at=excluded.next_attempt_at,consecutive_failures=0,last_sqlstate=null;
   processed:=processed+1;
  exception when lock_not_available then
   busy:=busy+1;
   insert into public.peris_battle_work values(bid,clock_timestamp(),clock_timestamp()+interval '1 second',0,'55P03')
    on conflict(battle_id)do update set last_attempt_at=excluded.last_attempt_at,next_attempt_at=excluded.next_attempt_at;
  when others then
   failed:=failed+1;
   insert into public.peris_battle_work values(bid,clock_timestamp(),clock_timestamp()+interval '5 seconds',1,sqlstate)
    on conflict(battle_id)do update set last_attempt_at=excluded.last_attempt_at,
     next_attempt_at=clock_timestamp()+make_interval(secs=>least(300,5*power(2,least(6,public.peris_battle_work.consecutive_failures)))::double precision),
     consecutive_failures=public.peris_battle_work.consecutive_failures+1,last_sqlstate=excluded.last_sqlstate;
  end;
 end loop;
 return jsonb_build_object('attempted',attempted,'processed',processed,'failed',failed,'busy',busy,'duration_ms',extract(epoch from(clock_timestamp()-started))*1000);
end $$;
-- Operational retry metadata must not acquire a player FK lock after NOWAIT fails.
create table if not exists public.peris_worker_owners(owner_id uuid primary key,last_processed_at timestamptz not null default now());
alter table public.peris_worker_owners drop constraint if exists peris_worker_owners_owner_id_fkey;
alter table public.peris_worker_owners add column if not exists last_attempt_at timestamptz;
alter table public.peris_worker_owners add column if not exists next_attempt_at timestamptz;
alter table public.peris_worker_owners add column if not exists consecutive_failures integer not null default 0;
alter table public.peris_worker_owners add column if not exists last_sqlstate text;
alter table public.peris_worker_owners enable row level security;
revoke all on public.peris_worker_owners from public,anon,authenticated;
-- The same persistent world advances without a browser. All helpers are private.
create or replace function public.peris_game_tick(p_limit integer default 40)returns jsonb
language plpgsql security definer set search_path='' as $$
declare owner uuid;farm public.peris_campaign_farms%rowtype;processed integer:=0;camp_id integer;
 attempted integer:=0;failed integer:=0;camp_failed integer:=0;
 started timestamptz:=clock_timestamp();pass_started timestamptz;battles jsonb;
begin
 if p_limit is null or p_limit not between 1 and 100 then raise exception 'Use a worker budget of 1Ã¢â‚¬“100 owners';end if;
 if not pg_try_advisory_xact_lock(204215)then return jsonb_build_object('busy',true);end if;
 delete from public.peris_worker_owners w where not exists(select 1 from public.players p where p.id=w.owner_id);
 battles:=public.peris_advance_battles(20,2000);pass_started:=clock_timestamp();
 for owner in select q.owner_id from(
  select owner_id,min(arrival_at)as due from public.armies where (status='moving' or raid_target_id is not null or raid_city_id is not null)and arrival_at<=public.peris_game_now() group by owner_id
  union all select owner_id,min(arrival_at)from public.peris_settler_expeditions where status='travelling'and arrival_at<=public.peris_game_now()group by owner_id
  union all select owner_id,min(arrival_at)from public.peris_ruin_evacuations where arrival_at<=public.peris_game_now()group by owner_id
  union all select owner_id,min(arrival_at)from public.peris_city_reinforcements where arrival_at<=public.peris_game_now()group by owner_id
  union all select owner_id,due from public.peris_due_guild_reinforcements()
  union all select owner_id,min(finish_at)from public.peris_orders where finish_at<=public.peris_game_now()group by owner_id
  union all select owner_id,min(public.peris_science_deadline(owner_id))from public.peris_account_science where active_id is not null and public.peris_science_deadline(owner_id)<=public.peris_game_now()group by owner_id
  union all select owner_id,min(next_at)from public.peris_campaign_farms where enabled and next_at<=public.peris_game_now()group by owner_id
 )q left join public.peris_worker_owners w on w.owner_id=q.owner_id
 where w.next_attempt_at is null or w.next_attempt_at<=clock_timestamp()
 group by q.owner_id,w.last_processed_at,w.last_attempt_at order by coalesce(w.last_attempt_at,w.last_processed_at,'1970-01-01'::timestamptz),min(q.due),q.owner_id limit p_limit loop
  exit when extract(epoch from(clock_timestamp()-pass_started))*1000>=2000;
  attempted:=attempted+1;
  begin
   if exists(select 1 from public.peris_settler_expeditions where owner_id=owner and status='travelling'and arrival_at<=public.peris_game_now())and not pg_try_advisory_xact_lock(204200)then raise lock_not_available;end if;
   perform 1 from public.players where id=owner for update nowait;
   perform public.peris_sync_owner(owner);
   for farm in select * from public.peris_campaign_farms where owner_id=owner and enabled and next_at<=public.peris_game_now()order by next_at,id limit 100 for update skip locked loop
    exit when extract(epoch from(clock_timestamp()-pass_started))*1000>=2000;
    begin
     if farm.route is null then raise exception 'Start this target manually once to establish its land route';end if;
     perform public.peris_prepare_raid_for(owner,farm.army_id,farm.camp_id,farm.route,farm.troops);
     update public.armies set farm_list_id=farm.list_id where id=farm.army_id;
     update public.peris_campaign_farms set last_status='Raid preparing',sent=sent+1 where id=farm.id;
    exception when others then update public.peris_campaign_farms set last_status=sqlerrm,skipped=skipped+1 where id=farm.id;end;
    update public.peris_campaign_farms set next_at=public.peris_game_now()+make_interval(secs=>farm.interval_seconds)where id=farm.id;
   end loop;
   insert into public.peris_worker_owners(owner_id,last_processed_at,last_attempt_at,next_attempt_at,consecutive_failures,last_sqlstate)
    values(owner,clock_timestamp(),clock_timestamp(),null,0,null)on conflict(owner_id)do update set
    last_processed_at=excluded.last_processed_at,last_attempt_at=excluded.last_attempt_at,next_attempt_at=null,consecutive_failures=0,last_sqlstate=null;
   processed:=processed+1;
  exception when lock_not_available then
   insert into public.peris_worker_owners(owner_id,last_attempt_at,next_attempt_at)values(owner,clock_timestamp(),clock_timestamp()+interval '1 second')
    on conflict(owner_id)do update set last_attempt_at=excluded.last_attempt_at,next_attempt_at=excluded.next_attempt_at;
  when others then
   failed:=failed+1;
   insert into public.peris_worker_owners(owner_id,last_attempt_at,next_attempt_at,consecutive_failures,last_sqlstate)
    values(owner,clock_timestamp(),clock_timestamp()+interval '5 seconds',1,sqlstate)on conflict(owner_id)do update set
    last_attempt_at=excluded.last_attempt_at,next_attempt_at=clock_timestamp()+make_interval(secs=>least(300,5*power(2,least(6,public.peris_worker_owners.consecutive_failures)))::double precision),
    consecutive_failures=public.peris_worker_owners.consecutive_failures+1,last_sqlstate=excluded.last_sqlstate;
  end;
 end loop;
 pass_started:=clock_timestamp();
 for camp_id in select s.camp_id from public.peris_camp_stock s where s.next_recruit_at<=public.peris_game_now() or s.stock_updated_at<=public.peris_game_now()-interval '1 minute'order by least(s.next_recruit_at,s.stock_updated_at+interval '1 minute'),s.camp_id limit 100 loop
  exit when extract(epoch from(clock_timestamp()-pass_started))*1000>=500;
  begin perform public.peris_camp_accrue(camp_id);exception when others then camp_failed:=camp_failed+1;end;
 end loop;
 return jsonb_build_object('processed',processed,'attempted',attempted,'failed',failed,'battles',battles,'camps_failed',camp_failed,'duration_ms',extract(epoch from(clock_timestamp()-started))*1000);
end $$;
-- Gameplay mutations keep a private receipt so a lost response can be retried.
create table if not exists public.peris_command_receipts(
 owner_id uuid not null references public.players(id) on delete cascade,
 request_id uuid not null, function_name text not null, arguments jsonb not null,
 response jsonb, created_at timestamptz not null default now(),
 primary key(owner_id,request_id)
);
alter table public.peris_command_receipts enable row level security;
revoke all on public.peris_command_receipts from public,anon,authenticated;

create or replace function public.peris_submit_command(p_request_id uuid,p_function text,p_args jsonb)
returns jsonb language plpgsql security definer set search_path='' as $$
declare u uuid:=public.peris_player_id();previous public.peris_command_receipts%rowtype;answer jsonb;
begin
 if u is null or not exists(select 1 from public.players where id=u)then raise exception 'Authentication required';end if;
 if p_request_id is null or p_function is null or p_args is null or jsonb_typeof(p_args)<>'object' or octet_length(p_args::text)>100000 then raise exception 'Choose a valid command';end if;
 perform pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended(u::text||':'||p_request_id::text,0));
 select * into previous from public.peris_command_receipts where owner_id=u and request_id=p_request_id;
 if previous.request_id is not null then
  if previous.function_name is distinct from p_function or previous.arguments is distinct from p_args then raise exception 'This request belongs to a different command';end if;
  return previous.response;
 end if;
 if exists(select 1 from public.players where id=u and defeated_at is not null)then raise exception 'This ruler has been permanently defeated';end if;
 -- A fixed whitelist keeps the receipt endpoint from invoking private helpers.
 case p_function
 when 'peris_send_guild_reinforcements' then answer:=public.peris_send_guild_reinforcements((p_args->>'p_source')::bigint,(p_args->>'p_target')::bigint,p_args->'p_troops',p_args->'p_path',(p_args->>'p_army')::bigint);
 when 'peris_recall_guild_reinforcements' then answer:=public.peris_recall_guild_reinforcements((p_args->>'p_id')::bigint);
 when 'peris_empire_command' then answer:=public.peris_empire_command(p_args->'p_command');
 when 'peris_campaign_farm_command' then answer:=public.peris_campaign_farm_command(p_args->'p_command');
 when 'peris_research_unit' then answer:=public.peris_research_unit((p_args->>'p_city')::bigint,p_args->>'p_unit');
 when 'peris_collect_garrison' then answer:=public.peris_collect_garrison((p_args->>'p_army')::bigint,nullif(p_args->'p_troops','null'::jsonb));
 when 'peris_claim_field' then answer:=public.peris_claim_field((p_args->>'p_col')::integer,(p_args->>'p_row')::integer);
 when 'peris_queue_field' then answer:=public.peris_queue_field((p_args->>'p_col')::integer,(p_args->>'p_row')::integer,p_args->>'p_type');
 when 'peris_set_faction' then perform public.peris_set_faction(p_args->>'p_faction');answer:='{}'::jsonb;
 when 'peris_debug_city' then perform public.peris_debug_city(p_args->>'p_action',p_args->>'p_target',(p_args->>'p_value')::integer);answer:='{}'::jsonb;
 when 'peris_research_spell' then answer:=public.peris_research_spell(p_args->>'p_spell');
 when 'peris_queue_slot' then answer:=public.peris_queue_slot((p_args->>'p_slot')::integer,p_args->>'p_type');
 when 'peris_queue_upgrade' then answer:=public.peris_queue_upgrade(p_args->>'p_type');
 when 'peris_queue_recruit' then answer:=public.peris_queue_recruit(p_args->>'p_type',(p_args->>'p_quantity')::integer);
 when 'peris_march' then answer:=public.peris_march((p_args->>'p_target_x')::integer,(p_args->>'p_target_y')::integer,p_args->'p_path');
 when 'move_army' then answer:=public.move_army((p_args->>'p_target_x')::integer,(p_args->>'p_target_y')::integer);
 when 'peris_raid' then answer:=public.peris_raid((p_args->>'p_camp_id')::integer);
 when 'peris_ready' then answer:=public.peris_ready((p_args->>'p_battle_id')::bigint);
 when 'retreat_from_battle' then answer:=public.retreat_from_battle((p_args->>'p_battle_id')::bigint);
 when 'peris_claim' then answer:=public.peris_claim(p_args->>'p_quest_id');
 when 'peris_rename' then answer:=public.peris_rename(p_args->>'p_name');
 when 'peris_challenge' then answer:=public.peris_challenge((p_args->>'p_defender')::uuid);
 when 'peris_respond' then answer:=public.peris_respond((p_args->>'p_id')::bigint,(p_args->>'p_accept')::boolean);
 else raise exception 'This command is not available';
 end case;
 insert into public.peris_command_receipts(owner_id,request_id,function_name,arguments,response)values(u,p_request_id,p_function,p_args,coalesce(answer,'{}'::jsonb));
 return coalesce(answer,'{}'::jsonb);
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
grant execute on function public.peris_empire_command(jsonb)to authenticated;
grant execute on function public.peris_submit_command(uuid,text,jsonb)to authenticated;
grant execute on function public.peris_campaign_farm_command(jsonb)to authenticated;
grant execute on function public.peris_research_unit(bigint,text)to authenticated;
grant execute on function public.peris_read_reports(bigint[])to authenticated;
grant execute on function public.peris_read_all_reports(),public.peris_report_page(bigint)to authenticated;
grant execute on function public.peris_collect_garrison(bigint,jsonb)to authenticated;
-- The argument-free identity helper is required by RLS; it exposes only the
-- caller's current ruler UUID. Session bindings themselves remain inaccessible.
grant execute on function public.peris_player_id(),public.peris_login(text)to authenticated;
grant execute on function public.peris_enter_account(text,text,text,uuid)to authenticated;
grant execute on function public.peris_account_directory(text,text,text,text,integer,integer)to anon,authenticated;
grant execute on function public.peris_claim_field(integer,integer),public.peris_queue_field(integer,integer,text),public.peris_set_faction(text),public.peris_debug_city(text,text,integer),public.peris_snapshot(),public.peris_map_snapshot(integer,integer,integer,integer),public.peris_march(integer,integer,jsonb),public.peris_queue_upgrade(text),public.peris_queue_slot(integer,text),public.peris_research_spell(text),public.peris_cast_spell(bigint,text,bigint),public.peris_queue_recruit(text,integer),public.peris_raid(integer),public.peris_ready(bigint),
 public.peris_order(bigint,jsonb),public.peris_tick(bigint),public.peris_rally(bigint),public.peris_challenge(uuid),public.peris_respond(bigint,boolean),public.peris_claim(text),public.peris_rename(text)to authenticated;

do $$declare t text;begin
 foreach t in array array['peris_account_science','peris_research_progress','peris_map_plots','peris_orders','peris_reports','peris_challenges','peris_campaign_farm_lists','peris_campaign_farms','peris_garrisons']loop
 begin execute format('alter publication supabase_realtime add table public.%I',t);exception when duplicate_object then null;end;
 end loop;
end $$;
grant execute on function public.peris_game_tick(integer)to service_role;
grant execute on function public.peris_social_snapshot(),public.peris_social_directory(text,text,text,integer),public.peris_social_guild(uuid),public.peris_social_thread(text,uuid,bigint),public.peris_social_command(uuid,jsonb)to authenticated;
grant execute on function public.peris_guild_reinforcement_targets(),public.peris_guild_reinforcement_status()to authenticated;
notify pgrst,'reload schema';

commit;
