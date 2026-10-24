-- Called after casualties and siege, under the ordinary participant/component locks.
-- It never creates a commander, restores a queue, or transfers an account's research.
alter table public.peris_map_plots drop constraint if exists peris_map_plots_settlement_id_owner_id_fkey;
alter table public.peris_map_plots add constraint peris_map_plots_settlement_id_owner_id_fkey
 foreign key(settlement_id,owner_id)references public.settlements(id,owner_id)on update cascade on delete cascade;

create or replace function public.peris_apply_city_conquest(p_city bigint,p_attacker uuid,p_diplomats integer,p_at timestamptz)returns jsonb
language plpgsql security definer set search_path='' as $$
declare city public.settlements%rowtype;before numeric;after numeric;reduction numeric:=0;cost integer:=0;expansion integer;reason text;
 receipt jsonb;old_fields text[];route jsonb;pool record;a public.armies%rowtype;pos jsonb;backup bigint;living integer;
begin
 select * into city from public.settlements where id=p_city for update;
 if city.id is null then return null;end if;
 perform public.peris_loyalty_accrue(city.id,p_at);
 select loyalty into before from public.settlements where id=city.id;
 after:=before;
 select count(*)into expansion from public.settlements where owner_id=p_attacker and ruined_at is null;
 expansion:=expansion+(select count(*)from public.peris_settler_expeditions where owner_id=p_attacker and status='travelling');
 cost:=300*expansion*expansion;
 if city.ruined_at is not null then reason:='city_ruined';
 elsif city.owner_id=p_attacker then reason:='ownership_changed';
 elsif exists(select 1 from public.players where id=p_attacker and defeated_at is not null)then reason:='ruler_defeated';
 elsif p_diplomats<=0 then reason:='no_surviving_diplomats';
 elsif expansion>=10 then reason:='city_limit';
 elsif not exists(select 1 from public.players where id=p_attacker and culture_points>=cost)then reason:='insufficient_culture';
 else reduction:=least(25,p_diplomats,before);after:=greatest(0,before-reduction);
 end if;
 receipt:=jsonb_build_object('city_id',city.id,'before',before,'after',after,'diplomats',greatest(0,p_diplomats),'reduction',reduction,'captured',false,'culture_cost',0,'former_owner_id',city.owner_id);
 if reason is not null then return receipt||jsonb_build_object('reason',reason);end if;
 update public.settlements set loyalty=after,loyalty_updated_at=p_at where id=city.id;
 if after>0 then return receipt;end if;
 -- Settle the culture boundary with the old ownership before changing the rate.
 perform public.peris_culture_accrue(city.owner_id,p_at);perform public.peris_culture_accrue(p_attacker,p_at);
 update public.players set culture_points=culture_points-cost where id=p_attacker;
 update public.players set research_faction=public.peris_account_faction(id)where id in(city.owner_id,p_attacker)and research_faction is null;
 select array_append(coalesce(array_agg(col||':'||row),array[]::text[]),floor(city.x/128.0)::integer||':'||floor(city.y/128.0)::integer)into old_fields from public.peris_map_plots where settlement_id=city.id;
 update public.settlements set owner_id=p_attacker,settlers=0,loyalty=0,loyalty_updated_at=p_at where id=city.id;
 update public.peris_map_plots set owner_id=p_attacker where settlement_id=city.id;
 delete from public.peris_orders where settlement_id=city.id and owner_id=city.owner_id;
 delete from public.peris_unit_research where settlement_id=city.id;
 delete from public.peris_spell_research where settlement_id=city.id;
 -- Evacuate native pools through the existing timed, commander-free transport.
 for pool in
  select city.x x,city.y y,unit_roster troops from public.peris_city_garrisons where settlement_id=city.id and owner_id=city.owner_id
  union all select col*128+64,row*128+64,public.peris_roster(to_jsonb(g))from public.peris_garrisons g where owner_id=city.owner_id and(col||':'||row)=any(old_fields)
 loop
  route:=public.peris_ruin_route(city.owner_id,pool.x,pool.y);
  if route is not null and public.peris_roster_total(pool.troops)>0 then
   insert into public.peris_ruin_evacuations(owner_id,origin_settlement_id,target_settlement_id,origin_x,origin_y,troops,departure_at,arrival_at)
   values(city.owner_id,city.id,(route->>'city_id')::bigint,pool.x,pool.y,pool.troops,p_at,p_at+make_interval(secs=>greatest(2,(route->>'distance')::numeric/22)::double precision));
  end if;
 end loop;
 delete from public.peris_city_garrisons where settlement_id=city.id and owner_id=city.owner_id;
 delete from public.peris_garrisons where owner_id=city.owner_id and(col||':'||row)=any(old_fields);
 select count(*),min(id)into living,backup from public.settlements where owner_id=city.owner_id and ruined_at is null;
 if living=0 then
  update public.players set defeated_at=coalesce(defeated_at,now())where id=city.owner_id;
  delete from public.peris_ruin_evacuations where owner_id=city.owner_id;
  delete from public.peris_city_reinforcements where owner_id=city.owner_id;
  delete from public.peris_guild_reinforcements where owner_id=city.owner_id;
  delete from public.peris_garrisons where owner_id=city.owner_id;
  delete from public.peris_city_garrisons where owner_id=city.owner_id;
  delete from public.peris_orders where owner_id=city.owner_id;
  update public.peris_settler_expeditions set status='returned'where owner_id=city.owner_id and status='travelling';
  update public.peris_campaign_farms set enabled=false where owner_id=city.owner_id;
  for a in select * from public.armies where owner_id=city.owner_id order by id for update loop
   perform public.peris_write_roster(a.id,public.peris_roster('{}'));
   update public.armies set status='idle',raid_city_id=null,raid_target_id=null,raid_reserve=null,march_path=null,march_distance=null,march_origin=null,march_returning=false,march_sent_at=null,march_cancel_until=null,carried_loot=null,updated_at=now()where id=a.id;
  end loop;
 else
  update public.peris_settler_expeditions set origin_settlement_id=backup
  where owner_id=city.owner_id and origin_settlement_id=city.id and status='travelling';
  for a in select * from public.armies where owner_id=city.owner_id order by id for update loop
   pos:=public.peris_army_position(a);
   if(floor(a.target_x/128.0)::integer||':'||floor(a.target_y/128.0)::integer)=any(old_fields)or(a.status='idle'and(floor((pos->>'x')::numeric/128.0)::integer||':'||floor((pos->>'y')::numeric/128.0)::integer)=any(old_fields))then
    -- The current city battle has finished applying casualties. Its native survivors can leave.
    route:=public.peris_ruin_route(city.owner_id,round((pos->>'x')::numeric)::integer,round((pos->>'y')::numeric)::integer);
    if route is not null then
     update public.armies set home_settlement_id=case when home_settlement_id=city.id then(route->>'city_id')::bigint else home_settlement_id end,
      start_x=round((pos->>'x')::numeric)::integer,start_y=round((pos->>'y')::numeric)::integer,target_x=(route->>'x')::integer,target_y=(route->>'y')::integer,
      march_path=route->'path',march_distance=(route->>'distance')::numeric,march_map_version=4,status='moving',raid_city_id=null,raid_target_id=null,raid_reserve=null,march_origin=null,march_returning=true,march_sent_at=null,march_cancel_until=null,
      departure_at=p_at,arrival_at=p_at+make_interval(secs=>greatest(2,(route->>'distance')::numeric/greatest(1,public.peris_march_speed(a.id)))::double precision),updated_at=now()where id=a.id;
    else perform public.peris_write_roster(a.id,'{}');end if;
   elsif a.home_settlement_id=city.id then update public.armies set home_settlement_id=backup where id=a.id;
   end if;
  end loop;
 end if;
 -- Arrival functions retain the original recipient/sender and reroute in-flight cargo.
 update public.peris_trade_routes set enabled=false,deliveries_left=0,last_status='City ownership changed',updated_at=p_at
 where enabled and(source_settlement_id=city.id or target_settlement_id=city.id);
 perform public.peris_city_economy(city.id);
 return receipt||jsonb_build_object('captured',true,'culture_cost',cost,'new_owner_id',p_attacker);
end $$;
revoke all on function public.peris_apply_city_conquest(bigint,uuid,integer,timestamptz)from public,anon,authenticated;
