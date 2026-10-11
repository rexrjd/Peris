import test from 'node:test';
import assert from 'node:assert/strict';
import { createSolo } from '../src/features/campaign/domain/newRealm';
import { researchUnit } from '../src/features/army/domain/research';
import { recruitSoldiers } from '../src/features/army/domain/commands';
import { settleLocal } from '../src/features/campaign/domain/settlement';
import { readRoster, writeRoster, emptyRoster } from '../src/features/army/domain/roster';
import { marchArmy, cancelMarch } from '../src/features/map/domain/commands';
import { validateSave } from '../src/platform/storage/saves';
import { accrueCamp, campRules } from '../src/features/campaign/domain/campStock';
import { beginRaid } from '../src/features/campaign/domain/raids';
import { finishBattle } from '../src/features/battle/domain/resolution';
import { settleBattle } from '../src/features/campaign/domain/battleSettlement';
import { findMarchPath } from '../src/features/map/domain/pathfinding';
import { advanceCampFarms } from '../src/features/campaign/domain/campEconomy';
import type { LocalCommandContext } from '../src/shared/model/commands';
function fixture(){
 const world=createSolo('Integrated realm');let id=50000;
 const army=world.armies[0],city=world.settlements[0];Object.assign(city,{wood:5000,stone:5000,food:5000,gold:5000});
 world.city_slots=[{settlement_id:city.id,slot_index:0,building_type:'barracks',level:1},{settlement_id:city.id,slot_index:1,building_type:'stables',level:1},{settlement_id:city.id,slot_index:2,building_type:'workshop',level:1}];
 const context:LocalCommandContext={world,playerId:army.owner_id,armyId:army.id,settlementId:city.id,now:world.server_now,nextId:()=>++id,active:undefined,paused:()=>{},finalize:()=>{}};
 const position={x:army.start_x,y:army.start_y};
 const camp=world.camps.filter(c=>c.bandit).sort((a,b)=>Math.hypot(a.x-position.x,a.y-position.y)-Math.hypot(b.x-position.x,b.y-position.y)).find(c=>findMarchPath(position,c))!;
 return {world,army,city,context,camp};
}
test('advanced research and parallel buildings use existing cities and preserve roles through save reload',()=>{
 const f=fixture();assert.throws(()=>recruitSoldiers(f.context,{type:'recruit',item:'scout',quantity:2}),/research/i);
 researchUnit(f.context,{type:'researchUnit',item:'scout'});assert.equal(f.city.wood,4960);f.context.now=new Date(Date.parse(f.context.now)+31000).toISOString();
 recruitSoldiers(f.context,{type:'recruit',item:'scout',quantity:2});recruitSoldiers(f.context,{type:'recruit',item:'infantry',quantity:2});
 assert.equal(f.world.orders[0].started_at,f.world.orders[1].started_at);settleLocal(f.world,f.army.owner_id,Date.parse(f.context.now)+20000);
 assert.equal(readRoster(f.army).scout,2);assert.equal(readRoster(f.army).infantry,122);assert.equal(f.army.cavalry,18);
 assert.equal(validateSave(f.world).armies[0].unit_roster?.scout,2);
});
test('partial advanced raids leave role-preserving garrisons and cancellation merges exactly once',()=>{
 const f=fixture(),force=readRoster(f.army);force.scout=7;force.elite=5;writeRoster(f.army,force);
 const party={...emptyRoster(),scout:3,elite:2};marchArmy(f.context,{type:'raid',campId:f.camp.id,troops:party});
 assert.equal(readRoster(f.army).scout,3);assert.equal(readRoster(f.world.garrisons![0]).scout,4);assert.equal(readRoster(f.world.garrisons![0]).elite,3);
 const sentAt=f.army.march_sent_at!;cancelMarch(f.context,{type:'cancelMarch',armyId:f.army.id,sentAt});
 assert.equal(readRoster(f.army).scout,7);assert.equal(readRoster(f.army).elite,5);assert.equal(f.world.garrisons!.length,0);
 assert.throws(()=>cancelMarch(f.context,{type:'cancelMarch',armyId:f.army.id,sentAt}));
});
test('camp spoils deplete shared stock once and arrive in the existing home city after return',()=>{
 const f=fixture();Object.assign(f.camp,{resources:{wood:40,stone:30,food:20,gold:10},stock_updated_at:new Date(Date.now()+1e6).toISOString()});
 marchArmy(f.context,{type:'raid',campId:f.camp.id,troops:{infantry:10,archers:0,cavalry:0}});
 settleLocal(f.world,f.army.owner_id,Date.parse(f.army.arrival_at));beginRaid(f.world,f.army.owner_id,f.camp.id,f.context.nextId,f.army.id);
 const battle=f.world.battles[0];f.world.formations.filter(unit=>unit.side==='defender').forEach(unit=>unit.soldiers=0);finishBattle(battle,f.world.formations,'attacker','Army routed');
 f.city.wood=100;const before=f.city.wood;settleBattle(f.world,battle.id,f.army.owner_id,f.context.nextId);
 assert.equal(f.city.wood,before);assert.equal(f.army.carried_loot!.wood,40);assert.equal(f.camp.resources!.wood,0);assert.equal(f.camp.infantry,0);assert.equal(f.world.progress.length,0);
 settleLocal(f.world,f.army.owner_id,Date.parse(f.army.arrival_at));assert.equal(f.army.carried_loot,null);assert.equal(f.world.reports[0].result.delivered!.wood,40);
 const after=f.city.wood;settleLocal(f.world,f.army.owner_id,Date.parse(f.army.arrival_at));assert.equal(f.city.wood,after);assert.equal(readRoster(f.army).infantry,120);
});
test('camp growth is bounded and old story sites are untouched',()=>{
 const f=fixture(),story=structuredClone(f.world.camps[0]),at=Date.parse(f.context.now),initial=f.camp.infantry+f.camp.archers+f.camp.cavalry;accrueCamp(f.camp,at);
 accrueCamp(f.camp,at+86400000);assert.ok(f.camp.resources!.wood<=campRules(f.camp).capacity.wood);assert.ok(f.camp.infantry+f.camp.archers+f.camp.cavalry<=Math.max(initial,campRules(f.camp).defenderCap));
 accrueCamp(f.world.camps[0],at+86400000);assert.deepEqual(f.world.camps[0],story);
});
test('missed repeat intervals launch one party and retain the original farm target identity',()=>{
 const f=fixture(),at=Date.parse(f.context.now);f.world.campaign_farms=[{id:1,owner_id:f.army.owner_id,list_id:2,camp_id:f.camp.id,army_id:f.army.id,troops:{infantry:3,archers:0,cavalry:0},created_at:f.context.now,enabled:true,interval_seconds:60,next_at:new Date(at-100000).toISOString()}];
 advanceCampFarms(f.context,at);assert.equal(f.army.infantry,3);assert.equal(f.army.farm_list_id,2);assert.equal(f.world.campaign_farms[0].next_at,new Date(at+60000).toISOString());
 const state=structuredClone(f.world.armies);advanceCampFarms(f.context,at);assert.deepEqual(f.world.armies,state);
});
test('save validation rejects forged role counts, research and scheduling deadlines',()=>{
 const f=fixture();writeRoster(f.army,{...emptyRoster(),scout:2});assert.doesNotThrow(()=>validateSave(f.world));
 f.army.unit_roster!.scout=-1;assert.throws(()=>validateSave(f.world));f.army.unit_roster!.scout=2;f.army.cavalry=3;assert.throws(()=>validateSave(f.world));f.army.cavalry=2;
 f.world.unit_research=[{settlement_id:99999,unit:'scout',completes_at:f.context.now}];assert.throws(()=>validateSave(f.world));f.world.unit_research=[];
 f.camp.next_recruit_at='invalid';assert.throws(()=>validateSave(f.world));delete f.camp.next_recruit_at;f.camp.resources={wood:-1,stone:0,food:0,gold:0};assert.throws(()=>validateSave(f.world));
});
