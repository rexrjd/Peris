import test from 'node:test';
import assert from 'node:assert/strict';
import { createSolo } from '../src/features/campaign/domain/newRealm';
import { queueSlot } from '../src/features/city/domain/slotCommands';
import { cityLayout, cityFootprint, riverX } from '../src/features/city/rendering/three/layout';
import { paintedCityLayout } from '../src/features/city/rendering/paintedLayout';
import type { LocalCommandContext } from '../src/shared/model/commands';
import { cityEnvironment, cityWaterAccess, type CityEnvironment } from '../src/features/city/domain/environment';
import { getCell, cellCenter } from '../src/features/map/domain/worldGrid';
import { createCityLandscape } from '../src/features/city/rendering/three/landscape';
import { createCityWalls } from '../src/features/city/rendering/three/cityWalls';
import { disposeCityObject } from '../src/features/city/rendering/three/modelKit';
import { cityBoundary } from '../src/features/city/rendering/paintedLayout';
import { Mesh, MeshStandardMaterial } from 'three';

function fixture() {
    const world = createSolo('Landscape');
    world.settlements[0].x = -6336; // The centre of forest field (-50, -30), with eight dry neighbours.
    world.settlements[0].y = -3776;
    const context: LocalCommandContext = { world, playerId: world.players[0].id, now: world.server_now,
        nextId: () => 701, active: undefined, paused: () => {}, finalize: () => {} };
    return { world, context };
}

test('a dry city rejects new fisheries without spending supplies or changing saved slots', () => {
    const { world, context } = fixture(), before = structuredClone(world);
    assert.throws(() => queueSlot(context, { type: 'buildSlot', slot: 16, item: 'fishery' }), /water|river/i);
    assert.deepEqual(world, before);
});

test('an existing inland fishery can still be upgraded', () => {
    const { world, context } = fixture();
    world.city_slots = [{ settlement_id: 1, slot_index: 16, building_type: 'fishery', level: 1 }];
    queueSlot(context, { type: 'upgradeSlot', slot: 16 });
    assert.equal(world.orders[0].item, 'slot:16:fishery');
});

// These consumer tests catch renderers that ignore the selected city's environment.
const dry = { seed: 42, terrain: 'forest', water: 'none' } as const;
test('both city layouts omit the unavailable riverside plot', () => {
    assert.ok(!(cityLayout as Function)({ market: 5 }, [], dry).some((p: { key: string }) => p.key === 'fishery'));
    assert.ok(!(paintedCityLayout as Function)({ market: 5 }, [], dry).some((p: { key: string }) => p.key === 'fishery'));
});

test('city seeds vary building positions without changing identities or moving earlier unlocked slots', () => {
    for (const layout of [cityLayout, paintedCityLayout]) {
        const a = (layout as Function)({ market: 0 }, [], dry);
        const b = (layout as Function)({ market: 0 }, [], { ...dry, seed: 739 });
        assert.notDeepEqual(a.filter((p: { slot?: number }) => p.slot !== undefined), b.filter((p: { slot?: number }) => p.slot !== undefined));
        const grown = (layout as Function)({ market: 5 }, [], dry);
        for (const p of a.filter((p: { slot?: number }) => p.slot !== undefined)) {
            const next = grown.find((q: { key: string }) => q.key === p.key);
            const growth = layout === cityLayout ? 1.5 : 1;
            assert.ok(Math.abs(next.x / growth - p.x) < 1e-8);
            if (layout === cityLayout) assert.ok(Math.abs(next.z / growth - p.z) < 1e-8);
            else assert.equal(next.y, p.y);
        }
        assert.deepEqual((layout as Function)({ market: 0 }, [], dry), a);
    }
});

test('city identity reads canonical map geography and preserves old fishery frontage', () => {
    const town = { x: -6336, y: -3776 }, original = cityEnvironment(town);
    assert.equal(original.terrain, 'forest'); assert.equal(original.water, 'none');
    assert.deepEqual(cityEnvironment({ x: town.x + 25600, y: town.y - 25600 }), original);
    assert.equal(cityEnvironment(town, true).water, 'river');
    assert.equal(cityEnvironment(town, true).seed, original.seed);
    for (const terrain of ['desert', 'snow', 'river', 'water'] as const) {
        let sample: ReturnType<typeof getCell> | undefined;
        for (let row = -100; row < 100 && !sample; row++) for (let col = -100; col < 100; col++) {
            if (getCell(col, row).terrain === terrain) { sample = getCell(col, row); break; }
        }
        assert.ok(sample);
        const point = cellCenter(sample.col, sample.row);
        assert.equal(cityEnvironment(point).terrain, terrain);
        if (terrain === 'river' || terrain === 'water') assert.notEqual(cityWaterAccess(point.x, point.y), 'none');
    }
});

test('city scenery uses biome ground and only builds water for cities with water access', () => {
    const ground: number[][] = [];
    for (const terrain of ['desert', 'snow'] as const) {
        const environment: CityEnvironment = { ...dry, terrain };
        const scene = (createCityLandscape as Function)(2, 'roman', environment);
        const mesh = scene.children[0] as Mesh;
        ground.push(Array.from(mesh.geometry.getAttribute('color').array));
        let water = 0;
        scene.traverse((o: Mesh) => { if (o instanceof Mesh && o.material instanceof MeshStandardMaterial && o.material.metalness === .08) water++; });
        assert.equal(water, 0, 'dry landscapes must have no river, bridge or fishing scenery');
        disposeCityObject(scene);
    }
    assert.notDeepEqual(ground[0], ground[1], 'Roman architecture must not force the same ground onto snow and desert');
});

test('both wall renderers vary the actual perimeter between city seeds', () => {
    const a = (createCityWalls as Function)(4, 3, 'roman', false, dry);
    const b = (createCityWalls as Function)(4, 3, 'roman', false, { ...dry, seed: 739 });
    const vertices = (group: typeof a) => { const result: number[] = []; group.traverse((o: Mesh) => { if (o instanceof Mesh) result.push(...o.geometry.getAttribute('position').array); }); return result; };
    assert.notDeepEqual(vertices(a), vertices(b));
    assert.notEqual((cityBoundary as Function)('roman', dry).path, (cityBoundary as Function)('roman', { ...dry, seed: 739 }).path);
    disposeCityObject(a); disposeCityObject(b);
});

test('seeded rivers stay clear of reserved building lots and the eastern stone footing', () => {
    for (let seed = 0; seed < 64; seed++) for (const main of [0, 5]) {
        const environment: CityEnvironment = { seed, terrain: 'river', water: 'river' }, footprint = cityFootprint(main, environment);
        for (let z = footprint.back; z <= footprint.front; z += .25) {
            const centre = riverX(z, environment);
            assert.ok(centre - .72 > 7.9, 'the channel must stay beyond the rightmost reserved plot');
            assert.ok(centre + .72 < footprint.right - .4, 'the channel must stay inside the stone footing');
        }
    }
});
