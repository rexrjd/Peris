import test from 'node:test';
import assert from 'node:assert/strict';
import { cityPublicSpaces } from '../src/features/city/rendering/three/cityPublicSpaces';
import { createCityLandmark } from '../src/features/city/rendering/three/cityLandmarks';
import { cityLayout, cityRenderGrowth } from '../src/features/city/rendering/three/layout';
import { cityPlan, planContains } from '../src/features/city/rendering/three/cityPlan';
import { cityStreetClearance, cityStreets } from '../src/features/city/rendering/three/cityStreets';
import { createCityLife, cityLanternPlacements } from '../src/features/city/rendering/three/cityLife';
import { disposeCityObject } from '../src/features/city/rendering/three/modelKit';
import { Mesh, Box3, MeshStandardMaterial, Vector3 } from 'three';
import type { CityEnvironment } from '../src/features/city/domain/environment';

const styles=['roman','elf','orc'] as const;
const env=(layout:typeof styles[number],seed:number):CityEnvironment=>({layout,seed,terrain:'forest',water:'river'});

test('Orc, Undead and Demon cities have no flowers or flower pots',()=>{
    const plots=cityLayout({market:3},[{settlement_id:1,slot_index:0,building_type:'housing',level:3},{settlement_id:1,slot_index:1,building_type:'academy',level:3}]);
    for(const faction of ['orc','undead','demon'] as const){
        const town=createCityLife(plots,faction,3);
        assert.equal(town.group.userData.cityLife.flowers,0);
        assert.equal(town.group.getObjectByName('Town flowers'),undefined);
        town.group.traverse(object=>{if(object instanceof Mesh)for(const m of Array.isArray(object.material)?object.material:[object.material])assert.notEqual(m.name,'Town flower petals');});
        disposeCityObject(town.group);
    }
});

test('native avenues are visibly broader than side paths without moving existing sites',()=>{
    for(const style of styles){
        const environment=env(style,739),streets=cityStreets(5,environment);
        assert.ok(streets.some(p=>p.width>=1.2));assert.ok(streets.some(p=>p.width<=.5));
        assert.ok(Math.max(...streets.map(p=>p.width))/Math.min(...streets.map(p=>p.width))>=2.4);
        assert.deepEqual(cityLayout({market:5},[],environment),cityLayout({market:5},[],{...environment}));
    }
});

test('legacy avenue surfaces and borders clear the raised garden verges',()=>{
    for(let main=0;main<=5;main++){
        const avenue=cityStreets(main).find(s=>s.from[0]===0&&s.from[1]===-4.2)!;
        assert.ok(avenue.width/2+.05<=.76-.17,'avenue border overlaps a stone garden bed');
    }
});

test('landmark reservations also exclude lamp posts and hanging baskets',()=>{
    for(const style of styles)for(const seed of [1,170,739,1501]){
        const environment=env(style,seed),placement=cityPublicSpaces(3,environment).landmark!,g=cityRenderGrowth(3,environment);
        const lamps=cityLanternPlacements(cityLayout({market:3},[],environment),3,environment);
        for(const lamp of lamps)assert.ok(Math.hypot(lamp.x-placement.x*g,lamp.z-placement.z*g)>placement.radius*g+.3);
    }
});

test('landmarks and junction paving preserve future lots, streets, boundary and seed identity',()=>{
    for(const style of styles)for(const seed of [1,170,739,1501]){
        const environment=env(style,seed),plan=cityPlan(environment)!,spaces=cityPublicSpaces(5,environment),g=cityRenderGrowth(5,environment);
        assert.ok(spaces.landmark,`${style}/${seed}: missing landmark`);
        assert.deepEqual(cityPublicSpaces(1,{...environment}),spaces);
        const landmark=spaces.landmark!;
        assert.ok(cityStreetClearance(landmark.x,landmark.z,5,environment)>landmark.radius+.12);
        assert.ok(spaces.squares.length>=1);
        for(const space of [landmark,...spaces.squares]){
            for(let i=0;i<16;i++){const a=i*Math.PI/8;assert.ok(planContains(plan.boundary,{x:space.x+Math.cos(a)*space.radius,z:space.z+Math.sin(a)*space.radius}));}
            for(const p of plan.sites){const dx=Math.max(0,Math.abs(space.x-p.x)-1.6/g),dz=Math.max(0,Math.abs(space.z-p.z)-1.6/g);assert.ok(Math.hypot(dx,dz)>space.radius+.05,`${style}/${seed}: public space covers a future plot`);}
        }
    }
});

test('landmark models stay within their reserved space, animate gently and respect reduced motion',()=>{
    for(const style of styles){
        const environment=env(style,739),placement=cityPublicSpaces(5,environment).landmark!,g=cityRenderGrowth(5,environment),model=createCityLandmark(placement,style,g);
        const bounds=new Box3().setFromObject(model.group);
        assert.ok(bounds.min.x>=(placement.x-placement.radius)*g-.01&&bounds.max.x<=(placement.x+placement.radius)*g+.01);
        assert.ok(bounds.min.z>=(placement.z-placement.radius)*g-.01&&bounds.max.z<=(placement.z+placement.radius)*g+.01);
        model.group.updateMatrixWorld(true);
        model.group.traverse(object=>{if(object instanceof Mesh){const vertices=object.geometry.getAttribute('position');for(let i=0;i<vertices.count;i++){const p=new Vector3().fromBufferAttribute(vertices,i).applyMatrix4(object.matrixWorld);assert.ok(Math.hypot(p.x-placement.x*g,p.z-placement.z*g)<=placement.radius*g+.01,'solid landmark geometry exceeds its circular reservation');}}});
        model.animate(1,true);const still=model.group.toJSON();model.animate(3,true);assert.deepEqual(model.group.toJSON(),still);
        const moving:number[]=[];model.group.traverse(o=>{if(o.userData.cityMotion==='civicLandmark')moving.push(o.scale.y);});
        if(style!=='elf'){assert.ok(moving.length>0);model.animate(2,false);const changed:number[]=[];model.group.traverse(o=>{if(o.userData.cityMotion==='civicLandmark')changed.push(o.scale.y);});assert.notDeepEqual(changed,moving);}
        let glow:MeshStandardMaterial|undefined;model.group.traverse(o=>{if(o instanceof Mesh&&o.material instanceof MeshStandardMaterial&&o.material.name==='Gathering flame')glow=o.material;});
        if(style==='orc'){assert.ok(glow);model.animate(2,false);assert.notEqual(glow!.emissiveIntensity,1);model.animate(2,true);assert.equal(glow!.emissiveIntensity,1);}
        disposeCityObject(model.group);
    }
});
