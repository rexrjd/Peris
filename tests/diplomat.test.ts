import test from 'node:test';import assert from 'node:assert/strict';
import {createSolo} from '../src/features/campaign/domain/newRealm';
import {RECRUIT_UNITS,emptyRoster,readRoster,writeRoster} from '../src/features/army/domain/roster';
import {unitRule} from '../src/features/army/domain/unitBalance';
import {troopFoodPerHour} from '../src/features/city/domain/troopSupply';
import {recruitSoldiers} from '../src/features/army/domain/commands';
import {settleLocal} from '../src/features/campaign/domain/settlement';
import type {LocalCommandContext} from '../src/shared/model/commands';
import {validateSave} from '../src/platform/storage/saves';
test('diplomats are a real tenth role, with 100x infantry prices and foot upkeep',()=>{
 assert.equal(RECRUIT_UNITS.at(-1),'diplomat');assert.equal(RECRUIT_UNITS.length,10);
 for(const v of [1,2] as const){const d=unitRule('diplomat',v),inf=unitRule('infantry',v);for(const k of ['wood','stone','food','gold'] as const)assert.equal(d.cost[k],inf.cost[k]*100);assert.equal(d.building,'main');}
 const w=createSolo('Envoy');writeRoster(w.armies[0],{...emptyRoster(),infantry:5,diplomat:3});assert.equal(readRoster(w.armies[0]).diplomat,3);assert.equal(w.armies[0].infantry,8);assert.equal(troopFoodPerHour(readRoster(w.armies[0])),8);
});
test('Diplomacy research unlocks expensive Main-building training into the legion',()=>{
 const w=createSolo('Envoy'),s=w.settlements[0],owner=w.players[0].id;const ctx:LocalCommandContext={world:w,playerId:owner,nextId:()=>900,now:w.server_now,active:undefined,paused:()=>{},finalize:()=>{}};
 Object.assign(s,{wood:5000,stone:5000,food:5000,gold:5000});w.buildings.find(b=>b.building_type==='market')!.level=2;
 assert.throws(()=>recruitSoldiers(ctx,{type:'recruit',item:'diplomat',quantity:2}),/Research/);
 w.research_progress=[{owner_id:owner,technology_id:'diplomacy',seconds:90,completed_at:w.server_now}];
 recruitSoldiers(ctx,{type:'recruit',item:'diplomat',quantity:2});assert.equal(s.wood,4200);assert.equal(s.food,3800);assert.equal(readRoster(w.armies[0]).diplomat,0);
 settleLocal(w,owner,Date.parse(w.orders[0].finish_at));assert.equal(readRoster(w.armies[0]).diplomat,2);
});
test('campaign imports retain diplomat identities and damaged loyalty, rejecting forged conquest state',()=>{
 const w=createSolo('Envoy'),s=w.settlements[0];writeRoster(w.armies[0],{...emptyRoster(),diplomat:3});s.loyalty=27;s.loyalty_updated_at=w.server_now;
 w.players[0].research_faction='persian';const saved=validateSave(w);assert.equal(readRoster(saved.armies[0]).diplomat,3);assert.equal(saved.settlements[0].loyalty,27);assert.equal(saved.players[0].research_faction,'persian');
 for(const mutate of [(x:typeof w)=>{x.settlements[0].loyalty=101;},(x:typeof w)=>{x.settlements[0].loyalty=NaN;},(x:typeof w)=>{x.settlements[0].loyalty_updated_at='bad';},(x:typeof w)=>{x.conquest_version=2 as 1;},(x:typeof w)=>{x.players[0].research_faction='invalid' as 'persian';}]){const invalid=structuredClone(w);mutate(invalid);assert.throws(()=>validateSave(invalid));}
});
