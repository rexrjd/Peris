create or replace function public.peris_tick(p_battle_id bigint)returns jsonb language plpgsql security definer set search_path='' as $$
declare u uuid:=auth.uid();b public.battles%rowtype;f public.battle_formations%rowtype;t public.battle_formations%rowtype;threat public.battle_formations%rowtype;
 bw numeric:=1200*sqrt(5);bh numeric:=700*sqrt(5);remain numeric;processed numeric;dt numeric;dx numeric;dy numeric;distance numeric;speed numeric;reach numeric;move_step numeric;direction numeric;turn numeric;contact numeric;minimum numeric;push numeric;interval_sec numeric;ranged boolean;
 gf jsonb;gt jsonb;snapshot jsonb;positions jsonb;correction jsonb;pending jsonb;entry jsonb;pair record;rate numeric;flank numeric;charge numeric;matchup numeric;stance_mult numeric;brace numeric;cover numeric;elevation numeric;melee_arc numeric;defence numeric;difficulty_mult numeric;relative numeric;damage numeric;cas integer;mor_loss numeric;alive_a integer;alive_d integer;strength_a integer;strength_d integer;own_side text;average numeric;
begin
 select * into b from public.battles where id=p_battle_id for update;
 if u is null or b.id is null or(u is distinct from b.attacker_owner_id and u is distinct from b.defender_owner_id)then raise exception 'Not your battle';end if;
 if b.status<>'active'then return jsonb_build_object('ok',true);end if;
 if b.phase='deployment'then b.phase:='combat';update public.battles set phase='combat',attacker_ready=true,defender_ready=true where id=b.id;end if;
 remain:=least(10,greatest(0,extract(epoch from(now()-b.last_tick_at))));
 if remain<.15 then return jsonb_build_object('ok',true);end if;
 processed:=remain;update public.battles set last_tick_at=last_tick_at+make_interval(secs=>processed::double precision)where id=b.id;
 while remain>0 loop
 dt:=least(.1,remain);remain:=remain-dt;b.elapsed:=b.elapsed+dt;
 if b.elapsed<=dt or floor(b.elapsed*2)<>floor((b.elapsed-dt)*2)then perform public.peris_auto_orders(b.id);end if;
 select jsonb_object_agg(id::text,to_jsonb(q))into snapshot from(select * from public.battle_formations where battle_id=b.id)q;
 positions:='{}';
 -- Plan both sides from one immutable position snapshot, then commit together.
 for f in select * from public.battle_formations where battle_id=b.id and soldiers>0 order by id loop
 if f.status='routed'then f.x:=greatest(12,least(bw-12,f.x+case when f.side='attacker'then -1 else 1 end*64*dt));f.facing:=case when f.side='attacker'then 180 else 0 end;
 else
 t:=jsonb_populate_record(null::public.battle_formations,snapshot->f.target_formation_id::text);
 if t.id is null or t.soldiers<=0 or t.status='routed'then f.target_formation_id:=null;f.target_x:=f.x;f.target_y:=f.y;f.status:='idle';
 else
 dx:=t.x-f.x;dy:=t.y-f.y;distance:=sqrt(dx*dx+dy*dy);contact:=public.peris_contact(f,t);
 f.target_x:=t.x;f.target_y:=t.y;reach:=case when f.unit_type='archers'then 208 else contact end;
 select * into threat from jsonb_populate_recordset(null::public.battle_formations,(select jsonb_agg(value)from jsonb_each(snapshot)))e where e.side<>f.side and e.soldiers>0 and e.status<>'routed'and e.unit_type<>'archers'order by power(e.x-f.x,2)+power(e.y-f.y,2),e.id limit 1;
 if f.unit_type='archers'and threat.id is not null and sqrt(power(threat.x-f.x,2)+power(threat.y-f.y,2))<public.peris_contact(f,threat)+65 then
 distance:=greatest(1,sqrt(power(threat.x-f.x,2)+power(threat.y-f.y,2)));
 f.target_x:=greatest(40,least(bw-40,f.x+(f.x-threat.x)/distance*85));f.target_y:=greatest(45,least(bh-45,f.y+(f.y-threat.y)/distance*85));
 if sqrt(power(f.target_x-f.x,2)+power(f.target_y-f.y,2))>12 then reach:=0;else f.target_x:=t.x;f.target_y:=t.y;reach:=contact;end if;
 elsif f.unit_type='cavalry'and distance>240 and abs(f.y-t.y)<85 then
 f.target_y:=greatest(65,least(bh-65,t.y+case when f.y<bh/2 then -120 else 120 end));f.target_x:=t.x+case when f.side='attacker'then -145 else 145 end;reach:=0;
 end if;
 dx:=f.target_x-f.x;dy:=f.target_y-f.y;distance:=sqrt(dx*dx+dy*dy);
 direction:=degrees(atan2(case when distance>reach+2 then dy else t.y-f.y end,case when distance>reach+2 then dx else t.x-f.x end));
 turn:=direction-f.facing;turn:=turn-360*floor((turn+180)/360);f.facing:=f.facing+greatest(-120*dt,least(120*dt,turn));
 gf:=public.peris_ground(b.terrain,f.x,f.y);
 if distance>reach+2 then
 turn:=direction-f.facing;turn:=abs(turn-360*floor((turn+180)/360));
 speed:=(case f.unit_type when 'cavalry'then 76 when 'archers'then 34 else 40 end)*f.magic_speed*(gf->>'speed')::numeric*(case when f.unit_type='cavalry'and gf->>'kind'='Forest'then .65 else 1 end)*(case when f.running and f.stamina>8 then 1.35 else 1 end)*(case when f.stamina<15 then .75 else 1 end)*(case when turn>75 then .25 when turn>40 then .65 else 1 end);
 move_step:=least(speed*dt,greatest(0,distance-reach));f.x:=greatest(35,least(bw-35,f.x+dx/distance*move_step));f.y:=greatest(45,least(bh-45,f.y+dy/distance*move_step));f.status:='moving';f.stamina:=greatest(0,least(100,f.stamina-case when f.running then 1.4 else .1 end*dt));
 if f.unit_type='cavalry'and f.running and gf->>'kind'<>'Forest'and turn<40 then f.charge_distance:=f.charge_distance+move_step;if f.charge_distance>=100 and f.stamina>35 then f.charge_ready:=true;end if;end if;
 else f.status:='engaged';f.running:=false;f.stamina:=greatest(0,least(100,f.stamina-case when f.unit_type='archers'then .12 else .3 end*dt));end if;
 end if;end if;
 positions:=jsonb_set(positions,array[f.id::text],to_jsonb(f),true);
 end loop;
 for pair in select key,value from jsonb_each(positions)loop
 f:=jsonb_populate_record(null::public.battle_formations,pair.value);
 update public.battle_formations set x=f.x,y=f.y,facing=f.facing,target_x=f.target_x,target_y=f.target_y,target_formation_id=f.target_formation_id,status=f.status,running=f.running,stamina=f.stamina,charge_ready=f.charge_ready,charge_distance=f.charge_distance,updated_at=now()where id=f.id;
 end loop;
 -- Symmetric soft separation based on the actual regiment footprint.
 correction:='{}';
 for f in select * from public.battle_formations where battle_id=b.id and soldiers>0 and status<>'routed'order by id loop
 for t in select * from public.battle_formations where battle_id=b.id and id>f.id and soldiers>0 and status<>'routed'order by id loop
 dx:=t.x-f.x;dy:=t.y-f.y;distance:=sqrt(dx*dx+dy*dy);if distance<.001 then dx:=0;dy:=1;distance:=1;end if;
 minimum:=public.peris_extent(f,dx,dy)+public.peris_extent(t,-dx,-dy)+case when f.side=t.side then 10 else 4 end;
 if distance>=minimum then continue;end if;push:=least((minimum-distance)*.5,50*dt);dx:=dx/distance*push;dy:=dy/distance*push;
 entry:=coalesce(correction->f.id::text,'{"x":0,"y":0}'::jsonb);correction:=jsonb_set(correction,array[f.id::text],jsonb_build_object('x',(entry->>'x')::numeric-dx,'y',(entry->>'y')::numeric-dy),true);
 entry:=coalesce(correction->t.id::text,'{"x":0,"y":0}'::jsonb);correction:=jsonb_set(correction,array[t.id::text],jsonb_build_object('x',(entry->>'x')::numeric+dx,'y',(entry->>'y')::numeric+dy),true);
 end loop;end loop;
 for pair in select key,value from jsonb_each(correction)loop update public.battle_formations set x=greatest(35,least(bw-35,x+(pair.value->>'x')::numeric)),y=greatest(45,least(bh-45,y+(pair.value->>'y')::numeric))where id=pair.key::bigint;end loop;
 -- Accumulate attacks into a map, then apply both armies' losses together.
 pending:='{}'::jsonb;
 for f in select * from public.battle_formations where battle_id=b.id and soldiers>0 and status<>'routed' and target_formation_id is not null order by id loop
 select * into t from public.battle_formations where id=f.target_formation_id;if t.id is null or t.status='routed' or t.soldiers=0 then continue;end if;
 dx:=t.x-f.x;dy:=t.y-f.y;distance:=sqrt(dx*dx+dy*dy);reach:=case when f.unit_type='archers'then 220 else public.peris_contact(f,t)end;
 if distance>reach+4 or b.elapsed<f.attack_ready_at then continue;end if;
 ranged:=f.unit_type='archers'and distance>public.peris_contact(f,t)+20;
 if ranged and f.status='moving'then continue;end if;
 direction:=degrees(atan2(t.y-f.y,t.x-f.x))-f.facing;direction:=abs(direction-360*floor((direction+180)/360));if direction>65 then continue;end if;
 interval_sec:=case when ranged then 2.5 when f.unit_type='cavalry'then 1.4 else 1.2 end;
 if f.damage_target_id is distinct from t.id then f.damage_pool:=0;end if;
 gf:=public.peris_ground(b.terrain,f.x,f.y);gt:=public.peris_ground(b.terrain,t.x,t.y);
 relative:=degrees(atan2(f.y-t.y,f.x-t.x))-t.facing;relative:=abs(relative-360*floor((relative+180)/360));
 flank:=case when ranged then 1 when relative>135 then 1.65 when relative>65 then 1.28 else 1 end;
 charge:=case when f.charge_ready and f.unit_type='cavalry' and gf->>'kind'<>'Forest' then 2.4 else 1 end;
 matchup:=case when f.unit_type='cavalry' then case when t.unit_type='archers' then 1.65 else 0.9 end when f.unit_type='infantry' then case when t.unit_type='cavalry' then 1.25 else 1 end else case when t.unit_type='cavalry' then 0.75 else 1 end end;
 stance_mult:=case f.stance when 'aggressive' then 1.22 when 'guard' then 0.9 else 1 end;
 brace:=case when t.stance='guard' and t.unit_type='infantry' and relative<65 and f.unit_type='cavalry' then 0.5 else 1 end;
 defence:=case t.stance when 'guard' then 0.8 when 'aggressive' then 1.15 else 1 end;
 cover:=case when ranged then (gt->>'cover')::numeric else 1 end;
 elevation:=case when ranged and (gf->>'height')::numeric>(gt->>'height')::numeric then 1.25 when ranged and (gf->>'height')::numeric<(gt->>'height')::numeric then 0.8 else 1 end;
 melee_arc:=case when f.unit_type='archers'and not ranged then 0.28 else 1 end;
 difficulty_mult:=1;
 rate:=case f.unit_type when 'infantry' then 0.020 when 'archers' then 0.012 else 0.031 end;
 damage:=f.damage_pool+f.soldiers*f.attack_multiplier*f.magic_attack*(1-t.magic_defence)*rate*matchup*stance_mult*defence*brace*flank*charge*cover*elevation*melee_arc*difficulty_mult*(0.55+f.stamina/220)*interval_sec/t.defence_multiplier;
 if charge>1 then damage:=damage+f.soldiers*0.06*brace*flank*(1-t.magic_defence)/t.defence_multiplier;end if;
 cas:=least(greatest(0,t.soldiers-coalesce((pending->t.id::text->>'loss')::integer,0)),floor(damage)::integer);mor_loss:=cas::numeric/greatest(1,t.initial_soldiers)*125+case when flank>1 then cas::numeric/greatest(1,t.initial_soldiers)*35 else 0 end+case when charge>1 then 8 else 0 end;
 update public.battle_formations set damage_pool=mod(damage-cas,1),damage_target_id=t.id,attack_ready_at=b.elapsed+interval_sec,kills=kills+cas,charge_distance=case when charge>1 then 0 else charge_distance end,charge_ready=case when charge>1 then false else charge_ready end,
 stamina=case when charge>1 then greatest(0,stamina-12) else stamina end where id=f.id;
 entry:=coalesce(pending->t.id::text,'{"loss":0,"morale":0}'::jsonb);
 pending:=jsonb_set(pending,array[t.id::text],jsonb_build_object('loss',(entry->>'loss')::integer+cas,'morale',(entry->>'morale')::numeric+mor_loss),true);
 end loop;
 for pair in select key,value from jsonb_each(pending) loop
 update public.battle_formations set soldiers=greatest(0,soldiers-(pair.value->>'loss')::integer),morale=greatest(0,morale-(pair.value->>'morale')::numeric) where id=pair.key::bigint;
 update public.battle_formations set status='routed',target_formation_id=null where id=pair.key::bigint and (soldiers=0 or morale<18);
 end loop;

 -- One automatic rally per side, with morale weighted by remaining manpower.
 foreach own_side in array array['attacker','defender']loop
 if (case when own_side='attacker'then b.rally_attacker else b.rally_defender end) then continue;end if;
 select sum(morale*soldiers)/nullif(sum(soldiers),0)into average from public.battle_formations where battle_id=b.id and side=own_side and soldiers>0;
 if average<42 then
 update public.battle_formations set morale=least(100,morale+25),status=case when status='routed'then 'idle'else status end,target_x=case when status='routed'then x else target_x end,target_y=case when status='routed'then y else target_y end where battle_id=b.id and side=own_side and soldiers>0;
 if own_side='attacker'then b.rally_attacker:=true;else b.rally_defender:=true;end if;
 end if;
 end loop;
 update public.battles set elapsed=b.elapsed,rally_attacker=b.rally_attacker,rally_defender=b.rally_defender where id=b.id;
 perform public.peris_auto_magic(b.id);select * into b from public.battles where id=b.id;
 if b.status<>'active'then exit;end if;
 select count(*)filter(where side='attacker'),count(*)filter(where side='defender'),coalesce(sum(soldiers)filter(where side='attacker'),0),coalesce(sum(soldiers)filter(where side='defender'),0)
 into alive_a,alive_d,strength_a,strength_d from public.battle_formations where battle_id=b.id and soldiers>0 and status<>'routed';
 if alive_a=0 or alive_d=0 then perform public.peris_finish(b.id,case when alive_a>0 then 'attacker'when alive_d>0 then 'defender'else 'draw'end,'Army routed');exit;end if;
 if b.elapsed>=900 then perform public.peris_finish(b.id,case when strength_a>strength_d then 'attacker'when strength_d>strength_a then 'defender'else 'draw'end,'Time limit');exit;end if;
 end loop;
 return jsonb_build_object('ok',true);
end $$;
