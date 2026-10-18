import test from 'node:test';
import assert from 'node:assert/strict';
import {createSolo} from '../src/features/campaign/domain/newRealm';
import {recruitmentPlan} from '../src/features/army/domain/commandRoom';
import {troopDetails} from '../src/features/army/domain/troopDetails';
import {FACTIONS,type Faction} from '../src/features/factions/domain/factions';
import {armyStrength} from '../src/features/army/domain/strength';
import {recruitSoldiers} from '../src/features/army/domain/commands';
import {TECHNOLOGIES} from '../src/features/research/domain/catalog';
import {type RecruitUnit} from '../src/features/army/domain/roster';
import {normalizeRealm} from '../src/features/empire/domain/normalization';
import type {Resources} from '../src/shared/model/resources';

test('all factions pay shared v2 prices and old online worlds retain v1 recruitment',()=>{
 const w=createSolo('Recruitment versions'),a=w.armies[0],s=w.settlements[0],now=Date.parse(w.server_now);
 w.city_slots=[{settlement_id:s.id,slot_index:0,building_type:'barracks',level:1}];
 for(const faction of Object.keys(FACTIONS) as Faction[]){
  s.faction=faction;const plan=recruitmentPlan(w,a,s,'archers',10,now);
  assert.deepEqual(plan.cost,{wood:60,stone:20,food:50,gold:10});assert.equal(plan.seconds,30);
  const details=troopDetails(w,a,s,'archers',now);assert.equal(details.rule.cost.gold,1);assert.equal(details.trainTenSeconds,30);
 }
 delete w.unit_balance_version;
 assert.deepEqual(recruitmentPlan(w,a,s,'archers',10,now).cost,{wood:60,stone:20,food:50,gold:20});
 assert.equal(recruitmentPlan(w,a,s,'archers',10,now).seconds,20);
});
test('army totals use permanent bonuses, retain composition and reveal no rival army',()=>{
 const w=createSolo('Strength totals'),a=w.armies[0],s=w.settlements[0];s.faction='persian';
 const before=structuredClone(w),strength=armyStrength(w,a);
 assert.deepEqual(w,before);assert.ok(strength.attackPoints>0);assert.equal(strength.composition.archers,50);
 assert.equal(strength.carryingCapacity,3790);
 const archer=troopDetails(w,a,s,'archers',Date.parse(w.server_now));
 assert.equal(archer.baseAttackPoints,75);assert.equal(archer.factionAttackPoints,78);
 assert.ok(archer.attackPoints>archer.factionAttackPoints);
 assert.equal(armyStrength(w,{...a,id:999,owner_id:'rival'}),null);
 w.players.unshift({...w.players[0],id:'older-rival'});
 assert.ok(armyStrength(w,a),'public opponent ordering must not hide owned army totals');
});
test('accepted batches charge exact role prices and preserve existing queue dates',()=>{
 const cases:[RecruitUnit,number[],number][]=[['infantry',[40,20,60,10],20],['spearmen',[50,30,70,10],30],['archers',[60,20,50,10],30],['elite',[70,50,100,10],40],['cavalry',[50,60,100,30],50],['scout',[30,20,40,10],20],['heavyCavalry',[80,100,160,40],80],['ram',[180,120,120,40],120],['catapult',[250,180,140,60],180]];
 for(const [unit,cost,seconds]of cases)for(const level of [1,3]){
  const w=createSolo('Accepted batch'),a=w.armies[0],s=w.settlements[0];
  Object.assign(s,{wood:5000,stone:5000,food:5000,gold:5000});
  w.city_slots=['barracks','stables','workshop'].map((building_type,i)=>({settlement_id:s.id,slot_index:i,building_type:building_type as 'barracks'|'stables'|'workshop',level}));
  w.unit_research=[{settlement_id:s.id,unit,completes_at:w.server_now}];
  const boosts=TECHNOLOGIES.filter(t=>!t.faction&&t.effects.training===.1).slice(0,2);
  assert.equal(boosts.length,2);w.research_progress=boosts.map(t=>({owner_id:a.owner_id,technology_id:t.id,seconds:t.seconds,completed_at:w.server_now}));
  const context={world:w,playerId:a.owner_id,now:w.server_now,nextId:()=>901,active:undefined,paused:()=>{},finalize:()=>{}};
  recruitSoldiers(context,{type:'recruit',item:unit,quantity:10});
  assert.deepEqual(['wood','stone','food','gold'].map(k=>5000-s[k as keyof Resources]),cost);
  const expected=Math.max(5,Math.ceil(seconds/((1+(level-1)*.18)*1.2)));
  assert.equal((Date.parse(w.orders[0].finish_at)-Date.parse(w.orders[0].started_at))/1000,expected);
  const dates=structuredClone(w.orders[0]);s.faction='elf';w.unit_balance_version=1;normalizeRealm(w);
  assert.deepEqual(w.orders[0],dates);
 }
});
