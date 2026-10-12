import { test } from 'node:test';
import assert from 'node:assert/strict';
import * as THREE from 'three';
import { cityLayout, cityFootprint, riverX } from '../src/features/city/rendering/three/layout';
import { cityStreets, cityWalkRoute } from '../src/features/city/rendering/three/cityStreets';
import { createCityDistricts, createEmptyCityPlot } from '../src/features/city/rendering/three/cityDistricts';
import { createCityFoliage } from '../src/features/city/rendering/three/cityFoliage';
import { createSlotModel } from '../src/features/city/rendering/three/slotModels';
import { disposeCityObject } from '../src/features/city/rendering/three/modelKit';
import { FACTIONS, type Faction } from '../src/features/factions/domain/factions';

test('city walkers use street segments, avoid the farm on the way to lumber, and enter through the south gate', () => {
    for (let level = 0; level <= 5; level++) {
        const growth = 1 + level * .1, plots = cityLayout({ market: level }, []), roads = cityStreets(level), f = cityFootprint(level);
        const route = cityWalkRoute(plots.find(plot => plot.type === 'lumber')!, growth, level);
        assert.ok(route.some(([x, z]) => x === 0 && z === f.front));
        assert.ok(route.some(([x]) => x === -9.9));
        assert.ok(!route.some(([x, z]) => x === -12 && z === 5));
        for (const plot of plots.filter(plot => plot.type !== 'wall')) {
            const path = cityWalkRoute(plot, growth, level);
            assert.ok(path.flat().every(Number.isFinite));
            for (let i = 1; i < path.length; i++) {
                if (path[i][0] === path[i - 1][0] && path[i][1] === path[i - 1][1]) continue;
                const midpoint = new THREE.Vector2((path[i][0] + path[i - 1][0]) / 2, (path[i][1] + path[i - 1][1]) / 2);
                // Short approaches from a cross-street to a doorway are inside its courtyard.
                if (plot.slot !== undefined && plot.slot < 16 && i === path.length - 1) continue;
                assert.ok(roads.some(road => {
                    const a = new THREE.Vector2(...road.from), b = new THREE.Vector2(...road.to), ab = b.clone().sub(a);
                    const t = Math.max(0, Math.min(1, midpoint.clone().sub(a).dot(ab) / ab.lengthSq()));
                    return midpoint.distanceTo(a.addScaledVector(ab, t)) < .06;
                }), `${plot.key} level ${level} must follow the rendered streets`);
            }
        }
    }
});

test('wider river and service lane leave every available plot dry at every city stage', () => {
    for (let level = 0; level <= 5; level++) {
        const growth = 1 + level * .1;
        for (const plot of cityLayout({ market: level }, []).filter(plot => plot.slot !== undefined && plot.slot < 16)) {
            const x = plot.x / growth, z = plot.z / growth;
            assert.ok(x + 1.6 / growth < riverX(z) - .72);
        }
        for (let z = -9; z <= cityFootprint(level).front; z += .5) assert.ok(riverX(z) + .72 < cityFootprint(level).right);
    }
});

test('all factions have deterministic instanced scenery, empty slots remain empty, and siege workshops get real models', () => {
    for (const faction of Object.keys(FACTIONS) as Faction[]) {
        const a = createCityFoliage(3, faction), b = createCityFoliage(3, faction);
        assert.equal(a.children.length, 4);
        assert.deepEqual((a.children[0] as THREE.InstancedMesh).instanceMatrix.array, (b.children[0] as THREE.InstancedMesh).instanceMatrix.array);
        const empty = createEmptyCityPlot(faction), bounds = new THREE.Box3().setFromObject(empty);
        assert.ok(bounds.max.y < .25, 'an available plot must have no invented building');
        const noBuildings = createCityDistricts(cityLayout({}, []), faction);
        assert.equal(noBuildings.children.length, 0);
        const workshop = createSlotModel('workshop', 5, faction, true), fishery = createSlotModel('fishery', 5, faction, true);
        assert.notDeepEqual(new THREE.Box3().setFromObject(workshop).getSize(new THREE.Vector3()), new THREE.Box3().setFromObject(fishery).getSize(new THREE.Vector3()));
        for (const object of [a, b, empty, noBuildings, workshop, fishery]) disposeCityObject(object);
    }
});
