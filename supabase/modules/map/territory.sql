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
create policy "own map plots" on public.peris_map_plots for select to authenticated using(owner_id=auth.uid());
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
declare u uuid:=auth.uid();s public.settlements%rowtype;c integer;r integer;home_col integer;home_row integer;distance integer;owned integer;population integer;allowance integer;
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
declare u uuid:=auth.uid();s public.settlements%rowtype;p public.peris_map_plots%rowtype;c integer;r integer;factor numeric;cw numeric;cs numeric;cf numeric;cg numeric;
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
 insert into public.peris_orders(owner_id,kind,item,quantity,started_at,finish_at) values(u,'field','field:'||c||':'||r||':'||p_type,1,now(),now()+make_interval(secs=>15+p.level*10));
 return jsonb_build_object('ok',true);
end $$;

-- A modular upgrade may have refreshed city base formulas earlier in this file.
select public.peris_city_economy(id) from public.settlements where city_slots_ready;
revoke all on function public.peris_wrap_world(numeric),public.peris_wrap_cell(integer),public.peris_cell_distance(integer,integer,integer,integer),public.peris_world_terrain(integer,integer),public.peris_field_modifier(text,integer),public.peris_field_rates(bigint),public.peris_city_economy(bigint),public.peris_claim_field(integer,integer),public.peris_queue_field(integer,integer,text) from public,anon,authenticated;
grant execute on function public.peris_claim_field(integer,integer),public.peris_queue_field(integer,integer,text) to authenticated;
