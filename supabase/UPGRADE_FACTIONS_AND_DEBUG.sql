-- Run after the city-slots and mage-tower updates. Preserves existing cities.
begin;
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
commit;
