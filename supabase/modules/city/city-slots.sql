-- Repeatable city plots; legacy buildings are retained for save compatibility.
alter table public.settlements add column if not exists food_capacity integer not null default 5000;
alter table public.settlements add column if not exists city_slots_ready boolean not null default false;
alter table public.battle_formations add column if not exists attack_multiplier numeric not null default 1 check(attack_multiplier between 1 and 1.6);
create table if not exists public.peris_city_slots (
 settlement_id bigint not null references public.settlements(id) on delete cascade,
 slot_index integer not null check(slot_index between 0 and 16),
 building_type text not null check(building_type in ('barracks','stables','smithy','warehouse','granary','fishery','mage_tower','housing')),
 level integer not null default 0 check(level between 0 and 5),
 primary key(settlement_id,slot_index),check((building_type='fishery')=(slot_index=16))
);
alter table public.peris_city_slots enable row level security;
drop policy if exists "own city slots" on public.peris_city_slots;
create policy "own city slots" on public.peris_city_slots for select to authenticated using(exists(select 1 from public.settlements s where s.id=settlement_id and s.owner_id=auth.uid()));
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
declare u uuid:=auth.uid();s public.settlements%rowtype;l integer;main integer;t text;factor numeric;cw numeric;cs numeric;cf numeric;cg numeric;
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
  if p_type not in ('barracks','stables','smithy','warehouse','granary','fishery','mage_tower','housing') then raise exception 'Unknown building';end if;
  if p_type='mage_tower' and exists(select 1 from public.peris_city_slots where settlement_id=s.id and building_type='mage_tower') then raise exception 'Only one mage tower can be built in your city';end if;
  if (p_type='fishery')<>(p_slot=16) then raise exception 'A fishery needs a riverside plot';end if;
  t:=p_type;l:=0;
 elsif l is null or l=0 then raise exception 'This building is not ready';end if;
 if l>=(case when t='mage_tower' then 10 else 5 end) then raise exception 'Maximum building level reached';end if;
 factor:=power(case when t='mage_tower' then 1.38::numeric else 1.55::numeric end,l);
 cw:=ceil((case t when 'housing' then 140 when 'mage_tower' then 260 when 'barracks' then 180 when 'stables' then 200 when 'smithy' then 180 when 'warehouse' then 200 else 160 end)*factor);
 cs:=ceil((case t when 'housing' then 110 when 'mage_tower' then 340 when 'barracks' then 160 when 'stables' then 120 when 'smithy' then 220 when 'warehouse' then 150 when 'granary' then 120 else 80 end)*factor);
 cf:=ceil((case t when 'housing' then 60 when 'barracks' then 100 when 'stables' then 180 when 'smithy' then 80 when 'warehouse' then 90 else 100 end)*factor);
 cg:=ceil((case t when 'mage_tower' then 160 when 'barracks' then 30 when 'stables' then 45 when 'smithy' then 60 when 'granary' then 15 else 20 end)*factor);
 if s.wood<cw or s.stone<cs or s.food<cf or s.gold<cg then raise exception 'Your stores cannot cover this cost';end if;
 update public.settlements set wood=wood-cw,stone=stone-cs,food=food-cf,gold=gold-cg where id=s.id;
 if p_type is not null then insert into public.peris_city_slots values(s.id,p_slot,t,0);end if;
 insert into public.peris_orders(owner_id,kind,item,quantity,started_at,finish_at)values(u,'upgrade','slot:'||p_slot||':'||t,1,now(),now()+make_interval(secs=>15+l*10));
 return jsonb_build_object('ok',true);
end $$;
revoke all on function public.peris_city_economy(bigint),public.peris_city_migrate(bigint),public.peris_queue_slot(integer,text) from public,anon,authenticated;
grant execute on function public.peris_queue_slot(integer,text) to authenticated;
