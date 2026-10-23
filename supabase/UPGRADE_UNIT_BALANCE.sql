-- Focused unit balance upgrade for an existing V19 world. No scheduler or reset.
begin;
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

-- Optional dependencies keep older focused installers valid without creating trade state.
create or replace function public.peris_optional_trade_caravans()returns jsonb
language plpgsql stable security definer set search_path='' as $$
begin
 if to_regprocedure('public.peris_trade_status()')is null then return '[]'::jsonb;end if;
 return public.peris_trade_status();
end $$;
create or replace function public.peris_due_trade_caravans()returns table(owner_id uuid,due timestamptz)
language plpgsql stable security definer set search_path='' as $$
begin
 if to_regclass('public.peris_trade_caravans')is null then return;end if;
 return query select c.owner_id,min(case c.status when 'outbound'then c.arrival_at when 'returning'then least(c.return_at,c.redirect_at) else public.peris_game_now()end)
 from public.peris_trade_caravans c where c.status in('waiting','stranded')or(c.status='outbound'and c.arrival_at<=public.peris_game_now())or(c.status='returning'and least(c.return_at,c.redirect_at)<=public.peris_game_now())group by c.owner_id;
end $$;
revoke all on function public.peris_optional_trade_caravans(),public.peris_due_trade_caravans()from public,anon,authenticated;

-- These hooks are deliberately installable without the optional route table.
create or replace function public.peris_optional_trade_routes()returns jsonb
language plpgsql stable security definer set search_path='' as $$
begin
 if to_regclass('public.peris_trade_routes')is null then return '[]'::jsonb;end if;
 return(select coalesce(jsonb_agg(r order by r.source_settlement_id,r.id),'[]'::jsonb)from public.peris_trade_routes r where r.owner_id=public.peris_player_id());
end $$;
create or replace function public.peris_due_trade_routes()returns table(owner_id uuid,due timestamptz)
language plpgsql stable security definer set search_path='' as $$
begin
 if to_regclass('public.peris_trade_routes')is null then return;end if;
 return query select r.owner_id,min(r.next_run_at)from public.peris_trade_routes r where r.enabled and r.next_run_at<=public.peris_game_now()group by r.owner_id;
end $$;
-- Include future routes: any route may become due while its component is settling.
create or replace function public.peris_trade_route_edges()returns table(owner_id uuid,recipient_id uuid)
language plpgsql stable security definer set search_path='' as $$
begin
 if to_regclass('public.peris_trade_routes')is null then return;end if;
 return query select r.owner_id,r.recipient_id from public.peris_trade_routes r where r.enabled;
end $$;
create or replace function public.peris_optional_advance_trade_routes(p_owner uuid,p_at timestamptz)returns void
language plpgsql security definer set search_path='' as $$
begin
 if to_regprocedure('public.peris_advance_trade_routes(uuid,timestamp with time zone)')is not null then perform public.peris_advance_trade_routes(p_owner,p_at);end if;
end $$;
revoke all on function public.peris_optional_trade_routes(),public.peris_due_trade_routes(),public.peris_trade_route_edges(),public.peris_optional_advance_trade_routes(uuid,timestamptz)from public,anon,authenticated;

do $$begin
 if to_regprocedure('public.peris_social_snapshot()')is null or to_regclass('public.peris_unit_catalog')is null then
  raise exception 'Install V19 first, or use the complete V19 upgrade.';
 end if;
end $$;

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
 'trade_routes',public.peris_optional_trade_routes(),
 'trade_caravans',public.peris_optional_trade_caravans(),
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
create or replace function public.peris_roster_loss_cost(p_initial jsonb,p_survivors jsonb,p_version integer)returns jsonb
language sql stable security definer set search_path='' as $$
 select jsonb_object_agg(resource,amount)from(
  select resource,coalesce(sum(greatest(0,coalesce((p_initial->>c.unit)::integer,0)-coalesce((p_survivors->>c.unit)::integer,0))*(public.peris_unit_stats(c.unit,'roman',p_version)->'cost'->>resource)::numeric),0)as amount
  from unnest(array['wood','stone','food','gold'])keys(resource)cross join public.peris_unit_catalog c group by resource
 )costs where jsonb_typeof(p_initial)='object'and jsonb_typeof(p_survivors)='object'
$$;
create or replace function public.peris_roster_loss_cost(p_initial jsonb,p_survivors jsonb)returns jsonb
language sql stable security definer set search_path='' as $$select public.peris_roster_loss_cost(p_initial,p_survivors,2)$$;
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
revoke all on function public.peris_apply_hero(bigint,uuid,text),public.peris_add_formations(bigint,uuid,text,integer,integer,integer,numeric),public.peris_finish(bigint,text,text),public.peris_finish_city_raid(bigint,text,text),public.peris_roster_loss_cost(jsonb,jsonb),public.peris_roster_loss_cost(jsonb,jsonb,integer),public.peris_deliver_loot(bigint) from public,anon,authenticated;
revoke all on function public.peris_snapshot() from public,anon;
grant execute on function public.peris_snapshot() to authenticated;
notify pgrst,'reload schema';
commit;
