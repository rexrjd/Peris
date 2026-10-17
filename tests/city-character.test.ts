import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import * as THREE from 'three';
import { FACTIONS, type Faction } from '../src/features/factions/domain/factions';
import { createSlotModel } from '../src/features/city/rendering/three/slotModels';
import { createCityHall } from '../src/features/city/rendering/three/cityHall';
import { createCitySurfaces } from '../src/features/city/rendering/three/citySurfaces';
import { cityLayout } from '../src/features/city/rendering/three/layout';
import { disposeCityObject } from '../src/features/city/rendering/three/modelKit';

test('native civic and working buildings have five distinct, bounded stages across all factions',()=>{
    for(const faction of Object.keys(FACTIONS) as Faction[])for(const type of ['market','smithy','warehouse','granary','barracks'] as const){
        const stages=new Set<string>();
        for(let level=1;level<=5;level++){
            const model=type==='market'?createCityHall(level,faction,true):createSlotModel(type,level,faction,true);
            const bounds=new THREE.Box3().setFromObject(model),hash=createHash('sha256');let draws=0,vertices=0;
            assert.ok(bounds.min.x>-1.8&&bounds.max.x<1.8&&bounds.min.z>-1.8&&bounds.max.z<1.6,`${faction} ${type} must fit its lot`);
            model.traverse(o=>{if(o instanceof THREE.Mesh){draws++;const p=o.geometry.getAttribute('position');vertices+=p.count;assert.ok([...p.array].every(Number.isFinite));hash.update(Buffer.from(p.array.buffer,p.array.byteOffset,p.array.byteLength));}});
            assert.ok(draws<=22&&vertices<12000,`${faction} ${type} stays material-batched`);stages.add(hash.digest('hex'));disposeCityObject(model);
        }
        assert.equal(stages.size,5,`${faction} ${type} changes actual geometry on every upgrade`);
    }
});

test('town paving leaves reserved empty lots untouched, stays deterministic and releases its resources',()=>{
    for(let level=0;level<=5;level++){
        const plots=cityLayout({market:level,lumber:1},[{settlement_id:1,slot_index:0,building_type:'housing',level:2}]);
        const before=structuredClone(plots),a=createCitySurfaces(plots,'roman'),b=createCitySurfaces(plots,'roman');
        assert.deepEqual(plots,before);assert.deepEqual(a.userData.citySurfaces,b.userData.citySurfaces);assert.ok(a.children.length<=2);
        const paving=a.getObjectByName('Town flagstone') as THREE.Mesh|undefined;
        if(paving){const p=paving.geometry.getAttribute('position');assert.ok(p.count<36000);
            for(let i=0;i<p.count;i+=6){
                const xs=Array.from({length:6},(_,n)=>p.getX(i+n)),zs=Array.from({length:6},(_,n)=>p.getZ(i+n));
                for(const slot of plots.filter(p=>p.slot!==undefined&&p.slot<16&&!p.level))assert.ok(Math.max(...xs)<=slot.x-1.599||Math.min(...xs)>=slot.x+1.599||Math.max(...zs)<=slot.z-1.599||Math.min(...zs)>=slot.z+1.599,'stonework must not consume an empty slot');
            }
        }
        let geometries=0,materials=0;
        a.traverse(o=>{if(o instanceof THREE.Mesh){assert.ok([...o.geometry.getAttribute('color').array].every(Number.isFinite));o.geometry.addEventListener('dispose',()=>geometries++);(o.material as THREE.Material).addEventListener('dispose',()=>materials++);}});
        const count=a.children.length;disposeCityObject(a);disposeCityObject(b);assert.equal(geometries,count);assert.equal(materials,count);
    }
    const empty=createCitySurfaces(cityLayout({},[]),'roman');assert.equal(empty.children.length,0);disposeCityObject(empty);
});

test('building previews use resting workplace models and animation remains opt-in',()=>{
    for(const type of ['smithy','warehouse','granary','barracks'] as const){
        const preview=createSlotModel(type,5,'roman'),working=createSlotModel(type,5,'roman',true);let motion=0;
        preview.traverse(o=>{if(o.userData.cityMotion)motion++;});assert.equal(motion,0);
        assert.equal(preview.name,working.name);
        // Previews omit the animated blacksmith; the structure keeps the same footprint.
        const a=new THREE.Box3().setFromObject(preview),b=new THREE.Box3().setFromObject(working);
        assert.ok(a.getSize(new THREE.Vector3()).distanceTo(b.getSize(new THREE.Vector3()))<.3);
        disposeCityObject(preview);disposeCityObject(working);
    }
});
