import { PGlite } from '@electric-sql/pglite';
import { readFile } from 'node:fs/promises';
import assert from 'node:assert/strict';
import { findMarchPath } from '../src/features/map/domain/pathfinding.ts';
import { marchSpeed } from '../src/features/map/domain/commands.ts';
import { emptyRoster,readRoster,addRosters } from '../src/features/army/domain/roster.ts';
const db=new PGlite(),owner='11111111-1111-4111-8111-111111111111';
const admin=async(sql:string)=>{await db.exec('reset role');return db.exec(sql);};
const login=()=>db.exec(`reset role;set role authenticated;select set_config('request.jwt.claim.sub','${owner}',false)`);
const rpc=async(name:string,args:unknown[]=[])=> (await db.query<{result:any}>(`select public.${name}(${args.map((_,i)=>'$'+(i+1)).join(',')}) result`,args)).rows[0].result;
const snap=()=>rpc('peris_snapshot');
function travelMatches(world:any,army:any){const actual=Date.parse(army.arrival_at)-Date.parse(army.departure_at),expected=Math.max(2,Number(army.march_distance)/marchSpeed(world,army))*1000;assert.ok(Math.abs(actual-expected)<2,`travel ${actual}ms differs from role pace ${expected}ms`);}
try{
 await db.exec(`create schema auth;create table auth.users(id uuid primary key);create role anon;create role authenticated;create role service_role;create function auth.uid()returns uuid language sql as $$select nullif(current_setting('request.jwt.claim.sub',true),'')::uuid$$;grant usage on schema public,auth to authenticated,anon,service_role;grant execute on function auth.uid()to authenticated,anon;create publication supabase_realtime;`);
 await db.exec(await readFile('supabase/FRESH_INSTALL_V16.sql','utf8'));
 await admin(`insert into auth.users values('${owner}')`);await login();await rpc('create_player',['Role parity']);let world=await snap(),army=world.armies[0],city=world.settlements[0];
 const initial={...emptyRoster(),infantry:12,spearmen:4,archers:5,elite:3,cavalry:8,scout:6,heavyCavalry:2,ram:1,catapult:2,diplomat:3};
 await admin(`select public.peris_write_roster(${army.id},'${JSON.stringify(initial)}'::jsonb);update public.settlements set gold=5000,wood=5000,stone=5000,food=5000,resources_updated_at=now()where id=${city.id};`);await login();
 await rpc('peris_empire_command',[{type:'recruitHero',settlementId:city.id,name:'Receiving legion',heroClass:'ranger'}]);world=await snap();const second=world.armies.find((entry:any)=>entry.id!==army.id);assert.ok(second);
 const selected={...emptyRoster(),elite:2,scout:3,catapult:1,diplomat:2};await rpc('peris_empire_command',[{type:'transferTroops',armyId:army.id,targetArmyId:second.id,infantry:0,archers:0,cavalry:0,troops:selected}]);world=await snap();
 assert.deepEqual(readRoster(world.armies.find((entry:any)=>entry.id===second.id)),selected);assert.deepEqual(addRosters(readRoster(world.armies.find((entry:any)=>entry.id===army.id)),selected),initial);
 for(const troops of [{...emptyRoster(),scout:100},{...emptyRoster(),scout:1.5},{...emptyRoster(),catapult:-1},emptyRoster()])await assert.rejects(()=>rpc('peris_empire_command',[{type:'transferTroops',armyId:army.id,targetArmyId:second.id,infantry:0,archers:0,cavalry:0,troops}]));
 assert.deepEqual(readRoster((await snap()).armies.find((entry:any)=>entry.id===second.id)),selected);
 await rpc('peris_empire_command',[{type:'transferTroops',armyId:army.id,targetArmyId:second.id,infantry:2,archers:0,cavalry:1}]);world=await snap();assert.equal(readRoster(world.armies.find((entry:any)=>entry.id===second.id)).infantry,2);assert.equal(readRoster(world.armies.find((entry:any)=>entry.id===second.id)).cavalry,1);
 console.log('PASS · exact ten-role transfer keeps identities, rejects invalid counts atomically and supports old class commands');
 await admin(`select public.peris_write_roster(${army.id},'${JSON.stringify(initial)}'::jsonb)`);await login();world=await snap();army=world.armies.find((entry:any)=>entry.id===army.id);const origin={x:army.target_x,y:army.target_y};
 await assert.rejects(()=>rpc('peris_march_speed',[army.id]),/permission/);
 const camp=world.camps.filter((entry:any)=>entry.bandit).find((entry:any)=>findMarchPath(origin,entry));assert.ok(camp);const route=findMarchPath(origin,camp)!;
 const party={...emptyRoster(),cavalry:3,scout:2};await rpc('peris_empire_command',[{type:'raid',armyId:army.id,campId:camp.id,route:route.path,troops:party}]);world=await snap();army=world.armies.find((entry:any)=>entry.id===army.id);travelMatches(world,army);assert.deepEqual(readRoster(army),party);assert.equal(readRoster(world.garrisons[0]).catapult,2);assert.equal(Date.parse(army.departure_at)-Date.parse(army.march_sent_at),30000);
 await rpc('peris_empire_command',[{type:'cancelMarch',armyId:army.id,sentAt:army.march_sent_at}]);world=await snap();assert.deepEqual(readRoster(world.armies.find((entry:any)=>entry.id===army.id)),initial);assert.equal(world.garrisons.length,0);
 const destination={x:origin.x+1,y:origin.y};await rpc('peris_empire_command',[{type:'move',armyId:army.id,...destination,route:[Object.values(origin),Object.values(destination)],troops:party}]);world=await snap();army=world.armies.find((entry:any)=>entry.id===army.id);assert.deepEqual(readRoster(army),party);assert.deepEqual(readRoster(world.garrisons[0]),addRosters(initial,party,-1));travelMatches(world,army);
 await rpc('peris_empire_command',[{type:'cancelMarch',armyId:army.id,sentAt:army.march_sent_at}]);world=await snap();assert.deepEqual(readRoster(world.armies.find((entry:any)=>entry.id===army.id)),initial);assert.equal(world.garrisons.length,0);
 console.log('PASS · new partial raid/reinforcement pace excludes unsent siege and cancellation restores all roles once');
 await rpc('peris_empire_command',[{type:'raid',armyId:army.id,campId:camp.id,route:route.path}]);world=await snap();army=world.armies.find((entry:any)=>entry.id===army.id);travelMatches(world,army);
 await admin(`select public.peris_write_roster(${army.id},'${JSON.stringify(party)}'::jsonb);select public.peris_return_raid(${army.id})`);await login();world=await snap();army=world.armies.find((entry:any)=>entry.id===army.id);travelMatches(world,army);assert.equal(army.march_cancel_until,null);assert.equal(army.march_returning,true);
 console.log('PASS · fresh return journeys use surviving roles and retain no cancellation window');
}catch(error:any){console.error(error.message);if(error.where)console.error(error.where);process.exitCode=1;}finally{await db.close();}
