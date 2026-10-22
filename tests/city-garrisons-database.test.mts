/** PostgreSQL (PGlite) verification of persistent, offline city garrisons.
 * Run: npm.cmd run test:city-garrisons-db */
import { PGlite } from '@electric-sql/pglite';
import { readFile } from 'node:fs/promises';
import assert from 'node:assert/strict';
import { emptyRoster } from '../src/features/army/domain/roster';

const db=new PGlite();
const authIds=['11111111-1111-4111-8111-111111111111','22222222-2222-4222-8222-222222222222'];
const admin=(sql:string)=>db.exec('reset role;'+sql);
const login=(who=0)=>db.exec(`reset role;set role authenticated;select set_config('request.jwt.claim.sub','${authIds[who]}',false)`);
const rpc=async(name:string,args:unknown[]=[])=> (await db.query<{result:any}>(`select public.${name}(${args.map((_,i)=>'$'+(i+1)).join(',')})result`,args)).rows[0].result;
const command=(cmd:unknown)=>rpc('peris_empire_command',[JSON.stringify(cmd)]);
try {
 await db.exec(`create schema auth;create table auth.users(id uuid primary key);create role anon;create role authenticated;create role service_role;create function auth.uid()returns uuid language sql as $$select nullif(current_setting('request.jwt.claim.sub',true),'')::uuid$$;grant usage on schema public,auth to authenticated,anon,service_role;grant execute on function auth.uid()to authenticated,anon;create publication supabase_realtime`);
 await db.exec(await readFile('supabase/FRESH_INSTALL_V19.sql','utf8'));
 await admin(`insert into auth.users values ${authIds.map(id=>`('${id}')`).join(',')}`);
 const worlds:any[]=[];
 for(let i=0;i<2;i++){await login(i);await rpc('create_player',['City defence '+i]);worlds.push(await rpc('peris_snapshot'));}
 const target=worlds[1].settlements[0],defenderArmy=worlds[1].armies[0],attackerArmy=worlds[0].armies[0];
 const defender=worlds[1].players.find((p:any)=>p.display_name==='City defence 1').id;
 const attacker=worlds[0].players.find((p:any)=>p.display_name==='City defence 0').id;
 const soldiers={...emptyRoster(),infantry:180,archers:80};
 await admin(`select public.peris_write_roster(${defenderArmy.id},'${JSON.stringify(soldiers)}');update public.buildings set level=5 where settlement_id=${target.id} and building_type='wall'`);
 await login(1);
 const assign={type:'manageCityGarrison',settlementId:target.id,armyId:defenderArmy.id,action:'station',troops:{...emptyRoster(),infantry:60,archers:40}};
 await command(assign);
 let world=await rpc('peris_snapshot');
 assert.equal(world.city_garrisons.length,1);assert.equal(world.city_garrisons[0].settlement_id,target.id);
 assert.equal(world.city_garrisons[0].unit_roster.infantry,60);
 assert.equal(world.armies.find((a:any)=>a.id===defenderArmy.id).unit_roster.infantry,120);
 await assert.rejects(()=>command({...assign,armyId:attackerArmy.id}),/Choose one of your armies/);
 await assert.rejects(()=>command({...assign,action:'withdraw',troops:{...emptyRoster(),infantry:1000}}),/available|1,000/);
 // Temporary station auto-merge leaves the dedicated defensive table untouched.
 await admin(`select public.peris_garrison_add('${defender}',floor(${target.x}/128.0)::integer,floor(${target.y}/128.0)::integer,'${JSON.stringify({...emptyRoster(),infantry:10})}');select public.peris_garrison_merge(${defenderArmy.id})`);
 await login(1);world=await rpc('peris_snapshot');assert.equal(world.city_garrisons[0].unit_roster.infantry,60);
 await command({...assign,action:'withdraw',troops:{...emptyRoster(),infantry:20}});
 world=await rpc('peris_snapshot');assert.equal(world.city_garrisons[0].unit_roster.infantry,40);
 await assert.rejects(()=>rpc('peris_wall_defence_bonus',[0]),/permission/);
 await db.exec('reset role');
 assert.equal(Number(await rpc('peris_wall_defence_bonus',[0])),0);
 assert.equal(Number(await rpc('peris_wall_defence_bonus',[5])),.5);
 assert.equal(Number(await rpc('peris_wall_defence_bonus',[100])),.5);
 // Attack arrival is processed by the server without any defender login or ready click.
 await admin(`update public.armies set raid_city_id=${target.id},status='idle',target_x=${target.x},target_y=${target.y},start_x=${target.x},start_y=${target.y} where id=${attackerArmy.id};select public.peris_write_roster(${attackerArmy.id},'${JSON.stringify({...emptyRoster(),infantry:90})}')`);
 await db.exec('reset role;');
 const started=await rpc('peris_start_city_raid',[attacker,attackerArmy.id]);
 assert.ok(started,'authoritative server starts city combat');
 const battle=(await db.query<any>(`select * from public.battles where id=${started}`)).rows[0];
 assert.equal(battle.attacker_ready,true);assert.equal(battle.defender_ready,true);
 assert.ok(battle.city_defenders.some((row:any)=>row.city_garrison_id===target.id));
 assert.equal(battle.city_defenders.find((row:any)=>row.city_garrison_id===target.id).troops.infantry,40);
 const formations=(await db.query<any>(`select * from public.battle_formations where battle_id=${started} and side='defender'`)).rows;
 assert.ok(formations.reduce((sum:number,row:any)=>sum+Number(row.initial_soldiers),0)>=200);
 assert.ok(formations.every((row:any)=>Number(row.defence_multiplier)>=1.5-1e-6));
 await admin(`update public.battle_formations set soldiers=floor(initial_soldiers/2) where battle_id=${started} and side='defender';select public.peris_finish(${started},'attacker','Garrison test')`);
 await login(1);world=await rpc('peris_snapshot');
 assert.ok(world.city_garrisons[0].unit_roster.infantry<40,'garrison pays losses in the authoritative DB');
 const retained=world.city_garrisons[0].unit_roster;
 await admin(`select public.peris_finish(${started},'attacker','Duplicate result')`);
 await login(1);world=await rpc('peris_snapshot');assert.deepEqual(world.city_garrisons[0].unit_roster,retained);
 console.log('PASS · city garrisons persist, validate ownership and troop conservation, remain distinct from transient pools, defend automatically with +50% walls, and settle casualties once');
} catch(error:any) {console.error(error.message,error.where??'',error.stack);process.exitCode=1;} finally {await db.close();}
