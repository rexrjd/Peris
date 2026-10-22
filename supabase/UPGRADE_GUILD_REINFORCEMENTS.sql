-- PERIS guild reinforcements: apply AFTER V19 Guilds and UPGRADE_CITY_LOGISTICS.sql.
-- Back up the database and review this SQL before production deployment.
begin;
create table if not exists public.peris_worker_owners(owner_id uuid primary key references public.players(id)on delete cascade,last_processed_at timestamptz not null default now());
alter table public.peris_worker_owners enable row level security;
revoke all on public.peris_worker_owners from public,anon,authenticated;
-- The same persistent world advances without a browser. All helpers are private.
create or replace function public.peris_game_tick(p_limit integer default 40)returns jsonb
language plpgsql security definer set search_path='' as $$
declare owner uuid;farm public.peris_campaign_farms%rowtype;processed integer:=0;bid bigint;camp_id integer;
begin
 if p_limit not between 1 and 100 then raise exception 'Use a worker budget of 1Ã¢â‚¬“100 owners';end if;
 if not pg_try_advisory_xact_lock(204215)then return jsonb_build_object('busy',true);end if;
 if exists(select 1 from public.peris_settler_expeditions where status='travelling'and arrival_at<=now())then perform pg_advisory_xact_lock(204200);end if;
 for owner in select q.owner_id from(
  select owner_id,min(arrival_at)as due from public.armies where (status='moving' or raid_target_id is not null or raid_city_id is not null)and arrival_at<=now() group by owner_id
  union all select owner_id,min(arrival_at)from public.peris_settler_expeditions where status='travelling'and arrival_at<=now()group by owner_id
  union all select owner_id,min(finish_at)from public.peris_orders where finish_at<=now()group by owner_id
  union all select owner_id,min(arrival_at)from public.peris_city_reinforcements where arrival_at<=now()group by owner_id
  union all select owner_id,min(arrival_at)from public.peris_guild_reinforcements where status in('outbound','returning')and arrival_at<=now()group by owner_id
  union all select r.owner_id,min(now())from public.peris_guild_reinforcements r join public.settlements s on s.id=r.target_settlement_id where r.status='stationed'and (s.ruined_at is not null or not exists(select 1 from public.peris_guild_members a join public.peris_guild_members b on b.guild_id=a.guild_id where a.player_id=r.owner_id and b.player_id=r.recipient_id))group by r.owner_id
  union all select owner_id,min(public.peris_science_deadline(owner_id))from public.peris_account_science where active_id is not null and public.peris_science_deadline(owner_id)<=now()group by owner_id
  union all select owner_id,min(next_at)from public.peris_campaign_farms where enabled and next_at<=now()group by owner_id
  union all select attacker_owner_id,min(last_tick_at)from public.battles where status='active'group by attacker_owner_id
 )q left join public.peris_worker_owners w on w.owner_id=q.owner_id group by q.owner_id,w.last_processed_at order by coalesce(w.last_processed_at,'1970-01-01'::timestamptz),min(q.due),q.owner_id limit p_limit loop
  begin
   perform public.peris_settle(owner);
   for farm in select * from public.peris_campaign_farms where owner_id=owner and enabled and next_at<=now()order by next_at,id limit 100 for update loop
    begin
     if farm.route is null then raise exception 'Start this target manually once to establish its land route';end if;
     perform public.peris_prepare_raid_for(owner,farm.army_id,farm.camp_id,farm.route,farm.troops);
     update public.armies set farm_list_id=farm.list_id where id=farm.army_id;
     update public.peris_campaign_farms set last_status='Raid preparing',sent=sent+1 where id=farm.id;
    exception when others then update public.peris_campaign_farms set last_status=sqlerrm,skipped=skipped+1 where id=farm.id;end;
    update public.peris_campaign_farms set next_at=now()+make_interval(secs=>farm.interval_seconds)where id=farm.id;
   end loop;
   perform public.peris_sync_owner(owner);
   for bid in select id from public.battles where status='active'and attacker_owner_id=owner order by id loop perform public.peris_tick_for(bid,owner);end loop;
   insert into public.peris_worker_owners(owner_id,last_processed_at)values(owner,now())on conflict(owner_id)do update set last_processed_at=excluded.last_processed_at;
   processed:=processed+1;
  exception when others then raise warning 'Peris worker could not process owner %: %',owner,sqlerrm;end;
 end loop;
 for camp_id in select s.camp_id from public.peris_camp_stock s where s.next_recruit_at<=now() or s.stock_updated_at<=now()-interval '1 minute'order by least(s.next_recruit_at,s.stock_updated_at+interval '1 minute'),s.camp_id limit 100 loop perform public.peris_camp_accrue(camp_id);end loop;
 return jsonb_build_object('processed',processed);
end $$;

create or replace function public.peris_start_city_raid(p_owner uuid,p_army bigint)returns bigint
language plpgsql security definer set search_path='' as $$
declare a public.armies%rowtype;c public.settlements%rowtype;defenders jsonb;roster jsonb;leader bigint;bid bigint;wall integer;bonus jsonb;
begin
 select * into a from public.armies where id=p_army and owner_id=p_owner;
 select * into c from public.settlements where id=a.raid_city_id and owner_id<>p_owner;
 if a.id is null or c.id is null or c.ruined_at is not null or a.status<>'idle'or a.target_x<>c.x or a.target_y<>c.y then return null;end if;
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
 -- Guild troops remain owned by their sender, and are accounted for individually.
 select defenders||coalesce(jsonb_agg(jsonb_build_object('guild_reinforcement_id',r.id,'troops',r.troops)order by r.id),'[]'::jsonb) into defenders
 from public.peris_guild_reinforcements r
 join public.peris_guild_members sender on sender.player_id=r.owner_id
 join public.peris_guild_members receiver on receiver.player_id=r.recipient_id and receiver.guild_id=sender.guild_id
 where r.target_settlement_id=c.id and r.recipient_id=c.owner_id and r.status='stationed';
 select public.peris_roster(g.unit_roster)into roster from public.peris_city_garrisons g where g.settlement_id=c.id and g.owner_id=c.owner_id for update;
 if roster is not null and public.peris_roster_total(roster)>0 then defenders:=defenders||jsonb_build_array(jsonb_build_object('city_garrison_id',c.id,'troops',roster));end if;
 insert into public.battles(attacker_owner_id,defender_owner_id,attacker_army_id,defender_army_id,mode,phase,terrain,difficulty,enemy_name,attacker_ready,defender_ready,defender_faction,raid_city_id,siege_target,city_defenders)
 values(p_owner,c.owner_id,a.id,leader,'pvp','combat',public.peris_battle_terrain(c.x,c.y),'normal',c.name,true,true,c.faction,c.id,a.siege_target,defenders)returning id into bid;
 perform public.peris_add_formations(bid,p_owner,'attacker',a.infantry,a.archers,a.cavalry,90);
 perform public.peris_add_formations(bid,c.owner_id,'defender',0,0,0,90);
 select coalesce(level,0)into wall from public.buildings where settlement_id=c.id and building_type='wall';wall:=coalesce(wall,0);
 bonus:=public.peris_hero_bonuses(leader);
 update public.battle_formations set defence_multiplier=defence_multiplier*(1+public.peris_wall_defence_bonus(wall)),
 attack_multiplier=(1+least(.6,coalesce((select sum(level)*.04 from public.peris_city_slots where settlement_id=c.id and building_type='smithy'),0)))*(bonus->>'damage')::numeric where battle_id=bid and side='defender';
 update public.armies set raid_city_id=null where id=a.id;
 return bid;
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
 update public.battles set status='resolved',phase='finished',winner_side=p_winner,winner_owner_id=winner,ended_at=now(),result=r where id=b.id;
 if not public.peris_return_raid(a.id)then
  update public.armies set start_x=(public.peris_home_army_position(s.x,s.y)->>'x')::integer,start_y=(public.peris_home_army_position(s.x,s.y)->>'y')::integer,target_x=(public.peris_home_army_position(s.x,s.y)->>'x')::integer,target_y=(public.peris_home_army_position(s.x,s.y)->>'y')::integer,march_path=null,march_distance=null,march_returning=false from public.settlements s where armies.id=a.id and s.id=a.home_settlement_id;
  perform public.peris_deliver_loot(a.id);
 end if;
end $$;
create or replace function public.peris_settle(p_owner uuid,p_until timestamptz default now()) returns void
language plpgsql security definer set search_path='' as $$
declare s public.settlements%rowtype;o public.peris_orders%rowtype;event record;target_slot integer;field_col integer;field_row integer;arriving_army bigint;
begin
 -- Cell reservation lock precedes player locks everywhere, including offline arrivals.
 if exists(select 1 from public.peris_settler_expeditions where owner_id=p_owner and status='travelling'and arrival_at<=p_until)then perform pg_advisory_xact_lock(204200);end if;
 perform 1 from public.players where id=p_owner for update;
 if not found then return;end if;
 if exists(select 1 from public.players where id=p_owner and defeated_at is not null)then return;end if;
 perform public.peris_ruin_advance(p_owner,p_until);
 perform public.peris_city_reinforcements_advance(p_owner,p_until);
 perform public.peris_guild_reinforcements_advance(p_owner,p_until);
 for s in select * from public.settlements where owner_id=p_owner and ruined_at is null order by id for update loop
 perform public.peris_city_migrate(s.id);if not s.population_ready then perform public.peris_city_economy(s.id);end if;
 end loop;
 for event in select id,finish_at as at_time,false as expedition from public.peris_orders where owner_id=p_owner and finish_at<=p_until
 union all select id,arrival_at as at_time,true as expedition from public.peris_settler_expeditions where owner_id=p_owner and status='travelling'and arrival_at<=p_until
 order by at_time,expedition,id loop
 perform public.peris_science_advance(p_owner,event.at_time);
 perform public.peris_culture_accrue(p_owner,event.at_time);
 if event.expedition then perform public.peris_found_complete(event.id);continue;end if;
 select * into o from public.peris_orders where id=event.id for update;
 select * into s from public.settlements where id=coalesce(o.settlement_id,(select min(id)from public.settlements where owner_id=p_owner and ruined_at is null))and owner_id=p_owner for update;
 if s.id is null or s.ruined_at is not null then delete from public.peris_orders where id=o.id;continue;end if;
 perform public.peris_population_accrue(s.id,o.finish_at);
 if o.kind='upgrade' then
  if o.item like 'slot:%' then
   target_slot:=split_part(o.item,':',2)::integer;
   update public.peris_city_slots set level=least(case when building_type='mage_tower' then 10 else 5 end,level+1)where settlement_id=s.id and slot_index=target_slot;
  else update public.buildings set level=least(5,level+1),updated_at=o.finish_at where settlement_id=s.id and building_type=o.item;end if;
  update public.players set upgrades=upgrades+1 where id=p_owner;update public.settlements set development_points=development_points+1 where id=s.id;perform public.peris_city_economy(s.id);
 elsif o.kind='field' then
  field_col:=split_part(o.item,':',2)::integer;field_row:=split_part(o.item,':',3)::integer;
  update public.peris_map_plots set level=level+1 where col=field_col and row=field_row and owner_id=p_owner and settlement_id=s.id and building_type=split_part(o.item,':',4) and level<5;
  if not found then raise exception 'Queued external field no longer matches its owner or building';end if;
  update public.players set upgrades=upgrades+1 where id=p_owner;update public.settlements set development_points=development_points+1 where id=s.id;perform public.peris_city_economy(s.id);
 elsif o.kind='settler'then update public.settlements set settlers=settlers+o.quantity where id=s.id;
 elsif o.kind='recruit' then
  if o.recruit_destination='garrison' then
   perform public.peris_city_garrison_receive(p_owner,s.id,jsonb_build_object(o.item,o.quantity));
  else
   perform public.peris_recruit_complete(coalesce(o.army_id,(select min(id)from public.armies where owner_id=p_owner)),o.item,o.quantity);
  end if;
  update public.players set recruits=recruits+o.quantity where id=p_owner;
 end if;
 delete from public.peris_orders where id=o.id;
 end loop;
 perform public.peris_science_advance(p_owner,p_until);
 perform public.peris_culture_accrue(p_owner,p_until);
 for s in select * from public.settlements where owner_id=p_owner and ruined_at is null order by id loop perform public.peris_population_accrue(s.id,p_until);end loop;
 for arriving_army in select id from public.armies where owner_id=p_owner and status='moving' and raid_target_id is null and raid_city_id is null and arrival_at<=p_until order by id for update loop
  if not exists(select 1 from public.armies a where a.id=arriving_army and public.peris_station_owned(p_owner,floor(a.target_x/128.0)::integer,floor(a.target_y/128.0)::integer))then
   perform public.peris_ruin_redirect_army(arriving_army);continue;
  end if;
  perform public.peris_deliver_loot(arriving_army);
  update public.armies set status='idle',start_x=target_x,start_y=target_y,march_path=null,march_distance=null,
   march_sent_at=null,march_cancel_until=null,march_origin=null,march_returning=false,updated_at=p_until where id=arriving_army;
  if not exists(select 1 from public.battles b join public.settlements c on c.id=b.raid_city_id join public.armies a on a.id=arriving_army where b.status='active'and b.defender_owner_id=p_owner and floor(c.x/128.0)=floor(a.target_x/128.0)and floor(c.y/128.0)=floor(a.target_y/128.0))then perform public.peris_garrison_merge(arriving_army);end if;
 end loop;
 -- Attack arrivals retain their outbound route for the eventual return.
 update public.armies set status='idle',start_x=target_x,start_y=target_y,updated_at=p_until where owner_id=p_owner and status='moving'and arrival_at<=p_until;
end $$;
create or replace function public.peris_game_tick(p_limit integer default 40)returns jsonb
language plpgsql security definer set search_path='' as $$
declare owner uuid;farm public.peris_campaign_farms%rowtype;processed integer:=0;bid bigint;camp_id integer;
begin
 if p_limit not between 1 and 100 then raise exception 'Use a worker budget of 1Ã¢â‚¬“100 owners';end if;
 if not pg_try_advisory_xact_lock(204215)then return jsonb_build_object('busy',true);end if;
 if exists(select 1 from public.peris_settler_expeditions where status='travelling'and arrival_at<=now())then perform pg_advisory_xact_lock(204200);end if;
 for owner in select q.owner_id from(
  select owner_id,min(arrival_at)as due from public.armies where (status='moving' or raid_target_id is not null or raid_city_id is not null)and arrival_at<=now() group by owner_id
  union all select owner_id,min(arrival_at)from public.peris_settler_expeditions where status='travelling'and arrival_at<=now()group by owner_id
  union all select owner_id,min(finish_at)from public.peris_orders where finish_at<=now()group by owner_id
  union all select owner_id,min(arrival_at)from public.peris_city_reinforcements where arrival_at<=now()group by owner_id
  union all select owner_id,min(arrival_at)from public.peris_guild_reinforcements where status in('outbound','returning')and arrival_at<=now()group by owner_id
  union all select r.owner_id,min(now())from public.peris_guild_reinforcements r join public.settlements s on s.id=r.target_settlement_id where r.status='stationed'and (s.ruined_at is not null or not exists(select 1 from public.peris_guild_members a join public.peris_guild_members b on b.guild_id=a.guild_id where a.player_id=r.owner_id and b.player_id=r.recipient_id))group by r.owner_id
  union all select owner_id,min(public.peris_science_deadline(owner_id))from public.peris_account_science where active_id is not null and public.peris_science_deadline(owner_id)<=now()group by owner_id
  union all select owner_id,min(next_at)from public.peris_campaign_farms where enabled and next_at<=now()group by owner_id
  union all select attacker_owner_id,min(last_tick_at)from public.battles where status='active'group by attacker_owner_id
 )q left join public.peris_worker_owners w on w.owner_id=q.owner_id group by q.owner_id,w.last_processed_at order by coalesce(w.last_processed_at,'1970-01-01'::timestamptz),min(q.due),q.owner_id limit p_limit loop
  begin
   perform public.peris_settle(owner);
   for farm in select * from public.peris_campaign_farms where owner_id=owner and enabled and next_at<=now()order by next_at,id limit 100 for update loop
    begin
     if farm.route is null then raise exception 'Start this target manually once to establish its land route';end if;
     perform public.peris_prepare_raid_for(owner,farm.army_id,farm.camp_id,farm.route,farm.troops);
     update public.armies set farm_list_id=farm.list_id where id=farm.army_id;
     update public.peris_campaign_farms set last_status='Raid preparing',sent=sent+1 where id=farm.id;
    exception when others then update public.peris_campaign_farms set last_status=sqlerrm,skipped=skipped+1 where id=farm.id;end;
    update public.peris_campaign_farms set next_at=now()+make_interval(secs=>farm.interval_seconds)where id=farm.id;
   end loop;
   perform public.peris_sync_owner(owner);
   for bid in select id from public.battles where status='active'and attacker_owner_id=owner order by id loop perform public.peris_tick_for(bid,owner);end loop;
   insert into public.peris_worker_owners(owner_id,last_processed_at)values(owner,now())on conflict(owner_id)do update set last_processed_at=excluded.last_processed_at;
   processed:=processed+1;
  exception when others then raise warning 'Peris worker could not process owner %: %',owner,sqlerrm;end;
 end loop;
 for camp_id in select s.camp_id from public.peris_camp_stock s where s.next_recruit_at<=now() or s.stock_updated_at<=now()-interval '1 minute'order by least(s.next_recruit_at,s.stock_updated_at+interval '1 minute'),s.camp_id limit 100 loop perform public.peris_camp_accrue(camp_id);end loop;
 return jsonb_build_object('processed',processed);
end $$;
create or replace function public.peris_ruin_city(p_city bigint)returns boolean
language plpgsql security definer set search_path='' as $$
declare city public.settlements%rowtype;garrison public.peris_city_garrisons%rowtype;g public.peris_garrisons%rowtype;a public.armies%rowtype;route jsonb;
 old_fields text[];city_key text;pos jsonb;target_key text;living_count integer;
begin
 select * into city from public.settlements where id=p_city for update;
 if city.id is null or city.ruined_at is not null then return false;end if;
 if exists(select 1 from public.buildings where settlement_id=p_city and level>0)
    or exists(select 1 from public.peris_city_slots where settlement_id=p_city and level>0)then return false;end if;
 city_key:=floor(city.x/128.0)::integer||':'||floor(city.y/128.0)::integer;
 select array_append(coalesce(array_agg(col||':'||row),array[]::text[]),city_key)into old_fields from public.peris_map_plots where settlement_id=p_city;
 update public.settlements set ruined_at=now(),wood=0,stone=0,food=0,gold=0,
    wood_rate=0,stone_rate=0,food_rate=0,gold_rate=0,settlers=0,population=0 where id=p_city;
 delete from public.peris_orders where settlement_id=p_city;
 update public.peris_settler_expeditions set status='returned' where origin_settlement_id=p_city and status='travelling';
 -- Dedicated city defenders evacuate using the same no-commander transport.
 for garrison in select * from public.peris_city_garrisons where settlement_id=p_city and owner_id=city.owner_id for update loop
  route:=public.peris_ruin_route(city.owner_id,city.x,city.y);
  if route is not null and public.peris_roster_total(garrison.unit_roster)>0 then
   insert into public.peris_ruin_evacuations(owner_id,origin_settlement_id,target_settlement_id,origin_x,origin_y,troops,departure_at,arrival_at)
   values(city.owner_id,city.id,(route->>'city_id')::bigint,city.x,city.y,public.peris_roster(garrison.unit_roster),now(),
     now()+make_interval(secs=>greatest(2,(route->>'distance')::numeric/22)::double precision));
  end if;
  delete from public.peris_city_garrisons where settlement_id=p_city and owner_id=city.owner_id;
 end loop;
 -- Transport surviving station pools before abandoning the claimed fields.
 for g in select * from public.peris_garrisons where owner_id=city.owner_id and (col||':'||row)=any(old_fields)for update loop
  route:=public.peris_ruin_route(city.owner_id,g.col*128+64,g.row*128+64);
  if route is not null and public.peris_roster_total(public.peris_roster(to_jsonb(g)))>0 then
   insert into public.peris_ruin_evacuations(owner_id,origin_settlement_id,target_settlement_id,origin_x,origin_y,troops,departure_at,arrival_at)
   values(city.owner_id,city.id,(route->>'city_id')::bigint,g.col*128+64,g.row*128+64,public.peris_roster(to_jsonb(g)),now(),
    now()+make_interval(secs=>greatest(2,(route->>'distance')::numeric/22)::double precision));
  end if;
  delete from public.peris_garrisons where owner_id=g.owner_id and col=g.col and row=g.row;
 end loop;
 delete from public.peris_map_plots where settlement_id=p_city;
 select count(*)into living_count from public.settlements where owner_id=city.owner_id and ruined_at is null;
 if living_count=0 then
  update public.players set defeated_at=coalesce(defeated_at,now()),culture_points=0 where id=city.owner_id;
  delete from public.peris_ruin_evacuations where owner_id=city.owner_id;
  delete from public.peris_city_reinforcements where owner_id=city.owner_id;
  delete from public.peris_guild_reinforcements where owner_id=city.owner_id;
  delete from public.peris_garrisons where owner_id=city.owner_id;
  delete from public.peris_orders where owner_id=city.owner_id;
  update public.peris_settler_expeditions set status='returned'where owner_id=city.owner_id and status='travelling';
  update public.peris_campaign_farms set enabled=false where owner_id=city.owner_id;
  for a in select * from public.armies where owner_id=city.owner_id for update loop
   perform public.peris_write_roster(a.id,public.peris_roster('{}'));
   update public.armies set status='idle',raid_city_id=null,raid_target_id=null,raid_reserve=null,march_path=null,march_distance=null,march_origin=null,march_returning=false,march_sent_at=null,march_cancel_until=null,carried_loot=null,updated_at=now()where id=a.id;
  end loop;
  return true;
 end if;
 for a in select * from public.armies where owner_id=city.owner_id order by id for update loop
  pos:=public.peris_army_position(a);
  target_key:=floor(a.target_x/128.0)::integer||':'||floor(a.target_y/128.0)::integer;
  if a.home_settlement_id=city.id or target_key=any(old_fields) or
   (a.status='idle' and (floor((pos->>'x')::numeric/128.0)::integer||':'||floor((pos->>'y')::numeric/128.0)::integer)=any(old_fields))then
   perform public.peris_ruin_redirect_army(a.id);
  end if;
 end loop;
 return true;
end $$;
notify pgrst,'reload schema';
commit;
