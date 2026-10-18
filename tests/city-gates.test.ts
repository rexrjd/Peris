import { test } from 'node:test';
import assert from 'node:assert/strict';
import * as THREE from 'three';
import { FACTIONS, type Faction } from '../src/features/factions/domain/factions';
import { createCityGate, createCityWaterGate } from '../src/features/city/rendering/three/gateModels';
import { createCityWalls } from '../src/features/city/rendering/three/cityWalls';
import { disposeCityObject } from '../src/features/city/rendering/three/modelKit';

function hits(object: THREE.Object3D, x: number, y: number, z: number, direction: THREE.Vector3) {
    object.updateMatrixWorld(true);
    return new THREE.Raycaster(new THREE.Vector3(x, y, z), direction, 0, 4).intersectObject(object, true).length;
}

test('all faction gate stages have clear pedestrian passages in both directions and solid arch spandrels', () => {
    for (const faction of Object.keys(FACTIONS) as Faction[]) for (const kind of ['main','postern','bridge'] as const) {
        const stages = new Set<string>();
        for (let level = 0; level <= 5; level++) {
            const model = createCityGate(level, faction, false, kind), bounds = new THREE.Box3().setFromObject(model);
            let vertices = 0, draws = 0;
            model.traverse(object => { if (object instanceof THREE.Mesh) { draws++; const p=object.geometry.getAttribute('position'); vertices+=p.count; assert.ok([...p.array].every(Number.isFinite)); } });
            assert.ok(draws <= 12 && vertices < 20_000, 'gates remain material-batched');
            if (!level) assert.ok(bounds.max.y <= .2, 'unbuilt walls have no finished gatehouse');
            else {
                stages.add(`${vertices}:${bounds.max.y}`);
                for (const x of kind === 'main' ? [-.45,0,.45] : [-.35,0,.35]) for (const y of [.22,.8]) for (const side of [-1,1]) {
                    assert.equal(hits(model,x,y,side*2,new THREE.Vector3(0,0,-side)),0,`${faction} ${kind} ${level}: open passage`);
                }
                if (level>=3) assert.ok(hits(model,0,kind==='main'?1.85:1.45,-2,new THREE.Vector3(0,0,1)), 'masonry closes the space above the arch');
            }
            disposeCityObject(model);
        }
        assert.equal(stages.size,5,`${faction} ${kind} evolves through five wall levels`);
    }
});

test('rear and bridge gates retain road alignment, and water portals leave the flowing channel open', () => {
    for (let level=1;level<=5;level++) {
        const walls=createCityWalls(level,5),rear=walls.getObjectByName('Rear city gate')!,bridge=walls.getObjectByName('Bridge city gate')!;
        for(const x of [-.35,0,.35])assert.equal(hits(walls,x,.8,-1.5,new THREE.Vector3(0,0,1)),0,'northern service road');
        for(const dz of [-.25,0,.25])assert.equal(hits(walls,bridge.position.x+1.5,.8,bridge.position.z+dz,new THREE.Vector3(-1,0,0)),0,'bridge road');
        assert.equal(rear.position.x,0);assert.equal(bridge.rotation.y,-Math.PI/2);
        const portal=createCityWaterGate(level,1.3);
        for(const x of [-.6,0,.6])assert.equal(hits(portal,x,.22,-1.5,new THREE.Vector3(0,0,1)),0,'river must remain visible through portal');
        disposeCityObject(walls);disposeCityObject(portal);
    }
});
