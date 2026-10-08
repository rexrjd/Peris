create or replace function public.peris_settle(p_owner uuid,p_until timestamptz default now()) returns void
language plpgsql security definer set search_path='' as $$
<<<<<<< Updated upstream
declare s public.settlements%rowtype;o public.peris_orders%rowtype;minutes numeric;l integer;at_time timestamptz;target_slot integer;field_col integer;field_row integer;
=======
declare s public.settlements%rowtype;o public.peris_orders%rowtype;target_slot integer;
>>>>>>> Stashed changes
begin
 perform 1 from public.players where id=p_owner for update;
 select * into s from public.settlements where owner_id=p_owner for update;if s.id is null then return;end if;
 perform public.peris_city_migrate(s.id);if not s.population_ready then perform public.peris_city_economy(s.id);end if;
 for o in select * from public.peris_orders where owner_id=p_owner and finish_at<=p_until order by finish_at,id for update loop
<<<<<<< Updated upstream
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
 elsif o.kind='field' then
 field_col:=split_part(o.item,':',2)::integer;field_row:=split_part(o.item,':',3)::integer;
 update public.peris_map_plots set level=level+1
 where col=field_col and row=field_row and owner_id=p_owner and settlement_id=s.id
 and building_type=split_part(o.item,':',4) and level<5;
 if not found then raise exception 'Queued external field no longer matches its owner or building';end if;
 update public.players set upgrades=upgrades+1 where id=p_owner;
 elsif o.kind='recruit' then
 update public.armies set infantry=infantry+case when o.item='infantry' then o.quantity else 0 end,
 archers=archers+case when o.item='archers' then o.quantity else 0 end,cavalry=cavalry+case when o.item='cavalry' then o.quantity else 0 end,
 updated_at=o.finish_at where owner_id=p_owner;
 update public.players set recruits=recruits+o.quantity where id=p_owner;
 end if;
 -- Keep each pre-completion segment at its old rate, then use the completed
 -- city and field totals for the next segment without overwriting stored supplies.
 perform public.peris_city_economy(s.id);
 select wood_rate,stone_rate,food_rate,gold_rate,capacity,food_capacity
 into s.wood_rate,s.stone_rate,s.food_rate,s.gold_rate,s.capacity,s.food_capacity
 from public.settlements where id=s.id;
 delete from public.peris_orders where id=o.id;
=======
  perform public.peris_population_accrue(s.id,o.finish_at);
  if o.kind='upgrade' then
   if o.item like 'slot:%' then
    target_slot:=split_part(o.item,':',2)::integer;
    update public.peris_city_slots set level=least(case when building_type='mage_tower' then 10 else 5 end,level+1)where settlement_id=s.id and slot_index=target_slot;
   else update public.buildings set level=least(5,level+1),updated_at=o.finish_at where settlement_id=s.id and building_type=o.item;end if;
   update public.players set upgrades=upgrades+1 where id=p_owner;perform public.peris_city_economy(s.id);
  else
   update public.armies set infantry=infantry+case when o.item='infantry' then o.quantity else 0 end,
    archers=archers+case when o.item='archers' then o.quantity else 0 end,cavalry=cavalry+case when o.item='cavalry' then o.quantity else 0 end,updated_at=o.finish_at where owner_id=p_owner;
   update public.players set recruits=recruits+o.quantity where id=p_owner;
  end if;delete from public.peris_orders where id=o.id;
>>>>>>> Stashed changes
 end loop;
 perform public.peris_population_accrue(s.id,p_until);
 update public.armies set status='idle',start_x=target_x,start_y=target_y,updated_at=p_until where owner_id=p_owner and status='moving' and arrival_at<=p_until;
end $$;
