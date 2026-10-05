create or replace function public.peris_settle(p_owner uuid,p_until timestamptz default now()) returns void
language plpgsql security definer set search_path='' as $$
declare s public.settlements%rowtype;o public.peris_orders%rowtype;minutes numeric;l integer;at_time timestamptz;
begin
 perform 1 from public.players where id=p_owner for update;
 select * into s from public.settlements where owner_id=p_owner for update;
 if s.id is null then return;end if;
 for o in select * from public.peris_orders where owner_id=p_owner and finish_at<=p_until order by finish_at,id for update loop
 at_time:=greatest(s.resources_updated_at,o.finish_at);minutes:=greatest(0,extract(epoch from(at_time-s.resources_updated_at)))/60;
 s.wood:=least(s.capacity,s.wood+s.wood_rate*minutes);s.stone:=least(s.capacity,s.stone+s.stone_rate*minutes);
 s.food:=least(s.capacity,s.food+s.food_rate*minutes);s.gold:=least(s.capacity,s.gold+s.gold_rate*minutes);
 s.resources_updated_at:=at_time;
 if o.kind='upgrade' then
 update public.buildings set level=least(20,level+1),updated_at=o.finish_at where settlement_id=s.id and building_type=o.item returning level into l;
 update public.players set upgrades=upgrades+1 where id=p_owner;
 if o.item='lumber' then s.wood_rate:=14+l*8;elsif o.item='quarry' then s.stone_rate:=12+l*7;
 elsif o.item='farm' then s.food_rate:=18+l*10;elsif o.item='market' then s.gold_rate:=3+l*3;
 elsif o.item='storehouse' then s.capacity:=5000+l*2500;end if;
 else
 update public.armies set infantry=infantry+case when o.item='infantry' then o.quantity else 0 end,
 archers=archers+case when o.item='archers' then o.quantity else 0 end,cavalry=cavalry+case when o.item='cavalry' then o.quantity else 0 end,
 updated_at=o.finish_at where owner_id=p_owner;
 update public.players set recruits=recruits+o.quantity where id=p_owner;
 end if;
 delete from public.peris_orders where id=o.id;
 end loop;
 minutes:=greatest(0,extract(epoch from(p_until-s.resources_updated_at)))/60;
 update public.settlements set wood=least(s.capacity,s.wood+s.wood_rate*minutes),stone=least(s.capacity,s.stone+s.stone_rate*minutes),
 food=least(s.capacity,s.food+s.food_rate*minutes),gold=least(s.capacity,s.gold+s.gold_rate*minutes),
 wood_rate=s.wood_rate,stone_rate=s.stone_rate,food_rate=s.food_rate,gold_rate=s.gold_rate,capacity=s.capacity,
 resources_updated_at=greatest(s.resources_updated_at,p_until) where id=s.id;
 update public.armies set status='idle',start_x=target_x,start_y=target_y,updated_at=p_until
 where owner_id=p_owner and status='moving' and arrival_at<=p_until;
end $$;

