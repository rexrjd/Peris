-- PERIS: one new barracks per city. Existing buildings, queues and troops are preserved.
-- Apply to the current game schema; safe to run again. No table rewrite or new constraint.
begin;
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
 insert into public.peris_orders(owner_id,kind,item,quantity,started_at,finish_at)values(u,'upgrade','slot:'||p_slot||':'||t,1,now(),now()+make_interval(secs=>greatest(1,ceil((15+l*10)/public.peris_research_factor(u,'construction')))::double precision));
 return jsonb_build_object('ok',true);
end $$;
revoke all on function public.peris_queue_slot(integer,text) from public,anon,authenticated;
grant execute on function public.peris_queue_slot(integer,text) to authenticated;
notify pgrst,'reload schema';
commit;
