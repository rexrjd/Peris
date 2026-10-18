create or replace function public.peris_siege_reduction(p_engines integer,p_level integer,p_weapon text)returns integer
language plpgsql immutable set search_path='' as $$
declare remaining integer:=greatest(0,p_engines);after_level integer:=greatest(0,p_level);needed integer;
begin
 for i in 1..2 loop
  exit when after_level=0;
  needed:=case when p_weapon='ram'then 6+after_level*4 else 4+after_level*3 end;
  exit when remaining<needed;remaining:=remaining-needed;after_level:=after_level-1;
 end loop;
 return p_level-after_level;
end $$;

create or replace function public.peris_city_defender_roster(p_battle bigint)returns jsonb
language sql stable security definer set search_path='' as $$
 select jsonb_object_agg(unit,total)from(
  select c.unit,coalesce((select sum((party->'troops'->>c.unit)::integer)from public.battles b cross join lateral jsonb_array_elements(b.city_defenders)party where b.id=p_battle),0)as total
  from public.peris_unit_catalog c
 )q
$$;

create or replace function public.peris_prepare_city_raid(p_owner uuid,p_army bigint,p_city bigint,p_path jsonb,p_troops jsonb,p_target text default 'auto')returns jsonb
language plpgsql security definer set search_path='' as $$
declare a public.armies%rowtype;c public.settlements%rowtype;available jsonb;chosen jsonb;unit_name text;
begin
 if p_owner is null then raise exception 'Authentication required';end if;
 if p_target not in('auto','barracks','stables','workshop','smithy','warehouse','granary','housing','mage_tower','fishery','lumber','quarry','farm','storehouse','trading_post')then raise exception 'Choose a valid catapult target';end if;
 perform public.peris_settle(p_owner);
 select * into a from public.armies where id=p_army and owner_id=p_owner for update;
 select * into c from public.settlements where id=p_city and owner_id<>p_owner;
 if a.id is null or c.id is null then raise exception 'Choose your legion and another player''s city';end if;
 if public.peris_social_relation(p_owner,c.owner_id)in('guild','alliance','nap')then raise exception 'Your guild or diplomatic pact protects this city';end if;
 available:=public.peris_roster(to_jsonb(a));chosen:=public.peris_garrison_troops(coalesce(nullif(p_troops,'null'::jsonb),available));
 if public.peris_roster_total(chosen)=0 then raise exception 'Send at least one soldier';end if;
 foreach unit_name in array array['infantry','spearmen','archers','elite','cavalry','scout','heavyCavalry','ram','catapult']loop
  if(chosen->>unit_name)::integer>(available->>unit_name)::integer then raise exception 'Choose troops currently available in this legion';end if;
 end loop;
 perform public.peris_march_for_target(p_owner,a.id,c.x,c.y,p_path,null,c.id);
 perform public.peris_garrison_add(p_owner,floor(a.target_x/128.0)::integer,floor(a.target_y/128.0)::integer,public.peris_roster_add(available,chosen,-1));
 perform public.peris_write_roster(a.id,chosen);
 update public.armies set siege_target=p_target,arrival_at=departure_at+make_interval(secs=>greatest(2,march_distance/public.peris_march_speed(id))::double precision)where id=a.id;
 return jsonb_build_object('ok',true);
end $$;

create or replace function public.peris_start_city_raid(p_owner uuid,p_army bigint)returns bigint
language plpgsql security definer set search_path='' as $$
declare a public.armies%rowtype;c public.settlements%rowtype;defenders jsonb;roster jsonb;leader bigint;bid bigint;wall integer;effective integer;bonus jsonb;
begin
 select * into a from public.armies where id=p_army and owner_id=p_owner;
 select * into c from public.settlements where id=a.raid_city_id and owner_id<>p_owner;
 if a.id is null or c.id is null or a.status<>'idle'or a.target_x<>c.x or a.target_y<>c.y then return null;end if;
 -- A pact accepted during travel protects the city when the raid arrives.
 if public.peris_social_relation(p_owner,c.owner_id)in('guild','alliance','nap')then perform public.peris_return_raid(a.id);return null;end if;
 -- Avoid waiting on another ruler while the caller already holds its own lock.
 if exists(select 1 from public.peris_settler_expeditions where owner_id in(p_owner,c.owner_id)and status='travelling'and arrival_at<=now())and not pg_try_advisory_xact_lock(204200)then return null;end if;
 begin perform 1 from public.players where id in(p_owner,c.owner_id)order by id for update nowait;
 exception when lock_not_available then return null;end;
 if exists(select 1 from public.battles where status='active'and(attacker_owner_id in(p_owner,c.owner_id)or defender_owner_id in(p_owner,c.owner_id)))then return null;end if;
 perform public.peris_settle(c.owner_id);
 perform 1 from public.armies where id=a.id for update;
 select * into c from public.settlements where id=c.id for update;
 select coalesce(jsonb_agg(jsonb_build_object('army_id',d.id,'troops',public.peris_roster(to_jsonb(d)))order by d.id),'[]')into defenders
 from public.armies d where d.owner_id=c.owner_id and d.status='idle'and d.raid_target_id is null and d.raid_city_id is null
 and floor(d.target_x/128.0)=floor(c.x/128.0)and floor(d.target_y/128.0)=floor(c.y/128.0);
 select d.id into leader from public.armies d left join public.peris_heroes h on h.army_id=d.id
 where d.owner_id=c.owner_id and d.status='idle'and d.raid_target_id is null and d.raid_city_id is null
 and floor(d.target_x/128.0)=floor(c.x/128.0)and floor(d.target_y/128.0)=floor(c.y/128.0)order by coalesce(h.experience,0)desc,d.id limit 1;
 select public.peris_roster(to_jsonb(g))into roster from public.peris_garrisons g where owner_id=c.owner_id and col=floor(c.x/128.0)::integer and row=floor(c.y/128.0)::integer for update;
 if roster is not null then defenders:=defenders||jsonb_build_array(jsonb_build_object('col',floor(c.x/128.0),'row',floor(c.y/128.0),'troops',roster));end if;
 insert into public.battles(attacker_owner_id,defender_owner_id,attacker_army_id,defender_army_id,mode,phase,terrain,difficulty,enemy_name,attacker_ready,defender_ready,defender_faction,raid_city_id,siege_target,city_defenders)
 values(p_owner,c.owner_id,a.id,leader,'pvp','combat',public.peris_battle_terrain(c.x,c.y),'normal',c.name,true,true,c.faction,c.id,a.siege_target,defenders)returning id into bid;
 perform public.peris_add_formations(bid,p_owner,'attacker',a.infantry,a.archers,a.cavalry,90);
 perform public.peris_add_formations(bid,c.owner_id,'defender',0,0,0,90);
 select coalesce(level,0)into wall from public.buildings where settlement_id=c.id and building_type='wall';wall:=coalesce(wall,0);
 effective:=wall-public.peris_siege_reduction(floor((public.peris_roster(to_jsonb(a))->>'ram')::integer*public.peris_research_factor(p_owner,'siege'))::integer,wall,'ram');
 bonus:=public.peris_hero_bonuses(leader);
 update public.battle_formations set defence_multiplier=defence_multiplier*(1+effective*.06),morale=least(100,morale+effective*2),
 attack_multiplier=(1+least(.6,coalesce((select sum(level)*.04 from public.peris_city_slots where settlement_id=c.id and building_type='smithy'),0)))*(bonus->>'damage')::numeric where battle_id=bid and side='defender';
 update public.armies set raid_city_id=null where id=a.id;
 return bid;
end $$;

create or replace function public.peris_damage_city(p_city bigint,p_engines jsonb,p_target text)returns jsonb
language plpgsql security definer set search_path='' as $$
declare wall public.buildings%rowtype;chosen record;loss integer;damage jsonb:='[]';
begin
 select * into wall from public.buildings where settlement_id=p_city and building_type='wall'for update;
 if wall.id is not null then
  loss:=public.peris_siege_reduction(coalesce((p_engines->>'ram')::integer,0),wall.level,'ram');
  if loss>0 then damage:=damage||jsonb_build_array(jsonb_build_object('building_type','wall','name','Walls','before',wall.level,'after',wall.level-loss,'weapon','ram'));update public.buildings set level=level-loss,updated_at=now()where id=wall.id;end if;
 end if;
 select * into chosen from(
  select building_type,level,slot_index,null::bigint as building_id,null::integer as field_col,null::integer as field_row from public.peris_city_slots where settlement_id=p_city
  union all select building_type,level,null::integer,id,null::integer,null::integer from public.buildings where settlement_id=p_city and building_type not in('market','wall')
  union all select case when building_type='market'then 'trading_post'else building_type end,level,null::integer,null::bigint,col,row from public.peris_map_plots where settlement_id=p_city and building_type is not null
 )q where level>0 and(p_target='auto'or building_type=p_target)order by level desc,building_type collate "C",coalesce(slot_index,999),coalesce(field_col,999),coalesce(field_row,999)limit 1;
 if chosen.level is not null then
  loss:=public.peris_siege_reduction(coalesce((p_engines->>'catapult')::integer,0),chosen.level,'catapult');
  if loss>0 then
   damage:=damage||jsonb_build_array(jsonb_strip_nulls(jsonb_build_object('building_type',chosen.building_type,'name',case chosen.building_type when 'mage_tower'then 'Mage tower'when 'lumber'then 'Lumber mill'when 'trading_post'then 'Trading post'else initcap(chosen.building_type)end,'slot_index',chosen.slot_index,'col',chosen.field_col,'row',chosen.field_row,'before',chosen.level,'after',chosen.level-loss,'weapon','catapult')));
   if chosen.slot_index is not null then update public.peris_city_slots set level=level-loss where settlement_id=p_city and slot_index=chosen.slot_index;
   elsif chosen.field_col is not null then update public.peris_map_plots set level=level-loss where settlement_id=p_city and col=chosen.field_col and row=chosen.field_row;
   else update public.buildings set level=level-loss,updated_at=now()where id=chosen.building_id;end if;
  end if;
 end if;
 if jsonb_array_length(damage)>0 then perform public.peris_city_economy(p_city);end if;
 return damage;
end $$;

create or replace function public.peris_finish_city_raid(p_bid bigint,p_winner text,p_reason text)returns void
language plpgsql security definer set search_path='' as $$
declare b public.battles%rowtype;c public.settlements%rowtype;a public.armies%rowtype;party jsonb;initial jsonb;survivors jsonb;def_initial jsonb;def_remaining jsonb;current_roster jsonb;losses jsonb;cumulative jsonb:=public.peris_roster('{}');engines jsonb;loot jsonb:=jsonb_build_object('wood',0,'stone',0,'food',0,'gold',0);r jsonb;damage jsonb;reward jsonb;receipt jsonb;unit_name text;key text;lost integer;start_count integer;party_count integer;total integer;ai integer;di integer;asur integer;dsur integer;carry numeric;owner uuid;winner uuid;commander bigint;side text;g public.peris_garrisons%rowtype;
begin
 select * into b from public.battles where id=p_bid for update;if b.id is null or b.status<>'active'or b.raid_city_id is null then return;end if;
 if p_winner not in('attacker','defender','draw')then raise exception 'Invalid battle outcome';end if;
 if exists(select 1 from public.peris_settler_expeditions where owner_id in(b.attacker_owner_id,b.defender_owner_id)and status='travelling'and arrival_at<=now())and not pg_try_advisory_xact_lock(204200)then raise exception 'City raid is still resolving. Try again';end if;
 perform 1 from public.players where id in(b.attacker_owner_id,b.defender_owner_id)order by id for update nowait;
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
 r:=jsonb_build_object('balance_version',b.balance_version,'attacker_initial',ai,'defender_initial',di,'attacker_survivors',asur,'defender_survivors',dsur,'attacker_losses',ai-asur,'defender_losses',di-dsur,'attacker_roster',initial,'attacker_survivor_roster',survivors,'defender_roster',def_initial,'defender_survivor_roster',def_remaining,'attacker_faction',coalesce(b.attacker_faction,(select faction from public.settlements where id=a.home_settlement_id)),'defender_faction',coalesce(b.defender_faction,c.faction),'loot',loot,'duration',round(b.elapsed),'reason',p_reason,'carrying_capacity',carry,'replacement_cost',public.peris_roster_loss_cost(initial,survivors,b.balance_version),'raid_city',jsonb_build_object('id',c.id,'name',c.name),'siege_damage',damage);
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
 update public.battles set status='resolved',phase='finished',winner_side=p_winner,winner_owner_id=winner,ended_at=now(),result=r where id=b.id;
 if not public.peris_return_raid(a.id)then
  update public.armies set start_x=(public.peris_home_army_position(s.x,s.y)->>'x')::integer,start_y=(public.peris_home_army_position(s.x,s.y)->>'y')::integer,target_x=(public.peris_home_army_position(s.x,s.y)->>'x')::integer,target_y=(public.peris_home_army_position(s.x,s.y)->>'y')::integer,march_path=null,march_distance=null,march_returning=false from public.settlements s where armies.id=a.id and s.id=a.home_settlement_id;
  perform public.peris_deliver_loot(a.id);
 end if;
end $$;
