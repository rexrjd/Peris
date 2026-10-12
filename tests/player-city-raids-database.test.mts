import { PGlite } from '@electric-sql/pglite';
import { readFile } from 'node:fs/promises';
import assert from 'node:assert/strict';
import { findMarchPath } from '../src/features/map/domain/pathfinding';
import { emptyRoster } from '../src/features/army/domain/roster';
import { siegeReduction } from '../src/features/city/domain/siege';
import { isWalkable } from '../src/features/map/domain/worldGrid';

const db=new PGlite(),authIds=['11111111-1111-4111-8111-111111111111','22222222-2222-4222-8222-222222222222','33333333-3333-4333-8333-333333333333'];
const admin=(sql:string)=>db.exec('reset role;'+sql);
const login=(index=0)=>db.exec(`reset role;set role authenticated;select set_config('request.jwt.claim.sub','${authIds[index]}',false)`);
const rpc=async(name:string,args:unknown[]=[])=> (await db.query<{result:any}>(`select public.${name}(${args.map((_,i)=>'$'+(i+1)).join(',')})result`,args)).rows[0].result;
const command=(cmd:unknown)=>rpc('peris_empire_command',[JSON.stringify(cmd)]);
try{
 await db.exec(`create schema auth;create table auth.users(id uuid primary key);create role anon;create role authenticated;create role service_role;create function auth.uid()returns uuid language sql as $$select nullif(current_setting('request.jwt.claim.sub',true),'')::uuid$$;grant usage on schema public,auth to authenticated,anon,service_role;grant execute on function auth.uid()to authenticated,anon;create publication supabase_realtime`);
 await db.exec(await readFile('supabase/FRESH_INSTALL_V17.sql','utf8'));
 await admin(`insert into auth.users values ${authIds.map(id=>`('${id}')`).join(',')}`);
 const worlds:any[]=[];
 for(let i=0;i<3;i++){await login(i);await rpc('create_player',['Siege ruler '+i]);worlds.push(await rpc('peris_snapshot'));}
 const own=worlds[0],enemy=worlds[1],a=own.armies[0],d=enemy.armies[0],city=enemy.settlements[0],camp=own.camps[0],owner=own.players.find((p:any)=>p.display_name==='Siege ruler 0').id,defender=enemy.players.find((p:any)=>p.display_name==='Siege ruler 1').id;
 const all={...emptyRoster(),infantry:300,ram:30,catapult:40},party={...all,infantry:240};
 await admin(`update public.settlements set x=${camp.x},y=${camp.y},wood=3000,stone=3000,food=3000,gold=3000 where id=${city.id};update public.armies set start_x=${camp.x},target_x=${camp.x},start_y=${camp.y},target_y=${camp.y} where id=${d.id};update public.buildings set level=case building_type when 'wall'then 2 when 'market'then 3 else 0 end where settlement_id=${city.id};insert into public.peris_city_slots(settlement_id,slot_index,building_type,level)values(${city.id},0,'smithy',2)on conflict(settlement_id,slot_index)do update set building_type='smithy',level=2;select public.peris_write_roster(${a.id},'${JSON.stringify(all)}');select public.peris_write_roster(${d.id},'${JSON.stringify({...emptyRoster(),infantry:100})}');`);
 const second=(await db.query<any>(`insert into public.armies(owner_id,home_settlement_id,name,infantry,archers,cavalry,start_x,start_y,target_x,target_y,status)values('${defender}',${city.id},'Second defenders',80,0,0,${camp.x},${camp.y},${camp.x},${camp.y},'idle')returning id`)).rows[0].id;
 await admin(`select public.peris_garrison_add('${defender}',${Math.floor(camp.x/128)},${Math.floor(camp.y/128)},'${JSON.stringify({...emptyRoster(),infantry:40})}')`);
 const route=findMarchPath({x:a.target_x,y:a.target_y},camp)!.path;
 await login();
 await assert.rejects(()=>command({type:'raidCity',armyId:a.id,targetCityId:own.settlements[0].id,route}),/another player/);
 await assert.rejects(()=>command({type:'raidCity',armyId:d.id,targetCityId:city.id,route}),/arm(?:y|ies)|own/i);
 await assert.rejects(()=>command({type:'raidCity',armyId:a.id,targetCityId:city.id,siegeTarget:'wall',route}),/valid catapult/);
 const cmd={type:'raidCity',armyId:a.id,targetCityId:city.id,troops:party,siegeTarget:'smithy',route};
 const request=['aaaaaaaa-1111-4111-8111-111111111111','peris_empire_command',JSON.stringify({p_command:cmd})];
 await rpc('peris_submit_command',request);await rpc('peris_submit_command',request);
 let world=await rpc('peris_snapshot');assert.equal(world.armies[0].raid_city_id,city.id);assert.equal(world.armies[0].unit_roster.infantry,240);assert.equal(world.garrisons[0].infantry,60);
 await command({type:'cancelMarch',armyId:a.id,sentAt:world.armies[0].march_sent_at});world=await rpc('peris_snapshot');assert.equal(world.armies[0].unit_roster.infantry,300);assert.equal(world.armies[0].raid_city_id,null);
 await command(cmd);
 await admin(`update public.armies set departure_at=now()-interval '5 seconds',arrival_at=now()-interval '1 second',march_sent_at=now()-interval '35 seconds',march_cancel_until=now()-interval '5 seconds'where id=${a.id}`);
 await login();await rpc('sync_my_state');world=await rpc('peris_snapshot');const battle=world.battles.find((b:any)=>b.raid_city_id===city.id);
 assert.ok(battle);assert.equal(battle.mode,'pvp');assert.equal(battle.city_defenders.length,3);assert.equal(battle.defender_owner_id,defender);
 const initial=(await db.query<any>(`select sum(initial_soldiers)as n from public.battle_formations where battle_id=${battle.id} and side='defender'`)).rows[0].n;assert.equal(Number(initial),220);
 await admin(`update public.battle_formations set soldiers=floor(initial_soldiers/2)where battle_id=${battle.id} and side='defender';select public.peris_write_roster(${d.id},'${JSON.stringify({...emptyRoster(),infantry:107})}');select public.peris_finish(${battle.id},'attacker','Army routed')`);
 await login();world=await rpc('peris_snapshot');const report=world.reports[0];assert.equal(report.result.report_side,'attacker');assert.deepEqual(report.result.siege_damage.map((r:any)=>[r.building_type,r.before,r.after]),[['wall',2,0],['smithy',2,0]]);assert.equal(world.armies[0].march_returning,true);assert.equal(report.result.delivered,undefined);assert.ok(Object.values(report.result.loot).some((n:any)=>n>0));
 await login(1);const defence=await rpc('peris_snapshot');assert.equal(defence.reports[0].result.report_side,'defender');assert.equal(defence.armies.find((r:any)=>r.id===d.id).unit_roster.infantry,57);assert.equal(defence.armies.find((r:any)=>r.id===second).unit_roster.infantry+defence.garrisons[0].infantry+57,227-report.result.defender_losses);assert.equal(defence.buildings.find((r:any)=>r.building_type==='market').level,3);
 const stocks=(await db.query<any>(`select wood,stone,food,gold from public.settlements where id=${city.id}`)).rows[0];await admin(`select public.peris_finish(${battle.id},'attacker','Duplicate')`);assert.deepEqual((await db.query<any>(`select wood,stone,food,gold from public.settlements where id=${city.id}`)).rows[0],stocks);
 await admin(`update public.armies set arrival_at=now()-interval '1 second'where id=${a.id}`);await login();await rpc('sync_my_state');world=await rpc('peris_snapshot');assert.ok(world.reports[0].result.delivered);assert.equal(world.armies[0].carried_loot,null);assert.equal(world.armies[0].unit_roster.infantry,300);
 await login(2);assert.equal((await rpc('peris_snapshot')).reports.length,0);await assert.rejects(()=>rpc('peris_start_city_raid',[owner,a.id]),/permission denied/);
 const cell={col:Math.floor(camp.x/128),row:Math.floor(camp.y/128)},field=[{col:cell.col+1,row:cell.row},{col:cell.col-1,row:cell.row},{col:cell.col,row:cell.row+1},{col:cell.col,row:cell.row-1}].find(point=>isWalkable(point.col,point.row))!;
 await admin(`insert into public.peris_map_plots(owner_id,settlement_id,col,row,building_type,level)values('${defender}',${city.id},${field.col},${field.row},'lumber',3)`);
 const fieldDamage=await rpc('peris_damage_city',[city.id,JSON.stringify({...emptyRoster(),catapult:30}),'lumber']);assert.equal(fieldDamage[0].col,field.col);assert.equal(fieldDamage[0].before,3);assert.equal(fieldDamage[0].after,1);
 await admin(await readFile('supabase/UPGRADE_TO_V17.sql','utf8'));await login(1);const upgraded=await rpc('peris_snapshot');assert.equal(upgraded.buildings.find((r:any)=>r.building_type==='wall').level,0);assert.equal(upgraded.city_slots.find((r:any)=>r.building_type==='smithy').level,0);assert.equal(upgraded.reports[0].result.siege_damage.length,2);assert.equal(upgraded.map_plots.find((r:any)=>r.col===field.col&&r.row===field.row).level,1);
 for(const weapon of ['ram','catapult']as const)for(const level of [0,1,2,5,10])for(const engines of [0,6,10,30,100]){await db.exec('reset role');assert.equal(await rpc('peris_siege_reduction',[engines,level,weapon]),siegeReduction(engines,level,weapon));}
 // An undefended city resolves through the actual AI tick with no defender acceptance.
 await admin(`delete from public.peris_garrisons where owner_id='${defender}';select public.peris_write_roster(${d.id},'{}');select public.peris_write_roster(${second},'{}')`);await login();await command({...cmd,troops:{...emptyRoster(),infantry:20}});
 await admin(`update public.armies set arrival_at=now()-interval '1 second'where id=${a.id}`);await login();await rpc('sync_my_state');world=await rpc('peris_snapshot');const emptyBattle=world.battles.find((b:any)=>b.status==='active'&&b.raid_city_id===city.id);assert.ok(emptyBattle);
 await admin(`update public.battles set last_tick_at=now()-interval '1 second'where id=${emptyBattle.id}`);await login();await rpc('peris_tick',[emptyBattle.id]);world=await rpc('peris_snapshot');assert.equal(world.battles.find((b:any)=>b.id===emptyBattle.id).status,'resolved');assert.equal(world.reports.length,2);
 console.log('PASS · owned/foreign target validation, command idempotency/cancellation, all stationed defenders, recruit-preserving exact casualties, finite loot/return delivery, targeted siege parity, private reports/helpers, migration rerun and automatic undefended-city combat');
}catch(error:any){console.error(error.message,error.where??'',error.stack);process.exitCode=1;}finally{await db.close();}
