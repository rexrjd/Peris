import {PGlite} from '@electric-sql/pglite';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {findMarchPath} from '../src/features/map/domain/pathfinding';
import {homeArmyPosition} from '../src/features/map/domain/garrisons';
for(const rate of [1,10,100]){
const db=new PGlite();
const ids=['11111111-1111-4111-8111-111111111111','22222222-2222-4222-8222-222222222222','33333333-3333-4333-8333-333333333333'];
const admin=async(sql:string)=>{await db.exec('reset role');return db.exec(sql);};
const login=async(id:string)=>db.exec(`reset role;set role authenticated;select set_config('request.jwt.claim.sub','${id}',false)`);
const rpc=async(fn:string,args:unknown[]=[]) => (await db.query<{result:any}>(`select public.${fn}(${args.map((_,i)=>'$'+(i+1)).join(',')})result`,args)).rows[0].result;
const social=(command:unknown)=>rpc('peris_social_command',[crypto.randomUUID(),JSON.stringify(command)]);
const submit=(request:string,fn:string,args:unknown)=>rpc('peris_submit_command',[request,fn,JSON.stringify(args)]);
try{
 await db.exec(`create schema auth;create table auth.users(id uuid primary key);create role anon;create role authenticated;create role service_role;create function auth.uid()returns uuid language sql as $$select nullif(current_setting('request.jwt.claim.sub',true),'')::uuid$$;grant usage on schema public,auth to authenticated,anon;grant execute on function auth.uid()to authenticated,anon;create publication supabase_realtime`);
 await db.exec(await readFile('supabase/FRESH_INSTALL_V19.sql','utf8'));
 await rpc('peris_configure_test_clock',[rate]);await admin("update public.peris_world_clock set game_anchor='2030-01-01T00:00:00Z'");
 // Step event dates explicitly: a 100x short return must not finish between assertions.
 // Clock scaling itself is exercised by the separate game-clock suites.
 await admin("create or replace function public.peris_game_now()returns timestamptz language sql stable security definer set search_path='' as $$select game_anchor from public.peris_world_clock where id$$");
 for(const [i,id] of ids.entries()){await admin(`insert into auth.users values('${id}')`);await login(id);await rpc('create_player',['Support '+i]);}
 await login(ids[0]);const from=(await rpc('peris_snapshot')).settlements[0],army=(await rpc('peris_snapshot')).armies[0];
 const guild=await social({type:'create',name:'Support Guild',tag:'SUP',description:'',motd:'',focus:'balanced',recruitment:'open',crest:{color:'#547a69',sigil:'sun'}});
 await login(ids[1]);await social({type:'join',guild_id:guild.guild_id});const to=(await rpc('peris_snapshot')).settlements[0];
 // Nearby actual land keeps routing deterministic without replacing geography.
 const origin=homeArmyPosition(from);let route:ReturnType<typeof findMarchPath>=null;
 for(const [dx,dy]of [[128,0],[-128,0],[0,128],[0,-128]]){to.x=from.x+dx;to.y=from.y+dy;route=findMarchPath(origin,homeArmyPosition(to));if(route)break;}
 assert.ok(route);
 await admin(`update public.settlements set x=${to.x},y=${to.y} where id=${to.id};select public.peris_city_garrison_receive('${ids[0]}',${from.id},'{"infantry":80,"archers":10,"cavalry":0}');`);
 await login(ids[0]);const targets=await rpc('peris_guild_reinforcement_targets');assert.equal(targets.length,1);
 const args={p_source:from.id,p_target:to.id,p_troops:{infantry:12,archers:3,cavalry:0},p_path:route.path,p_army:null};
 const request=crypto.randomUUID();const sent=await submit(request,'peris_send_guild_reinforcements',args);
 assert.equal((await submit(request,'peris_send_guild_reinforcements',args)).reinforcement_id,sent.reinforcement_id);
 await assert.rejects(submit(request,'peris_send_guild_reinforcements',{...args,p_troops:{infantry:1,archers:0,cavalry:0}}),/different command/);
 let snapshot=await rpc('peris_snapshot');assert.equal(snapshot.city_garrisons[0].unit_roster.infantry,68);assert.equal(snapshot.guild_reinforcements.length,1);
 assert.equal(snapshot.guild_reinforcements[0].recipient_city_id,to.id);assert.ok(snapshot.guild_reinforcements[0].departure_at.startsWith('2030-'));
 await assert.rejects(submit(crypto.randomUUID(),'peris_send_guild_reinforcements',{...args,p_troops:{infantry:999,archers:0,cavalry:0}}),/Insufficient/);
 for(const troops of [{infantry:0},{infantry:-1},{infantry:1.5},{infantry:1001}])await assert.rejects(submit(crypto.randomUUID(),'peris_send_guild_reinforcements',{...args,p_troops:troops}));
 await admin(`update public.armies set status='moving',departure_at=public.peris_game_now(),arrival_at=public.peris_game_now()+interval '1 day'where id=${army.id}`);await login(ids[0]);
 await assert.rejects(submit(crypto.randomUUID(),'peris_send_guild_reinforcements',{...args,p_army:army.id}),/idle army/);
 await admin(`update public.armies set status='idle'where id=${army.id};insert into public.peris_orders(owner_id,army_id,settlement_id,kind,item,quantity,started_at,finish_at)values('${ids[0]}',${army.id},${from.id},'recruit','infantry',1,public.peris_game_now(),public.peris_game_now()+interval '1 day')`);await login(ids[0]);
 await assert.rejects(submit(crypto.randomUUID(),'peris_send_guild_reinforcements',{...args,p_army:army.id}),/recruitment/);
 await admin(`delete from public.peris_orders where owner_id='${ids[0]}'`);await login(ids[0]);
 const armyBefore=army.unit_roster?.infantry??army.infantry;
 await submit(crypto.randomUUID(),'peris_send_guild_reinforcements',{...args,p_army:army.id,p_troops:{infantry:2,archers:0,cavalry:0}});
 snapshot=await rpc('peris_snapshot');assert.equal(snapshot.armies[0].unit_roster.infantry,armyBefore-2);assert.equal(snapshot.city_garrisons[0].unit_roster.infantry,68);
 await login(ids[1]);assert.equal((await rpc('peris_snapshot')).guild_reinforcements.length,2);
 await assert.rejects(submit(crypto.randomUUID(),'peris_recall_guild_reinforcements',{p_id:sent.reinforcement_id}),/Only stationed/);
 await login(ids[2]);assert.deepEqual(await rpc('peris_guild_reinforcement_status'),[]);assert.deepEqual((await rpc('peris_snapshot')).guild_reinforcements,[]);
 await assert.rejects(submit(crypto.randomUUID(),'peris_send_guild_reinforcements',args),/Choose your city/);
 await admin(`update public.peris_guild_reinforcements set arrival_at=public.peris_game_now()-interval '1 second';select public.peris_game_tick(40)`);
 await login(ids[0]);assert.equal((await rpc('peris_guild_reinforcement_status'))[0].status,'stationed');
 const recallId=crypto.randomUUID();await submit(recallId,'peris_recall_guild_reinforcements',{p_id:sent.reinforcement_id});
 await submit(recallId,'peris_recall_guild_reinforcements',{p_id:sent.reinforcement_id});
 assert.equal((await rpc('peris_guild_reinforcement_status')).find((p:any)=>p.id===sent.reinforcement_id).status,'returning');
 await admin(`update public.peris_guild_reinforcements set arrival_at=public.peris_game_now()-interval '1 second'where status='returning';select public.peris_game_tick(40)`);
 await login(ids[0]);snapshot=await rpc('peris_snapshot');assert.equal(snapshot.city_garrisons[0].unit_roster.infantry,80);assert.equal(snapshot.guild_reinforcements.length,1);
 const defender=snapshot.guild_reinforcements[0];
 await admin(`update public.armies set status='idle',raid_city_id=${to.id},target_x=${to.x},target_y=${to.y} where owner_id='${ids[2]}'`);
 const attacker=(await db.query<any>(`select id from public.armies where owner_id='${ids[2]}'order by id limit 1`)).rows[0].id;
 const battle=await rpc('peris_start_city_raid',[ids[2],attacker]);assert.ok(battle);
 const capture=(await db.query<any>('select city_defenders from public.battles where id=$1',[battle])).rows[0].city_defenders;
 assert.ok(capture.some((p:any)=>p.guild_reinforcement_id===defender.id));
 await login(ids[0]);await assert.rejects(submit(crypto.randomUUID(),'peris_recall_guild_reinforcements',{p_id:defender.id}),/battle/);
 await admin(`update public.battle_formations set soldiers=greatest(0,soldiers-1)where battle_id=${battle} and side='defender';select public.peris_finish(${battle},'attacker','Guild support test')`);
 const afterBattle=(await rpc('peris_guild_reinforcement_status')).find((p:any)=>p.id===defender.id);assert.equal(afterBattle.troops.infantry,1);
 await rpc('peris_finish',[battle,'attacker','Duplicate result']);assert.equal((await rpc('peris_guild_reinforcement_status')).find((p:any)=>p.id===defender.id).troops.infantry,1);
 await login(ids[1]);await social({type:'leave'});await admin('select public.peris_game_tick(40)');await login(ids[0]);
 const returning=(await rpc('peris_guild_reinforcement_status')).find((p:any)=>p.id===defender.id);assert.equal(returning.status,'returning');assert.equal(returning.recipient_city_id,to.id);
 const upgrade=await readFile('supabase/UPGRADE_GUILD_REINFORCEMENTS.sql','utf8');await admin(upgrade);await admin(upgrade);await login(ids[0]);
 assert.deepEqual(await rpc('peris_guild_reinforcement_status'),[returning],'focused upgrade reruns preserve the accepted return and actual surviving troops');
 console.log(`Guild support ${rate}x: atomic sources, validation, receipt replay, privacy, worker arrival/recall, combat casualties and guild departure passed.`);
}catch(error){console.error(error instanceof Error?error.message:error);process.exitCode=1;}finally{await db.close();}
}
