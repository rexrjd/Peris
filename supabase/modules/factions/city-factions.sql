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
