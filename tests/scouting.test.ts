import test from 'node:test';import assert from 'node:assert/strict';
import {createSolo} from '../src/features/campaign/domain/newRealm';
import {emptyRoster,readRoster,writeRoster} from '../src/features/army/domain/roster';
import {homeArmyPosition} from '../src/features/map/domain/garrisons';
import {sendScouts,cancelScouting,scoutLosses} from '../src/features/scouting/domain/scouting';
import {advanceScouting} from '../src/features/scouting/domain/advance';
import {foodForceRows,starveOne} from '../src/features/city/domain/troopSupply';
import {validateSave} from '../src/platform/storage/saves';
import {nextEntityId} from '../src/features/empire/domain/expansion';
import {settleLocal} from '../src/features/campaign/domain/settlement';
import {liveResources} from '../src/features/city/domain/economy';
import {marchArmy} from '../src/features/map/domain/commands';
import {advanceCampFarms} from '../src/features/campaign/domain/campEconomy';

function fixture(){const w=createSolo('Watcher'),a=w.armies[0],home=w.settlements[0],now=Date.parse(w.server_now);w.scouting_version=1;writeRoster(a,{...emptyRoster(),infantry:20,scout:20});
 w.players.push({...w.players[0],id:'enemy',display_name:'Rival'});const city={...structuredClone(home),id:2,owner_id:'enemy',name:'Rival city',x:home.x+128,wood:123,stone:234,food:345,gold:456};w.settlements.push(city);
 w.buildings.push(...w.buildings.filter(b=>b.settlement_id===home.id).map(b=>({...b,id:b.id+100,settlement_id:city.id,level:b.building_type==='wall'?2:3})));
 let id=4000;const nextId=()=>++id,ctx={world:w,playerId:a.owner_id,now:w.server_now,nextId,paused:()=>{},finalize:()=>{}};
 return {w,a,home,city,now,nextId,ctx};}
test('special scout strengths use deterministic losses and never tactical troop stats',()=>{assert.equal(scoutLosses(10,350,0),0);assert.equal(scoutLosses(10,350,200),4);assert.equal(scoutLosses(10,350,2000),10);});
test('scout detachment leaves commander and other troops, cancels once during staging',()=>{const f=fixture();sendScouts(f.ctx,{type:'scout',armyId:f.a.id,targetCityId:2,quantity:10,mode:'resources'});const m=f.w.scouting_missions![0];assert.equal(m.scouts,10);assert.equal(readRoster(f.a).scout,10);assert.equal(readRoster(f.a).infantry,20);assert.equal(f.a.status,'idle');assert.equal(Date.parse(m.departure_at)-f.now,30000);
 cancelScouting(f.ctx,{type:'cancelScouting',missionId:m.id,sentAt:m.sent_at});assert.equal(readRoster(f.a).scout,20);assert.equal(m.status,'cancelled');assert.throws(()=>cancelScouting(f.ctx,{type:'cancelScouting',missionId:m.id,sentAt:m.sent_at}));});
test('unopposed resource scouting snapshots present troops only and leaves no defender report',()=>{const f=fixture();f.w.city_garrisons=[{owner_id:'enemy',settlement_id:2,...emptyRoster(),infantry:25}];
 sendScouts(f.ctx,{type:'scout',armyId:f.a.id,targetCityId:2,quantity:10,mode:'resources'});const m=f.w.scouting_missions![0],at=Date.parse(m.arrival_at);advanceScouting(f.w,f.a.owner_id,at,f.nextId);
 assert.equal(f.w.reports.length,1);const r=f.w.reports[0].result.scouting!;assert.equal(r.success,true);assert.equal(r.detected,false);assert.equal(r.troops!.infantry,25);assert.ok(r.resources!.wood>=123);assert.equal(r.defences,undefined);assert.equal(f.w.battles[0].defender_owner_id,null);assert.equal(f.w.players[0].victories,0);assert.equal(m.status,'returning');
 const intel=structuredClone(r);f.city.wood=0;f.w.city_garrisons[0].infantry=0;assert.deepEqual(r,intel);advanceScouting(f.w,f.a.owner_id,Date.parse(m.arrival_at),f.nextId);assert.equal(m.status,'completed');assert.equal(readRoster(f.a).scout,20);assert.equal(f.w.reports.length,1);});
test('defences mode and counter-scouts reveal only selected intel and never kill defenders',()=>{const f=fixture();f.w.city_garrisons=[{owner_id:'enemy',settlement_id:2,...emptyRoster(),scout:4}];sendScouts(f.ctx,{type:'scout',armyId:f.a.id,targetCityId:2,quantity:10,mode:'defences'});const m=f.w.scouting_missions![0];advanceScouting(f.w,f.a.owner_id,Date.parse(m.arrival_at),f.nextId);
 const attacker=f.w.reports.find(r=>r.owner_id===f.a.owner_id)!.result.scouting!,defender=f.w.reports.find(r=>r.owner_id==='enemy')!.result.scouting!;assert.ok(attacker.scouts_lost>0);assert.equal(attacker.resources,undefined);assert.equal(attacker.defences!.wall,2);assert.equal(attacker.defences!.main,3);assert.equal(defender.troops,undefined);assert.equal(defender.resources,undefined);assert.equal(readRoster(f.w.city_garrisons[0]).scout,4);});
test('all scouts dead means no enemy intel; changed owners abort safely',()=>{for(const changed of [false,true]){const f=fixture();f.w.city_garrisons=[{owner_id:'enemy',settlement_id:2,...emptyRoster(),scout:1000}];sendScouts(f.ctx,{type:'scout',armyId:f.a.id,targetCityId:2,quantity:10,mode:'resources'});if(changed)f.city.owner_id=f.a.owner_id;advanceScouting(f.w,f.a.owner_id,Date.parse(f.w.scouting_missions![0].arrival_at),f.nextId);const result=f.w.reports.find(r=>r.owner_id===f.a.owner_id)!.result.scouting!;assert.equal(result.success,false);assert.equal(result.troops,undefined);assert.equal(result.resources,undefined);assert.equal(result.defences,undefined);assert.equal(f.w.reports.find(r=>r.owner_id===f.a.owner_id)!.result.defender_initial,0);}});
test('scouts pay crop once while detached, and saved missions retain identities',()=>{const f=fixture();f.w.players=f.w.players.filter(p=>p.id===f.a.owner_id);f.w.settlements=f.w.settlements.filter(s=>s.owner_id===f.a.owner_id);f.w.buildings=f.w.buildings.filter(b=>b.settlement_id===f.home.id);sendScouts(f.ctx,{type:'scout',armyId:f.a.id,campId:f.w.camps[0].id,quantity:10,mode:'resources'});const m=f.w.scouting_missions![0];assert.equal(foodForceRows(f.w,f.now).filter(r=>r.kind==='scouting').reduce((n,r)=>n+r.roster.scout,0),10);assert.equal(foodForceRows(f.w,f.now).reduce((n,r)=>n+r.roster.scout,0),20);
 const copy=validateSave(structuredClone(f.w));assert.equal(copy.scouting_missions![0].scouts,10);const row=foodForceRows(f.w,f.now).find(r=>r.kind==='scouting')!;row.write({...emptyRoster(),scout:3});assert.equal(m.scouts,3);
 assert.ok(nextEntityId(f.w)>m.id);
});
test('saved scouting state rejects forged counts, modes, versions, paths and failed-report intel',()=>{
 const f=fixture();f.w.players=f.w.players.filter(p=>p.id===f.a.owner_id);f.w.settlements=f.w.settlements.filter(s=>s.owner_id===f.a.owner_id);f.w.buildings=f.w.buildings.filter(b=>b.settlement_id===f.home.id);sendScouts(f.ctx,{type:'scout',armyId:f.a.id,campId:f.w.camps[0].id,quantity:10,mode:'resources'});
 for(const mutate of [(w:typeof f.w)=>{w.scouting_version=2 as 1;},(w:typeof f.w)=>{w.scouting_missions![0].scouts=11;},(w:typeof f.w)=>{w.scouting_missions![0].mode='bad' as 'resources';},(w:typeof f.w)=>{w.scouting_missions![0].march_path=[];}]){const bad=structuredClone(f.w);mutate(bad);assert.throws(()=>validateSave(bad));}
 advanceScouting(f.w,f.a.owner_id,Date.parse(f.w.scouting_missions![0].arrival_at),f.nextId);const bad=structuredClone(f.w);bad.reports[0].result.scouting!.success=false;assert.throws(()=>validateSave(bad));
});
test('settling a defender processes incoming scouting at arrival before later production',()=>{
 const f=fixture();sendScouts(f.ctx,{type:'scout',armyId:f.a.id,targetCityId:2,quantity:10,mode:'resources'});const at=Date.parse(f.w.scouting_missions![0].arrival_at),expected=Math.floor(liveResources(f.city,at).wood);
 settleLocal(f.w,'enemy',at+3600000);assert.equal(f.w.reports.find(r=>r.owner_id===f.a.owner_id)?.result.scouting?.resources?.wood,expected);
});
test('mission history is bounded and a forged receipt link cannot enter a save',()=>{
 const f=fixture();f.w.players=f.w.players.filter(p=>p.id===f.a.owner_id);f.w.settlements=f.w.settlements.filter(s=>s.owner_id===f.a.owner_id);f.w.buildings=f.w.buildings.filter(b=>b.settlement_id===f.home.id);sendScouts(f.ctx,{type:'scout',armyId:f.a.id,campId:f.w.camps[0].id,quantity:1,mode:'resources'});const m=f.w.scouting_missions![0],bad=structuredClone(f.w);bad.scouting_missions![0].report_battle_id=99999;assert.throws(()=>validateSave(bad));
 f.w.scouting_missions!.push(...Array.from({length:2500},(_,i)=>({...structuredClone(m),id:10000+i,status:'completed' as const,scouts:0})));sendScouts(f.ctx,{type:'scout',armyId:f.a.id,campId:f.w.camps[0].id,quantity:1,mode:'resources'});assert.ok(f.w.scouting_missions!.length<1000);
});
test('scout-only raid entries become detached scouting while mixed parties keep ordinary combat',()=>{
 const f=fixture();marchArmy({...f.ctx,armyId:f.a.id},{type:'raid',campId:f.w.camps[0].id,troops:{...emptyRoster(),scout:5}});assert.equal(f.a.status,'idle');assert.equal(f.w.scouting_missions?.length,1);assert.equal(f.w.scouting_missions?.[0].mode,'resources');
 const g=fixture();marchArmy({...g.ctx,armyId:g.a.id},{type:'raidCity',targetCityId:2,troops:{...emptyRoster(),scout:5,infantry:1}});assert.equal(g.a.status,'moving');assert.equal(g.w.scouting_missions?.length??0,0);
});
test('returning scouts arrive before scouting observations at the same instant',()=>{
 const f=fixture();sendScouts(f.ctx,{type:'scout',armyId:f.a.id,targetCityId:2,quantity:10,mode:'resources'});const mission=f.w.scouting_missions![0];const enemyArmy={...structuredClone(f.a),id:9,owner_id:'enemy',home_settlement_id:2,...{start_x:homeArmyPosition(f.city).x,target_x:homeArmyPosition(f.city).x,start_y:homeArmyPosition(f.city).y,target_y:homeArmyPosition(f.city).y}};writeRoster(enemyArmy,emptyRoster());f.w.armies.push(enemyArmy);
 f.w.scouting_missions!.push({...structuredClone(mission),id:mission.id+1,owner_id:'enemy',source_settlement_id:2,source_army_id:9,status:'returning',scouts:20,initial_scouts:20});advanceScouting(f.w,f.a.owner_id,Date.parse(mission.arrival_at),f.nextId);
 assert.equal(f.w.reports.find(r=>r.owner_id===f.a.owner_id)!.result.scouting!.scouts_lost,10);
});
test('starving a detached scout then cancelling cannot restore the dead soldier',()=>{
 const f=fixture();sendScouts(f.ctx,{type:'scout',armyId:f.a.id,targetCityId:2,quantity:10,mode:'resources'});writeRoster(f.a,emptyRoster());const before=f.w.scouting_missions![0].scouts;assert.ok(starveOne(f.w,f.home,f.now)>0);assert.equal(f.w.scouting_missions![0].scouts,before-1);cancelScouting(f.ctx,{type:'cancelScouting',missionId:f.w.scouting_missions![0].id,sentAt:f.w.scouting_missions![0].sent_at});assert.equal(readRoster(f.a).scout,before-1);
});
test('scout farm dispatch remains labelled scouting when old mission history is pruned',()=>{
 const f=fixture();sendScouts(f.ctx,{type:'scout',armyId:f.a.id,campId:f.w.camps[0].id,quantity:1,mode:'resources'});const m=f.w.scouting_missions![0];f.w.scouting_missions!.push(...Array.from({length:201},(_,i)=>({...structuredClone(m),id:10000+i,status:'completed' as const,scouts:0})));
 f.w.campaign_farms=[{id:1,owner_id:f.a.owner_id,list_id:1,camp_id:f.w.camps[0].id,army_id:f.a.id,troops:{...emptyRoster(),scout:1},created_at:f.w.server_now,enabled:true,next_at:f.w.server_now}];advanceCampFarms(f.ctx,f.now);assert.equal(f.w.campaign_farms[0].last_status,'Scouts preparing');assert.equal(f.a.status,'idle');
});
