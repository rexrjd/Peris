import { test } from 'node:test';
import assert from 'node:assert/strict';
import * as THREE from 'three';
import { createCityLife, cityLanternPlacements } from '../src/features/city/rendering/three/cityLife';
import { cityLayout } from '../src/features/city/rendering/three/layout';
import { cityStreetClearance } from '../src/features/city/rendering/three/cityStreets';
import { cityGrowth } from '../src/features/city/domain/slots';
import { disposeCityObject } from '../src/features/city/rendering/three/modelKit';
import { FACTIONS, type Faction } from '../src/features/factions/domain/factions';

test('lantern bases stay off every road and reserved slot at all city growth levels',()=>{
    for(let level=0;level<=5;level++){
        const plots=cityLayout({market:level,lumber:1},[]),g=cityGrowth(level),positions=cityLanternPlacements(plots,level);
        assert.ok(positions.length>=4&&positions.length<=20);
        assert.deepEqual(positions,cityLanternPlacements(plots,level),'placement is deterministic');
        for(const p of positions){
            assert.ok(cityStreetClearance(p.x/g,p.z/g,level)*g>=.1);
            for(const plot of plots.filter(p=>p.slot!==undefined&&p.slot<16))assert.ok(Math.abs(p.x-plot.x)>=1.69||Math.abs(p.z-plot.z)>=1.69,`${plot.key} must stay available`);
        }
    }
});

test('town dressing follows completed buildings, stays bounded and uses instanced flowers and lanterns',()=>{
    for(const faction of Object.keys(FACTIONS) as Faction[]){
        const empty=createCityLife(cityLayout({},[]),faction,0);assert.deepEqual(empty.group.userData.cityLife,{lanterns:0,flowers:0,shopkeepers:0});disposeCityObject(empty.group);
        const plots=cityLayout({market:3,lumber:3,quarry:3,farm:3},[{settlement_id:1,slot_index:0,building_type:'housing',level:3},{settlement_id:1,slot_index:1,building_type:'warehouse',level:3},{settlement_id:1,slot_index:2,building_type:'academy',level:2}]);
        const before=structuredClone(plots),town=createCityLife(plots,faction,3),stats=town.group.userData.cityLife;
        assert.deepEqual(plots,before,'presentation must not mutate game-derived plots');
        assert.ok(stats.flowers>40&&stats.flowers<300);assert.ok(stats.lanterns>=6&&stats.lanterns<=20);assert.equal(stats.shopkeepers,1);
        let draws=0,instanced=0,lights=0;
        town.group.traverse(object=>{if(object instanceof THREE.Light)lights++;if(object instanceof THREE.Mesh){draws++;const positions=object.geometry.getAttribute('position');assert.ok([...positions.array].every(Number.isFinite));if(object instanceof THREE.InstancedMesh){instanced++;assert.ok([...object.instanceMatrix.array].every(Number.isFinite));}}});
        assert.ok(draws<=30&&instanced>=6);assert.equal(lights,0,'decorative lanterns do not allocate individual lights');
        const removed=createCityLife(plots.filter(p=>p.key!=='slot:0'),faction,3);assert.ok(removed.group.userData.cityLife.flowers<stats.flowers,'demolished housing loses its flowers');
        disposeCityObject(removed.group);disposeCityObject(town.group);
    }
});

test('town gestures and glow freeze for reduced motion, and all owned resources are released',()=>{
    const town=createCityLife(cityLayout({market:3},[]),'roman',3);let arm:THREE.Object3D|undefined,glow:THREE.MeshStandardMaterial|undefined;
    const geometry=new Set<THREE.BufferGeometry>(),materials=new Set<THREE.Material>();
    town.group.traverse(object=>{
        if(object.userData.cityMotion==='townGreeting')arm=object;
        if(object instanceof THREE.Mesh){geometry.add(object.geometry);for(const material of Array.isArray(object.material)?object.material:[object.material]){materials.add(material);if(material.name==='Town lantern glass')glow=material as THREE.MeshStandardMaterial;}}
    });
    assert.ok(arm&&glow);town.animate(2,false);assert.notEqual(arm.rotation.z,0);assert.notEqual(glow.emissiveIntensity,.8);
    town.animate(2,true);assert.equal(arm.rotation.z,0);assert.equal(glow.emissiveIntensity,.8);
    let disposedGeometry=0,disposedMaterials=0;geometry.forEach(g=>g.addEventListener('dispose',()=>disposedGeometry++));materials.forEach(m=>m.addEventListener('dispose',()=>disposedMaterials++));
    disposeCityObject(town.group);assert.equal(disposedGeometry,geometry.size);assert.equal(disposedMaterials,materials.size);assert.equal(town.group.children.length,0);
});
