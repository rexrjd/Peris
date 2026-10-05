import assert from 'node:assert/strict';
import test from 'node:test';
import { createSolo } from '../src/features/campaign/domain/newRealm';
import { marchArmy } from '../src/features/map/domain/commands';
import { validateSave } from '../src/platform/storage/saves';
import { type LocalCommandContext } from '../src/shared/model/commands';
import { findMarchPath } from '../src/features/map/domain/pathfinding';
import { armyPosition, armyRouteRemaining, completeTravel } from '../src/features/map/domain/movement';
import { WORLD_REGIONS, worldRegionAt, isWalkable, getCell, cellCenter } from '../src/features/map/domain/worldGrid';
import { WORLD_COLS, WORLD_ROWS, MIN_X, MAX_X, MIN_Y, MAX_Y } from '../src/features/map/domain/dimensions';

function fixture(now = '2030-01-01T00:00:00.000Z') {
    const world = createSolo('Navigator');
    const context: LocalCommandContext = { world, now, playerId: 'solo-ruler', nextId: () => 1, active: undefined, paused: () => {}, finalize: () => {} };
    return { world, context, army: world.armies[0] };
}

test('strategic marching accepts distant mainland fields and rejects clamped sea destinations without mutation', () => {
    const { context, army } = fixture();
    const prior = JSON.stringify(army);
    assert.throws(() => marchArmy(context, { type: 'move', x: -100_000, y: 100_000 }), /sea/);
    assert.throws(() => marchArmy(context, { type: 'move', x: 100_000, y: -100_000 }), /sea/);
    assert.equal(JSON.stringify(army), prior);
    marchArmy(context, { type: 'move', x: -6000, y: -5000 });
    assert.equal(army.target_x, -6000); assert.equal(army.target_y, -5000);
    assert.ok(army.march_path && army.march_path.length > 2);
    assert.equal(Date.parse(army.arrival_at) - Date.parse(context.now), Math.floor(Math.max(2, army.march_distance! / 22) * 1000));
    assert.throws(() => marchArmy(context, { type: 'move', x: NaN, y: 0 }), /destination/);
});

test('rerouted marches interpolate and schedule arrival using the command clock at unchanged speed', () => {
    const { context, army } = fixture();
    const clock = Date.parse(context.now);
    Object.assign(army, { status: 'moving', start_x: -1000, start_y: 0, target_x: 1000, target_y: 0, departure_at: new Date(clock - 5000).toISOString(), arrival_at: new Date(clock + 5000).toISOString() });
    marchArmy(context, { type: 'move', x: 220, y: 0 });
    assert.equal(army.start_x, 0); assert.equal(army.start_y, 0);
    assert.equal(army.departure_at, context.now);
    assert.equal(Date.parse(army.arrival_at) - clock, 10000);
    marchArmy(context, { type: 'move', x: 0, y: 0 });
    assert.equal(Date.parse(army.arrival_at) - clock, 2000);
});

test('legacy raids keep exact camp coordinates and existing training and cooldown guards', () => {
    const { world, context, army } = fixture();
    const camp = world.camps[0];
    world.progress = [{ owner_id: 'solo-ruler', camp_id: camp.id, defeated: 1, available_at: '2030-01-01T00:01:00.000Z' }];
    assert.throws(() => marchArmy(context, { type: 'raid', campId: camp.id }), /regrouping/);
    world.progress = [];
    marchArmy(context, { type: 'raid', campId: camp.id });
    assert.deepEqual({ x: army.target_x, y: army.target_y }, { x: camp.x, y: camp.y });
    assert.equal(army.raid_target_id, camp.id);
    world.orders = [{ id: 1, owner_id: 'solo-ruler', kind: 'recruit', item: 'infantry', quantity: 1, started_at: context.now, finish_at: context.now }];
    assert.throws(() => marchArmy(context, { type: 'move', x: -20000, y: -20000 }), /training queue/);
});

test('v6 save imports preserve legacy coordinates and round-trip distant signed marches', () => {
    const { world, army } = fixture();
    assert.deepEqual(validateSave(world), world);
    Object.assign(army, { start_x: -25536, start_y: 20000, target_x: 25536, target_y: -22000, status: 'moving' });
    assert.deepEqual(validateSave(JSON.parse(JSON.stringify(world))), world);
    assert.equal(world.version, 6);
});

test('v6 save coordinates retain legacy half-open bounds and still reject nonfinite geometry', () => {
    const { world, army } = fixture();
    world.settlements[0].x = -25600; world.settlements[0].y = -25600;
    army.target_x = 25599; army.target_y = 25599;
    assert.doesNotThrow(() => validateSave(world));
    for (const value of [-25601, 25600, Infinity, NaN]) {
        army.target_x = value; assert.throws(() => validateSave(world));
        army.target_x = 25599; army.target_y = value; assert.throws(() => validateSave(world));
        army.target_y = 25599;
    }
});

test('coastline passability matches terrain, map edges are sea, and region labels belong to their named regions', () => {
    assert.deepEqual([WORLD_COLS, WORLD_ROWS, MIN_X, MAX_X, MIN_Y, MAX_Y], [200, 200, -12800, 12800, -12800, 12800]);
    for (let row = -100; row < 100; row++) for (let col = -100; col < 100; col++) {
        assert.equal(isWalkable(col, row), getCell(col, row).terrain !== 'water');
        if (col === -100 || col === 99 || row === -100 || row === 99) assert.equal(isWalkable(col, row), false);
    }
    for (const region of WORLD_REGIONS) {
        const col = Math.floor(region.label.x / 128), row = Math.floor(region.label.y / 128);
        assert.equal(worldRegionAt(col, row).id, region.id, `${region.name} lettering belongs to its region`);
    }
});

test('continental route goes around the southern gulf and every step respects land and diagonal corners', () => {
    const from = cellCenter(-5, 60), to = cellCenter(35, 60), route = findMarchPath(from, to)!;
    assert.ok(route); assert.ok(route.distance > Math.hypot(to.x - from.x, to.y - from.y));
    assert.deepEqual(route.path[0], [from.x, from.y]); assert.deepEqual(route.path.at(-1), [to.x, to.y]);
    assert.ok(route.path.length <= 2000);
    let total = 0;
    route.path.forEach((point, i) => {
        const col = Math.floor(point[0] / 128), row = Math.floor(point[1] / 128);
        assert.ok(isWalkable(col, row));
        if (!i) return;
        const prior = route.path[i - 1], pc = Math.floor(prior[0] / 128), pr = Math.floor(prior[1] / 128);
        assert.ok(Math.abs(pc - col) <= 1 && Math.abs(pr - row) <= 1);
        if (pc !== col && pr !== row) { assert.ok(isWalkable(pc, row)); assert.ok(isWalkable(col, pr)); }
        total += Math.hypot(point[0] - prior[0], point[1] - prior[1]);
    });
    assert.equal(route.distance, total);
    assert.deepEqual(findMarchPath(from, to), route, 'Identical route requests are deterministic');
});

test('islands are disconnected from mainland and failed commands preserve existing marching intent', () => {
    const { army, context } = fixture(); army.raid_target_id = 5;
    const prior = JSON.stringify(army);
    for (const [col, row] of [[-30, 87], [35, 82], [75, 40]]) {
        const target = cellCenter(col, row); assert.ok(isWalkable(col, row));
        assert.equal(findMarchPath({ x: army.start_x, y: army.start_y }, target), null);
        assert.throws(() => marchArmy(context, { type: 'move', ...target }), /connected land route/);
        assert.equal(JSON.stringify(army), prior);
    }
    assert.ok(findMarchPath(cellCenter(35, 82), cellCenter(36, 84)), 'An army already on an island can move within it');
});

test('coastal diagonal corners cannot be crossed through an intervening sea field', () => {
    let found = false;
    for (let row = -98; row < 98 && !found; row++) for (let col = -98; col < 98 && !found; col++) {
        if (!isWalkable(col, row) || !isWalkable(col + 1, row + 1) || isWalkable(col + 1, row) && isWalkable(col, row + 1)) continue;
        found = true;
        const route = findMarchPath(cellCenter(col, row), cellCenter(col + 1, row + 1));
        assert.ok(!route || route.path.length > 2, 'No direct diagonal cut through water');
    }
    assert.ok(found, 'The generated shoreline provides a meaningful corner-cut fixture');
});

test('marching uses polyline arc length, exposes remaining route, and clears route at arrival', () => {
    const { army } = fixture('2030-01-01T00:00:00.000Z'), now = Date.parse('2030-01-01T00:00:00.000Z');
    Object.assign(army, { start_x: 0, start_y: 0, target_x: 300, target_y: 100, status: 'moving', departure_at: new Date(now).toISOString(), arrival_at: new Date(now + 40000).toISOString(), march_path: [[0, 0], [0, 100], [300, 100]], march_distance: 400 });
    assert.deepEqual(armyPosition(army, now + 10000), { x: 0, y: 100 });
    assert.deepEqual(armyPosition(army, now + 20000), { x: 100, y: 100 });
    assert.deepEqual(armyRouteRemaining(army, now + 20000), [[100, 100], [300, 100]]);
    completeTravel(army, now + 40000);
    assert.equal(army.status, 'idle'); assert.equal(army.march_path, null); assert.equal(army.march_distance, null);
    assert.deepEqual(armyPosition(army, now + 40000), { x: 300, y: 100 });
});
