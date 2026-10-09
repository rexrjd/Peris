create or replace function public.peris_finish(p_bid bigint,p_winner text,p_reason text) returns void
language plpgsql security definer set search_path='' as $$
declare b public.battles%rowtype;ai integer;di integer;asur integer;dsur integer;r jsonb;loot jsonb:='{"wood":0,"stone":0,"food":0,"gold":0}';tier integer;u uuid;name text;a public.armies%rowtype;s public.settlements%rowtype;winner uuid;
begin
 select * into b from public.battles where id=p_bid for update;if b.id is null or b.status='resolved' then return;end if;
 select coalesce(sum(initial_soldiers)filter(where side='attacker'),0),coalesce(sum(initial_soldiers)filter(where side='defender'),0),
 coalesce(sum(soldiers)filter(where side='attacker'),0),coalesce(sum(soldiers)filter(where side='defender'),0) into ai,di,asur,dsur from public.battle_formations where battle_id=b.id;
 winner:=case p_winner when 'attacker' then b.attacker_owner_id when 'defender' then b.defender_owner_id else null end;
 -- A due colony takes the shared land lock before player locks, matching founding commands.
 if exists(select 1 from public.peris_settler_expeditions where owner_id in(b.attacker_owner_id,b.defender_owner_id)and status='travelling'and arrival_at<=now())then perform pg_advisory_xact_lock(204200);end if;
 -- Acquire both player locks in a stable order, even when two battles finish concurrently.
 perform 1 from public.players where id in(b.attacker_owner_id,b.defender_owner_id) order by id for update;
 if b.mode='pve' and p_winner='attacker' then
 select c.tier into tier from public.peris_camps c where id=b.camp_id;
 loot:=jsonb_build_object('wood',180*tier,'stone',140*tier,'food',220*tier,'gold',60*tier);
 insert into public.peris_progress(owner_id,camp_id,defeated,available_at) values(b.attacker_owner_id,b.camp_id,1,now()+interval '2 minutes')
 on conflict(owner_id,camp_id)do update set defeated=peris_progress.defeated+1,available_at=excluded.available_at;
 end if;
 r:=jsonb_build_object('attacker_initial',ai,'defender_initial',di,'attacker_survivors',asur,'defender_survivors',dsur,'attacker_losses',ai-asur,'defender_losses',di-dsur,'loot',loot,'duration',round(b.elapsed),'reason',p_reason);
 update public.battles set status='resolved',phase='finished',winner_side=p_winner,winner_owner_id=winner,ended_at=now(),result=r where id=b.id;
 for u in select id from public.players where id in(b.attacker_owner_id,b.defender_owner_id) order by id loop
 perform public.peris_settle(u);
 select * into a from public.armies where id=case when u=b.attacker_owner_id then b.attacker_army_id else b.defender_army_id end;
 select * into s from public.settlements where id=a.home_settlement_id;
 update public.armies a0 set
 infantry=coalesce((select sum(soldiers) from public.battle_formations where battle_id=b.id and owner_id=u and unit_type='infantry'),0),
 archers=coalesce((select sum(soldiers) from public.battle_formations where battle_id=b.id and owner_id=u and unit_type='archers'),0),
 cavalry=coalesce((select sum(soldiers) from public.battle_formations where battle_id=b.id and owner_id=u and unit_type='cavalry'),0),
 status='idle',raid_target_id=null,start_x=s.x+40,start_y=s.y+30,target_x=s.x+40,target_y=s.y+30,arrival_at=now(),departure_at=now(),updated_at=now() where id=a.id;
 if u=winner then update public.players set victories=victories+1,prestige=prestige+coalesce(tier,1)*25 where id=u;end if;
 if u=b.attacker_owner_id and b.mode='pve' and p_winner='attacker' then
 update public.settlements set wood=least(capacity,wood+(loot->>'wood')::integer),stone=least(capacity,stone+(loot->>'stone')::integer),
 food=least(food_capacity,food+(loot->>'food')::integer),gold=least(capacity,gold+(loot->>'gold')::integer)where id=s.id;
 end if;
 perform public.peris_hero_reward(a.id,case when u=b.attacker_owner_id then (di-dsur)*2 else(ai-asur)*2 end+case when u=winner then 50 else 20 end,case when u=winner and b.mode='pve'then b.camp_id else null end);
 name:=case when b.mode='pve' then b.enemy_name else 'Duel against '||coalesce((select display_name from public.players where id=case when u=b.attacker_owner_id then b.defender_owner_id else b.attacker_owner_id end),'rival') end;
 insert into public.peris_reports(owner_id,battle_id,title,won,result)values(u,b.id,name,coalesce(u=winner,false),r)on conflict(owner_id,battle_id)do nothing;
 end loop;
end $$;

