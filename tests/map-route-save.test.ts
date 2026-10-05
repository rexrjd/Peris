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
