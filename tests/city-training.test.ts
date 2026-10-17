import { test } from 'node:test';
import assert from 'node:assert/strict';
import * as THREE from 'three';
import { createSolo } from '../src/features/campaign/domain/newRealm';
import { queueSlot } from '../src/features/city/domain/slotCommands';
import { activeCityTraining } from '../src/features/city/domain/training';
import { CityTrainingYard } from '../src/features/city/rendering/three/cityTraining';
import { cityLayout, cityFootprint } from '../src/features/city/rendering/three/layout';
import { createCityWalls } from '../src/features/city/rendering/three/cityWalls';
import { createSlotModel } from '../src/features/city/rendering/three/slotModels';
import { createCityFoliage } from '../src/features/city/rendering/three/cityFoliage';
import { CITY_LANDSCAPE_EDGE, cityStreets, cityStreetClearance } from '../src/features/city/rendering/three/cityStreets';
import { disposeCityObject } from '../src/features/city/rendering/three/modelKit';
import type { LocalCommandContext } from '../src/shared/model/commands';
import type { Army } from '../src/features/battle/rendering/three/armyAssets';
import { FACTIONS, type Faction } from '../src/features/factions/domain/factions';
import { CityCamera } from '../src/features/city/rendering/three/CityCamera';

test('new barracks are limited per city, including unfinished work, without spending on rejection', () => {
    const world = createSolo('Training');
    const context: LocalCommandContext = { world, playerId: world.players[0].id, now: world.server_now, nextId: () => 100, active: undefined, paused: () => {}, finalize: () => {} };
    queueSlot(context, { type: 'buildSlot', slot: 0, item: 'barracks' });
    world.orders = []; // An existing unfinished slot still reserves the unique building.
    const before = structuredClone(world);
    assert.throws(() => queueSlot(context, { type: 'buildSlot', slot: 1, item: 'barracks' }), /one barracks/);
    assert.deepEqual(world, before);
    world.city_slots![0].level = 1;
    queueSlot(context, { type: 'upgradeSlot', slot: 0 }); assert.equal(world.orders.length, 1);
    const second = { ...world.settlements[0], id: 2 }; world.settlements.push(second);
    context.settlementId = 2;
    queueSlot(context, { type: 'buildSlot', slot: 0, item: 'barracks' });
    assert.equal(world.city_slots!.filter(slot => slot.building_type === 'barracks').length, 2);
});

test('training follows current city, owner, recruitment building and actual start/end times', () => {
    const world = createSolo('Training'), owner = world.players[0].id, now = Date.parse(world.server_now);
    const order = { id: 1, owner_id: owner, army_id: world.armies[0].id, kind: 'recruit' as const, item: 'archers', quantity: 6, started_at: new Date(now - 1000).toISOString(), finish_at: new Date(now + 1000).toISOString() };
    world.orders = [order];
    assert.deepEqual(activeCityTraining(world, 1, owner, now), { unit: 'archers', quantity: 6 });
    assert.equal(activeCityTraining(world, 2, owner, now), null);
    assert.equal(activeCityTraining(world, 1, 'another-owner', now), null);
    assert.equal(activeCityTraining(world, 1, owner, now + 1000), null);
    assert.equal(activeCityTraining(world, 1, owner, now - 1001), null);
    for (const item of ['cavalry', 'ram', 'catapult', 'unknown']) {
        world.orders = [{ ...order, item }]; assert.equal(activeCityTraining(world, 1, owner, now), null);
    }
    world.orders = [{ ...order, settlement_id: 2 }]; assert.equal(activeCityTraining(world, 1, owner, now), null);
    assert.deepEqual(activeCityTraining(world, 2, owner, now), { unit: 'archers', quantity: 6 });
});

test('roads reach every landscape edge and the main gate faces the front at all growth levels', () => {
    for (let level = 0; level <= 5; level++) {
        const points = cityStreets(level).flatMap(road => [road.from, road.to]);
        for (const edge of [-CITY_LANDSCAPE_EDGE, CITY_LANDSCAPE_EDGE]) {
            assert.ok(points.some(([x]) => x === edge)); assert.ok(points.some(([, z]) => z === edge));
        }
        const walls = createCityWalls(5, level), gate = walls.getObjectByName('Front city gate')!;
        assert.ok(Math.abs(gate.position.z - 9 - cityFootprint(level).front) < 1e-9);
        assert.equal(gate.position.x - .4, 0); assert.equal(gate.rotation.y, Math.PI);
        disposeCityObject(walls);
    }
});

test('larger barracks fit ordinary city lots, and dense trees leave all roads clear', () => {
    for (const faction of Object.keys(FACTIONS) as Faction[]) {
        const model = createSlotModel('barracks', 5, faction, true), bounds = new THREE.Box3().setFromObject(model);
        assert.ok(bounds.max.x - bounds.min.x > 3, faction);
        assert.ok(bounds.max.x < 1.8 && bounds.min.x > -1.8 && bounds.max.z < 1.6 && bounds.min.z > -1.8, faction);
        const foliage = createCityFoliage(0, faction), crowns = foliage.children[1] as THREE.InstancedMesh;
        assert.ok(crowns.count >= 1000 && crowns.count <= 1100);
        const position = new THREE.Vector3(), matrix = new THREE.Matrix4();
        for (let i = 0; i < crowns.count; i++) {
            crowns.getMatrixAt(i, matrix); position.setFromMatrixPosition(matrix);
            assert.ok(cityStreetClearance(position.x, position.z, 0) >= 1.09);
        }
        disposeCityObject(model); disposeCityObject(foliage);
    }
});

test('zoomed-out portrait ground stays ahead of the near plane and inside the landscape', () => {
    for (const main of [0, 2, 5]) for (const angle of [0, Math.PI / 8, Math.PI / 2]) {
        const view = new CityCamera(); view.resize(320,700,main); view.zoom(.7); view.rotate(angle,true);
        const growth = 1 + main * .1;
        for (const x of [-1,1]) for (const y of [-1,1]) {
            const point = view.ground(new THREE.Vector2(x,y)); assert.ok(point);
            assert.ok(Math.abs(point.x) <= CITY_LANDSCAPE_EDGE * growth && Math.abs(point.z) <= CITY_LANDSCAPE_EDGE * growth);
            const projected = point.clone().project(view.camera); assert.ok(projected.z > -1 && projected.z < 1);
        }
    }
});

test('training is batched, respects reduced motion, and releases late sources on city/faction teardown', async () => {
    const pending: ((army: Army) => void)[] = [], yard = new CityTrainingYard(() => {}, () => new Promise(resolve => pending.push(resolve)));
    const plots = cityLayout({}, [{ settlement_id: 1, slot_index: 0, building_type: 'barracks', level: 1 }]);
    yard.setTraining({ unit: 'infantry', quantity: 900 }, plots, 'roman');
    assert.equal(yard.group.children.length, 2); assert.equal(yard.state, 'loading');
    const matrices = () => { const result: number[] = []; yard.group.traverse(object => { if (object instanceof THREE.InstancedMesh) { assert.ok(object.count <= 6); result.push(...object.instanceMatrix.array); } }); return result; };
    yard.animate(.7, false); const moving = matrices(); yard.animate(1.4, false); assert.notDeepEqual(matrices(), moving);
    yard.animate(2, true); const still = matrices(); yard.animate(8, true); assert.deepEqual(matrices(), still);
    yard.setTraining({ unit: 'archers', quantity: 3 }, plots, 'elf');
    let released = 0; pending[0]({ parts: new Map(), dispose: () => { released++; } }); await Promise.resolve();
    assert.equal(released, 1);
    yard.setTraining(null, plots, 'elf'); assert.equal(yard.group.visible, false); assert.equal(yard.group.children.length, 0);
    yard.dispose(); pending[1]({ parts: new Map(), dispose: () => { released++; } }); await Promise.resolve();
    assert.equal(released, 2);
});
