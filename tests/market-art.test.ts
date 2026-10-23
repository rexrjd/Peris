import test from 'node:test';
import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import * as THREE from 'three';
import {FACTIONS,type Faction} from '../src/features/factions/domain/factions';
import {createSlotModel} from '../src/features/city/rendering/three/slotModels';
import {disposeCityObject} from '../src/features/city/rendering/three/modelKit';
test('all eleven Market architectures have five distinct bounded native development stages',()=>{
 const factions=Object.keys(FACTIONS) as Faction[],byStage=Array.from({length:5},()=>new Set<string>());
 for(const faction of factions){const stages=new Set<string>();for(let level=0;level<=5;level++){
  const model=createSlotModel('bazaar',level,faction),bounds=new THREE.Box3().setFromObject(model),hash=createHash('sha256');let draws=0,vertices=0;
  model.traverse(o=>{if(!(o instanceof THREE.Mesh))return;draws++;const p=o.geometry.getAttribute('position');vertices+=p.count;assert.ok([...p.array].every(Number.isFinite));hash.update(Buffer.from(p.array.buffer,p.array.byteOffset,p.array.byteLength));});
  assert.ok(bounds.min.x>=-1.65&&bounds.max.x<=1.65&&bounds.min.z>=-1.65&&bounds.max.z<=1.65,`${faction} ${level} footprint`);
  assert.ok(draws<=16&&vertices<25000);
  if(!level)assert.ok(bounds.max.y<=.3);else {assert.equal(model.userData.marketLevel,level);const signature=hash.digest('hex');stages.add(signature);byStage[level-1].add(signature);}
  disposeCityObject(model);
 }assert.equal(stages.size,5,faction);}
 for(const signatures of byStage)assert.equal(signatures.size,11,'factions differ in geometry as well as palette');
});
