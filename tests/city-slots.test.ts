import test from 'node:test';
import assert from 'node:assert/strict';
import { createSolo } from '../src/features/campaign/domain/newRealm';
import { queueSlot } from '../src/features/city/domain/slotCommands';
import { slotCount, citySlots, refreshCityEconomy, armyAttack } from '../src/features/city/domain/slots';
import { settleLocal } from '../src/features/campaign/domain/settlement';
import { validateSave } from '../src/platform/storage/saves';
import type { LocalCommandContext } from '../src/shared/model/commands';
function fixture(){const world=createSolo('Rex');const context:LocalCommandContext={world,playerId:world.players[0].id,nextId:()=>1+Math.max(0,...world.orders.map(o=>o.id)),active:undefined,now:world.server_now,paused:()=>{},finalize:()=>{}};return {world,context};}
function finish(f:ReturnType<typeof fixture>){const end=Date.parse(f.world.orders[0].finish_at);settleLocal(f.world,f.context.playerId,end);f.context.now=new Date(end).toISOString();}
test('plots start empty, duplicates finish independently, and locked plots reject without spending',()=>{const f=fixture();assert.equal(citySlots(f.world,1).length,0);assert.equal(slotCount(0),6);queueSlot(f.context,{type:'buildSlot',slot:0,item:'smithy'});assert.equal(f.world.city_slots![0].level,0);assert.throws(()=>queueSlot(f.context,{type:'buildSlot',slot:1,item:'smithy'}),/working/);finish(f);queueSlot(f.context,{type:'buildSlot',slot:1,item:'smithy'});finish(f);assert.equal(armyAttack(f.world,1),1.08);assert.deepEqual(f.world.city_slots!.map(s=>s.level),[1,1]);const before=structuredClone(f.world);assert.throws(()=>queueSlot(f.context,{type:'buildSlot',slot:6,item:'barracks'}),/main building/);assert.deepEqual(f.world,before);f.world.buildings.find(b=>b.building_type==='market')!.level=1;queueSlot(f.context,{type:'buildSlot',slot:6,item:'barracks'});finish(f);assert.equal(slotCount(5),16);});
test('fishery is restricted to the river and production changes only at completion',()=>{const f=fixture();assert.throws(()=>queueSlot(f.context,{type:'buildSlot',slot:0,item:'fishery'}),/riverside/);queueSlot(f.context,{type:'buildSlot',slot:16,item:'fishery'});assert.equal(f.world.settlements[0].food_rate,18);finish(f);assert.equal(f.world.settlements[0].food_rate,26);queueSlot(f.context,{type:'upgradeSlot',slot:16});finish(f);assert.equal(f.world.city_slots![0].level,2);assert.equal(f.world.settlements[0].food_rate,34);});
test('warehouses and granaries stack separately, smithy cap applies, and saves round-trip',()=>{const f=fixture();f.world.city_slots=[{settlement_id:1,slot_index:0,building_type:'warehouse',level:2},{settlement_id:1,slot_index:1,building_type:'warehouse',level:1},{settlement_id:1,slot_index:2,building_type:'granary',level:4},{settlement_id:1,slot_index:3,building_type:'smithy',level:5},{settlement_id:1,slot_index:4,building_type:'smithy',level:5},{settlement_id:1,slot_index:5,building_type:'smithy',level:5}];refreshCityEconomy(f.world,1);assert.equal(f.world.settlements[0].capacity,12500);assert.equal(f.world.settlements[0].food_capacity,15000);assert.equal(armyAttack(f.world,1),1.6);assert.deepEqual(validateSave(f.world),f.world);const broken=structuredClone(f.world);broken.city_slots!.push({...broken.city_slots![0]});assert.throws(()=>validateSave(broken));});
test('legacy buildings and combined storage survive migration',()=>{const f=fixture();delete f.world.city_slots;f.world.buildings.find(b=>b.building_type==='barracks')!.level=2;f.world.buildings.find(b=>b.building_type==='storehouse')!.level=3;const saved=validateSave(f.world);assert.deepEqual(saved.city_slots!.map(s=>[s.building_type,s.level]),[['barracks',2],['warehouse',3],['granary',3]]);assert.equal(saved.settlements[0].capacity,12500);assert.equal(saved.settlements[0].food_capacity,12500);});
test('growing walls leave clear space around every plot and keep resources outside',async()=>{
 const {cityLayout,cityFootprint,riverX}=await import('../src/features/city/rendering/three/layout');
 const {createSlotModel}=await import('../src/features/city/rendering/three/slotModels');
 const {disposeCityObject}=await import('../src/features/city/rendering/three/modelKit');
 const {Box3}=await import('three');
 let previousArea=0;
 for(let level=0;level<=5;level++){
  const growth=1+level*.1,footprint=cityFootprint(level),plots=cityLayout({market:level},[]);
  const area=(footprint.right-footprint.left)*(footprint.front-footprint.back)*growth*growth;assert.ok(area>previousArea);previousArea=area;
  for(const key of ['lumber','quarry','farm','fishery']){const p=plots.find(p=>p.key===key)!;assert.ok(p.x<footprint.left*growth||p.x>footprint.right*growth||p.z>footprint.front*growth);}
  assert.equal(plots.find(p=>p.key==='fishery')!.x,riverX(footprint.fishingZ)*growth);
  for(const plot of plots.filter(p=>p.slot!==undefined&&p.slot<16))for(const type of ['barracks','stables','smithy','warehouse','granary'] as const){
   const model=createSlotModel(type,5);model.scale.setScalar(.78);model.position.set(plot.x,0,plot.z);const bounds=new Box3().setFromObject(model);
   assert.ok(bounds.min.x>footprint.left*growth+.6&&bounds.max.x<footprint.right*growth-.6,`${type} at plot ${plot.slot} touches side wall`);
   assert.ok(bounds.min.z>footprint.back*growth+.6&&bounds.max.z<footprint.front*growth-1.5,`${type} at plot ${plot.slot} touches front wall`);
   disposeCityObject(model);
  }
 }
});
