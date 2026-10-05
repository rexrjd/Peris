-- PERIS V5 - UPGRADE V4 WORLD TO ROME-STYLE TACTICAL BATTLES
-- Run this WHOLE file once in Supabase > SQL Editor.
-- It preserves players, settlements, buildings and strategic armies.
-- Re-running it resets only tactical battle instances.

begin;

drop table if exists public.battle_formations cascade;
drop table if exists public.battles cascade;
drop function if exists public.create_battle(uuid) cascade;
drop function if exists public.issue_battle_move(bigint, bigint, integer, integer) cascade;
drop function if exists public.issue_battle_attack(bigint, bigint, bigint) cascade;
drop function if exists public.advance_battle(bigint) cascade;
drop function if exists public.retreat_from_battle(bigint) cascade;

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

alter table public.battles enable row level security;
alter table public.battle_formations enable row level security;

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

grant select on public.battles, public.battle_formations to authenticated;

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

revoke all on function public.create_battle(uuid) from public, anon;
revoke all on function public.issue_battle_move(bigint, bigint, integer, integer) from public, anon;
revoke all on function public.issue_battle_attack(bigint, bigint, bigint) from public, anon;
revoke all on function public.advance_battle(bigint) from public, anon;
revoke all on function public.retreat_from_battle(bigint) from public, anon;

grant execute on function public.create_battle(uuid) to authenticated;
grant execute on function public.issue_battle_move(bigint, bigint, integer, integer) to authenticated;
grant execute on function public.issue_battle_attack(bigint, bigint, bigint) to authenticated;
grant execute on function public.advance_battle(bigint) to authenticated;
grant execute on function public.retreat_from_battle(bigint) to authenticated;

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
