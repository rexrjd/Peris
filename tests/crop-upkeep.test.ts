import test from 'node:test';import assert from 'node:assert/strict';
import {createSolo} from '../src/features/campaign/domain/newRealm';
import {accrueResources,projectSettlement} from '../src/features/city/domain/economy';
import {populationRates} from '../src/features/city/domain/population';
import {emptyRoster,readRoster,writeRoster} from '../src/features/army/domain/roster';
import {refreshTroopUpkeep} from '../src/features/city/domain/troopSupply';
import {settleLocal,activateTroopUpkeep} from '../src/features/campaign/domain/settlement';
import {validateSave} from '../src/platform/storage/saves';
function fixture(){const w=createSolo('Famine'),s=w.settlements[0];w.troop_upkeep_version=1;s.population=s.population_capacity=40;s.food=1;writeRoster(w.armies[0],{...emptyRoster(),infantry:1000});refreshTroopUpkeep(w,Date.parse(w.server_now));Object.assign(s,populationRates(s));return {w,s,start:Date.parse(s.resources_updated_at)};}
const near=(a:number,b:number)=>assert.ok(Math.abs(a-b)<1e-6,`${a} != ${b}`);
test('crop reaches zero before starvation; deaths refund crop and never kill residents',()=>{
 const {w,s,start}=fixture();const depletion=1/-s.food_rate*60000;
 accrueResources(s,start+depletion,w);near(s.food,0);assert.equal(readRoster(w.armies[0]).infantry,1000);
 accrueResources(s,start+depletion+1000,w);assert.equal(readRoster(w.armies[0]).infantry,999);assert.ok(s.food>5.9&&s.food<6);assert.equal(s.population,40);assert.equal(s.starvation_losses,1);
});
test('one absence and many ticks produce the same refund-driven famine',()=>{
 const a=fixture(),b={w:structuredClone(a.w),start:a.start};
 accrueResources(a.s,a.start+120*60000,a.w);
 for(let i=1;i<=120;i++)accrueResources(b.w.settlements[0],b.start+i*60000,b.w);
 near(a.s.food,b.w.settlements[0].food);assert.deepEqual(readRoster(a.w.armies[0]),readRoster(b.w.armies[0]));assert.equal(a.s.population,40);assert.ok(a.s.starvation_losses!>0);
});
test('display projection drains food but cannot kill troops or mutate the saved economy',()=>{
 const {w,s,start}=fixture(),before=structuredClone(w),p=projectSettlement(s,start+3600000);
 near(p.food,0);assert.equal(p.population,40);assert.deepEqual(w,before);
});

test('new recruits consume only after their completion boundary',()=>{
 const {w,s,start}=fixture();s.food=1000;writeRoster(w.armies[0],emptyRoster());refreshTroopUpkeep(w,start);
 w.orders=[{id:999,owner_id:w.players[0].id,settlement_id:1,army_id:1,kind:'recruit',item:'infantry',quantity:600,started_at:w.server_now,finish_at:new Date(start+30000).toISOString()}];
 settleLocal(w,w.players[0].id,start+60000);
 near(s.food,1000+13.2-5);assert.equal(s.food_troop_upkeep,10);
});

test('transported troops switch to their host at the actual arrival time during catch-up',()=>{
 const {w,s,start}=fixture();writeRoster(w.armies[0],emptyRoster());s.food=1000;
 const other={...s,id:2,name:'Host',x:s.x+128,food:1000};w.settlements.push(other);
 w.city_reinforcements=[{id:9,owner_id:s.owner_id,source_settlement_id:1,target_settlement_id:2,troops:{...emptyRoster(),infantry:600},march_path:[[0,0],[1,1]],departure_at:w.server_now,arrival_at:new Date(start+30000).toISOString()}];
 refreshTroopUpkeep(w,start);settleLocal(w,s.owner_id,start+60000);
 near(s.food,1008.2);near(other.food,1008.2);assert.equal(other.food_troop_upkeep,10);assert.equal(s.food_troop_upkeep,0);
});

test('food arriving exactly at depletion rescues troops before a starvation casualty',()=>{
 const {w,s,start}=fixture();s.food=1;s.food_bonus=0;s.field_food_rate=0;s.food_research=1;s.population=40;
 // Choose an integer-millisecond depletion boundary.
 s.food=-s.food_rate/2;
 const source={...s,id:2,name:'Source',x:s.x+128,food:1000};w.settlements.push(source);
 w.trade_caravans=[{id:55,owner_id:s.owner_id,recipient_id:s.owner_id,source_settlement_id:2,target_settlement_id:1,source_city:source.name,target_city:s.name,resources:{wood:0,stone:0,food:100,gold:0},returning_resources:{wood:0,stone:0,food:0,gold:0},delivered_resources:{wood:0,stone:0,food:0,gold:0},volume:100,march_path:[[0,0],[1,1]],departure_at:w.server_now,arrival_at:new Date(start+30000).toISOString(),return_at:new Date(start+60000).toISOString(),status:'outbound'}];
 settleLocal(w,s.owner_id,start+60000);assert.equal(s.starvation_losses,0);assert.equal(readRoster(w.armies[0]).infantry,1000);assert.ok(s.food>98);
});

test('legacy armies remain free until activation; enabled saves retain validated starvation state',()=>{
 const {w,s,start}=fixture();delete w.troop_upkeep_version;delete s.food_troop_upkeep;s.food=0;Object.assign(s,populationRates(s));
 activateTroopUpkeep(w,start+24*3600000);assert.equal(readRoster(w.armies[0]).infantry,1000);assert.equal(s.starvation_losses,0);assert.equal(s.food,5000);assert.equal(w.troop_upkeep_version,1);
 s.starvation_losses=3;s.starvation_last_at=new Date(start).toISOString();const imported=validateSave(w);assert.equal(imported.settlements[0].starvation_losses,3);assert.equal(imported.troop_upkeep_version,1);
 for(const change of [(x:typeof w)=>{x.troop_upkeep_version=2 as 1;},(x:typeof w)=>{x.settlements[0].food_troop_upkeep=NaN;},(x:typeof w)=>{x.settlements[0].starvation_losses=-1;},(x:typeof w)=>{x.settlements[0].starvation_last_at='invalid';}]){const bad=structuredClone(w);change(bad);assert.throws(()=>validateSave(bad));}
});

test('crop waiting on returned merchants feeds troops during a long absence',()=>{
 const {w,s,start}=fixture();s.food=5000;
 w.settlements.push({...s,id:2,name:'Other',x:s.x+128});
 w.trade_caravans=[{id:88,owner_id:s.owner_id,recipient_id:s.owner_id,source_settlement_id:1,target_settlement_id:2,source_city:s.name,target_city:'Other',resources:{wood:0,stone:0,food:100,gold:0},returning_resources:{wood:0,stone:0,food:100,gold:0},delivered_resources:{wood:0,stone:0,food:0,gold:0},volume:100,march_path:[[0,0],[1,1]],departure_at:new Date(start-120000).toISOString(),arrival_at:new Date(start-60000).toISOString(),return_at:w.server_now,return_settlement_id:1,status:'waiting'}];
 const polled=structuredClone(w);settleLocal(w,s.owner_id,start+1450*60000);
 for(let i=1;i<=1450;i++)settleLocal(polled,s.owner_id,start+i*60000);
 assert.equal(s.starvation_losses,0);assert.deepEqual(readRoster(w.armies[0]),readRoster(polled.armies[0]));near(s.food,polled.settlements[0].food);
});
