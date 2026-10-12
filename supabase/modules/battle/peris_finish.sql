create or replace function public.peris_finish(p_bid bigint,p_winner text,p_reason text) returns void
language plpgsql security definer set search_path='' as $$
declare b public.battles%rowtype;ai integer;di integer;asur integer;dsur integer;r jsonb;loot jsonb:='{"wood":0,"stone":0,"food":0,"gold":0}';tier integer;u uuid;name text;a public.armies%rowtype;s public.settlements%rowtype;winner uuid;home jsonb;camp public.peris_camps%rowtype;stock jsonb;remaining jsonb;carry numeric;take numeric;key text;delivered jsonb;overflow jsonb;
begin
 select * into b from public.battles where id=p_bid for update;if b.id is null or b.status='resolved' then return;end if;
 if b.raid_city_id is not null then perform public.peris_finish_city_raid(p_bid,p_winner,p_reason);return;end if;
 select coalesce(sum(initial_soldiers)filter(where side='attacker'),0),coalesce(sum(initial_soldiers)filter(where side='defender'),0),
 coalesce(sum(soldiers)filter(where side='attacker'),0),coalesce(sum(soldiers)filter(where side='defender'),0) into ai,di,asur,dsur from public.battle_formations where battle_id=b.id;
 winner:=case p_winner when 'attacker' then b.attacker_owner_id when 'defender' then b.defender_owner_id else null end;
 -- A due colony takes the shared land lock before player locks, matching founding commands.
 if exists(select 1 from public.peris_settler_expeditions where owner_id in(b.attacker_owner_id,b.defender_owner_id)and status='travelling'and arrival_at<=now())then perform pg_advisory_xact_lock(204200);end if;
 -- Acquire both player locks in a stable order, even when two battles finish concurrently.
 perform 1 from public.players where id in(b.attacker_owner_id,b.defender_owner_id) order by id for update;
 select * into camp from public.peris_camps where id=b.camp_id;
 if b.mode='pve' and p_winner='attacker' and not camp.bandit then
 tier:=camp.tier;
 loot:=jsonb_build_object('wood',180*tier,'stone',140*tier,'food',220*tier,'gold',60*tier);
 insert into public.peris_progress(owner_id,camp_id,defeated,available_at) values(b.attacker_owner_id,b.camp_id,1,now()+interval '2 minutes')
 on conflict(owner_id,camp_id)do update set defeated=peris_progress.defeated+1,available_at=excluded.available_at;
 end if;
 if camp.bandit then
  tier:=camp.tier;
  perform public.peris_camp_accrue(camp.id);
  select resources into stock from public.peris_camp_stock where camp_id=camp.id for update;
  if p_winner='attacker'then
   select coalesce(sum(f.soldiers*c.carry),0)into carry from public.battle_formations f join public.peris_unit_catalog c on c.unit=coalesce(f.recruit_unit,f.unit_type)where f.battle_id=b.id and f.side='attacker';
   loot:=public.peris_take_camp_loot(stock,carry);
   foreach key in array array['wood','stone','food','gold']loop stock:=jsonb_set(stock,array[key],to_jsonb((stock->>key)::numeric-(loot->>key)::numeric));end loop;
  end if;
  update public.peris_camp_stock set resources=stock,engaged_battle_id=null,next_recruit_at=now()+make_interval(secs=>60+floor(random()*241)::integer)where camp_id=camp.id;
  update public.peris_camps set
   infantry=coalesce((select sum(soldiers)from public.battle_formations where battle_id=b.id and side='defender'and unit_type='infantry'),0),
   archers=coalesce((select sum(soldiers)from public.battle_formations where battle_id=b.id and side='defender'and unit_type='archers'),0),
   cavalry=coalesce((select sum(soldiers)from public.battle_formations where battle_id=b.id and side='defender'and unit_type='cavalry'),0)where id=camp.id;
 end if;
 r:=jsonb_build_object('attacker_initial',ai,'defender_initial',di,'attacker_survivors',asur,'defender_survivors',dsur,'attacker_losses',ai-asur,'defender_losses',di-dsur,'loot',loot,'duration',round(b.elapsed),'reason',p_reason);
 r:=r||jsonb_build_object('attacker_roster',(select public.peris_roster(coalesce(jsonb_object_agg(unit,sum_initial),'{}'::jsonb))from(select coalesce(recruit_unit,unit_type)as unit,sum(initial_soldiers)as sum_initial from public.battle_formations where battle_id=b.id and side='attacker'group by coalesce(recruit_unit,unit_type))q),
  'attacker_survivor_roster',(select public.peris_roster(coalesce(jsonb_object_agg(unit,sum_remaining),'{}'::jsonb))from(select coalesce(recruit_unit,unit_type)as unit,sum(soldiers)as sum_remaining from public.battle_formations where battle_id=b.id and side='attacker'group by coalesce(recruit_unit,unit_type))q),
  'defender_roster',(select public.peris_roster(coalesce(jsonb_object_agg(unit,sum_initial),'{}'::jsonb))from(select coalesce(recruit_unit,unit_type)as unit,sum(initial_soldiers)as sum_initial from public.battle_formations where battle_id=b.id and side='defender'group by coalesce(recruit_unit,unit_type))q),
  'defender_survivor_roster',(select public.peris_roster(coalesce(jsonb_object_agg(unit,sum_remaining),'{}'::jsonb))from(select coalesce(recruit_unit,unit_type)as unit,sum(soldiers)as sum_remaining from public.battle_formations where battle_id=b.id and side='defender'group by coalesce(recruit_unit,unit_type))q),
  'defender_faction',coalesce(b.defender_faction,camp.faction),
  'attacker_faction',(select s0.faction from public.armies a0 join public.settlements s0 on s0.id=a0.home_settlement_id where a0.id=b.attacker_army_id));
 select coalesce(sum(f.soldiers*c.carry),0)into carry from public.battle_formations f join public.peris_unit_catalog c on c.unit=coalesce(f.recruit_unit,f.unit_type)where f.battle_id=b.id and f.side='attacker';
 r:=r||jsonb_build_object('replacement_cost',public.peris_roster_loss_cost(r->'attacker_roster',r->'attacker_survivor_roster'),'carrying_capacity',carry);
 if (loot->>'wood')::numeric+(loot->>'stone')::numeric+(loot->>'food')::numeric+(loot->>'gold')::numeric=0 then r:=r||jsonb_build_object('estimated_profit',public.peris_resource_difference(loot,r->'replacement_cost'));end if;
 update public.battles set status='resolved' ,phase='finished',winner_side=p_winner,winner_owner_id=winner,ended_at=now(),result=r where id=b.id;
 for u in select id from public.players where id in(b.attacker_owner_id,b.defender_owner_id) order by id loop
 perform public.peris_settle(u);
 select * into a from public.armies where id=case when u=b.attacker_owner_id then b.attacker_army_id else b.defender_army_id end;
 select * into s from public.settlements where id=a.home_settlement_id;
 home:=public.peris_home_army_position(s.x,s.y);
 select public.peris_roster(coalesce(jsonb_object_agg(unit_name,survivors),'{}'))into remaining from(select coalesce(recruit_unit,unit_type)as unit_name,sum(soldiers)as survivors from public.battle_formations where battle_id=b.id and owner_id=u group by coalesce(recruit_unit,unit_type))q;
 perform public.peris_write_roster(a.id,public.peris_roster_add(remaining,coalesce(a.raid_reserve,'{}')));
 update public.armies a0 set
 status='idle',raid_target_id=null,raid_reserve=null,march_sent_at=null,march_cancel_until=null,
 start_x=case when a.march_origin is null then (home->>'x')::integer else a.target_x end,start_y=case when a.march_origin is null then (home->>'y')::integer else a.target_y end,
 target_x=case when a.march_origin is null then (home->>'x')::integer else a.target_x end,target_y=case when a.march_origin is null then (home->>'y')::integer else a.target_y end,
 arrival_at=now(),departure_at=now(),updated_at=now() where id=a.id;
 if camp.bandit and u=b.attacker_owner_id then update public.armies set carried_loot=loot,loot_report_id=b.id where id=a.id;end if;
 if not public.peris_return_raid(a.id)then update public.armies set march_path=null,march_distance=null,march_returning=false where id=a.id;end if;
 if u=winner then update public.players set victories=victories+1,prestige=prestige+coalesce(tier,1)*25 where id=u;end if;
 if u=b.attacker_owner_id and b.mode='pve' and p_winner='attacker' and not camp.bandit then
 delivered:='{}';overflow:='{}';
 foreach key in array array['wood','stone','food','gold']loop
  take:=least((loot->>key)::numeric,greatest(0,case when key='food'then s.food_capacity else s.capacity end-(to_jsonb(s)->>key)::numeric));
  delivered:=delivered||jsonb_build_object(key,take);overflow:=overflow||jsonb_build_object(key,(loot->>key)::numeric-take);
 end loop;
 r:=r||jsonb_build_object('delivered',delivered,'overflow',overflow,'delivered_at',now(),'estimated_profit',public.peris_resource_difference(delivered,r->'replacement_cost'));
 update public.settlements set wood=least(capacity,wood+(loot->>'wood')::integer),stone=least(capacity,stone+(loot->>'stone')::integer),
 food=least(food_capacity,food+(loot->>'food')::integer),gold=least(capacity,gold+(loot->>'gold')::integer)where id=s.id;
 end if;
 if b.mode='pve' and u=b.attacker_owner_id then
  r:=r||jsonb_build_object('hero_reward',public.peris_battle_hero_reward(a.id,(di-dsur)*2+case when u=winner then 50 else 20 end,case when u=winner then b.camp_id else null end,b.id));
  update public.battles set result=r where id=b.id;
 else
  perform public.peris_hero_reward(a.id,case when u=b.attacker_owner_id then (di-dsur)*2 else(ai-asur)*2 end+case when u=winner then 50 else 20 end,null);
 end if;
 name:=case when b.mode='pve' then b.enemy_name else 'Duel against '||coalesce((select display_name from public.players where id=case when u=b.attacker_owner_id then b.defender_owner_id else b.attacker_owner_id end),'rival') end;
 insert into public.peris_reports(owner_id,battle_id,title,won,result,camp_id,farm_list_id)values(u,b.id,name,coalesce(u=winner,false),r,b.camp_id,a.farm_list_id)on conflict(owner_id,battle_id)do nothing;
 if camp.bandit and u=b.attacker_owner_id and not (select march_returning from public.armies where id=a.id)then perform public.peris_deliver_loot(a.id);end if;
 end loop;
end $$;

