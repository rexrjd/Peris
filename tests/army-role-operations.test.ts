import test from 'node:test';
import assert from 'node:assert/strict';
import { createSolo } from '../src/features/campaign/domain/newRealm';
import { marchArmy, marchSpeed, startRaidReturn, cancelMarch } from '../src/features/map/domain/commands';
import { transferTroops } from '../src/features/heroes/domain/commands';
import { transferReason } from '../src/features/army/domain/commandRoom';
import { emptyRoster, readRoster, writeRoster, addRosters } from '../src/features/army/domain/roster';
import { heroBonuses } from '../src/features/heroes/domain/heroes';
import type { LocalCommandContext } from '../src/shared/model/commands';

function fixture() {
 const world=createSolo('Role operations'),army=world.armies[0];let id=3000;
 const ctx:LocalCommandContext={world,playerId:army.owner_id,armyId:army.id,now:world.server_now,nextId:()=>++id,paused:()=>{},finalize:()=>{},active:undefined};
 const second={...army,id:99,name:'Reserve legion'};writeRoster(second,emptyRoster());world.armies.push(second);
 return {world,army,second,ctx,now:Date.parse(ctx.now)};
}
test('march pace follows the slowest present role and retains hero equipment bonuses',()=>{
 const f=fixture(),troops=emptyRoster();troops.cavalry=10;
 assert.equal(marchSpeed(f.world,f.army,troops),22*76/40*heroBonuses(f.world,f.army).speed);
 troops.scout=1;assert.equal(marchSpeed(f.world,f.army,troops),22*76/40*heroBonuses(f.world,f.army).speed);
 troops.catapult=1;assert.equal(marchSpeed(f.world,f.army,troops),22*12/40*heroBonuses(f.world,f.army).speed);
 troops.catapult=0;troops.cavalry=0;assert.equal(marchSpeed(f.world,f.army,troops),22*92/40*heroBonuses(f.world,f.army).speed);
 f.world.hero_artifacts=[{id:88,owner_id:f.ctx.playerId,hero_id:f.world.heroes![0].id,artifact_id:'boots'}];
 assert.equal(marchSpeed(f.world,f.army,troops),22*92/40*heroBonuses(f.world,f.army).speed);
});
test('partial cavalry raid pace excludes siege left at its origin and preserves accepted deadlines after roster changes',()=>{
 const f=fixture(),host={...emptyRoster(),infantry:10,cavalry:5,catapult:2};writeRoster(f.army,host);
 const party={...emptyRoster(),cavalry:3};marchArmy(f.ctx,{type:'raid',campId:1,troops:party});
 const travel=Date.parse(f.army.arrival_at)-Date.parse(f.army.departure_at);
 assert.ok(Math.abs(travel-Math.max(2,f.army.march_distance!/marchSpeed(f.world,f.army,party))*1000)<1);
 assert.equal(readRoster(f.world.garrisons![0]).catapult,2);
 const deadline=f.army.arrival_at;writeRoster(f.army,{...party,catapult:1});assert.equal(f.army.arrival_at,deadline);
});
test('return pace recomputes surviving roles without adding a cancellation window',()=>{
 const f=fixture();writeRoster(f.army,{...emptyRoster(),cavalry:5,catapult:1});
 marchArmy(f.ctx,{type:'raid',campId:1});const distance=f.army.march_distance!;
 writeRoster(f.army,{...emptyRoster(),cavalry:3});
 const at=Date.parse(f.army.arrival_at)+10000;startRaidReturn(f.world,f.army,at);
 assert.ok(Math.abs(Date.parse(f.army.arrival_at)-at-Math.max(2,distance/marchSpeed(f.world,f.army))*1000)<1);
 assert.equal(f.army.march_cancel_until,null);assert.equal(f.army.march_returning,true);
});
test('partial reinforcement moves reserve every unsent role at the owned origin and cancel reunites them once',()=>{
 const f=fixture(),host={...emptyRoster(),infantry:10,cavalry:5,catapult:2};writeRoster(f.army,host);
 const party={...emptyRoster(),cavalry:3};marchArmy(f.ctx,{type:'move',x:f.army.start_x+1,y:f.army.start_y,troops:party});
 assert.deepEqual(readRoster(f.army),party);assert.deepEqual(readRoster(f.world.garrisons![0]),addRosters(host,party,-1));
 const sentAt=f.army.march_sent_at!;cancelMarch(f.ctx,{type:'cancelMarch',armyId:f.army.id,sentAt});
 assert.deepEqual(readRoster(f.army),host);assert.equal(f.world.garrisons!.length,0);
 assert.throws(()=>cancelMarch(f.ctx,{type:'cancelMarch',armyId:f.army.id,sentAt}),/same order/);
});
test('legacy neutral armies can bring their entire explicit roster home without reserving troops on neutral land',()=>{
 const f=fixture(),home={x:f.army.start_x,y:f.army.start_y},neutral={x:320,y:320};
 Object.assign(f.army,{start_x:neutral.x,start_y:neutral.y,target_x:neutral.x,target_y:neutral.y});
 const all=readRoster(f.army),part={...emptyRoster(),infantry:1},before=JSON.stringify(f.world);
 assert.throws(()=>marchArmy(f.ctx,{type:'move',...home,troops:part}),/Leave reinforcements only/);assert.equal(JSON.stringify(f.world),before);
 marchArmy(f.ctx,{type:'move',...home,troops:all});assert.deepEqual(readRoster(f.army),all);assert.equal(f.world.garrisons?.length??0,0);
});
test('exact role transfers conserve all troop identities while leaving unselected roles untouched',()=>{
 const f=fixture();writeRoster(f.army,{...emptyRoster(),infantry:12,spearmen:4,elite:3,archers:5,cavalry:8,scout:6,heavyCavalry:2,ram:1,catapult:2});
 const before=readRoster(f.army),selected={...emptyRoster(),scout:3,catapult:1,elite:2};
 assert.equal(transferReason(f.world,f.army,f.second,selected,f.now,true),null);
 transferTroops(f.ctx,{type:'transferTroops',armyId:f.army.id,targetArmyId:f.second.id,infantry:0,archers:0,cavalry:0,troops:selected});
 assert.deepEqual(readRoster(f.second),selected);assert.deepEqual(addRosters(readRoster(f.army),readRoster(f.second)),before);
 assert.equal(readRoster(f.army).spearmen,4);assert.equal(f.second.infantry,2);assert.equal(f.second.archers,1);assert.equal(f.second.cavalry,3);
});
test('legacy class transfers still choose existing roles and exact invalid requests never mutate forces',()=>{
 const f=fixture();writeRoster(f.army,{...emptyRoster(),infantry:2,spearmen:4,elite:3,scout:6});
 transferTroops(f.ctx,{type:'transferTroops',targetArmyId:f.second.id,infantry:4,archers:0,cavalry:1});
 assert.equal(readRoster(f.second).infantry,2);assert.equal(readRoster(f.second).spearmen,2);assert.equal(readRoster(f.second).scout,1);
 for(const request of [{...emptyRoster(),elite:99},{...emptyRoster(),scout:1.5},{...emptyRoster(),catapult:-1},{...emptyRoster(),infantry:1,unit_roster:{...emptyRoster(),scout:999}},emptyRoster()]){
  const before=JSON.stringify(f.world);assert.throws(()=>transferTroops(f.ctx,{type:'transferTroops',targetArmyId:f.second.id,infantry:0,archers:0,cavalry:0,troops:request}));assert.equal(JSON.stringify(f.world),before);
 }
});
