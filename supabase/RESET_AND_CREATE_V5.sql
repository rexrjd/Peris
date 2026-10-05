-- PERIS V5 - TOTAL WAR STYLE BATTLE PROTOTYPE RESET
-- Run this WHOLE file in Supabase > SQL Editor.
-- It intentionally deletes all existing Peris PUBLIC game data.
-- It does NOT delete Supabase Auth users, so browsers that are already signed in
-- can simply choose a new ruler name after the reset.

begin;

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

commit;
