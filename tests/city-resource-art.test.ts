import { test } from 'node:test';
import assert from 'node:assert/strict';
import * as THREE from 'three';
import { FACTIONS, type Faction } from '../src/features/factions/domain/factions';
import { createCityWalls } from '../src/features/city/rendering/three/cityWalls';
import { createCityResource, type CityResource } from '../src/features/city/rendering/three/resourceModels';
import { cityLayout, cityFootprint, riverX } from '../src/features/city/rendering/three/layout';
import { cityGrowth } from '../src/features/city/domain/slots';
import { createCityActivities } from '../src/features/city/rendering/three/cityActivities';
import { disposeCityObject } from '../src/features/city/rendering/three/modelKit';

const factions = Object.keys(FACTIONS) as Faction[];
const resources: CityResource[] = ['lumber', 'quarry', 'farm', 'fishery'];
function clear(model: THREE.Object3D, x: number, z: number, direction: THREE.Vector3) {
    model.updateMatrixWorld(true);
    return new THREE.Raycaster(new THREE.Vector3(x, .22, z), direction, 0, 2.5).intersectObject(model, true).length === 0;
}

test('fortifications leave ground-level avenues, river channels and city plots open at every growth stage', () => {
    for (let main = 0; main <= 5; main++) for (const faction of factions) {
        const walls = createCityWalls(5, main, faction), f = cityFootprint(main), front = f.front + 9;
        for (const dx of [-.45, 0, .45]) assert.ok(clear(walls, .4 + dx, front + 1.2, new THREE.Vector3(0, 0, -1)), `${faction}: front avenue`);
        for (const z of [0, front]) for (const dx of [-.6, 0, .6]) {
            const x = riverX(z - 9) + .4 + dx;
            assert.ok(clear(walls, x, z + 1.2, new THREE.Vector3(0, 0, -1)), `${faction}: river at ${z}`);
        }
        for (const plot of cityLayout({ market: main }, []).filter(p => p.slot !== undefined && p.slot < 16)) {
            const g = cityGrowth(main);
            for (const dx of [-1.6, 1.6]) for (const dz of [-1.6, 1.6]) {
                const ray = new THREE.Raycaster(new THREE.Vector3(plot.x / g + .4 + dx / g, 8, plot.z / g + 9 + dz / g), new THREE.Vector3(0, -1, 0));
                assert.equal(ray.intersectObject(walls, true).length, 0, `${faction}: ${plot.key} remains buildable`);
            }
        }
        disposeCityObject(walls);
    }
});

test('resource models have five distinct stages, finite bounded geometry and no finished building at zero', () => {
    for (const faction of factions) for (const type of resources) {
        const signatures = new Set<string>();
        for (let level = 0; level <= 5; level++) {
            const model = createCityResource(type, level, faction), bounds = new THREE.Box3().setFromObject(model);
            let draws = 0, vertices = 0;
            model.traverse(object => {
                if (!(object instanceof THREE.Mesh)) return;
                draws++; vertices += object.geometry.getAttribute('position').count;
                assert.ok([...object.geometry.getAttribute('position').array].every(Number.isFinite));
                assert.equal(object.userData.cityMotion, undefined, 'previews stay static');
            });
            assert.ok(draws <= 16 && vertices < 25_000, `${faction} ${type} stays material-batched`);
            assert.ok(bounds.max.x < 2.8 && bounds.min.x > -2.8 && bounds.max.z < 2.3 && bounds.min.z > -2.3, `${faction} ${type} footprint`);
            if (!level) assert.ok(bounds.max.y <= .21);
            else signatures.add(`${vertices}:${bounds.max.y}`);
            for (const main of [0, 5]) {
                const g = cityGrowth(main), f = cityFootprint(main), p = cityLayout({ market: main }, []).find(p => p.type === type)!;
                const right = p.x + bounds.max.x * (type === 'fishery' ? .98 : 1.05), left = p.x + bounds.min.x * (type === 'fishery' ? .98 : 1.05), back = p.z + bounds.min.z * .98;
                assert.ok(right < f.left * g || left > f.right * g || back > f.front * g, `${type} stays beyond the wall`);
            }
            disposeCityObject(model);
        }
        assert.equal(signatures.size, 5, `${faction} ${type} evolves at every completed level`);
    }
});

test('resource working parts animate together and return to rest for reduced motion', () => {
    for (const type of resources) {
        const model = createCityResource(type, 5, 'roman', true), plots = cityLayout({ [type]: 5 }, [{ settlement_id: 1, slot_index: 16, building_type: 'fishery', level: 5 }]);
        const activities = createCityActivities(); activities.setModels(new Map([[type, { model }]]), plots, 'roman');
        let moving: THREE.Object3D | undefined;
        model.traverse(object => { if (object.userData.cityMotion && object.userData.cityMotion !== 'flag') moving ??= object; });
        assert.ok(moving, `${type} has working equipment`);
        const position = moving.position.clone(), rotation = moving.rotation.clone();
        activities.animate(2);
        assert.ok(!moving.position.equals(position) || !moving.rotation.equals(rotation));
        activities.animate(2, true); assert.ok(moving.position.equals(position) && moving.rotation.equals(rotation));
        disposeCityObject(model); disposeCityObject(activities.group);
    }
});
