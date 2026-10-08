import assert from 'node:assert/strict';
import test from 'node:test';
import { createSolo } from '../src/features/campaign/domain/newRealm';
import { validateSave } from '../src/platform/storage/saves';

function routedSave() {
    const world = createSolo('Navigator');
    Object.assign(world.armies[0], { status: 'moving', target_x: 448, target_y: 448, march_path: [[195,315],[320,320],[320,448],[448,448]], march_distance: Math.hypot(125,5) + 256 });
    return world;
}

test('v6 campaign imports preserve validated coastal route metadata and legacy armies without routes', () => {
    const world = routedSave();
    assert.deepEqual(validateSave(JSON.parse(JSON.stringify(world))), world);
    assert.doesNotThrow(() => validateSave(createSolo('Legacy')));
});

test('route save validation rejects malformed geometry, spoofed endpoints and incorrect distances', () => {
    for (const change of [
        (a: ReturnType<typeof routedSave>['armies'][number]) => { a.march_path![1][0] = NaN; },
        (a: ReturnType<typeof routedSave>['armies'][number]) => { a.march_path![1][0] = 9000; },
        (a: ReturnType<typeof routedSave>['armies'][number]) => { a.target_x = 447; },
        (a: ReturnType<typeof routedSave>['armies'][number]) => { a.start_x = 400; },
        (a: ReturnType<typeof routedSave>['armies'][number]) => { a.march_distance = 1; },
        (a: ReturnType<typeof routedSave>['armies'][number]) => { a.march_distance = Infinity; },
        (a: ReturnType<typeof routedSave>['armies'][number]) => { a.march_path = []; },
    ]) {
        const world = routedSave(); change(world.armies[0]);
        assert.throws(() => validateSave(world));
    }
});

test('idle armies may retain harmless route history after settlement or battle return', () => {
    const world = routedSave(), army = world.armies[0];
    army.status = 'idle'; army.start_x = army.target_x = 195; army.start_y = army.target_y = 315;
    assert.doesNotThrow(() => validateSave(world));
});

test('v6 imports preserve routes outside the resized map against the legacy coastline', () => {
    const world = createSolo('Legacy'), army = world.armies[0];
    Object.assign(army, { status: 'moving', start_x: -15000, start_y: 3000, target_x: -14872, target_y: 3000,
        march_path: [[-15000, 3000], [-14872, 3000]], march_distance: 128 });
    assert.deepEqual(validateSave(JSON.parse(JSON.stringify(world))), world);
});

function territorySave() {
    const world = createSolo('Builder'), town = world.settlements[0];
    world.map_plots = [
        { col: 0, row: 1, owner_id: town.owner_id, settlement_id: town.id, building_type: 'lumber', level: 2 },
        { col: 0, row: 2, owner_id: town.owner_id, settlement_id: town.id, building_type: 'farm', level: 0 },
        { col: 0, row: 3, owner_id: town.owner_id, settlement_id: town.id, building_type: null, level: 0 },
        { col: 1, row: 1, owner_id: town.owner_id, settlement_id: town.id, building_type: 'quarry', level: 1 },
    ];
    world.orders = [{ id: 1, owner_id: town.owner_id, kind: 'field', item: 'field:0:2:farm', quantity: 1, started_at: '2030-01-01T00:00:00.000Z', finish_at: '2030-01-01T00:00:15.000Z' }];
    return world;
}

test('campaign imports preserve completed external fields and pending construction without advancing them', () => {
    const world = territorySave(), before = structuredClone(world), restored = validateSave(JSON.parse(JSON.stringify(world)));
    assert.deepEqual(restored.map_plots, world.map_plots);
    assert.deepEqual(restored.orders, world.orders);
    assert.equal(restored.map_plots![1].level, 0);
    assert.deepEqual(world, before, 'Import normalization does not mutate the source');
    world.map_plots!.reverse();
    assert.doesNotThrow(() => validateSave(world), 'Claim record order does not affect connected territory');
});

test('campaign imports reject duplicate aliases, foreign ownership and invalid field levels or construction targets', () => {
    type Saved = ReturnType<typeof territorySave>;
    for (const change of [
        (w: Saved) => { w.map_plots!.push({ ...w.map_plots![0] }); },
        (w: Saved) => { w.map_plots![0].col += 200; },
        (w: Saved) => { w.map_plots![0].owner_id = 'another-ruler'; },
        (w: Saved) => { w.map_plots![0].settlement_id++; },
        (w: Saved) => { w.map_plots![0].level = 6; },
        (w: Saved) => { w.map_plots![0].level = NaN; },
        (w: Saved) => { w.map_plots![0].building_type = null; },
        (w: Saved) => { w.orders[0].item = 'field:200:2:farm'; },
        (w: Saved) => { w.orders[0].item = 'field:0:2:lumber'; },
        (w: Saved) => { w.orders[0].item = 'field:1:2:farm'; },
        (w: Saved) => { w.orders[0].quantity = 2; },
        (w: Saved) => { w.orders.push({ ...w.orders[0], id: 2 }); },
        (w: Saved) => { w.map_plots![1].level = 5; },
        (w: Saved) => { w.map_plots![0].col = -5; w.map_plots![0].row = 6; },
    ]) {
        const world = territorySave(); change(world);
        assert.throws(() => validateSave(world));
    }
});

test('campaign territory validation connects canonical claims across the seam', () => {
    const world = territorySave(), town = world.settlements[0];
    town.x = 12736; town.y = 12736;
    world.map_plots = [
        { col: -100, row: 99, owner_id: town.owner_id, settlement_id: town.id, building_type: 'farm', level: 0 },
        { col: 98, row: 99, owner_id: town.owner_id, settlement_id: town.id, building_type: null, level: 0 },
        { col: 99, row: -100, owner_id: town.owner_id, settlement_id: town.id, building_type: null, level: 0 },
        { col: 98, row: 98, owner_id: town.owner_id, settlement_id: town.id, building_type: null, level: 0 },
        { col: -99, row: 99, owner_id: town.owner_id, settlement_id: town.id, building_type: null, level: 0 },
    ];
    world.players[0].upgrades = 4;
    world.orders[0].item = 'field:-100:99:farm';
    assert.doesNotThrow(() => validateSave(world));
});
