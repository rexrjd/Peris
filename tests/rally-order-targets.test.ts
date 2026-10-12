import test from 'node:test';
import assert from 'node:assert/strict';
import { createSolo } from '../src/features/campaign/domain/newRealm';
import { createRallyTargetPicker, RALLY_TARGET_LIMIT, RALLY_ROUTE_CACHE_LIMIT } from '../src/features/army/ui/rallyOrderTargets';
import { CELL_SIZE, WORLD_W } from '../src/features/map/domain/dimensions';

const template = createSolo('Targets').camps[0];
const camps = Array.from({ length: 600 }, (_, id) => ({ ...template, id, name: `Camp ${id}`, x: (id % 30 + .5) * CELL_SIZE, y: (Math.floor(id / 30) + .5) * CELL_SIZE }));

test('600 camp targets search only the visible shortlist and snapshot ticks reuse endpoint routes', () => {
    let calls = 0;
    const pick = createRallyTargetPicker((from, to) => { calls++; return { path: [[from.x, from.y], [to.x, to.y]], distance: 128 }; });
    const origin = { x: 0, y: 0 }, first = pick(camps, origin, '');
    assert.equal(first.length, RALLY_TARGET_LIMIT);
    assert.equal(calls, RALLY_TARGET_LIMIT);
    for (let tick = 0; tick < 40; tick++) {
        const snapshot = camps.map(camp => ({ ...camp, name: camp.name, stock_updated_at: String(tick) }));
        assert.deepEqual(pick(snapshot, origin, '').map(row => row.camp.id), first.map(row => row.camp.id));
    }
    assert.equal(calls, RALLY_TARGET_LIMIT);
    const found = pick(camps, origin, 'Camp 599');
    assert.deepEqual(found.map(row => row.camp.id), [599]);
    assert.equal(calls, RALLY_TARGET_LIMIT + 1);
    pick(camps, { x: WORLD_W, y: 0 }, 'Camp 599');
    assert.equal(calls, RALLY_TARGET_LIMIT + 1, 'wrapped aliases share the same endpoint route');
});

test('unreachable routes stay null in cache and changed endpoints invalidate their own route', () => {
    let calls = 0;
    const pick = createRallyTargetPicker(() => { calls++; return null; });
    const origin = { x: 0, y: 0 };
    assert.equal(pick(camps, origin, 'Camp 599')[0].routeDistance, null);
    assert.equal(pick(camps.map(camp => ({ ...camp })), origin, 'Camp 599')[0].routeDistance, null);
    assert.equal(calls, 1);
    pick(camps.map(camp => camp.id === 599 ? { ...camp, x: camp.x + 1 } : camp), origin, 'Camp 599');
    assert.equal(calls, 2);
    pick(camps, { x: 1, y: 0 }, 'Camp 599');
    assert.equal(calls, 3);
});

test('the route distance cache stays bounded across searches through all 600 camps', () => {
    let calls = 0;
    const pick = createRallyTargetPicker(() => { calls++; return { path: [], distance: 128 }; });
    const origin = { x: 0, y: 0 };
    // Exact names with a trailing space avoid matching the larger numbered camps.
    const named = camps.map(camp => ({ ...camp, name: `Camp ${camp.id} target` }));
    for (const camp of named) pick(named, origin, `Camp ${camp.id} target`);
    assert.equal(calls, 600);
    pick(named, origin, 'Camp 599 target');
    assert.equal(calls, 600, 'recent routes are retained');
    pick(named, origin, 'Camp 0 target');
    assert.equal(calls, 601, 'old routes outside the bounded cache are recomputed');
    assert.ok(RALLY_ROUTE_CACHE_LIMIT < camps.length);
});
