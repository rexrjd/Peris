create or replace function public.peris_tick(p_battle_id bigint) returns jsonb language plpgsql security definer set search_path='' as $$
declare u uuid:=auth.uid();b public.battles%rowtype;f public.battle_formations%rowtype;t public.battle_formations%rowtype;
 remain numeric;dt numeric;dx numeric;dy numeric;distance numeric;speed numeric;reach numeric;move_step numeric;direction numeric;turn numeric;
 gf jsonb;gt jsonb;pending jsonb;entry jsonb;pair record;rate numeric;flank numeric;charge numeric;matchup numeric;stance_mult numeric;brace numeric;cover numeric;elevation numeric;melee_arc numeric;defence numeric;difficulty_mult numeric;relative numeric;damage numeric;cas integer;mor_loss numeric;alive_a integer;alive_d integer;strength_a integer;strength_d integer;
begin
 select * into b from public.battles where id=p_battle_id for update;
 if u is null or b.id is null or (u is distinct from b.attacker_owner_id and u is distinct from b.defender_owner_id) then raise exception 'Not your battle';end if;
 if b.status<>'active' or b.phase<>'combat' then return jsonb_build_object('ok',true);end if;
 remain:=least(2,greatest(0,extract(epoch from(now()-b.last_tick_at))));
 if remain<0.15 then return jsonb_build_object('ok',true);end if;
 update public.battles set last_tick_at=now() where id=b.id;
 while remain>0 loop
 dt:=least(0.1,remain);remain:=remain-dt;b.elapsed:=b.elapsed+dt;
 -- NPCs choose targets; archers pull away from melee and cavalry favours bowmen.
 if b.mode='pve' and floor(b.elapsed*2)<>floor((b.elapsed-dt)*2) then
 for f in select * from public.battle_formations where battle_id=b.id and owner_id is null and soldiers>0 and status<>'routed' order by id loop
 select * into t from public.battle_formations where battle_id=b.id and side<>f.side and soldiers>0 and status<>'routed'
 order by case when f.unit_type='cavalry' and b.difficulty<>'easy' and unit_type='archers' then 0 else 1 end,power(x-f.x,2)+power(y-f.y,2),id limit 1;
 if t.id is null then continue;end if;
 distance:=sqrt(power(t.x-f.x,2)+power(t.y-f.y,2));
 if f.unit_type='archers' and distance<80 and b.difficulty<>'easy' then
 update public.battle_formations set target_formation_id=null,target_x=greatest(50,least(1150,f.x+(f.x-t.x)*1.2)),target_y=greatest(50,least(650,f.y+(f.y-t.y)*1.2)),status='moving' where id=f.id;
 elsif f.target_formation_id is distinct from t.id then
 update public.battle_formations set target_formation_id=t.id,status='moving',running=unit_type='cavalry',
 charge_ready=unit_type='cavalry' and distance>140 and stamina>35 where id=f.id;
 end if;
 end loop;
 end if;
 -- Movement / self-defence pass.
 for f in select * from public.battle_formations where battle_id=b.id and soldiers>0 order by id for update loop
 if f.status='routed' then update public.battle_formations set x=greatest(12,least(1188,x+case when side='attacker' then -1 else 1 end*64*dt))where id=f.id;continue;end if;
 if f.target_formation_id is not null then
 select * into t from public.battle_formations where id=f.target_formation_id and soldiers>0 and status<>'routed';
 if t.id is null then f.target_formation_id:=null;f.target_x:=f.x;f.target_y:=f.y;f.charge_ready:=false;end if;
 end if;
 reach:=case f.unit_type when 'archers' then 220 when 'cavalry' then 50 else 44 end;
 if f.target_formation_id is null then
 select * into t from public.battle_formations where battle_id=b.id and side<>f.side and soldiers>0 and status<>'routed'
 and sqrt(power(x-f.x,2)+power(y-f.y,2))<case when f.unit_type='archers' and not f.fire_at_will then 0 else reach end
 order by power(x-f.x,2)+power(y-f.y,2),id limit 1;
 if t.id is not null then f.target_formation_id:=t.id;f.charge_ready:=false;end if;
 end if;
 if f.target_formation_id is not null then select * into t from public.battle_formations where id=f.target_formation_id;f.target_x:=t.x;f.target_y:=t.y;else reach:=0;end if;
 dx:=f.target_x-f.x;dy:=f.target_y-f.y;distance:=sqrt(dx*dx+dy*dy);gf:=public.peris_ground(b.terrain,f.x,f.y);
 if distance>reach+2 and not(f.target_formation_id is not null and f.stance='guard') then
 direction:=degrees(atan2(dy,dx));turn:=direction-f.facing;turn:=turn-360*floor((turn+180)/360);f.facing:=f.facing+greatest(-150*dt,least(150*dt,turn));
 speed:=(case f.unit_type when 'cavalry' then 76 when 'archers' then 34 else 40 end)*(gf->>'speed')::numeric*
 (case when f.unit_type='cavalry' and gf->>'kind'='Forest' then 0.65 else 1 end)*(case when f.running and f.stamina>8 then 1.45 else 1 end)*(case when f.stamina<15 then 0.75 else 1 end);
 move_step:=least(speed*dt,distance-reach);f.x:=greatest(25,least(1175,f.x+dx/distance*move_step));f.y:=greatest(30,least(670,f.y+dy/distance*move_step));f.status:='moving';
 f.stamina:=greatest(0,least(100,f.stamina-case when f.running then 1.9 else 0.12 end*dt));
 else
 f.status:=case when f.target_formation_id is null then 'idle' else 'engaged' end;
 f.stamina:=greatest(0,least(100,f.stamina+case when f.target_formation_id is null then 2 else -0.4 end*dt));
 if f.target_formation_id is null and f.target_facing is not null then
 turn:=f.target_facing-f.facing;turn:=turn-360*floor((turn+180)/360);f.facing:=f.facing+greatest(-150*dt,least(150*dt,turn));end if;
 if f.target_formation_id is null and f.morale<90 then f.morale:=least(100,f.morale+0.7*dt);end if;
 end if;
 update public.battle_formations set x=f.x,y=f.y,facing=f.facing,target_x=f.target_x,target_y=f.target_y,target_formation_id=f.target_formation_id,status=f.status,stamina=f.stamina,morale=f.morale,charge_ready=f.charge_ready,updated_at=now() where id=f.id;
 end loop;
 -- Accumulate attacks into a map, then apply both armies' losses together.
 pending:='{}'::jsonb;
 for f in select * from public.battle_formations where battle_id=b.id and soldiers>0 and status<>'routed' and target_formation_id is not null order by id loop
 select * into t from public.battle_formations where id=f.target_formation_id;if t.id is null or t.status='routed' or t.soldiers=0 then continue;end if;
 dx:=t.x-f.x;dy:=t.y-f.y;distance:=sqrt(dx*dx+dy*dy);reach:=case f.unit_type when 'archers' then 220 when 'cavalry' then 50 else 44 end;
 if distance>reach+4 then continue;end if;
 gf:=public.peris_ground(b.terrain,f.x,f.y);gt:=public.peris_ground(b.terrain,t.x,t.y);
 relative:=degrees(atan2(f.y-t.y,f.x-t.x))-t.facing;relative:=abs(relative-360*floor((relative+180)/360));
 flank:=case when f.unit_type='archers' and distance>65 then 1 when relative>135 then 1.65 when relative>65 then 1.28 else 1 end;
 charge:=case when f.charge_ready and f.unit_type='cavalry' and gf->>'kind'<>'Forest' then 2.4 else 1 end;
 matchup:=case when f.unit_type='cavalry' then case when t.unit_type='archers' then 1.65 else 0.9 end when f.unit_type='infantry' then case when t.unit_type='cavalry' then 1.25 else 1 end else case when t.unit_type='cavalry' then 0.75 else 1 end end;
 stance_mult:=case f.stance when 'aggressive' then 1.22 when 'guard' then 0.9 else 1 end;
 brace:=case when t.stance='guard' and t.unit_type='infantry' and relative<65 and f.unit_type='cavalry' then 0.5 else 1 end;
 defence:=case t.stance when 'guard' then 0.8 when 'aggressive' then 1.15 else 1 end;
 cover:=case when f.unit_type='archers' and distance>65 then (gt->>'cover')::numeric else 1 end;
 elevation:=case when f.unit_type='archers' and distance>65 and (gf->>'height')::numeric>(gt->>'height')::numeric then 1.25 when f.unit_type='archers' and distance>65 and (gf->>'height')::numeric<(gt->>'height')::numeric then 0.8 else 1 end;
 melee_arc:=case when f.unit_type='archers' and distance<=65 then 0.28 else 1 end;
 difficulty_mult:=case when f.owner_id is null then case b.difficulty when 'hard' then 1.13 when 'easy' then 0.8 else 1 end else 1 end;
 rate:=case f.unit_type when 'infantry' then 0.020 when 'archers' then 0.012 else 0.031 end;
 damage:=f.damage_pool+f.soldiers*rate*matchup*stance_mult*defence*brace*flank*charge*cover*elevation*melee_arc*difficulty_mult*(0.55+f.stamina/220)*dt;
 if charge>1 then damage:=damage+f.soldiers*0.06*brace*flank;end if;
 cas:=least(greatest(0,t.soldiers-coalesce((pending->t.id::text->>'loss')::integer,0)),floor(damage)::integer);mor_loss:=cas::numeric/greatest(1,t.initial_soldiers)*85+case when flank>1 then cas*1.2 else 0 end+case when charge>1 then 12 else 0 end;
 update public.battle_formations set damage_pool=damage-cas,kills=kills+cas,charge_ready=case when charge>1 then false else charge_ready end,
 stamina=case when charge>1 then greatest(0,stamina-12) else stamina end where id=f.id;
 entry:=coalesce(pending->t.id::text,'{"loss":0,"morale":0}'::jsonb);
 pending:=jsonb_set(pending,array[t.id::text],jsonb_build_object('loss',(entry->>'loss')::integer+cas,'morale',(entry->>'morale')::numeric+mor_loss),true);
 end loop;
 for pair in select key,value from jsonb_each(pending) loop
 update public.battle_formations set soldiers=greatest(0,soldiers-(pair.value->>'loss')::integer),morale=greatest(0,morale-(pair.value->>'morale')::numeric) where id=pair.key::bigint;
 update public.battle_formations set status='routed',target_formation_id=null where id=pair.key::bigint and (soldiers=0 or morale<18);
 end loop;
 select count(*)filter(where side='attacker'),count(*)filter(where side='defender'),coalesce(sum(soldiers)filter(where side='attacker'),0),coalesce(sum(soldiers)filter(where side='defender'),0)
 into alive_a,alive_d,strength_a,strength_d from public.battle_formations where battle_id=b.id and soldiers>0 and status<>'routed';
 update public.battles set elapsed=b.elapsed where id=b.id;
 if alive_a=0 or alive_d=0 then perform public.peris_finish(b.id,case when alive_a>0 then 'attacker' when alive_d>0 then 'defender' else 'draw' end,'Army routed');exit;end if;
 if b.elapsed>=900 then perform public.peris_finish(b.id,case when strength_a>strength_d then 'attacker' when strength_d>strength_a then 'defender' else 'draw' end,'Time limit');exit;end if;
 end loop;
 return jsonb_build_object('ok',true);
end $$;

